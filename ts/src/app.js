// ═════════════════════════════════════════════════
//  PÁGINA DE TRABAJO SOCIAL — buzón cifrado, sin Firebase actual y sin WhatsApp (2026-10-31)
//
//  Es el mismo trabajo que hace hoy la trabajadora social (buscar alumno, expediente, nueva intervención, "En proceso",
//  reportes por periodo). Lo que cambió por dentro:
//   1. Entra con correo y contraseña que se comprueban EN ESTE APARATO (el perfil lo manda la dirección, firmado).
//   2. El buscador usa la lista que manda la dirección (solo nombre, grado y grupo; el alumno se identifica por un código opaco).
//   3. «Guardar y enviar» cifra el reporte SOLO para la dirección. Si no hay internet queda en una cola y se reenvía sola.
//   4. SÍ hay historial: se guarda en este aparato cifrado con una llave que solo se abre con su PIN.
//      Si cambia de celular o computadora, la dirección le devuelve el respaldo de su historial.
//  Funciona en celular y en computadora (cada aparato se autoriza por separado, máximo 4).
// ═════════════════════════════════════════════════
import * as Buzon from "./buzon-ts.js";
import { reporteDeIntervencionTS, TIPOS_INTERVENCION, ESTADOS_INTERVENCION } from "../../src/rol-trabajo-social.js";

const VERSION_TS = "ts-v3 (2026-11-03)";   // igual que CACHE en sw.js
if ("serviceWorker" in navigator && (location.protocol === "https:" || new URLSearchParams(location.search).get("sw") === "1")) {
  navigator.serviceWorker.register("sw.js").catch(function () { /* sin modo sin conexión */ });
}

const $ = function (id) { return document.getElementById(id); };
const norm = function (t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
function pad(n) { return String(n).padStart(2, "0"); }
function isoDe(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function hoyISO() { return isoDe(new Date()); }
function horaAhora() { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function fechaBonita(f) { const p = String(f || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : f; }

function sesion() { try { const t = localStorage.getItem("ts-sesion"); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

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
  if (e.nombre) { document.title = "Trabajo Social · " + (e.siglas || e.nombre); $("escuela-label").textContent = e.nombre; }
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
    $("pin-texto").textContent = "Abre tu historial de reportes guardado en este aparato.";
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
  if (!appIniciada) { appIniciada = true; $("p-fecha").value = hoyISO(); }
  cambiarTab(tabActual || "alumno");
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
      localStorage.setItem("ts-sesion", JSON.stringify({ email: Buzon.perfil().correo, ts: Date.now() }));
      $("login-pass").value = "";
      await irAPin();
    }
  } catch (e) { errorLogin("Error: " + e.message); }
  b.disabled = false; b.textContent = "Entrar";
}
function salir() { Buzon.cerrarBoveda(); localStorage.removeItem("ts-sesion"); location.reload(); }
$("login-btn").addEventListener("click", ingresar);
$("login-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") ingresar(); });
$("btn-logout").addEventListener("click", salir);
$("btn-bloquear").addEventListener("click", bloquear);
$("btn-alta-revisar").addEventListener("click", function () { $("alta-error").textContent = "Revisando…"; $("alta-error").style.display = "block"; ciclo(true); });

function bloquear() {
  cerrarModal();
  Buzon.cerrarBoveda();
  alumnoSel = null; $("expediente").style.display = "none"; $("a-buscar").value = "";
  ["p-lista", "x-lista"].forEach(function (i) { $(i).textContent = ""; });
  irAPin();
}
// Se bloquea sola tras 10 minutos sin tocar nada (si no hay una intervención a medias).
let ultimaActividad = Date.now();
["pointerdown", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, function () { ultimaActividad = Date.now(); }, { passive: true }); });
setInterval(function () {
  if (Buzon.bovedaAbierta() && $("modal").style.display !== "flex" && Date.now() - ultimaActividad > 10 * 60 * 1000) bloquear();
}, 30000);

// ── datos ───────────────────────────────────────────────────────────────────
function alumnos() { return Buzon.catalogo().alumnos || []; }
function pintarEstadoLista() {
  const n = alumnos().length;
  $("dir-estado").textContent = n ? "Lista de alumnos: " + n + " alumnos." : "⚠ La dirección todavía no te manda la lista de alumnos.";
}
function todos() { try { return Buzon.historial(); } catch (e) { return []; } }
function vigentes(lista) { return lista.filter(function (i) { return !i.registro.anulado; }); }
function alumnoDeAid(aid) { return alumnos().find(function (a) { return a.aid === aid; }); }

