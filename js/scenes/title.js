import { registerScene, go, game } from '../main.js';
import { ctx, canvas, screen } from '../engine/view.js';
import { h, btn, mount, modal, toggle } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { FACTION_IDS, FACTIONS, BIOMES, TILE, TREES, drawUnit, drawHero, drawSpriteRef } from '../data/art.js';
import { hasSave } from '../game/save.js';
import { music, sfx, isMuted, setMuted } from '../engine/audio.js';

// Parallax title scene: sky, clouds, far ranges, a castle on the hill, two armies marching to meet.
const VIEW_H = 210; // world px visible vertically
let armies = [], clouds = [], t0 = 0;

function setupScene() {
  armies = [];
  const left = ['castle', 'rampart', 'dwarves', 'tower'], right = ['necropolis', 'inferno', 'orcs', 'stronghold'];
  const mk = (fids, dir) => fids.forEach((fid, r) => {
    const n = FACTIONS[fid].units.length;
    for (let i = 0; i < 7; i++) armies.push({ fid, ui: (i * 2 + r) % n, stage: i % 3 === 0 ? 2 : 1, i, row: r, dir, hero: i === 0, off: Math.random() * 4 });
  });
  mk(left, 1); mk(right, -1);
  clouds = Array.from({ length: 9 }, (_, i) => ({ x: i * 90 + Math.random() * 40, y: 8 + Math.random() * 46, w: 26 + Math.random() * 40, s: 2 + Math.random() * 5, d: 0.25 + Math.random() * 0.5 }));
  t0 = game.time;
}

function cloud(x, y, w) {
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  const hh = Math.round(w * 0.28);
  ctx.fillRect(Math.round(x), Math.round(y + hh * 0.45), Math.round(w), Math.round(hh * 0.55));
  ctx.fillRect(Math.round(x + w * 0.15), Math.round(y + hh * 0.15), Math.round(w * 0.45), Math.round(hh * 0.6));
  ctx.fillRect(Math.round(x + w * 0.45), Math.round(y), Math.round(w * 0.35), Math.round(hh * 0.7));
  ctx.fillStyle = 'rgba(190,205,235,.8)';
  ctx.fillRect(Math.round(x + 2), Math.round(y + hh - 2), Math.round(w - 4), 2);
}

function renderScene() {
  const z = Math.max(1, (screen.h * screen.dpr) / VIEW_H);
  const vw = canvas.width / z, vh = VIEW_H;
  const t = game.time - t0;
  ctx.setTransform(z, 0, 0, z, 0, 0); ctx.imageSmoothingEnabled = false;
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, '#2b4a8c'); g.addColorStop(0.45, '#6d8fd0'); g.addColorStop(0.75, '#f1b27a'); g.addColorStop(1, '#f6d39a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, vw + 2, vh);
  // sun
  ctx.fillStyle = 'rgba(255,236,170,.9)'; ctx.beginPath(); ctx.arc(vw * 0.72, vh * 0.48, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,236,170,.25)'; ctx.beginPath(); ctx.arc(vw * 0.72, vh * 0.48, 26, 0, Math.PI * 2); ctx.fill();
  for (const c of clouds) { const x = ((c.x + t * c.s) % (vw + 120)) - 60; cloud(x, c.y, c.w); }
  const trees = img(TREES);
  // two jagged mountain ranges, drawn as stepped pixel silhouettes
  const range = (base, amp, freq, seed, col, snow, par) => {
    const off = t * par;
    ctx.fillStyle = col;
    for (let x = 0; x < vw + 4; x += 2) {
      const X = x + off;
      const hgt = amp * (0.55 + 0.45 * Math.sin(X * freq + seed)) * (0.7 + 0.3 * Math.sin(X * freq * 2.7 + seed * 2)) + 4 * Math.abs(Math.sin(X * freq * 7 + seed));
      const top = Math.round(base - hgt);
      ctx.fillRect(x, top, 3, vh - top);
      if (snow && hgt > amp * 0.8) { ctx.fillStyle = snow; ctx.fillRect(x, top, 3, Math.round((hgt - amp * 0.8) * 0.9) + 1); ctx.fillStyle = col; }
    }
  };
  range(vh - 92, 54, 0.021, 1.3, '#5b6fa6', '#dfe8ff', 1.2);
  range(vh - 78, 40, 0.034, 4.1, '#435285', '#c7d3f2', 2.4);
  ctx.fillStyle = 'rgba(241,178,122,.18)'; ctx.fillRect(0, vh - 110, vw + 2, 40);
  // hills
  const grass = img(BIOMES.grass.src);
  const groundY = vh - 64;
  ctx.fillStyle = '#3f8a3a';
  ctx.beginPath(); ctx.moveTo(0, groundY);
  for (let x = 0; x <= vw + 8; x += 8) ctx.lineTo(x, groundY - 10 - Math.sin(x * 0.012 + 1) * 12);
  ctx.lineTo(vw + 8, vh); ctx.lineTo(0, vh); ctx.fill();
  // castle on the hill
  const castle = FACTIONS.castle.town(3);
  drawSpriteRef(ctx, castle, Math.round(vw * 0.5 - 32), Math.round(groundY - 76), 64, 64);
  // banner on castle
  ctx.fillStyle = '#0b0a10'; ctx.fillRect(Math.round(vw * 0.5 + 18), Math.round(groundY - 92), 1, 18);
  ctx.fillStyle = '#e8443a'; ctx.fillRect(Math.round(vw * 0.5 + 19), Math.round(groundY - 92 + Math.sin(t * 6)), 8, 5);
  // ground tiles
  if (grass) for (let y = groundY; y < vh + 16; y += 16) for (let x = 0; x < vw + 16; x += 16) {
    const tt = TILE.textured[((x * 7 + y * 13) >> 4) % TILE.textured.length];
    ctx.drawImage(grass, tt[0], tt[1], 16, 16, x, y, 16, 16);
  }
  // road
  ctx.fillStyle = 'rgba(120,86,48,.55)'; ctx.fillRect(0, groundY + 22, vw + 2, 20);
  ctx.fillStyle = 'rgba(80,56,30,.35)'; ctx.fillRect(0, groundY + 22, vw + 2, 2); ctx.fillRect(0, groundY + 40, vw + 2, 2);
  // armies marching toward the middle, then stopping in formation
  const sorted = [...armies].sort((a, b) => a.row - b.row);
  const travel = Math.min(t * 18, 230);
  const walking = travel < 230;
  for (const m of sorted) {
    const tx = vw * 0.5 + m.dir * -(36 + m.i * 12 + m.row * 5);
    const x = tx - m.dir * (230 - travel);
    const y = groundY + 25 + m.row * 5;
    if (m.hero) drawHero(ctx, m.fid, m.row % 2 ? 'f' : 'm', 1, 'walk', walking ? game.time * 6 + m.off : 0, x, y, m.dir < 0);
    else drawUnit(ctx, m.fid, m.ui, m.stage, walking ? 'walk' : 'idle', game.time * (walking ? 7 : 3) + m.off, x, y, m.dir < 0);
  }
  // foreground trees drifting slowly
  if (trees) {
    const span = vw + 160, off = (t * 10) % span;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97.3) % span) - off; const xx = x < -40 ? x + span : x;
      const y = vh - 14 - ((i * 37) % 9);
      ctx.drawImage(trees, 32, 16, 16, 16, Math.round(xx - 80), y, 16, 16);
      if (i % 3 === 0) ctx.drawImage(trees, 32, 16, 16, 16, Math.round(xx - 70), y + 6, 16, 16);
    }
  }
  // vignette
  const v = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.3, vw / 2, vh / 2, vw * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,6,14,.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, vw + 2, vh);
}

