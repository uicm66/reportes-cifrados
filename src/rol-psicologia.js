// Rol PSICOLOGÍA: módulo puro (navegador y Node), sin dependencias de la app.
//
// Igual que Trabajo Social, el psicólogo SÍ tiene historial en su aparato (decisión del director, 2026-10-31): ve su bitácora,
// corrige y quita registros. Ese historial vive CIFRADO en su aparato (bóveda con PIN) y cada registro además se envía cifrado a la
// dirección. Si cambia de aparato, la dirección le manda un RESPALDO de su historial (mensajes "psi-historial").
//
// Del alumno solo viajan nombre, grado, grupo y sexo (H/M): nunca CURP, teléfono, domicilio ni tutor. La bitácora de Psicología
// se identifica por el nombre del alumno (igual que la app en línea), por eso aquí NO hay identificador opaco.
// El folio (PSI-001…) lo pone la dirección al recibir el registro.

export const ROL_PSI = "psicologia";
export const TIPO_PERFIL_PSI = "perfil-psi";
export const TIPO_REPORTE_PSI = "psi";
export const TIPO_RESPALDO_PSI = "psi-historial";
const MAX_ALUMNOS = 3000;
const TROZO_RESPALDO = 500 * 1024;           // tamaño máximo de cada mensaje del respaldo (un documento del buzón no puede pasar de 1 MB)

// Listas de la hoja (las mismas de la app en línea, psicologia-app.html). Los registros viejos pueden traer otros valores: se aceptan como texto.
export const PRIMER_CONTACTO = ["Psicología (atención directa)", "Trabajo Social", "Docente", "Dirección", "Prefectura", "Padre/madre/tutor", "El propio alumno/a (espontánea)", "Otro"];
export const CANALIZADO_POR = ["Psicología (sin canalización)", "Trabajo Social", "Docente", "Dirección", "Prefectura", "Padre/madre/tutor", "Espontánea (el alumno/a)", "Otro"];
export const TIPOS_MOTIVO = ["Código 100", "MUAI", "Consumo de Sustancias", "Ansiedad y depresión", "Cutting", "Hiperactividad", "Autismo", "Fracaso Escolar", "Conductas Disruptivas", "Otro"];
export const TIPOS_ANTERIORES = ["Conductual", "Emocional", "Académico", "Familiar", "Social / convivencia"];

const corto = function (t, n) { return String(t == null ? "" : t).trim().slice(0, n); };
const esFecha = function (f) { return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f); };
const unoDe = function (v, lista) { return lista.includes(v) ? v : ""; };

// Catálogo de alumnos para Psicología: SOLO { nombre, grado, grupo, sexo }.
export function limpiarCatalogoPsi(catalogo) {
  const c = catalogo || {};
  if (!Array.isArray(c.alumnos)) throw new Error("El catálogo no trae la lista de alumnos.");
  if (c.alumnos.length > MAX_ALUMNOS) throw new Error("El catálogo tiene demasiados alumnos.");
  const alumnos = c.alumnos.map(function (a) {
    const g = parseInt(a && a.grado, 10), s = String((a && a.sexo) || "").trim().toUpperCase().charAt(0);
    return { nombre: corto(a && a.nombre, 120), grado: [1, 2, 3].includes(g) ? g : 0, grupo: corto(a && a.grupo, 2).toUpperCase(), sexo: s === "H" || s === "M" ? s : "" };
  }).filter(function (a) { return a.nombre; });
  const e = c.escuela || {};
  return { alumnos: alumnos, escuela: { nombre: corto(e.nombre, 160), siglas: corto(e.siglas, 40), cct: corto(e.cct, 20) } };
}