// ── pestañas ────────────────────────────────────────────────────────────────
let tabActual = "alumno", alumnoSel = null;
function cambiarTab(t) {
  tabActual = t;
  document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("activo", b.dataset.tab === t); });
  ["alumno", "periodo", "proceso"].forEach(function (x) { $("t-" + x).style.display = x === t ? "block" : "none"; });
  pintar();
}
document.querySelectorAll(".tab").forEach(function (b) { b.addEventListener("click", function () { cambiarTab(b.dataset.tab); }); });
function pintar() {
  const hist = todos();
  const n = vigentes(hist).filter(function (i) { return i.registro.estado === "En proceso"; }).length;
  $("n-proceso").textContent = n ? "(" + n + ")" : "";
  if (tabActual === "alumno") pintarExpediente(hist);
  else if (tabActual === "periodo") pintarPeriodo(hist);
  else pintarProceso(hist);
}

// tarjeta de una intervención
function claseEstado(e) { return e === "Resuelto" ? "res" : e === "Pendiente" ? "pend" : e === "Canalizado" ? "can" : "proc"; }
function tarjeta(item, conAlumno) {
  const r = item.registro;
  const top = el("div", { class: "top" }, [
    el("span", { text: fechaBonita(r.fecha) + (r.hora ? " · " + r.hora : "") + " · " + r.tipoIntervencion }),
    el("span", {}, [
      r.anulado ? el("span", { class: "chip anul", text: "ANULADA" }) : el("span", { class: "chip " + claseEstado(r.estado), text: r.estado }),
      r.cartaCompromiso && !r.anulado ? el("span", { class: "chip carta", text: " 📄 Carta compromiso", style: "margin-left:4px" }) : null
    ])
  ]);
  const t = el("div", { class: "intv" + (r.anulado ? " anulada" : "") }, [
    top,
    conAlumno ? el("div", { style: "font-size:12px;font-weight:700;color:#0f766e;margin-top:3px", text: r.alumnoNombre + " · " + (r.grado || "") + "° " + (r.grupo || "") }) : null,
    el("div", { class: "asunto", text: r.asunto }),
    r.descripcion ? el("div", { class: "txt", text: r.descripcion.length > 220 ? r.descripcion.slice(0, 220) + "…" : r.descripcion }) : null,
    r.fotos && r.fotos.length ? el("div", { class: "ayuda", text: "📷 " + r.fotos.length + " foto(s)" }) : null
  ]);
  t.addEventListener("click", function () { abrirModal(alumnoDeAid(item.aid) || { aid: item.aid, nombre: r.alumnoNombre, grado: r.grado, grupo: r.grupo }, item); });
  return t;
}
function llenar(contenedor, items, conAlumno, vacio) {
  contenedor.textContent = "";
  if (!items.length) { contenedor.appendChild(el("div", { class: "vacio", text: vacio })); return; }
  items.forEach(function (i) { contenedor.appendChild(tarjeta(i, conAlumno)); });
}

// ── buscar alumno / expediente ──────────────────────────────────────────────
$("a-buscar").addEventListener("input", function () {
  const q = norm($("a-buscar").value), sug = $("sug");
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
      alumnoSel = a; $("a-buscar").value = a.nombre; sug.style.display = "none"; pintar();
    });
    sug.appendChild(d);
  });
  sug.style.display = "block";
});
document.addEventListener("click", function (e) { if (!e.target.closest("#sug") && e.target.id !== "a-buscar") $("sug").style.display = "none"; });

function pintarExpediente(hist) {
  const caja = $("expediente");
  if (!alumnoSel) { caja.style.display = "none"; return; }
  const a = alumnoSel, suyos = hist.filter(function (i) { return i.aid === a.aid; }), vig = vigentes(suyos);
  const cartas = vig.filter(function (i) { return i.registro.cartaCompromiso; }).length;
  const proc = vig.filter(function (i) { return i.registro.estado === "En proceso"; }).length;
  caja.style.display = "block"; caja.textContent = "";
  const nueva = el("button", { class: "btn no-imprimir", text: "➕ Nueva intervención" });
  nueva.addEventListener("click", function () { abrirModal(a, null); });
  const imp = el("button", { class: "btn sec no-imprimir", text: "⬇ Imprimir expediente" });
  imp.addEventListener("click", function () { window.print(); });
  caja.appendChild(el("div", { class: "exp-cab" }, [
    el("div", {}, [
      el("h2", { text: a.nombre }),
      el("div", { class: "ayuda", text: (a.grado || "") + "° " + (a.grupo || "") + " · " + vig.length + " intervención(es) · " + proc + " en proceso · " + cartas + " carta(s) compromiso" })
    ]),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [nueva, imp])
  ]));
  const lista = el("div", {});
  caja.appendChild(lista);
  llenar(lista, suyos, false, "Este alumno todavía no tiene intervenciones en tu historial.");
}

