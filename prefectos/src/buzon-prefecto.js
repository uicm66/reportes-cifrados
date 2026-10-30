// Pegamento del CELULAR DEL PREFECTO con el buzón cifrado (navegador). Sin Firebase actual y sin WhatsApp.
//
//  - Guarda en el celular (IndexedDB, cifrado con una llave que no sale de él): la llave del aparato, la configuración del enlace
//    de alta, el perfil y catálogo que manda la dirección, y la COLA de reportes por enviar.
//  - Pide el alta con una solicitud cifrada, y se queda esperando la aprobación.
//  - Solo acepta perfiles FIRMADOS por la dirección (con la llave del administrador que trajo el enlace).
//  - Los reportes se cifran solo para los aparatos de la dirección; si no hay internet quedan en la cola y se reintentan.
import * as C from "../../src/cripto.js";
import { crearTransporteFirestore } from "../../src/transporte-firestore.js";
import { decodificarConfig, crearSolicitudAlta, destinatariosDeDireccion } from "../../src/alta-aparato.js";
import { aplicarPerfil, puedeEntrar, perfilAutentico, TIPO_PERFIL } from "../../src/perfil-prefecto.js";

const DB_NOMBRE = "pf-buzon";
const REENVIO_SOLICITUD_MS = 10 * 60 * 1000;

// ---------- almacenamiento ----------
let _db = null;
function abrirDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise(function (ok, mal) {
    const rq = indexedDB.open(DB_NOMBRE, 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
    rq.onsuccess = function () { _db = rq.result; ok(_db); };
    rq.onerror = function () { mal(rq.error); };
  });
}
async function leer(k) {
  const db = await abrirDB();
  return new Promise(function (ok, mal) { const r = db.transaction("kv", "readonly").objectStore("kv").get(k); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { mal(r.error); }; });
}
async function escribir(k, v) {
  const db = await abrirDB();
  return new Promise(function (ok, mal) { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = function () { ok(); }; t.onerror = function () { mal(t.error); }; });
}
async function llaveLocal() {
  let k = await leer("llaveLocal");
  if (!k) { k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await escribir("llaveLocal", k); }
  return k;
}
async function guardarCif(clave, obj) { await escribir(clave, await C.cifrarObjeto(await llaveLocal(), obj, "pf|" + clave)); }
async function leerCif(clave) {
  const caja = await leer(clave);
  if (!caja) return null;
  try { return await C.descifrarObjeto(await llaveLocal(), caja, "pf|" + clave); } catch (e) { return null; }
}

// ---------- estado en memoria ----------
let _cfg = null, _estado = null, _disp = null, _aviso = "";

async function dispositivo() {
  if (_disp) return _disp;
  let d = await leer("dispositivo");
  if (!d) {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);   // la privada NO es extraíble
    const pub = await C.exportarPublica(par.publicKey);
    d = { kid: await C.idDeLlave(pub), pub: pub, privada: par.privateKey };
    await escribir("dispositivo", d);
  }
  _disp = d;
  return d;
}

export async function iniciar() {
  if (!C.hayCifrado() || !window.indexedDB) throw new Error("Este navegador no permite el cifrado aquí. Abre la página desde una dirección https (o localhost).");
  _aviso = "";
  const h = location.hash || "";
  if (h.indexOf("cfg=") >= 0) {
    try {
      const nueva = await decodificarConfig(h);
      const previa = await leerCif("config");
      await guardarCif("config", nueva);
      if (previa && previa.clave !== nueva.clave) { await escribir("estado", null); await escribir("solicitud", null); await escribir("lista", null); }
      history.replaceState(null, "", location.pathname + location.search);     // la clave no se queda en la barra de direcciones
    } catch (e) { _aviso = e.message; }
  }
  await dispositivo();
  _cfg = await leerCif("config");
  _estado = await leerCif("estado");
  return { aviso: _aviso };
}

// "sin-enlace" (falta abrir el enlace de alta) | "esperando" (falta que la dirección apruebe) | "listo"
export function estadoPantalla() { return !_cfg ? "sin-enlace" : (_estado && _estado.perfil) ? "listo" : "esperando"; }
export function perfil() { return _estado && _estado.perfil; }
export function catalogo() { return (_estado && _estado.catalogo) || { maestros: [], escuela: {} }; }
export async function ingresar(correo, contrasena) { return puedeEntrar(_estado, correo, contrasena); }
export function identificador() { return _disp ? _disp.kid : ""; }
export function avisoDeInicio() { return _aviso; }

// ---------- lista firmada de aparatos (con la llave del enlace) ----------
async function listaVerificada(t) {
  const guardada = await leerCif("lista");
  try {
    const l = await C.verificarLista(await t.lista(), _cfg.adminPub, (guardada && guardada.version) || 1);
    await guardarCif("lista", { version: l.version, dispositivos: l.dispositivos });
    return l;
  } catch (e) {
    if (guardada && !/firma|administrador|vieja/i.test(e.message)) return { version: guardada.version, dispositivos: guardada.dispositivos };   // sin conexión: la última verificada
    throw e;
  }
}

