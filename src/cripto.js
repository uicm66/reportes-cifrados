// Cifrado del buzón. Solo WebCrypto (navegador y Node), sin dependencias ni compilación.
//
// Esquema (cifrado híbrido, un mensaje para varios aparatos):
//   - Cada aparato tiene un par de llaves ECDH P-256. La privada NUNCA sale del aparato.
//   - Cada mensaje se cifra UNA vez con una llave AES-GCM al azar (CEK).
//   - La CEK se envuelve por separado para cada aparato: ECDH(llave efímera, pública del aparato)
//     -> HKDF-SHA256 -> AES-GCM. Quien tenga la privada de un aparato abre SU copia y ninguna otra.
//   - El buzón solo ve: id, fechas, quiénes son los destinatarios (kid) y bytes cifrados.
//   - La lista de aparatos autorizados va firmada (ECDSA P-256) por la llave del administrador;
//     las apps emisoras guardan fija la pública del administrador y no aceptan listas con otra firma.

const C = globalThis.crypto;
const S = C && C.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const VERSION = 1;
export const DIAS_POR_OMISION = 14;

export function hayCifrado() {
  return !!(S && C.getRandomValues);
}

function exigirCifrado() {
  if (!hayCifrado()) {
    throw new Error("Este navegador no permite cifrar aquí. Abre la app desde https:// (o localhost).");
  }
}