// ── reportes por periodo ────────────────────────────────────────────────────
function pintarPeriodo(hist) {
  const modo = $("p-modo").value, f = $("p-fecha").value;
  $("p-fecha").style.display = modo === "dia" ? "" : "none";
  const hoy = hoyISO(), desde = new Date(); desde.setDate(desde.getDate() - 6);
  const items = hist.filter(function (i) {
    const fe = i.registro.fecha;
    if (modo === "dia") return fe === f;
    if (modo === "semana") return fe >= isoDe(desde) && fe <= hoy;
    if (modo === "mes") return fe.slice(0, 7) === hoy.slice(0, 7);
    return true;
  });
  llenar($("p-lista"), items, true, "No hay intervenciones en este periodo.");
}
$("p-modo").addEventListener("change", pintar);
$("p-fecha").addEventListener("change", pintar);
$("p-imprimir").addEventListener("click", function () { window.print(); });

// ── en proceso ──────────────────────────────────────────────────────────────
function pintarProceso(hist) {
  const items = vigentes(hist).filter(function (i) { return i.registro.estado === "En proceso"; })
    .sort(function (a, b) { return (a.registro.fecha + (a.registro.hora || "")).localeCompare(b.registro.fecha + (b.registro.hora || "")); });
  llenar($("x-lista"), items, true, "No hay intervenciones en proceso. 🎉");
}

// ── nueva / editar intervención ─────────────────────────────────────────────
let modalAlumno = null, modalItem = null, modalFotos = [], modalId = null;
function llenarSelect(id, opciones) { const s = $(id); s.textContent = ""; opciones.forEach(function (o) { s.appendChild(el("option", { text: o })); }); }
llenarSelect("m-tipo", TIPOS_INTERVENCION); llenarSelect("m-estado", ESTADOS_INTERVENCION);

function pintarFotosModal(editable) {
  const c = $("m-fotos"); c.textContent = "";
  const v = $("m-fotos-ver"); v.textContent = "";
  modalFotos.forEach(function (f, i) {
    if (editable) {
      const x = el("button", { text: "×", type: "button", "aria-label": "Quitar foto" });
      x.addEventListener("click", function () { modalFotos.splice(i, 1); pintarFotosModal(true); });
      c.appendChild(el("div", { class: "foto" }, [el("img", { src: f, alt: "Foto" }), x]));
    } else v.appendChild(el("img", { src: f, alt: "Foto" }));
  });
}
function abrirModal(alumno, item) {
  modalAlumno = alumno; modalItem = item;
  modalId = item ? item.id : "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // un reintento reemplaza, no duplica
  const r = item ? item.registro : null, anulada = !!(r && r.anulado);
  $("m-titulo").textContent = item ? (anulada ? "Intervención anulada" : "Editar intervención") : "Nueva intervención";
  $("m-alumno").textContent = alumno.nombre + " · " + (alumno.grado || "") + "° " + (alumno.grupo || "");
  $("m-tipo").value = r ? r.tipoIntervencion : "Entrevista con Tutor";
  $("m-estado").value = r ? r.estado : "En proceso";
  $("m-fecha").value = r ? r.fecha : hoyISO();
  $("m-hora").value = r ? r.hora : horaAhora();
  $("m-asunto").value = r ? r.asunto : ""; $("m-descripcion").value = r ? r.descripcion : ""; $("m-acuerdos").value = r ? r.acuerdos : "";
  $("m-carta").checked = !!(r && r.cartaCompromiso);
  modalFotos = r ? r.fotos.slice() : [];
  $("m-archivo").value = "";
  ["m-tipo", "m-estado", "m-fecha", "m-hora", "m-asunto", "m-descripcion", "m-acuerdos", "m-carta", "m-archivo"].forEach(function (i) { $(i).disabled = anulada; });
  $("m-fotos-caja").style.display = anulada ? "none" : "block";
  $("m-guardar").style.display = anulada ? "none" : "";
  $("m-anular").style.display = item && !anulada ? "" : "none";
  $("m-anulado").style.display = anulada ? "block" : "none";
  $("m-anulado").textContent = anulada ? "ANULADA" + (r.motivoAnulacion ? " — " + r.motivoAnulacion : "") : "";
  $("m-msg").textContent = "";
  pintarFotosModal(!anulada);
  $("modal").style.display = "flex";
  $("modal-card").scrollIntoView();
}
function cerrarModal() { $("modal").style.display = "none"; modalAlumno = null; modalItem = null; modalFotos = []; }
$("m-cerrar").addEventListener("click", cerrarModal);

