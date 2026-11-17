import { registerScene, go, game } from '../main.js';
import { ctx, screen, Camera } from '../engine/view.js';
import {
  h, btn, mount, modal, toast, clearUI, bar, sprite, sheet, tabs, segmented, oddsBar, banner, chip, statRow, stratagemCard, confirm,
} from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { FACTIONS, BIOMES } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import {
  terrainOf, hero, heroesAt, kingdomHeroes, kingdomTerritories, captivesOf, vagabondsIn, validTargets, validMoves, validSpyTargets,
  restPrice, applyOrders, collectBattles, prepareBattle, autoResolve, applyBattle, isHumanKingdom, powerAt, troopOptions, battleOdds,
  hasIntel, friendly, overlordOf, treaty, proposedMajority, totalTroops, fixPortraits,
} from '../game/world.js';
import { endTurn } from '../game/turn.js';
import { neutralActions, sitesIn, SITES, plunderYield } from '../game/neutral.js';
import { seasonOf, yearOf, SEASON_FOOD, childrenOf, wedOptions, MARRY_LEVEL, childNames } from '../game/family.js';
import { runAI } from '../game/ai.js';
import { applyAction } from '../game/actions.js';
import {
  squadCap, developCost, territoryIncome, territoryFood, heroTotals, unitName, FORMATIONS, FORMATION_IDS, HIRE_COST, isRanged, LEVEL_XP,
  soldierStats, soldierTitle, unitLevel, TIERS, tierIndex, BUILDINGS, POLICIES, EDICTS, STRATAGEMS, PROMOTE_ELITE_COST, commandPool, recruitCost, CLASS_INFO, ROLES, ROLE_LEVEL,
} from '../game/rules.js';
import { SLOTS, SLOT_NAMES, itemStatText, rarityColor } from '../game/items.js';
import { economyPreview, edictCost, canEdict, promotionStatus, loadoutOptions, loadoutSlots } from '../game/kingdom.js';
import { alliesOf, vassalsOf, opinion, realmPower, dominant, willingness } from '../game/diplomacy.js';
import { EVENT_INFO } from '../game/events.js';
import { captureScene, decisionScene } from '../game/dialogue.js';
import { renderTerrain, drawTerrain, drawOverlay, drawSites, drawTowns, drawHeroes, drawOrders, drawAnimated, drawSeason, captureFx, renderMinimap, updateMinimap, hitTest, drawLandOutline, drawGuards, TS } from '../campaign/mapview.js';
import { bannerEl } from '../engine/banner.js';
import { portrait, unitIcon, itemIcon, heroCard, orderLabel, kingdomBadge, unitCard } from '../campaign/widgets.js';
import { saveCampaign, getRecord, prettyCode, stampCampaign } from '../game/save.js';
import { sfx, music } from '../engine/audio.js';
import { net } from '../net/net.js';

const cam = new Camera();
const S = { state: null, me: 0, terrainCanvas: null, overlay: null, overlayKey: '', sel: null, target: null, busy: false, queue: null, reports: [], seed: null, orderNotes: [] };
export const campaignSession = S;
const SPELL = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
const EVENT_SPELL = { quake: 'StoneSpikes', wildfire: 'Inferno', plague: 'Curse', harvest: 'Fortune', flood: 'Quicksand', goldrush: 'Transmute', bandits: 'Berserk', outbreak: 'AnimateDead', revolt: 'Bloodlust', overthrow: 'Bloodlust', famine: 'Weakness' };
const stratIcon = (id, scale = 2) => { const s = SPELL[STRATAGEMS[id].icon]; return s && s.icon ? sprite(s.icon, 0, 0, 16, 16, scale) : null; };

function myK() { return S.state.kingdoms[S.state.players[S.me].kingdom]; }

// ---------- actions (local, or forwarded to the host) ----------
export function act(a) {
  const ok = applyAction(S.state, S.me, a);
  if (net.role === 'client') net.send({ t: 'act', a });
  else if (net.role === 'host') net.broadcastState();
  persist();
  refreshUI();
  return ok;
}
window.__dw = Object.assign(window.__dw || {}, { S, act, ccam: cam });
function persist() { if (S.state) { if (!S.state.cid) stampCampaign(S.state, net.role === 'single' ? 'single' : 'p2p'); saveCampaign(S.state, S.me, S.key || null); } }

// ---------- scene ----------
registerScene('campaign', {
  enter(args) {
    if (args.load) {
      getRecord(args.load).then((rec) => { if (!rec || !rec.state || rec.state.v !== 2) return go('title'); go('campaign', { state: rec.state, localPlayer: rec.seat || 0, key: rec.key }); });
      return;
    }
    S.key = args.key || null;
    if (args.state) fixPortraits(args.state);
    if (args.state) { S.state = args.state; S.me = args.localPlayer ?? 0; S.sel = null; S.target = null; S.queue = null; S.reports = []; }
    if (S.seed !== S.state.seed + ':' + S.state.size || !S.terrainCanvas) {
      S.seed = S.state.seed + ':' + S.state.size;
      S.T = terrainOf(S.state);
      S.terrainCanvas = renderTerrain(S.T);
      S.overlayKey = ''; S.owners = null; S.heroLocs = new Map(); S.travel = new Map();
      S.minimap = renderMinimap(S.T, S.state);
    }
    cam.bounds = { x: 0, y: 0, w: S.T.W * TS, h: S.T.H * TS, pad: 40 };
    cam.min = Math.min(screen.w / (S.T.W * TS), screen.h / (S.T.H * TS)) * 0.95;
    cam.max = 5;
    if (!args.resume) {
      const k = myK(); const hs = kingdomHeroes(S.state, k.id);
      const c = k.landless && hs.length ? S.state.territories[hs[0].loc] : S.state.territories[k.capital];
      cam.zoom = Math.max(1, Math.round(1.5 * screen.dpr) / screen.dpr);
      cam.x = c.cx * TS + 8; cam.y = c.cy * TS + 8; cam.clamp();
    }
    net.onState = (st) => { S.state = st; refreshUI(); };
    if (net.role !== 'single') setupNet();
    music.start(myK().landless ? 'tension' : 'campaign');
    buildUI();
    if (args.resume) { if (net.role !== 'client') resumeQueue(args.resume); }
    else {
      persist();
      if (net.role === 'single' && S.state.turn === 1 && !S.state.introShown) intro();
      else banner(`${seasonOf(S.state.turn)}, Year ${yearOf(S.state.turn)}`, 'blue', myK().name);
    }
  },
  exit() { net.onState = null; },
  update() {},
  render() {
    const st = S.state; if (!st) return;
    const key = st.territories.map((t) => t.owner).join(',') + '|' + st.kingdoms.map((k) => k.color).join(',');
    if (key !== S.overlayKey) {
      // lands that changed hands get a light sweep; the minimap follows
      if (S.owners) st.territories.forEach((t, i) => { if (S.owners[i] !== t.owner) captureFx(st, t.id); });
      S.owners = st.territories.map((t) => t.owner);
      S.overlayKey = key;
      if (S.minimap) { updateMinimap(S.minimap, S.T, st); drawMinimapUI(); }
    }
    trackTravel(st);
    cam.apply();
    const vw = screen.w / cam.zoom, vh = screen.h / cam.zoom;
    const view = { x: cam.x - vw / 2, y: cam.y - vh / 2, w: vw, h: vh };
    drawTerrain(ctx, S.T, view);
    drawAnimated(ctx, S.T, game.time, view);
    // banners and border guards show who holds what; the old frontier lines are an option in Settings
    if (showBorders()) drawOverlay(ctx, S.T, st, view);
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    if (S.target) {
      drawLandOutline(ctx, S.T, S.target.valid, S.target.kind === 'attack' ? '#ff4a3a' : S.target.kind === 'spy' ? '#c48bff' : '#ffffff', 2);
      for (const tid of S.target.valid) ring(st.territories[tid], S.target.kind === 'attack' ? '#ff4a3a' : S.target.kind === 'spy' ? '#c48bff' : '#ffffff', 22 + pulse * 3);
    }
    if (S.sel != null) { drawLandOutline(ctx, S.T, [S.sel], '#ffd25a', 2); ring(st.territories[S.sel], '#ffd25a', 26 + pulse * 2); }
    drawGuards(ctx, S.T, st, game.time, view);
    drawSites(ctx, st, S.T, game.time, view);
    drawTowns(ctx, st, game.time, view);
    drawHeroes(ctx, st, game.time, S.travel, S.T);
    drawOrders(ctx, st, net.role === 'single' ? null : st.players[S.me].kingdom, game.time);
    // event markers over towns
    for (const t of st.territories) {
      if (!t.fx || !t.fx.length) continue;
      const f = t.fx[0];
      const sp = SPELL[EVENT_SPELL[f.kind]];
      const im = sp && sp.icon ? img(sp.icon) : null;
      if (!im) continue;
      const bob = Math.sin(game.time * 3 + t.id) * 2;
      ctx.fillStyle = 'rgba(10,8,16,.75)'; ctx.fillRect(t.cx * TS - 2, t.cy * TS - 58 + bob, 20, 20);
      ctx.drawImage(im, 0, 0, im.width, im.height, t.cx * TS, t.cy * TS - 56 + bob, 16, 16);
    }
    drawSeason(ctx, S.T, seasonOf(st.turn), game.time, view);
    // names in screen space
    ctx.setTransform(screen.dpr, 0, 0, screen.dpr, 0, 0);
    ctx.font = '600 12px Pixelify, MiKroll, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (cam.zoom >= 0.75) for (const t of st.territories) {
      const p = cam.toScreen(t.cx * TS + 8, t.cy * TS + 18);
      if (p.x < -60 || p.y < -20 || p.x > screen.w + 60 || p.y > screen.h + 20) continue;
      const k = t.owner >= 0 ? st.kingdoms[t.owner] : null;
      const w = ctx.measureText(t.name).width + 10;
      ctx.fillStyle = 'rgba(14,12,20,.82)'; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w), 16);
      if (k) { ctx.fillStyle = k.color; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y) + 14, Math.round(w), 2); }
      ctx.fillStyle = '#000'; ctx.fillText(t.name, Math.round(p.x) + 1, Math.round(p.y) + 3);
      ctx.fillStyle = k && k.id === myK().id ? '#ffd86b' : '#f7efe0'; ctx.fillText(t.name, Math.round(p.x), Math.round(p.y) + 2);
    }
  },
  onPan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; cam.clamp(); drawMinimapUI(); },
  onPinch(cx, cy, f, mx, my) { cam.zoomAt(cx, cy, f); cam.x -= mx / cam.zoom; cam.y -= my / cam.zoom; cam.clamp(); drawMinimapUI(); },
  onGestureEnd() { cam.snapZoom(); cam.clamp(); drawMinimapUI(); },
  onTap(sx, sy) {
    if (S.busy) return;
    const w = cam.toWorld(sx, sy);
    const hit = hitTest(S.T, S.state, w.x, w.y);
    const tid = !hit ? null : hit.kind === 'hero' ? hit.tid ?? hero(S.state, hit.id).loc : hit.kind === 'site' ? ((S.state.sites || []).find((s) => s.id === hit.id) || {}).tid ?? null : hit.id;
    if (S.target) {
      if (tid != null && S.target.valid.includes(tid)) {
        for (const id of S.target.heroes) act({ type: 'order', hero: id, order: { type: S.target.kind, target: tid } });
        const nm = S.state.territories[tid].name;
        sfx(S.target.kind === 'attack' ? 'horn' : 'march');
        toast(S.target.kind === 'attack' ? `Attack ordered on ${nm}` : S.target.kind === 'spy' ? `Spies sent to ${nm}` : `Marching to ${nm}`);
        S.target = null; refreshUI();
      } else if (tid != null) {
        toast(S.target.kind === 'move' ? 'Not reachable this season — pick a glowing land' : 'Pick one of the glowing lands', 'gold');
      } else { S.target = null; refreshUI(); }
      return;
    }
    if (hit && hit.kind === 'site') { const s = (S.state.sites || []).find((x) => x.id === hit.id); if (s) toast(SITES[s.kind].name + (s.status !== 'active' ? ' (' + s.status + ')' : ''), 'gold'); }
    if (hit && hit.kind === 'hero') { const x = hero(S.state, hit.id); if (x && x.kingdom === myK().id) { S.sel = tid; refreshUI(); sfx('open'); return; } }
    S.sel = tid; if (tid != null) sfx('open'); refreshUI();
  },
  onResize() { buildUI(); },
});

