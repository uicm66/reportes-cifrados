// Rol TRABAJO SOCIAL: módulo puro (navegador y Node), sin dependencias de la app.
//
// A diferencia de SISBE, la trabajadora social SÍ tiene historial en su aparato (decisión del director, 2026-10-31):
// ve sus expedientes, da seguimiento ("En proceso"), cuenta cartas compromiso. Ese historial vive CIFRADO en su aparato
// (bóveda con PIN) y cada reporte además se envía cifrado a la dirección. Si cambia de aparato, la dirección le manda un
// RESPALDO de su historial (mensajes "ts-historial").
//
// Del alumno solo viajan un identificador OPACO (aid), nombre, grado y grupo: nunca CURP, teléfono, domicilio ni tutor.
// El aid lo calcula la dirección y solo ella sabe a qué alumno corresponde.

export const ROL_TS = "trabajo-social";
export const TIPO_PERFIL_TS = "perfil-ts";
export const TIPO_REPORTE_TS = "ts";
export const TIPO_RESPALDO_TS = "ts-historial";
export const TIPO_ACUSE_TS = "ts-acuse";
const MAX_ALUMNOS = 3000;
const MAX_FOTOS = 4;
const MAX_FOTO_CHARS = 200 * 1024;           // una foto ya reducida (jpeg ~900 px) pesa menos
const MAX_FOTOS_CHARS = 480 * 1024;          // todas las fotos de un reporte: cifrado y en base64 crece ~1.4x y un documento del buzón no puede pasar de 1 MB
const TROZO_RESPALDO = 500 * 1024;           // tamaño máximo de cada mensaje del respaldo (mismo motivo)

export const TIPOS_INTERVENCION = ["Citatorio a Tutor", "Entrevista con Tutor", "Visita Domiciliaria", "Canalización Externa", "Seguimiento Conductual", "Reporte de Incidencia", "Carta Compromiso", "Asistencia Social"];
export const ESTADOS_INTERVENCION = ["En proceso", "Pendiente", "Resuelto", "Canalizado"];

const corto = function (t, n) { return String(t == null ? "" : t).trim().slice(0, n); };
const esFecha = function (f) { return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f); };
const esAid = function (a) { return typeof a === "string" && /^[a-f0-9]{16}$/.test(a); };
const esFoto = function (f) { return typeof f === "string" && f.startsWith("data:image/jpeg;base64,") && f.length <= MAX_FOTO_CHARS; };

// aid estable (16 hex) a partir de un texto secreto de la dirección (por ejemplo "ts|" + CURP). `sha256Hex` se inyecta
// (en el navegador y en Node: crypto.subtle) para que este módulo siga siendo puro.
export async function aidDe(texto, sha256Hex) { return (await sha256Hex("ts-aid|" + String(texto))).slice(0, 16); }

// Catálogo de alumnos para la trabajadora social: SOLO { aid, nombre, grado, grupo }.
export function limpiarCatalogoTS(catalogo) {
  const c = catalogo || {};
  if (!Array.isArray(c.alumnos)) throw new Error("El catálogo no trae la lista de alumnos.");
  if (c.alumnos.length > MAX_ALUMNOS) throw new Error("El catálogo tiene demasiados alumnos.");
  const alumnos = c.alumnos.map(function (a) {
    const g = parseInt(a && a.grado, 10);
    return { aid: String((a && a.aid) || ""), nombre: corto(a && a.nombre, 120), grado: [1, 2, 3].includes(g) ? g : 0, grupo: corto(a && a.grupo, 2).toUpperCase() };
  }).filter(function (a) { return a.nombre && esAid(a.aid); });
  const e = c.escuela || {};
  return { alumnos: alumnos, escuela: { nombre: corto(e.nombre, 160), siglas: corto(e.siglas, 40), cct: corto(e.cct, 20) } };
}

// Carga que se cifra (y se FIRMA con firmarPerfil de perfil-prefecto.js) para el aparato de la trabajadora social.
export function mensajePerfilTS(perfil, catalogo, ahora) {
  const p = perfil || {};
  if (!corto(p.nombre, 120)) throw new Error("Falta el nombre de la trabajadora social.");
  if (!p.credencial || !p.credencial.correo || !p.credencial.hash) throw new Error("Falta el correo y la contraseña de la trabajadora social.");
  const hoy = ahora || new Date();
  return {
    rid: "perfil-ts-" + p.credencial.correo,
    rev: hoy.getTime(),
    rol: "sistema",
    tipo: TIPO_PERFIL_TS,
    fecha: hoy.toISOString().slice(0, 10),
    resumen: "Perfil y catálogo Trabajo Social · " + corto(p.nombre, 120),
    campos: [],
    datos: {
      perfil: { nombre: corto(p.nombre, 120), correo: p.credencial.correo, credencial: p.credencial, bloqueado: !!p.bloqueado },
      catalogo: limpiarCatalogoTS(catalogo)
    }
  };
}
export function aplicarPerfilTS(estado, carga) {
  if (!carga || carga.tipo !== TIPO_PERFIL_TS || !carga.datos || !carga.datos.perfil) return { estado: estado || null, cambio: false };
  if (estado && (estado.rev || 0) >= (carga.rev || 0)) return { estado: estado, cambio: false };
  return { estado: { rev: carga.rev, perfil: carga.datos.perfil, catalogo: carga.datos.catalogo }, cambio: true };
}

