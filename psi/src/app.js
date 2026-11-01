// ═════════════════════════════════════════════════
//  PÁGINA DE PSICOLOGÍA — buzón cifrado, sin Firebase actual y sin WhatsApp (2026-10-31)
//
//  Es el mismo trabajo que hace hoy el psicólogo en la app en línea (registro diario de atención y bitácora). Lo que cambió por dentro:
//   1. Entra con correo y contraseña que se comprueban EN ESTE APARATO (el perfil lo manda la dirección, firmado).
//   2. El buscador usa la lista que manda la dirección (solo nombre, grado, grupo y sexo).
//   3. «Guardar y enviar» cifra el registro SOLO para la dirección. Si no hay internet queda en una cola y se reenvía sola.
//   4. SÍ hay historial: se guarda en este aparato cifrado con una llave que solo se abre con su PIN.
//      Si cambia de celular o computadora, la dirección le devuelve el respaldo de su historial.
//  Funciona en celular y en computadora (cada aparato se autoriza por separado, máximo 4).
//  El folio (PSI-001…) lo pone la dirección al recibir el registro; aquí aparece cuando el aparato recupera su respaldo.
// ═════════════════════════════════════════════════
import * as Buzon from "./buzon-psi.js";
import { reporteDeRegistroPsi, PRIMER_CONTACTO, CANALIZADO_POR, TIPOS_MOTIVO, TIPOS_ANTERIORES } from "../../src/rol-psicologia.js";

const VERSION_PSI = "psi-v1 (2026-10-31)";   // igual que CACHE en sw.js
if ("serviceWorker" in navigator && (location.protocol === "https:" || new URLSearchParams(location.search).get("sw") === "1")) {
  navigator.serviceWorker.register("sw.js").catch(function () { /* sin modo sin conexión */ });
}