function ring(t, color, r) {
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
}
function territoryAt(wx, wy) {
  const cx = Math.floor(wx / TS), cy = Math.floor(wy / TS);
  if (cx < 0 || cy < 0 || cx >= S.T.W || cy >= S.T.H) return null;
  for (const t of S.state.territories) if (Math.abs(wx - (t.cx * TS + 8)) < 26 && wy > t.cy * TS - 44 && wy < t.cy * TS + 22) return t.id;
  const id = S.T.terr[cy * S.T.W + cx];
  return id >= 0 ? id : null;
}
// heroes that changed land walk along the road to their new home over ~1.6s
function trackTravel(st) {
  const now = game.time;
  for (const h of st.heroes) {
    if (h.status !== 'active') { S.heroLocs.delete(h.id); continue; }
    const was = S.heroLocs.get(h.id);
    if (was != null && was !== h.loc && st.territories[was].nb.includes(h.loc)) S.travel.set(h.id, { from: was, to: h.loc, t: 0, t0: now });
    S.heroLocs.set(h.id, h.loc);
  }
  for (const [id, tr] of S.travel) { tr.t = Math.min(1, (now - tr.t0) / 1.6); if (tr.t >= 1) S.travel.delete(id); }
}
function drawMinimapUI() {
  if (!ui.mini || !S.minimap) return;
  const c = ui.mini, x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(S.minimap, 0, 0, c.width, c.height);
  const sx = c.width / (S.T.W * TS), sy = c.height / (S.T.H * TS);
  const vw = screen.w / cam.zoom, vh = screen.h / cam.zoom;
  x.strokeStyle = '#ffd86b'; x.lineWidth = 1.5;
  x.strokeRect((cam.x - vw / 2) * sx, (cam.y - vh / 2) * sy, vw * sx, vh * sy);
}
// jump back to your capital (or your warband, if you have no land); zooms back in if you were far out
function goHome() {
  const st = S.state, k = myK(), hs = kingdomHeroes(st, k.id);
  const own = kingdomTerritories(st, k.id);
  const tid = st.territories[k.capital] && st.territories[k.capital].owner === k.id ? k.capital : own.length ? own[0].id : hs[0] ? hs[0].loc : k.capital;
  cam.zoom = Math.max(cam.zoom, Math.max(1, Math.round(1.5 * screen.dpr) / screen.dpr));
  focus(tid); cam.x += (screen.w * 0.22) / cam.zoom; cam.clamp(); // the land panel opens on the right: keep home in view on the left
  S.sel = tid; sfx('open'); refreshUI(); drawMinimapUI();
}
function bannerIcon(k) { const el = k.banner ? bannerEl(k.banner, 1.5) : h('span', { class: 'swatch', style: { background: k.color } }); el.style.flex = 'none'; el.style.marginTop = '-4px'; return el; }
function showBorders() { try { return localStorage.getItem('ikkr-dw-borders') === '1'; } catch { return false; } }
function focus(tid) { const t = S.state.territories[tid]; cam.x = t.cx * TS + 8; cam.y = t.cy * TS + 8; cam.clamp(); }

// ---------- UI ----------
function add(el, ...c) { el.append(...c.flat().filter((x) => x != null && x !== false)); }
let ui = {};
function buildUI() {
  clearUI();
  ui.top = mount(h('div', { class: 'topbar' }));
  ui.side = mount(h('div', { class: 'side', style: { display: 'none' } }));
  ui.bottom = mount(h('div', { class: 'bottombar' }));
  // minimap: tap to jump anywhere (essential on huge and enormous maps)
  const mw = S.T.W > 150 ? 168 : 128, mh = Math.round(mw * S.T.H / S.T.W);
  ui.mini = mount(h('canvas', { class: 'minimap', width: mw * 2, height: mh * 2, style: { width: mw + 'px', height: mh + 'px' } }));
  const jump = (e) => { const r = ui.mini.getBoundingClientRect(); cam.x = (e.clientX - r.left) / r.width * S.T.W * TS; cam.y = (e.clientY - r.top) / r.height * S.T.H * TS; cam.clamp(); drawMinimapUI(); };
  ui.mini.addEventListener('pointerdown', (e) => { e.stopPropagation(); jump(e); ui.mini._drag = true; });
  ui.mini.addEventListener('pointermove', (e) => { if (ui.mini._drag) jump(e); });
  ui.mini.addEventListener('pointerup', () => { ui.mini._drag = false; });
  drawMinimapUI();
  refreshUI();
}
const sign = (n) => (n >= 0 ? '+' + n : '' + n);

export function refreshUI() {
  if (!S.state || !ui.top || game.sceneName !== 'campaign') return;
  const st = S.state, k = myK();
  const terrs = kingdomTerritories(st, k.id), heroes = kingdomHeroes(st, k.id);
  const idle = heroes.filter((x) => !x.order).length;
  const eco = economyPreview(st, k);
  const waiting = net.role !== 'single' && net.waitingFor ? net.waitingFor : null;
  const incoming = st.proposals.filter((p) => p.to === k.id).length;
  ui.top.innerHTML = '';
  add(ui.top,
    h('span', { class: 'chip row tap', style: { gap: '5px', maxWidth: '26vw', minWidth: 0, flexShrink: 1 }, onClick: realmSheet },
      bannerIcon(k), h('span', { class: 'ellipsis' }, k.landless ? 'Warband of ' + (hero(st, k.ruler) || {}).name : k.name),
      h('span', { class: 'tag gold' }, k.landless ? 'Landless' : TIERS[tierIndex(k)].name)),
    h('span', { class: 'chip gold', title: 'Gold' }, `${k.gold}g `, h('small', { class: eco.gold >= 0 ? 'good' : 'bad' }, sign(eco.gold))),
    h('span', { class: 'chip', title: 'Food' }, `🌾${Math.round(k.food)} `, h('small', { class: eco.food >= 0 ? 'good' : 'bad' }, sign(eco.food))),
    h('span', { class: 'chip ' + (k.morale < 35 ? 'bad' : ''), title: 'Morale' }, `☺${Math.round(k.morale)}`),
    h('span', { class: 'chip ' + (k.stability < 30 ? 'bad' : ''), title: 'Stability' }, `⚖${Math.round(k.stability)}`),
    h('span', { class: 'chip muted', title: `${seasonOf(st.turn)}, year ${yearOf(st.turn)}` }, `${seasonOf(st.turn).slice(0, 3)} Y${yearOf(st.turn)}`),
    h('span', { class: 'grow' }),
    btn('☰', menu, 'small'),
    btn(waiting ? waiting : idle ? `End Turn (${idle})` : 'End Turn', endTurnPressed, 'primary small'),
  );
  ui.bottom.innerHTML = '';
  const prisoners = captivesOf(st, k.id).length;
  add(ui.bottom,
    btn('⌂', goHome, 'small home-btn'),
    btn('Heroes', heroesList, 'small'),
    btn('Realm', realmSheet, 'small'),
    btn(incoming ? `Diplomacy (${incoming})` : 'Diplomacy', diplomacySheet, 'small' + (incoming ? ' primary' : '')),
    prisoners ? btn(`Prisoners (${prisoners})`, showCaptives, 'small') : null,
    btn('Chronicle', chronicle, 'small'),
  );
  if (S.target) {
    ui.side.style.display = '';
    ui.side.innerHTML = '';
    ui.side.style.bottom = 'auto';
    ui.side.append(h('div', { class: 'panel' },
      h('h3', {}, S.target.kind === 'attack' ? 'Choose where to attack' : S.target.kind === 'spy' ? 'Choose where to spy' : 'Choose where to march'),
      h('div', { class: 'muted' }, 'Tap a highlighted territory.'),
      btn('Cancel', () => { S.target = null; refreshUI(); }, 'small')));
    return;
  }
  ui.side.style.bottom = '';
  if (ui.mini) ui.mini.style.display = S.sel == null ? '' : 'none';
  if (S.sel == null) { ui.side.style.display = 'none'; return; }
  ui.side.style.display = '';
  ui.side.innerHTML = '';
  ui.side.append(territoryPanel(S.sel));
}