// ---------- el reporte (intervención) ----------
// Lista cerrada de campos. `id` es el identificador estable del reporte en el aparato (un reintento o una edición
// reemplazan, no duplican). Anular un reporte = reenviarlo con anulado:true.
export function limpiarRegistroTS(d) {
  d = d || {};
  if (!esAid(d.aid)) throw new Error("Falta elegir al alumno/a de la lista.");
  if (!esFecha(d.fecha)) throw new Error("Falta la fecha.");
  if (!corto(d.asunto, 200)) throw new Error("El asunto es obligatorio.");
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []).filter(esFoto).slice(0, MAX_FOTOS);
  if (fotos.reduce(function (n, f) { return n + f.length; }, 0) > MAX_FOTOS_CHARS) throw new Error("Las fotos de este reporte pesan demasiado: quita alguna o sube menos.");
  return {
    aid: d.aid,
    alumnoNombre: corto(d.alumnoNombre, 120), grado: [1, 2, 3].includes(parseInt(d.grado, 10)) ? parseInt(d.grado, 10) : 0, grupo: corto(d.grupo, 2).toUpperCase(),
    tipoIntervencion: TIPOS_INTERVENCION.includes(d.tipoIntervencion) ? d.tipoIntervencion : "Entrevista con Tutor",
    asunto: corto(d.asunto, 200), descripcion: corto(d.descripcion, 3000), acuerdos: corto(d.acuerdos, 2000),
    cartaCompromiso: !!d.cartaCompromiso,
    estado: ESTADOS_INTERVENCION.includes(d.estado) ? d.estado : "En proceso",
    fecha: d.fecha, hora: /^\d{2}:\d{2}$/.test(d.hora || "") ? d.hora : "",
    // Papel del alumno en el reporte (2026-11-06): "reportado" = se le acusa, "reporta" = él acusa, "" = sin indicar.
    papel: d.papel === "reportado" || d.papel === "reporta" ? d.papel : "",
    // Citatorio a padres/tutor (2026-11-06): solo si trae fecha válida; sin ella se ignoran los otros dos campos.
    citaFecha: esFecha(d.citaFecha) ? d.citaFecha : "",
    citaHora: esFecha(d.citaFecha) && /^\d{2}:\d{2}$/.test(d.citaHora || "") ? d.citaHora : "",
    citaPersona: esFecha(d.citaFecha) ? corto(d.citaPersona, 120) : "",
    anulado: !!d.anulado, motivoAnulacion: corto(d.motivoAnulacion, 200),
    fotos: fotos
  };
}
export function reporteDeIntervencionTS(id, datos, opciones) {
  const o = opciones || {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new Error("El reporte no tiene un identificador válido.");
  const reg = limpiarRegistroTS(datos);
  const hoy = o.ahora || new Date();
  const trabajador = corto(o.trabajador, 120);
  return {
    rid: "ts-" + id,
    rev: hoy.getTime(),
    rol: "trabajo-social",
    tipo: TIPO_REPORTE_TS,
    fecha: reg.fecha,
    resumen: "Trabajo Social · " + (trabajador || "trabajo social") + " · " + reg.fecha + " · " + reg.alumnoNombre + (reg.anulado ? " (anulado)" : ""),
    campos: [["Trabajo Social", trabajador || "(sin nombre)"], ["Fecha", reg.fecha], ["Alumno/a", reg.alumnoNombre], ["Asunto", reg.asunto]],
    datos: { id: id, trabajador: trabajador, registro: reg }
  };
}

// ---------- acuse de recibo (de la dirección al celular de la trabajadora) ----------
// Cuando la Mac recibe y guarda un reporte, avisa (cifrado y FIRMADO) al celular de la trabajadora: «recibí este reporte, versión rev».
// Así su celular puede decir «✓ Recibido por la dirección» en vez de solo «enviado».
const ID_REPORTE_OK = /^[A-Za-z0-9_-]{3,80}$/;
export function mensajeAcuseTS(items, ahora) {
  const hoy = ahora || new Date();
  const reportes = (items || []).filter(function (i) { return i && ID_REPORTE_OK.test(i.id || ""); }).slice(0, 200).map(function (i) { return { id: i.id, rev: Number(i.rev) || 0 }; });
  return { rid: "ts-acuse-" + hoy.getTime() + "-" + Math.random().toString(36).slice(2, 6), rev: hoy.getTime(), rol: "sistema", tipo: TIPO_ACUSE_TS, fecha: hoy.toISOString().slice(0, 10),
    resumen: "Acuse de recibo de reportes de Trabajo Social (" + reportes.length + ")", campos: [], datos: { reportes: reportes } };
}
// `acuses`: { idDelReporte: revRecibida }. Devuelve { acuses, nuevos } (solo se queda con las 3000 versiones más recientes).
export function aplicarAcuseTS(acuses, carga) {
  const a = Object.assign({}, acuses || {});
  let nuevos = 0;
  if (!carga || carga.tipo !== TIPO_ACUSE_TS || !carga.datos || !Array.isArray(carga.datos.reportes)) return { acuses: a, nuevos: 0 };
  carga.datos.reportes.forEach(function (r) {
    if (!r || !ID_REPORTE_OK.test(r.id || "")) return;
    const rev = Number(r.rev) || 0;
    if (r.id in a && a[r.id] >= rev) return;
    a[r.id] = rev; nuevos++;
  });
  const ks = Object.keys(a);
  if (ks.length > 3000) ks.sort(function (x, y) { return a[x] - a[y]; }).slice(0, ks.length - 3000).forEach(function (k) { delete a[k]; });
  return { acuses: a, nuevos: nuevos };
}

// ---------- respaldo del historial (de la dirección al aparato nuevo) ----------
// `reportes`: [{ id, aid, rev, registro }] (registro ya limpio). Se parte en mensajes que caben en el buzón.
export function mensajesHistorialTS(reportes, ahora) {
  const hoy = ahora || new Date(), lote = hoy.getTime();
  const partes = []; let actual = [], peso = 0;
  (reportes || []).forEach(function (r) {
    let registro;
    try { registro = limpiarRegistroTS(r.registro); }
    catch (e) {                                                  // un reporte viejo con fotos de más o datos raros no debe tirar todo el respaldo: se manda sin fotos o se omite
      try { registro = limpiarRegistroTS(Object.assign({}, r.registro, { fotos: [] })); } catch (e2) { return; }
    }
    const item = { id: r.id, aid: r.aid, rev: r.rev || 0, registro: registro };
    const n = JSON.stringify(item).length;
    if (actual.length && peso + n > TROZO_RESPALDO) { partes.push(actual); actual = []; peso = 0; }
    actual.push(item); peso += n;
  });
  if (actual.length) partes.push(actual);
  return partes.map(function (reps, i) {
    return { rid: "ts-historial-" + lote + "-" + (i + 1), rev: lote, rol: "sistema", tipo: TIPO_RESPALDO_TS, fecha: hoy.toISOString().slice(0, 10),
      resumen: "Respaldo del historial de Trabajo Social (" + (i + 1) + " de " + partes.length + ")", campos: [],
      datos: { parte: i + 1, de: partes.length, reportes: reps } };
  });
}
// Mezcla un mensaje de respaldo con el historial del aparato: gana el reporte con `rev` más nuevo.
export function aplicarHistorialTS(historial, carga) {
  const h = Object.assign({}, historial || {});
  let nuevos = 0;
  if (!carga || carga.tipo !== TIPO_RESPALDO_TS || !carga.datos || !Array.isArray(carga.datos.reportes)) return { historial: h, nuevos: 0 };
  carga.datos.reportes.forEach(function (r) {
    if (!r || !/^[A-Za-z0-9_-]{3,80}$/.test(r.id || "")) return;
    const previo = h[r.id];
    if (previo && (previo.rev || 0) >= (r.rev || 0)) return;
    h[r.id] = { id: r.id, aid: r.aid, rev: r.rev || 0, registro: limpiarRegistroTS(r.registro) };
    nuevos++;
  });
  return { historial: h, nuevos: nuevos };
}
// Lo que hace el aparato al guardar un reporte propio en su historial.
export function guardarEnHistorialTS(historial, carga) {
  const h = Object.assign({}, historial || {});
  if (!carga || carga.tipo !== TIPO_REPORTE_TS || !carga.datos) return h;
  h[carga.datos.id] = { id: carga.datos.id, aid: carga.datos.registro.aid, rev: carga.rev, registro: carga.datos.registro };
  return h;
}
