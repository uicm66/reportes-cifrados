// Alta de un celular nuevo (p. ej. de un prefecto) en la lista de aparatos autorizados. Módulo puro (navegador y Node).
//
// Flujo:
//   1) La dirección genera un ENLACE de alta: lleva la clave del buzón y la llave pública del administrador DENTRO del
//      fragmento (#cfg=…), que el navegador nunca envía a ningún servidor.
//   2) El celular abre el enlace, crea su par de llaves y manda una SOLICITUD cifrada a los aparatos de la dirección.
//   3) La dirección la ve, la aprueba y el aparato entra a la lista firmada con su rol; entonces recibe su perfil y catálogo.
//
// La lista firmada distingue roles: cada aparato lleva `rol` ("direccion" por omisión, "prefecto", …). Los reportes de un
// prefecto se cifran SOLO para los aparatos de la dirección, nunca para los celulares de otros prefectos.
import * as C from "./cripto.js";
import { claveValida, proyectoValido } from "./transporte-firestore.js";

export const TIPO_SOLICITUD = "solicitud-alta";
export const ROL_DIRECCION = "direccion";
const te = new TextEncoder(), td = new TextDecoder();

function aB64Url(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function deB64Url(t) { let b = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "="; const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

// ---------- configuración que viaja en el enlace ----------
async function adminPubValida(pub) {
  try {
    const raw = C.deB64(pub);
    if (raw.length !== 65) return false;
    await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return true;
  } catch (e) { return false; }
}

export async function codificarConfig(config) {
  const c = config || {};
  if (!claveValida(c.clave)) throw new Error("La clave del buzón no es válida.");
  if (!(await adminPubValida(c.adminPub))) throw new Error("La llave del administrador no es válida.");
  if (c.proyecto && !proyectoValido(c.proyecto)) throw new Error("El nombre del proyecto del buzón no es válido.");
  const cuerpo = { v: 1, clave: c.clave, adminPub: c.adminPub, etiqueta: String(c.etiqueta || "").trim().slice(0, 60) };
  if (c.proyecto) cuerpo.proyecto = c.proyecto;
  return aB64Url(te.encode(JSON.stringify(cuerpo)));
}

// Acepta el texto solo, o el enlace completo (con #cfg=…), o un texto con espacios/saltos de línea de más.
export async function decodificarConfig(texto) {
  let t = String(texto || "").trim();
  const k = t.indexOf("cfg=");
  if (k >= 0) t = t.slice(k + 4);
  // al copiar un enlace largo puede cortarse en varias líneas: se prueba el primer tramo y luego todo junto sin espacios
  const candidatos = [(t.match(/^[A-Za-z0-9_-]+/) || [""])[0], (t.replace(/\s+/g, "").match(/^[A-Za-z0-9_-]+/) || [""])[0]];
  let c = null;
  for (const cand of candidatos) {
    if (!cand || cand.length > 2000) continue;
    try { const x = JSON.parse(td.decode(deB64Url(cand))); if (x && typeof x === "object") { c = x; break; } } catch (e) { /* se prueba el siguiente */ }
  }
  if (!c) throw new Error("El enlace de alta está incompleto o dañado.");
  if (!c || c.v !== 1) throw new Error("El enlace de alta es de una versión que esta página no entiende.");
  if (!claveValida(c.clave)) throw new Error("El enlace de alta no trae una clave de buzón válida.");
  if (!(await adminPubValida(c.adminPub))) throw new Error("El enlace de alta no trae una llave de administrador válida.");
  if (c.proyecto !== undefined && !proyectoValido(c.proyecto)) throw new Error("El enlace de alta trae un nombre de proyecto no válido.");
  return Object.assign({ clave: c.clave, adminPub: c.adminPub, etiqueta: String(c.etiqueta || "").slice(0, 60) }, c.proyecto ? { proyecto: c.proyecto } : {});
}

export async function enlaceDeAlta(urlBase, config) {
  return String(urlBase).replace(/#.*$/, "") + "#cfg=" + await codificarConfig(config);
}

// ---------- solicitud de alta (la manda el celular nuevo) ----------
export async function crearSolicitudAlta(aparato, ahora) {
  const a = aparato || {};
  if (!a.kid || !a.pub) throw new Error("Falta la llave del aparato.");
  if ((await C.idDeLlave(a.pub)) !== a.kid) throw new Error("El identificador del aparato no corresponde a su llave.");
  const nombre = String(a.nombre || "").trim().slice(0, 60);
  if (!nombre) throw new Error("Falta el nombre del aparato.");
  const hoy = ahora || new Date();
  return {
    rid: "alta-" + a.kid, rev: hoy.getTime(), rol: "sistema", tipo: TIPO_SOLICITUD,
    fecha: hoy.toISOString().slice(0, 10),
    resumen: "Solicitud de alta · " + nombre,
    campos: [["Aparato", nombre], ["Identificador", a.kid]].concat(a.etiqueta ? [["Etiqueta del enlace", String(a.etiqueta).slice(0, 60)]] : []),
    datos: { kid: a.kid, pub: a.pub, nombre: nombre, etiqueta: String(a.etiqueta || "").slice(0, 60) }
  };
}

// ---------- la dirección aprueba ----------
// dispositivos: lista actual [{kid,nombre,pub,rol?,persona?}]. Devuelve la lista nueva (sin modificar la original).
export async function aprobarSolicitud(dispositivos, carga, opciones) {
  const lista = Array.isArray(dispositivos) ? dispositivos : [];
  if (!carga || carga.tipo !== TIPO_SOLICITUD || !carga.datos) throw new Error("Eso no es una solicitud de alta.");
  const d = carga.datos;
  if ((await C.idDeLlave(d.pub)) !== d.kid) throw new Error("La solicitud está alterada: el identificador no corresponde a la llave.");
  if (lista.some(function (x) { return x.kid === d.kid; })) throw new Error("Ese aparato ya está en la lista.");
  const o = opciones || {};
  const rol = String(o.rol || "").trim();
  if (!rol || rol === ROL_DIRECCION) throw new Error("Indica el rol del aparato (por ejemplo \"prefecto\").");
  return lista.concat([{ kid: d.kid, nombre: String(o.nombre || d.nombre).trim().slice(0, 60), pub: d.pub, rol: rol, persona: String(o.persona || "").trim().slice(0, 60) }]);
}

// ---------- a quién se cifra cada cosa ----------
// Los reportes de los roles van SOLO a la dirección (los aparatos sin `rol` cuentan como dirección: lista antigua).
export function destinatariosDeDireccion(dispositivos) {
  return (dispositivos || []).filter(function (d) { return !d.rol || d.rol === ROL_DIRECCION; }).map(function (d) { return { kid: d.kid, pub: d.pub }; });
}
export function destinatarioDe(dispositivos, kid) {
  const d = (dispositivos || []).find(function (x) { return x.kid === kid; });
  return d ? { kid: d.kid, pub: d.pub } : null;
}
