// ═════════════════════════════════════════════════
//  VERSIÓN CON BUZÓN CIFRADO — sin Firebase actual y sin WhatsApp (2026-10-28)
//
//  Es la MISMA página que usan los prefectos: los menús, los campos, los botones y los
//  textos quedaron IDÉNTICOS. Lo único que cambió por dentro:
//
//   1. El perfil (nombre, grado, contraseña) y la lista de maestros los manda la dirección,
//      cifrados y firmados por ella, y se guardan en este celular (ver buzon-prefecto.js).
//   2. Al dar "Enviar registro", el reporte se guarda aquí y se manda CIFRADO a la dirección.
//      Si no hay internet queda en una cola y se reenvía solo.
//
//  La página en línea de los prefectos (prefectos-fcp) NO se toca: sigue funcionando igual.
// ═════════════════════════════════════════════════
import {
  initializeApp, getFirestore, collection, getDocs, query, orderBy, where, doc,
  getDoc, updateDoc as _motorUpdateDoc, deleteDoc, setDoc as _motorSetDoc,
} from "./local-db/motorLocal.js";
import * as Buzon from "./buzon-prefecto.js";
import { reporteDeRegistro, reporteDeAsistencia } from "../../src/reporte-prefectos.js";

// ── Acceso y envío por el BUZÓN CIFRADO (sin Firebase actual y sin WhatsApp) ──────────────────────────────────
// Esta página es la misma de siempre. Por dentro cambió: (1) el perfil (nombre, grado, contraseña) y la lista de
// maestros los manda la dirección, cifrados y firmados, y se guardan en este celular; (2) lo que el prefecto registra
// se sigue guardando aquí y, además, se manda CIFRADO a la dirección. Si no hay internet queda en una cola y se reenvía.
const app = initializeApp();
const db = getFirestore(app);

function serverTimestamp() { return new Date().toISOString(); }

// La sesión se recuerda en este celular (como el acceso de antes): si ya entró, abre directo.
function _pfSesion() {
  try { var t = localStorage.getItem("pf-sesion"); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

// Aviso flotante (reemplaza al panel de WhatsApp): dice si el reporte salió o quedó en espera.
function _pfAviso(texto, tipo) {
  var prev = document.getElementById("pf-aviso"); if (prev) prev.remove();
  var d = document.createElement("div");
  d.id = "pf-aviso";
  d.setAttribute("role", "status");
  d.style.cssText = "position:fixed;left:10px;right:10px;bottom:12px;z-index:9999;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center;" +
    (tipo === "ok" ? "background:#e8f5e9;color:#1b5e20;" : tipo === "mal" ? "background:#ffebee;color:#b71c1c;" : "background:#fff8e1;color:#8a5a00;");
  d.textContent = texto;
  document.body.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.remove(); }, tipo === "ok" ? 3500 : 9000);
}
function _pfAvisoEnvio(r) {
  if (!r) return;
  if (r.pendientes) _pfAviso("Guardado en este celular. Se enviará a la dirección cuando haya internet (" + r.pendientes + " por enviar).", "alerta");
  else _pfAviso("✓ Enviado a la dirección", "ok");
}
async function _pfMandarCarga(preparar) {
  try { _pfAvisoEnvio(await Buzon.encolar(await preparar())); }
  catch (e) { _pfAviso("No se pudo preparar el reporte: " + e.message, "mal"); }
}

// Lo que se escribe en la base de ESTE celular se manda también, cifrado, a la dirección.
function _pfColeccion(ref) { return String((ref && ref.path) || "").split("/")[0]; }
async function setDoc(ref, datos, opciones) {
  await _motorSetDoc(ref, datos, opciones);
  if (_pfColeccion(ref) === "asistencia_diaria") {
    _pfMandarCarga(function () { return reporteDeAsistencia({ grado: datos.grado, fecha: datos.fecha, prefectoNombre: datos.prefectoNombre, grupos: datos.grupos }); });
  }
}
async function updateDoc(ref, cambios) {
  await _motorUpdateDoc(ref, cambios);
  if (_pfColeccion(ref) === "inasistencias_prefectos") {
    var s = await getDoc(ref);
    if (s.exists()) { var d = s.data(); _pfMandarCarga(function () { return reporteDeRegistro(ref.id, d); }); }
  }
}
async function addDoc(_ref, datos) {
  var id = "PR-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  await _motorSetDoc(doc(db, "inasistencias_prefectos", id), datos);
  _pfMandarCarga(function () { return reporteDeRegistro(id, datos); });
  return { id: id };
}

let prefectoActual = null;
let tipoRegistro = 'inasistencia';
let horasConGrupo = {}; // { 1: '1E', 3: '1E', 5: '1A' } - solo horas marcadas tienen entrada
const HORAS_PROGRAMADAS = ['07:00', '07:50', '08:40', '09:30', '10:40', '11:30', '12:20'];
let retardosEnCurso = {}; // { '07:00': { llegada: '07:13', grupo: '1A' } } - solo horas con llegada tienen entrada

