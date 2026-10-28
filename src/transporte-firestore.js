// Transporte REAL: habla con el buzón en Firestore (proyecto buzon-cifrado-fcp) por su API REST, sin SDK ni claves de Firebase.
// Misma interfaz que transporte.js (publicar, pendientes, confirmar, lista, ponerLista), así el resto de la app no cambia.
//
// Estructura (ver firebase/firestore.rules):
//   /b/{clave}/lista/actual                           lista firmada de aparatos {texto, firma, adminPub}
//   /b/{clave}/buzones/{kid}/mensajes/{id}            UN documento por mensaje y por aparato destinatario
// {clave} es una cadena larga al azar que solo conocen las apps autorizadas (NO va en el código ni en el repositorio).
export const PROYECTO_POR_OMISION = "buzon-cifrado-fcp";

export function generarClaveBuzon() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");   // 43 caracteres, url-safe
}
export function claveValida(clave) { return typeof clave === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(clave); }

export function crearTransporteFirestore(config) {
  config = config || {};
  const proyecto = config.proyecto || PROYECTO_POR_OMISION;
  const clave = config.clave;
  if (!claveValida(clave)) throw new Error("La clave del buzón no es válida.");
  const RAIZ = "projects/" + proyecto + "/databases/(default)/documents";
  const URL_API = "https://firestore.googleapis.com/v1/";
  const seg = encodeURIComponent;

  const ts = function (iso) { return { timestampValue: new Date(iso).toISOString() }; };
  const txt = function (s) { return { stringValue: String(s) }; };

  async function pedir(metodo, ruta, cuerpo) {
    const ctl = new AbortController();
    const reloj = setTimeout(function () { ctl.abort(); }, 25000);
    let r;
    try {
      r = await fetch(URL_API + ruta, {
        method: metodo,
        headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: ctl.signal
      });
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "El buzón tardó demasiado en responder." : "No hay conexión con el buzón.");
    } finally { clearTimeout(reloj); }
    let datos = null;
    try { datos = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) {
      const estado = datos && datos.error && datos.error.status;
      const err = new Error(estado === "PERMISSION_DENIED" ? "El buzón rechazó la operación (¿la clave del buzón es correcta?)."
        : estado === "NOT_FOUND" ? "No encontrado."
        : estado === "ALREADY_EXISTS" ? "Ese mensaje ya existe."
        : (datos && datos.error && datos.error.message) || ("Error " + r.status));
      err.estado = r.status; err.codigo = estado;
      throw err;
    }
    return datos;
  }

  const rutaMensajes = function (kid) { return RAIZ + "/b/" + seg(clave) + "/buzones/" + seg(kid) + "/mensajes"; };

  return {
    // Un documento por destinatario, todos en una sola operación atómica (o entran todos o ninguno).
    publicar: async function (env) {
      if (!env || !env.id || !Array.isArray(env.dest) || !env.dest.length) throw new Error("Mensaje mal formado.");
      const escrituras = env.dest.map(function (d) {
        return {
          update: {
            name: rutaMensajes(d.kid) + "/" + env.id,
            fields: { v: { integerValue: "1" }, creado: ts(env.creado), expira: ts(env.expira), iv: txt(env.iv), ct: txt(env.ct), epk: txt(d.epk), ivw: txt(d.iv), wk: txt(d.wk) }
          },
          currentDocument: { exists: false }
        };
      });
      await pedir("POST", RAIZ + ":commit", { writes: escrituras });
      return { ok: true };
    },

    // Mensajes que esperan a este aparato, ya en el formato de sobre que entiende cripto.abrir().
    pendientes: async function (kid) {
      const out = [];
      let pagina = "";
      do {
        const datos = await pedir("GET", rutaMensajes(kid) + "?pageSize=100" + (pagina ? "&pageToken=" + seg(pagina) : ""));
        (datos.documents || []).forEach(function (doc) {
          const f = doc.fields || {};
          const g = function (k) { return f[k] && (f[k].stringValue !== undefined ? f[k].stringValue : f[k].timestampValue); };
          out.push({ v: 1, id: doc.name.split("/").pop(), creado: g("creado"), expira: g("expira"), iv: g("iv"), ct: g("ct"),
                     dest: [{ kid: kid, epk: g("epk"), iv: g("ivw"), wk: g("wk") }] });
        });
        pagina = datos.nextPageToken || "";
      } while (pagina);
      out.sort(function (a, b) { return a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0; });
      return out;
    },

    // El aparato confirma que ya guardó su copia: se borra SU documento.
    confirmar: async function (id, kid) {
      await pedir("DELETE", rutaMensajes(kid) + "/" + seg(id));
      return { ok: true };
    },

    lista: async function () {
      try {
        const datos = await pedir("GET", RAIZ + "/b/" + seg(clave) + "/lista/actual");
        const f = datos.fields || {};
        return { texto: f.texto && f.texto.stringValue, firma: f.firma && f.firma.stringValue, adminPub: f.adminPub && f.adminPub.stringValue };
      } catch (e) {
        if (e.estado === 404) { const n = new Error("Todavía no hay lista de aparatos."); n.estado = 404; throw n; }
        throw e;
      }
    },

    ponerLista: async function (lista) {
      if (!lista || !lista.texto || !lista.firma || !lista.adminPub) throw new Error("Lista mal formada.");
      await pedir("PATCH", RAIZ + "/b/" + seg(clave) + "/lista/actual", { fields: { texto: txt(lista.texto), firma: txt(lista.firma), adminPub: txt(lista.adminPub) } });
      return { ok: true };
    },

    // El buzón real no tiene "espejo" (no se puede listar a todos los aparatos): solo existe en el buzón de pruebas.
    espejo: function () { return Promise.resolve([]); }
  };
}
