import { resize, attachGestures, canvas, ctx, screen, sizeChanged } from './engine/view.js';
import { loadAll } from './engine/assets.js';
import { allArt } from './data/art.js';
import { SPELLS } from './data/spells.js';
import { clearUI, modal, h } from './engine/ui.js';

// Scene manager. A scene has: enter(args), exit(), update(dt), render(), and optional gesture handlers.
const scenes = {};
export const game = { scene: null, time: 0 };
let booted = false;

export function registerScene(name, scene) { scene.__name = name; scenes[name] = scene; }

export function go(name, args) {
  try { if (game.scene && game.scene.exit) game.scene.exit(); } catch (e) { console.error(e); }
  clearUI();
  game.scene = scenes[name];
  game.sceneName = name;
  try {
    if (game.scene.enter) game.scene.enter(args || {});
  } catch (e) {
    // a broken or too-old save (or any bug on the way in) must never leave a blank screen
    console.error(e);
    if (name === 'title') throw e;
    go('title');
    modal('Something went wrong', h('div', { class: 'col' },
      h('div', {}, name === 'campaign' || name === 'battle' ? 'This campaign could not be opened. The save may be damaged or from an older version.' : 'That screen could not be opened.'),
      h('div', { class: 'muted small-text' }, String((e && e.message) || e).slice(0, 160))), [['OK', null, 'primary']]);
  }
}

function frame(now) {
  requestAnimationFrame(frame); // first, so one bad frame never stops the game loop
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
  frame.last = now;
  game.time += dt;
  const s = game.scene;
  // catch every size change (rotation, URL bar, fullscreen, split view) before drawing, so art never stretches
  if ((frame.n = (frame.n || 0) + 1) % 10 === 0 && sizeChanged()) { resize(); s && s.onResize && s.onResize(); }
  if (s) {
    try {
      if (s.update) s.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#14121c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (s.render) s.render();
    } catch (e) { if ((frame.errs = (frame.errs || 0) + 1) < 5) console.error(e); }
  }
}

async function boot() {
  resize();
  const onSize = () => { resize(); game.scene && game.scene.onResize && game.scene.onResize(); };
  window.addEventListener('resize', onSize);
  window.addEventListener('orientationchange', () => setTimeout(onSize, 250));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onSize);
  attachGestures(canvas, () => game.scene);
  const bootEl = document.getElementById('boot');
  const list = [...allArt(), ...SPELLS.map((s) => s.src)];
  await Promise.all(['16px MiKroll', '800 16px Nunito', '600 16px Nunito', '700 16px Pixelify'].map((f) => document.fonts.load(f).catch(() => {})));
  await loadAll(list, (p) => { bootEl.textContent = `Loading art… ${Math.round(p * 100)}%`; });
  bootEl.classList.add('hidden');
  // scenes register themselves on import
  await import('./scenes/title.js');
  await import('./scenes/setup.js');
  await import('./scenes/campaign.js');
  await import('./scenes/battle.js');
  await import('./scenes/lobby.js');
  await import('./scenes/saves.js');
  await import('./scenes/banner.js');
  await import('./scenes/howto.js');
  await import('./scenes/fame.js');
  go('title');
  requestAnimationFrame(frame);
  booted = true; dispatchEvent(new Event('dw-booted'));
}

// keep the screen awake / fullscreen on first touch (best effort on mobile)
document.addEventListener('pointerdown', () => {
  const d = document.documentElement;
  if (!document.fullscreenElement && d.requestFullscreen && matchMedia('(pointer:coarse)').matches) {
    d.requestFullscreen({ navigationUI: 'hide' }).then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
}, { once: true });

// keep the screen from sleeping while the game is open (Screen Wake Lock). The browser drops it whenever the page
// is hidden; it is taken again when we come back (or on the next touch if that is not allowed yet).
let wake = null, asking = false;
async function stayAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wake || asking) return;
  asking = true;
  try { const w = await navigator.wakeLock.request('screen'); wake = w; w.addEventListener('release', () => { if (wake === w) wake = null; }); } catch { wake = null; }
  asking = false;
}
document.addEventListener('pointerdown', stayAwake);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stayAwake(); });

// offline play: the service worker precaches the code; once the art has loaded we hand it the list to keep too
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    const send = () => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin) && !u.includes('/sw.js'));
      if (reg.active) reg.active.postMessage({ t: 'keep', urls });
    };
    if (booted) send(); else addEventListener('dw-booted', send, { once: true });
  }).catch(() => {});
}
// "Add to home screen": Android gives us an event; iPhone needs instructions
export const install = { prompt: null, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.prompt = e; });
window.addEventListener('appinstalled', () => { install.prompt = null; install.standalone = true; });

boot().catch((e) => {
  // a file failed to arrive (lost signal on the first visit): say so instead of hanging on "Loading"
  console.error(e);
  const el = document.getElementById('boot');
  el.classList.remove('hidden');
  el.textContent = 'Could not load the game. Check your connection and tap to try again.';
  el.addEventListener('click', () => location.reload(), { once: true });
});