const $ = function (id) { return document.getElementById(id); };
const norm = function (t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
function pad(n) { return String(n).padStart(2, "0"); }
function isoDe(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function hoyISO() { return isoDe(new Date()); }
function fechaBonita(f) { const p = String(f || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : f; }
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function diaLargo(f) { const p = String(f || "").split("-"); if (p.length !== 3) return "Sin fecha"; const d = new Date(+p[0], +p[1] - 1, +p[2]); return DIAS[d.getDay()] + " " + d.getDate() + " de " + MESES[d.getMonth()] + " de " + d.getFullYear(); }

function sesion() { try { const t = localStorage.getItem("psi-sesion"); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

// Crea un elemento sin usar innerHTML (los textos del historial nunca se interpretan como HTML).
function el(tag, props, hijos) {
  const e = document.createElement(tag);
  Object.keys(props || {}).forEach(function (k) {
    if (k === "text") e.textContent = props[k];
    else if (k === "class") e.className = props[k];
    else if (k === "style") e.style.cssText = props[k];
    else e.setAttribute(k, props[k]);
  });
  (hijos || []).forEach(function (h) { if (h) e.appendChild(h); });
  return e;
}

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
  const e = $("pendientes");
  e.textContent = n ? "⏳ " + n + " por enviar" : "";
  e.style.display = n ? "inline-block" : "none";
}
function avisoEnvio(r) {
  if (r && r.pendientes) aviso("Guardado en este aparato. Se enviará a la dirección cuando haya internet (" + r.pendientes + " por enviar).", "alerta");
  else aviso("✓ Guardado y enviado a la dirección", "ok");
  pintarPendientes();
}

// ── pantallas ───────────────────────────────────────────────────────────────
function mostrar(id) {
  ["login-screen", "alta-screen", "bloqueado-screen", "pin-screen", "app-screen"].forEach(function (s) { $(s).style.display = "none"; });
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
  if (e.nombre) { document.title = "Psicología · " + (e.siglas || e.nombre); $("escuela-label").textContent = e.nombre; }
}

// PIN: protege el historial guardado en este aparato
let modoPin = "abrir";
async function irAPin() {
  const existe = await Buzon.bovedaExiste();
  modoPin = existe ? "abrir" : "crear";
  mostrar("pin-screen");
  $("pin-error").style.display = "none"; $("pin-1").value = ""; $("pin-2").value = "";
  $("pin-2").style.display = existe ? "none" : "block";
  if (existe) {
    $("pin-titulo").textContent = "Escribe tu PIN";
    $("pin-texto").textContent = "Abre tu bitácora guardada en este aparato.";
    $("pin-ayuda").textContent = "Si olvidaste tu PIN, pide al director que quite este aparato y lo vuelva a vincular: la dirección te devuelve tu historial.";
  } else {
    $("pin-titulo").textContent = "Crea tu PIN";
    $("pin-texto").textContent = "Tu historial se guarda cifrado en este aparato y solo se abre con este PIN (mínimo 6 caracteres). Te lo pedirá cada vez que abras la página.";
    $("pin-ayuda").textContent = "Cada aparato (celular, computadora) tiene su propio PIN.";
  }
  setTimeout(function () { $("pin-1").focus(); }, 50);
}
function errorPin(m) { const e = $("pin-error"); e.textContent = m; e.style.display = "block"; }
async function confirmarPin() {
  const p1 = $("pin-1").value;
  if (!p1) return;
  const b = $("pin-btn"); b.disabled = true;
  $("pin-error").style.display = "none";
  try {
    if (modoPin === "crear") {
      if (p1 !== $("pin-2").value) { errorPin("Los dos PIN no son iguales."); b.disabled = false; return; }
      await Buzon.crearPin(p1);
    } else await Buzon.abrirPin(p1);
    $("pin-1").value = ""; $("pin-2").value = "";
    entrar();
    ciclo(false);                       // por si ya hay un respaldo del historial esperando en el buzón
  } catch (e) { errorPin(e.message); }
  b.disabled = false;
}
$("pin-btn").addEventListener("click", confirmarPin);
$("pin-1").addEventListener("keydown", function (e) { if (e.key === "Enter") { if (modoPin === "crear") $("pin-2").focus(); else confirmarPin(); } });
$("pin-2").addEventListener("keydown", function (e) { if (e.key === "Enter") confirmarPin(); });
$("pin-salir").addEventListener("click", salir);

let appIniciada = false;
function entrar() {
  const p = Buzon.perfil();
  aplicarEscuela();
  $("usuario-label").textContent = p.nombre;
  mostrar("app-screen");
  if (!appIniciada) { appIniciada = true; limpiarForm(); $("l-desde").value = primerDiaMes(); $("l-hasta").value = ultimoDiaMes(); }
  cambiarTab(tabActual || "nuevo");
  pintarPendientes(); pintarEstadoLista();
}
async function decidir() {
  const est = Buzon.estadoPantalla();
  if (est !== "listo") { mostrarAlta(est); return; }
  const p = Buzon.perfil();
  if (p.bloqueado) { mostrar("bloqueado-screen"); return; }
  const s = sesion();
  if (s && s.email === p.correo) { if (Buzon.bovedaAbierta()) entrar(); else await irAPin(); }
  else { aplicarEscuela(); mostrar("login-screen"); }
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
  if (r.historialNuevo) { aviso("✓ Se recuperó tu historial desde la dirección.", "ok"); if ($("app-screen").style.display !== "none") pintar(); }
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
      localStorage.setItem("psi-sesion", JSON.stringify({ email: Buzon.perfil().correo, ts: Date.now() }));
      $("login-pass").value = "";
      await irAPin();
    }
  } catch (e) { errorLogin("Error: " + e.message); }
  b.disabled = false; b.textContent = "Entrar";
}
function salir() { Buzon.cerrarBoveda(); localStorage.removeItem("psi-sesion"); location.reload(); }
$("login-btn").addEventListener("click", ingresar);
$("login-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") ingresar(); });
$("btn-logout").addEventListener("click", salir);
$("btn-bloquear").addEventListener("click", bloquear);
$("btn-alta-revisar").addEventListener("click", function () { $("alta-error").textContent = "Revisando…"; $("alta-error").style.display = "block"; ciclo(true); });