// Modo sin conexión: se guarda el código de la página (nunca datos). Solo en https, o con ?sw=1 para probar en la computadora.
const VERSION_PREFECTOS = "prefectos-v4 (2026-10-30)";   // igual que CACHE en sw.js
if ('serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).get('sw') === '1')) {
  navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo sin conexión */ });
}

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function mostrarPantalla(id) {
  ['login-screen', 'bloqueado-screen', 'app-screen', 'alta-screen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = 'flex';
}

function mostrarAlta(estado, error) {
  mostrarPantalla('alta-screen');
  var t = document.getElementById('alta-titulo'), x = document.getElementById('alta-texto'), b = document.getElementById('btn-alta-revisar'), e = document.getElementById('alta-error');
  e.textContent = error || '';
  if (estado === 'sin-enlace') {
    t.textContent = 'Falta tu enlace de acceso';
    x.textContent = 'Abre en este celular el enlace que te dio la dirección. Solo se hace una vez.';
    b.style.display = 'none';
  } else {
    t.textContent = 'Solicitud enviada';
    x.textContent = 'Esperando a que la dirección apruebe este celular. En cuanto lo haga podrás entrar con tu correo y contraseña. Esta pantalla se actualiza sola.';
    b.style.display = '';
  }
}

let _pfAppIniciada = false;
function _pfAplicarCatalogo() {
  var cat = Buzon.catalogo(), e = cat.escuela || {};
  window.__pfGrupos = (e.grupos && e.grupos.length === 3) ? e.grupos : [6, 6, 6];   // cuántos grupos tiene cada grado
  if (e.nombre) {
    document.title = 'Prefectos · ' + (e.siglas || e.nombre);
    var s = document.getElementById('pf-escuela'); if (s) s.textContent = e.nombre;
    var h = document.getElementById('pf-encabezado'); if (h) h.textContent = ('PREFECTOS · ' + e.nombre).toUpperCase();
  }
}
// Rótulo fijo arriba: "PRIMER GRADO" / "SEGUNDO GRADO" / "TERCER GRADO" (o aviso si aún no tiene grado)
function _pfRotuloGrado(grado) {
  var el = document.getElementById('header-grado'); if (!el) return;
  var n = { 1: 'PRIMER GRADO', 2: 'SEGUNDO GRADO', 3: 'TERCER GRADO' }[parseInt(grado, 10)];
  el.textContent = n || 'SIN GRADO ASIGNADO';
}
function _pfEntrar() {
  var p = Buzon.perfil();
  _pfAplicarCatalogo();
  prefectoActual = { uid: p.correo, nombre: p.nombre, grado: p.grado, bloqueado: !!p.bloqueado };
  document.getElementById('header-nombre').textContent = p.nombre;
  _pfRotuloGrado(p.grado);
  mostrarPantalla('app-screen');
  if (!_pfAppIniciada) { _pfAppIniciada = true; iniciarApp(); }
}
async function _pfDecidir() {
  var est = Buzon.estadoPantalla();
  if (est !== 'listo') { mostrarAlta(est); return; }
  var p = Buzon.perfil();
  if (p.bloqueado) { mostrarPantalla('bloqueado-screen'); return; }
  var s = _pfSesion();
  if (s && s.email === p.correo) _pfEntrar(); else { _pfAplicarCatalogo(); mostrarPantalla('login-screen'); }
}
// Cuando la dirección cambia el grado, el catálogo o bloquea, llega solo y se aplica sin que el prefecto haga nada.
async function _pfPerfilCambio() {
  var p = Buzon.perfil();
  if (p.bloqueado) { location.reload(); return; }
  if (!prefectoActual) return;
  _pfAplicarCatalogo();
  prefectoActual.nombre = p.nombre; prefectoActual.grado = p.grado;
  document.getElementById('header-nombre').textContent = p.nombre;
  _pfRotuloGrado(p.grado);
  listaMaestros.length = 0;
  await cargarMaestros();
  renderHorasGrupoLista(); renderRetardoLista();
  _pfAviso('La dirección actualizó tu perfil o tu lista de maestros.', 'ok');
}
async function _pfCiclo(manual) {
  var antes = Buzon.estadoPantalla();
  var r = await Buzon.sincronizar().catch(function (e) { return { error: e.message, conexion: false }; });
  if (antes !== 'listo' && Buzon.estadoPantalla() === 'listo') { await _pfDecidir(); return; }
  if (r.perfilNuevo) await _pfPerfilCambio();
  if (manual) {
    var e = document.getElementById('alta-error');
    if (e) e.textContent = r.conexion === false ? 'No hay conexión con la dirección. Revisa tu internet.' : (r.error || '');
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Ingresa correo y contrasena.'; return; }
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  try {
    var r = await Buzon.ingresar(email, pass);
    if (!r.ok) { errEl.textContent = r.motivo; btn.disabled = false; btn.textContent = 'Entrar'; return; }
    localStorage.setItem('pf-sesion', JSON.stringify({ email: Buzon.perfil().correo, ts: Date.now() }));
    document.getElementById('login-password').value = '';
    btn.disabled = false; btn.textContent = 'Entrar';
    _pfEntrar();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('pf-sesion');
  location.reload();
});
document.getElementById('btn-alta-revisar').addEventListener('click', () => { document.getElementById('alta-error').textContent = 'Revisando…'; _pfCiclo(true); });

// Arranque: prepara el buzón, decide qué pantalla mostrar y se mantiene al día cada 30 segundos.
(async function () {
  var aviso = '';
  try { var r0 = await Buzon.iniciar(); aviso = r0.aviso || ''; } catch (e) { aviso = e.message; }
  var v = document.getElementById('pf-version'); if (v) v.textContent = 'Versión ' + VERSION_PREFECTOS;
  await _pfDecidir();
  if (aviso && Buzon.estadoPantalla() !== 'listo') document.getElementById('alta-error').textContent = aviso;
  _pfCiclo(false);
  setInterval(function () { _pfCiclo(false); }, 30000);
  window.addEventListener('online', function () { _pfCiclo(false); });
})();

// Grupos de la escuela (vienen en el enlace / el servidor): [n1, n2, n3] = cuántos grupos tiene cada grado. Sin dato: 6 por grado.
function _pfLetrasDe(grado) {
  const n = (window.__pfGrupos || [6, 6, 6])[(parseInt(grado, 10) || 1) - 1];
  return 'ABCDEFGHIJKL'.slice(0, n === undefined ? 6 : n).split('');
}
function _pfTodosLosGrupos() {
  return ['1', '2', '3'].reduce((todos, g) => todos.concat(_pfLetrasDe(g).map(l => g + l)), []);
}

function gruposDelGrado() {
  const grado = prefectoActual && prefectoActual.grado;
  // Versión local: si a la prefecta todavía no se le asignó un grado, se le
  // muestran TODOS los grupos (1A…3F) para que pueda reportar el que necesite.
  // (En la versión en línea el grado se le pone al crear su perfil, y ahí se
  // comporta igual que siempre: solo los grupos de su grado.)
  if (!grado) return _pfTodosLosGrupos();
  return _pfLetrasDe(grado).map(l => grado + l);
}

function renderHorasGrupoLista() {
  const cont = document.getElementById('horas-grupo-lista');
  if (!cont) return;
  const grupos = gruposDelGrado();
  let h = '';
  for (let i = 1; i <= 7; i++) {
    const marcada = Object.prototype.hasOwnProperty.call(horasConGrupo, i);
    h += '<div class="hg-row">';
    h += '<button type="button" class="hg-check' + (marcada ? ' marcada' : '') + '" data-hora="' + i + '">' + i + 'ª</button>';
    h += '<select class="hg-select" data-hora="' + i + '"' + (marcada ? '' : ' disabled') + '>';
    h += '<option value="">Elige grupo…</option>';
    grupos.forEach(g => {
      h += '<option value="' + g + '"' + (horasConGrupo[i] === g ? ' selected' : '') + '>' + g + '</option>';
    });
    h += '</select></div>';
  }
  cont.innerHTML = h;

  cont.querySelectorAll('.hg-check').forEach(btn => {
    btn.addEventListener('click', () => {
      const hora = parseInt(btn.dataset.hora);
      if (Object.prototype.hasOwnProperty.call(horasConGrupo, hora)) {
        delete horasConGrupo[hora];
      } else {
        horasConGrupo[hora] = '';
      }
      renderHorasGrupoLista();
      actualizarResumenInasistencia();
    });
  });
  cont.querySelectorAll('.hg-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const hora = parseInt(sel.dataset.hora);
      horasConGrupo[hora] = sel.value;
      actualizarResumenInasistencia();
    });
  });
}

function actualizarResumenInasistencia() {
  const wrap = document.getElementById('resumen-inasistencia');
  const lista = document.getElementById('resumen-grupos-lista');
  const countEl = document.getElementById('resumen-count');
  if (!wrap || !lista || !countEl) return;
  const porGrupo = {};
  Object.keys(horasConGrupo).forEach(h => {
    const g = horasConGrupo[h];
    if (!g) return;
    if (!porGrupo[g]) porGrupo[g] = [];
    porGrupo[g].push(parseInt(h));
  });
  const grupos = Object.keys(porGrupo);
  if (grupos.length === 0) { wrap.style.display = 'none'; lista.innerHTML = ''; return; }
  wrap.style.display = '';
  countEl.textContent = grupos.length;
  lista.innerHTML = grupos.map(g => {
    const horas = porGrupo[g].sort((a, b) => a - b).map(hh => hh + 'ª').join(', ');
    return '<div class="resumen-grupo-chip"><span>Grupo ' + g + '</span><span>' + (porGrupo[g].length > 1 ? 'horas ' : 'hora ') + horas + '</span></div>';
  }).join('');
}