registerScene('title', {
  enter() {
    setupScene();
    music.start('title');
    const save = hasSave();
    mount(h('div', { class: 'screen', style: { alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
      h('div', { class: 'logo-wrap grow', style: { alignSelf: 'flex-start', marginTop: '6vh' } },
        h('div', { class: 'logo-kicker' }, 'HEROES · ARMIES · EMPIRES'),
        h('div', { class: 'logo' }, 'Dynasty', h('br'), 'Wars'),
        h('div', { class: 'subtitle', style: { marginTop: '12px' } }, 'Conquer every realm')),
      h('div', { class: 'panel menu stagger rise-in', style: { width: 'min(42vw, 330px)' } },
        save ? btn('Continue', () => { sfx('horn'); go('campaign', { load: true }); }, 'primary big') : null,
        btn('New Campaign', () => { sfx('open'); go('setup', { mode: 'single' }); }, save ? '' : 'primary big'),
        btn('Multiplayer', () => { sfx('open'); go('lobby'); }),
        h('div', { class: 'row' }, btn('Settings', settings, 'small grow'), btn('Credits', credits, 'small grow'))),
    ));
  },
  exit() {},
  update() {},
  render() { renderScene(); },
});

function settings() {
  modal('Settings', h('div', { class: 'col' },
    toggle('Sound & music', !isMuted(), (on) => { setMuted(!on); if (on) { music.stop(); music.start('title'); sfx('click'); } }),
    h('div', { class: 'muted small-text' }, 'All sounds are generated live — no downloads.')),
  [['Done', null, 'primary']], { dismiss: true });
}

function credits() {
  modal('Credits', h('div', { class: 'col' },
    h('div', {}, h('span', { class: 'gold' }, 'Art: '), 'Aleksandr Makarov (IKnowKingRabbit) — HAS asset packs'),
    h('div', { class: 'muted small-text' }, 'patreon.com/iknowkingrabbit · @IKnowKingRabbit'),
    h('div', {}, h('span', { class: 'gold' }, 'Game design: '), 'Diante Clark'),
    h('div', {}, h('span', { class: 'gold' }, 'Fonts: '), 'Pixelify Sans, MiKroll Fantasy (SIL OFL)'),
    h('div', {}, h('span', { class: 'gold' }, 'Networking: '), 'PeerJS'),
  ), [['Close', null, 'primary']], { dismiss: true });
}