function territoryPanel(tid) {
  const st = S.state, t = st.territories[tid], k = myK();
  const owner = t.owner >= 0 ? st.kingdoms[t.owner] : null;
  const mine = t.owner === k.id;
  const body = h('div', { class: 'scroll grow col', style: { minHeight: 0 } });
  const stars = '★'.repeat(t.level) + '☆'.repeat(3 - t.level);
  const rel = owner && owner.id !== k.id ? relationChip(k.id, owner.id) : null;
  add(body,
    h('div', { class: 'row wrap', style: { gap: '6px' } }, kingdomBadge(owner, { race: true, none: 'Free hamlet' }), rel,
      !owner ? chip(`Militia ${t.militia || 0}`) : null,
      !owner && (t.favor || {})[k.id] ? chip(`${(t.favor[k.id] > 0 ? 'Trusts you' : 'Hates you')}`, t.favor[k.id] > 0 ? 'good' : 'bad') : null,
      !owner && t.protect ? chip(`Protected by ${st.kingdoms[t.protect.kid].name.split(' of ').pop()} ${t.protect.turns}/3`, t.protect.kid === k.id ? 'good' : 'gold') : null),
    !owner ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Free folk who answer to no crown. Take it by force, plunder it, or send a hero to protect it until it chooses to join you.') : null,
    h('div', { class: 'muted' }, `${BIOMES[t.biome].name} · ${stars}${t.ruined ? ' · ruined' : ''} · +${territoryIncome(t)}g · 🌾${territoryFood(t)}`),
    (t.fx || []).length ? h('div', { class: 'row wrap' }, t.fx.map((f) => chip(`${(EVENT_INFO[f.kind] || {}).name || f.kind} (${f.turns})`, 'bad'))) : null,
  );
  const sites = sitesIn(st, tid);
  if (sites.length) {
    add(body, h('h3', {}, 'Sites'));
    for (const s of sites) {
      const S0 = SITES[s.kind];
      const done = s.status !== 'active' && s.kind !== 'shrine' && s.kind !== 'grove';
      add(body, h('div', { class: 'card', style: { padding: '5px 8px', opacity: done ? 0.6 : 1 } },
        h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } },
          h('b', {}, S0.name + (s.kind === 'mine' && s.owner >= 0 ? ` · ${st.kingdoms[s.owner].name.split(' of ').pop()}` : '')),
          h('span', { class: 'muted', style: { fontSize: '12px' } }, done ? (s.status === 'claimed' ? 'Claimed' : 'Cleared') : S0.desc)),
        s.power && !done ? chip(`Guard ~${Math.round(s.power / 25) * 25}`, 'bad') : null));
    }
  }
  const myHere = kingdomHeroes(st, k.id).filter((x) => x.loc === tid);
  if (mine) {
    if (t.level < 3) add(body, btn(`Develop town (${developCost(t)}g)`, () => { if (!act({ type: 'develop', tid })) toast('Not enough gold'); else sfx('coin'); }, 'small'));
  }
  if (mine || (k.landless && myHere.length)) {
    const vags = vagabondsIn(st, tid);
    if (vags.length) {
      add(body, h('h3', {}, 'Wanderers here'));
      for (const v of vags) add(body, heroCard(st, v, { stats: true, order: false, badges: [v.trait], extra: btn(`Hire ${HIRE_COST}g`, () => { if (!act({ type: 'hire', hero: v.id })) toast('Not enough gold'); else { sfx('recruit'); toast(`${v.name} joins you!`, 'good'); } }, 'small good') }));
    }
  }
  if (myHere.length) {
    add(body, h('h3', {}, k.landless ? 'Your warband' : 'Your heroes'));
    if (k.landless) add(body, h('div', { class: 'muted', style: { fontSize: '13px' } }, owner ? `Raise an uprising to seize ${t.name} from ${owner.name}, or march on.` : 'March on to find land to take.'));
    for (const x of myHere) add(body, heroBlock(x));
    if (myHere.length > 1) {
      const canAtk = validTargets(st, myHere[0]).length;
      add(body, h('div', { class: 'row wrap' },
        canAtk ? btn(k.landless ? 'All rise up' : 'All attack', () => (k.landless ? myHere.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'attack', target: tid } })) : startTarget(myHere.map((x) => x.id), 'attack')), 'danger small') : null,
        btn('All rest', () => myHere.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'rest' } })), 'small'),
        btn('All drill', () => myHere.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'drill' } })), 'small')));
    }
  }
  if (!mine && (owner || !k.landless)) {
    const def = owner ? heroesAt(st, tid, owner.id) : [];
    const intel = hasIntel(st, k.id, tid);
    add(body, h('div', { class: 'row' }, h('span', {}, intel ? `Defenders: ${def.length} hero${def.length === 1 ? '' : 'es'} + town guard` : `Defenders: ${def.length ? '?' : 'town guard only'}`), intel ? chip('Scouted', 'good') : null),
      h('div', { class: 'muted' }, `Estimated strength ${intel ? Math.round(powerAt(st, tid)) : '~' + Math.round(powerAt(st, tid) / 50) * 50}`));
    if (intel) for (const d of def) add(body, heroCard(st, d, { order: false, stats: true, badges: [FORMATIONS[d.formation].name] }));
    const near = kingdomHeroes(st, k.id).filter((x) => validTargets(st, x).includes(tid));
    if (near.length) {
      const odds = battleOdds(st, { att: k.id, def: owner ? owner.id : -1, tid, attackers: near.map((x) => x.id), defenders: def.map((x) => x.id), siege: t.level >= 2 && !k.landless }, intel);
      add(body, oddsBar(odds, { left: 'All your heroes nearby', right: owner ? owner.name.split(' of ').pop() : 'Militia' }, intel));
      add(body, h('h3', {}, k.landless ? 'Rise up here' : 'Send heroes'));
      for (const x of near) {
        const set = x.order && x.order.type === 'attack' && x.order.target === tid;
        add(body, heroCard(st, x, { sel: set, extra: btn(set ? 'Cancel' : 'Attack', () => { act({ type: 'order', hero: x.id, order: set ? null : { type: 'attack', target: tid } }); if (!set) sfx('horn'); }, set ? 'small' : 'danger small') }));
      }
      const notSet = near.filter((x) => !(x.order && x.order.type === 'attack' && x.order.target === tid));
      if (notSet.length > 1) add(body, btn('Send all', () => { notSet.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'attack', target: tid } })); sfx('horn'); }, 'danger small'));
    }
    if (owner && owner.id !== k.id && !k.landless) add(body, btn('Diplomacy…', () => diplomacySheet(owner.id), 'small'));
  }
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, t.name), btn('✕', () => { S.sel = null; refreshUI(); }, 'small')),
    body);
}