function calcMinutosRetardo(horaProg, horaLleg) {
  const minProg = parseInt(horaProg.split(':')[0]) * 60 + parseInt(horaProg.split(':')[1]);
  const minLleg = parseInt(horaLleg.split(':')[0]) * 60 + parseInt(horaLleg.split(':')[1]);
  return minLleg - minProg;
}

function renderRetardoLista() {
  const cont = document.getElementById('retardo-lista');
  if (!cont) return;
  const grupos = gruposDelGrado();
  let h = '';
  HORAS_PROGRAMADAS.forEach(hp => {
    const entry = retardosEnCurso[hp];
    const activa = !!(entry && entry.llegada);
    h += '<div class="rt-row">';
    h += '<div class="rt-hora-fija' + (activa ? ' activa' : '') + '">' + hp + '</div>';
    h += '<input type="time" class="rt-llegada" data-hora-prog="' + hp + '" value="' + (entry ? entry.llegada || '' : '') + '">';
    h += '<select class="rt-select" data-hora-prog="' + hp + '"' + (activa ? '' : ' disabled') + '>';
    h += '<option value="">Grupo…</option>';
    grupos.forEach(g => {
      h += '<option value="' + g + '"' + (entry && entry.grupo === g ? ' selected' : '') + '>' + g + '</option>';
    });
    h += '</select></div>';
  });
  cont.innerHTML = h;

  cont.querySelectorAll('.rt-llegada').forEach(inp => {
    inp.addEventListener('change', () => {
      const hp = inp.dataset.horaProg;
      const val = inp.value;
      const row = inp.closest('.rt-row');
      const horaFija = row.querySelector('.rt-hora-fija');
      const select = row.querySelector('.rt-select');
      if (!val) {
        delete retardosEnCurso[hp];
        horaFija.classList.remove('activa');
        select.disabled = true;
      } else {
        if (!retardosEnCurso[hp]) retardosEnCurso[hp] = { llegada: '', grupo: '' };
        retardosEnCurso[hp].llegada = val;
        horaFija.classList.add('activa');
        select.disabled = false;
      }
      actualizarResumenRetardo();
    });
  });
  cont.querySelectorAll('.rt-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const hp = sel.dataset.horaProg;
      if (!retardosEnCurso[hp]) retardosEnCurso[hp] = { llegada: '', grupo: '' };
      retardosEnCurso[hp].grupo = sel.value;
      actualizarResumenRetardo();
    });
  });
}

function actualizarResumenRetardo() {
  const wrap = document.getElementById('resumen-retardo');
  const lista = document.getElementById('resumen-retardo-lista');
  const countEl = document.getElementById('resumen-retardo-count');
  if (!wrap || !lista || !countEl) return;
  const activos = Object.keys(retardosEnCurso).filter(hp => retardosEnCurso[hp].llegada);
  if (activos.length === 0) { wrap.style.display = 'none'; lista.innerHTML = ''; return; }
  wrap.style.display = '';
  countEl.textContent = activos.length;
  lista.innerHTML = activos.map(hp => {
    const e = retardosEnCurso[hp];
    const min = calcMinutosRetardo(hp, e.llegada);
    const minTxt = min > 0 ? (min + ' min tarde') : 'hora inválida';
    return '<div class="resumen-grupo-chip"><span>' + (e.grupo || 'sin grupo') + ' &middot; llegó ' + e.llegada + '</span><span>' + minTxt + '</span></div>';
  }).join('');
}

async function iniciarApp() {
  document.getElementById('input-fecha').value = hoy();
  renderHorasGrupoLista();
  renderRetardoLista();
  await cargarMaestros();

  // Toggle tipo
  document.querySelectorAll('.tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      tipoRegistro = btn.dataset.tipo;
      document.getElementById('campos-inasistencia').style.display = tipoRegistro === 'inasistencia' ? '' : 'none';
      document.getElementById('campos-retardo').style.display = tipoRegistro === 'retardo' ? '' : 'none';
      const bloqInaPaes = document.getElementById('paes-bloque-inasistencia');
      const bloqRetPaes = document.getElementById('paes-bloque-retardo');
      if (bloqInaPaes) bloqInaPaes.style.display = tipoRegistro === 'inasistencia' ? '' : 'none';
      if (bloqRetPaes) bloqRetPaes.style.display = tipoRegistro === 'retardo' ? '' : 'none';
    });
  });

  document.getElementById('btn-enviar').addEventListener('click', enviarRegistro);
  cargarRegistrosHoy();
  iniciarBuscadorPaes();

  // Tabs principales
  document.querySelectorAll('.app-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.app-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('seccion-maestros').style.display = which === 'maestros' ? '' : 'none';
      document.getElementById('seccion-asistencia').style.display = which === 'asistencia' ? '' : 'none';
      if (which === 'asistencia') iniciarAsistencia();
    });
  });
}

let listaMaestros = [];
let maestroSeleccionado = false;

function quitarAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const ACADEMIAS_DOCENTES = ['ESPAÑOL', 'MATEMATICAS', 'CIENCIAS', 'SOCIALES', 'INGLES', 'EDUCACION FISICA', 'ARTES', 'TECNOLOGIA'];

async function cargarMaestros() {
  try {
    // La lista de maestros la manda la dirección, cifrada y firmada, y se guarda en este celular.
    const j = { maestros: Buzon.catalogo().maestros || [] };
    (j.maestros || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')).forEach(datos => {
      const academia = (datos.academia || '').toUpperCase();
      if (datos.nombre && ACADEMIAS_DOCENTES.includes(academia)) listaMaestros.push(datos.nombre);
    });
    iniciarBuscadorMaestro();
  } catch (e) {
    console.error('Error cargando maestros:', e);
  }
}

function iniciarBuscadorMaestro() {
  const inputTexto = document.getElementById('input-maestro');
  const inputHidden = document.getElementById('select-maestro');
  const lista = document.getElementById('lista-maestros');
  const btnLimpiar = document.getElementById('btn-limpiar-maestro');
  const contenedor = document.getElementById('buscador-maestro');

  inputTexto.addEventListener('input', function() {
    const texto = this.value.trim();
    if (maestroSeleccionado) {
      maestroSeleccionado = false;
      inputHidden.value = '';
      contenedor.classList.remove('seleccionado');
      btnLimpiar.style.display = 'none';
    }
    if (texto.length < 1) { lista.classList.remove('visible'); lista.innerHTML = ''; return; }
    const busqueda = quitarAcentos(texto);
    const coincidencias = listaMaestros.filter(n => quitarAcentos(n).includes(busqueda));
    lista.innerHTML = '';
    if (coincidencias.length === 0) {
      lista.innerHTML = '<div class="sin-resultados">Ning\u00fan maestro coincide</div>';
    } else {
      coincidencias.forEach(nombre => {
        const div = document.createElement('div');
        div.className = 'item-maestro';
        div.textContent = nombre;
        div.addEventListener('click', function() { seleccionarMaestro(nombre); });
        lista.appendChild(div);
      });
    }
    lista.classList.add('visible');
  });

  btnLimpiar.addEventListener('click', function() { limpiarBuscadorMaestro(); });

  document.addEventListener('click', function(e) {
    if (!contenedor.contains(e.target) && !lista.contains(e.target)) {
      lista.classList.remove('visible');
    }
  });
}

