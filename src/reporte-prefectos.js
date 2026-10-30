// Empaca lo que captura la página de Prefectos para mandarlo CIFRADO por el buzón (sin Firebase actual, sin WhatsApp).
// Son funciones puras (navegador y Node), sin dependencias: no tocan la página ni la base de nadie.
//
// Dos tipos de reporte (los dos que hoy llegan a la app FCP):
//   "docentes"   -> inasistencias y retardos de maestros. Paquete { v:1, p:prefecto, f:"AAAA-MM-DD", r:[registros] }
//                   (el mismo paquete que ya entiende el importador de la Mac: importarReportePrefectos.js)
//   "asistencia" -> cantidades de asistencia de alumnos por grupo (colección asistencia_diaria): { grado, fecha, grupos }
//
// El resultado es la "carga" que se cifra con cripto.sellar(): { rid, rev, rol, tipo, fecha, resumen, campos, datos }.
//   rid  = identificador estable: reenviar lo MISMO no duplica (la bóveda lo ve como "ya estaba").
//   rev  = versión: si el prefecto corrige y reenvía la asistencia de ese grado y día, reemplaza a la anterior.
export const ROL_PREFECTOS = "prefectos";

async function huella(texto) {
  const bytes = new TextEncoder().encode(texto);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h.subarray(0, 12), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
const esFecha = function (f) { return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f); };
const num = function (n) { const v = parseInt(n, 10); return isNaN(v) ? 0 : v; };
const lista = function (g) { return Array.isArray(g) ? g.filter(Boolean) : (g ? [g] : []); };

// ---------- inasistencias y retardos de maestros ----------
export async function reporteDeDocentes(paquete) {
  if (!paquete || paquete.v !== 1 || !esFecha(paquete.f) || !Array.isArray(paquete.r) || !paquete.r.length) {
    throw new Error("El reporte de docentes está incompleto (falta la fecha o los registros).");
  }
  const prefecto = String(paquete.p || "").trim();
  const campos = paquete.r.map(function (r, i) {
    const tipo = String(r.t || "inasistencia");
    const maestro = String(r.m || "(sin nombre)");
    if (tipo.indexOf("retardo") === 0) {
      return [(tipo === "retardo_paes" ? "Retardo PAES" : "Retardo") + " " + (i + 1),
        maestro + " — programada " + (r.hp || "?") + ", llegó " + (r.hl || "?") + " (" + num(r.min) + " min)" + (r.g ? " — grupo " + r.g : "")];
    }
    const gr = lista(r.g);
    return ["Inasistencia " + (i + 1), maestro + " — " + num(r.h) + " hora(s)" + (gr.length ? " — grupo(s): " + gr.join(", ") : "")];
  });
  return {
    rid: "pf-doc-" + await huella(JSON.stringify(paquete)),
    rev: 1,
    rol: ROL_PREFECTOS,
    tipo: "docentes",
    fecha: paquete.f,
    resumen: "Docentes · " + (prefecto || "prefecto") + " · " + paquete.f + " · " + paquete.r.length + " registro(s)",
    campos: [["Prefecto", prefecto || "(sin nombre)"], ["Fecha", paquete.f]].concat(campos),
    datos: paquete
  };
}

