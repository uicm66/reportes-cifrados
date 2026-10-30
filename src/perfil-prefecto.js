// Perfil y catálogo de un PREFECTO (módulo puro, navegador y Node, sin dependencias).
//
// La dirección (Mac) arma un mensaje cifrado dirigido SOLO al celular de ese prefecto con:
//   - su perfil: nombre, grado asignado, correo, credencial (hash con sal de su contraseña) y si está bloqueado;
//   - el catálogo de maestros (la misma lista que hoy baja la página: id, nombre y academia, nada más).
// El celular lo guarda cifrado y con él: comprueba correo y contraseña SIN Firebase, sabe su grado, y busca maestros.
// Si la dirección cambia el grado o bloquea, manda otro mensaje con una versión (rev) mayor y reemplaza al anterior.
//
// La contraseña NUNCA se guarda ni se manda: solo su hash (PBKDF2-SHA256 con sal propia).
export const TIPO_PERFIL = "perfil-prefecto";
export const ITER_PASSWORD = 150000;
const MAX_MAESTROS = 3000;

const te = new TextEncoder();
function aB64(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function deB64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
const corto = function (t, n) { return String(t == null ? "" : t).trim().slice(0, n); };

export function normalizarCorreo(c) { return String(c || "").trim().toLowerCase(); }

async function derivar(correo, contrasena, sal, iter) {
  const base = await crypto.subtle.importKey("raw", te.encode(contrasena), "PBKDF2", false, ["deriveBits"]);
  // la sal lleva también el correo: la misma contraseña en dos cuentas da hashes distintos aun si la sal se repitiera
  const salCompleta = new Uint8Array(sal.length + te.encode(correo).length);
  salCompleta.set(sal, 0); salCompleta.set(te.encode(correo), sal.length);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salCompleta, iterations: iter }, base, 256));
}

