// Guarda el código de la app para que abra sin internet. NO guarda ningún dato: los reportes viven en la bóveda cifrada del aparato.
// Al publicar una versión nueva, subir el número de CACHE para que los aparatos se actualicen.
const CACHE = "reportes-v3";
const ARCHIVOS = [
  "./", "./index.html", "./estilo.css", "./config.js", "./manifest.json",
  "./src/cripto.js", "./src/boveda.js", "./src/transporte.js",
  "./icono-180.png", "./icono-192.png", "./icono-512.png"
];

self.addEventListener("install", function (e) {
  // cache: "reload" = pedir siempre al servidor, nunca a la memoria temporal del navegador (GitHub la marca válida 10 min)
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ARCHIVOS.map(function (a) { return c.add(new Request(a, { cache: "reload" })); }));
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});
// Solo se atienden los archivos de la propia app. Las llamadas al buzón (/api/...) siempre van a la red.
// Primero la red (así siempre se recibe la versión más nueva) y la copia guardada solo si no hay internet.
self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/api/") >= 0) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(function (r) {
      if (r && r.ok) { const copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copia); }); }
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
