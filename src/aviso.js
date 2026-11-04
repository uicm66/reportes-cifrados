// AVISO AL CELULAR: cuando un celular de rol (prefecto, doctor, trabajo social, psicología) manda un reporte, avisa al iPhone/iPad de la dirección.
// El aviso NO lleva datos: solo dice que llegó algo («Llegó un reporte de prefectos»). Va a un «tema» secreto del servicio gratuito ntfy.sh, y el
// iPhone lo recibe con la app ntfy (suscrita a ese tema). El reporte en sí sigue viajando cifrado por el buzón, como siempre.
//
// El tema lo genera la dirección y lo reparten a los celulares de rol con un mensaje FIRMADO (como el perfil): un celular solo acepta el tema
// si trae la firma de la dirección. Quien conozca el tema podría mandar avisos falsos o verlos: por eso es una cadena larga al azar.
import * as C from "./cripto.js";

export const TIPO_AJUSTES = "ajustes-aviso";
export const SERVIDOR_AVISOS = "https://ntfy.sh";
const ANTIRREBOTE_MS = 45000;              // varios reportes seguidos (p. ej. 3 grupos) dan un solo aviso
let _ultimo = 0;

export function generarTema() {
  const b = C.aleatorio(18);
  let s = "";
  for (let i = 0; i < b.length; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[b[i] % 36];
  return "fcp-" + s;                        // 22 caracteres: letras minúsculas y números
}
export function temaValido(t) { return typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t); }

// Mensaje firmado (con perfil-prefecto.firmarPerfil) que la dirección manda a los celulares de rol. tema "" = avisos apagados.
export function mensajeAjustes(tema, ahora) {
  const hoy = ahora || new Date();
  if (tema && !temaValido(tema)) throw new Error("El tema del aviso no es válido.");
  return { rid: "ajustes-aviso", rev: hoy.getTime(), rol: "sistema", tipo: TIPO_AJUSTES, fecha: hoy.toISOString().slice(0, 10),
           resumen: "Ajustes de avisos", campos: [], datos: { tema: tema || "" } };
}
// Lo que hace el celular de rol al recibir los ajustes: se queda con los más recientes. estado: { rev, tema } o null.
export function aplicarAjustes(estado, carga) {
  if (!carga || carga.tipo !== TIPO_AJUSTES || !carga.datos) return { estado: estado || null, cambio: false };
  if (estado && (estado.rev || 0) >= (carga.rev || 0)) return { estado: estado, cambio: false };
  const tema = carga.datos.tema || "";
  if (tema && !temaValido(tema)) return { estado: estado || null, cambio: false };
  return { estado: { rev: carga.rev, tema: tema }, cambio: true };
}

// Manda el aviso. NUNCA lanza error ni detiene el envío del reporte: si no hay internet o el servicio falla, simplemente no avisa.
//   opciones: { texto, fetch, ahora, siempre }
export async function enviarAviso(tema, opciones) {
  const o = opciones || {};
  if (!temaValido(tema)) return false;
  const f = o.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!f) return false;
  const ahora = o.ahora ? o.ahora.getTime() : Date.now();
  if (!o.siempre && ahora - _ultimo < ANTIRREBOTE_MS) return false;
  _ultimo = ahora;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const reloj = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
  try {
    // sin encabezados especiales (evita la consulta previa de CORS): el título y la etiqueta van en la dirección
    await f(SERVIDOR_AVISOS + "/" + tema + "?title=" + encodeURIComponent("Reporte nuevo") + "&tags=mailbox",
            { method: "POST", body: String(o.texto || "Llegó un reporte nuevo"), mode: "no-cors", signal: ctl ? ctl.signal : undefined });
    return true;
  } catch (e) { return false; }
  finally { if (reloj) clearTimeout(reloj); }
}
export function _reiniciarAntirrebote() { _ultimo = 0; }       // solo para pruebas