export async function crearCredencial(correo, contrasena) {
  const c = normalizarCorreo(correo);
  if (!c || c.indexOf("@") < 1) throw new Error("Escribe un correo válido.");
  if (typeof contrasena !== "string" || contrasena.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return { correo: c, sal: aB64(sal), iter: ITER_PASSWORD, hash: aB64(await derivar(c, contrasena, sal, ITER_PASSWORD)) };
}

export async function verificarCredencial(cred, correo, contrasena) {
  if (!cred || !cred.hash || !cred.sal) return false;
  const c = normalizarCorreo(correo);
  if (c !== cred.correo || typeof contrasena !== "string" || !contrasena) return false;
  const esperado = deB64(cred.hash);
  const calculado = await derivar(c, contrasena, deB64(cred.sal), cred.iter || ITER_PASSWORD);
  if (esperado.length !== calculado.length) return false;
  let dif = 0;                                           // comparación sin atajos (tiempo constante)
  for (let i = 0; i < esperado.length; i++) dif |= esperado[i] ^ calculado[i];
  return dif === 0;
}

// Limpia el catálogo igual que el servidor local: solo id, nombre y academia, con límites de tamaño.
export function limpiarCatalogo(catalogo) {
  const c = catalogo || {};
  if (!Array.isArray(c.maestros)) throw new Error("El catálogo no trae la lista de maestros.");
  if (c.maestros.length > MAX_MAESTROS) throw new Error("El catálogo tiene demasiados maestros.");
  const maestros = c.maestros.map(function (m) {
    return { id: corto(m && m.id, 80), nombre: corto(m && m.nombre, 120), academia: corto(m && m.academia, 60) };
  }).filter(function (m) { return m.nombre; });
  const e = c.escuela || {};
  // cuántos grupos tiene cada grado [1.º, 2.º, 3.º]: la página los usa para ofrecer 1A…1F, etc. (sin dato: 6 por grado)
  const grupos = Array.isArray(e.grupos) && e.grupos.length === 3 && e.grupos.every(function (n) { return Number.isInteger(n) && n >= 0 && n <= 12; }) ? e.grupos.slice() : null;
  return { maestros: maestros, escuela: Object.assign({ nombre: corto(e.nombre, 160), siglas: corto(e.siglas, 40), cct: corto(e.cct, 20) }, grupos ? { grupos: grupos } : {}),
           actualizado: corto(c.actualizado, 40) };
}

// Arma la carga que se cifra con cripto.sellar() para el aparato del prefecto.
//   perfil: { nombre, grado (1|2|3), credencial (de crearCredencial), bloqueado? }
export function mensajePerfil(perfil, catalogo, ahora) {
  const p = perfil || {};
  const grado = parseInt(p.grado, 10);
  if (![1, 2, 3].includes(grado)) throw new Error("El grado debe ser 1, 2 o 3.");
  if (!corto(p.nombre, 120)) throw new Error("Falta el nombre del prefecto.");
  if (!p.credencial || !p.credencial.correo || !p.credencial.hash) throw new Error("Falta el correo y la contraseña del prefecto.");
  const hoy = (ahora || new Date());
  return {
    rid: "perfil-prefecto-" + p.credencial.correo,
    rev: hoy.getTime(),                                  // un mensaje posterior reemplaza al anterior
    rol: "sistema",
    tipo: TIPO_PERFIL,
    fecha: hoy.toISOString().slice(0, 10),
    resumen: "Perfil y catálogo · " + corto(p.nombre, 120) + " · " + grado + "°",
    campos: [],
    datos: {
      perfil: { nombre: corto(p.nombre, 120), grado: grado, correo: p.credencial.correo, credencial: p.credencial, bloqueado: !!p.bloqueado },
      catalogo: limpiarCatalogo(catalogo)
    }
  };
}

// ---------- autenticidad: el perfil lo FIRMA la dirección ----------
// Sin esto, cualquiera que conozca la clave del buzón podría cifrar un perfil falso para el celular de un prefecto
// (bloquearlo, cambiarle el catálogo o ponerle otra contraseña). El celular solo acepta perfiles que verifica con la
// llave pública del administrador que trae su enlace de alta.
const FIRMA = { name: "ECDSA", hash: "SHA-256" };
const textoFirmado = function (c) { return JSON.stringify([c.rid, c.rev, c.tipo, c.datos]); };
export async function firmarPerfil(carga, adminPrivada) {
  const f = await crypto.subtle.sign(FIRMA, adminPrivada, te.encode(textoFirmado(carga)));
  return Object.assign({}, carga, { firma: aB64(new Uint8Array(f)) });
}
export async function perfilAutentico(carga, adminPubB64) {
  if (!carga || !carga.firma || carga.tipo !== TIPO_PERFIL) return false;
  try {
    const llave = await crypto.subtle.importKey("raw", deB64(adminPubB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify(FIRMA, llave, deB64(carga.firma), te.encode(textoFirmado(carga)));
  } catch (e) { return false; }
}

// Lo que hace el celular al recibir un mensaje de perfil: se queda con el más reciente.
//   estado: { rev, perfil, catalogo } o null.  Devuelve { estado, cambio }.
export function aplicarPerfil(estado, carga) {
  if (!carga || carga.tipo !== TIPO_PERFIL || !carga.datos || !carga.datos.perfil) return { estado: estado || null, cambio: false };
  if (estado && (estado.rev || 0) >= (carga.rev || 0)) return { estado: estado, cambio: false };
  return { estado: { rev: carga.rev, perfil: carga.datos.perfil, catalogo: carga.datos.catalogo }, cambio: true };
}

// ¿Puede entrar con este correo y contraseña?  { ok, motivo }
export async function puedeEntrar(estado, correo, contrasena) {
  if (!estado || !estado.perfil) return { ok: false, motivo: "Este celular todavía no tiene su perfil. Pide a la dirección que lo active." };
  if (estado.perfil.bloqueado) return { ok: false, motivo: "La dirección bloqueó este acceso." };
  if (!(await verificarCredencial(estado.perfil.credencial, correo, contrasena))) return { ok: false, motivo: "Correo o contraseña incorrectos." };
  return { ok: true, motivo: "" };
}