function seleccionarMaestro(nombre) {
  const inputTexto = document.getElementById('input-maestro');
  const inputHidden = document.getElementById('select-maestro');
  const lista = document.getElementById('lista-maestros');
  const btnLimpiar = document.getElementById('btn-limpiar-maestro');
  const contenedor = document.getElementById('buscador-maestro');
  inputTexto.value = nombre;
  inputTexto.classList.add('bloqueado');
  inputHidden.value = nombre;
  maestroSeleccionado = true;
  contenedor.classList.add('seleccionado');
  btnLimpiar.style.display = 'flex';
  lista.classList.remove('visible');
  lista.innerHTML = '';
}

function limpiarBuscadorMaestro() {
  const inputTexto = document.getElementById('input-maestro');
  const inputHidden = document.getElementById('select-maestro');
  const btnLimpiar = document.getElementById('btn-limpiar-maestro');
  const contenedor = document.getElementById('buscador-maestro');
  inputTexto.value = '';
  inputTexto.classList.remove('bloqueado');
  inputHidden.value = '';
  maestroSeleccionado = false;
  contenedor.classList.remove('seleccionado');
  btnLimpiar.style.display = 'none';
  inputTexto.focus();
}

function limpiarFormulario() {
  limpiarBuscadorMaestro();
  horasConGrupo = {};
  renderHorasGrupoLista();
  actualizarResumenInasistencia();
  retardosEnCurso = {};
  renderRetardoLista();
  actualizarResumenRetardo();
  document.getElementById('input-fecha').value = hoy();
}

async function enviarRegistro() {
  const maestro = document.getElementById('select-maestro').value;
  const fecha = document.getElementById('input-fecha').value;
  const successEl = document.getElementById('success-msg');
  const btnEnviar = document.getElementById('btn-enviar');
  successEl.textContent = '';

  if (!maestro) { alert('Selecciona un maestro.'); return; }
  if (!fecha) { alert('Selecciona una fecha.'); return; }

  if (tipoRegistro === 'inasistencia') {
    const porGrupo = {};
    Object.keys(horasConGrupo).forEach(h => {
      const g = horasConGrupo[h];
      if (!g) return;
      if (!porGrupo[g]) porGrupo[g] = [];
      porGrupo[g].push(parseInt(h));
    });
    const gruposConHoras = Object.keys(porGrupo);
    const horasSinGrupo = Object.keys(horasConGrupo).filter(h => !horasConGrupo[h]);
    if (gruposConHoras.length === 0 && horasSinGrupo.length === 0) { alert('Marca al menos una hora y elige su grupo.'); return; }
    if (horasSinGrupo.length > 0) { alert('Falta elegir el grupo de la hora ' + horasSinGrupo[0] + 'ª.'); return; }

    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando...';
    try {
      for (const g of gruposConHoras) {
        await addDoc(collection(db, 'inasistencias_prefectos'), {
          tipo: 'inasistencia',
          maestroNombre: maestro,
          fecha: fecha,
          horasNoTrabajadas: porGrupo[g].length,
          grupos: [g],
          prefectoId: prefectoActual.uid,
          prefectoNombre: prefectoActual.nombre,
          timestamp: serverTimestamp(),
          estatus: 'pendiente'
        });
      }
      limpiarFormulario();
      successEl.textContent = gruposConHoras.length > 1 ? gruposConHoras.length + ' inasistencias registradas.' : 'Inasistencia registrada.';
      setTimeout(() => { successEl.textContent = ''; }, 3000);
      cargarRegistrosHoy();
    } catch (e) {
      alert('Error al enviar: ' + e.message);
    }
  } else {
    const horasActivas = Object.keys(retardosEnCurso).filter(hp => retardosEnCurso[hp].llegada);
    if (horasActivas.length === 0) { alert('Escribe la hora de llegada de al menos un módulo.'); return; }
    const sinGrupo = horasActivas.filter(hp => !retardosEnCurso[hp].grupo);
    if (sinGrupo.length > 0) { alert('Falta elegir el grupo del módulo de las ' + sinGrupo[0] + '.'); return; }
    const invalidas = horasActivas.filter(hp => calcMinutosRetardo(hp, retardosEnCurso[hp].llegada) <= 0);
    if (invalidas.length > 0) { alert('La hora de llegada del módulo de las ' + invalidas[0] + ' debe ser posterior a esa hora.'); return; }

    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando...';
    try {
      for (const hp of horasActivas) {
        const e = retardosEnCurso[hp];
        const minRetardo = calcMinutosRetardo(hp, e.llegada);
        await addDoc(collection(db, 'inasistencias_prefectos'), {
          tipo: 'retardo',
          maestroNombre: maestro,
          fecha: fecha,
          horaProgramada: hp,
          horaLlegada: e.llegada,
          minutosRetardo: minRetardo,
          grupo: e.grupo,
          prefectoId: prefectoActual.uid,
          prefectoNombre: prefectoActual.nombre,
          timestamp: serverTimestamp(),
          estatus: 'pendiente'
        });
      }
      limpiarFormulario();
      successEl.textContent = horasActivas.length > 1 ? horasActivas.length + ' retardos registrados.' : 'Retardo registrado.';
      setTimeout(() => { successEl.textContent = ''; }, 3000);
      cargarRegistrosHoy();
    } catch (e) {
      alert('Error al enviar: ' + e.message);
    }
  }
  btnEnviar.disabled = false;
  btnEnviar.textContent = 'Enviar registro';
}

