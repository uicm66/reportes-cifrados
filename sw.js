// Guarda el código de la app para que abra sin internet. NO guarda ningún dato: los reportes viven en la bóveda cifrada del aparato.
// Al publicar una versión nueva, subir el número de CACHE para que los aparatos se actualicen.
const CACHE = "reportes-v2";
const ARCHIVOS = [
  "./", "./index.html", "./estilo.css", "./config.js", "./manifest.json",
  "./src/cripto.js", "./src/boveda.js", "./src/transporte.js",
  "./icono-180.png", "./icono-192.png", "./icono-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});
// Solo se atienden los archivos de la propia app. Las llamadas al buzón (/api/...) siempre van a la red.
self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/api/") >= 0) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || fetch(e.request); })
  );
});
