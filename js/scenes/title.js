import { prefs, setPref, buzz } from '../engine/prefs.js';
import { makeRng } from '../engine/rng.js';
import { registerScene, go, game, install } from '../main.js';
import { ctx, canvas } from '../engine/view.js';
import { h, btn, mount, modal, toggle } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { BIOMES, TREES, STRUCT } from '../data/art.js';
import { music, sfx, isMuted, setMuted } from '../engine/audio.js';

// Title backdrop: a small generated realm seen from above, slowly panning, with settlements, heroes walking the
// roads, cloud shadows drifting over the land and spring petals in the air.
import { generateTerrain } from '../game/mapgen.js';
import { renderTerrain, drawTerrain, drawGuards, drawAnimated, drawTowns, drawHeroes, drawSites, drawSeason } from '../campaign/mapview.js';
import { randomBanner } from '../engine/banner.js';
import { ROAD_SHEET } from '../maps/paint.js';

let V = null, clouds = [], t0 = 0;
const KCOL = ['#e8443a', '#3a7bf0', '#f5c630', '#3fbf5a', '#b04ce0'];
const KFID = ['castle', 'rampart', 'dwarves', 'stronghold', 'necropolis'];

function ready() {
  return [TREES, ROAD_SHEET, STRUCT, BIOMES.grass.src, BIOMES.sand.src, BIOMES.ice.src].every((s) => img(s));
}
function buildVignette() {
  const seed = 1117 + Math.floor(Math.random() * 6);
  const T = generateTerrain(seed, { size: 'small' });
  renderTerrain(T);
  const kingdoms = KCOL.map((color, i) => ({ color, fid: KFID[i], tier: i < 3 ? 'kingdom' : 'village', capital: -1, banner: randomBanner(makeRng(1234 + i * 77), color) }));
  const territories = T.territories.map((t, i) => ({ ...t, owner: i % 4 === 3 ? -1 : i % 5, level: (i * 7) % 4, ruined: 0 }));
  kingdoms.forEach((k, i) => { const c = territories.find((t) => t.owner === i); if (c) { k.capital = c.id; c.level = 3; } });
  const heroes = [];
  for (let i = 0; i < 7; i++) {
    const t = territories[(i * 5 + 2) % territories.length];
    const o = t.owner >= 0 ? t.owner : i % 5;
    heroes.push({ id: i, status: 'active', loc: t.id, kingdom: o, fid: kingdoms[o].fid, gender: i % 2 ? 'f' : 'm', portrait: i * 3 });
  }
  const sites = T.siteSpots.map((s, i) => ({ id: i, spot: i, kind: s.kind, status: 'active' }));
  // walkers: pairs of neighbouring lands joined by a road
  const walkers = [];
  for (let i = 0; i < 4; i++) {
    const a = territories[(i * 7 + 1) % territories.length];
    const b = a.nb.find((n) => !T.seaLinks.some(([x, y]) => (x === a.id && y === n) || (y === a.id && x === n)));
    if (b == null) continue;
    const o = a.owner >= 0 ? a.owner : 0;
    heroes.push({ id: 100 + i, status: 'active', loc: a.id, kingdom: o, fid: kingdoms[o].fid, gender: i % 2 ? 'm' : 'f', portrait: i * 5 + 1 });
    walkers.push({ id: 100 + i, from: a.id, to: b, speed: 0.05 + i * 0.012, ph: i * 0.27 });
  }
  V = { T, st: { territories, kingdoms, heroes, sites }, walkers };
  clouds = Array.from({ length: 10 }, (_, i) => ({ x: Math.random() * T.W * 16, y: Math.random() * T.H * 16, w: 40 + Math.random() * 60, s: 4 + Math.random() * 6 }));
}

function setupScene() { t0 = game.time; V = null; }

function cloud(x, y, w, a, col) {
  ctx.fillStyle = col.replace('A', a);
  const hh = Math.round(w * 0.3);
  ctx.fillRect(Math.round(x), Math.round(y + hh * 0.45), Math.round(w), Math.round(hh * 0.55));
  ctx.fillRect(Math.round(x + w * 0.12), Math.round(y + hh * 0.15), Math.round(w * 0.45), Math.round(hh * 0.7));
  ctx.fillRect(Math.round(x + w * 0.45), Math.round(y), Math.round(w * 0.38), Math.round(hh * 0.8));
}

