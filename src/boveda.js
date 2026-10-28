// Bóveda local de UN aparato (navegador): guarda la llave privada del aparato y los reportes recibidos,
// todo cifrado con una llave que solo se abre con el PIN. Sin el PIN, lo guardado no se puede leer.
//   meta  : { salt, iter, vk (llave de la bóveda cifrada con el PIN), nombre, pub, kid, priv (cifrada), fallos, hasta }
//   reg   : un reporte por registro, cifrado con la llave de la bóveda
//   sec   : secretos extra (p. ej. la llave de firma del administrador), cifrados igual
import * as C from "./cripto.js";

const ALMACENES = ["kv", "reg", "sec"];

function abrirDB(nombre) {
  return new Promise(function (ok, mal) {
    const rq = indexedDB.open("buzon-boveda-" + nombre, 1);
    rq.onupgradeneeded = function () {
      ALMACENES.forEach(function (a) { rq.result.createObjectStore(a); });
    };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { mal(rq.error); };
  });
}
function tx(db, almacen, modo, fn) {
  return new Promise(function (ok, mal) {
    const t = db.transaction(almacen, modo);
    const r = fn(t.objectStore(almacen));
    t.oncomplete = function () { ok(r && r.result); };
    t.onerror = function () { mal(t.error); };
    t.onabort = function () { mal(t.error); };
  });
}

export const ESPERA_FALLOS = [0, 0, 0, 0, 0, 30, 60, 300, 900, 3600]; // segundos tras el fallo n

export async function abrirBoveda(nombre) {
  const db = await abrirDB(nombre || "principal");
  const leer = function (alm, k) { return tx(db, alm, "readonly", function (s) { return s.get(k); }); };
  const escribir = function (alm, k, v) { return tx(db, alm, "readwrite", function (s) { return s.put(v, k); }); };
  const borrar = function (alm, k) { return tx(db, alm, "readwrite", function (s) { return s.delete(k); }); };
  const todas = function (alm) { return tx(db, alm, "readonly", function (s) { return s.getAll(); }); };

  let vk = null;        // llave de la bóveda (en memoria solo mientras está abierta)
  let privada = null;   // llave privada ECDH del aparato (en memoria)
  let meta = await leer("kv", "meta");

  const b = {
    existe: function () { return !!meta; },
    abierta: function () { return !!vk; },
    info: function () { return meta ? { nombre: meta.nombre, pub: meta.pub, kid: meta.kid } : null; },
    privada: function () { return privada; },

    // Primera vez: elige PIN, se genera la llave del aparato.
    crear: async function (pin, nombreAparato) {
      if (meta) throw new Error("Este aparato ya está configurado.");
      if (!pin || pin.length < 6) throw new Error("El PIN debe tener al menos 6 caracteres.");
      const salt = C.aleatorio(16);
      const kek = await C.claveDePassword(pin, salt, C.ITERACIONES);
      const llave = await C.nuevaLlaveSimetrica();
      const par = await C.generarParDeLlaves();
      const pub = await C.exportarPublica(par.publica);
      const m = {
        salt: C.aB64(salt), iter: C.ITERACIONES,
        vk: await C.cifrarBytes(kek, await C.exportarSimetrica(llave), "vk"),
        nombre: nombreAparato || "Mi aparato", pub: pub, kid: await C.idDeLlave(pub),
        priv: await C.cifrarBytes(llave, await C.exportarPrivada(par.privada), "priv"),
        fallos: 0, hasta: 0
      };
      await escribir("kv", "meta", m);
      meta = m; vk = llave; privada = par.privada;
    },

    // Devuelve segundos de espera si está bloqueado por intentos fallidos.
    esperaRestante: function () {
      return meta && meta.hasta > Date.now() ? Math.ceil((meta.hasta - Date.now()) / 1000) : 0;
    },

    desbloquear: async function (pin) {
      if (!meta) throw new Error("Este aparato todavía no está configurado.");
      const espera = b.esperaRestante();
      if (espera) throw new Error("Demasiados intentos. Espera " + espera + " s.");
      try {
        const kek = await C.claveDePassword(pin, C.deB64(meta.salt), meta.iter);
        const raw = await C.descifrarBytes(kek, meta.vk, "vk");
        const llave = await C.importarSimetrica(raw);
        privada = await C.importarPrivada(await C.descifrarBytes(llave, meta.priv, "priv"));
        vk = llave;
        if (meta.fallos) { meta.fallos = 0; meta.hasta = 0; await escribir("kv", "meta", meta); }
      } catch (e) {
        meta.fallos = (meta.fallos || 0) + 1;
        const seg = ESPERA_FALLOS[Math.min(meta.fallos, ESPERA_FALLOS.length - 1)];
        meta.hasta = seg ? Date.now() + seg * 1000 : 0;
        await escribir("kv", "meta", meta);
        throw new Error("PIN incorrecto.");
      }
    },
    bloquear: function () { vk = null; privada = null; },

    // ---- reportes ----
    // Devuelve "nuevo", "actualizado" o "repetido" (ya había uno igual o más reciente).
    guardarRegistro: async function (reg) {
      if (!vk) throw new Error("Bóveda cerrada.");
      if (!reg || !reg.rid) throw new Error("Reporte sin identificador.");
      const previo = await leer("reg", reg.rid);
      if (previo) {
        const viejo = await C.descifrarObjeto(vk, previo, "reg|" + reg.rid);
        if ((viejo.rev || 0) >= (reg.rev || 0)) return "repetido";
      }
      await escribir("reg", reg.rid, await C.cifrarObjeto(vk, reg, "reg|" + reg.rid));
      return previo ? "actualizado" : "nuevo";
    },
    listarRegistros: async function () {
      if (!vk) throw new Error("Bóveda cerrada.");
      const claves = await tx(db, "reg", "readonly", function (s) { return s.getAllKeys(); });
      const filas = await todas("reg");
      const out = [];
      for (let i = 0; i < filas.length; i++) out.push(await C.descifrarObjeto(vk, filas[i], "reg|" + claves[i]));
      return out;
    },
    borrarRegistro: function (rid) { return borrar("reg", rid); },

    // ---- secretos extra (administrador) ----
    guardarSecreto: async function (k, bytes) {
      if (!vk) throw new Error("Bóveda cerrada.");
      await escribir("sec", k, await C.cifrarBytes(vk, bytes, "sec|" + k));
    },
    leerSecreto: async function (k) {
      if (!vk) throw new Error("Bóveda cerrada.");
      const caja = await leer("sec", k);
      return caja ? C.descifrarBytes(vk, caja, "sec|" + k) : null;
    },
    leerNumero: async function (k) { const v = await leer("kv", "n_" + k); return v || 0; },
    guardarNumero: function (k, n) { return escribir("kv", "n_" + k, n); },

    // ---- respaldo (se abre con contraseña, en cualquier aparato) ----
    exportarRespaldo: async function (contrasena) {
      if (contrasena.length < 8) throw new Error("La contraseña del respaldo debe tener al menos 8 caracteres.");
      const registros = await b.listarRegistros();
      return C.cifrarConPassword({ v: 1, exportado: new Date().toISOString(), de: meta.nombre, registros: registros }, contrasena);
    },
    importarRespaldo: async function (blob, contrasena) {
      const datos = await C.descifrarConPassword(blob, contrasena);
      const cuenta = { nuevo: 0, actualizado: 0, repetido: 0 };
      for (const r of datos.registros) cuenta[await b.guardarRegistro(r)]++;
      return cuenta;
    }
  };
  return b;
}