// ---------- alta ----------
async function enviarSolicitud(t) {
  const ultima = await leer("solicitud");
  if (ultima && Date.now() - ultima < REENVIO_SOLICITUD_MS) return false;
  const d = await dispositivo();
  const lista = await listaVerificada(t);
  const dest = destinatariosDeDireccion(lista.dispositivos);
  if (!dest.length) throw new Error("La dirección todavía no ha publicado su lista de aparatos.");
  const solicitud = await crearSolicitudAlta({ kid: d.kid, pub: d.pub, nombre: "Celular " + (_cfg.etiqueta || "de prefecto"), etiqueta: _cfg.etiqueta });
  await t.publicar(await C.sellar(solicitud, dest));
  await escribir("solicitud", Date.now());
  return true;
}

// ---------- cola de salida ----------
let _vaciando = null;
// Una pasada: manda lo que hay en la cola. Devuelve cuántas versiones nuevas llegaron mientras se enviaba.
async function pasadaDeSalida(t, dest) {
  const cola = (await leerCif("salida")) || [];
  if (!cola.length) return { enviados: 0, resto: 0, nuevas: 0, error: "" };
  let enviados = 0, error = "";
  const resto = [];
  cola.sort(function (a, b) { return (a.rev || 0) - (b.rev || 0); });
  for (const carga of cola) {
    try { await t.publicar(await C.sellar(carga, dest)); enviados++; }
    catch (e) { if (/ya existe/i.test(e.message)) enviados++; else { resto.push(carga); error = e.message; } }
  }
  // pudieron llegar reportes (o una corrección) a la cola mientras se enviaba: se conservan para la siguiente pasada
  const actual = (await leerCif("salida")) || [];
  const nuevas = actual.filter(function (a) { return !cola.some(function (c) { return c.rid === a.rid && c.rev === a.rev; }); });
  await guardarCif("salida", resto.concat(nuevas));
  return { enviados: enviados, resto: resto.length, nuevas: nuevas.length, error: error };
}
export function vaciarSalida() {
  if (_vaciando) return _vaciando;
  _vaciando = (async function () {
    try {
      if (!_cfg) return { enviados: 0, pendientes: 0 };
      if (!((await leerCif("salida")) || []).length) return { enviados: 0, pendientes: 0 };
      const t = crearTransporteFirestore({ clave: _cfg.clave, proyecto: _cfg.proyecto });
      let dest;
      try {
        const lista = await listaVerificada(t);
        dest = destinatariosDeDireccion(lista.dispositivos);
        if (!dest.length) throw new Error("La lista de la dirección está vacía.");
      } catch (e) { return { enviados: 0, pendientes: ((await leerCif("salida")) || []).length, error: e.message }; }
      let total = 0, r = { resto: 0, nuevas: 0, error: "" };
      for (let vuelta = 0; vuelta < 5; vuelta++) {           // sigue mientras lleguen reportes nuevos a la cola
        r = await pasadaDeSalida(t, dest);
        total += r.enviados;
        if (!r.nuevas || r.resto) break;
      }
      return { enviados: total, pendientes: ((await leerCif("salida")) || []).length, error: r.error };
    } finally { _vaciando = null; }
  })();
  return _vaciando;
}
// Pone un reporte en la cola (reemplaza al anterior con el mismo rid) y trata de mandarlo ya.
export async function encolar(carga) {
  const cola = (await leerCif("salida")) || [];
  const i = cola.findIndex(function (x) { return x.rid === carga.rid; });
  if (i >= 0) { if ((cola[i].rev || 0) <= (carga.rev || 0)) cola[i] = carga; } else cola.push(carga);
  await guardarCif("salida", cola);
  return vaciarSalida();
}
export async function pendientesDeEnviar() { return ((await leerCif("salida")) || []).length; }

// ---------- sincronizar: recibir el perfil, pedir el alta si falta, mandar la cola ----------
export async function sincronizar() {
  if (!_cfg) return { estado: "sin-enlace" };
  const t = crearTransporteFirestore({ clave: _cfg.clave, proyecto: _cfg.proyecto });
  const d = await dispositivo();
  let perfilNuevo = false, conexion = true, error = "";
  try {
    if (!(_estado && _estado.perfil)) { try { await enviarSolicitud(t); } catch (e) { error = e.message; } }
    for (const env of await t.pendientes(d.kid)) {
      try {
        const carga = await C.abrir(env, d.kid, d.privada);
        if (carga.tipo === TIPO_PERFIL) {
          if (await perfilAutentico(carga, _cfg.adminPub)) {            // un perfil sin la firma de la dirección se descarta
            const r = aplicarPerfil(_estado, carga);
            if (r.cambio) { _estado = r.estado; await guardarCif("estado", _estado); perfilNuevo = true; }
          }
        }
        await t.confirmar(env.id, d.kid);
      } catch (e) { /* un mensaje que no se pudo abrir no detiene a los demás */ }
    }
  } catch (e) { conexion = false; error = error || e.message; }
  const salida = await vaciarSalida();
  return { estado: estadoPantalla(), perfilNuevo: perfilNuevo, conexion: conexion, pendientes: salida.pendientes || 0, error: error || salida.error || "" };
}