function heroBlock(x) {
  const st = S.state, k = myK();
  const card = heroCard(st, x, { onClick: () => heroModal(x.id), badges: [x.trait] });
  const targets = validTargets(st, x), moves = validMoves(st, x), spies = validSpyTargets(st, x);
  const price = restPrice(st, x);
  const o = (order) => act({ type: 'order', hero: x.id, order });
  const is = (t) => x.order && x.order.type === t;
  const need = x.troops.length < squadCap(x, k) || x.hp < 100;
  const actions = h('div', { class: 'row wrap', style: { gap: '4px', margin: '2px 0 8px' } },
    targets.length ? btn(k.landless ? 'Rise up' : 'Attack', () => (k.landless ? o({ type: 'attack', target: targets[0] }) : startTarget([x.id], 'attack')), 'danger small') : null,
    moves.length ? btn('Move', () => startTarget([x.id], 'move'), 'small') : null,
    btn(need ? `Rest${price ? ' ' + price + 'g' : ''}` : 'Rest', () => o({ type: 'rest' }), 'small good' + (is('rest') ? ' sel' : '')),
    btn('Drill', () => o({ type: 'drill' }), 'small' + (is('drill') ? ' sel' : '')),
    spies.length ? btn('Spy', () => startTarget([x.id], 'spy'), 'small' + (is('spy') ? ' sel' : '')) : null,
    x.order ? btn('Clear', () => o(null), 'small') : null);
  const wild = neutralActions(st, x);
  const wildRow = wild.length ? h('div', { class: 'row wrap', style: { gap: '4px', margin: '-4px 0 8px' } }, wild.map((a) => {
    const order = { type: a.type, site: a.site, target: a.target };
    const on = x.order && x.order.type === a.type && (a.site == null || x.order.site === a.site) && (a.target == null || x.order.target === a.target);
    const label = a.label + (a.risk != null && a.risk < 1 ? ` · ${Math.round(a.risk * 100)}%` : '');
    return btn(label, () => { o(on ? null : order); if (!on) { sfx('click'); toast(a.desc); } }, 'small ' + (a.type === 'plunder' ? 'danger' : a.type === 'protect' ? 'good' : '') + (on ? ' sel' : ''));
  })) : null;
  return h('div', {}, card, actions, wildRow);
}

function startTarget(ids, kind) {
  const st = S.state, x = hero(st, ids[0]);
  const valid = kind === 'attack' ? validTargets(st, x) : kind === 'spy' ? validSpyTargets(st, x) : validMoves(st, x);
  if (!valid.length) return toast('Nowhere to go from here');
  S.target = { heroes: ids, kind, valid };
  refreshUI();
}

function relationChip(a, b) {
  const st = S.state;
  if (friendly(st, a, b)) {
    const t = treaty(st, a, b);
    if (t && t.type === 'vassal') return chip(t.a === a ? 'Your vassal' : 'Your overlord', 'blue');
    return chip('Ally', 'good');
  }
  const op = opinion(st, b, a);
  return chip(op < -40 ? 'Hostile' : op < 0 ? 'Wary' : op > 30 ? 'Friendly' : 'Neutral', op < -40 ? 'bad' : '');
}

// ---------- hero details ----------
export function heroModal(id) {
  const st = S.state; const x = hero(st, id); const k = myK();
  const editable = x.kingdom === k.id && x.status === 'active';
  let m, tab = 'squad';
  const uf = x.ufid || x.fid;
  const render = () => {
    const t = heroTotals(x, st.items);
    const cap = squadCap(x, k);
    const head = h('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } },
      portrait(x, 3.5),
      h('div', { class: 'col grow', style: { gap: '3px' } },
        h('div', { class: 'row wrap', style: { gap: '6px' } }, chip('Lv ' + x.level, 'gold'), chip(x.trait), x.role ? chip(ROLES[x.role].name, 'blue') : null, x.id === k.ruler ? chip('Ruler', 'gold') : null),
        h('div', { class: 'muted' }, `${FACTIONS[x.fid].race} · Loyalty ${x.loyalty}${x.lentTo >= 0 ? ' · lent to ' + st.kingdoms[x.lentTo].name : ''}`),
        h('div', { class: 'row wrap', style: { gap: '4px' } }, ['atk', 'def', 'lead', 'int'].map((s) => chip(`${s.toUpperCase()} ${t[s]}`))),
        h('div', { class: 'row' }, h('span', { class: 'muted', style: { width: '52px' } }, 'XP'), h('div', { class: 'grow' }, bar(x.xp / LEVEL_XP(x.level), 'xp'))),
        h('div', { class: 'row' }, h('span', { class: 'muted', style: { width: '52px' } }, 'Health'), h('div', { class: 'grow' }, bar(x.hp / 100)))));
    let content;
    const rolePick = editable && !x.role && x.level >= ROLE_LEVEL ? h('div', { class: 'card col', style: { alignItems: 'stretch', borderColor: '#ffd86b' } },
      h('b', {}, `${x.name} is ready to choose a calling`),
      h('div', { class: 'row wrap', style: { gap: '6px' } }, Object.entries(ROLES).map(([id, r]) => btn(`${r.name}${x.pendingRole === id ? ' ★' : ''}`, () => { if (act({ type: 'role', hero: x.id, role: id })) { sfx('levelup'); toast(`${x.name} becomes a ${r.name}: ${r.desc}`, 'good'); render(); } }, 'small' + (x.pendingRole === id ? ' good' : '')))),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, Object.values(ROLES).map((r) => `${r.name}: ${r.desc}`).join(' · '))) : null;
    if (tab === 'squad') {
      const list = x.troops.map((s, i) => ({ s, i })).sort((a, b) => b.s.s - a.s.s || b.s.r - a.s.r);
      content = h('div', { class: 'col' },
        h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, `${unitName(uf, x.unit, 1)} → ${unitName(uf, x.unit, 2)} → Elite`), chip(`${x.troops.length}/${cap} troops`, x.troops.length < cap ? 'gold' : ''), isRanged(uf, x.unit) ? chip('Ranged', 'blue') : null, uf === x.fid ? chip('Race match +10%', 'good') : null),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Survivors rank up and evolve. Veterans who keep surviving become named Elites as strong as a hero. Squad size grows with level (command ${cap}). Fallen soldiers are only replaced when the hero Rests.`),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))' } }, list.map(({ s, i }) => {
          const ss = soldierStats(uf, x.unit, s);
          return h('div', { class: 'card', style: { padding: '5px', gap: '6px', borderColor: s.s === 3 ? '#ffd86b' : undefined } },
            unitIcon(uf, x.unit, s.s, 2),
            h('div', { class: 'col', style: { gap: '1px', minWidth: 0 } },
              h('span', { class: 'ellipsis', style: { fontWeight: 700, color: s.s === 3 ? '#ffd86b' : undefined } }, soldierTitle(uf, x.unit, s)),
              h('span', { class: 'muted', style: { fontSize: '12px' } }, `HP ${Math.round(ss.hp)} · ATK ${ss.atk.toFixed(1)} · DEF ${ss.def.toFixed(1)}`),
              s.s === 3 && editable ? btn(`Raise to hero ${PROMOTE_ELITE_COST}g`, () => { if (act({ type: 'promoteElite', hero: x.id, idx: i })) { sfx('levelup'); toast(`${s.name} now leads their own squad!`, 'good'); render(); } else toast('Not enough gold'); }, 'tiny good') : null));
        })));
    } else if (tab === 'unit') {
      const opts = troopOptions(st, x);
      const byRace = {};
      for (const o of opts) (byRace[o.fid] = byRace[o.fid] || []).push(o);
      content = h('div', { class: 'col' },
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Mounted ride two lands a season, flyers cross the sea, casters and beasts hit hard — each needs its building. Any troops your realm can raise. ${TIERS[tierIndex(k)].name}s can field up to tier ${TIERS[tierIndex(k)].maxUnitLevel + 1}. Win land or recruit heroes of other races to unlock theirs. Changing type disbands the squad.`),
        Object.entries(byRace).map(([fid, list]) => h('div', { class: 'col', style: { gap: '4px' } },
          h('b', {}, FACTIONS[fid].race + (fid === x.fid ? ' · race match' : '')),
          h('div', { class: 'row wrap', style: { gap: '6px' } }, list.map((o) => {
            const ss = soldierStats(o.fid, o.ui, { s: 1, r: 0 });
            const sel = o.fid === uf && o.ui === x.unit;
            const card = unitCard(o.fid, o.ui, 1, { hp: ss.hp, atk: ss.atk, def: ss.def, cost: recruitCost(o.fid, o.ui) }, { sel, onClick: () => {
              if (sel || !editable) return;
              if (o.locked) return toast(`${CLASS_INFO[o.cls].name} troops need ${BUILDINGS[o.locked].name}. Build it in Realm → Build.`, 'gold');
              confirm('Change unit type?', `${x.name} disbands the current squad and will lead ${unitName(o.fid, o.ui, 1)} instead. Rest to recruit them.`, 'Change', 'Cancel', 'danger').then((ok) => { if (ok) { act({ type: 'unit', hero: x.id, ufid: o.fid, unit: o.ui }); render(); } });
            } });
            return h('div', { class: 'col', style: { gap: '2px', opacity: o.locked && !sel ? 0.55 : 1, alignItems: 'center' } }, card,
              h('span', { class: 'tag', style: { fontSize: '11px' } }, o.locked && !sel ? `🔒 ${BUILDINGS[o.locked].name}` : CLASS_INFO[o.cls].name));
          })))));
    } else if (tab === 'gear') {
      content = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))' } }, SLOTS.map((slot) => {
        const it = x.gear[slot] != null ? st.items[x.gear[slot]] : null;
        return h('div', { class: 'card tap', onClick: editable ? () => pickItem(x, slot, () => render()) : null },
          it ? itemIcon(it, 2.5) : h('span', { class: 'spr', style: { width: '40px', height: '40px', border: '2px dashed #4a4260', borderRadius: '3px' } }),
          h('div', { class: 'col', style: { gap: '1px', minWidth: 0 } }, h('span', { class: 'muted', style: { fontSize: '12px' } }, SLOT_NAMES[slot]),
            h('span', { style: { color: it ? rarityColor(it.rarity) : '#6b6380', fontWeight: 700 } }, it ? it.name : 'Empty'),
            it ? h('span', { class: 'muted', style: { fontSize: '12px' } }, itemStatText(it)) : null));
      }));
    } else if (tab === 'family') {
      const sp = x.spouse > 0 ? hero(st, x.spouse) : null;
      const kids = childrenOf(st, x);
      const parents = (x.parents || []).map((p) => hero(st, p)).filter(Boolean);
      const opts = editable && !sp ? wedOptions(st, x) : [];
      const expecting = x.expecting ? x : sp && sp.expecting ? sp : null;
      content = h('div', { class: 'col' },
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Married heroes may have a child a year later. Heirs train in a parent's squad and become heroes at Elite. Marry from level ${MARRY_LEVEL}.`),
        parents.length ? h('div', { class: 'row wrap' }, h('b', {}, 'Parents:'), parents.map((p) => h('span', { class: 'chip tap', onClick: () => { m.close(); heroModal(p.id); } }, p.name))) : null,
        h('div', { class: 'row wrap' }, h('b', {}, 'Spouse:'), sp ? h('span', { class: 'chip good tap', onClick: () => { m.close(); heroModal(sp.id); } }, sp.name + (sp.status !== 'active' ? ` (${sp.status})` : '')) : h('span', { class: 'muted' }, x.widowed ? 'Widowed' : 'Unmarried')),
        expecting ? h('div', { class: 'chip gold' }, `Expecting a child in ${seasonOf(expecting.expecting + 4)} of year ${yearOf(expecting.expecting + 4)}`) : null,
        h('b', {}, `Children (${kids.length})`),
        kids.length ? h('div', { class: 'col', style: { gap: '4px' } }, kids.map((c) => c.hero
          ? h('div', { class: 'card tap', onClick: () => { m.close(); heroModal(c.hero.id); } }, portrait(c.hero, 2), h('span', { class: 'grow' }, `${c.hero.name} · hero, Lv ${c.hero.level}`))
          : h('div', { class: 'card' }, unitIcon(c.with.ufid || c.with.fid, c.with.unit, c.soldier.s, 2), h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, c.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, `Training in ${c.with.name}'s squad · stage ${c.soldier.s} of 3`))))) : h('div', { class: 'muted' }, 'None yet.'),
        opts.length ? h('b', {}, 'Arrange a marriage') : null,
        opts.length ? h('div', { class: 'row wrap' }, opts.map((o) => btn(`${o.name} · Lv ${o.level}`, () => { if (act({ type: 'wed', a: x.id, b: o.id })) { sfx('levelup'); toast(`${x.name} and ${o.name} are wed!`, 'good'); render(); } }, 'small'))) : null,
        editable && !sp && !opts.length ? h('div', { class: 'muted', style: { fontSize: '13px' } }, x.level < MARRY_LEVEL ? `Reaches marrying age at level ${MARRY_LEVEL}.` : 'No unmarried hero of the opposite gender in your realm is ready to wed.') : null);
    } else {
      const sp = SPELL[x.spell];
      const allies = alliesOf(st, k.id).map((a) => st.kingdoms[a]);
      content = h('div', { class: 'col' },
        h('b', {}, 'Default formation'),
        segmented(FORMATION_IDS.map((f) => ({ value: f, label: FORMATIONS[f].name })), x.formation, (f) => { if (editable) act({ type: 'formation', hero: x.id, formation: f }); render(); }),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, FORMATIONS[x.formation].desc + ' Switching formation mid-battle takes a few seconds.'),
        sp ? h('div', { class: 'row' }, sp.icon ? sprite(sp.icon, 0, 0, 16, 16, 2.5) : null, h('span', {}, `Special: ${sp.name}`)) : null,
        editable && x.id !== k.ruler && allies.length ? h('b', {}, 'Lend to an ally') : null,
        editable && x.id !== k.ruler && x.lentTo < 0 ? h('div', { class: 'row wrap' }, allies.map((a) => btn(a.name, () => { act({ type: 'lend', hero: x.id, ally: a.id }); toast(`${x.name} marches to aid ${a.name}`); m.close(); }, 'small'))) : null,
        editable && x.lentTo >= 0 ? btn('Recall', () => { act({ type: 'recall', hero: x.id }); render(); }, 'small') : null,
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Lent heroes fight in your ally\'s battles and gain experience — but a disloyal hero may decide to stay with them.'));
    }
    const body = h('div', { class: 'col' }, head, rolePick,
      tabs([{ id: 'squad', label: 'Squad' }, { id: 'unit', label: 'Unit type' }, { id: 'gear', label: 'Gear' }, { id: 'family', label: 'Family' }, { id: 'more', label: 'Tactics' }], (id) => { tab = id; render(); }, tab), content);
    if (m) m.box.querySelector('.body').replaceChildren(body); else m = sheet(x.name, body, [], { side: 'right' });
  };
  render();
}

