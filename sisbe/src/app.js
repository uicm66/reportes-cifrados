// ═════════════════════════════════════════════════
//  PÁGINA DE LOS DOCTORES SISBE — buzón cifrado, sin Firebase actual y sin WhatsApp (2026-10-30)
//
//  Es el MISMO formulario de consulta que usan hoy los doctores. Lo que cambió por dentro:
//   1. Entran con correo y contraseña que se comprueban EN ESTE APARATO (el perfil lo manda la dirección, firmado).
//   2. El buscador de alumnos usa la lista que manda la dirección (solo nombre, grado y grupo).
//   3. «Guardar y enviar» cifra la consulta SOLO para la dirección. Si no hay internet queda en una cola y se reenvía sola.
//   4. NO hay historial: una vez enviada, la consulta ya no se muestra ni se guarda aquí.
//  Funciona igual en celular y en computadora (cada aparato se autoriza por separado).
// ═════════════════════════════════════════════════
import * as Buzon from "./buzon-sisbe.js";
import { reporteDeConsulta } from "../../src/rol-sisbe.js";

const VERSION_SISBE = "sisbe-v1 (2026-10-30)";   // igual que CACHE en sw.js
if ("serviceWorker" in navigator && (location.protocol === "https:" || new URLSearchParams(location.search).get("sw") === "1")) {
  navigator.serviceWorker.register("sw.js").catch(function () { /* sin modo sin conexión */ });
}

const $ = function (id) { return document.getElementById(id); };
const norm = function (t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
function hoyISO() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function horaAhora() { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

function sesion() { try { const t = localStorage.getItem("sb-sesion"); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

// ── avisos ──────────────────────────────────────────────────────────────────
function aviso(texto, tipo) {
  const prev = $("aviso"); if (prev) prev.remove();
  const d = document.createElement("div");
  d.id = "aviso"; d.setAttribute("role", "status");
  d.style.background = tipo === "ok" ? "#dcfce7" : tipo === "mal" ? "#fee2e2" : "#fef3c7";
  d.style.color = tipo === "ok" ? "#166534" : tipo === "mal" ? "#991b1b" : "#92400e";
  d.textContent = texto;
  document.body.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.remove(); }, tipo === "ok" ? 3500 : 9000);
}
async function pintarPendientes() {
  const n = await Buzon.pendientesDeEnviar().catch(function () { return 0; });
  const el = $("pendientes");
  el.textContent = n ? "⏳ " + n + " por enviar" : "";
  el.style.display = n ? "inline-block" : "none";
}
function avisoEnvio(r) {
  if (r && r.pendientes) aviso("Guardado en este aparato. Se enviará a la dirección cuando haya internet (" + r.pendientes + " por enviar).", "alerta");
  else aviso("✓ Enviado a la dirección", "ok");
  pintarPendientes();
}

// ── pantallas ───────────────────────────────────────────────────────────────
function mostrar(id) {
  ["login-screen", "alta-screen", "bloqueado-screen", "app-screen"].forEach(function (s) { $(s).style.display = "none"; });
  $(id).style.display = id === "app-screen" ? "block" : "flex";
}
function mostrarAlta(estado, error) {
  mostrar("alta-screen");
  $("alta-error").textContent = error || ""; $("alta-error").style.display = error ? "block" : "none";
  if (estado === "sin-enlace") {
    $("alta-titulo").textContent = "Falta tu enlace de acceso";
    $("alta-texto").textContent = "Abre en este aparato el enlace que te dio la dirección. Solo se hace una vez por aparato (celular o computadora).";
    $("btn-alta-revisar").style.display = "none";
  } else {
    $("alta-titulo").textContent = "Solicitud enviada";
    $("alta-texto").textContent = "Esperando a que la dirección apruebe este aparato. En cuanto lo haga podrás entrar con tu correo y contraseña. Esta pantalla se actualiza sola.";
    $("btn-alta-revisar").style.display = "";
  }
}
function aplicarEscuela() {
  const e = (Buzon.catalogo().escuela) || {};
  if (e.nombre) { document.title = "SISBE · " + (e.siglas || e.nombre); $("escuela-label").textContent = e.nombre; }
}
let appIniciada = false;
function entrar() {
  const p = Buzon.perfil();
  aplicarEscuela();
  $("usuario-label").textContent = p.nombre;
  mostrar("app-screen");
  if (!appIniciada) { appIniciada = true; limpiarForm(); }
  pintarPendientes(); pintarEstadoLista();
}
async function decidir() {
  const est = Buzon.estadoPantalla();
  if (est !== "listo") { mostrarAlta(est); return; }
  const p = Buzon.perfil();
  if (p.bloqueado) { mostrar("bloqueado-screen"); return; }
  const s = sesion();
  if (s && s.email === p.correo) entrar(); else { aplicarEscuela(); mostrar("login-screen"); }
}
async function perfilCambio() {
  const p = Buzon.perfil();
  if (p.bloqueado) { location.reload(); return; }
  if ($("app-screen").style.display !== "none") {
    $("usuario-label").textContent = p.nombre;
    pintarEstadoLista();
    aviso("La dirección actualizó tu perfil o la lista de alumnos.", "ok");
  }
}
async function ciclo(manual) {
  const antes = Buzon.estadoPantalla();
  const r = await Buzon.sincronizar().catch(function (e) { return { error: e.message, conexion: false }; });
  if (antes !== "listo" && Buzon.estadoPantalla() === "listo") { await decidir(); return; }
  if (r.perfilNuevo) await perfilCambio();
  pintarPendientes();
  if (manual) {
    $("alta-error").textContent = r.conexion === false ? "No hay conexión con la dirección. Revisa tu internet." : (r.error || "");
    $("alta-error").style.display = $("alta-error").textContent ? "block" : "none";
  }
}

// ── acceso ──────────────────────────────────────────────────────────────────
function errorLogin(m) { const e = $("login-error"); e.textContent = m; e.style.display = "block"; }
async function ingresar() {
  const email = $("login-email").value.trim(), pass = $("login-pass").value;
  if (!email || !pass) return;
  const b = $("login-btn"); b.disabled = true; b.textContent = "Entrando...";
  $("login-error").style.display = "none";
  try {
    const r = await Buzon.ingresar(email, pass);
    if (!r.ok) { errorLogin(r.motivo); }
    else {
      localStorage.setItem("sb-sesion", JSON.stringify({ email: Buzon.perfil().correo, ts: Date.now() }));
      $("login-pass").value = "";
      entrar();
    }
  } catch (e) { errorLogin("Error: " + e.message); }
  b.disabled = false; b.textContent = "Entrar";
}
$("login-btn").addEventListener("click", ingresar);
$("login-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") ingresar(); });
$("btn-logout").addEventListener("click", function () { localStorage.removeItem("sb-sesion"); location.reload(); });
$("btn-alta-revisar").addEventListener("click", function () { $("alta-error").textContent = "Revisando…"; $("alta-error").style.display = "block"; ciclo(true); });