function renderScene() {
  const t = game.time - t0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!V) {
    ctx.fillStyle = '#16121f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ready()) buildVignette();
    return;
  }
  const { T, st } = V;
  const z = Math.max(1, Math.round(canvas.height / 400));
  const vw = canvas.width / z, vh = canvas.height / z;
  const MW = T.W * 16, MH = T.H * 16;
  const cx = MW / 2 + Math.sin(t * 0.021) * Math.max(0, MW / 2 - vw / 2 - 20);
  const cy = MH / 2 + Math.sin(t * 0.033 + 1) * Math.max(0, MH / 2 - vh / 2 - 20);
  const vx = Math.round(cx - vw / 2), vy = Math.round(cy - vh / 2);
  const view = { x: vx, y: vy, w: vw, h: vh };
  ctx.setTransform(z, 0, 0, z, -vx * z, -vy * z); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#249fde'; ctx.fillRect(vx, vy, vw, vh);
  drawTerrain(ctx, T, view);
  drawAnimated(ctx, T, game.time, view);
  drawGuards(ctx, T, st, game.time, view);
  drawSites(ctx, st, T, game.time, view);
  drawTowns(ctx, st, game.time, view);
  const travel = new Map();
  for (const w of V.walkers) { const k = (t * w.speed + w.ph) % 2; travel.set(w.id, k < 1 ? { from: w.from, to: w.to, t: k } : { from: w.to, to: w.from, t: k - 1 }); }
  drawHeroes(ctx, st, game.time, travel, T);
  // cloud shadows on the ground, clouds above
  for (const c of clouds) {
    const x = ((c.x + t * c.s) % (MW + 200)) - 100;
    cloud(x + 26, c.y + 46, c.w, '.13', 'rgba(10,20,40,A)');
  }
  for (const c of clouds) {
    const x = ((c.x + t * c.s) % (MW + 200)) - 100;
    cloud(x, c.y, c.w, '.82', 'rgba(255,255,255,A)');
    cloud(x + 3, c.y + Math.round(c.w * 0.3) - 3, c.w - 6, '.7', 'rgba(205,215,240,A)');
  }
  drawSeason(ctx, T, 'Spring', game.time, view);
  // legibility: darken behind the logo and menu, plus a soft vignette
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = canvas.width, H = canvas.height;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(8,6,14,.74)'); g.addColorStop(0.42, 'rgba(8,6,14,.3)'); g.addColorStop(0.7, 'rgba(8,6,14,.0)'); g.addColorStop(1, 'rgba(8,6,14,.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,6,14,.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

registerScene('title', {
  enter() {
    setupScene();
    music.start('title');
    mount(h('div', { class: 'screen', style: { alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
      h('div', { class: 'logo-wrap grow', style: { alignSelf: 'flex-start', marginTop: '6vh' } },
        h('div', { class: 'logo-kicker' }, 'HEROES · ARMIES · EMPIRES'),
        h('div', { class: 'logo' }, 'Dynasty', h('br'), 'Wars'),
        h('div', { class: 'subtitle', style: { marginTop: '12px' } }, 'Conquer every realm')),
      h('div', { class: 'panel menu stagger rise-in', style: { width: 'min(42vw, 330px)' } },
        btn('Continue', () => { sfx('horn'); go('saves'); }, 'primary big'), // lists every saved campaign
        btn('New Campaign', () => { sfx('open'); go('setup', { mode: 'single' }); }),
        btn('Multiplayer', () => { sfx('open'); go('lobby'); }),
        h('div', { class: 'menu-mini' },
          btn('How to play', () => { sfx('open'); go('howto'); }, 'small wide'),
          install.standalone ? null : btn('Install on your phone', installFlow, 'small wide good'),
          btn('Hall of Fame', () => { sfx('open'); go('fame'); }, 'small'), btn('Banner', () => { sfx('open'); go('banner'); }, 'small'),
          btn('Settings', settings, 'small'), btn('Credits', credits, 'small'))),
    ));
  },
  exit() {},
  update() {},
  render() { renderScene(); },
});

function installFlow() {
  if (install.prompt) { install.prompt.prompt(); install.prompt.userChoice.finally(() => { install.prompt = null; }); return; }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  modal('Install Dynasty Wars', h('div', { class: 'col' },
    ios ? h('div', {}, 'In Safari, tap the Share button, then "Add to Home Screen".') : h('div', {}, 'Open your browser menu (⋮) and choose "Install app" or "Add to Home screen".'),
    h('div', { class: 'muted small-text' }, 'It opens full-screen like an app, keeps your saves, and plays without signal once loaded.')),
  [['OK', null, 'primary']], { dismiss: true });
}
function settings() {
  modal('Settings', h('div', { class: 'col' },
    toggle('Sound & music', !isMuted(), (on) => { setMuted(!on); if (on) { music.stop(); music.start('title'); sfx('click'); } }),
    h('div', { class: 'muted small-text' }, 'All sounds are generated live — no downloads.'),
    toggle('Low effects (older phones)', prefs.lowFx, (on) => setPref('lowFx', on)),
    h('div', { class: 'muted small-text' }, 'Turns off smoke, birds, falling snow, water glints and battle clutter for a smoother game.'),
    toggle('Vibration', prefs.haptics, (on) => { setPref('haptics', on); if (on) buzz('hit'); }),
    h('div', { class: 'muted small-text' }, 'Short buzzes on big moments (Android; iPhones don\'t allow it for web games).')),
  [['Done', null, 'primary']], { dismiss: true });
}

function credits() {
  modal('Credits', h('div', { class: 'col' },
    h('div', {}, h('span', { class: 'gold' }, 'Art: '), 'Aleksandr Makarov (IKnowKingRabbit) — HAS asset packs'),
    h('div', { class: 'muted small-text' }, 'patreon.com/iknowkingrabbit · @IKnowKingRabbit'),
    h('div', {}, h('span', { class: 'gold' }, 'Game design: '), 'Diante Clark'),
    h('div', {}, h('span', { class: 'gold' }, 'Fonts: '), 'Nunito (SIL OFL)'),
    h('div', {}, h('span', { class: 'gold' }, 'Networking: '), 'PeerJS'),
  ), [['Close', null, 'primary']], { dismiss: true });
}