// "PF-…": el mismo código que decodifica el importador de la Mac, para reutilizarlo tal cual.
export function aCodigoPF(paquete) {
  const bytes = new TextEncoder().encode(JSON.stringify(paquete));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return "PF-" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- un REGISTRO de docente (inasistencia o retardo), editable ----------
// Es lo que usa la página nueva: cada registro viaja solo, con el MISMO identificador que tiene en el celular (p. ej. "PR-abc12"),
// así que si el prefecto lo corrige y lo reenvía (rev mayor), en la dirección REEMPLAZA al anterior en vez de duplicarse.
const nombreDe = function (r) { return String((r && (r.maestroNombre || r.maestro)) || "").trim(); };
function lineaDeRegistro(r) {
  const tipo = String(r.tipo || "inasistencia");
  const maestro = nombreDe(r) || "(sin nombre)";
  if (tipo.indexOf("retardo") === 0) {
    return [tipo === "retardo_paes" ? "Retardo PAES" : "Retardo",
      maestro + " — programada " + (r.horaProgramada || "?") + ", llegó " + (r.horaLlegada || "?") + " (" + num(r.minutosRetardo) + " min)" + (r.grupo ? " — grupo " + r.grupo : "")];
  }
  const gr = lista(r.grupos);
  return [(tipo === "inasistencia_paes" || tipo === "paes") ? "Inasistencia PAES" : "Inasistencia", maestro + " — " + num(r.horasNoTrabajadas) + " hora(s)" + (gr.length ? " — grupo(s): " + gr.join(", ") : "")];
}
export async function reporteDeRegistro(id, datos, opciones) {
  const o = opciones || {}, d = datos || {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new Error("El registro no tiene un identificador válido.");
  if (!o.eliminado && (!esFecha(d.fecha) || !nombreDe(d))) throw new Error("El registro está incompleto (falta la fecha o el maestro).");
  const hoy = o.ahora || new Date();
  const fecha = esFecha(d.fecha) ? d.fecha : hoy.toISOString().slice(0, 10);
  const prefecto = String(d.prefectoNombre || o.prefectoNombre || "").trim();
  const linea = o.eliminado ? ["Registro eliminado", "El prefecto eliminó este registro."] : lineaDeRegistro(d);
  return {
    rid: "pf-reg-" + id,
    rev: hoy.getTime(),                                   // una corrección o una eliminación posterior reemplaza a la anterior
    rol: ROL_PREFECTOS,
    tipo: "docente",
    fecha: fecha,
    resumen: (o.eliminado ? "Eliminado · " : "Docente · ") + (prefecto || "prefecto") + " · " + fecha + (o.eliminado ? "" : " · " + nombreDe(d)),
    campos: [["Prefecto", prefecto || "(sin nombre)"], ["Fecha", fecha], linea],
    datos: { id: id, eliminado: !!o.eliminado, prefectoNombre: prefecto, registro: o.eliminado ? null : Object.assign({}, d) }
  };
}

// ---------- asistencia diaria de alumnos (cantidades por grupo) ----------
// grupos: { "1A": { hA, mA, hI, mI, hJ, mJ }, ... }   (A = asistencia, I = inasistencia, J = justificadas; h = hombres, m = mujeres)
const COLUMNAS = ["hA", "mA", "hI", "mI", "hJ", "mJ"];
export async function reporteDeAsistencia(entrada, ahora) {
  const e = entrada || {};
  const grado = num(e.grado);
  if (![1, 2, 3].includes(grado) || !esFecha(e.fecha) || !e.grupos || typeof e.grupos !== "object" || !Object.keys(e.grupos).length) {
    throw new Error("La asistencia está incompleta (falta el grado, la fecha o los grupos).");
  }
  const grupos = {};
  Object.keys(e.grupos).sort().forEach(function (g) {
    const v = e.grupos[g] || {};
    grupos[g] = {};
    COLUMNAS.forEach(function (c) { grupos[g][c] = num(v[c]); });
  });
  const total = function (cols) {
    return Object.keys(grupos).reduce(function (s, g) { return s + cols.reduce(function (t, c) { return t + grupos[g][c]; }, 0); }, 0);
  };
  const campos = Object.keys(grupos).map(function (g) {
    const v = grupos[g];
    return ["Grupo " + g, "Asistencia H " + v.hA + " / M " + v.mA + " · Inasistencia H " + v.hI + " / M " + v.mI + " · Justificadas H " + v.hJ + " / M " + v.mJ];
  });
  campos.push(["Total del grado", "Asistencia " + total(["hA", "mA"]) + " · Inasistencia " + total(["hI", "mI"]) + " · Justificadas " + total(["hJ", "mJ"])]);
  const nombre = String(e.prefectoNombre || "").trim();
  return {
    rid: "pf-asist-" + grado + "-" + e.fecha,
    rev: (ahora || new Date()).getTime(),         // el reenvío del mismo grado y día reemplaza al anterior
    rol: ROL_PREFECTOS,
    tipo: "asistencia",
    fecha: e.fecha,
    resumen: "Asistencia de alumnos · " + grado + "° · " + e.fecha,
    campos: [["Prefecto", nombre || "(sin nombre)"], ["Grado", grado + "°"], ["Fecha", e.fecha]].concat(campos),
    datos: { grado: grado, fecha: e.fecha, prefectoNombre: nombre, grupos: grupos }
  };
}
