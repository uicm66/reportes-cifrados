// src/local-db/motorLocal.js
// Motor de base de datos 100% local (IndexedDB, sin nube, sin internet)
// que expone la MISMA superficie de funciones que el SDK de Firebase que
// consume el resto del proyecto (collection, doc, getDoc, getDocs, setDoc,
// addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
// writeBatch, y un shim de Auth con cuentas locales -- usuario +
// contraseña por persona, con permisos por módulo).
// Así, los ~40 archivos que ya llaman a estas funciones vía window.* no
// necesitan cambiar -- solo cambia de dónde vienen esas funciones.
//
// Almacenamiento: un único object store de IndexedDB ("documentos"),
// clave = ruta completa del documento (ej. "personal/abc123" o
// "escuelas/fcp/ciclos/2026-2027/matricula/1A"). Se evita crear un
// object store por colección para no depender de saber de antemano
// todos los nombres de colección que existen en el sistema.

var DB_NAME = "escuela_local_db";
var STORE = "documentos";
var _idb = null;
var _idbAbriendo = null;
var _cache = new Map(); // ruta completa -> data (objeto plano)
var _listeners = []; // {colPath, spec, callback}

function _abrirIDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = function () {
      resolve(req.result);
    };
    req.onerror = function () {
      reject(req.error);
    };
  });
}

async function _asegurarInit() {
  if (_idb) return;
  if (!_idbAbriendo) {
    _idbAbriendo = (async function () {
      _idb = await _abrirIDB();
      await new Promise(function (resolve, reject) {
        var tx = _idb.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          req.result.forEach(function (row) {
            _cache.set(row.key, row.data);
          });
          resolve();
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    })();
  }
  await _idbAbriendo;
}

function _guardarFila(key, data) {
  _cache.set(key, data);
  var tx = _idb.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ key: key, data: data });
  return new Promise(function (resolve, reject) {
    tx.oncomplete = resolve;
    tx.onerror = function () {
      reject(tx.error);
    };
  });
}

function _borrarFila(key) {
  _cache.delete(key);
  var tx = _idb.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(key);
  return new Promise(function (resolve, reject) {
    tx.oncomplete = resolve;
    tx.onerror = function () {
      reject(tx.error);
    };
  });
}

function _limpiarStore() {
  var tx = _idb.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  return new Promise(function (resolve, reject) {
    tx.oncomplete = resolve;
    tx.onerror = function () {
      reject(tx.error);
    };
  });
}

// ---------------------------------------------------------------------
// Respaldo / restauración completa -- usadas por
// src/local-db/respaldoLocal.js para generar y restaurar el archivo
// cifrado con TODO lo que hay en este motor local (personal, matrícula,
// licencias, notas, intendencia, horarios, cuentas -- todo vive en el
// mismo object store "documentos", así que exportar/restaurar "todo" es
// literalmente volcar y rehacer esa tabla).
// ---------------------------------------------------------------------

export async function exportarTodosLosDocumentos() {
  await _asegurarInit();
  var filas = [];
  _cache.forEach(function (data, key) {
    filas.push({ key: key, data: data });
  });
  return filas;
}

export async function restaurarTodosLosDocumentos(filas) {
  await _asegurarInit();
  await _limpiarStore();
  _cache.clear();
  for (var i = 0; i < filas.length; i++) {
    await _guardarFila(filas[i].key, filas[i].data);
  }
  // Las pantallas guardan copias temporales de listas (Personal, etc.) en localStorage con prefijo "fcp_" (formato {d, t}, 10 min):
  // tras restaurar hay que borrarlas, si no se siguen viendo los datos de ANTES. (No se tocan otras claves "fcp_…" como la licencia/token.)
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf("fcp_") !== 0) return;
      try { var v = JSON.parse(localStorage.getItem(k)); if (v && typeof v === "object" && "d" in v && "t" in v) localStorage.removeItem(k); } catch (e) {}
    });
  } catch (e) {}
  // Cierra la sesión activa -- quien restaure debe volver a iniciar
  // sesión con una de las cuentas que acaban de restaurarse, en vez de
  // quedar "logueado" con un uid que puede ya no aplicar.
  localStorage.removeItem(SESION_KEY);
  _usuarioActual = null;
}