function pickItem(x, slot, done) {
  const st = S.state, k = myK();
  const list = k.items.map((id) => st.items[id]).filter((it) => it && it.slot === slot).sort((a, b) => b.rarity - a.rarity);
  const cur = x.gear[slot] != null ? st.items[x.gear[slot]] : null;
  let mm;
  const body = h('div', { class: 'col' },
    cur ? h('div', { class: 'card' }, itemIcon(cur), h('span', { class: 'grow' }, `Equipped: ${cur.name} — ${itemStatText(cur)}`), btn('Remove', () => { act({ type: 'unequip', hero: x.id, slot }); mm.close(); done(); }, 'small')) : null,
    list.length ? list.map((it) => h('div', { class: 'card' }, itemIcon(it), h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { style: { color: rarityColor(it.rarity), fontWeight: 700 } }, it.name), h('span', { class: 'muted', style: { fontSize: '13px' } }, itemStatText(it))),
      btn('Equip', () => { act({ type: 'equip', hero: x.id, item: it.id }); sfx('coin'); mm.close(); done(); }, 'small good'))) : h('div', { class: 'muted' }, `No spare ${SLOT_NAMES[slot].toLowerCase()} in your armory. Win battles to find more.`));
  mm = modal(SLOT_NAMES[slot], body, [['Close']], { dismiss: true });
}

function heroesList() {
  const st = S.state, k = myK();
  const hs = kingdomHeroes(st, k.id, true);
  let mm;
  const body = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))' } }, hs.map((x) => h('div', {},
    heroCard(st, x, { stats: true, badges: [x.trait], onClick: () => { mm.close(); heroModal(x.id); } }),
    h('div', { class: 'row', style: { gap: '4px', marginTop: '3px' } }, h('span', { class: 'muted grow', style: { fontSize: '13px' } }, `at ${st.territories[x.loc].name}`),
      btn('Show', () => { mm.close(); S.sel = x.loc; focus(x.loc); refreshUI(); }, 'small')))));
  mm = sheet(`Your heroes (${hs.length}) · ${totalTroops(st, k.id)} troops`, body, [], { side: 'right' });
}

