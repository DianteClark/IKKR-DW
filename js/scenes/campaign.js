import { picon } from '../engine/icons.js';
import { buzz } from '../engine/prefs.js';
import { battlePeerLost } from './battle.js';
import { howToModal } from './howto.js';
let mm0 = null;
const STAT_HELP = { atk: 'ATK: how hard the hero and their squad hit.', def: 'DEF: how much damage the squad shrugs off.', lead: 'LEAD: how many soldiers the hero can command, and how fast they change formation.', int: 'INT: stratagem points in battle and the power of the hero special.' };
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
  hasIntel, friendly, treaty, proposedMajority, totalTroops, fixPortraits, skirmishTargets,
} from '../game/world.js';
import { endTurn } from '../game/turn.js';
import { scoutsLeft, scoutableLands } from '../game/intel.js';
import { STEWARD_FOCUS, stewardOf } from '../game/steward.js';
import { armyAt, armiesOf, sharedOrder, orderStatus } from '../game/army.js';
import { besiegeTargets } from '../game/siege.js';
import { neutralActions, sitesIn, SITES, canCourt } from '../game/neutral.js';
import { dateOf, shortDate, seasonOf, SEASON_FOOD, childrenOf, wedOptions, MARRY_LEVEL, childNames } from '../game/family.js';
import { runAI } from '../game/ai.js';
import { applyAction } from '../game/actions.js';
import {
  squadCap, developCost, territoryIncome, territoryFood, heroTotals, unitName, FORMATIONS, FORMATION_IDS, HIRE_COST, isRanged, LEVEL_XP,
  soldierStats, soldierTitle, TIERS, tierIndex, BUILDINGS, POLICIES, EDICTS, STRATAGEMS, PROMOTE_ELITE_COST, commandPool, recruitCost, CLASS_INFO, ROLES, ROLE_LEVEL, canLead, TEMPERS,
} from '../game/rules.js';
import { SLOTS, SLOT_NAMES, itemStatText, rarityColor } from '../game/items.js';
import { economyPreview, edictCost, canEdict, promotionStatus, loadoutOptions, loadoutSlots } from '../game/kingdom.js';
import { alliesOf, opinion, realmPower, dominant, willingness, atWar, warsOf } from '../game/diplomacy.js';
import { EVENT_INFO } from '../game/events.js';
import { captureScene, decisionScene, nemesisLine } from '../game/dialogue.js';
import { questText, nemesisPairs } from '../game/stories.js';
import { pendingChoice } from '../game/choices.js';
import { checkAchievements, recordCampaign } from '../game/legacy.js';
import { renderTerrain, drawTerrain, drawSites, drawTowns, drawHeroes, drawOrders, drawAnimated, drawSeason, captureFx, renderMinimap, updateMinimap, hitTest, drawLandOutline, drawGuards, setSeason, setVisibility, drawFog, drawCaravans, drawWeather, TS } from '../campaign/mapview.js';
import { visibleLands, fogOn } from '../game/fog.js';
import { tradeRoutes, raidableHere } from '../game/trade.js';
import { bannerEl } from '../engine/banner.js';
import { GOALS, goalState, newlyDone } from '../campaign/goals.js';
import { shareRealm } from '../campaign/share.js';
import { portrait, unitIcon, itemIcon, heroCard, kingdomBadge, unitCard } from '../campaign/widgets.js';
import { saveCampaign, getRecord, prettyCode, stampCampaign, flush } from '../game/save.js';
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
      getRecord(args.load).then((rec) => {
        if (!rec || !rec.state || rec.state.v !== 2) return go('title');
        if (rec.battle && rec.battle.b) {
          // the app closed mid-battle: pick the fight back up where it was
          S.state = rec.state; S.me = rec.seat || 0; S.key = rec.key; S.current = rec.battle.b;
          const c = rec.battle.ctx || {}; S.queue = c.queue || []; S.reports = c.reports || []; S.choices = c.choices || null; S.orderNotes = c.orderNotes || []; S.busy = true;
          return go('battle', { resumeBattle: rec.battle, state: rec.state, me: rec.seat || 0, key: rec.key });
        }
        go('campaign', { state: rec.state, localPlayer: rec.seat || 0, key: rec.key });
      });
      return;
    }
    S.key = args.key || null;
    if (args.state) fixPortraits(args.state);
    if (args.state) { S.state = args.state; S.me = args.localPlayer ?? 0; S.sel = null; S.target = null; S.queue = null; S.reports = []; }
    if (S.seed !== S.state.seed + ':' + S.state.size || !S.terrainCanvas) {
      S.seed = S.state.seed + ':' + S.state.size;
      S.T = terrainOf(S.state);
      if (S.T.season == null) S.T.season = seasonOf(S.state.turn);
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
    if (music.setSeason) music.setSeason(seasonOf(S.state.turn));
    music.start(myK().landless ? 'tension' : 'campaign');
    buildUI();
    if (args.resume) { if (net.role !== 'client') resumeQueue(args.resume); }
    else {
      persist();
      if (net.role === 'single' && S.state.turn === 1 && !S.state.introShown) intro();
      else { banner(cap1(dateOf(S.state.turn)), 'blue', myK().name); setTimeout(showChoice, 1200); }
    }
  },
  exit() { net.onState = null; document.body.classList.remove('side-open'); },
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
    // fog of war for the local player (sets what the map draws and the minimap shows)
    const vis = fogOn(st) ? visibleLands(st, myK().id) : null;
    if (vis !== S.vis) { S.vis = vis; setVisibility(S.T, vis); if (S.minimap) { updateMinimap(S.minimap, S.T, st); drawMinimapUI(); } }
    if (S.T.season !== seasonOf(st.turn)) { music.setSeason && music.setSeason(seasonOf(st.turn)); setSeason(S.T, seasonOf(st.turn)); if (S.minimap) { updateMinimap(S.minimap, S.T, st); drawMinimapUI(); } }
    cam.apply();
    const vw = screen.w / cam.zoom, vh = screen.h / cam.zoom;
    const view = { x: cam.x - vw / 2, y: cam.y - vh / 2, w: vw, h: vh };
    drawTerrain(ctx, S.T, view);
    drawAnimated(ctx, S.T, game.time, view);
    // banners and border guards show who holds what
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    if (S.target) {
      drawLandOutline(ctx, S.T, S.target.valid, S.target.kind === 'attack' ? '#ff4a3a' : S.target.kind === 'spy' ? '#c48bff' : '#ffffff', 2);
      for (const tid of S.target.valid) ring(st.territories[tid], S.target.kind === 'attack' ? '#ff4a3a' : S.target.kind === 'spy' ? '#c48bff' : '#ffffff', 22 + pulse * 3);
    }
    if (S.sel != null) { drawLandOutline(ctx, S.T, [S.sel], '#ffd25a', 2); ring(st.territories[S.sel], '#ffd25a', 26 + pulse * 2); }
    drawGuards(ctx, S.T, st, game.time, view);
    drawSites(ctx, st, S.T, game.time, view);
    drawCaravans(ctx, st, S.T, tradeRoutes(st), game.time, view);
    drawTowns(ctx, st, game.time, view);
    drawFog(ctx, S.T, view);
    drawWeather(ctx, st, S.T, game.time, view);
    drawHeroes(ctx, st, game.time, S.travel, S.T, myK().id, view);
    drawOrders(ctx, st, net.role === 'single' ? null : st.players[S.me].kingdom, game.time, view);
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
    ctx.font = '800 12px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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
        act({ type: 'orderMany', heroes: S.target.heroes, order: { type: S.target.kind, target: tid } });
        const nm = S.state.territories[tid].name;
        sfx(S.target.kind === 'attack' ? 'horn' : 'march');
        toast(S.target.kind === 'attack' ? `Attack ordered on ${nm}` : S.target.kind === 'besiege' ? `Siege laid to ${nm}` : S.target.kind === 'spy' ? `Spies sent to ${nm}` : `Marching to ${nm}`);
        S.target = null; refreshUI();
      } else if (tid != null) {
        toast(S.target.kind === 'move' ? 'Not reachable this month — pick a glowing land' : 'Pick one of the glowing lands', 'gold');
      } else { S.target = null; refreshUI(); }
      return;
    }
    if (hit && hit.kind === 'site') { const s = (S.state.sites || []).find((x) => x.id === hit.id); if (s) toast(SITES[s.kind].name + (s.status !== 'active' ? ' (' + s.status + ')' : ''), 'gold'); }
    if (hit && hit.kind === 'hero') { const x = hero(S.state, hit.id); if (x && x.kingdom === myK().id) { S.sel = tid; refreshUI(); sfx('open'); return; } }
    S.sel = tid; if (tid != null) sfx('open'); refreshUI();
  },
  onResize() { buildUI(true); },
});

