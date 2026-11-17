// Offline play: cache the game the first time it loads, serve from cache, refresh in the background.
const CACHE = 'ikkr-dw-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'css/style.css', 'js/main.js', 'manifest.webmanifest', 'icons/icon-192.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // PeerJS etc. go straight to the network
  // network first for code (so updates arrive), cache first for art and fonts
  const isCode = /\.(js|css|html|webmanifest)$/.test(new URL(req.url).pathname) || req.mode === 'navigate';
  if (isCode) {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
  }
});