function bloquear() {
  Buzon.cerrarBoveda();
  limpiarForm();
  ["l-lista"].forEach(function (i) { $(i).textContent = ""; });
  $("l-resumen").style.display = "none";
  irAPin();
}
// Se bloquea sola tras 10 minutos sin tocar nada (si no hay un registro a medias).
let ultimaActividad = Date.now();
["pointerdown", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, function () { ultimaActividad = Date.now(); }, { passive: true }); });
function formSucio() {
  return ["f-nombre", "f-motivo", "f-desc", "f-acciones", "f-acuerdos", "f-expnum"].some(function (i) { return $(i).value.trim(); });
}
setInterval(function () {
  if (Buzon.bovedaAbierta() && !formSucio() && Date.now() - ultimaActividad > 10 * 60 * 1000) bloquear();
}, 30000);

// ── datos ───────────────────────────────────────────────────────────────────
function alumnos() { return Buzon.catalogo().alumnos || []; }
function pintarEstadoLista() {
  const n = alumnos().length;
  $("dir-estado").textContent = n ? "Lista de alumnos: " + n + " alumnos." : "⚠ La dirección todavía no te manda la lista de alumnos. Mientras tanto escribe el nombre a mano.";
}
function todos() { try { return Buzon.historial(); } catch (e) { return []; } }
function primerDiaMes() { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01"; }
function ultimoDiaMes() { const d = new Date(); return isoDe(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function tipoTexto(r) { return r.tipoMotivo ? (r.tipoMotivo === "Otro" && r.tipoMotivoOtro ? "Otro: " + r.tipoMotivoOtro : r.tipoMotivo) : ""; }
function textoExp(r) {
  const n = r.expedienteNumero ? " No. " + r.expedienteNumero : "";
  return r.expediente === "ya" ? "Ya tenía expediente" + n : r.expediente === "abierto" ? "Se abrió expediente" + n : r.expediente === "no" ? "Sin expediente" : "—";
}
function textoCanal(r) {
  const d = r.canalizacionDestino ? ": " + r.canalizacionDestino : "";
  return r.canalizacion === "si" ? "Canalizado" + d : r.canalizacion === "por" ? "Por canalizar" + d : r.canalizacion === "no" ? "No canalizado" : "—";
}
function textoAuth(r) { return r.autorizacion === "si" ? "Sí" : r.autorizacion === "no" ? "No" : r.autorizacion === "na" ? "No aplica" : "—"; }
function sexoDe(r) {
  if (r.sexo === "H" || r.sexo === "M") return r.sexo;
  const a = alumnos().find(function (x) { return norm(x.nombre) === norm(r.alumnoNombre); });
  return a && (a.sexo === "H" || a.sexo === "M") ? a.sexo : "";
}

// ── pestañas ────────────────────────────────────────────────────────────────
let tabActual = "nuevo";
function cambiarTab(t) {
  tabActual = t;
  document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("activo", b.dataset.tab === t); });
  ["nuevo", "lista"].forEach(function (x) { $("t-" + x).style.display = x === t ? "block" : "none"; });
  pintar();
}
document.querySelectorAll(".tab").forEach(function (b) { b.addEventListener("click", function () { cambiarTab(b.dataset.tab); }); });
function pintar() { if (tabActual === "lista") pintarLista(todos()); }

// ── formulario: nuevo / editar registro ─────────────────────────────────────
const CAMPOS = { fecha: "f-fecha", expediente: "f-exp", expedienteNumero: "f-expnum", canalizacion: "f-canaliza", canalizacionDestino: "f-canaldest",
  alumnoNombre: "f-nombre", grado: "f-grado", grupo: "f-grupo", sexo: "f-sexo", primerContacto: "f-primero", canalizadoPor: "f-canal",
  tipoMotivo: "f-tipomot", tipoMotivoOtro: "f-tipomot-otro", motivo: "f-motivo", descripcion: "f-desc", acciones: "f-acciones", acuerdos: "f-acuerdos",
  autorizacion: "f-auth", autorizacionFecha: "f-authfecha", autorizacionNombre: "f-authnombre" };
let editId = null, idIntento = null;

function llenarSelect(id, opciones, vacio, grupos) {
  const s = $(id); s.textContent = "";
  s.appendChild(el("option", { value: "", text: vacio }));
  opciones.forEach(function (o) { s.appendChild(el("option", { text: o })); });
  if (grupos) {
    const g = el("optgroup", { label: "Tipos anteriores" });
    grupos.forEach(function (o) { g.appendChild(el("option", { text: o })); });
    s.appendChild(g);
  }
}
llenarSelect("f-primero", PRIMER_CONTACTO, "— Elegir —");
llenarSelect("f-canal", CANALIZADO_POR, "— Elegir —");
llenarSelect("f-tipomot", TIPOS_MOTIVO, "— Elegir —");
llenarSelect("l-tipo", TIPOS_MOTIVO, "Todos los tipos", TIPOS_ANTERIORES);
$("l-tipo").appendChild(el("option", { value: "__sin__", text: "Sin tipo" }));

function mostrarCajas() {
  const e = $("f-exp").value, c = $("f-canaliza").value;
  const num = e === "ya" || e === "abierto", dest = c === "si" || c === "por";
  $("f-expnum-caja").style.display = num ? "block" : "none";
  $("f-canaldest-caja").style.display = dest ? "block" : "none";
  $("fila-extra").style.display = num || dest ? "grid" : "none";
  $("f-tipomot-otro-caja").style.display = $("f-tipomot").value === "Otro" ? "block" : "none";
}
["f-exp", "f-canaliza", "f-tipomot"].forEach(function (id) { $(id).addEventListener("change", mostrarCajas); });

// Resumen de lo que ya hay del alumno en el historial de este aparato (cuántos registros, expediente y autorización)
function resumenAlumno(nombre) {
  const c = $("f-resumen-alumno"), n = norm(nombre);
  const prev = n ? todos().filter(function (i) { return !i.registro.anulado && norm(i.registro.alumnoNombre) === n && i.id !== editId; }) : [];
  if (!prev.length) { c.style.display = "none"; return; }
  const conAuth = prev.filter(function (i) { return i.registro.autorizacion === "si"; }).length;
  const exp = prev.map(function (i) { return i.registro.expedienteNumero; }).filter(Boolean).pop();
  c.textContent = "Ya tiene " + prev.length + " registro(s) en tu bitácora" + (exp ? " · expediente No. " + exp : "") + " · autorización firmada en " + conAuth + " de ellos.";
  c.style.display = "block";
}
$("f-nombre").addEventListener("change", function () { resumenAlumno($("f-nombre").value); });

function limpiarForm() {
  editId = null; idIntento = null;
  Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = ""; });
  $("f-buscar").value = ""; $("f-fecha").value = hoyISO();
  $("f-resumen-alumno").style.display = "none"; $("sug").style.display = "none";
  $("titulo-form").textContent = "Registro diario de atención";
  $("btn-guardar").textContent = "Guardar y enviar";
  $("msg-form").textContent = "";
  mostrarCajas();
}
$("btn-limpiar").addEventListener("click", limpiarForm);