async function cargarRegistrosHoy() {
  const contenedor = document.getElementById('registros-hoy');
  contenedor.innerHTML = '<p style="color:#999;font-size:0.85rem;">Cargando...</p>';
  try {
    const snap = await getDocs(query(
      collection(db, 'inasistencias_prefectos'),
      where('fecha', '==', hoy()),
      where('prefectoId', '==', prefectoActual.uid),
      orderBy('timestamp', 'asc')
    ));
    if (snap.empty) {
      contenedor.innerHTML = '<p style="color:#999;font-size:0.85rem;">Sin registros por ahora.</p>';
      return;
    }

    const todos = [];
    snap.forEach(d => todos.push({ id: d.id, ...d.data() }));

    // Agrupar inasistencias por maestro; retardos se muestran individualmente
    const mapaInasist = {};
    const retardos = [];
    todos.forEach(r => {
      if (r.tipo === 'retardo') { retardos.push(r); return; }
      const k = r.maestroNombre;
      if (!mapaInasist[k]) mapaInasist[k] = { nombre: k, horas: 0, grupos: [], ids: [] };
      mapaInasist[k].horas += (r.horasNoTrabajadas || 0);
      (r.grupos || []).forEach(g => { if (!mapaInasist[k].grupos.includes(g)) mapaInasist[k].grupos.push(g); });
      mapaInasist[k].ids.push(r.id);
    });

    const gruposArr = Object.values(mapaInasist);
    let html = '';

    gruposArr.forEach((g) => {
      html += '<div class="registro-item">'
        + '<div class="registro-header">'
        + '<div class="maestro">' + g.nombre + '</div>'
        + '<span class="badge-inasistencia">INASISTENCIA</span>'
        + '</div>'
        + '<div class="detalle">' + g.horas + ' hora(s) - Grupos: ' + g.grupos.join(', ') + '</div>'
        + '</div>';
    });

    retardos.forEach(r => {
      const esGrave = r.minutosRetardo >= 15;
      html += '<div class="registro-item registro-retardo' + (esGrave ? ' retardo-grave' : '') + '">'
        + '<div class="registro-header">'
        + '<div class="maestro">' + r.maestroNombre + '</div>'
        + '<span class="badge-retardo">RETARDO</span>'
        + '</div>'
        + '<div class="detalle">' + r.minutosRetardo + ' min (entrada: ' + r.horaProgramada + ', llegó: ' + r.horaLlegada + ') - Grupo: ' + r.grupo + '</div>'
        + '</div>';
    });

    contenedor.innerHTML = html;

  } catch(e) {
    contenedor.innerHTML = '<p style="color:#999;font-size:0.85rem;">Sin registros por ahora.</p>';
  }
}
function abrirEditar(docId, maestro, horas, grupos) {
  const existing = document.getElementById('modal-editar');
  if (existing) existing.remove();

  const todosGruposBase = _pfTodosLosGrupos();
  const gradoActual = prefectoActual && prefectoActual.grado;
  const todosGrupos = gradoActual ? todosGruposBase.filter(g => g.charAt(0) === String(gradoActual)) : todosGruposBase;

  let gruposBtns = '';
  todosGrupos.forEach(g => {
    const sel = grupos.includes(g) ? ' editar-sel' : '';
    gruposBtns += '<button class="grupo-btn-edit' + sel + '" data-grupo="' + g + '">' + g + '</button>';
  });

  let horasBtns = '';
  for (let i = 1; i <= 7; i++) {
    const sel = i <= horas ? ' editar-sel' : '';
    horasBtns += '<button class="hora-btn-edit' + sel + '" data-horas="' + i + '">' + i + 'ª</button>';
  }

  const modal = document.createElement('div');
  modal.id = 'modal-editar';
  modal.className = 'modal-overlay';
  modal.innerHTML = '<div class="modal-box">'
    + '<h3>Editar inasistencia</h3>'
    + '<p style="font-weight:600;margin-bottom:12px;">' + maestro + '</p>'
    + '<label style="font-size:0.85rem;font-weight:500;margin-bottom:6px;display:block;">Horas no trabajadas</label>'
    + '<div class="horas-edit-grid">' + horasBtns + '</div>'
    + '<label style="font-size:0.85rem;font-weight:500;margin:12px 0 6px;display:block;">Grupos afectados</label>'
    + '<div class="grupos-edit-grid">' + gruposBtns + '</div>'
    + '<div class="modal-acciones">'
    + '<button id="modal-cancelar" class="btn-cancelar">Cancelar</button>'
    + '<button id="modal-guardar" class="btn-guardar">Guardar</button>'
    + '</div></div>';

  document.body.appendChild(modal);

  let nuevasHoras = [];
  for (let i = 1; i <= 7; i++) { if (i <= horas) nuevasHoras.push(i); }
  let nuevosGrupos = [...grupos];

  modal.querySelectorAll('.hora-btn-edit').forEach(b => {
    b.addEventListener('click', () => {
      b.classList.toggle('editar-sel');
      const h = parseInt(b.dataset.horas);
      if (b.classList.contains('editar-sel')) {
        if (!nuevasHoras.includes(h)) nuevasHoras.push(h);
      } else {
        nuevasHoras = nuevasHoras.filter(x => x !== h);
      }
    });
  });

  modal.querySelectorAll('.grupo-btn-edit').forEach(b => {
    b.addEventListener('click', () => {
      b.classList.toggle('editar-sel');
      const g = b.dataset.grupo;
      if (b.classList.contains('editar-sel')) {
        if (!nuevosGrupos.includes(g)) nuevosGrupos.push(g);
      } else {
        nuevosGrupos = nuevosGrupos.filter(x => x !== g);
      }
    });
  });

  document.getElementById('modal-cancelar').addEventListener('click', () => modal.remove());

  document.getElementById('modal-guardar').addEventListener('click', async () => {
    if (nuevasHoras.length === 0) { alert('Marca al menos una hora.'); return; }
    if (nuevosGrupos.length === 0) { alert('Selecciona al menos un grupo.'); return; }
    const btnG = document.getElementById('modal-guardar');
    btnG.disabled = true;
    btnG.textContent = 'Guardando...';
    try {
      await updateDoc(doc(db, 'inasistencias_prefectos', docId), {
        horasNoTrabajadas: nuevasHoras.length,
        grupos: nuevosGrupos
      });
      modal.remove();
      cargarRegistrosHoy();
    } catch (e) {
      alert('Error: ' + e.message);
      btnG.disabled = false;
      btnG.textContent = 'Guardar';
    }
  });
}

