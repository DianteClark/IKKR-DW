import { registerScene, go, game } from '../main.js';
import { ctx, canvas, screen, Camera } from '../engine/view.js';
import { h, btn, mount, modal } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { FACTION_IDS, FACTIONS, BIOMES, TILE, drawUnit, drawHero } from '../data/art.js';
import { hasSave } from '../game/save.js';

const cam = new Camera();
let marchers = [];

function makeMarchers() {
  marchers = [];
  let lane = 0;
  for (const fid of FACTION_IDS) {
    const n = FACTIONS[fid].units.length;
    for (let i = 0; i < 6; i++) {
      marchers.push({ fid, ui: (i + lane) % n, stage: i % 2 ? 2 : 1, x: 400 - i * 18 + lane * 97, lane, hero: i === 0 });
    }
    lane++;
  }
}

registerScene('title', {
  enter() {
    makeMarchers();
    const save = hasSave();
    mount(h('div', { class: 'screen center' },
      h('div', { class: 'panel col', style: { alignItems: 'stretch', minWidth: '260px', background: 'rgba(38,34,54,.92)' } },
        h('h1', { class: 'title' }, 'Dynasty Wars'),
        h('div', { class: 'subtitle' }, 'Conquer every realm'),
        save ? btn('Continue', () => go('campaign', { load: true }), 'primary') : null,
        btn('New Campaign', () => go('setup', { mode: 'single' }), save ? '' : 'primary'),
        btn('Multiplayer (2 players)', () => go('lobby')),
        btn('Credits', credits, 'small'),
      )));
  },
  update(dt) {
    for (const m of marchers) m.x += dt * 14;
  },
  render() {
    cam.zoom = Math.max(1, Math.round(screen.h / 200 * screen.dpr) / screen.dpr);
    const vw = screen.w / cam.zoom, vh = screen.h / cam.zoom;
    cam.x = vw / 2; cam.y = vh / 2;
    cam.apply();
    const grass = img(BIOMES.grass.src);
    if (grass) {
      for (let y = 0; y < vh + 16; y += 16) for (let x = 0; x < vw + 16; x += 16) {
        const t = TILE.textured[((x * 7 + y * 13) >> 4) % TILE.textured.length];
        ctx.drawImage(grass, t[0], t[1], 16, 16, x, y, 16, 16);
      }
    }
    const lanes = FACTION_IDS.length;
    const sorted = [...marchers].sort((a, b) => a.lane - b.lane);
    for (const m of sorted) {
      const y = 24 + (m.lane / (lanes - 1)) * (vh - 36);
      const W = vw + 120; const x = ((m.x % W) + W) % W - 40;
      if (m.hero) drawHero(ctx, m.fid, m.lane % 2 ? 'f' : 'm', 1, 'walk', game.time * 6, x, y, false);
      else drawUnit(ctx, m.fid, m.ui, m.stage, 'walk', game.time * 6 + m.ui, x, y, false);
    }
  },
});

function credits() {
  modal('Credits', h('div', { class: 'col' },
    h('div', {}, 'Art: Aleksandr Makarov (IKnowKingRabbit) — HAS asset packs.'),
    h('div', { class: 'muted' }, 'patreon.com/iknowkingrabbit · @IKnowKingRabbit'),
    h('div', {}, 'Game design: Diante Clark'),
    h('div', {}, 'Font: MiKroll Fantasy (HAS UI pack)'),
    h('div', { class: 'muted' }, 'Peer-to-peer: PeerJS'),
  ), [['Close']]);
}
