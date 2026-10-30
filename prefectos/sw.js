// Guarda el CÓDIGO de la página de prefectos para que abra sin internet. NUNCA guarda datos: los reportes y la lista de maestros
// viven cifrados en la memoria del celular. Al publicar una versión nueva, subir CACHE (y VERSION_PREFECTOS en src/app.js).
const CACHE = "prefectos-v3";
const ARCHIVOS = [
  "./", "./index.html", "./manifest.json", "./src/app.js", "./src/style.css", "./src/buzon-prefecto.js", "./src/local-db/motorLocal.js",
  "../src/cripto.js", "../src/transporte-firestore.js", "../src/alta-aparato.js", "../src/perfil-prefecto.js", "../src/reporte-prefectos.js",
  "./icono-180.png", "./icono-192.png", "./icono-512.png"
];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ARCHIVOS.map(function (a) { return c.add(new Request(a, { cache: "reload" })); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (n) {
    // solo versiones VIEJAS de esta página (prefijo "prefectos-"): la app de consulta comparte el sitio y tiene las suyas
    return Promise.all(n.filter(function (x) { return x !== CACHE && x.indexOf("prefectos-") === 0; }).map(function (x) { return caches.delete(x); }));
  }).then(function () { return self.clients.claim(); }));
});
// Solo archivos de la propia página. Las llamadas al buzón (otro dominio) siempre van directo a la red.
self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(function (r) {
      if (r && r.ok) { const copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copia); }); }
      return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); })
  );
});