// ---------- utilidades ----------
export function aB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function deB64(s) {
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
export function aleatorio(n) { return C.getRandomValues(new Uint8Array(n)); }
function hex(u8) { return Array.from(u8, function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
// UUID v4 sin crypto.randomUUID (no existe fuera de contextos seguros).
export function nuevoId() {
  const b = aleatorio(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

// ---------- llaves de aparato (ECDH) ----------
const ECDH = { name: "ECDH", namedCurve: "P-256" };

export async function generarParDeLlaves() {
  exigirCifrado();
  const par = await S.generateKey(ECDH, true, ["deriveBits"]);
  return { privada: par.privateKey, publica: par.publicKey };
}
export async function exportarPublica(k) { return aB64(new Uint8Array(await S.exportKey("raw", k))); }
export async function importarPublica(b64) { return S.importKey("raw", deB64(b64), ECDH, true, []); }
export async function exportarPrivada(k) { return new Uint8Array(await S.exportKey("pkcs8", k)); }
export async function importarPrivada(u8) { return S.importKey("pkcs8", u8, ECDH, true, ["deriveBits"]); }
// Identificador corto y estable de un aparato = primeros 8 bytes del SHA-256 de su llave pública.
export async function idDeLlave(pubB64) {
  const h = new Uint8Array(await S.digest("SHA-256", deB64(pubB64)));
  return hex(h.subarray(0, 8));
}

async function claveCompartida(privada, publicaOtro, info) {
  const bits = await S.deriveBits({ name: "ECDH", public: publicaOtro }, privada, 256);
  const hk = await S.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return S.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode(info) },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

// ---------- sellar / abrir un mensaje ----------
// carga: objeto cualquiera (JSON). destinatarios: [{kid, pub}] con pub en base64 (raw P-256).
export async function sellar(carga, destinatarios, opciones) {
  exigirCifrado();
  opciones = opciones || {};
  const dias = opciones.dias || DIAS_POR_OMISION;
  const ahora = opciones.ahora || new Date();
  if (!destinatarios || !destinatarios.length) throw new Error("No hay aparatos destinatarios.");
  const id = nuevoId();
  const aad = te.encode("buzon/v" + VERSION + "|" + id);
  const cek = await S.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = aleatorio(12);
  const ct = await S.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad }, cek, te.encode(JSON.stringify(carga)));
  const cekRaw = await S.exportKey("raw", cek);
  const dest = [];
  for (const d of destinatarios) {
    const ef = await generarParDeLlaves();
    const kek = await claveCompartida(ef.privada, await importarPublica(d.pub), "buzon/v" + VERSION + "|" + id + "|" + d.kid);
    const ivw = aleatorio(12);
    const wk = await S.encrypt({ name: "AES-GCM", iv: ivw, additionalData: aad }, kek, cekRaw);
    dest.push({ kid: d.kid, epk: await exportarPublica(ef.publica), iv: aB64(ivw), wk: aB64(new Uint8Array(wk)) });
  }
  return {
    v: VERSION,
    id: id,
    creado: ahora.toISOString(),
    expira: new Date(ahora.getTime() + dias * 86400000).toISOString(),
    iv: aB64(iv),
    ct: aB64(new Uint8Array(ct)),
    dest: dest
  };
}

// Abre la copia de ESTE aparato (kid) con su llave privada. Lanza error si no es para él o si fue alterado.
export async function abrir(env, kid, privada) {
  exigirCifrado();
  const d = (env.dest || []).find(function (x) { return x.kid === kid; });
  if (!d) throw new Error("Este mensaje no es para este aparato.");
  const aad = te.encode("buzon/v" + env.v + "|" + env.id);
  const kek = await claveCompartida(privada, await importarPublica(d.epk), "buzon/v" + env.v + "|" + env.id + "|" + kid);
  const cekRaw = await S.decrypt({ name: "AES-GCM", iv: deB64(d.iv), additionalData: aad }, kek, deB64(d.wk));
  const cek = await S.importKey("raw", cekRaw, "AES-GCM", false, ["decrypt"]);
  const pt = await S.decrypt({ name: "AES-GCM", iv: deB64(env.iv), additionalData: aad }, cek, deB64(env.ct));
  return JSON.parse(td.decode(pt));
}

// ---------- lista de aparatos autorizados (firmada por el administrador) ----------
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const FIRMA = { name: "ECDSA", hash: "SHA-256" };

export async function generarLlaveAdmin() {
  exigirCifrado();
  const par = await S.generateKey(ECDSA, true, ["sign", "verify"]);
  return { privada: par.privateKey, publica: par.publicKey };
}
export async function exportarPublicaAdmin(k) { return aB64(new Uint8Array(await S.exportKey("raw", k))); }
export async function exportarPrivadaAdmin(k) { return new Uint8Array(await S.exportKey("pkcs8", k)); }
export async function importarPrivadaAdmin(u8) { return S.importKey("pkcs8", u8, ECDSA, true, ["sign"]); }

// dispositivos: [{kid, nombre, pub}]; version debe crecer en cada publicación.
export async function firmarLista(dispositivos, version, adminPrivada, adminPubB64) {
  const lista = { v: VERSION, version: version, creado: new Date().toISOString(), dispositivos: dispositivos };
  const texto = JSON.stringify(lista);
  const f = await S.sign(FIRMA, adminPrivada, te.encode(texto));
  return { texto: texto, firma: aB64(new Uint8Array(f)), adminPub: adminPubB64 };
}

// adminPubFijada: la pública del administrador que la app emisora tiene guardada. versionMinima evita volver a una lista vieja.
export async function verificarLista(firmada, adminPubFijada, versionMinima) {
  if (!firmada || !firmada.texto || !firmada.firma) throw new Error("La lista de aparatos está vacía o dañada.");
  if (firmada.adminPub !== adminPubFijada) throw new Error("La lista no está firmada por el administrador de esta escuela.");
  const llave = await S.importKey("raw", deB64(adminPubFijada), ECDSA, false, ["verify"]);
  const ok = await S.verify(FIRMA, llave, deB64(firmada.firma), te.encode(firmada.texto));
  if (!ok) throw new Error("La firma de la lista no es válida.");
  const lista = JSON.parse(firmada.texto);
  if (versionMinima && lista.version < versionMinima) throw new Error("La lista de aparatos es más vieja que la que ya se conocía.");
  // Cada kid debe corresponder a su llave pública (nadie puede colar una llave bajo el nombre de otro).
  for (const d of lista.dispositivos) {
    if ((await idDeLlave(d.pub)) !== d.kid) throw new Error("Un aparato de la lista no coincide con su llave.");
  }
  return lista;
}

// ---------- cifrado con contraseña / PIN (bóveda local y respaldos) ----------
export const ITERACIONES = 310000;

export async function claveDePassword(pass, salt, iter) {
  exigirCifrado();
  const base = await S.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return S.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iter || ITERACIONES },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
export async function cifrarBytes(clave, bytes, aad) {
  const iv = aleatorio(12);
  const ct = await S.encrypt({ name: "AES-GCM", iv: iv, additionalData: te.encode(aad || "") }, clave, bytes);
  return { iv: aB64(iv), ct: aB64(new Uint8Array(ct)) };
}
export async function descifrarBytes(clave, caja, aad) {
  const pt = await S.decrypt({ name: "AES-GCM", iv: deB64(caja.iv), additionalData: te.encode(aad || "") }, clave, deB64(caja.ct));
  return new Uint8Array(pt);
}
export async function cifrarObjeto(clave, obj, aad) { return cifrarBytes(clave, te.encode(JSON.stringify(obj)), aad); }
export async function descifrarObjeto(clave, caja, aad) { return JSON.parse(td.decode(await descifrarBytes(clave, caja, aad))); }
export function nuevaLlaveSimetrica() { return S.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
export async function exportarSimetrica(k) { return new Uint8Array(await S.exportKey("raw", k)); }
export function importarSimetrica(u8) { return S.importKey("raw", u8, "AES-GCM", true, ["encrypt", "decrypt"]); }

// Archivo de respaldo: se abre con una contraseña, en cualquier aparato (no depende de la llave del aparato).
export async function cifrarConPassword(obj, pass) {
  const salt = aleatorio(16);
  const clave = await claveDePassword(pass, salt, ITERACIONES);
  const caja = await cifrarObjeto(clave, obj, "buzon/respaldo");
  return { v: VERSION, tipo: "respaldo", salt: aB64(salt), iter: ITERACIONES, iv: caja.iv, ct: caja.ct };
}
export async function descifrarConPassword(blob, pass) {
  if (!blob || blob.tipo !== "respaldo") throw new Error("El archivo no es un respaldo del buzón.");
  const clave = await claveDePassword(pass, deB64(blob.salt), blob.iter);
  try {
    return await descifrarObjeto(clave, { iv: blob.iv, ct: blob.ct }, "buzon/respaldo");
  } catch (e) {
    throw new Error("Contraseña incorrecta o archivo dañado.");
  }
}