// ── buscador de alumnos (lista que manda la dirección: nombre, grado y grupo) ─
function alumnos() { return Buzon.catalogo().alumnos || []; }
function pintarEstadoLista() {
  const n = alumnos().length;
  $("dir-estado").textContent = n ? "Lista de alumnos: " + n + " alumnos." : "⚠ La dirección todavía no te manda la lista de alumnos. Escribe el nombre a mano.";
}
function mostrarSeleccion(nombre, grado, grupo) {
  const conf = $("f-sel-conf");
  if (nombre) {
    conf.textContent = "Seleccionado: " + nombre + (grado || grupo ? " · " + (grado || "") + "° " + (grupo || "") : "");
    conf.style.display = "block"; $("fila-manual").style.display = "none"; $("f-manual-ayuda").style.display = "none";
  } else { conf.style.display = "none"; $("f-manual-ayuda").style.display = "block"; }
}
$("f-manual-link").addEventListener("click", function (e) { e.preventDefault(); $("fila-manual").style.display = "grid"; $("f-nombre").focus(); });
$("f-buscar").addEventListener("input", function () {
  const q = norm($("f-buscar").value), sug = $("sug");
  mostrarSeleccion("");
  $("f-nombre").value = ""; $("f-grado").value = ""; $("f-grupo").value = "";
  sug.textContent = "";
  if (q.length < 2) { sug.style.display = "none"; return; }
  const toks = q.split(/\s+/), lista = alumnos();
  const res = lista.filter(function (a) {
    const nom = norm(a.nombre), pal = nom.split(/\s+/);
    return toks.every(function (t) { return pal.some(function (w) { return w.indexOf(t) === 0; }) || (t.length >= 3 && nom.indexOf(t) !== -1); });
  }).slice(0, 12);
  if (!res.length) { sug.style.display = "none"; $("fila-manual").style.display = "grid"; return; }
  res.forEach(function (a) {
    const d = document.createElement("div");
    const b = document.createElement("b"); b.textContent = a.nombre;
    const s = document.createElement("span"); s.style.cssText = "color:#6b7280;font-size:11px"; s.textContent = " " + (a.grado || "") + "° " + (a.grupo || "");
    d.appendChild(b); d.appendChild(s);
    d.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      $("f-nombre").value = a.nombre || ""; $("f-grado").value = String(a.grado || ""); $("f-grupo").value = String(a.grupo || "").toUpperCase();
      $("f-buscar").value = a.nombre || "";
      sug.style.display = "none";
      mostrarSeleccion(a.nombre || "", a.grado || "", a.grupo || "");
    });
    sug.appendChild(d);
  });
  sug.style.display = "block";
});
document.addEventListener("click", function (e) { if (!e.target.closest("#sug") && e.target.id !== "f-buscar") $("sug").style.display = "none"; });

