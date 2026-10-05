// Service worker: la app abre sin internet. Con conexión siempre intenta traer la versión nueva.
const CACHE = 'gymtrack-v3';
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "img/body-base.png", "img/body-lines.png", "img/z-abdomen.png", "img/z-antebrazo.png", "img/z-bicep.png", "img/z-cuadriceps.png", "img/z-cuello.png", "img/z-hombros.png", "img/z-pantorrilla.png", "img/z-pecho.png", "img/zones-map.png"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {                      // red primero (versión más nueva)…
      if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))  // …y si no hay red, lo guardado
  );
});