function _clonar(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function _esObjetoPlano(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Replica el comportamiento documentado de Firestore para setDoc(...,
// {merge:true}): objetos anidados se combinan recursivamente, arreglos y
// valores simples se reemplazan tal cual.
function _mergeProfundo(base, cambios) {
  if (!_esObjetoPlano(cambios)) return _clonar(cambios);
  var resultado = _esObjetoPlano(base) ? Object.assign({}, base) : {};
  Object.keys(cambios).forEach(function (k) {
    if (_esObjetoPlano(cambios[k]) && _esObjetoPlano(resultado[k])) {
      resultado[k] = _mergeProfundo(resultado[k], cambios[k]);
    } else {
      resultado[k] = _clonar(cambios[k]);
    }
  });
  return resultado;
}

function _idAleatorio() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------
// Referencias (collection/doc) -- objetos livianos que solo cargan una
// ruta ("path"), igual que las referencias reales de Firestore.
// ---------------------------------------------------------------------

function _refPath(base, segmentos) {
  var basePath = base && typeof base.path === "string" ? base.path : "";
  var todos = basePath ? [basePath].concat(segmentos) : segmentos;
  return todos.join("/");
}

export function collection(dbOrRef) {
  var segmentos = Array.prototype.slice.call(arguments, 1);
  var path = _refPath(dbOrRef, segmentos);
  return { __local: true, tipo: "collection", path: path };
}

export function doc(dbOrRef) {
  var segmentos = Array.prototype.slice.call(arguments, 1);
  if (segmentos.length === 0) {
    var idAuto = _idAleatorio();
    var pathAuto = (dbOrRef.path ? dbOrRef.path + "/" : "") + idAuto;
    return { __local: true, tipo: "doc", path: pathAuto, id: idAuto };
  }
  var path = _refPath(dbOrRef, segmentos);
  var partes = path.split("/");
  return { __local: true, tipo: "doc", path: path, id: partes[partes.length - 1] };
}

function _esHijoDirecto(colPath, key) {
  if (key.indexOf(colPath + "/") !== 0) return false;
  return key.slice(colPath.length + 1).indexOf("/") === -1;
}

function _leerCampo(obj, campo) {
  return campo.split(".").reduce(function (acc, k) {
    return acc == null ? acc : acc[k];
  }, obj);
}

function _aplicarFiltros(filas, filtros) {
  return filas.filter(function (row) {
    return filtros.every(function (f) {
      var v = _leerCampo(row.data, f.campo);
      switch (f.op) {
        case "==":
          return v === f.valor;
        case "!=":
          return v !== f.valor;
        case ">":
          return v > f.valor;
        case ">=":
          return v >= f.valor;
        case "<":
          return v < f.valor;
        case "<=":
          return v <= f.valor;
        case "array-contains":
          return Array.isArray(v) && v.indexOf(f.valor) !== -1;
        case "in":
          return Array.isArray(f.valor) && f.valor.indexOf(v) !== -1;
        default:
          return true;
      }
    });
  });
}

function _ordenar(filas, orden) {
  var copia = filas.slice();
  copia.sort(function (a, b) {
    var va = _leerCampo(a.data, orden.campo);
    var vb = _leerCampo(b.data, orden.campo);
    if (va === vb) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    var cmp = va < vb ? -1 : 1;
    return orden.direccion === "desc" ? -cmp : cmp;
  });
  return copia;
}

function _filasDeColeccion(colPath) {
  var filas = [];
  _cache.forEach(function (data, key) {
    if (_esHijoDirecto(colPath, key)) filas.push({ key: key, data: data });
  });
  return filas;
}

function _resolverQuery(refOrQuery) {
  if (refOrQuery.__local && refOrQuery.tipo === "query") return refOrQuery;
  return { __local: true, tipo: "query", colPath: refOrQuery.path, filtros: [], orden: null, limite: null };
}

// ---------------------------------------------------------------------
// query / where / orderBy / limit
// ---------------------------------------------------------------------

export function query(refColeccion) {
  var constraints = Array.prototype.slice.call(arguments, 1);
  var spec = { __local: true, tipo: "query", colPath: refColeccion.path, filtros: [], orden: null, limite: null };
  constraints.forEach(function (c) {
    if (c.__tipo === "where") spec.filtros.push(c);
    else if (c.__tipo === "orderBy") spec.orden = c;
    else if (c.__tipo === "limit") spec.limite = c.n;
  });
  return spec;
}
export function where(campo, op, valor) {
  return { __tipo: "where", campo: campo, op: op, valor: valor };
}
export function orderBy(campo, direccion) {
  return { __tipo: "orderBy", campo: campo, direccion: direccion || "asc" };
}
export function limit(n) {
  return { __tipo: "limit", n: n };
}

// ---------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------

export async function getDoc(refDoc) {
  await _asegurarInit();
  var data = _cache.get(refDoc.path);
  return {
    exists: function () {
      return data !== undefined;
    },
    data: function () {
      return data === undefined ? undefined : _clonar(data);
    },
    id: refDoc.id,
    ref: refDoc,
  };
}

export async function getDocs(refOrQuery) {
  await _asegurarInit();
  var spec = _resolverQuery(refOrQuery);
  var filas = _filasDeColeccion(spec.colPath);
  filas = _aplicarFiltros(filas, spec.filtros);
  if (spec.orden) filas = _ordenar(filas, spec.orden);
  if (spec.limite) filas = filas.slice(0, spec.limite);
  var docs = filas.map(function (fila) {
    var id = fila.key.split("/").pop();
    return {
      id: id,
      data: function () {
        return _clonar(fila.data);
      },
      ref: { __local: true, tipo: "doc", path: fila.key, id: id },
    };
  });
  return {
    docs: docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: function (fn) {
      docs.forEach(fn);
    },
  };
}

export async function setDoc(refDoc, data, opciones) {
  await _asegurarInit();
  var existente = _cache.get(refDoc.path);
  var nuevo = opciones && opciones.merge && existente !== undefined ? _mergeProfundo(existente, data) : _clonar(data);
  await _guardarFila(refDoc.path, nuevo);
  _notificarListeners(refDoc.path);
}

export async function addDoc(refColeccion, data) {
  await _asegurarInit();
  var id = _idAleatorio();
  var path = refColeccion.path + "/" + id;
  await _guardarFila(path, _clonar(data));
  _notificarListeners(refColeccion.path);
  return { __local: true, tipo: "doc", path: path, id: id };
}

export async function updateDoc(refDoc, cambios) {
  await _asegurarInit();
  var existente = _cache.get(refDoc.path);
  if (existente === undefined) {
    throw new Error("No existe el documento (updateDoc): " + refDoc.path);
  }
  await _guardarFila(refDoc.path, _mergeProfundo(existente, cambios));
  _notificarListeners(refDoc.path);
}

export async function deleteDoc(refDoc) {
  await _asegurarInit();
  await _borrarFila(refDoc.path);
  _notificarListeners(refDoc.path);
}

export function writeBatch() {
  var ops = [];
  return {
    set: function (ref, data, opciones) {
      ops.push({ tipo: "set", ref: ref, data: data, opciones: opciones });
    },
    update: function (ref, data) {
      ops.push({ tipo: "update", ref: ref, data: data });
    },
    delete: function (ref) {
      ops.push({ tipo: "delete", ref: ref });
    },
    commit: async function () {
      await _asegurarInit();
      var colsTocadas = {};
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (op.tipo === "set") {
          var existente = _cache.get(op.ref.path);
          var nuevo = op.opciones && op.opciones.merge && existente !== undefined ? _mergeProfundo(existente, op.data) : _clonar(op.data);
          await _guardarFila(op.ref.path, nuevo);
        } else if (op.tipo === "update") {
          var ex2 = _cache.get(op.ref.path);
          if (ex2 !== undefined) await _guardarFila(op.ref.path, _mergeProfundo(ex2, op.data));
        } else if (op.tipo === "delete") {
          await _borrarFila(op.ref.path);
        }
        colsTocadas[op.ref.path.split("/").slice(0, -1).join("/")] = true;
      }
      Object.keys(colsTocadas).forEach(_notificarListeners);
    },
  };
}

// ---------------------------------------------------------------------
// onSnapshot -- simulado: al suscribirse, entrega el estado actual; cada
// vez que algo escribe en la misma colección (o una anidada debajo),
// se vuelve a entregar el estado actualizado. No hay servidor de por
// medio, así que la "escucha en tiempo real" es instantánea dentro de la
// misma pestaña -- no hay sincronización entre pestañas/computadoras
// distintas (eso es esperado: es una base de datos local de una sola
// máquina).
// ---------------------------------------------------------------------

export function onSnapshot(refOrQuery, callback) {
  var spec = _resolverQuery(refOrQuery);
  var listener = { colPath: spec.colPath, spec: spec, callback: callback };
  _listeners.push(listener);
  _asegurarInit().then(function () {
    _emitirA(listener);
  });
  return function () {
    var i = _listeners.indexOf(listener);
    if (i !== -1) _listeners.splice(i, 1);
  };
}

function _notificarListeners(pathTocado) {
  _listeners.forEach(function (l) {
    if (pathTocado === l.colPath || pathTocado.indexOf(l.colPath + "/") === 0) _emitirA(l);
  });
}

async function _emitirA(listener) {
  var snap = await getDocs(listener.spec);
  listener.callback(snap);
}

// ---------------------------------------------------------------------
// App / Auth -- shim de cuentas múltiples: cada persona tiene su propio
// usuario + contraseña, creados por un administrador desde el módulo
// Cuentas, con permisos por módulo (decisión del usuario, 2026-08-16,
// reemplaza el modelo anterior de una sola contraseña compartida). Las
// cuentas se guardan como documentos normales en la colección "cuentas"
// (mismo motor de arriba, mismo object store -- no se crea almacenamiento
// aparte). Las contraseñas nunca se guardan en texto plano: se derivan
// con PBKDF2-SHA256 vía Web Crypto, nativo del navegador.
//
// Migración: si la app venía del modelo anterior ("una sola contraseña
// compartida", guardada en localStorage), la primera vez que se detectan
// cero cuentas se crea automáticamente una cuenta admin ("admin", con esa
// misma contraseña) con uid fijo "local" -- así hereda sin cambios los
// datos que ya estaban particionados por ese uid (Notas, Trabajo Social).
// ---------------------------------------------------------------------

var LOCAL_AUTH_KEY = "escuela_local_auth_password";
var SESION_KEY = "escuela_local_sesion_activa";
var _authListeners = [];
var _usuarioActual = null;
var _migracionHecha = false;
// Referencia al objeto "auth" (el que devuelve getAuth()) para poder
// mantener su propiedad .currentUser sincronizada -- varios módulos ya
// escritos (ej. trabajo-social/trabajoSocialData.js) leen
// window.auth.currentUser directamente, igual que harían con el SDK
// real de Firebase.
var _authRef = null;

function _setUsuarioActual(u) {
  _usuarioActual = u;
  if (_authRef) _authRef.currentUser = u;
  _authListeners.forEach(function (cb) {
    cb(_usuarioActual);
  });
}

function _bytesAHex(buffer) {
  return Array.prototype.map
    .call(new Uint8Array(buffer), function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

function _hexABytes(hex) {
  return new Uint8Array(
    hex.match(/.{2}/g).map(function (h) {
      return parseInt(h, 16);
    })
  );
}

async function _hashPassword(password, saltHex) {
  var salt = saltHex ? _hexABytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  var keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  var bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: _bytesAHex(bits), salt: _bytesAHex(salt) };
}

function _refCuentas() {
  return collection(null, "cuentas");
}

function _usuarioDesdeCuenta(uid, datos) {
  return {
    uid: uid,
    email: datos.usuario,
    usuario: datos.usuario,
    nombre: datos.nombre || datos.usuario,
    rol: datos.rol || "usuario",
    permisos: datos.permisos || {},
  };
}

async function _migrarSiHaceFalta() {
  if (_migracionHecha) return;
  _migracionHecha = true;
  var snap = await getDocs(_refCuentas());
  if (!snap.empty) return;
  var passwordVieja = localStorage.getItem(LOCAL_AUTH_KEY);
  if (!passwordVieja) return;
  var hashInfo = await _hashPassword(passwordVieja);
  await setDoc(doc(_refCuentas(), "local"), {
    usuario: "admin",
    nombre: "Administrador",
    passwordHash: hashInfo.hash,
    passwordSalt: hashInfo.salt,
    rol: "admin",
    permisos: {},
    activa: true,
    creadoEn: Date.now(),
    migradaDesdeContrasenaUnica: true,
  });
}

// Indica si ya hay al menos una cuenta creada (corre la migración antes
// de responder, para que una instalación vieja nunca se vea como "en
// blanco"). La usa la pantalla de login para decidir si pedir usuario +
// contraseña o mostrar "crear cuenta de administrador".
export async function hayCuentas() {
  await _asegurarInit();
  await _migrarSiHaceFalta();
  var snap = await getDocs(_refCuentas());
  return !snap.empty;
}

export async function crearCuenta(datos) {
  await _asegurarInit();
  var usuarioNorm = (datos.usuario || "").trim().toLowerCase();
  if (!usuarioNorm) throw new Error("El usuario no puede estar vacío.");
  var existente = await getDocs(query(_refCuentas(), where("usuario", "==", usuarioNorm)));
  if (!existente.empty) throw new Error("Ya existe una cuenta con ese usuario.");
  var hashInfo = await _hashPassword(datos.password);
  var nuevoDoc = await addDoc(_refCuentas(), {
    usuario: usuarioNorm,
    nombre: datos.nombre || usuarioNorm,
    passwordHash: hashInfo.hash,
    passwordSalt: hashInfo.salt,
    rol: datos.rol === "admin" ? "admin" : "usuario",
    permisos: datos.permisos || {},
    activa: true,
    creadoEn: Date.now(),
  });
  return nuevoDoc.id;
}

export async function actualizarCuenta(uid, cambios) {
  await _asegurarInit();
  var refCuenta = doc(_refCuentas(), uid);
  var datos = Object.assign({}, cambios);
  if (datos.password) {
    var hashInfo = await _hashPassword(datos.password);
    datos.passwordHash = hashInfo.hash;
    datos.passwordSalt = hashInfo.salt;
    delete datos.password;
  }
  await updateDoc(refCuenta, datos);
  if (_usuarioActual && _usuarioActual.uid === uid) {
    var snapActual = await getDoc(refCuenta);
    _setUsuarioActual(_usuarioDesdeCuenta(uid, snapActual.data()));
  }
}

// Sesion persistida en localStorage (guarda el uid de la cuenta) --
// equivalente local a browserLocalPersistence de Firebase Auth (real),
// para que no haya que volver a iniciar sesión en cada recarga. La
// cuenta completa (rol, permisos) vive en IndexedDB, así que resolver la
// sesión al cargar la página es async.
var _sesionResuelta = (async function () {
  var uidSesion = localStorage.getItem(SESION_KEY);
  if (!uidSesion) return;
  await _asegurarInit();
  await _migrarSiHaceFalta();
  var snap = await getDoc(doc(_refCuentas(), uidSesion));
  if (!snap.exists() || snap.data().activa === false) {
    localStorage.removeItem(SESION_KEY);
    return;
  }
  _usuarioActual = _usuarioDesdeCuenta(uidSesion, snap.data());
})();

export function initializeApp() {
  return { __local: true, tipo: "app" };
}

export function getFirestore() {
  return { __local: true, tipo: "db", path: "" };
}

export function getAuth() {
  return { __local: true, tipo: "auth" };
}

export function browserLocalPersistence() {
  return "local";
}

export async function setPersistence() {
  // No-op: el motor local ya es local por naturaleza, no hay sesión de
  // servidor que persistir.
}

export async function signInWithEmailAndPassword(auth, usuario, password) {
  if (auth) _authRef = auth;
  await _asegurarInit();
  await _migrarSiHaceFalta();
  var usuarioNorm = (usuario || "").trim().toLowerCase();
  var snap = await getDocs(query(_refCuentas(), where("usuario", "==", usuarioNorm)));
  var errInvalido = new Error("Usuario o contraseña incorrectos.");
  errInvalido.code = "auth/wrong-password";
  if (snap.empty) throw errInvalido;
  var cuentaDoc = snap.docs[0];
  var cuenta = cuentaDoc.data();
  if (cuenta.activa === false) {
    var errInactiva = new Error("Esta cuenta está desactivada.");
    errInactiva.code = "auth/user-disabled";
    throw errInactiva;
  }
  var verif = await _hashPassword(password, cuenta.passwordSalt);
  if (verif.hash !== cuenta.passwordHash) throw errInvalido;
  localStorage.setItem(SESION_KEY, cuentaDoc.id);
  _setUsuarioActual(_usuarioDesdeCuenta(cuentaDoc.id, cuenta));
  return { user: _usuarioActual };
}

export function signOut(auth) {
  if (auth) _authRef = auth;
  localStorage.removeItem(SESION_KEY);
  _setUsuarioActual(null);
  return Promise.resolve();
}

export function onAuthStateChanged(auth, callback) {
  if (auth) _authRef = auth;
  _authListeners.push(callback);
  _sesionResuelta.then(function () {
    if (_authRef) _authRef.currentUser = _usuarioActual;
    callback(_usuarioActual);
  });
  return function () {
    var i = _authListeners.indexOf(callback);
    if (i !== -1) _authListeners.splice(i, 1);
  };
}