function abrirEditarRetardo(docId, maestro, horaProg, horaLleg, grupoActual) {
  const existing = document.getElementById('modal-editar');
  if (existing) existing.remove();

  const todosGruposBase = _pfTodosLosGrupos();
  const gradoActual = prefectoActual && prefectoActual.grado;
  const todosGrupos = gradoActual ? todosGruposBase.filter(g => g.charAt(0) === String(gradoActual)) : todosGruposBase;

  let gruposBtns = '';
  todosGrupos.forEach(g => {
    const sel = g === grupoActual ? ' editar-sel' : '';
    gruposBtns += '<button class="grupo-btn-edit' + sel + '" data-grupo="' + g + '">' + g + '</button>';
  });

  const modal = document.createElement('div');
  modal.id = 'modal-editar';
  modal.className = 'modal-overlay';
  modal.innerHTML = '<div class="modal-box">'
    + '<h3>Editar retardo</h3>'
    + '<p style="font-weight:600;margin-bottom:12px;">' + maestro + '</p>'
    + '<div class="form-group"><label style="font-size:0.85rem;font-weight:500;">Hora programada</label>'
    + '<input type="time" id="edit-hora-prog" value="' + horaProg + '" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:10px;font-size:1rem;margin-top:4px;"></div>'
    + '<div class="form-group"><label style="font-size:0.85rem;font-weight:500;">Hora de llegada</label>'
    + '<input type="time" id="edit-hora-lleg" value="' + horaLleg + '" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:10px;font-size:1rem;margin-top:4px;"></div>'
    + '<label style="font-size:0.85rem;font-weight:500;margin:8px 0 6px;display:block;">Grupo en turno</label>'
    + '<div class="grupos-edit-grid">' + gruposBtns + '</div>'
    + '<div class="modal-acciones">'
    + '<button id="modal-cancelar" class="btn-cancelar">Cancelar</button>'
    + '<button id="modal-guardar" class="btn-guardar">Guardar</button>'
    + '</div></div>';

  document.body.appendChild(modal);

  let nuevoGrupo = grupoActual;

  modal.querySelectorAll('.grupo-btn-edit').forEach(b => {
    b.addEventListener('click', () => {
      modal.querySelectorAll('.grupo-btn-edit').forEach(x => x.classList.remove('editar-sel'));
      b.classList.add('editar-sel');
      nuevoGrupo = b.dataset.grupo;
    });
  });

  document.getElementById('modal-cancelar').addEventListener('click', () => modal.remove());

  document.getElementById('modal-guardar').addEventListener('click', async () => {
    const hp = document.getElementById('edit-hora-prog').value;
    const hl = document.getElementById('edit-hora-lleg').value;
    if (!hp || !hl) { alert('Completa ambas horas.'); return; }
    if (!nuevoGrupo) { alert('Selecciona un grupo.'); return; }
    const minP = parseInt(hp.split(':')[0]) * 60 + parseInt(hp.split(':')[1]);
    const minL = parseInt(hl.split(':')[0]) * 60 + parseInt(hl.split(':')[1]);
    const diff = minL - minP;
    if (diff <= 0) { alert('La hora de llegada debe ser posterior.'); return; }
    const btnG = document.getElementById('modal-guardar');
    btnG.disabled = true;
    btnG.textContent = 'Guardando...';
    try {
      await updateDoc(doc(db, 'inasistencias_prefectos', docId), {
        horaProgramada: hp,
        horaLlegada: hl,
        minutosRetardo: diff,
        grupo: nuevoGrupo
      });
      modal.remove();
      cargarRegistrosHoy();
    } catch (e) {
      alert('Error: ' + e.message);
      btnG.disabled = false;
      btnG.textContent = 'Guardar';
    }
  });
}


// ===================== ASISTENCIA ALUMNOS =====================

async function iniciarAsistencia() {


  const contenedor = document.getElementById('asistencia-contenido');


  // Versión local: el grado dice de qué año son los grupos que va a contar.


  // Se toma del perfil y, si no está, del correo con el que entró.


  const grado = (prefectoActual && prefectoActual.grado) || null;


  if (!grado) {


    // Sin grado NO se pinta una tabla con datos falsos.


    contenedor.innerHTML = '<div style="padding:16px;background:#fff8e1;border:1px solid #ffe082;border-radius:10px;font-size:0.92rem;color:#7a5c00;line-height:1.55">'


      + '<b>Falta asignarte un grado.</b><br>Pídele a la dirección que te ponga el año que te toca (1, 2 o 3) para poder subir la asistencia de tus grupos.<br><br>'


      + 'Mientras tanto, en la pestaña <b>Maestros</b> sí puedes reportar <b>retardos</b> e <b>inasistencias</b> con normalidad.</div>';


    return;


  }


  const letra = grado === 1 ? '1er' : grado === 2 ? '2do' : '3er';
  contenedor.innerHTML =
    '<div class="form-group" style="margin-bottom:10px;">'
    + '<label>Fecha</label>'
    + '<input type="date" id="input-fecha-asistencia" value="' + hoy() + '" max="' + hoy() + '" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:1rem;background:#fafafa;">'
    + '<p class="hint-texto" style="font-size:12px;color:#185fa5;background:#e6f1fb;border-radius:6px;padding:7px 10px;margin-top:6px;line-height:1.5;">Si se te pasó un día, selecciónalo aquí y sube ese reporte. Solo se puede enviar una vez por día — si ya está enviado, no se puede editar; para corregirlo comunícate con la dirección.</p>'
    + '</div>'
    + '<div id="asistencia-form-wrap"></div>';

  document.getElementById('input-fecha-asistencia').addEventListener('change', (e) => {
    cargarAsistenciaFecha(grado, letra, e.target.value);
  });

  await cargarAsistenciaFecha(grado, letra, hoy());
}

async function cargarAsistenciaFecha(grado, letra, fecha) {
  const wrap = document.getElementById('asistencia-form-wrap');
  const grupos = _pfLetrasDe(grado);
  const docId = grado + '_' + fecha;
  wrap.innerHTML = '<p style="color:#999;font-size:0.85rem;">Cargando...</p>';
  let datosExistentes = null;
  try {
    const snap = await getDoc(doc(db, 'asistencia_diaria', docId));
    if (snap.exists()) datosExistentes = snap.data();
  } catch(e) { console.error(e); }
  renderAsistenciaForm(wrap, grado, letra, grupos, fecha, datosExistentes);
}