// Carga que se cifra (y se FIRMA con firmarPerfil de perfil-prefecto.js) para el aparato del psicólogo.
export function mensajePerfilPsi(perfil, catalogo, ahora) {
  const p = perfil || {};
  if (!corto(p.nombre, 120)) throw new Error("Falta el nombre del psicólogo.");
  if (!p.credencial || !p.credencial.correo || !p.credencial.hash) throw new Error("Falta el correo y la contraseña del psicólogo.");
  const hoy = ahora || new Date();
  return {
    rid: "perfil-psi-" + p.credencial.correo,
    rev: hoy.getTime(),
    rol: "sistema",
    tipo: TIPO_PERFIL_PSI,
    fecha: hoy.toISOString().slice(0, 10),
    resumen: "Perfil y catálogo Psicología · " + corto(p.nombre, 120),
    campos: [],
    datos: {
      perfil: { nombre: corto(p.nombre, 120), correo: p.credencial.correo, credencial: p.credencial, bloqueado: !!p.bloqueado },
      catalogo: limpiarCatalogoPsi(catalogo)
    }
  };
}
export function aplicarPerfilPsi(estado, carga) {
  if (!carga || carga.tipo !== TIPO_PERFIL_PSI || !carga.datos || !carga.datos.perfil) return { estado: estado || null, cambio: false };
  if (estado && (estado.rev || 0) >= (carga.rev || 0)) return { estado: estado, cambio: false };
  return { estado: { rev: carga.rev, perfil: carga.datos.perfil, catalogo: carga.datos.catalogo }, cambio: true };
}

