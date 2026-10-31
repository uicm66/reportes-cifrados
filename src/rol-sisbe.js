// Rol SISBE (los doctores): módulo puro (navegador y Node), sin dependencias de la app.
//
// El doctor NO guarda historial (decisión del director, 2026-10-30): solo
//   - recibe de la dirección su perfil (nombre, correo, credencial, bloqueo) y el catálogo de ALUMNOS para el buscador,
//   - captura la consulta y la ENVÍA cifrada solo a la dirección.
// Del alumno solo viajan NOMBRE, GRADO y GRUPO (nada de CURP, teléfono, domicilio, tutor). El folio de cada consulta
// (SISBE-001…) lo pone la dirección al recibirla, porque el doctor no tiene historial para contarlas.

export const ROL_SISBE = "sisbe";
export const TIPO_PERFIL_SISBE = "perfil-sisbe";
export const TIPO_CONSULTA_SISBE = "sisbe";
const MAX_ALUMNOS = 3000;

const corto = function (t, n) { return String(t == null ? "" : t).trim().slice(0, n); };
const esFecha = function (f) { return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f); };

// Catálogo de alumnos para el buscador: SOLO { nombre, grado, grupo }.
export function limpiarCatalogoAlumnos(catalogo) {
  const c = catalogo || {};
  if (!Array.isArray(c.alumnos)) throw new Error("El catálogo no trae la lista de alumnos.");
  if (c.alumnos.length > MAX_ALUMNOS) throw new Error("El catálogo tiene demasiados alumnos.");
  const alumnos = c.alumnos.map(function (a) {
    const g = parseInt(a && a.grado, 10);
    return { nombre: corto(a && a.nombre, 120), grado: [1, 2, 3].includes(g) ? g : 0, grupo: corto(a && a.grupo, 2).toUpperCase() };
  }).filter(function (a) { return a.nombre; });
  const e = c.escuela || {};
  return { alumnos: alumnos, escuela: { nombre: corto(e.nombre, 160), siglas: corto(e.siglas, 40), cct: corto(e.cct, 20) } };
}

// Carga que se cifra (y se FIRMA con firmarPerfil de perfil-prefecto.js) para el aparato del doctor.
//   perfil: { nombre, credencial (de crearCredencial), bloqueado? }
export function mensajePerfilSisbe(perfil, catalogo, ahora) {
  const p = perfil || {};
  if (!corto(p.nombre, 120)) throw new Error("Falta el nombre del doctor.");
  if (!p.credencial || !p.credencial.correo || !p.credencial.hash) throw new Error("Falta el correo y la contraseña del doctor.");
  const hoy = ahora || new Date();
  return {
    rid: "perfil-sisbe-" + p.credencial.correo,
    rev: hoy.getTime(),
    rol: "sistema",
    tipo: TIPO_PERFIL_SISBE,
    fecha: hoy.toISOString().slice(0, 10),
    resumen: "Perfil y catálogo SISBE · " + corto(p.nombre, 120),
    campos: [],
    datos: {
      perfil: { nombre: corto(p.nombre, 120), correo: p.credencial.correo, credencial: p.credencial, bloqueado: !!p.bloqueado },
      catalogo: limpiarCatalogoAlumnos(catalogo)
    }
  };
}

// Lo que hace el aparato del doctor al recibir un perfil: se queda con el más reciente.
export function aplicarPerfilSisbe(estado, carga) {
  if (!carga || carga.tipo !== TIPO_PERFIL_SISBE || !carga.datos || !carga.datos.perfil) return { estado: estado || null, cambio: false };
  if (estado && (estado.rev || 0) >= (carga.rev || 0)) return { estado: estado, cambio: false };
  return { estado: { rev: carga.rev, perfil: carga.datos.perfil, catalogo: carga.datos.catalogo }, cambio: true };
}

// ---------- la consulta ----------
// Solo estos campos viajan (lista cerrada). `id` es el identificador estable de la consulta en el aparato del doctor
// (un reintento reemplaza, no duplica). `doctor` es el nombre que muestra el perfil.
const CAMPOS = ["fecha", "hora", "alumnoNombre", "grado", "grupo", "canalizadoPor", "avisoPadre", "motivo", "ta", "fc", "fr", "temp", "peso", "talla", "diagnostico", "conducta", "refiere", "unidadMedica"];
const LARGOS = { motivo: 300, diagnostico: 1000, conducta: 1000, unidadMedica: 160, alumnoNombre: 120 };
const INFORMADO = ["Trabajo Social", "Prefectura", "Dirección"];

export function reporteDeConsulta(id, datos, opciones) {
  const o = opciones || {}, d = datos || {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new Error("La consulta no tiene un identificador válido.");
  if (!esFecha(d.fecha) || !corto(d.alumnoNombre, 120)) throw new Error("Faltan la fecha y el nombre del alumno/a.");
  const reg = {};
  CAMPOS.forEach(function (k) { reg[k] = corto(d[k], LARGOS[k] || 60); });
  reg.informadoA = (Array.isArray(d.informadoA) ? d.informadoA : []).filter(function (x) { return INFORMADO.includes(x); });
  const hoy = o.ahora || new Date();
  const doctor = corto(o.doctor, 120);
  return {
    rid: "sisbe-" + id,
    rev: hoy.getTime(),                                    // una corrección reenviada reemplaza a la anterior
    rol: "sisbe",
    tipo: TIPO_CONSULTA_SISBE,
    fecha: reg.fecha,
    resumen: "SISBE · " + (doctor || "doctor") + " · " + reg.fecha + " · " + reg.alumnoNombre,
    campos: [["Doctor", doctor || "(sin nombre)"], ["Fecha", reg.fecha], ["Alumno/a", reg.alumnoNombre], ["Motivo", reg.motivo]],
    datos: { id: id, doctor: doctor, registro: reg }
  };
}