// Reduce la foto en el aparato antes de guardarla (un documento del buzón no puede pasar de 1 MB).
const INTENTOS_FOTO = [[900, 0.6], [800, 0.5], [640, 0.45], [480, 0.4]];
const MAX_FOTO_REDUCIDA = 115000;
function reducirFoto(archivo) {
  return new Promise(function (ok, mal) {
    const url = URL.createObjectURL(archivo), img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      for (const par of INTENTOS_FOTO) {
        const esc = Math.min(1, par[0] / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * esc)); c.height = Math.max(1, Math.round(img.height * esc));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const d = c.toDataURL("image/jpeg", par[1]);
        if (d.length <= MAX_FOTO_REDUCIDA) return ok(d);
      }
      mal(new Error("La foto es demasiado grande para guardarla."));
    };
    img.onerror = function () { URL.revokeObjectURL(url); mal(new Error("No se pudo leer la foto.")); };
    img.src = url;
  });
}
$("m-archivo").addEventListener("change", async function () {
  const msg = $("m-msg"); msg.style.color = "#b91c1c"; msg.textContent = "";
  for (const f of Array.from($("m-archivo").files || [])) {
    if (modalFotos.length >= 4) { msg.textContent = "Máximo 4 fotos por intervención."; break; }
    try { modalFotos.push(await reducirFoto(f)); } catch (e) { msg.textContent = e.message; }
  }
  $("m-archivo").value = "";
  pintarFotosModal(true);
});

function datosModal(extra) {
  const a = modalAlumno;
  return Object.assign({
    aid: a.aid, alumnoNombre: a.nombre, grado: a.grado, grupo: a.grupo,
    tipoIntervencion: $("m-tipo").value, estado: $("m-estado").value, fecha: $("m-fecha").value, hora: $("m-hora").value,
    asunto: $("m-asunto").value, descripcion: $("m-descripcion").value, acuerdos: $("m-acuerdos").value,
    cartaCompromiso: $("m-carta").checked, fotos: modalFotos, anulado: false, motivoAnulacion: ""
  }, extra || {});
}
async function guardarModal(extra) {
  const msg = $("m-msg"); msg.style.color = "#b91c1c"; msg.textContent = "";
  const btn = $("m-guardar"), btn2 = $("m-anular");
  if (btn.disabled) return;
  btn.disabled = true; btn2.disabled = true;
  try {
    const carga = reporteDeIntervencionTS(modalId, datosModal(extra), { trabajador: Buzon.perfil().nombre });
    const r = await Buzon.guardarReporte(carga);
    const aid = modalAlumno.aid, alu = modalAlumno;
    cerrarModal();
    if (tabActual === "alumno" && !alumnoSel) alumnoSel = alu;
    pintar(); avisoEnvio(r);
    return aid;
  } catch (e) { msg.textContent = e.message; }
  finally { btn.disabled = false; btn2.disabled = false; }
}
$("m-guardar").addEventListener("click", function () { guardarModal(); });
$("m-anular").addEventListener("click", function () {
  const motivo = window.prompt("¿Por qué se anula esta intervención? (opcional)", "");
  if (motivo === null) return;
  guardarModal({ anulado: true, motivoAnulacion: motivo });
});

// ── arranque: prepara el buzón, decide la pantalla y se mantiene al día cada 30 segundos ──
(async function () {
  let av = "";
  try { const r0 = await Buzon.iniciar(); av = r0.aviso || ""; } catch (e) { av = e.message; }
  $("version").textContent = "Versión " + VERSION_TS;
  await decidir();
  if (av && Buzon.estadoPantalla() !== "listo") { $("alta-error").textContent = av; $("alta-error").style.display = "block"; }
  ciclo(false);
  let enCiclo = false;      // cada 5 s y solo con la pantalla a la vista; una vuelta lenta no se encima con la siguiente
  setInterval(async function () { if (document.hidden || enCiclo) return; enCiclo = true; try { await ciclo(false); } finally { enCiclo = false; } }, 5000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) ciclo(false); });
  window.addEventListener("online", function () { ciclo(false); });
})();
