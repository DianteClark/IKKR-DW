// Offline play. Code (html/js/css) is network-first so a new deploy reaches players on their next load; art,
// fonts and icons are served from the cache at once and refreshed in the background, so nothing stays stale for good.
// CORE must list every file the game needs to start offline: when you add a module, add it here and bump VERSION.
const VERSION = 'v2';
const CACHE = 'ikkr-dw-' + VERSION;
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'favicon.ico', 'css/style.css',
  'js/main.js',
  'js/engine/assets.js', 'js/engine/audio.js', 'js/engine/banner.js', 'js/engine/icons.js', 'js/engine/prefs.js', 'js/engine/rng.js', 'js/engine/ui.js', 'js/engine/view.js',
  'js/net/net.js',
  'js/game/actions.js', 'js/game/ai.js', 'js/game/army.js', 'js/game/choices.js', 'js/game/dialogue.js', 'js/game/diplomacy.js', 'js/game/events.js', 'js/game/family.js', 'js/game/fog.js', 'js/game/intel.js', 'js/game/items.js', 'js/game/kingdom.js', 'js/game/legacy.js', 'js/game/mapgen.js', 'js/game/names.js', 'js/game/neutral.js', 'js/game/rules.js', 'js/game/save.js', 'js/game/siege.js', 'js/game/steward.js', 'js/game/stories.js', 'js/game/trade.js', 'js/game/turn.js', 'js/game/weather.js', 'js/game/world.js',
  'js/data/art.js', 'js/data/givennames.js', 'js/data/itemicons.js', 'js/data/spells.js', 'js/data/units.js',
  'js/maps/paint.js',
  'js/campaign/goals.js', 'js/campaign/mapview.js', 'js/campaign/share.js', 'js/campaign/widgets.js',
  'js/battle/field.js', 'js/battle/fx.js', 'js/battle/sim.js',
  'js/scenes/banner.js', 'js/scenes/battle.js', 'js/scenes/campaign.js', 'js/scenes/fame.js', 'js/scenes/howto.js', 'js/scenes/lobby.js', 'js/scenes/saves.js', 'js/scenes/setup.js', 'js/scenes/title.js',
  'assets/fonts/nunito-latin-500-normal.woff2', 'assets/fonts/nunito-latin-700-normal.woff2', 'assets/fonts/nunito-latin-800-normal.woff2', 'assets/fonts/pixelify-sans-latin-400-normal.woff2', 'assets/fonts/pixelify-sans-latin-500-normal.woff2', 'assets/fonts/pixelify-sans-latin-600-normal.woff2', 'assets/fonts/pixelify-sans-latin-700-normal.woff2',
  'assets/has2020/UI/Separate/Font/MiKrollFantasy.ttf',
  'icons/icon-120.png', 'icons/icon-152.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];
const fresh = new Set();
const isCode = (url, req) => req.mode === 'navigate' || /\.(js|css|html|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // one missing file must not stop the rest from being cached
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' }))))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('ikkr-dw-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// the page sends every art file it loaded, so the whole game plays offline after the first visit
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.t !== 'keep' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const u of d.urls) {
      if (new URL(u).origin !== self.location.origin || (await c.match(u))) continue;
      try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch {}
    }
  }));
});
// keep a copy of a good same-origin response; resolves to the response once the copy is stored
function store(req, r) {
  if (!r || !r.ok || r.type !== 'basic') return Promise.resolve(r);
  const cp = r.clone();
  return caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {}).then(() => r);
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // PeerJS etc. go straight to the network
  if (isCode(url, req)) {
    // network first, but a weak signal must not hang the start: fall back to the cache after a few seconds
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const fallback = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((m) => m || (req.mode === 'navigate' ? caches.match('index.html') : null));
      const t = setTimeout(() => fallback().then((m) => { if (m && !done) { done = true; resolve(m); } }), 4000);
      const got = fetch(req);
      e.waitUntil(got.then((r) => store(req, r.clone())).catch(() => {}));
      got.then((r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
        .catch(() => fallback().then((m) => { if (!done) { done = true; clearTimeout(t); resolve(m || Response.error()); } }));
    }));
  } else {
    // cache first; re-checked in the background once per service-worker run (the HTTP cache makes that cheap)
    const hit = caches.match(req);
    const again = !fresh.has(url.pathname);
    fresh.add(url.pathname);
    const refresh = hit.then((m) => (m && !again ? null : fetch(req).then((r) => store(req, r)).catch(() => null)));
    e.respondWith(hit.then((m) => m || refresh.then((r) => r || Response.error())));
    e.waitUntil(refresh);
  }
});