function renderAsistenciaForm(contenedor, grado, letra, grupos, fecha, datos) {
  const yaEnviado = datos !== null;
  const yaEditado = yaEnviado && datos.editado === true;
  let h = '<div style="margin-bottom:10px;">';
  h += '<span style="background:#e8eaf6;color:#3949ab;font-size:0.75rem;font-weight:500;padding:3px 10px;border-radius:20px;">' + letra + ' año</span>';
  if (yaEnviado) {
    h += ' <span style="background:#e8f5e9;color:#2e7d32;font-size:0.75rem;font-weight:500;padding:3px 10px;border-radius:20px;margin-left:4px;">✓ Enviado</span>';
  }
  if (yaEditado) {
    h += ' <span style="background:#fff3e0;color:#e65100;font-size:0.75rem;font-weight:500;padding:3px 10px;border-radius:20px;margin-left:4px;">✏ Corregido</span>';
  }
  h += '</div>';
  h += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">';
  h += '<table class="asist-tabla">';
  h += '<thead><tr>';
  h += '<th>Grp</th>';
  h += '<th colspan="3" style="background:#e8f5e9;color:#2e7d32;font-size:0.7rem;">Asistencia</th>';
  h += '<th colspan="3" style="background:#fce4ec;color:#c62828;font-size:0.7rem;">Inasist.</th>';
  h += '<th colspan="2" style="background:#fff8e1;color:#f57f17;font-size:0.7rem;">Justif.</th>';
  h += '<th style="background:#fce4ec;color:#c62828;font-size:0.7rem;">Faltas</th>';
  h += '<th style="background:#e8eaf6;color:#283593;font-size:0.7rem;">Total</th>';
  h += '</tr>';
  h += '<tr><th></th><th class="sub-col">H</th><th class="sub-col">M</th><th class="sub-col" style="background:#a5d6a7;color:#1b5e20;">Tot.</th><th class="sub-col">H</th><th class="sub-col">M</th><th class="sub-col" style="background:#ef9a9a;color:#b71c1c;">Tot.</th><th class="sub-col">H</th><th class="sub-col">M</th><th></th><th></th></tr>';
  h += '</thead><tbody>';
  const campos = ['hA','mA','hI','mI','hJ','mJ'];
  grupos.forEach(g => {
    const d = datos && datos.grupos && datos.grupos[g] ? datos.grupos[g] : {hA:0,mA:0,hI:0,mI:0,hJ:0,mJ:0};
    const inasist = (d.hI||0) + (d.mI||0);
    const asist = (d.hA||0) + (d.mA||0);
    const faltas = inasist;
    const total = asist + inasist;
    const ro = yaEnviado ? ' readonly' : '';
    const roStyle = yaEnviado ? 'background:#f5f5f5;' : '';
    h += '<tr>';
    h += '<td style="font-weight:500;text-align:center;background:#fafafa;font-size:0.8rem;">' + grado + g + '</td>';
    ['hA','mA'].forEach(c => {
      h += '<td><input class="asist-inp" data-grupo="' + g + '" data-campo="' + c + '" type="number" min="0" max="99" value="' + (d[c]||0) + '" style="' + roStyle + '" onfocus="this.select()"' + ro + '></td>';
    });
    h += '<td class="asist-calc" data-grupo="' + g + '" data-col="tot-asist" style="text-align:center;background:#c8e6c9;color:#1b5e20;font-weight:500;font-size:0.8rem;">' + asist + '</td>';
    ['hI','mI'].forEach(c => {
      h += '<td><input class="asist-inp" data-grupo="' + g + '" data-campo="' + c + '" type="number" min="0" max="99" value="' + (d[c]||0) + '" style="' + roStyle + '" onfocus="this.select()"' + ro + '></td>';
    });
    h += '<td class="asist-calc" data-grupo="' + g + '" data-col="tot-inasist" style="text-align:center;background:#ffcdd2;color:#b71c1c;font-weight:500;font-size:0.8rem;">' + inasist + '</td>';
    ['hJ','mJ'].forEach(c => {
      h += '<td><input class="asist-inp" data-grupo="' + g + '" data-campo="' + c + '" type="number" min="0" max="99" value="' + (d[c]||0) + '" style="' + roStyle + '" onfocus="this.select()"' + ro + '></td>';
    });
    h += '<td class="asist-calc" data-grupo="' + g + '" data-col="faltas" style="text-align:center;background:#fce4ec;color:#c62828;font-weight:500;font-size:0.8rem;">' + faltas + '</td>';
    h += '<td class="asist-calc" data-grupo="' + g + '" data-col="total" style="text-align:center;background:#e8f5e9;color:#2e7d32;font-weight:500;font-size:0.8rem;">' + total + '</td>';
    h += '</tr>';
  });
  h += '<tr style="background:#ede7f6;">';
  h += '<td style="font-weight:500;text-align:center;color:#4527a0;font-size:0.8rem;">Tot.</td>';
  ['hA','mA'].forEach(c => { h += '<td id="tot-' + c + '" style="text-align:center;font-weight:500;color:#4527a0;font-size:0.8rem;">0</td>'; });
  h += '<td id="trow-asist" style="text-align:center;font-weight:500;background:#c8e6c9;color:#1b5e20;font-size:0.8rem;">0</td>';
  ['hI','mI'].forEach(c => { h += '<td id="tot-' + c + '" style="text-align:center;font-weight:500;color:#4527a0;font-size:0.8rem;">0</td>'; });
  h += '<td id="trow-inasist" style="text-align:center;font-weight:500;background:#ffcdd2;color:#b71c1c;font-size:0.8rem;">0</td>';
  ['hJ','mJ'].forEach(c => { h += '<td id="tot-' + c + '" style="text-align:center;font-weight:500;color:#4527a0;font-size:0.8rem;">0</td>'; });
  h += '<td id="tot-faltas" style="text-align:center;font-weight:500;color:#c62828;font-size:0.8rem;">0</td>';
  h += '<td id="tot-total" style="text-align:center;font-weight:500;color:#2e7d32;font-size:0.8rem;">0</td>';
  h += '</tr>';
  h += '<tr style="background:#e3f2fd;">';
  h += '<td style="font-weight:500;text-align:center;color:#1565c0;font-size:0.7rem;" colspan="3">Total asistencia</td>';
  h += '<td id="tot-asistencia" colspan="2" style="text-align:center;font-weight:500;color:#2e7d32;font-size:0.8rem;">0</td>';
  h += '<td style="font-weight:500;text-align:center;color:#1565c0;font-size:0.7rem;" colspan="2">Total inasist.</td>';
  h += '<td id="tot-inasistencia" colspan="2" style="text-align:center;font-weight:500;color:#c62828;font-size:0.8rem;">0</td>';
  h += '</tr></tbody></table></div>';
  if (!yaEnviado) {
    h += '<button id="btn-enviar-asistencia" style="width:100%;margin-top:12px;padding:10px;background:#2d3a8c;color:white;border:none;border-radius:8px;font-size:0.9rem;font-weight:500;cursor:pointer;">Enviar reporte del día</button>';
  } else {
    h += '<p class="hint-texto" style="font-size:12px;color:#185fa5;background:#e6f1fb;border-radius:6px;padding:9px 10px;margin-top:12px;line-height:1.5;">Este reporte ya fue enviado y no se puede modificar desde aquí. Si necesitas corregirlo, comunícate con la dirección.</p>';
  }
  h += '<p id="asist-msg" style="text-align:center;font-size:0.85rem;margin-top:8px;color:#2e7d32;min-height:20px;"></p>';
  contenedor.innerHTML = h;

  function recalcular() {
    const tots = {hA:0,mA:0,hI:0,mI:0,hJ:0,mJ:0,faltas:0,total:0};
    grupos.forEach(g => {
      const vals = {};
      campos.forEach(c => {
        const inp = contenedor.querySelector('[data-grupo="' + g + '"][data-campo="' + c + '"]');
        vals[c] = inp ? (parseInt(inp.value)||0) : 0;
        tots[c] += vals[c];
      });
      const a = vals.hA + vals.mA;
      const i = vals.hI + vals.mI;
      const f = i;
      const t = a + i;
      tots.faltas += f; tots.total += t; tots.asistencia = (tots.asistencia||0) + a; tots.inasistencia = (tots.inasistencia||0) + i;
      const ac = contenedor.querySelector('[data-grupo="' + g + '"][data-col="tot-asist"]');
      const ic = contenedor.querySelector('[data-grupo="' + g + '"][data-col="tot-inasist"]');
      const fc = contenedor.querySelector('[data-grupo="' + g + '"][data-col="faltas"]');
      const tc = contenedor.querySelector('[data-grupo="' + g + '"][data-col="total"]');
      if (ac) ac.textContent = a;
      if (ic) ic.textContent = i;
      if (fc) fc.textContent = f;
      if (tc) tc.textContent = t;
    });
    campos.forEach(c => { const el = document.getElementById('tot-' + c); if (el) el.textContent = tots[c]; });
    const ef = document.getElementById('tot-faltas');
    const et = document.getElementById('tot-total');
    const ea = document.getElementById('tot-asistencia');
    const ei = document.getElementById('tot-inasistencia');
    if (ef) ef.textContent = tots.faltas;
    if (et) et.textContent = tots.total;
    if (ea) ea.textContent = tots.asistencia || 0;
    if (ei) ei.textContent = tots.inasistencia || 0;
    const etra = document.getElementById('trow-asist');
    const etri = document.getElementById('trow-inasist');
    if (etra) etra.textContent = tots.asistencia || 0;
    if (etri) etri.textContent = tots.inasistencia || 0;
  }
  recalcular();
  contenedor.querySelectorAll('.asist-inp').forEach(inp => inp.addEventListener('input', recalcular));
  if (!yaEnviado) {
    document.getElementById('btn-enviar-asistencia').addEventListener('click', () => guardarAsistencia(grado, letra, grupos, fecha, contenedor));
  }
}