function ring(t, color, r) {
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
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
function bannerIcon(k) { const el = k.banner ? bannerEl(k.banner, 0.8) : h('span', { class: 'swatch', style: { background: k.color } }); el.style.flex = 'none'; el.style.marginTop = '-4px'; return el; }
// jump to the next hero without orders and open their land
function nextIdle() {
  const st = S.state, k = myK();
  const idle = armiesOf(st, k.id).filter((a) => a.some((x) => !x.order)).map((a) => a[0]);
  if (!idle.length) return;
  S.idleI = ((S.idleI ?? -1) + 1) % idle.length;
  const x = idle[S.idleI];
  focus(x.loc); cam.x += (screen.w * 0.22) / cam.zoom; cam.clamp();
  S.sel = x.loc; sfx('open'); refreshUI(); drawMinimapUI();
  toast(`${armyAt(st, k.id, x.loc).length > 1 ? 'Army of ' + x.name : x.name} awaits orders`);
}
function focus(tid) { const t = S.state.territories[tid]; cam.x = t.cx * TS + 8; cam.y = t.cy * TS + 8; cam.clamp(); }

// ---------- UI ----------
// re-render a panel body without jumping back to the top
function keepScroll(sc, body) { const top = sc.scrollTop; sc.replaceChildren(body); sc.scrollTop = top; }
function add(el, ...c) { el.append(...c.flat().filter((x) => x != null && x !== false)); }
let ui = {};
// keep: a size change (rotation, URL bar, the keyboard opening to name a child) rebuilds only the bars and keeps open windows
function buildUI(keep = false) {
  if (keep) for (const el of [ui.top, ui.side, ui.bottom, ui.goals, ui.mini]) el && el.remove();
  else { clearUI(); S._choiceOpen = S._birthOpen = S._captiveOpen = false; }
  ui.top = mount(h('div', { class: 'topbar' }));
  ui.side = mount(h('div', { class: 'side', style: { display: 'none' } }));
  ui.bottom = mount(h('div', { class: 'bottombar' }));
  ui.goals = mount(h('div', { class: 'goals' }));
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
  const idle = armiesOf(st, k.id).filter((a) => a.some((x) => !x.order)).length;
  const eco = economyPreview(st, k);
  const waiting = net.role !== 'single' && net.waitingFor ? net.waitingFor : null;
  const incoming = st.proposals.filter((p) => p.to === k.id).length;
  ui.top.innerHTML = '';
  add(ui.top,
    h('span', { class: 'chip row tap realm-chip', style: { gap: '5px', maxWidth: '26vw', minWidth: 0, flexShrink: 1 }, onClick: realmSheet },
      bannerIcon(k), h('span', { class: 'ellipsis' }, k.landless ? 'Warband of ' + (hero(st, k.ruler) || {}).name : k.name),
      h('span', { class: 'tag gold' }, k.landless ? 'Landless' : TIERS[tierIndex(k)].name)),
    h('span', { class: 'chip gold tap', title: 'Gold', onClick: () => economySheet('gold') }, picon('gold', 16), `${k.gold} `, h('small', { class: eco.gold >= 0 ? 'good' : 'bad' }, sign(eco.gold))),
    h('span', { class: 'chip tap', title: 'Food', onClick: () => economySheet('food') }, picon('food', 16), `${Math.round(k.food)} `, h('small', { class: eco.food >= 0 ? 'good' : 'bad' }, sign(eco.food))),
    h('span', { class: 'chip tap ' + (k.morale < 30 ? 'bad' : ''), title: 'Order', onClick: () => economySheet('morale') }, picon('stability', 16), `${Math.round(k.morale)}`),
    h('span', { class: 'chip muted', title: cap1(dateOf(st.turn)) }, shortDate(st.turn)),
    pendingChoice(st, k.id) && !S.busy ? h('span', { class: 'chip gold tap pulse-chip', title: pendingChoice(st, k.id).title, onClick: showChoice }, picon('scroll', 16), 'Decide') : null,
    h('span', { class: 'grow' }),
    btn(picon('menu', 18), menu, 'small'),
    (() => { const pend = waiting ? '' : pendingLabel(pendingItems()); return btn(waiting ? waiting : h('span', { class: 'row', style: { gap: '4px' } }, 'End Turn', pend ? h('small', { class: 'pending-tag' }, pend) : null), endTurnPressed, 'primary small end-turn'); })(),
  );
  renderGoals();
  ui.bottom.innerHTML = '';
  const prisoners = captivesOf(st, k.id).length;
  add(ui.bottom,
    btn(picon('home', 18), goHome, 'small home-btn'),
    net.role !== 'single' ? btn(picon('chat', 18), chatSheet, 'small home-btn') : null,
    idle ? btn(`Idle ${idle}`, nextIdle, 'small gold-btn') : null,
    btn('Heroes', heroesList, 'small'),
    btn('Realm', realmSheet, 'small'),
    btn(h('span', { class: 'row', style: { gap: '4px' } }, `Diplomacy${incoming ? ` (${incoming})` : ''}`, warsOf(st, k.id).length ? picon('swords', 14) : null), diplomacySheet, 'small' + (incoming ? ' primary' : '')),
    prisoners ? btn(`Prisoners (${prisoners})`, showCaptives, 'small') : null,
    btn('Chronicle', chronicle, 'small'),
  );
  if (S.target) {
    document.body.classList.add('side-open');
    ui.side.style.display = '';
    ui.side.innerHTML = '';
    ui.side.style.bottom = 'auto';
    ui.side.append(h('div', { class: 'panel' },
      h('h3', {}, S.target.kind === 'attack' ? 'Choose where to attack' : S.target.kind === 'besiege' ? 'Choose a walled town to besiege' : S.target.kind === 'spy' ? 'Choose where to spy' : 'Choose where to march'),
      h('div', { class: 'muted' }, 'Tap a highlighted territory.'),
      btn('Cancel', () => { S.target = null; refreshUI(); }, 'small')));
    return;
  }
  ui.side.style.bottom = '';
  if (ui.mini) ui.mini.style.display = S.sel == null ? '' : 'none';
  if (ui.bottom) ui.bottom.classList.toggle('narrow', S.sel != null || !!S.target);
  document.body.classList.toggle('side-open', S.sel != null || !!S.target);
  if (S.sel == null) { ui.side.style.display = 'none'; return; }
  ui.side.style.display = '';
  const prev = ui.side.querySelector('.scroll'); const keep = prev && ui.side.dataset.tid == S.sel ? prev.scrollTop : 0;
  ui.side.innerHTML = '';
  ui.side.append(territoryPanel(S.sel)); ui.side.dataset.tid = S.sel;
  const now = ui.side.querySelector('.scroll'); if (now) now.scrollTop = keep;
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
    h('div', { class: 'muted' }, `${BIOMES[t.biome].name} · ${stars}${t.ruined ? ' · ruined' : ''} · +${territoryIncome(t)}g · food ${territoryFood(t)}`),
    (t.fx || []).length ? h('div', { class: 'row wrap' }, t.fx.map((f) => chip(`${(EVENT_INFO[f.kind] || {}).name || f.kind} (${f.turns})`, 'bad'))) : null,
    t.siege ? chip(`Under siege by ${st.kingdoms[t.siege.kid].name.split(' of ').pop()} (${t.siege.turns}/3)`, 'bad') : null,
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
    if (t.level < 3 && stewardOf(k).on) add(body, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'The Steward develops your towns.'));
    else if (t.level < 3) add(body, btn(`Develop town (${developCost(t)}g)`, () => { if (!act({ type: 'develop', tid })) toast('Not enough gold'); else sfx('coin'); }, 'small'));
  }
  if (mine || (k.landless && myHere.length)) {
    const vags = vagabondsIn(st, tid);
    if (vags.length) {
      add(body, h('h3', {}, 'Wanderers here'));
      for (const v of vags) add(body, heroCard(st, v, { stats: true, order: false, badges: [v.trait], extra: btn(`Hire ${HIRE_COST}g`, () => { if (!act({ type: 'hire', hero: v.id })) toast('Not enough gold'); else { sfx('recruit'); toast(`${v.name} joins you!`, 'good'); } }, 'small good') }));
    }
  }
  if (myHere.length) {
    const army = armyAt(st, k.id, tid);
    add(body, h('h3', {}, k.landless ? 'Your warband' : army.length > 1 ? 'Your army' : 'Your hero'));
    if (k.landless) add(body, h('div', { class: 'muted', style: { fontSize: '13px' } }, owner ? `Raise an uprising to seize ${t.name} from ${owner.name}, or march on.` : 'March on to find land to take.'));
    if (army.length > 1 && !(S.split || new Set()).has(tid)) add(body, armyBlock(army));
    else {
      if (army.length > 1) add(body, h('div', { class: 'row', style: { gap: '6px', margin: '0 0 6px' } }, h('span', { class: 'muted grow', style: { fontSize: '12px' } }, 'Split: each hero takes their own orders.'), btn('Regroup', () => { S.split.delete(tid); refreshUI(); }, 'small')));
      for (const x of army) add(body, heroBlock(x));
    }
  }
  const others = st.heroes.filter((x) => x.status === 'active' && x.loc === tid && x.kingdom !== k.id && !(t.owner >= 0 && x.kingdom === t.owner && !mine));
  if (others.length) {
    add(body, h('h3', {}, 'Others here'));
    for (const o of others) add(body, heroCard(st, o, { order: false, badges: [o.lentTo === k.id ? 'Lent to you' : friendly(st, k.id, o.kingdom) ? 'Ally' : 'Foreign'] }));
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
      add(body, h('h3', {}, k.landless ? 'Rise up here' : 'Send your armies'));
      const groups = [...new Set(near.map((x) => x.loc))].map((loc) => armyAt(st, k.id, loc).filter((x) => near.includes(x)));
      for (const g of groups) {
        const set = g.every((x) => x.order && x.order.type === 'attack' && x.order.target === tid);
        const name = g.length > 1 ? `Army of ${g[0].name} (${g.length})` : g[0].name;
        add(body, h('div', { class: 'card army-mini' + (set ? ' sel' : '') },
          h('div', { class: 'row faces' }, g.slice(0, 4).map((x) => portrait(x, 1.5))),
          h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } }, h('b', { class: 'ellipsis' }, name), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${g.reduce((n, x) => n + x.troops.length, 0)} troops · in ${st.territories[g[0].loc].name}`)),
          btn(set ? 'Cancel' : 'Attack', () => { act({ type: 'orderMany', heroes: g.map((x) => x.id), order: set ? null : { type: 'attack', target: tid } }); if (!set) sfx('horn'); }, set ? 'small' : 'danger small')));
      }
    }
    if (owner && owner.id !== k.id && !k.landless) add(body, btn('Diplomacy…', () => diplomacySheet(owner.id), 'small'));
    sysLandExtras(body, tid);
  }
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, t.name), btn('✕', () => { S.sel = null; refreshUI(); }, 'small')),
    body);
}

// systems-helper additions to the land panel: scouting, weather, sieges, caravans
function sysLandExtras(body, tid) {
  const st = S.state, k = myK(), t = st.territories[tid];
  const left = scoutsLeft(st, k);
  if (t.owner !== k.id && left > 0 && scoutableLands(st, k.id).includes(tid) && !hasIntel(st, k.id, tid))
    add(body, btn(`Scout this land (${left} left)`, () => { const r = act({ type: 'scout', tid }); toast(r ? `Scouts sent to ${t.name}` : 'Could not scout', r ? 'good' : 'bad'); sfx('click'); refreshUI(); }, 'small'));
  else if (t.owner !== k.id && !k.buildings.spies && !hasIntel(st, k.id, tid)) add(body, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Build a Spy Network to scout lands.'));
}

// ---------- orders: one hero, or a whole army acting as one ----------
// every order the group can take where it stands; the situation picks up to four to show as buttons
function orderActions(list) {
  const st = S.state, k = myK(), lead = list[0], t = st.territories[lead.loc];
  const ids = list.map((x) => x.id);
  const so = sharedOrder(list), cur = so && so !== 'mixed' ? so : null;
  const is = (type, test) => !!cur && cur.type === type && (!test || test(cur));
  const picking = (kind) => !!S.target && S.target.kind === kind && ids.every((id) => S.target.heroes.includes(id));
  const all = (order) => act({ type: 'orderMany', heroes: ids, order });
  const inter = (fn) => list.map(fn).reduce((a, b) => a.filter((x) => b.includes(x)));
  const tn = (id) => st.territories[id].name;
  const targets = inter((x) => validTargets(st, x)), moves = inter((x) => validMoves(st, x)), sieges = inter((x) => besiegeTargets(st, x));
  const out = [];
  const price = list.reduce((n, x) => n + restPrice(st, x), 0);
  const need = list.some((x) => x.troops.length < squadCap(x, k) || x.hp < 100);
  out.push({ id: 'rest', label: need && price ? `Rest & train ${price}g` : 'Rest & train', cls: 'good', on: is('rest'), desc: 'Heal, refill the squad and train.', run: () => all(is('rest') ? null : { type: 'rest' }) });
  if (moves.length) out.push({ id: 'move', label: is('move') ? `Move → ${tn(cur.target)}` : 'Move', on: is('move') || picking('move'), desc: 'March to a safe land nearby.', run: () => startTarget(ids, 'move') });
  if (targets.includes(t.id)) {
    const on = is('attack', (o) => o.target === t.id);
    out.push({ id: 'take', label: k.landless ? 'Rise up' : `Take ${t.name}`, cls: 'danger', on, desc: k.landless ? `Raise an uprising and seize ${t.name}.` : `Fight the militia and claim ${t.name} by force.`, run: () => { all(on ? null : { type: 'attack', target: t.id }); if (!on) sfx('horn'); } });
  }
  const away = targets.filter((x) => x !== t.id);
  if (!k.landless && away.length) out.push({ id: 'attack', label: is('attack', (o) => o.target !== t.id) ? `Attack → ${tn(cur.target)}` : 'Attack', cls: 'danger', on: is('attack', (o) => o.target !== t.id) || picking('attack'), desc: 'Storm a neighbouring land.', run: () => startTarget(ids, 'attack') });
  if (sieges.length) out.push({ id: 'besiege', label: is('besiege') ? `Besiege → ${tn(cur.target)}` : 'Besiege', on: is('besiege') || picking('besiege'), desc: 'Starve a walled town for three months instead of storming it.', run: () => startTarget(ids, 'besiege') });
  for (const a of neutralActions(st, lead)) {
    const order = { type: a.type, site: a.site, target: a.target };
    const on = is(a.type, (o) => (a.site == null || o.site === a.site) && (a.target == null || o.target === a.target));
    const label = a.label + (a.risk != null && a.risk < 1 ? ` · ${Math.round(a.risk * 100)}%` : '');
    const go = () => {
      if (a.type === 'court') { const who = list.find((x) => canCourt(st, x, hero(st, a.target))) || lead; act({ type: 'order', hero: who.id, order: on ? null : order }); }
      else all(on ? null : order);
      if (!on) { sfx('click'); toast(a.desc); }
    };
    out.push({ id: a.type === 'explore' ? 'explore:' + a.site : a.type === 'court' ? 'court:' + a.target : a.type, kind: a.type, label, on, desc: a.desc, cls: a.type === 'plunder' ? 'danger' : a.type === 'protect' ? 'good' : '', run: go });
  }
  for (const fk of skirmishTargets(st, lead)) {
    const F = st.kingdoms[fk], on = is('skirmish', (o) => o.target === fk), war = atWar(st, k.id, fk);
    const go = () => { all(on ? null : { type: 'skirmish', target: fk }); if (!on) { sfx('horn'); toast(`Your heroes will attack ${F.name}'s heroes here`); } };
    out.push({ id: 'skirmish:' + fk, label: `Fight ${F.name.split(' of ').pop()}'s heroes${war ? '' : ' (act of war)'}`, cls: 'danger', on, desc: 'Battle the foreign heroes standing in this land.',
      run: () => (on || war ? go() : confirm('Attack them here?', `${F.name}'s heroes are not your enemies yet. Attacking them is an act of war: they will declare war on you or sue for peace.`, 'Attack', 'Cancel', 'danger').then((ok) => ok && go())) });
  }
  // caravans passing on or beside this land can be robbed for gold
  const route = !k.landless && list.every((x) => raidableHere(st, x)) ? raidableHere(st, lead) : null;
  if (route) {
    const ta = st.territories[route[0]], tb = st.territories[route[1]];
    const ct = ta.id === lead.loc || ta.nb.includes(lead.loc) ? ta : tb, victim = ct.owner;
    const peace = victim >= 0 && !atWar(st, k.id, victim);
    const gold = 60 + Math.round(lead.level * 8), on = is('raid');
    const go = () => { all(on ? null : { type: 'raid' }); if (!on) { sfx('horn'); toast(`Your heroes will ambush the caravan near ${ct.name}`); } };
    out.push({ id: 'raid', label: `Raid caravan +${gold}g${peace ? ' (act of war)' : ''}`, cls: 'danger', on, desc: `Ambush the caravan running ${ta.name} – ${tb.name}.`,
      run: () => (on || !peace ? go() : confirm('Raid the caravan?', `It belongs to ${st.kingdoms[victim].name}. Robbing it is an act of war: they will declare war on you or sue for peace.`, 'Raid', 'Cancel', 'danger').then((ok) => ok && go())) });
  }
  // which four matter most depends on where they stand
  const free = t.owner < 0, own = t.owner === k.id;
  const firstExplore = out.find((a) => a.kind === 'explore');
  const want = k.landless ? ['take', 'move', 'rest']
    : free ? ['protect', 'take', firstExplore && firstExplore.id, 'move'] // standing in a free land, its own choices come first
    : sieges.length ? ['attack', 'besiege', 'move', 'rest']
    : own ? ['rest', 'move', 'attack', 'raid']
    : ['move', 'attack', 'rest', 'raid'];
  const primary = want.filter(Boolean).map((id) => out.find((a) => a.id === id)).filter(Boolean).slice(0, 4);
  const rest = out.filter((a) => !primary.includes(a));
  return { primary, rest, all, cur: so };
}
// the current order as a banner with a cancel cross; sieges and guard duty last for months, so this is how to stop them
function orderBanner(list, cur, all) {
  const st = S.state;
  if (!cur) return null;
  const info = cur === 'mixed' ? { text: 'Mixed orders', cls: 'gold' } : orderStatus(st, list[0]);
  if (!info) return null;
  const cancel = () => {
    all(null); sfx('click');
    if (info.standing) toast(cur.type === 'besiege' ? `The siege of ${st.territories[cur.target].name} is lifted` : 'Guard duty ended', 'gold');
  };
  return h('div', { class: 'order-banner ' + (info.cls || '') + (info.standing ? ' standing' : '') },
    info.icon ? picon(info.icon, 16) : null,
    h('span', { class: 'grow ellipsis' }, info.text),
    btn(picon('close', 14), cancel, 'small icon-btn', ));
}
function orderButtons(list) {
  const { primary, rest, all, cur } = orderActions(list);
  const more = rest.length ? btn('Act here…', () => {
    let m;
    const body = h('div', { class: 'col', style: { gap: '6px' } }, rest.map((a) => h('div', { class: 'card act-row' },
      h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } }, h('b', {}, a.label), a.desc ? h('span', { class: 'muted', style: { fontSize: '12px' } }, a.desc) : null),
      btn(a.on ? 'Cancel' : 'Order', () => { m.close(); a.run(); }, 'small ' + (a.on ? '' : a.cls || 'primary')))));
    m = sheet(list.length > 1 ? `Army of ${list[0].name}` : list[0].name, body, [], { side: 'right' });
  }, 'small') : null;
  return h('div', { class: 'col', style: { gap: '4px', margin: '2px 0 8px', alignItems: 'stretch' } },
    orderBanner(list, cur, all),
    h('div', { class: 'row wrap', style: { gap: '4px' } }, primary.map((a) => btn(a.label, a.run, 'small ' + (a.cls || '') + (a.on ? ' sel' : ''))), more));
}
function heroBlock(x) {
  const st = S.state;
  const card = heroCard(st, x, { onClick: () => heroModal(x.id), badges: [x.trait], order: false });
  return h('div', {}, card, orderButtons([x]));
}
// heroes of one realm in one land form an army: one card, one set of orders
function armyBlock(list) {
  const st = S.state, lead = list[0], t = st.territories[lead.loc];
  const troops = list.reduce((n, x) => n + x.troops.length, 0);
  const card = h('div', { class: 'card army-card col' },
    h('div', { class: 'row', style: { gap: '6px' } }, picon('flag', 16), h('b', { class: 'grow ellipsis' }, `Army of ${lead.name}`), chip(`${troops} troops`, 'gold')),
    h('div', { class: 'row wrap faces', style: { gap: '4px' } }, list.map((x) => h('span', { class: 'face tap' + (x === lead ? ' lead' : ''), title: x.name, onClick: () => heroModal(x.id) }, portrait(x, 2), h('span', { class: 'lvl' }, x.level)))),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, `${list.length} heroes · led by ${lead.name}. Tap a face for details.`));
  const split = btn('Split', () => { S.split = S.split || new Set(); S.split.add(t.id); refreshUI(); }, 'small');
  const box = orderButtons(list);
  box.lastChild.append(split);
  return h('div', {}, card, box);
}

