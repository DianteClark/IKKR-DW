import { resize, attachGestures, canvas, ctx, screen, sizeChanged } from './engine/view.js';
import { loadAll } from './engine/assets.js';
import { allArt } from './data/art.js';
import { SPELLS } from './data/spells.js';
import { clearUI } from './engine/ui.js';

// Scene manager. A scene has: enter(args), exit(), update(dt), render(), and optional gesture handlers.
const scenes = {};
export const game = { scene: null, time: 0 };

export function registerScene(name, scene) { scene.__name = name; scenes[name] = scene; }

export function go(name, args) {
  if (game.scene && game.scene.exit) game.scene.exit();
  clearUI();
  game.scene = scenes[name];
  game.sceneName = name;
  if (game.scene.enter) game.scene.enter(args || {});
}

function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
  frame.last = now;
  game.time += dt;
  const s = game.scene;
  // catch every size change (rotation, URL bar, fullscreen, split view) before drawing, so art never stretches
  if ((frame.n = (frame.n || 0) + 1) % 10 === 0 && sizeChanged()) { resize(); s && s.onResize && s.onResize(); }
  if (s) {
    if (s.update) s.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14121c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (s.render) s.render();
  }
  requestAnimationFrame(frame);
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
  await Promise.all(['800 16px Nunito', '700 16px Nunito', '600 16px Nunito', '500 16px Nunito'].map((f) => document.fonts.load(f).catch(() => {})));
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
}

// keep the screen awake / fullscreen on first touch (best effort on mobile)
document.addEventListener('pointerdown', () => {
  const d = document.documentElement;
  if (!document.fullscreenElement && d.requestFullscreen && matchMedia('(pointer:coarse)').matches) {
    d.requestFullscreen({ navigationUI: 'hide' }).then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
}, { once: true });

// keep the screen from sleeping while the game is open (Screen Wake Lock; re-taken whenever we come back)
let wake = null;
async function stayAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { wake = null; }
}
document.addEventListener('pointerdown', stayAwake);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stayAwake(); });

// offline play
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
// "Add to home screen": Android gives us an event; iPhone needs instructions
export const install = { prompt: null, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.prompt = e; });

boot();