$("f-buscar").addEventListener("input", function () {
  const q = norm($("f-buscar").value), sug = $("sug");
  sug.textContent = "";
  if (q.length < 2) { sug.style.display = "none"; return; }
  const toks = q.split(/\s+/);
  const res = alumnos().filter(function (a) {
    const nom = norm(a.nombre), pal = nom.split(/\s+/);
    return toks.every(function (t) { return pal.some(function (w) { return w.indexOf(t) === 0; }) || (t.length >= 3 && nom.indexOf(t) !== -1); });
  }).slice(0, 12);
  if (!res.length) { sug.style.display = "none"; return; }
  res.forEach(function (a) {
    const d = el("div", {}, [el("b", { text: a.nombre }), el("span", { style: "color:#6b7280;font-size:11px", text: " " + (a.grado || "") + "° " + (a.grupo || "") })]);
    d.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      $("f-nombre").value = a.nombre; $("f-grado").value = String(a.grado || ""); $("f-grupo").value = a.grupo || ""; $("f-sexo").value = a.sexo || "";
      $("f-buscar").value = a.nombre; sug.style.display = "none"; resumenAlumno(a.nombre);
    });
    sug.appendChild(d);
  });
  sug.style.display = "block";
});
document.addEventListener("click", function (e) { if (!e.target.closest("#sug") && e.target.id !== "f-buscar") $("sug").style.display = "none"; });