// ---------- el registro de la bitácora ----------
// Lista cerrada de campos (los de psicologia_bitacora). `id` es el identificador estable del registro en el aparato (un reintento o una
// edición reemplazan, no duplican). Quitar un registro = reenviarlo con anulado:true.
// `suave` (solo para el respaldo del historial): los registros viejos pueden no traer expediente, canalización o primer contacto.
export function limpiarRegistroPsi(d, suave) {
  d = d || {};
  if (!esFecha(d.fecha)) throw new Error("Falta la fecha.");
  const nombre = corto(d.alumnoNombre, 120);
  if (!nombre) throw new Error("Falta el nombre del alumno/a.");
  const expediente = unoDe(d.expediente, ["ya", "abierto", "no"]);
  if (!expediente && !suave) throw new Error("Indica si el alumno/a ya tenía expediente, si se le abrió o si no se ha abierto.");
  const expedienteNumero = corto(d.expedienteNumero, 40);
  if ((expediente === "ya" || expediente === "abierto") && !expedienteNumero && !suave) throw new Error("Escribe el número de expediente.");
  const canalizacion = unoDe(d.canalizacion, ["si", "por", "no"]);
  if (!canalizacion && !suave) throw new Error("Indica si el alumno/a está canalizado, por canalizar o no canalizado.");
  const primerContacto = corto(d.primerContacto, 80);
  if (!primerContacto && !suave) throw new Error("Indica dónde llegó el reporte por primera vez.");
  const tipoMotivo = corto(d.tipoMotivo, 80), tipoMotivoOtro = corto(d.tipoMotivoOtro, 120);
  if (tipoMotivo === "Otro" && !tipoMotivoOtro) throw new Error("En «Otro» escribe cuál es el tipo de motivo.");
  const s = String(d.sexo || "").trim().toUpperCase().charAt(0);
  const g = parseInt(d.grado, 10);
  return {
    fecha: d.fecha,
    expediente: expediente, expedienteNumero: expediente === "no" ? "" : expedienteNumero,
    canalizacion: canalizacion, canalizacionDestino: canalizacion === "no" ? "" : corto(d.canalizacionDestino, 200),
    alumnoNombre: nombre, grado: [1, 2, 3].includes(g) ? g : 0, grupo: corto(d.grupo, 2).toUpperCase(), sexo: s === "H" || s === "M" ? s : "",
    primerContacto: primerContacto, canalizadoPor: corto(d.canalizadoPor, 80),
    tipoMotivo: tipoMotivo, tipoMotivoOtro: tipoMotivo === "Otro" ? tipoMotivoOtro : "",
    motivo: corto(d.motivo, 3000), descripcion: corto(d.descripcion, 3000), acciones: corto(d.acciones, 3000), acuerdos: corto(d.acuerdos, 3000),
    autorizacion: unoDe(d.autorizacion, ["si", "no", "na"]), autorizacionFecha: esFecha(d.autorizacionFecha) ? d.autorizacionFecha : "", autorizacionNombre: corto(d.autorizacionNombre, 120),
    anulado: !!d.anulado, motivoAnulacion: corto(d.motivoAnulacion, 200)
  };
}
export function reporteDeRegistroPsi(id, datos, opciones) {
  const o = opciones || {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new Error("El registro no tiene un identificador válido.");
  const reg = limpiarRegistroPsi(datos, !!(datos && datos.anulado));        // quitar un registro viejo no exige la hoja completa
  const hoy = o.ahora || new Date();
  const psicologo = corto(o.psicologo, 120);
  return {
    rid: "psi-" + id,
    rev: hoy.getTime(),
    rol: "psicologia",
    tipo: TIPO_REPORTE_PSI,
    fecha: reg.fecha,
    resumen: "Psicología · " + (psicologo || "psicología") + " · " + reg.fecha + " · " + reg.alumnoNombre + (reg.anulado ? " (quitado)" : ""),
    campos: [["Psicología", psicologo || "(sin nombre)"], ["Fecha", reg.fecha], ["Alumno/a", reg.alumnoNombre]],
    datos: { id: id, psicologo: psicologo, registro: reg }
  };
}

// ---------- respaldo del historial (de la dirección al aparato nuevo) ----------
// `registros`: [{ id, rev, folio?, registro }] (registro ya limpio). Se parte en mensajes que caben en el buzón.
const esFolio = function (f) { return typeof f === "string" && /^PSI-\d{1,6}$/.test(f); };
export function mensajesHistorialPsi(registros, ahora) {
  const hoy = ahora || new Date(), lote = hoy.getTime();
  const partes = []; let actual = [], peso = 0;
  (registros || []).forEach(function (r) {
    let registro;
    try { registro = limpiarRegistroPsi(r.registro, true); } catch (e) { return; }      // un registro viejo con datos raros no debe tirar todo el respaldo: se omite
    const item = { id: r.id, rev: r.rev || 0, folio: esFolio(r.folio) ? r.folio : "", registro: registro };
    const n = JSON.stringify(item).length;
    if (actual.length && peso + n > TROZO_RESPALDO) { partes.push(actual); actual = []; peso = 0; }
    actual.push(item); peso += n;
  });
  if (actual.length) partes.push(actual);
  return partes.map(function (reps, i) {
    return { rid: "psi-historial-" + lote + "-" + (i + 1), rev: lote, rol: "sistema", tipo: TIPO_RESPALDO_PSI, fecha: hoy.toISOString().slice(0, 10),
      resumen: "Respaldo del historial de Psicología (" + (i + 1) + " de " + partes.length + ")", campos: [],
      datos: { parte: i + 1, de: partes.length, registros: reps } };
  });
}
// Mezcla un mensaje de respaldo con el historial del aparato: gana el registro con `rev` más nuevo.
export function aplicarHistorialPsi(historial, carga) {
  const h = Object.assign({}, historial || {});
  let nuevos = 0;
  if (!carga || carga.tipo !== TIPO_RESPALDO_PSI || !carga.datos || !Array.isArray(carga.datos.registros)) return { historial: h, nuevos: 0 };
  carga.datos.registros.forEach(function (r) {
    if (!r || !/^[A-Za-z0-9_-]{3,80}$/.test(r.id || "")) return;
    const previo = h[r.id];
    if (previo && (previo.rev || 0) >= (r.rev || 0)) return;
    let registro; try { registro = limpiarRegistroPsi(r.registro, true); } catch (e) { return; }
    h[r.id] = { id: r.id, rev: r.rev || 0, folio: esFolio(r.folio) ? r.folio : ((previo && previo.folio) || ""), registro: registro };
    nuevos++;
  });
  return { historial: h, nuevos: nuevos };
}
// Lo que hace el aparato al guardar un registro propio en su historial (conserva el folio si ya lo conocía).
export function guardarEnHistorialPsi(historial, carga) {
  const h = Object.assign({}, historial || {});
  if (!carga || carga.tipo !== TIPO_REPORTE_PSI || !carga.datos) return h;
  const previo = h[carga.datos.id];
  h[carga.datos.id] = { id: carga.datos.id, rev: carga.rev, folio: (previo && previo.folio) || "", registro: carga.datos.registro };
  return h;
}