async function guardarAsistencia(grado, letra, grupos, fecha, contenedor) {


  if (!grado) { alert('Falta que la dirección te asigne un grado.'); return; }
  const btn = document.getElementById('btn-enviar-asistencia');
  btn.disabled = true; btn.textContent = 'Enviando...';
  const campos = ['hA','mA','hI','mI','hJ','mJ'];
  const gruposData = {};
  grupos.forEach(g => {
    const vals = {};
    campos.forEach(c => {
      const inp = contenedor.querySelector('[data-grupo="' + g + '"][data-campo="' + c + '"]');
      vals[c] = inp ? (parseInt(inp.value)||0) : 0;
    });
    gruposData[g] = vals;
  });
  const docId = grado + '_' + fecha;
  try {
    await setDoc(doc(db, 'asistencia_diaria', docId), {
      grado: grado,
      fecha: fecha,
      prefectoId: prefectoActual.uid,
      prefectoNombre: prefectoActual.nombre,
      timestamp: serverTimestamp(),
      grupos: gruposData
    });
    renderAsistenciaForm(contenedor, grado, letra, grupos, fecha, { grupos: gruposData, prefectoId: prefectoActual.uid, prefectoNombre: prefectoActual.nombre });
    const msg = document.getElementById('asist-msg');
    if (msg) msg.textContent = 'Reporte enviado correctamente.';
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Enviar reporte del día';
    alert('Error al guardar: ' + e.message);
  }
}




// ── LÓGICA PAES ──────────────────────────────────────────────
let listaPaesCache = [];

async function cargarPaes() {
  if (listaPaesCache.length > 0) return;
  try {
    const j = { maestros: Buzon.catalogo().maestros || [] };
    listaPaesCache = (j.maestros || []).filter(p => p.nombre);
  } catch(e) {
    console.error('Error cargando PAES:', e);
  }
}

function armarBuscadorPaes(inputId, listaId, hiddenId) {
  const input = document.getElementById(inputId);
  const lista = document.getElementById(listaId);
  const hidden = document.getElementById(hiddenId);
  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    hidden.value = '';
    if (q.length < 1) { lista.style.display = 'none'; return; }
    const filtrados = listaPaesCache.filter(p => {
      const nombre = (p.nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return nombre.includes(q);
    });
    if (filtrados.length === 0) { lista.style.display = 'none'; return; }
    lista.innerHTML = filtrados.map(p =>
      '<div style="padding:10px 12px;cursor:pointer;border-bottom:0.5px solid #eee;font-size:14px;" data-id="' + p.id + '" data-nombre="' + p.nombre + '">' + p.nombre + '</div>'
    ).join('');
    lista.style.display = 'block';
    lista.querySelectorAll('div').forEach(item => {
      item.addEventListener('click', () => {
        input.value = item.dataset.nombre;
        hidden.value = item.dataset.id;
        lista.style.display = 'none';
      });
    });
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !lista.contains(e.target)) lista.style.display = 'none';
  });
}

function iniciarBuscadorPaes() {
  if (!document.getElementById('input-paes')) return;
  cargarPaes();
  armarBuscadorPaes('input-paes', 'lista-paes', 'select-paes');
  armarBuscadorPaes('input-paes-ret', 'lista-paes-ret', 'select-paes-ret');
  document.getElementById('btn-enviar-paes').addEventListener('click', enviarInasistenciaPaes);
  const btnRet = document.getElementById('btn-enviar-retardo-paes');
  if (btnRet) btnRet.addEventListener('click', enviarRetardoPaes);
  const horaLlegada = document.getElementById('input-hora-llegada-paes');
  if (horaLlegada) {
    horaLlegada.addEventListener('change', () => {
      const v = horaLlegada.value;
      const el = document.getElementById('paes-minutos-retardo');
      if (!v) { el.style.display = 'none'; return; }
      const [h, m] = v.split(':').map(Number);
      const diff = (h * 60 + m) - (6 * 60 + 30);
      if (diff > 0) {
        el.textContent = 'Retardo: ' + diff + ' minuto' + (diff === 1 ? '' : 's');
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }
}

async function enviarInasistenciaPaes() {
  const input = document.getElementById('input-paes');
  const hidden = document.getElementById('select-paes');
  const btn = document.getElementById('btn-enviar-paes');
  const nombre = input.value.trim();
  const id = hidden.value.trim();
  if (!nombre || !id) { alert('Selecciona un PAES de la lista.'); return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await addDoc(collection(db, 'inasistencias_prefectos'), {
      maestro: nombre,
      maestroId: id,
      tipo: 'paes',
      horasNoTrabajadas: 0,
      grupos: [],
      fecha: document.getElementById('input-fecha').value,
      prefectoId: prefectoActual.uid,
      prefectoNombre: prefectoActual.nombre,
      timestamp: serverTimestamp(),
      estatus: 'pendiente'
    });
    input.value = '';
    hidden.value = '';
    btn.disabled = false; btn.textContent = 'Registrar PAES';
    alert('Inasistencia PAES registrada.');
    cargarRegistrosHoy();
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Registrar PAES';
    alert('Error: ' + e.message);
  }
}

async function enviarRetardoPaes() {
  const input = document.getElementById('input-paes-ret');
  const hidden = document.getElementById('select-paes-ret');
  const horaLlegada = document.getElementById('input-hora-llegada-paes').value;
  const btn = document.getElementById('btn-enviar-retardo-paes');
  const nombre = input.value.trim();
  const id = hidden.value.trim();
  if (!nombre || !id) { alert('Selecciona un PAES de la lista.'); return; }
  if (!horaLlegada) { alert('Ingresa la hora real de llegada.'); return; }
  const [h, m] = horaLlegada.split(':').map(Number);
  const minutosRetardo = (h * 60 + m) - (6 * 60 + 30);
  if (minutosRetardo <= 0) { alert('La hora de llegada debe ser despues de las 6:30.'); return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await addDoc(collection(db, 'inasistencias_prefectos'), {
      maestro: nombre,
      maestroId: id,
      tipo: 'retardo',
      esPaes: true,
      horaProgramada: '06:30',
      horaLlegada: horaLlegada,
      minutosRetardo: minutosRetardo,
      fecha: document.getElementById('input-fecha').value,
      prefectoId: prefectoActual.uid,
      prefectoNombre: prefectoActual.nombre,
      timestamp: serverTimestamp(),
      estatus: 'pendiente'
    });
    input.value = '';
    hidden.value = '';
    document.getElementById('input-hora-llegada-paes').value = '';
    document.getElementById('paes-minutos-retardo').style.display = 'none';
    btn.disabled = false; btn.textContent = 'Registrar retardo PAES';
    alert('Retardo PAES registrado.');
    cargarRegistrosHoy();
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Registrar retardo PAES';
    alert('Error: ' + e.message);
  }
}