function datosForm() {
  const d = {};
  Object.keys(CAMPOS).forEach(function (k) { d[k] = String($(CAMPOS[k]).value || "").trim(); });
  return d;
}
async function enviarRegistro(id, datos, msgEl) {
  const carga = reporteDeRegistroPsi(id, datos, { psicologo: Buzon.perfil().nombre });
  const r = await Buzon.guardarReporte(carga);
  return r;
}
$("btn-guardar").addEventListener("click", async function () {
  const msg = $("msg-form"); msg.style.color = "#b91c1c"; msg.textContent = "";
  const btn = $("btn-guardar");
  if (btn.disabled) return;
  const datos = datosForm();
  btn.disabled = true;
  try {
    // identificador fijo por intento: si algo falla y se reintenta, se reemplaza el MISMO registro (no se duplica)
    const orig = editId ? todos().find(function (i) { return i.id === editId; }) : null;
    if (orig) datos.anulado = !!orig.registro.anulado;
    const id = editId || idIntento || (idIntento = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const era = editId;
    const r = await enviarRegistro(id, datos);
    limpiarForm();
    avisoEnvio(r);
    if (era) cambiarTab("lista");
  } catch (e) { msg.textContent = e.message; }
  btn.disabled = false;
});

function editar(item) {
  limpiarForm();
  editId = item.id;
  const r = item.registro;
  Object.keys(CAMPOS).forEach(function (k) { const e = $(CAMPOS[k]); if (e) e.value = r[k] == null ? "" : String(r[k]); });
  $("f-buscar").value = r.alumnoNombre || "";
  mostrarCajas(); resumenAlumno(r.alumnoNombre);
  $("titulo-form").textContent = "Editando registro" + (item.folio ? " " + item.folio : "");
  $("btn-guardar").textContent = "Guardar cambios";
  $("msg-form").style.color = "#92400e"; $("msg-form").textContent = "Corrige lo necesario y pulsa «Guardar cambios».";
  cambiarTab("nuevo");
  window.scrollTo(0, 0);
}
async function quitar(item, valor) {
  if (valor && !window.confirm("¿Quitar de la bitácora el registro de " + item.registro.alumnoNombre + " del " + fechaBonita(item.registro.fecha) + "? Se puede restaurar con «Ver quitados».")) return;
  try {
    const r = await enviarRegistro(item.id, Object.assign({}, item.registro, { anulado: valor, motivoAnulacion: valor ? "Quitado por Psicología" : "" }));
    pintar(); avisoEnvio(r);
  } catch (e) { aviso(e.message, "mal"); }
}

// ── bitácora ────────────────────────────────────────────────────────────────
function filtrar(hist, sinTipo) {
  const d = $("l-desde").value, h = $("l-hasta").value, q = norm($("l-texto").value), t = sinTipo ? "" : $("l-tipo").value, ver = $("l-quitados").checked;
  return hist.filter(function (i) {
    const r = i.registro;
    if (r.anulado && !ver) return false;
    if (d && r.fecha < d) return false;
    if (h && r.fecha > h) return false;
    if (q && norm(r.alumnoNombre + " " + (r.grado || "") + (r.grupo || "") + " " + (i.folio || "")).indexOf(q) === -1) return false;
    if (t && (t === "__sin__" ? !!r.tipoMotivo : r.tipoMotivo !== t)) return false;
    return true;
  });
}
function chip(texto, estilo) { return el("span", { class: "chip", style: estilo || "", text: texto }); }
function tarjeta(item) {
  const r = item.registro;
  const top = el("div", { class: "top" }, [
    el("span", { text: (item.folio || "Sin folio aún") + " · " + fechaBonita(r.fecha) }),
    r.anulado ? el("span", { class: "chip anul", text: "QUITADO" }) : null
  ]);
  const acc = el("div", { class: "acc no-imprimir" });
  const bVer = el("button", { class: "btn sec", text: "Editar" });
  bVer.addEventListener("click", function () { editar(item); });
  acc.appendChild(bVer);
  const bQ = el("button", { class: r.anulado ? "btn sec" : "btn pel", text: r.anulado ? "Restaurar" : "Quitar" });
  bQ.addEventListener("click", function () { quitar(item, !r.anulado); });
  acc.appendChild(bQ);
  return el("div", { class: "intv" + (r.anulado ? " anulada" : ""), style: "cursor:default" }, [
    top,
    el("div", { class: "asunto", text: r.alumnoNombre + " · " + (r.grado || "") + "° " + (r.grupo || "") }),
    el("div", { class: "fila-b", style: "display:flex;gap:6px;flex-wrap:wrap;margin:6px 0" }, [
      chip(textoExp(r), "background:#f3f4f6"), chip(textoCanal(r), "background:#fef3c7;color:#92400e"),
      r.tipoMotivo ? chip(tipoTexto(r), "background:#ede9fe;color:#5b21b6") : null,
      chip("Autorización: " + textoAuth(r), r.autorizacion === "si" ? "background:#dcfce7;color:#166534" : "")
    ]),
    r.primerContacto || r.canalizadoPor ? el("div", { class: "ayuda", text: "Primer contacto: " + (r.primerContacto || "—") + " · Lo envió: " + (r.canalizadoPor || "—") }) : null,
    r.motivo ? el("div", { class: "txt", text: r.motivo.length > 220 ? r.motivo.slice(0, 220) + "…" : r.motivo }) : null,
    r.descripcion ? el("div", { class: "txt", text: "Conductas: " + (r.descripcion.length > 220 ? r.descripcion.slice(0, 220) + "…" : r.descripcion) }) : null,
    r.acciones ? el("div", { class: "txt", text: "Acciones: " + (r.acciones.length > 220 ? r.acciones.slice(0, 220) + "…" : r.acciones) }) : null,
    r.acuerdos ? el("div", { class: "txt", text: "Acuerdos: " + (r.acuerdos.length > 220 ? r.acuerdos.slice(0, 220) + "…" : r.acuerdos) }) : null,
    acc
  ]);
}
function pintarResumen(hist) {
  const caja = $("l-resumen"), lista = filtrar(hist, true);
  if (!lista.length) { caja.style.display = "none"; return; }
  const mapa = {};
  lista.forEach(function (i) {
    const r = i.registro, t = r.tipoMotivo || "__sin__";
    const m = mapa[t] || (mapa[t] = { regs: 0, alumnos: {} });
    m.regs++;
    const al = m.alumnos[norm(r.alumnoNombre)] || (m.alumnos[norm(r.alumnoNombre)] = { sexo: "" });
    const s = sexoDe(r); if (s) al.sexo = s;
  });
  const claves = TIPOS_MOTIVO.concat(TIPOS_ANTERIORES.filter(function (t) { return mapa[t]; })).concat(mapa.__sin__ ? ["__sin__"] : []);
  caja.textContent = "";
  caja.appendChild(el("h2", { text: "Resumen por tipo de motivo" }));
  const tabla = el("table", { style: "min-width:360px" });
  tabla.appendChild(el("thead", {}, [el("tr", {}, ["Tipo", "Alumnos", "H", "M", "Reg."].map(function (t, i) { return el("th", { text: t, style: i ? "text-align:center" : "" }); }))]));
  const cuerpo = el("tbody", {});
  claves.forEach(function (t) {
    const m = mapa[t] || { regs: 0, alumnos: {} };
    const al = Object.keys(m.alumnos).map(function (k) { return m.alumnos[k]; });
    const h = al.filter(function (a) { return a.sexo === "H"; }).length, mu = al.filter(function (a) { return a.sexo === "M"; }).length;
    const tr = el("tr", { style: "cursor:pointer;" + ($("l-tipo").value === t ? "background:#ede9fe;font-weight:800" : (al.length ? "" : "color:#9ca3af")) },
      [el("td", { text: t === "__sin__" ? "Sin tipo" : t })].concat([al.length, h, mu, m.regs].map(function (n) { return el("td", { text: String(n), style: "text-align:center" }); })));
    tr.addEventListener("click", function () { $("l-tipo").value = $("l-tipo").value === t ? "" : t; pintar(); });
    cuerpo.appendChild(tr);
  });
  tabla.appendChild(cuerpo);
  caja.appendChild(el("div", { style: "overflow-x:auto" }, [tabla]));
  caja.appendChild(el("div", { class: "ayuda", text: "Alumnos distintos del periodo mostrado. Toca un tipo para filtrar." }));
  caja.style.display = "block";
}
function pintarLista(hist) {
  const cont = $("l-lista"), lista = filtrar(hist);
  const d = $("l-desde").value, h = $("l-hasta").value;
  $("l-conteo").textContent = "Mostrando: " + (!d && !h ? "todo" : d === h ? fechaBonita(d) : (d ? fechaBonita(d) : "inicio") + " al " + (h ? fechaBonita(h) : "hoy")) + " · " + lista.length + " registro(s)";
  pintarResumen(hist);
  cont.textContent = "";
  if (!lista.length) { cont.appendChild(el("div", { class: "vacio", text: hist.length ? "No hay registros en este periodo (usa «Todo» para ver todos)." : "Todavía no hay registros en tu bitácora." })); return; }
  lista.sort(function (a, b) { return String(b.registro.fecha).localeCompare(String(a.registro.fecha)) || (b.rev - a.rev); });
  let dia = null;
  lista.forEach(function (i) {
    if (i.registro.fecha !== dia) {
      dia = i.registro.fecha;
      const n = lista.filter(function (x) { return x.registro.fecha === dia; }).length;
      cont.appendChild(el("div", { class: "grp-cab", style: "background:#6d28d914;color:#5b21b6;border-left:5px solid #6d28d9" }, [el("span", { text: diaLargo(dia) }), el("span", { class: "n", text: n + " registro" + (n !== 1 ? "s" : "") })]));
    }
    cont.appendChild(tarjeta(i));
  });
}
["l-desde", "l-hasta", "l-tipo", "l-quitados"].forEach(function (id) { $(id).addEventListener("change", pintar); });
$("l-texto").addEventListener("input", pintar);
$("l-hoy").addEventListener("click", function () { $("l-desde").value = $("l-hasta").value = hoyISO(); pintar(); });
$("l-mes").addEventListener("click", function () { $("l-desde").value = primerDiaMes(); $("l-hasta").value = ultimoDiaMes(); pintar(); });
$("l-todo").addEventListener("click", function () { $("l-desde").value = $("l-hasta").value = ""; $("l-texto").value = ""; $("l-tipo").value = ""; pintar(); });
$("l-imprimir").addEventListener("click", function () { window.print(); });

// ── arranque: prepara el buzón, decide la pantalla y se mantiene al día cada 5 segundos ──
(async function () {
  let av = "";
  try { const r0 = await Buzon.iniciar(); av = r0.aviso || ""; } catch (e) { av = e.message; }
  $("version").textContent = "Versión " + VERSION_PSI;
  await decidir();
  if (av && Buzon.estadoPantalla() !== "listo") { $("alta-error").textContent = av; $("alta-error").style.display = "block"; }
  ciclo(false);
  let enCiclo = false;      // cada 5 s y solo con la pantalla a la vista; una vuelta lenta no se encima con la siguiente
  setInterval(async function () { if (document.hidden || enCiclo) return; enCiclo = true; try { await ciclo(false); } finally { enCiclo = false; } }, 5000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) ciclo(false); });
  window.addEventListener("online", function () { ciclo(false); });
})();