// ---------- realm management ----------
function realmSheet() {
  const st = S.state, k = myK();
  let tab = 'overview', m;
  const render = () => {
    const eco = economyPreview(st, k);
    const prom = promotionStatus(st, k.id);
    let content;
    if (tab === 'overview') {
      content = h('div', { class: 'col' },
        h('div', { class: 'row wrap', style: { gap: '6px' } }, kingdomBadge(k, { race: true }), chip(k.landless ? 'Landless warband' : TIERS[tierIndex(k)].name, 'gold')),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, k.landless ? 'You have no land. Wander, hire wanderers and raise an uprising to seize a territory. The war is lost only when your last hero falls.' : TIERS[tierIndex(k)].desc),
        statRow('Lands', `${eco.lands}`), statRow('Heroes / troops', `${kingdomHeroes(st, k.id, true).length} / ${eco.soldiers}`),
        statRow('Gold per turn', `${sign(eco.gold)}${eco.tributeOut ? ` (−${eco.tributeOut} tribute)` : ''}${eco.tributeIn ? ` (+${eco.tributeIn} tribute)` : ''}`),
        statRow('Food per turn', `${sign(eco.food)}  (grown ${eco.foodMade}, eaten ${eco.foodEaten})`),
        statRow('Season', `${seasonOf(st.turn)}, year ${yearOf(st.turn)} · harvest ×${SEASON_FOOD[seasonOf(st.turn)]}`),
        h('div', { class: 'row' }, h('span', { style: { width: '90px' } }, 'Morale'), h('div', { class: 'grow' }, bar(k.morale / 100, 'mor')), h('b', {}, Math.round(k.morale))),
        h('div', { class: 'row' }, h('span', { style: { width: '90px' } }, 'Stability'), h('div', { class: 'grow' }, bar(k.stability / 100)), h('b', {}, Math.round(k.stability))),
        k.stability < 30 ? h('div', { class: 'bad', style: { fontSize: '13px' } }, 'Low stability breeds revolts. Very low stability and morale can overthrow you!') : null,
        k.food < 0 || eco.food < 0 ? h('div', { class: 'bad', style: { fontSize: '13px' } }, 'Food is running out. Famine makes soldiers desert.') : null,
        prom ? h('div', { class: 'card col', style: { alignItems: 'stretch' } },
          h('b', {}, `Become a${prom.next.id === 'empire' ? 'n' : ''} ${prom.next.name}`),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, `${prom.need}. You have ${prom.heroes} heroes, ${prom.troops} soldiers, ${prom.lands} lands.`),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, prom.next.desc),
          btn(`Proclaim (${prom.cost}g)`, () => { if (act({ type: 'promoteRealm' })) { sfx('victory'); banner(`${prom.next.name.toUpperCase()}!`, 'good', k.name); render(); } else toast(!prom.ok ? 'Requirements not met' : 'Not enough gold'); }, prom.ok && prom.afford ? 'primary' : '')) : null);
    } else if (tab === 'policy') {
      const edicts = Object.entries(EDICTS).map(([id, e]) => {
        const c = edictCost(st, k, id);
        const ok = canEdict(st, k.id, id);
        return h('div', { class: 'card', style: { gap: '8px' } }, h('div', { class: 'col grow', style: { gap: '1px' } }, h('b', {}, e.name), h('span', { class: 'muted', style: { fontSize: '13px' } }, e.desc)),
          btn(`${c.gold ? c.gold + 'g ' : ''}${c.food ? c.food + '🌾' : ''}${!c.gold && !c.food ? 'Free' : ''}`, () => { if (act({ type: 'edict', edict: id })) { sfx('horn'); toast(`${e.name} proclaimed`, 'good'); render(); } }, 'small' + (ok ? ' primary' : '')));
      });
      content = h('div', { class: 'col' },
        h('b', {}, 'Taxes'), segmented(Object.entries(POLICIES.tax).map(([v, p]) => ({ value: v, label: p.name })), k.policy.tax, (v) => { act({ type: 'policy', kind: 'tax', value: v }); render(); }),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'High taxes fill the treasury but sour morale and stability.'),
        h('b', {}, 'Rations'), segmented(Object.entries(POLICIES.rations).map(([v, p]) => ({ value: v, label: p.name })), k.policy.rations, (v) => { act({ type: 'policy', kind: 'rations', value: v }); render(); }),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Feasts lift morale but eat your stores.'),
        h('b', {}, k.edictTurn === st.turn ? 'Edict (used this turn)' : 'One edict per turn'), edicts);
    } else if (tab === 'build') {
      content = h('div', { class: 'col' }, Object.entries(BUILDINGS).map(([id, b]) => {
        const have = k.buildings[id], can = tierIndex(k) >= b.tier;
        return h('div', { class: 'card', style: { gap: '8px' } }, h('div', { class: 'col grow', style: { gap: '1px' } }, h('b', {}, b.name), h('span', { class: 'muted', style: { fontSize: '13px' } }, b.desc + (can ? '' : ` Requires ${TIERS[b.tier].name}.`))),
          have ? chip('Built', 'good') : btn(`${b.cost}g`, () => { if (act({ type: 'build', building: id })) { sfx('coin'); render(); } else toast(can ? 'Not enough gold' : 'Grow your realm first'); }, 'small' + (can && k.gold >= b.cost ? ' primary' : '')));
      }));
    } else {
      const opts = loadoutOptions(st, k.id), n = loadoutSlots(st, k.id);
      const cur = [...(k.loadout || [])];
      content = h('div', { class: 'col' },
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Choose up to ${n} stratagem${n > 1 ? 's' : ''} to bring into every battle. Each can be used once per battle and costs command points (smart heroes give you more). Grow your realm to unlock more.`),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))' } },
          Object.keys(STRATAGEMS).map((id) => {
            const s = STRATAGEMS[id], ok = opts.includes(id), sel = cur.includes(id);
            return stratagemCard({ name: s.name, icon: stratIcon(id, 2.5), cost: s.cost, desc: ok ? s.desc : `Unlocks as a ${TIERS[s.tier].name}`, selected: sel, disabled: !ok, onClick: () => {
              if (!ok) return;
              const next = sel ? cur.filter((x) => x !== id) : [...cur, id].slice(-n);
              act({ type: 'loadout', ids: next }); render();
            } });
          })));
    }
    const body = h('div', { class: 'col' }, tabs([{ id: 'overview', label: 'Realm' }, { id: 'policy', label: 'Edicts' }, { id: 'build', label: 'Build' }, { id: 'strat', label: 'Stratagems' }], (id) => { tab = id; render(); }, tab), content);
    if (m) m.box.querySelector('.body').replaceChildren(body); else m = sheet(k.name, body, [], { side: 'right' });
  };
  render();
}

// ---------- diplomacy ----------
function diplomacySheet(focusKid) {
  const st = S.state, k = myK();
  let m;
  const render = () => {
    const dom = dominant(st);
    const incoming = st.proposals.filter((p) => p.to === k.id);
    const mine = st.treaties.filter((t) => t.type === 'alliance' && (t.a === k.id || t.b === k.id));
    const proposedByMe = mine.filter((t) => t.proposer === k.id).length;
    const realms = st.kingdoms.filter((o) => o.alive && o.id !== k.id).sort((a, b) => (b.id === focusKid) - (a.id === focusKid) || realmPower(st, b.id) - realmPower(st, a.id));
    const body = h('div', { class: 'col' },
      incoming.length ? h('b', {}, 'Offers to you') : null,
      incoming.map((p) => {
        const from = st.kingdoms[p.from];
        const what = p.type === 'vassal' ? 'demands you swear fealty (pay a fifth of your income in tribute)' : `offers an ${p.type}`;
        return h('div', { class: 'card col', style: { alignItems: 'stretch' } }, h('div', { class: 'row wrap' }, kingdomBadge(from, { race: true }), h('span', {}, what)),
          h('div', { class: 'row' }, btn('Accept', () => { act({ type: 'respond', id: p.id, accept: true }); sfx('coin'); render(); refreshUI(); }, 'small good'), btn('Refuse', () => { act({ type: 'respond', id: p.id, accept: false }); render(); refreshUI(); }, 'small danger')));
      }),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, `Alliance victory: rule the whole map with your allies — but only if you proposed most of your own alliances. You proposed ${proposedByMe} of ${mine.length}${mine.length && !proposedByMe * 2 > mine.length ? '' : ''}${mine.length ? (proposedMajority(st, k.id) ? ' ✓' : ' ✗') : ''}.${dom >= 0 ? ` ${st.kingdoms[dom].name} dominates the map; others will band together against it.` : ''}`),
      realms.map((o) => {
        const t = treaty(st, k.id, o.id);
        const op = opinion(st, o.id, k.id);
        const pw = realmPower(st, o.id) / Math.max(1, realmPower(st, k.id));
        const acts = [];
        if (!k.landless && o.kind !== 'monster') {
          if (!t) {
            acts.push(btn('Propose alliance', () => { const r = act({ type: 'propose', to: o.id, kind: 'alliance' }); toast(r === 'accepted' ? `${o.name} accepts!` : r === 'pending' ? 'Offer sent' : `${o.name} refuses.`, r === 'accepted' ? 'good' : r === 'pending' ? '' : 'bad'); sfx(r === 'accepted' ? 'victory' : 'click'); render(); refreshUI(); }, 'small'));
            if (tierIndex(k) >= 2 && pw < 0.6) acts.push(btn('Demand fealty', () => { const r = act({ type: 'propose', to: o.id, kind: 'vassal' }); toast(r === 'accepted' ? `${o.name} bends the knee!` : r === 'pending' ? 'Demand sent' : `${o.name} defies you!`, r === 'accepted' ? 'good' : 'bad'); render(); refreshUI(); }, 'small danger'));
          } else acts.push(btn(t.type === 'vassal' ? (t.a === k.id ? 'Release vassal' : 'Renounce oath') : 'Break alliance', () => confirm('Break this pact?', 'Every realm will remember your betrayal. Stability drops.', 'Break it', 'Keep', 'danger').then((ok) => { if (ok) { act({ type: 'break', other: o.id }); render(); refreshUI(); } }), 'small danger'));
        }
        const wl = t ? null : willingness(st, o.id, k.id, 'alliance');
        return h('div', { class: 'card col', style: { alignItems: 'stretch', borderColor: o.id === focusKid ? '#ffd86b' : undefined } },
          h('div', { class: 'row wrap', style: { gap: '6px' } }, kingdomBadge(o, { race: true }), relationChip(k.id, o.id), o.kind !== 'realm' ? chip(o.kind === 'bandit' ? 'Bandits' : o.kind === 'monster' ? 'Monsters' : 'Rebels', 'bad') : null, o.player >= 0 ? chip('Player', 'blue') : null),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, `${kingdomTerritories(st, o.id).length} lands · strength ${pw > 1.5 ? 'far stronger' : pw > 1.1 ? 'stronger' : pw > 0.8 ? 'even' : pw > 0.5 ? 'weaker' : 'far weaker'} · opinion ${Math.round(op)}${wl != null ? ` · ${wl > 0.5 ? 'open to an alliance' : wl > 0.3 ? 'unsure' : 'unwilling'}` : ''}`),
          acts.length ? h('div', { class: 'row wrap' }, acts) : null);
      }));
    if (m) m.box.querySelector('.body').replaceChildren(body); else m = sheet('Diplomacy', body, [], { side: 'right' });
  };
  render();
}

function chronicle() {
  const st = S.state;
  const body = h('div', { class: 'log' }, [...st.log].reverse().slice(0, 150).map((l) => h('div', { class: l.kind || '' }, h('span', { class: 'muted' }, `${seasonOf(l.turn).slice(0, 3)} Y${yearOf(l.turn)} `), l.text)));
  sheet('Chronicle', body, [], { side: 'right' });
}

function menu() {
  modal('Menu', h('div', { class: 'col' },
    h('div', { class: 'row wrap' }, h('span', { class: 'chip gold' }, `Campaign ${prettyCode(S.state.cid)}`), h('span', { class: 'chip' }, `Seed ${S.state.seed}`), h('span', { class: 'chip' }, `${seasonOf(S.state.turn)}, year ${yearOf(S.state.turn)}`)),
    net.role === 'single' ? h('div', { class: 'muted' }, 'Your campaign saves automatically every season. Find it under Continue.') : h('div', { class: 'muted' }, `Two-player · ${net.role === 'host' ? 'You are hosting' : 'Connected to host'}. Both of you keep a copy of this campaign — either of you can host it again from Continue.`)),
  [['Resume'], ['Quit to title', () => { if (net.role !== 'single') net.close(); go('title'); }, 'danger']], { dismiss: true });
}

function intro() {
  S.state.introShown = true;
  const k = myK();
  modal(`Welcome, ${hero(S.state, k.ruler)?.name || 'ruler'}`, h('div', { class: 'col' },
    h('div', {}, `You rule the village of ${S.state.territories[k.capital].name}. Every other land belongs to a rival.`),
    h('div', {}, '• Tap your town to command heroes: attack, move, rest (heal and recruit), drill or spy.'),
    h('div', {}, '• Grow from Village to Kingdom to Empire to unlock troops, stratagems and buildings.'),
    h('div', {}, '• Keep morale, food and stability up or face famine and revolt.'),
    h('div', {}, '• Make allies, demand fealty, lend heroes — and beware of traitors.'),
    h('div', {}, '• You lose only when your last hero falls.'),
  ), [['To war!', () => { sfx('horn'); banner('Spring, Year 1', 'blue', k.name); }, 'primary']]);
}

// ---------- captives ----------
function dialogueBox(lines) {
  return h('div', { class: 'col', style: { gap: '6px' } }, lines.map((l) => h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } },
    l.hero ? portrait(l.hero, 2) : null,
    h('div', { class: 'card', style: { flex: 1, padding: '6px 10px' } }, h('b', {}, l.hero ? l.hero.name.split(' ')[0] + ': ' : ''), `“${l.text}”`))));
}
export function showCaptives() {
  const st = S.state, k = myK();
  const list = captivesOf(st, k.id);
  if (!list.length) { st.pendingCaptives = []; return; }
  const x = list[0];
  const ruler = hero(st, k.ruler);
  const was = x.kingdom >= 0 ? st.kingdoms[x.kingdom] : null;
  let mm;
  const decide = (d) => {
    const r = act({ type: 'captive', hero: x.id, decision: d });
    sfx(d === 'execute' ? 'execute' : d === 'recruit' && r === 'joined' ? 'recruit' : 'click');
    mm.close();
    modal(d === 'recruit' ? (r === 'joined' ? `${x.name} joins you` : `${x.name} refuses`) : d === 'execute' ? 'Executed' : 'Released',
      dialogueBox(decisionScene(ruler, x, d, r, st.turn + x.id)), [['Continue', () => { if (captivesOf(S.state, k.id).length) showCaptives(); }, 'primary']]);
  };
  const body = h('div', { class: 'col' },
    dialogueBox(captureScene(ruler, x, st.turn + x.id)),
    heroCard(st, x, { stats: true, order: false, badges: [x.trait] }),
    h('div', { class: 'muted', style: { fontSize: '13px' } }, `Formerly of ${was ? was.name : 'no realm'} · loyalty to them ${x.loyalty}. Recruiting may fail. Executing angers their people and your heroes of the same race. Released heroes wander — they may serve another lord or raise an uprising.`));
  st.pendingCaptives = [];
  mm = modal(`Prisoner: ${x.name}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`, body,
    [['Later'], ['Execute', () => decide('execute'), 'danger'], ['Release', () => decide('release')], ['Recruit', () => decide('recruit'), 'good']], { width: '640px' });
}

// ---------- multiplayer glue ----------
function setupNet() {
  net.onClose = () => { net.close(); modal('Connection lost', h('div', {}, 'The other player disconnected.'), [['Title screen', () => go('title'), 'primary']]); };
  if (net.role === 'host') {
    net.stateGetter = () => S.state;
    net.on('act', (m) => { applyAction(S.state, 1, m.a); net.broadcastState(); refreshUI(); });
    net.on('ready', () => {
      net.peerReady = true;
      if (net.hostReady && !S.busy) resolveTurn();
      else { toast('Player 2 is ready'); refreshUI(); }
    });
  } else {
    net.on('askFight', (m) => preBattle(m.b, (choice) => net.reply(m.rid, choice)));
    net.on('resolving', () => { S.busy = true; net.waitingFor = 'Resolving turn…'; refreshUI(); });
    net.on('battleStart', (m) => go('battle', { client: true, setup: m.setup, items: m.items, me: S.me, state: S.state }));
    net.on('turnDone', (m) => {
      S.busy = false; net.waitingFor = null;
      if (m.s) S.state = m.s;
      persist();
      refreshUI();
      showTurnSummary(m.turn - 1, m.reports || [], m.summary || { events: [], notes: [] }, m.orderNotes || []);
    });
  }
}

// ---------- turn flow ----------
function endTurnPressed() {
  if (S.busy) return;
  sfx('click');
  if (net.role === 'client') { net.send({ t: 'ready' }); net.waitingFor = 'Waiting for host…'; refreshUI(); return; }
  if (net.role === 'host') { net.hostReady = true; net.waitingFor = net.peerReady ? null : 'Waiting for player 2…'; refreshUI(); if (net.peerReady) resolveTurn(); return; }
  resolveTurn();
}

export function resolveTurn() {
  const st = S.state;
  S.busy = true; S.target = null; S.sel = null;
  net.hostReady = false; net.peerReady = false; net.waitingFor = null;
  runAI(st);
  S.orderNotes = applyOrders(st);
  S.queue = collectBattles(st);
  const human = (b) => isHumanKingdom(st, b.att) || isHumanKingdom(st, st.territories[b.tid].owner);
  S.queue.sort((a, b) => human(b) - human(a));
  S.reports = [];
  if (net.role === 'host') { net.send({ t: 'resolving' }); net.broadcastState(); }
  refreshUI();
  nextBattle();
}

function nextBattle() {
  const st = S.state;
  while (S.queue.length) {
    const b = prepareBattle(st, S.queue.shift());
    if (!b) continue;
    const humanAtt = isHumanKingdom(st, b.att), humanDef = isHumanKingdom(st, b.def);
    if (!humanAtt && !humanDef) { S.reports.push(applyBattle(st, b, autoResolve(st, b))); continue; }
    S.current = b;
    askFight(b, humanAtt, humanDef);
    return;
  }
  finishTurn();
}

// battle preview: odds, matchups, stratagems and formations
function preBattle(b, choose) {
  const st = S.state, k = myK();
  const t = st.territories[b.tid];
  const A = st.kingdoms[b.att], D = b.def >= 0 ? st.kingdoms[b.def] : null;
  const mineSide = b.att === k.id ? 'att' : 'def';
  const enemyK = mineSide === 'att' ? D : A;
  const intel = mineSide === 'att' ? hasIntel(st, k.id, b.tid) : true;
  const p = battleOdds(st, b, intel);
  const myP = mineSide === 'att' ? p : 1 - p;
  const mine = (mineSide === 'att' ? b.attackers : b.defenders).map((id) => hero(st, id)).filter((x) => x.kingdom === k.id);
  const theirs = (mineSide === 'att' ? b.defenders : b.attackers).map((id) => hero(st, id));
  const slots = loadoutSlots(st, k.id), opts = loadoutOptions(st, k.id);
  const pool = commandPool(mine, tierIndex(k), k.buildings.academy);
  sfx('alert');
  const body = h('div', { class: 'col' },
    h('div', { class: 'muted' }, `${A.name} attacks ${t.name}${D ? `, held by ${D.name}` : ''}.${b.siege ? ' The town is walled: a siege.' : ''}${b.landless ? ' An uprising!' : ''}`),
    oddsBar(myP, { left: 'You', right: enemyK ? enemyK.name.split(' of ').pop() : 'Guard' }, intel),
    !intel ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Unscouted: enemy heroes, formations and stratagems are unknown. Send a spy first for exact odds.') : null,
    h('div', { class: 'row wrap', style: { gap: '10px' } },
      h('div', { class: 'col', style: { gap: '4px' } }, h('b', {}, 'Your heroes'), h('div', { class: 'row wrap' }, mine.map((x) => portrait(x, 2)))),
      h('div', { class: 'col', style: { gap: '4px' } }, h('b', {}, 'Enemy'), h('div', { class: 'row wrap' }, intel ? theirs.map((x) => portrait(x, 2)) : theirs.length ? [chip(`${theirs.length} hero${theirs.length > 1 ? 'es' : ''}`)] : [chip('Town guard')]),
        intel && enemyK ? h('div', { class: 'row wrap' }, (enemyK.loadout || []).map((id) => chip(STRATAGEMS[id].name, 'bad'))) : null)),
    h('b', {}, `Stratagems (${(k.loadout || []).length}/${slots}) · ${pool} command`),
    h('div', { class: 'row wrap strat-mini', style: { gap: '6px', paddingTop: '6px' } }, (k.loadout || []).length ? k.loadout.map((id) => stratagemCard({ name: STRATAGEMS[id].name, icon: stratIcon(id, 2), cost: STRATAGEMS[id].cost, selected: true })) : [h('span', { class: 'muted' }, opts.length ? 'None chosen — set them in Realm → Stratagems.' : 'Become a Kingdom to use more stratagems.')]),
    h('b', {}, 'Opening formations'),
    mine.map((x) => h('div', { class: 'row wrap', style: { gap: '6px' } }, portrait(x, 1.5), h('span', { style: { minWidth: '90px' } }, x.name.split(' ')[0]),
      segmented(FORMATION_IDS.map((f) => ({ value: f, label: FORMATIONS[f].name })), x.formation, (f) => act({ type: 'formation', hero: x.id, formation: f })))));
  modal(mineSide === 'att' ? `Battle of ${t.name}` : `${t.name} is under attack!`, body,
    [['Auto-resolve', () => choose('auto')], ['Fight!', () => { sfx('horn'); choose('fight'); }, 'primary']], { width: '720px' });
}

function askFight(b, humanAtt, humanDef) {
  const st = S.state;
  const both = humanAtt && humanDef;
  const k = myK();
  const mineSide = b.att === k.id ? 'att' : b.def === k.id ? 'def' : null;
  const auto = () => { S.reports.push(applyBattle(st, b, autoResolve(st, b))); if (net.role === 'host') net.broadcastState(); nextBattle(); };
  const fight = () => startBattle(b);
  if (both) { preBattle(b, () => fight()); return; }
  if (!mineSide) { net.ask({ t: 'askFight', tid: b.tid, b }).then((ans) => (ans === 'auto' ? auto() : fight())); toast('The other player is deciding…'); return; }
  preBattle(b, (c) => (c === 'auto' ? auto() : fight()));
}

function startBattle(b) {
  const st = S.state;
  const ctl = (kid) => (isHumanKingdom(st, kid) ? st.kingdoms[kid].player : 'ai');
  go('battle', { state: st, battle: b, control: { att: ctl(b.att), def: b.def >= 0 ? ctl(b.def) : 'ai' }, me: S.me });
}

function resumeQueue(result) {
  const st = S.state, b = S.current;
  if (result && result !== true && b) {
    const rep = applyBattle(st, b, result);
    S.reports.push(rep);
    if (net.role === 'host') net.broadcastState();
  }
  S.current = null;
  S.busy = true;
  nextBattle();
}

function finishTurn() {
  const st = S.state;
  const humanReports = S.reports.filter((r) => isHumanKingdom(st, r.att) || isHumanKingdom(st, r.def));
  const prevTurn = st.turn;
  const summary = endTurn(st);
  S.busy = false;
  persist();
  if (net.role === 'host') net.send({ t: 'turnDone', turn: st.turn, s: st, reports: humanReports, summary, orderNotes: S.orderNotes });
  refreshUI();
  showTurnSummary(prevTurn, humanReports, summary, S.orderNotes);
}

export function showTurnSummary(prevTurn, reports, summary = { events: [], notes: [] }, orderNotes = []) {
  const st = S.state;
  const k = myK();
  const myKid = k.id;
  if (st.over) return gameOver();
  if (!k.alive && !S.toldFallen) {
    S.toldFallen = true;
    return modal('Your last hero has fallen', h('div', {}, 'No one remains to carry your banner. The war goes on without you.'), [['Watch'], ['Title screen', () => { if (net.role !== 'single') net.close(); else clearSave(); go('title'); }, 'danger']]);
  }
  const items = [];
  for (const r of reports || []) {
    const t = st.territories[r.tid];
    const iAtt = r.att === myKid, iDef = r.def === myKid;
    if (!iAtt && !iDef) continue;
    const won = (iAtt && r.attWon) || (iDef && !r.attWon);
    items.push(h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '2px', borderColor: won ? '#7fd36b' : '#ff6a5a' } },
      h('b', { class: won ? 'good' : 'bad' }, `${won ? 'Victory' : 'Defeat'} at ${t.name}`),
      h('span', { class: 'muted', style: { fontSize: '13px' } }, [r.evolved ? `${r.evolved} evolved` : '', r.elites ? `${r.elites} became Elite` : '', r.promoted ? `${r.promoted} promotions` : '', r.leveled && r.leveled.length ? `${r.leveled.length} hero level-up${r.leveled.length > 1 ? 's' : ''}` : '', r.loot != null && won && st.items[r.loot] ? `found ${st.items[r.loot].name}` : '', r.defected && r.defected.length ? `${r.defected.length} traitor${r.defected.length > 1 ? 's' : ''}!` : ''].filter(Boolean).join(' · '))));
  }
  const mineNotes = [...(orderNotes || []), ...(summary.notes || [])].filter((n) => n.kid === myKid || n.kid === -1);
  const events = (summary.events || []).map((e) => {
    const ic = SPELL[EVENT_SPELL[e.kind]];
    return h('div', { class: 'row', style: { gap: '6px' } }, ic && ic.icon ? sprite(ic.icon, 0, 0, 16, 16, 1.5) : null, h('span', { class: e.kid === myKid ? 'gold' : '' }, e.text));
  });
  const bad = (summary.events || []).some((e) => e.kid === myKid && ['quake', 'plague', 'revolt', 'overthrow', 'bandits', 'outbreak', 'famine'].includes(e.kind));
  if ((summary.events || []).some((e) => e.kind === 'overthrow' && e.kid === myKid)) { sfx('lost'); banner('OVERTHROWN!', 'bad', 'Your realm has fallen to revolution'); }
  sfx('turn');
  modal(`${seasonOf(prevTurn)} of year ${yearOf(prevTurn)} ends`, h('div', { class: 'col' },
    items,
    mineNotes.length ? h('div', { class: 'col', style: { gap: '3px' } }, mineNotes.map((n) => h('div', { class: n.kind === 'defect' || n.kind === 'famine' || n.kind === 'betrayal' || n.kind === 'raid' ? 'bad' : n.kind === 'plot' || n.kind === 'heir' || n.kind === 'birth' ? 'gold' : n.kind === 'family' ? 'good' : '' }, ({ family: '♥ ', birth: '✦ ', heir: '★ ', raid: '⚠ ' })[n.kind] || '• ', n.text))) : null,
    ...kingdomHeroes(st, myKid).filter((x) => !x.role && x.level >= ROLE_LEVEL).map((x) => h('div', { class: 'row gold', style: { gap: '6px' } }, h('span', { class: 'grow' }, `★ ${x.name} is ready to choose a calling.`), btn('Choose', () => heroModal(x.id), 'tiny good'))),
    events.length ? h('b', {}, 'Across the land') : null, events,
  ), [['Continue', () => {
    banner(`${seasonOf(st.turn)}, Year ${yearOf(st.turn)}`, bad ? 'bad' : 'blue', k.landless ? 'Your warband wanders' : k.name);
    if (captivesOf(st, myKid).length && (reports || []).some((r) => r.captured.length)) showCaptives();
    else if (st.proposals.some((p) => p.to === myKid)) diplomacySheet();
    nameBirths();
  }, 'primary']], { width: '680px' });
}

// a child was born in your realm: boy or girl, then a name
export function nameBirths() {
  const st = S.state, myKid = myK().id;
  const pb = (st.pendingBirths || []).find((b) => b.kid === myKid);
  if (!pb) return;
  let gender = Math.random() < 0.5 ? 'm' : 'f', name = '', sug = [], mm;
  const input = h('input', { class: 'text grow', maxlength: '18', placeholder: 'Or type a name', autocomplete: 'off', onInput: (e) => { name = e.target.value; } });
  const box = h('div', { class: 'col' });
  const render = () => {
    if (!sug.length) sug = childNames(st, pb.fid, gender, 6, null, myKid);
    if (!name) name = sug[0];
    input.value = name;
    box.replaceChildren(
      h('div', { class: 'muted' }, `${pb.parents.join(' and ')} have a child. They will train in a parent's squad and come of age as a hero.`),
      segmented([{ value: 'm', label: 'Boy' }, { value: 'f', label: 'Girl' }], gender, (g) => { gender = g; sug = []; name = ''; sfx('click'); render(); }),
      h('div', { class: 'row wrap', style: { gap: '6px' } }, sug.map((nm) => btn(nm, () => { name = nm; sfx('click'); render(); }, 'small' + (nm === name ? ' good' : ''))),
        btn('↻', () => { sug = childNames(st, pb.fid, gender, 6, null, myKid); name = sug[0]; sfx('click'); render(); }, 'small')),
      h('div', { class: 'row' }, input));
  };
  render();
  mm = modal('A child is born!', box, [['Name them', () => {
    const nm = (input.value || name).trim();
    if (act({ type: 'nameChild', bid: pb.bid, gender, name: nm })) { sfx('levelup'); toast(`Welcome, ${nm}!`, 'good'); setTimeout(nameBirths, 300); }
    else { toast('Pick a name', 'gold'); setTimeout(nameBirths, 200); }
  }, 'primary']], { width: '560px' });
}

function gameOver() {
  const st = S.state, myKid = myK().id;
  const o = st.over;
  const win = o.winner === myKid || (o.type === 'alliance' && (o.winners || []).includes(myKid));
  sfx(win ? 'victory' : 'defeat');
  banner(win ? 'VICTORY' : 'DEFEAT', win ? 'good' : 'bad');
  modal(win ? 'Victory!' : 'Defeat', h('div', {}, win ? (o.type === 'alliance' ? 'You and your allies rule every realm. The dynasty is yours.' : 'Every realm bows to you. The dynasty is yours.') : o.type === 'alliance' && o.members.includes(myKid) ? 'Your alliance rules the land — but you followed others into it, and the crown went to them.' : 'Your cause is lost.'),
    [['Title screen', () => { if (net.role !== 'single') net.close(); go('title'); }, 'primary']]);
}