function startTarget(ids, kind) {
  const st = S.state, list = ids.map((id) => hero(st, id));
  const pick = (x) => (kind === 'attack' ? validTargets(st, x).filter((tid) => tid !== x.loc) : kind === 'besiege' ? besiegeTargets(st, x) : kind === 'spy' ? validSpyTargets(st, x) : validMoves(st, x));
  const valid = list.map(pick).reduce((a, b) => a.filter((x) => b.includes(x)));
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
        h('div', { class: 'row wrap', style: { gap: '4px' } }, ['atk', 'def', 'lead', 'int'].map((s) => h('span', { class: 'chip tap', title: STAT_HELP[s], onClick: () => toast(STAT_HELP[s]) }, `${s.toUpperCase()} ${t[s]}`))),
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
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))' } }, list.map(({ s, i }) => {
          const ss = soldierStats(uf, x.unit, s);
          return h('div', { class: 'card', style: { padding: '5px', gap: '6px', borderColor: s.s === 3 ? '#ffd86b' : undefined } },
            unitIcon(uf, x.unit, s.s, 2),
            h('div', { class: 'col', style: { gap: '1px', minWidth: 0 } },
              h('span', { class: 'ellipsis', style: { fontWeight: 700, color: s.s === 3 ? '#ffd86b' : undefined } }, soldierTitle(uf, x.unit, s)),
              h('span', { class: 'muted', style: { fontSize: '12px' } }, `HP ${Math.round(ss.hp)} · ATK ${ss.atk.toFixed(1)} · DEF ${ss.def.toFixed(1)}`),
              s.s === 3 && editable && !canLead(uf, x.unit) ? h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Beasts fight, but cannot lead') : null,
              s.s === 3 && editable && canLead(uf, x.unit) ? btn(`Raise to hero ${PROMOTE_ELITE_COST}g`, () => { if (act({ type: 'promoteElite', hero: x.id, idx: i })) { sfx('levelup'); toast(`${s.name} now leads their own squad!`, 'good'); render(); } else toast('Not enough gold'); }, 'tiny good') : null));
        })));
    } else if (tab === 'unit') {
      const opts = troopOptions(st, x);
      const byRace = {};
      for (const o of opts) (byRace[o.fid] = byRace[o.fid] || []).push(o);
      content = h('div', { class: 'col' },
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Mounted ride two lands a month, flyers cross the sea, casters and beasts hit hard — each needs its building. Any troops your realm can raise. ${TIERS[tierIndex(k)].name}s can field up to tier ${TIERS[tierIndex(k)].maxUnitLevel + 1}. Win land or recruit heroes of other races to unlock theirs. Changing type disbands the squad.`),
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
              h('span', { class: 'tag', style: { fontSize: '11px' } }, o.locked && !sel ? h('span', { class: 'row', style: { gap: '3px' } }, picon('lock', 12), BUILDINGS[o.locked].name) : CLASS_INFO[o.cls].name));
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
      const nem = x.nemesis != null ? hero(st, x.nemesis) : null;
      content = h('div', { class: 'col' },
        h('b', {}, 'Story'),
        h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '3px', padding: '6px 8px' } },
          h('span', {}, x.quest ? h('span', { class: 'row', style: { gap: '4px' } }, picon('flag', 14), questText(st, x)) : h('span', { class: 'muted' }, 'No vow sworn yet. Life on the march will give them one.')),
          nem ? h('span', { class: 'bad' }, `Nemesis: ${nem.name}${nem.status !== 'active' ? ` (${nem.status})` : ''} — fights harder against them`) : null,
          x.deeds ? h('span', { class: 'gold' }, `Vows fulfilled: ${x.deeds}`) : null),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `Married heroes may have a child nine months later. Heirs train in a parent's squad and become heroes at Elite. Marry from level ${MARRY_LEVEL}.`),
        parents.length ? h('div', { class: 'row wrap' }, h('b', {}, 'Parents:'), parents.map((p) => h('span', { class: 'chip tap', onClick: () => { m.close(); heroModal(p.id); } }, p.name))) : null,
        h('div', { class: 'row wrap' }, h('b', {}, 'Spouse:'), sp ? h('span', { class: 'chip good tap', onClick: () => { m.close(); heroModal(sp.id); } }, sp.name + (sp.status !== 'active' ? ` (${sp.status})` : '')) : h('span', { class: 'muted' }, x.widowed ? 'Widowed' : 'Unmarried')),
        expecting ? h('div', { class: 'chip gold' }, `A child is due in ${dateOf(expecting.expecting + 9)}`) : null,
        h('b', {}, `Children (${kids.length})`),
        kids.length ? h('div', { class: 'col', style: { gap: '4px' } }, kids.map((c) => c.hero
          ? h('div', { class: 'card tap', onClick: () => { m.close(); heroModal(c.hero.id); } }, portrait(c.hero, 2), h('span', { class: 'grow' }, `${c.hero.name} · hero, Lv ${c.hero.level}`))
          : h('div', { class: 'card' }, c.ward ? h('span', { class: 'chip gold' }, c.soldier.heir.gender === 'f' ? picon('female', 14) : picon('male', 14)) : unitIcon(c.with.ufid || c.with.fid, c.with.unit, c.soldier.s, 2), h('div', { class: 'col grow', style: { gap: 0 } }, h('b', {}, c.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${c.ward ? 'Raised at ' + c.with.name + '\'s side' : 'Training in ' + c.with.name + '\'s squad'} · stage ${c.soldier.s} of 3`))))) : h('div', { class: 'muted' }, 'None yet.'),
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
      tabs([{ id: 'squad', label: 'Squad' }, { id: 'unit', label: 'Unit type' }, { id: 'gear', label: 'Gear' }, { id: 'family', label: 'Story' }, { id: 'more', label: 'Tactics' }], (id) => { tab = id; render(); }, tab), content);
    if (m) keepScroll(m.box.querySelector('.body'), body); else m = sheet(x.name, body, [], { side: 'right' });
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

const HL = { sort: 'idle', filter: 'all' };
function heroesList() {
  const st = S.state, k = myK();
  let mm;
  const render = () => {
    const all = kingdomHeroes(st, k.id, true);
    const wounded = (x) => x.hp < 70 || x.troops.length < squadCap(x, k) * 0.6;
    let hs = all.filter((x) => HL.filter === 'all' || (HL.filter === 'idle' && !x.order) || (HL.filter === 'wounded' && wounded(x)) || (HL.filter === 'here' && S.sel != null && x.loc === S.sel));
    const by = {
      idle: (a, b) => (!!a.order - !!b.order) || b.level - a.level,
      level: (a, b) => b.level - a.level || b.troops.length - a.troops.length,
      troops: (a, b) => b.troops.length - a.troops.length,
      wounded: (a, b) => (a.hp + a.troops.length * 4) - (b.hp + b.troops.length * 4),
      land: (a, b) => st.territories[a.loc].name.localeCompare(st.territories[b.loc].name) || b.level - a.level,
    }[HL.sort];
    hs = hs.slice().sort(by);
    const chipBtn = (label, on, fn) => btn(label, () => { fn(); sfx('click'); render(); }, 'tiny' + (on ? ' good' : ''));
    const controls = h('div', { class: 'col', style: { gap: '4px' } },
      h('div', { class: 'row wrap', style: { gap: '4px' } }, h('span', { class: 'muted', style: { fontSize: '12px', width: '40px' } }, 'Show'),
        chipBtn(`All ${all.length}`, HL.filter === 'all', () => (HL.filter = 'all')),
        chipBtn(`Idle ${all.filter((x) => !x.order).length}`, HL.filter === 'idle', () => (HL.filter = 'idle')),
        chipBtn(`Wounded ${all.filter(wounded).length}`, HL.filter === 'wounded', () => (HL.filter = 'wounded')),
        S.sel != null ? chipBtn(`At ${st.territories[S.sel].name}`, HL.filter === 'here', () => (HL.filter = 'here')) : null),
      h('div', { class: 'row wrap', style: { gap: '4px' } }, h('span', { class: 'muted', style: { fontSize: '12px', width: '40px' } }, 'Sort'),
        ...[['idle', 'Idle first'], ['level', 'Level'], ['troops', 'Troops'], ['wounded', 'Weakest'], ['land', 'Land']].map(([id, l]) => chipBtn(l, HL.sort === id, () => (HL.sort = id)))));
    // group by land when sorted by land, with bulk orders for each group
    const groups = new Map();
    for (const x of hs) { const key = HL.sort === 'land' ? x.loc : 'all'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(x); }
    const blocks = [];
    for (const [loc, list] of groups) {
      if (loc !== 'all') {
        const editable = list.filter((x) => x.status === 'active' && x.lentTo < 0);
        blocks.push(h('div', { class: 'row wrap hl-group' }, h('b', { class: 'grow' }, `${st.territories[loc].name} · ${list.length}`),
          editable.length > 1 ? btn('All rest', () => { editable.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'rest' } })); toast(`${editable.length} heroes rest at ${st.territories[loc].name}`); render(); }, 'tiny good') : null,
          editable.length > 1 && validTargets(st, editable[0]).length ? btn('All attack…', () => { mm.close(); S.sel = loc; focus(loc); startTarget(editable.map((x) => x.id), 'attack'); }, 'tiny danger') : null,
          btn('Show', () => { mm.close(); S.sel = loc; focus(loc); refreshUI(); }, 'tiny ghost')));
      }
      blocks.push(h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(270px,1fr))' } }, list.map((x) => h('div', {},
        heroCard(st, x, { stats: true, badges: [x.trait], onClick: () => { mm.close(); heroModal(x.id); } }),
        h('div', { class: 'row', style: { gap: '4px', marginTop: '3px' } }, h('span', { class: 'muted grow ellipsis', style: { fontSize: '13px' } }, `at ${st.territories[x.loc].name}`),
          btn('Show', () => { mm.close(); S.sel = x.loc; focus(x.loc); cam.x += (screen.w * 0.22) / cam.zoom; cam.clamp(); refreshUI(); drawMinimapUI(); }, 'tiny'))))));
    }
    const body = h('div', { class: 'col' }, controls, hs.length ? blocks : h('div', { class: 'muted' }, 'No heroes match.'));
    if (mm) { const sc = mm.box.querySelector('.body'); const top = sc.scrollTop; sc.replaceChildren(body); sc.scrollTop = top; }
    else mm = sheet(`Your heroes (${all.length}) · ${totalTroops(st, k.id)} troops`, body, [], { side: 'right' });
  };
  render();
}

// ---------- early goals ----------
let goalsOpen = false, goalsBusy = false;
function renderGoals() {
  if (!ui.goals) return;
  const st = S.state, k = myK();
  const g = goalState(st, k.id);
  // pay out anything just achieved (through an action so the host stays in charge)
  if (!goalsBusy && !S.busy) {
    const fresh = newlyDone(st, k);
    if (fresh.length) {
      goalsBusy = true;
      setTimeout(() => {
        for (const G of fresh) if (act({ type: 'goal', id: G.id })) { sfx('levelup'); banner('Goal complete', 'good', `${G.title} · +${G.reward}g`); toast(G.tip, 'gold'); }
        goalsBusy = false;
      }, 400);
    }
  }
  const doneN = GOALS.filter((G) => g.done[G.id]).length;
  ui.goals.innerHTML = '';
  if (g.hidden || doneN === GOALS.length || S.sel != null && goalsOpen === false && window.innerWidth < 700) { ui.goals.style.display = 'none'; return; }
  ui.goals.style.display = '';
  const next = GOALS.find((G) => !g.done[G.id]);
  if (!goalsOpen) {
    ui.goals.append(h('button', { class: 'goals-chip', onClick: () => { goalsOpen = true; sfx('click'); renderGoals(); } },
      h('span', { class: 'gold' }, `Goals ${doneN}/${GOALS.length}`), h('span', { class: 'ellipsis' }, next.title)));
    return;
  }
  ui.goals.append(h('div', { class: 'panel goals-panel' },
    h('div', { class: 'row' }, h('b', { class: 'grow gold' }, `Goals ${doneN}/${GOALS.length}`), btn('Hide', () => confirm('Hide goals?', 'You can bring them back from the menu.', 'Hide', 'Keep').then((ok) => { if (ok) act({ type: 'hideGoals' }); }), 'tiny ghost'), btn('▴', () => { goalsOpen = false; renderGoals(); }, 'tiny')),
    GOALS.map((G) => h('div', { class: 'goal ' + (g.done[G.id] ? 'done' : G === next ? 'next' : '') },
      h('span', { class: 'goal-tick' }, g.done[G.id] ? '✔' : '○'),
      h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } }, h('span', {}, G.title, h('small', { class: 'muted' }, ` · +${G.reward}g`)),
        G === next ? h('small', { class: 'muted' }, G.how) : null)))));
}

// ---------- economy breakdown: why each number moves this month ----------
function economySheet(focusOn = 'gold') {
  const st = S.state, k = myK(), e = economyPreview(st, k);
  const line = (label, val, cls = '') => h('div', { class: 'eco-line' }, h('span', { class: 'grow' }, label), h('b', { class: cls }, val));
  const sgn = (n) => (n > 0 ? '+' : '') + (Math.round(n * 10) / 10);
  const pct = (f) => (f >= 1 ? '+' : '') + Math.round((f - 1) * 100) + '%';
  const mines = (st.sites || []).filter((x) => x.kind === 'mine' && x.status === 'claimed' && x.owner === k.id).length;
  const lands = kingdomTerritories(st, k.id).sort((a, b) => territoryIncome(b) - territoryIncome(a));
  const tax = POLICIES.tax[k.policy.tax], rat = POLICIES.rations[k.policy.rations];
  const driftM = (55 - k.morale) * 0.08;
  const section = (id, title, total, lines) => h('div', { class: 'card col eco-sec' + (focusOn === id ? ' on' : ''), style: { alignItems: 'stretch', gap: '2px' } },
    h('div', { class: 'row' }, h('b', { class: 'grow' }, title), h('b', { class: total >= 0 ? 'good' : 'bad' }, sgn(total) + ' / month')), ...lines);
  const body = h('div', { class: 'col' },
    section('gold', 'Gold', e.gold + mines * 35, [
      line(`${lands.length} land${lands.length === 1 ? '' : 's'}`, `+${e.landGold}`),
      e.taxGold !== 1 ? line(`${tax.name} taxes`, pct(e.taxGold), e.taxGold > 1 ? 'good' : 'bad') : null,
      mines ? line(`${mines} claimed mine${mines > 1 ? 's' : ''}`, `+${mines * 35}`, 'good') : null,
      e.tributeIn ? line('Tribute from vassals', `+${e.tributeIn}`, 'good') : null,
      e.tributeOut ? line('Tribute to your overlord', `−${e.tributeOut}`, 'bad') : null,
      lands.length > 1 ? h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Richest: ' + lands.slice(0, 3).map((t) => `${t.name} ${territoryIncome(t)}g`).join(' · ')) : null,
      e.ruined ? h('div', { class: 'bad', style: { fontSize: '12px' } }, `${e.ruined} sacked land${e.ruined > 1 ? 's' : ''} earn less until rebuilt.`) : null,
    ]),
    section('food', 'Food', e.food, [
      line('Harvest from your lands', `+${e.landFood}`),
      e.granary ? line('Granaries', '+25%', 'good') : null,
      e.seasonFood !== 1 ? line(`${e.season} harvest`, pct(e.seasonFood), e.seasonFood >= 1 ? 'good' : 'bad') : null,
      line(`${e.soldiers} soldiers and ${e.heroCount} heroes eat`, `−${e.foodEaten}`, 'bad'),
      e.rationFood !== 1 ? line(`${rat.name} rations`, pct(e.rationFood), e.rationFood < 1 ? 'good' : 'bad') : null,
      k.food + e.food < 0 ? h('div', { class: 'bad', style: { fontSize: '12px' } }, 'Stores will run out: famine makes soldiers desert. Cut rations, rest fewer troops or take farmland.') : null,
    ]),
    section('morale', 'Order', driftM + e.morale - (k.landless ? 1 : 0) - e.ruined * 1.5, [
      line('Settles toward 55', sgn(driftM)),
      tax.morale ? line(`${tax.name} taxes`, sgn(tax.morale), tax.morale > 0 ? 'good' : 'bad') : null,
      rat.morale ? line(`${rat.name} rations`, sgn(rat.morale), rat.morale > 0 ? 'good' : 'bad') : null,
      k.landless ? line('Wandering without land', '−1', 'bad') : null,
      e.ruined ? line(`${e.ruined} sacked land${e.ruined > 1 ? 's' : ''}`, sgn(-e.ruined * 1.5), 'bad') : null,
      h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Victories, festivals and feasts raise it; defeats, famine and plunder lower it. Your armies fight with the realm\'s Order.'),
      h('div', { class: k.morale < 24 ? 'bad' : 'muted', style: { fontSize: '12px' } }, k.morale < 24 ? 'Danger: below 24 the people may revolt.' : 'Below 24 revolts break out; below 12 the ruler can be overthrown.'),
    ]),
    btn('Taxes, rations and edicts…', () => { mm.close(); realmSheet(); }, 'small'));
  const mm = sheet('Your economy this month', body, [], { side: 'right' });
}

// the Steward: on, he sets taxes, rations, edicts, buildings and town growth each month
function stewardBox(k, render) {
  const s = stewardOf(k);
  return h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '6px' } },
    h('div', { class: 'steward-line' }, picon('scroll', 18), h('b', { class: 'grow' }, 'Steward'),
      segmented([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.on ? 'on' : 'off', (v) => { act({ type: 'steward', on: v === 'on', focus: s.focus }); render(); })),
    s.on ? segmented(Object.entries(STEWARD_FOCUS).map(([v, f]) => ({ value: v, label: f.name })), s.focus, (v) => { act({ type: 'steward', on: true, focus: v }); render(); }) : null,
    h('div', { class: 'muted', style: { fontSize: '12px' } }, s.on ? STEWARD_FOCUS[s.focus].desc + ' Turn him off to run taxes, edicts and building yourself.' : 'You run taxes, rations, edicts, building and towns yourself.'));
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
        eco.trade ? statRow('Trade caravans', `+${eco.trade}g from friendly borders`) : null,
        statRow('Food per turn', `${sign(eco.food)}  (grown ${eco.foodMade}, eaten ${eco.foodEaten})`),
        statRow('Date', `${cap1(dateOf(st.turn))} · harvest ×${SEASON_FOOD[seasonOf(st.turn)]}`),
        k.landless ? null : stewardBox(k, () => render()),
        h('div', { class: 'row' }, h('span', { style: { width: '90px' } }, 'Order'), h('div', { class: 'grow' }, bar(k.morale / 100, 'mor')), h('b', {}, Math.round(k.morale))),
        k.morale < 30 ? h('div', { class: 'bad', style: { fontSize: '13px' } }, 'Low Order breeds revolts. Very low Order can overthrow you!') : null,
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
          btn(`${c.gold ? c.gold + 'g ' : ''}${c.food ? c.food + ' food' : ''}${!c.gold && !c.food ? 'Free' : ''}`, () => { if (act({ type: 'edict', edict: id })) { sfx('horn'); toast(`${e.name} proclaimed`, 'good'); render(); } }, 'small' + (ok ? ' primary' : '')));
      });
      content = h('div', { class: 'col' },
        k.landless ? null : stewardBox(k, () => render()),
        h('div', { class: 'col' + (stewardOf(k).on ? ' disabled-block' : '') },
        h('b', {}, 'Taxes'), segmented(Object.entries(POLICIES.tax).map(([v, p]) => ({ value: v, label: p.name })), k.policy.tax, (v) => { act({ type: 'policy', kind: 'tax', value: v }); render(); }),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'High taxes fill the treasury but lower Order.'),
        h('b', {}, 'Rations'), segmented(Object.entries(POLICIES.rations).map(([v, p]) => ({ value: v, label: p.name })), k.policy.rations, (v) => { act({ type: 'policy', kind: 'rations', value: v }); render(); }),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Feasts lift Order but eat your stores.'),
        h('b', {}, k.edictTurn === st.turn ? 'Edict (used this turn)' : 'One edict per turn'), edicts));
    } else if (tab === 'build') {
      content = h('div', { class: 'col' }, stewardOf(k).on ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'The Steward chooses what to build. Turn him off on the Realm tab to build yourself.') : null, h('div', { class: 'col' + (stewardOf(k).on ? ' disabled-block' : '') }, Object.entries(BUILDINGS).map(([id, b]) => {
        const have = k.buildings[id], can = tierIndex(k) >= b.tier;
        return h('div', { class: 'card', style: { gap: '8px' } }, h('div', { class: 'col grow', style: { gap: '1px' } }, h('b', {}, b.name), h('span', { class: 'muted', style: { fontSize: '13px' } }, b.desc + (can ? '' : ` Requires ${TIERS[b.tier].name}.`))),
          have ? chip('Built', 'good') : btn(`${b.cost}g`, () => { if (act({ type: 'build', building: id })) { sfx('coin'); render(); } else toast(can ? 'Not enough gold' : 'Grow your realm first'); }, 'small' + (can && k.gold >= b.cost ? ' primary' : '')));
      })));
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
    if (m) keepScroll(m.box.querySelector('.body'), body); else m = sheet(k.name, body, [], { side: 'right' });
  };
  render();
}

// ---------- diplomacy ----------
// what an incoming offer or demand says
function offerText(p) {
  return p.type === 'vassal' ? 'demands you swear fealty (a fifth of your income as tribute)' : p.type === 'peace' ? (p.gold > 0 ? `sues for peace and offers ${p.gold}g` : p.gold < 0 ? `will make peace for ${-p.gold}g` : 'offers peace') : `offers an ${p.type}`;
}
// an offer as a decision: Accept or Refuse, then the card shows what you chose
function offerCard(p, done) {
  const st = S.state, from = st.kingdoms[p.from];
  const row = h('div', { class: 'row', style: { gap: '6px' } });
  const decide = (accept) => { act({ type: 'respond', id: p.id, accept }); sfx(accept ? 'coin' : 'click'); row.replaceChildren(chip(accept ? 'Accepted' : 'Refused', accept ? 'good' : 'bad')); refreshUI(); if (done) done(accept); };
  row.append(btn('Accept', () => decide(true), 'small good'), btn('Refuse', () => decide(false), 'small danger'));
  return h('div', { class: 'card sumcard ' + (p.type === 'vassal' ? 'bad' : 'gold') },
    h('span', { class: 'sum-ic' }, picon(p.type === 'vassal' ? 'crown' : 'letter', 22)),
    h('div', { class: 'col grow', style: { gap: '2px', minWidth: 0 } }, h('b', {}, `${from.name}`), h('span', { class: 'muted', style: { fontSize: '13px' } }, cap1(offerText(p)) + '.')),
    row);
}
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
      incoming.map((p) => offerCard(p, () => setTimeout(render, 500))),
      h('div', { class: 'muted', style: { fontSize: '13px' } }, `Alliance victory: rule the whole map with your allies — but only if you proposed most of your own alliances. You proposed ${proposedByMe} of ${mine.length}${mine.length && !proposedByMe * 2 > mine.length ? '' : ''}${mine.length ? (proposedMajority(st, k.id) ? ' ✓' : ' ✗') : ''}.${dom >= 0 ? ` ${st.kingdoms[dom].name} dominates the map; others will band together against it.` : ''}`),
      realms.map((o) => {
        const t = treaty(st, k.id, o.id);
        const op = opinion(st, o.id, k.id);
        const pw = realmPower(st, o.id) / Math.max(1, realmPower(st, k.id));
        const war = atWar(st, k.id, o.id);
        const say = (r, ok, pend, no) => { toast(r === 'accepted' ? ok : r === 'pending' ? pend : no, r === 'accepted' ? 'good' : r === 'pending' ? '' : 'bad'); render(); refreshUI(); };
        const acts = []; // first one is the primary action, the rest go under More
        if (war && o.kind !== 'monster') {
          acts.push({ label: 'Offer peace', cls: 'good', run: () => say(act({ type: 'peace', to: o.id, gold: 0 }), `${o.name} accepts peace.`, 'Offer sent', `${o.name} refuses. Try again with gold or after a victory.`) });
          const g = Math.max(100, Math.round(k.gold * 0.25));
          acts.push({ label: `Peace for ${g}g`, run: () => { if (k.gold < g) return toast('Not enough gold'); say(act({ type: 'peace', to: o.id, gold: g }), `${o.name} takes the gold and makes peace.`, 'Offer sent', `${o.name} refuses.`); } });
        }
        if (!k.landless && o.kind !== 'monster' && !war) {
          if (!t) {
            acts.push({ label: 'Propose alliance', cls: 'primary', run: () => { const r = act({ type: 'propose', to: o.id, kind: 'alliance' }); sfx(r === 'accepted' ? 'victory' : 'click'); say(r, `${o.name} accepts!`, 'Offer sent', `${o.name} refuses.`); } });
            if (tierIndex(k) >= 2 && pw < 0.6) acts.push({ label: 'Demand fealty', cls: 'danger', run: () => say(act({ type: 'propose', to: o.id, kind: 'vassal' }), `${o.name} bends the knee!`, 'Demand sent', `${o.name} defies you!`) });
          } else acts.push({ label: t.type === 'vassal' ? (t.a === k.id ? 'Release vassal' : 'Renounce oath') : 'Break alliance', cls: 'danger', run: () => confirm('Break this pact?', 'Every realm will remember your betrayal. Order drops.', 'Break it', 'Keep', 'danger').then((ok) => { if (ok) { act({ type: 'break', other: o.id }); render(); refreshUI(); } }) });
        }
        const wl = t ? null : willingness(st, o.id, k.id, 'alliance');
        const info = `${kingdomTerritories(st, o.id).length} lands · ${pw > 1.5 ? 'far stronger' : pw > 1.1 ? 'stronger' : pw > 0.8 ? 'even' : pw > 0.5 ? 'weaker' : 'far weaker'} · opinion ${Math.round(op)}${wl != null && !war ? ` · ${wl > 0.5 ? 'open to alliance' : wl > 0.3 ? 'unsure' : 'unwilling'}` : ''}`;
        const more = acts.length > 1 ? btn('More', () => { const mm2 = modal(o.name, h('div', { class: 'col', style: { gap: '6px' } }, acts.slice(1).map((a) => btn(a.label, () => { mm2.close(); a.run(); }, a.cls || ''))), [['Close']]); }, 'small') : null;
        return h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '3px', borderColor: o.id === focusKid ? '#ffd86b' : undefined } },
          h('div', { class: 'row wrap', style: { gap: '6px' } }, kingdomBadge(o, { race: true }), war ? chip('At war', 'bad') : relationChip(k.id, o.id),
            o.kind !== 'realm' ? chip(o.kind === 'bandit' ? 'Bandits' : o.kind === 'monster' ? 'Monsters' : 'Rebels', 'bad') : o.player >= 0 ? chip('Player', 'blue') : o.temper ? chip(TEMPERS[o.temper].name, 'gold') : null),
          h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'muted grow', style: { fontSize: '12px', minWidth: 0 } }, info), acts[0] ? btn(acts[0].label, acts[0].run, 'small ' + (acts[0].cls || '')) : null, more));
      }));
    if (m) keepScroll(m.box.querySelector('.body'), body); else m = sheet('Diplomacy', body, [], { side: 'right' });
  };
  render();
}

function chronicle() {
  const st = S.state;
  const body = h('div', { class: 'log' }, [...st.log].reverse().slice(0, 150).map((l) => h('div', { class: l.kind || '' }, h('span', { class: 'muted' }, `${shortDate(l.turn)} `), l.text)));
  sheet('Chronicle', body, [], { side: 'right' });
}

function menu() {
  mm0 = modal('Menu', h('div', { class: 'col' },
    h('div', { class: 'row wrap', style: { gap: '6px' } }, btn('How to play', () => { mm0 && mm0.close(); howToModal(); }, 'small'), btn('Hero stats explained', () => { mm0 && mm0.close(); howToModal(3); }, 'small')),
    h('div', { class: 'row wrap' }, h('span', { class: 'chip gold' }, `Campaign ${prettyCode(S.state.cid)}`), h('span', { class: 'chip' }, `Seed ${S.state.seed}`), h('span', { class: 'chip' }, cap1(dateOf(S.state.turn)))),
    net.role === 'single' ? h('div', { class: 'muted' }, 'Your campaign saves automatically every month. Find it under Continue.') : h('div', { class: 'muted' }, `Two-player · ${net.role === 'host' ? 'You are hosting' : 'Connected to host'}. Both of you keep a copy of this campaign — either of you can host it again from Continue.`)),
  [['Share my realm', () => { setTimeout(() => shareRealm(S.state, S.T, myK().id), 50); }], ...(goalState(S.state, myK().id).hidden ? [['Show goals', () => { act({ type: 'hideGoals', hidden: false }); }]] : []), ['Resume'], ['Quit to title', () => { if (net.role !== 'single') net.close(); go('title'); }, 'danger']], { dismiss: true });
}

function intro() {
  S.state.introShown = true;
  const k = myK();
  modal(`Welcome, ${hero(S.state, k.ruler)?.name || 'ruler'}`, h('div', { class: 'col' },
    h('div', {}, `You rule the village of ${S.state.territories[k.capital].name}. Free hamlets lie between you and your rivals.`),
    h('div', {}, '• Your heroes march together as one army. Tap your land and pick one of its orders; more are under "Act here…".'),
    h('div', {}, '• Your Steward runs taxes, edicts and building for you. Change his focus or turn him off in Realm.'),
    h('div', {}, '• Follow the Goals chip at the top-left: it teaches the game as you play.'),
    h('div', {}, '• End Turn shows what still needs you. Tap gold, food or Order to see why they change.'),
    h('div', {}, '• Attacking another realm is an act of war. You lose only when your last hero falls.'),
  ), [['To war!', () => { sfx('horn'); banner('Early spring, year 1', 'blue', k.name); }, 'primary']]);
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
  if (S._captiveOpen) return;
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
  S._captiveOpen = true;
  mm = modal(`Prisoner: ${x.name}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`, body,
    [['Later'], ['Execute', () => decide('execute'), 'danger'], ['Release', () => decide('release')], ['Recruit', () => decide('recruit'), 'good']], { width: '640px', onClose: () => { S._captiveOpen = false; } });
}

// ---------- multiplayer glue ----------
function setupNet() {
  // connection drops (screen locked, network blip): the game waits and reconnects instead of ending
  net.onClose = () => connectionLost();
  net.on('chat', (m) => showChat(m.text, false));
  net.on('peerRejoined', () => {
    // host: player 2 is back — send them everything
    if (S.lostModal) { S.lostModal.close(); S.lostModal = null; }
    toast('Player 2 reconnected', 'good'); sfx('recruit');
    net.peerReady = false;
    net.send({ t: 'resync', s: S.state, busy: !!S.busy });
  });
  net.on('resync', (m) => {
    // client: the host's state is the truth
    if (S.lostModal) { S.lostModal.close(); S.lostModal = null; }
    S.reconnecting = false;
    S.state = m.s; S.busy = !!m.busy; net.waitingFor = m.busy ? 'Resolving turn…' : null;
    persist();
    if (game.scene !== scenes_campaign()) go('campaign', { state: S.state, localPlayer: S.me, key: S.key });
    else refreshUI();
    toast('Reconnected', 'good');
  });
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

// quick chat between the two players
const QUICK = ['Ready!', 'Give me a minute', 'Truce?', 'Allies?', 'Nice one!', 'You will pay for that', 'Good game', 'Well met!'];
export function showChat(text, mine) {
  const el = h('div', { class: 'chat-bubble' + (mine ? ' mine' : '') }, (mine ? 'You: ' : 'Ally: ').replace('Ally', 'Player ' + (S.me === 0 ? 2 : 1)), text);
  document.getElementById('ui').appendChild(el);
  if (!mine) { sfx('click'); buzz('tap'); }
  setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4400);
}
function chatSheet() {
  let mm;
  mm = modal('Quick message', h('div', { class: 'row wrap', style: { gap: '6px' } }, QUICK.map((q) => btn(q, () => { net.send({ t: 'chat', text: q }); showChat(q, true); mm.close(); }, 'small'))), [['Close']], { dismiss: true });
}
function scenes_campaign() { return game.scene && game.scene.__name === 'campaign' ? game.scene : null; }
function connectionLost() {
  if (net.role === 'single') return;
  // a battle with the other player in it carries on with their squads under AI control
  try { battlePeerLost(); } catch {}
  if (net.role === 'host') {
    if (S.lostModal) return;
    S.lostModal = modal('Player 2 disconnected', h('div', { class: 'col' },
      h('div', {}, 'Waiting for them to come back. They reconnect automatically when their screen wakes up or their signal returns.'),
      h('div', { class: 'chip gold' }, `Room ${net.code}`)),
      [['Keep playing alone', () => { S.lostModal = null; }], ['End session', () => { S.lostModal = null; net.close(); go('title'); }, 'danger']]);
    return;
  }
  if (S.reconnecting) return;
  S.reconnecting = true;
  let tries = 0;
  const status = h('div', { class: 'muted' }, 'Trying to reach the host…');
  S.lostModal = modal('Connection lost', h('div', { class: 'col' }, h('div', {}, 'Reconnecting to the host. Your campaign is saved on this phone too.'), status),
    [['Give up', () => { S.reconnecting = false; S.lostModal = null; net.close(); go('title'); }, 'danger']]);
  const attempt = () => {
    if (!S.reconnecting || net.role !== 'client') return;
    tries++; status.textContent = `Attempt ${tries}…`;
    net.rejoin().then(() => { status.textContent = 'Connected — syncing…'; }).catch(() => { if (tries < 60) setTimeout(attempt, 3000); else status.textContent = 'Could not reach the host. Ask them to keep the game open, then try again from Continue.'; });
  };
  setTimeout(attempt, 800);
  // try again right away when the phone wakes up
  const wake = () => { if (document.visibilityState === 'visible' && S.reconnecting) { tries = Math.max(0, tries - 1); attempt(); } };
  document.addEventListener('visibilitychange', wake);
}

// ---------- turn flow ----------
// ---------- what needs you before the month ends ----------
function pendingItems() {
  const st = S.state, k = myK(), items = [];
  if (pendingChoice(st, k.id)) items.push({ kind: 'choice', c: pendingChoice(st, k.id) });
  for (const a of armiesOf(st, k.id)) if (a.some((x) => !x.order)) items.push({ kind: 'idle', army: a });
  for (const p of st.proposals.filter((x) => x.to === k.id)) items.push({ kind: 'offer', p });
  for (const b of (st.pendingBirths || []).filter((x) => x.kid === k.id)) items.push({ kind: 'child', b });
  for (const x of kingdomHeroes(st, k.id).filter((x) => !x.role && x.level >= ROLE_LEVEL)) items.push({ kind: 'calling', x });
  return items;
}
function pendingLabel(items) {
  const n = (kind) => items.filter((i) => i.kind === kind).length;
  return [[n('choice'), 'decision'], [n('offer'), n('offer') > 1 ? 'offers' : 'offer'], [n('idle'), 'idle'], [n('child'), n('child') > 1 ? 'children' : 'child'], [n('calling'), 'calling']]
    .filter(([c]) => c).slice(0, 2).map(([c, w]) => `${c} ${w}`).join(' · ');
}
// End Turn walks through what is pending, one at a time; skip all to end the month anyway
function walkPending(i = 0) {
  const items = pendingItems();
  if (!items.length) return endTurnNow();
  const it = items[Math.min(i, items.length - 1)], st = S.state;
  let m, moved = false; // once this page is left (Next, a card's own button, ✕), late callbacks must not move on again
  const at = Math.min(i, items.length - 1), last = at === items.length - 1;
  // done: the item was dealt with, so the list is shorter and the same index is the next one
  const next = (done) => { if (moved) return; m.close(); const j = done ? at : at + 1; setTimeout(() => (j < pendingItems().length ? walkPending(j) : endTurnNow()), 150); };
  const go = (fn) => () => { m.close(); fn(); };
  const look = (tid) => { focus(tid); cam.x += (screen.w * 0.22) / cam.zoom; cam.clamp(); S.sel = tid; refreshUI(); drawMinimapUI(); };
  let body;
  if (it.kind === 'idle') {
    const a = it.army, t = st.territories[a[0].loc], idle = a.filter((x) => !x.order);
    body = h('div', { class: 'card walk-card col' },
      h('div', { class: 'row', style: { gap: '6px' } }, h('div', { class: 'row faces', style: { gap: '2px' } }, a.slice(0, 4).map((x) => portrait(x, 1.5))),
        h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } }, h('b', { class: 'ellipsis' }, a.length > 1 ? `Army of ${a[0].name}` : a[0].name), h('span', { class: 'muted', style: { fontSize: '13px' } }, `${idle.length === a.length ? 'Has no orders' : `${idle.length} of ${a.length} without orders`} in ${t.name}.`))),
      h('div', { class: 'row wrap', style: { gap: '6px' } }, btn('Give orders', go(() => look(t.id)), 'small primary'), btn('Rest & train', () => { act({ type: 'orderMany', heroes: idle.map((x) => x.id), order: { type: 'rest' } }); next(true); }, 'small good')));
  } else if (it.kind === 'offer') body = offerCard(it.p, () => setTimeout(() => next(true), 450));
  else if (it.kind === 'child') body = h('div', { class: 'card walk-card col' }, h('b', {}, 'A child awaits a name'), h('span', { class: 'muted', style: { fontSize: '13px' } }, `Born to ${(it.b.parents || []).join(' and ')}.`), btn('Name the child', go(() => nameBirths(() => walkPending(at))), 'small primary'));
  else if (it.kind === 'calling') body = h('div', { class: 'card walk-card col' }, h('b', {}, `${it.x.name} can choose a calling`), h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Commander, Duelist, Strategist or Scout.'), btn('Choose', go(() => heroModal(it.x.id)), 'small primary'));
  else body = h('div', { class: 'card walk-card col' }, h('b', {}, it.c.title), h('span', { class: 'muted', style: { fontSize: '13px' } }, it.c.text), btn('Decide', go(() => showChoice(() => walkPending(at))), 'small primary'));
  m = modal(`Before the month ends · ${at + 1} of ${items.length}`, body,
    [['Skip all & end month', () => { setTimeout(endTurnNow, 150); }, 'danger'], [last ? 'End month' : 'Next', () => { next(false); return false; }, 'primary']], { width: '560px', dismiss: true, onClose: () => { moved = true; } });
}
function endTurnPressed() {
  if (S.busy) return;
  sfx('click');
  if (!(net.role !== 'single' && net.waitingFor) && pendingItems().length) return walkPending(0);
  endTurnNow();
}
function endTurnNow() {
  if (S.busy) return;
  if (net.role === 'client') { net.send({ t: 'ready' }); net.waitingFor = 'Waiting for host…'; refreshUI(); return; }
  if (net.role === 'host') { net.hostReady = true; const alone = !net.conn || !net.conn.open; net.waitingFor = net.peerReady || alone ? null : 'Waiting for player 2…'; refreshUI(); if (net.peerReady || alone) resolveTurn(); return; }
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
  S.choices = null;
  if (net.role === 'host') { net.send({ t: 'resolving' }); net.broadcastState(); }
  refreshUI();
  // several of my battles this month: one compact chooser instead of a modal per battle
  if (net.role === 'single') {
    const myKid = myK().id;
    const mine = S.queue.filter((b) => b.att === myKid || st.territories[b.tid].owner === myKid || (b.skirmish && b.foe === myKid));
    if (mine.length >= 2) return battleChooser(mine);
  }
  nextBattle();
}

const bKey = (b) => `${b.att}:${b.tid}:${b.skirmish ? 's' : ''}`;
function battleChooser(list) {
  const st = S.state, k = myK();
  const choice = {};
  let mm;
  const rows = () => list.map((b0) => {
    const b = prepareBattle(st, JSON.parse(JSON.stringify(b0)));
    if (!b) return null;
    const key = bKey(b0);
    if (!choice[key]) choice[key] = 'auto';
    const t = st.territories[b.tid], mineAtt = b.att === k.id;
    const foe = mineAtt ? (b.def >= 0 ? st.kingdoms[b.def].name : 'the free folk') : st.kingdoms[b.att].name;
    const p = battleOdds(st, b, mineAtt ? hasIntel(st, k.id, b.tid) : true), my = mineAtt ? p : 1 - p;
    return h('div', { class: 'card bc-row' },
      h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } },
        h('b', { class: 'ellipsis' }, `${mineAtt ? (b.skirmish ? 'Ambush' : 'Attack') : 'Defend'} ${t.name}`),
        h('span', { class: 'muted ellipsis', style: { fontSize: '12px' } }, `vs ${foe} · ${Math.round(my * 100)}% to win`)),
      segmented([{ value: 'auto', label: 'Auto' }, { value: 'fight', label: 'Fight' }], choice[key], (v) => { choice[key] = v; sfx('click'); }));
  }).filter(Boolean);
  const box = h('div', { class: 'col' }, rows());
  const body = h('div', { class: 'col' }, h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Choose which battles to command yourself. The rest are settled by your generals.'), box,
    h('div', { class: 'row' }, btn('All auto', () => { for (const k2 in choice) choice[k2] = 'auto'; sfx('click'); box.replaceChildren(...rows()); }, 'tiny'), btn('Fight all', () => { for (const k2 in choice) choice[k2] = 'fight'; go2(); }, 'tiny')));
  const go2 = () => { S.choices = choice; mm.close(); nextBattle(); };
  mm = modal(`${list.length} battles this month`, body, [['Begin', () => { S.choices = choice; nextBattle(); }, 'primary']], { width: '620px' });
}

function nextBattle() {
  const st = S.state;
  while (S.queue.length) {
    const b = prepareBattle(st, S.queue.shift());
    if (!b) continue;
    const humanAtt = isHumanKingdom(st, b.att), humanDef = isHumanKingdom(st, b.def);
    if (!humanAtt && !humanDef) { S.reports.push(applyBattle(st, b, autoResolve(st, b))); continue; }
    S.current = b;
    const pick = S.choices && S.choices[bKey(b)];
    if (pick === 'auto') { S.reports.push(applyBattle(st, b, autoResolve(st, b))); S.current = null; continue; }
    if (pick === 'fight') { startBattle(b); return; }
    askFight(b, humanAtt, humanDef);
    return;
  }
  finishTurn();
}

// battle preview: odds, matchups, stratagems and formations
// pvp: both sides are players, so the battle is fought (no Auto-resolve button that would be ignored)
function preBattle(b, choose, pvp = false) {
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
    ...nemesisPairs(st, b).slice(0, 2).map(([a, f]) => { const x = hero(st, a), y = hero(st, f); return h('div', { class: 'row', style: { gap: '8px' } }, portrait(x, 1.6), h('div', { class: 'card', style: { flex: 1, padding: '4px 8px' } }, h('b', {}, x.name.split(' ')[0] + ': '), `“${nemesisLine(x, y, 'challenger', st.turn)}”`), portrait(y, 1.6)); }),
    !intel ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Unscouted: enemy heroes, formations and stratagems are unknown. Scout the land first (Spy Network) for exact odds.') : null,
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
    [...(pvp ? [] : [['Auto-resolve', () => choose('auto')]]), ['Fight!', () => { sfx('horn'); choose('fight'); }, 'primary']], { width: '720px' });
}

function askFight(b, humanAtt, humanDef) {
  const st = S.state;
  const both = humanAtt && humanDef;
  const k = myK();
  const mineSide = b.att === k.id ? 'att' : b.def === k.id ? 'def' : null;
  const auto = () => { S.reports.push(applyBattle(st, b, autoResolve(st, b))); if (net.role === 'host') net.broadcastState(); nextBattle(); };
  const fight = () => startBattle(b);
  if (both) { preBattle(b, () => fight(), true); return; }
  if (!mineSide) { net.ask({ t: 'askFight', tid: b.tid, b }).then((ans) => (ans === 'auto' ? auto() : fight())); toast('The other player is deciding…'); return; }
  preBattle(b, (c) => (c === 'auto' ? auto() : fight()));
}

function startBattle(b) {
  const st = S.state;
  const ctl = (kid) => (isHumanKingdom(st, kid) ? st.kingdoms[kid].player : 'ai');
  persist(); flush();
  const saveCtx = { queue: S.queue, reports: S.reports, choices: S.choices || null, orderNotes: S.orderNotes || [] };
  go('battle', { state: st, battle: b, control: { att: ctl(b.att), def: b.def >= 0 ? ctl(b.def) : 'ai' }, me: S.me, key: S.key, saveCtx: net.role === 'single' ? saveCtx : undefined });
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
    recordCampaign(st, myKid, 'defeat');
    return modal('Your last hero has fallen', h('div', {}, 'No one remains to carry your banner. The war goes on without you.'), [['Watch'], ['Title screen', () => { if (net.role !== 'single') net.close(); go('title'); }, 'danger']]);
  }
  // ---- season cards: only what matters to you, each with a way to go look at it ----
  const NOTE = {
    war: ['swords', 'War', 'bad'], betrayal: ['broken', 'Betrayal', 'bad'], defect: ['broken', 'Desertion', 'bad'], raid: ['warning', 'Raid', 'bad'], famine: ['warning', 'Famine', 'bad'],
    plot: ['letter', 'Secret offer', 'gold'], birth: ['star', 'A child is born', 'gold'], heir: ['crown', 'Coming of age', 'gold'], family: ['heart', 'Family', 'good'],
    proposal: ['letter', 'Diplomacy', ''], steward: ['scroll', 'Steward', 'gold'], diplomacy: ['letter', 'Diplomacy', ''], demand: ['crown', 'Demand', 'bad'], return: ['home', 'Return', ''],
  };
  const findPlace = (text) => {
    // the first land or hero of yours named in the text tells us where to look
    const t = st.territories.filter((x) => text.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (t) return { tid: t.id };
    const hh = st.heroes.filter((x) => x.status === 'active' && text.includes(x.name.split(' ')[0])).sort((a, b) => (b.kingdom === myKid) - (a.kingdom === myKid))[0];
    return hh ? { tid: hh.loc, hero: hh.id } : null;
  };
  let mm;
  const after = () => {
    banner(cap1(dateOf(st.turn)), bad ? 'bad' : 'blue', k.landless ? 'Your warband wanders' : k.name);
    // one window at a time: prisoners, then births, then a decision, each waiting for the one before to close
    if (captivesOf(st, myKid).length && (reports || []).some((r) => r.captured.length)) whenClear('captives', showCaptives);
    whenClear('births', nameBirths);
    setTimeout(showChoice, 400);
    achievementToasts();
  };
  const showMe = (where) => () => {
    mm.close(); after();
    if (!where) return;
    if (where.tid != null) { focus(where.tid); cam.x += (screen.w * 0.22) / cam.zoom; cam.clamp(); S.sel = where.tid; refreshUI(); drawMinimapUI(); }
    if (where.hero != null) setTimeout(() => heroModal(where.hero), 200);
  };
  const card = (icon, title, text, cls, where, extra) => h('div', { class: 'card sumcard ' + cls },
    h('span', { class: 'sum-ic' }, typeof icon === 'string' ? picon(icon, 22) : icon),
    h('div', { class: 'col grow', style: { gap: '1px', minWidth: 0 } }, h('b', { class: cls }, title), text ? h('span', { class: 'muted', style: { fontSize: '13px' } }, text) : null),
    extra || null,
    where ? btn('Show me', showMe(where), 'tiny') : null);
  const cards = [];
  for (const r of reports || []) {
    const t = st.territories[r.tid];
    const iAtt = r.att === myKid, iDef = r.def === myKid;
    if (!iAtt && !iDef) continue;
    const won = (iAtt && r.attWon) || (iDef && !r.attWon);
    const bits = [won && !r.skirmish && iAtt ? `${t.name} is yours` : !won && iDef && !r.skirmish ? `${t.name} was lost` : '',
      r.evolved ? `${r.evolved} evolved` : '', r.elites ? `${r.elites} became Elite` : '', r.leveled && r.leveled.length ? `${r.leveled.length} level-up${r.leveled.length > 1 ? 's' : ''}` : '',
      r.loot != null && won && st.items[r.loot] ? `found ${st.items[r.loot].name}` : '', r.captured && r.captured.length ? `${r.captured.length} captured` : '', r.objective || '',
      r.defected && r.defected.length ? `${r.defected.length} traitor${r.defected.length > 1 ? 's' : ''}!` : ''].filter(Boolean).join(' · ');
    cards.push(card(won ? 'flag' : 'broken', `${won ? 'Victory' : 'Defeat'} at ${t.name}`, bits, won ? 'good' : 'bad', { tid: r.tid }));
  }
  const mineNotes = [...(orderNotes || []), ...(summary.notes || [])].filter((n) => n.kid === myKid || n.kid === -1);
  const minor = [];
  // offers and demands: decide right here
  for (const p of st.proposals.filter((x) => x.to === myKid)) cards.push(offerCard(p));
  // side systems (weather, trade) only show as result lines
  const trade = economyPreview(st, k).trade;
  if (trade) minor.push(h('div', { class: 'row', style: { gap: '6px' } }, picon('gold', 14), h('span', { class: 'grow' }, `Trade caravans brought +${trade}g from friendly borders.`)));
  let stewardLine = null;
  for (const n of mineNotes) {
    if (n.kind === 'steward') { stewardLine = h('div', { class: 'steward-line muted', style: { fontSize: '13px' } }, picon('scroll', 16), h('span', { class: 'grow' }, n.text), btn('Realm', () => { mm.close(); after(); realmSheet(); }, 'tiny ghost')); continue; }
    if ((n.kind === 'proposal' || n.kind === 'demand') && st.proposals.some((x) => x.to === myKid)) continue; // the decision card says it
    if (n.kind === 'weather') { minor.push(h('div', { class: 'row', style: { gap: '6px' } }, picon('cloud', 14), h('span', { class: 'grow' }, n.text))); continue; }
    const N = NOTE[n.kind];
    if (N) cards.push(card(N[0], N[1], n.text, N[2], findPlace(n.text)));
    else minor.push(h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'grow' }, '• ' + n.text), (() => { const w = findPlace(n.text); return w ? btn('Show', showMe(w), 'tiny ghost') : null; })()));
  }
  for (const x of kingdomHeroes(st, myKid).filter((x) => !x.role && x.level >= ROLE_LEVEL)) cards.push(card('star', `${x.name} can choose a calling`, 'Commander, Duelist, Strategist or Scout.', 'gold', null, btn('Choose', () => { mm.close(); after(); heroModal(x.id); }, 'tiny good')));
  const myEvents = [], world = [];
  for (const e of summary.events || []) {
    const ic = SPELL[EVENT_SPELL[e.kind]];
    const icon = ic && ic.icon ? sprite(ic.icon, 0, 0, 16, 16, 1.5) : picon('star', 18);
    if (e.kid === myKid) myEvents.push(card(icon, (EVENT_INFO[e.kind] || {}).name || 'Event', e.text, ['harvest', 'goldrush'].includes(e.kind) ? 'good' : 'bad', e.tid != null ? { tid: e.tid } : null));
    else world.push(h('div', { class: 'row', style: { gap: '6px' } }, icon, h('span', { class: 'grow' }, e.text), e.tid != null ? btn('Show', showMe({ tid: e.tid }), 'tiny ghost') : null));
  }
  const bad = (summary.events || []).some((e) => e.kid === myKid && ['quake', 'plague', 'revolt', 'overthrow', 'bandits', 'outbreak', 'famine'].includes(e.kind));
  if ((summary.events || []).some((e) => e.kind === 'overthrow' && e.kid === myKid)) { sfx('lost'); banner('OVERTHROWN!', 'bad', 'Your realm has fallen to revolution'); }
  sfx('turn');
  const rest = [...minor, ...world];
  let open = false;
  const restBox = h('div', { class: 'col', style: { gap: '4px', display: 'none' } }, rest);
  const restBtn = rest.length ? btn(`Across the land (${rest.length}) ▾`, () => { open = !open; restBox.style.display = open ? '' : 'none'; restBtn.textContent = `Across the land (${rest.length}) ${open ? '▴' : '▾'}`; }, 'small ghost') : null;
  const all = [...cards, ...myEvents];
  mm = modal(`${cap1(dateOf(prevTurn))} ends`, h('div', { class: 'col' },
    stewardLine,
    all.length ? all : h('div', { class: 'muted' }, 'A quiet month in your realm.'),
    restBtn, restBox,
  ), [['Continue', () => after(), 'primary']], { width: '680px' });
}

function achievementToasts() {
  const st = S.state, k = myK();
  const fresh = checkAchievements(st, k.id, { trade: economyPreview(st, k).trade });
  fresh.forEach((a, i) => setTimeout(() => { sfx('levelup'); toast(`Achievement: ${a.name}${a.unlock ? ' — new banner emblem!' : ''}`, 'gold'); }, 900 + i * 1600));
}
// a decision for your realm (events with choices); then() runs once it is decided (not on "Decide later")
export function showChoice(then) {
  const st = S.state, k = myK();
  const c = pendingChoice(st, k.id);
  if (!c) return;
  if (S._choiceOpen) return;
  if (typeof then !== 'function') then = null;
  // another window is open (month summary, a battle report…): ask again once it closes
  if (modalOpen()) return whenClear('choice', () => showChoice(then));
  sfx('alert');
  const body = h('div', { class: 'col' },
    h('div', {}, c.text),
    h('div', { class: 'col', style: { gap: '6px' } }, c.opts.map((o, i) => h('div', { class: 'card tap', style: { padding: '6px 10px', justifyContent: 'space-between' }, onClick: () => {
      mm.close();
      const r = act({ type: 'choose', opt: i });
      sfx('click'); if (typeof r === 'string') toast(r, 'gold'); refreshUI();
      if (then) setTimeout(then, 250);
    } }, h('b', {}, o.label), o.hint ? h('span', { class: 'muted', style: { fontSize: '12px' } }, o.hint) : null))));
  S._choiceOpen = true;
  const mm = modal(c.title, body, [['Decide later']], { width: '600px', onClose: () => { S._choiceOpen = false; } });
}
// is a pop-up (not a side sheet) open right now?
function modalOpen() { return !!document.querySelector('#ui .modal-back:not(.closing)'); }
// run fn once no pop-up is open (one pending call per key); dropped if the campaign scene is left or another campaign loads
const waits = {};
function whenClear(key, fn) {
  const st = S.state;
  clearTimeout(waits[key]);
  const tick = () => {
    if (game.sceneName !== 'campaign' || S.state !== st && S.state.cid !== st.cid) return;
    if (modalOpen()) { waits[key] = setTimeout(tick, 500); return; }
    fn();
  };
  tick();
}

// a child was born in your realm: boy or girl, then a name; then() runs once every child is named
export function nameBirths(then) {
  const st = S.state, myKid = myK().id;
  if (typeof then !== 'function') then = null;
  const pb = (st.pendingBirths || []).find((b) => b.kid === myKid);
  if (!pb) { if (then) then(); return; }
  if (S._birthOpen) return;
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
  S._birthOpen = true;
  mm = modal('A child is born!', box, [['Name them', () => {
    const nm = (input.value || name).trim();
    if (act({ type: 'nameChild', bid: pb.bid, gender, name: nm })) { sfx('levelup'); toast(`Welcome, ${nm}!`, 'good'); setTimeout(() => nameBirths(then), 300); }
    else { toast('Pick a name', 'gold'); setTimeout(() => nameBirths(then), 200); }
  }, 'primary']], { width: '560px', onClose: () => { S._birthOpen = false; } });
}

function gameOver() {
  const st = S.state, myKid = myK().id;
  const o = st.over;
  const win = o.winner === myKid || (o.type === 'alliance' && (o.winners || []).includes(myKid));
  recordCampaign(st, myKid, win ? (o.type === 'alliance' ? 'alliance' : 'victory') : 'defeat'); achievementToasts();
  sfx(win ? 'victory' : 'defeat');
  banner(win ? 'VICTORY' : 'DEFEAT', win ? 'good' : 'bad');
  modal(win ? 'Victory!' : 'Defeat', h('div', {}, win ? (o.type === 'alliance' ? 'You and your allies rule every realm. The dynasty is yours.' : 'Every realm bows to you. The dynasty is yours.') : o.type === 'alliance' && o.members.includes(myKid) ? 'Your alliance rules the land — but you followed others into it, and the crown went to them.' : 'Your cause is lost.'),
    [['Title screen', () => { if (net.role !== 'single') net.close(); go('title'); }, 'primary']]);
}

function cap1(t) { return t ? t[0].toUpperCase() + t.slice(1) : ''; }