// ── formulario ──────────────────────────────────────────────────────────────
const CAMPOS = { fecha: "f-fecha", hora: "f-hora", alumnoNombre: "f-nombre", grado: "f-grado", grupo: "f-grupo",
  canalizadoPor: "f-canaliza", avisoPadre: "f-aviso",
  motivo: "f-motivo", ta: "f-ta", fc: "f-fc", fr: "f-fr", temp: "f-temp", peso: "f-peso", talla: "f-talla",
  diagnostico: "f-diag", conducta: "f-conducta", refiere: "f-refiere", unidadMedica: "f-unidad" };
const IDS_INFORMO = ["f-informo-ts", "f-informo-pf", "f-informo-dir"];
function mostrarUnidad() { $("f-unidad-caja").style.display = $("f-refiere").value === "si" ? "block" : "none"; }
$("f-refiere").addEventListener("change", mostrarUnidad);
function limpiarForm() {
  window._idIntento = null;
  Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = ""; });
  IDS_INFORMO.forEach(function (id) { $(id).checked = false; });
  $("f-buscar").value = ""; $("f-fecha").value = hoyISO(); $("f-hora").value = horaAhora(); $("f-refiere").value = "no";
  $("msg-form").textContent = "";
  mostrarUnidad(); mostrarSeleccion(""); $("fila-manual").style.display = "none"; $("sug").style.display = "none";
}
$("btn-limpiar").addEventListener("click", limpiarForm);

$("btn-guardar").addEventListener("click", async function () {
  const datos = {};
  Object.keys(CAMPOS).forEach(function (k) { datos[k] = String($(CAMPOS[k]).value || "").trim(); });
  datos.informadoA = IDS_INFORMO.map($).filter(function (el) { return el.checked; }).map(function (el) { return el.value; });
  const msg = $("msg-form");
  if (!datos.fecha || !datos.alumnoNombre) { msg.style.color = "#b91c1c"; msg.textContent = "Faltan la fecha y el nombre del alumno/a."; return; }
  const btn = $("btn-guardar");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    // identificador fijo por intento: si algo falla y se reintenta, la dirección recibe la MISMA consulta (no se duplica)
    const id = window._idIntento || (window._idIntento = "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const carga = reporteDeConsulta(id, datos, { doctor: Buzon.perfil().nombre });
    const r = await Buzon.encolar(carga);
    limpiarForm();
    avisoEnvio(r);
  } catch (e) { msg.style.color = "#b91c1c"; msg.textContent = "No se pudo preparar la consulta: " + e.message; }
  btn.disabled = false;
});

// ── arranque: prepara el buzón, decide la pantalla y se mantiene al día cada 30 segundos ──
(async function () {
  let av = "";
  try { const r0 = await Buzon.iniciar(); av = r0.aviso || ""; } catch (e) { av = e.message; }
  $("version").textContent = "Versión " + VERSION_SISBE;
  await decidir();
  if (av && Buzon.estadoPantalla() !== "listo") { $("alta-error").textContent = av; $("alta-error").style.display = "block"; }
  ciclo(false);
  setInterval(function () { ciclo(false); }, 30000);
  window.addEventListener("online", function () { ciclo(false); });
})();
