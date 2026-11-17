import { registerScene, go, game } from '../main.js';
import { ctx, screen, Camera } from '../engine/view.js';
import { h, btn, mount, modal, toast, clearUI, bar, sprite } from '../engine/ui.js';
import { FACTIONS, BIOMES, SPELL_ICONS } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import {
  terrainOf, hero, heroesAt, kingdomHeroes, kingdomTerritories, captivesOf, vagabondsIn, validTargets, validMoves,
  recruitPrice, applyOrders, collectBattles, prepareBattle, autoResolve, applyBattle, endTurn, isHumanKingdom, powerAt,
} from '../game/world.js';
import { runAI } from '../game/ai.js';
import { applyAction } from '../game/actions.js';
import { squadCap, developCost, territoryIncome, heroTotals, unitName, FORMATIONS, FORMATION_IDS, RANKS, HIRE_COST, isRanged, LEVEL_XP } from '../game/rules.js';
import { SLOTS, SLOT_NAMES, itemStatText, rarityColor } from '../game/items.js';
import { renderTerrain, renderOverlay, drawTowns, drawHeroes, drawOrders, drawRoads, TS } from '../campaign/mapview.js';
import { portrait, unitIcon, itemIcon, heroCard, orderLabel } from '../campaign/widgets.js';
import { saveGame, loadGame, clearSave } from '../game/save.js';
import { net } from '../net/net.js';

const cam = new Camera();
const S = { state: null, me: 0, terrainCanvas: null, overlay: null, overlayKey: '', sel: null, target: null, busy: false, queue: null, reports: [], seed: null };
export const campaignSession = S;
window.__dw = Object.assign(window.__dw || {}, { S, act });

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
function persist() { if (net.role === 'single') saveGame(S.state); }

// ---------- scene ----------
registerScene('campaign', {
  enter(args) {
    if (args.load) { const st = loadGame(); if (!st) return go('title'); S.state = st; S.me = 0; }
    if (args.state) { S.state = args.state; S.me = args.localPlayer ?? 0; S.sel = null; S.target = null; S.queue = null; S.reports = []; }
    if (S.seed !== S.state.seed || !S.terrainCanvas) {
      S.seed = S.state.seed;
      S.T = terrainOf(S.state);
      S.terrainCanvas = renderTerrain(S.T);
      S.overlayKey = '';
    }
    cam.bounds = { x: 0, y: 0, w: S.T.W * TS, h: S.T.H * TS, pad: 40 };
    cam.min = Math.min(screen.w / (S.T.W * TS), screen.h / (S.T.H * TS)) * 0.95;
    if (!args.resume) {
      const k = myK(); const c = S.state.territories[k.capital];
      cam.zoom = Math.max(1, Math.round(1.5 * screen.dpr) / screen.dpr);
      cam.x = c.cx * TS + 8; cam.y = c.cy * TS + 8; cam.clamp();
    }
    net.onState = (st) => { S.state = st; refreshUI(); };
    buildUI();
    if (args.resume) resumeQueue(args.resume);
    else { persist(); if (net.role === 'single' && S.state.turn === 1 && !S.state.introShown) intro(); }
    if (S.state.pendingCaptives.length) showCaptives();
  },
  exit() { net.onState = null; },
  update() {},
  render() {
    const st = S.state; if (!st) return;
    const key = st.territories.map((t) => t.owner).join(',') + '|' + st.kingdoms.map((k) => k.color).join(',');
    if (key !== S.overlayKey) { S.overlay = renderOverlay(S.T, st); S.overlayKey = key; }
    cam.apply();
    ctx.drawImage(S.terrainCanvas, 0, 0);
    ctx.drawImage(S.overlay, 0, 0);
    drawRoads(ctx, st);
    // selection + target highlights
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    if (S.target) for (const tid of S.target.valid) ring(st.territories[tid], S.target.kind === 'attack' ? '#ff4a3a' : '#ffffff', 22 + pulse * 3);
    if (S.sel != null) ring(st.territories[S.sel], '#ffd25a', 26 + pulse * 2);
    drawTowns(ctx, st, game.time);
    drawHeroes(ctx, st, game.time);
    drawOrders(ctx, st, net.role === 'single' ? null : st.players[S.me].kingdom, game.time);
    // names in screen space
    ctx.setTransform(screen.dpr, 0, 0, screen.dpr, 0, 0);
    ctx.font = '10px MiKroll'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (cam.zoom * 1 >= 0.7) for (const t of st.territories) {
      const p = cam.toScreen(t.cx * TS + 8, t.cy * TS + 18);
      if (p.x < -60 || p.y < -20 || p.x > screen.w + 60 || p.y > screen.h + 20) continue;
      const k = t.owner >= 0 ? st.kingdoms[t.owner] : null;
      const w = ctx.measureText(t.name).width + 8;
      ctx.fillStyle = 'rgba(14,12,20,.78)'; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w), 13);
      if (k) { ctx.fillStyle = k.color; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y) + 11, Math.round(w), 2); }
      ctx.fillStyle = '#f2e8d5'; ctx.fillText(t.name, Math.round(p.x), Math.round(p.y) + 2);
    }
  },
  onPan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; cam.clamp(); },
  onPinch(cx, cy, f, mx, my) { cam.zoomAt(cx, cy, f); cam.x -= mx / cam.zoom; cam.y -= my / cam.zoom; cam.clamp(); },
  onGestureEnd() { cam.snapZoom(); cam.clamp(); },
  onTap(sx, sy) {
    if (S.busy) return;
    const w = cam.toWorld(sx, sy);
    const tid = territoryAt(w.x, w.y);
    if (S.target) {
      if (tid != null && S.target.valid.includes(tid)) {
        for (const id of S.target.heroes) act({ type: 'order', hero: id, order: { type: S.target.kind, target: tid } });
        toast(S.target.kind === 'attack' ? `Attack ordered on ${S.state.territories[tid].name}` : `Moving to ${S.state.territories[tid].name}`);
        S.target = null; refreshUI();
      } else { S.target = null; refreshUI(); }
      return;
    }
    S.sel = tid; refreshUI();
  },
  onResize() { buildUI(); },
});

function ring(t, color, r) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
}

function territoryAt(wx, wy) {
  const cx = Math.floor(wx / TS), cy = Math.floor(wy / TS);
  if (cx < 0 || cy < 0 || cx >= S.T.W || cy >= S.T.H) return null;
  // towns are tall: prefer the town under the finger
  for (const t of S.state.territories) if (Math.abs(wx - (t.cx * TS + 8)) < 26 && wy > t.cy * TS - 44 && wy < t.cy * TS + 22) return t.id;
  const id = S.T.terr[cy * S.T.W + cx];
  return id >= 0 ? id : null;
}

// ---------- UI ----------
function add(el, ...c) { el.append(...c.flat().filter((x) => x != null && x !== false)); }
let ui = {};
function buildUI() {
  clearUI();
  ui.top = mount(h('div', { class: 'topbar' }));
  ui.side = mount(h('div', { class: 'side', style: { display: 'none' } }));
  ui.bottom = mount(h('div', { class: 'bottombar' }));
  refreshUI();
}

export function refreshUI() {
  if (!S.state || !ui.top || game.sceneName !== 'campaign') return;
  const st = S.state, k = myK();
  const terrs = kingdomTerritories(st, k.id), heroes = kingdomHeroes(st, k.id);
  const idle = heroes.filter((x) => !x.order).length;
  const waiting = net.role !== 'single' && net.waitingFor ? net.waitingFor : null;
  ui.top.innerHTML = '';
  ui.top.append(...[
    h('span', { class: 'chip row', style: { gap: '4px' } }, h('span', { class: 'swatch', style: { background: k.color } }), k.alive ? k.name : 'Fallen'),
    h('span', { class: 'chip gold' }, `${k.gold}g`),
    h('span', { class: 'chip' }, `Turn ${st.turn}`),
    h('span', { class: 'chip muted' }, `${terrs.length}/${st.territories.length}`),
    h('span', { class: 'grow' }),
    btn('Menu', menu, 'small'),
    btn(waiting ? waiting : idle ? `End Turn (${idle} idle)` : 'End Turn', endTurnPressed, 'primary small'),
  ].filter(Boolean));
  ui.bottom.innerHTML = '';
  ui.bottom.append(...[
    btn('Heroes', heroesList, 'small'),
    btn('Realms', realms, 'small'),
    captivesOf(st, k.id).length ? btn(`Prisoners (${captivesOf(st, k.id).length})`, showCaptives, 'small') : null,
    btn('Chronicle', chronicle, 'small'),
  ].filter(Boolean));
  if (S.target) {
    ui.side.style.display = '';
    ui.side.innerHTML = '';
    ui.side.append(h('div', { class: 'panel' },
      h('h3', {}, S.target.kind === 'attack' ? 'Choose a territory to attack' : 'Choose where to move'),
      h('div', { class: 'muted' }, 'Tap a highlighted territory on the map.'),
      btn('Cancel', () => { S.target = null; refreshUI(); }, 'small')));
    ui.side.style.bottom = 'auto';
    return;
  }
  ui.side.style.bottom = '';
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
  add(body, 
    h('div', { class: 'row wrap', style: { gap: '4px' } },
      owner ? h('span', { class: 'swatch', style: { background: owner.color } }) : null,
      h('span', {}, owner ? owner.name : 'Unclaimed'),
      owner ? h('span', { class: 'tag' }, FACTIONS[owner.fid].name) : null),
    h('div', { class: 'muted' }, `${BIOMES[t.biome].name} · Town ${stars}${t.ruined ? ' · ruined' : ''} · +${territoryIncome(t)}g`),
  );
  if (mine) {
    if (t.level < 3) add(body, btn(`Develop town (${developCost(t)}g)`, () => { if (!act({ type: 'develop', tid })) toast('Not enough gold'); }, 'small'));
    const vags = vagabondsIn(st, tid);
    if (vags.length) {
      add(body, h('h3', {}, 'Wanderers here'));
      for (const v of vags) add(body, heroCard(st, v, { stats: true, order: false, extra: btn(`Hire ${HIRE_COST}g`, () => { if (!act({ type: 'hire', hero: v.id })) toast('Not enough gold'); }, 'small good') }));
    }
    const hs = heroesAt(st, tid, k.id);
    add(body, h('h3', {}, hs.length ? 'Your heroes' : 'No heroes stationed'));
    for (const x of hs) add(body, heroBlock(x));
    if (hs.length > 1) {
      const canAtk = validTargets(st, hs[0]).length;
      add(body, h('div', { class: 'row wrap' },
        canAtk ? btn('All attack', () => startTarget(hs.map((x) => x.id), 'attack'), 'danger small') : null,
        btn('All rest', () => hs.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'rest' } })), 'small'),
        btn('All drill', () => hs.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'drill' } })), 'small')));
    }
  } else {
    const def = owner ? heroesAt(st, tid, owner.id) : [];
    add(body, h('div', {}, `Defenders: ${def.length} hero${def.length === 1 ? '' : 'es'} + town guard`),
      h('div', { class: 'muted' }, `Estimated strength ${Math.round(powerAt(st, tid))}`));
    for (const d of def) add(body, heroCard(st, d, { order: false, stats: true }));
    const mineNear = kingdomHeroes(st, k.id).filter((x) => st.territories[x.loc].nb.includes(tid));
    if (mineNear.length) {
      add(body, h('h3', {}, 'Send heroes from nearby'));
      for (const x of mineNear) {
        const set = x.order && x.order.type === 'attack' && x.order.target === tid;
        add(body, heroCard(st, x, { sel: set, extra: btn(set ? 'Cancel' : 'Attack', () => act({ type: 'order', hero: x.id, order: set ? null : { type: 'attack', target: tid } }), set ? 'small' : 'danger small') }));
      }
      const notSet = mineNear.filter((x) => !(x.order && x.order.type === 'attack' && x.order.target === tid));
      if (notSet.length > 1) add(body, btn('Send all', () => notSet.forEach((x) => act({ type: 'order', hero: x.id, order: { type: 'attack', target: tid } })), 'danger small'));
    }
  }
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, t.name), btn('✕', () => { S.sel = null; refreshUI(); }, 'small')),
    body);
}

function heroBlock(x) {
  const st = S.state;
  const card = heroCard(st, x, { onClick: () => heroModal(x.id) });
  const targets = validTargets(st, x), moves = validMoves(st, x);
  const price = recruitPrice(x);
  const o = (order) => act({ type: 'order', hero: x.id, order });
  const actions = h('div', { class: 'row wrap', style: { gap: '4px', margin: '2px 0 6px' } },
    targets.length ? btn('Attack', () => startTarget([x.id], 'attack'), 'danger small') : null,
    moves.length ? btn('Move', () => startTarget([x.id], 'move'), 'small') : null,
    btn('Rest', () => o({ type: 'rest' }), 'small' + (x.order && x.order.type === 'rest' ? ' sel' : '')),
    btn('Drill', () => o({ type: 'drill' }), 'small' + (x.order && x.order.type === 'drill' ? ' sel' : '')),
    x.troops.length < squadCap(x) ? btn(`Recruit ${price}g`, () => o({ type: 'recruit' }), 'small good' + (x.order && x.order.type === 'recruit' ? ' sel' : '')) : null,
    x.order ? btn('Clear', () => o(null), 'small') : null);
  return h('div', {}, card, actions);
}

function startTarget(ids, kind) {
  const st = S.state, x = hero(st, ids[0]);
  const valid = kind === 'attack' ? validTargets(st, x) : validMoves(st, x);
  if (!valid.length) return toast('Nowhere to go from here');
  S.target = { heroes: ids, kind, valid };
  refreshUI();
}

// ---------- hero details ----------
export function heroModal(id) {
  const st = S.state; const x = hero(st, id); const k = myK();
  const editable = x.kingdom === k.id && x.status === 'active';
  let m;
  const render = () => {
    const t = heroTotals(x, st.items);
    const ranked = [...x.troops].sort((a, b) => b.s - a.s || b.r - a.r);
    const troops = h('div', { class: 'row wrap', style: { gap: '4px' } }, ranked.map((s) => h('div', { class: 'col', style: { alignItems: 'center', gap: '1px' } },
      unitIcon(x.fid, x.unit, s.s, 2), h('span', { class: 'tag' }, RANKS[s.s - 1][s.r]))));
    const gear = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))' } }, SLOTS.map((slot) => {
      const it = x.gear[slot] != null ? st.items[x.gear[slot]] : null;
      return h('div', { class: 'card', onClick: editable ? () => pickItem(x, slot, () => render()) : null },
        it ? itemIcon(it, 2) : h('span', { class: 'spr', style: { width: '36px', height: '36px', border: '2px dashed #4a4260', borderRadius: '2px' } }),
        h('div', { class: 'col', style: { gap: '1px', minWidth: 0 } }, h('span', { class: 'muted', style: { fontSize: '11px' } }, SLOT_NAMES[slot]),
          h('span', { style: { color: it ? rarityColor(it.rarity) : '#6b6380', fontSize: '12px' } }, it ? it.name : 'Empty'),
          it ? h('span', { class: 'muted', style: { fontSize: '10px' } }, itemStatText(it)) : null));
    }));
    const forms = h('div', { class: 'row wrap' }, FORMATION_IDS.map((f) => btn(FORMATIONS[f].name, () => { if (editable) { act({ type: 'formation', hero: x.id, formation: f }); render(); } }, 'small' + (x.formation === f ? ' sel' : ''))));
    const sp = SPELLS.find((s) => s.id === x.spell);
    const F = FACTIONS[x.fid];
    const unitChoices = editable ? h('div', { class: 'row wrap', style: { gap: '4px' } }, F.units.map((u, i) => h('div', { class: 'card' + (i === x.unit ? ' sel' : ''), style: { padding: '3px' }, onClick: () => {
      if (i === x.unit) return;
      modal('Change unit type?', h('div', {}, `${x.name} will disband the current squad and lead ${u.n[0]} instead. Recruit them with the Recruit order.`), [['Cancel'], ['Change', () => { act({ type: 'unit', hero: x.id, unit: i }); render(); }, 'danger']]);
    } }, unitIcon(x.fid, i, 1, 1.5)))) : null;
    const body = h('div', { class: 'col' },
      h('div', { class: 'row' }, portrait(x, 3), h('div', { class: 'col grow', style: { gap: '2px' } },
        h('div', {}, `${x.name} · Level ${x.level}`),
        h('div', { class: 'muted' }, `${F.name} · ${x.status === 'active' ? 'Loyalty ' + x.loyalty : x.status}`),
        h('div', {}, `ATK ${t.atk}  DEF ${t.def}  LEAD ${t.lead}  INT ${t.int}`),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'XP'), h('div', { class: 'grow' }, bar(x.xp / LEVEL_XP(x.level), 'xp'))),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Morale'), h('div', { class: 'grow' }, bar((x.morale + t.morale) / 100, 'mor'))),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Health'), h('div', { class: 'grow' }, bar(x.hp / 100))))),
      h('h3', {}, `Squad: ${unitName(x.fid, x.unit, 1)} → ${unitName(x.fid, x.unit, 2)} (${x.troops.length}/${squadCap(x)})${isRanged(x.fid, x.unit) ? ' · ranged' : ''}`),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Soldiers who survive battles rank up, then evolve into the upgraded form. Fallen soldiers are replaced by fresh recruits.'),
      troops,
      unitChoices ? h('h3', {}, 'Unit type') : null, unitChoices,
      h('h3', {}, 'Formation'), forms,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, FORMATIONS[x.formation].desc),
      sp ? h('div', { class: 'row' }, sp.icon ? sprite(sp.icon, 0, 0, 16, 16, 2) : null, h('span', {}, `Special: ${sp.name}`)) : null,
      h('h3', {}, 'Equipment'), gear);
    if (m) { m.box.querySelector('.body').replaceChildren(body); } else m = modal(null, body, [['Close']], { dismiss: true, width: '720px' });
  };
  render();
}

function pickItem(x, slot, done) {
  const st = S.state, k = myK();
  const list = k.items.map((id) => st.items[id]).filter((it) => it && it.slot === slot);
  const cur = x.gear[slot] != null ? st.items[x.gear[slot]] : null;
  const body = h('div', { class: 'col' },
    cur ? h('div', { class: 'card' }, itemIcon(cur), h('span', { class: 'grow' }, `Equipped: ${cur.name} — ${itemStatText(cur)}`), btn('Remove', () => { act({ type: 'unequip', hero: x.id, slot }); mm.close(); done(); }, 'small')) : null,
    list.length ? list.map((it) => h('div', { class: 'card' }, itemIcon(it), h('div', { class: 'col grow', style: { gap: 0 } }, h('span', { style: { color: rarityColor(it.rarity) } }, it.name), h('span', { class: 'muted', style: { fontSize: '11px' } }, itemStatText(it))),
      btn('Equip', () => { act({ type: 'equip', hero: x.id, item: it.id }); mm.close(); done(); }, 'small good'))) : h('div', { class: 'muted' }, `No spare ${SLOT_NAMES[slot].toLowerCase()} in your armory. Win battles to find more.`));
  const mm = modal(SLOT_NAMES[slot], body, [['Close']], { dismiss: true });
}

function heroesList() {
  const st = S.state, k = myK();
  const hs = kingdomHeroes(st, k.id);
  let mm;
  const body = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(250px,1fr))' } }, hs.map((x) => h('div', {},
    heroCard(st, x, { stats: true, onClick: () => { mm.close(); heroModal(x.id); } }),
    h('div', { class: 'row', style: { gap: '4px', marginTop: '2px' } }, h('span', { class: 'muted grow', style: { fontSize: '11px' } }, `at ${st.territories[x.loc].name}`), btn('Show', () => { mm.close(); S.sel = x.loc; const t = st.territories[x.loc]; cam.x = t.cx * TS; cam.y = t.cy * TS; cam.clamp(); refreshUI(); }, 'small')))));
  mm = modal(`Your heroes (${hs.length})`, body, [['Close']], { dismiss: true, width: '760px' });
}

function realms() {
  const st = S.state;
  const rows = st.kingdoms.filter((k) => k.alive).map((k) => {
    const n = kingdomTerritories(st, k.id).length, hc = kingdomHeroes(st, k.id).length;
    return { k, n, hc };
  }).sort((a, b) => b.n - a.n);
  const body = h('div', { class: 'col' }, rows.map(({ k, n, hc }) => h('div', { class: 'card' },
    h('span', { class: 'swatch', style: { background: k.color } }),
    h('span', { class: 'grow' }, k.name + (k.player >= 0 ? (k.player === S.me ? ' (you)' : ' (player)') : '')),
    h('span', { class: 'tag' }, FACTIONS[k.fid].name), h('span', { class: 'muted' }, `${n} land · ${hc} heroes`))));
  modal('Realms', body, [['Close']], { dismiss: true });
}

function chronicle() {
  const st = S.state;
  const body = h('div', { class: 'log' }, [...st.log].reverse().slice(0, 120).map((l) => h('div', {}, `T${l.turn}: ${l.text}`)));
  modal('Chronicle', body, [['Close']], { dismiss: true });
}

function menu() {
  modal('Menu', h('div', { class: 'col' },
    net.role === 'single' ? h('div', { class: 'muted' }, 'Your campaign saves automatically every turn.') : h('div', { class: 'muted' }, `Multiplayer · ${net.role === 'host' ? 'You are hosting' : 'Connected to host'}`)),
  [['Resume'], ['Quit to title', () => { if (net.role !== 'single') net.close(); go('title'); }, 'danger']], { dismiss: true });
}

function intro() {
  S.state.introShown = true;
  const k = myK();
  modal(`Welcome, ${hero(S.state, k.ruler)?.name || 'ruler'}`, h('div', { class: 'col' },
    h('div', {}, `You hold ${S.state.territories[k.capital].name}. Every other land belongs to a rival realm.`),
    h('div', {}, '• Tap your town to give each hero an order: attack a neighbour, move, rest, drill or recruit.'),
    h('div', {}, '• Battles play out live: send squads between posts and take the enemy\'s main post.'),
    h('div', {}, '• Surviving soldiers rank up and evolve. Win loot to equip your heroes.'),
    h('div', {}, '• Conquer every territory to win.'),
  ), [['To war!', null, 'primary']]);
}

// ---------- captives ----------
export function showCaptives() {
  const st = S.state, k = myK();
  const list = captivesOf(st, k.id);
  if (!list.length) { st.pendingCaptives = []; return; }
  let mm;
  const decide = (x, d) => {
    const r = act({ type: 'captive', hero: x.id, decision: d });
    if (d === 'recruit') toast(r === 'joined' ? `${x.name} joins your cause!` : `${x.name} refuses to serve you.`);
    mm.close();
    if (captivesOf(S.state, k.id).length && d !== 'keep') showCaptives();
  };
  const body = h('div', { class: 'col' }, list.map((x) => {
    const was = x.kingdom >= 0 ? st.kingdoms[x.kingdom] : null;
    return h('div', { class: 'col', style: { gap: '4px' } },
      heroCard(st, x, { stats: true, order: false }),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, `Formerly of ${was ? was.name : 'no realm'} · loyalty ${x.loyalty}`),
      h('div', { class: 'row wrap' },
        btn('Recruit', () => decide(x, 'recruit'), 'good small'),
        btn('Release', () => decide(x, 'release'), 'small'),
        btn('Execute', () => decide(x, 'execute'), 'danger small')));
  }));
  st.pendingCaptives = [];
  mm = modal('Prisoners', h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Released heroes wander as vagabonds: they may serve another lord or raise an uprising. Undecided prisoners stay in your dungeons.'), body), [['Decide later']], { width: '640px' });
}

// ---------- turn flow ----------
function endTurnPressed() {
  if (S.busy) return;
  if (net.role === 'client') { net.send({ t: 'ready' }); net.waitingFor = 'Waiting for host…'; refreshUI(); return; }
  if (net.role === 'host') { net.hostReady = true; net.waitingFor = net.peerReady ? null : 'Waiting for player 2…'; refreshUI(); if (net.peerReady) resolveTurn(); return; }
  resolveTurn();
}

export function resolveTurn() {
  const st = S.state;
  S.busy = true; S.target = null; S.sel = null;
  net.hostReady = false; net.peerReady = false; net.waitingFor = null;
  runAI(st);
  applyOrders(st);
  S.queue = collectBattles(st);
  // battles involving humans go first so players aren't kept waiting
  S.queue.sort((a, b) => (isHumanKingdom(st, b.att) || isHumanKingdom(st, st.territories[b.tid].owner)) - (isHumanKingdom(st, a.att) || isHumanKingdom(st, st.territories[a.tid].owner)));
  S.reports = [];
  S.startLog = st.log.length;
  if (net.role === 'host') net.broadcastState();
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

function askFight(b, humanAtt, humanDef) {
  const st = S.state;
  const t = st.territories[b.tid];
  const A = st.kingdoms[b.att], D = b.def >= 0 ? st.kingdoms[b.def] : null;
  const both = humanAtt && humanDef;
  const mineSide = st.kingdoms[b.att].player === S.me ? 'att' : (D && D.player === S.me ? 'def' : null);
  const fight = () => startBattle(b);
  const auto = () => { S.reports.push(applyBattle(st, b, autoResolve(st, b))); if (net.role === 'host') net.broadcastState(); nextBattle(); };
  const summary = h('div', { class: 'col' },
    h('div', {}, `${A.name} (${b.attackers.length} hero${b.attackers.length > 1 ? 'es' : ''}) attacks ${t.name}, held by ${D ? D.name : 'nobody'} (${b.defenders.length} hero${b.defenders.length === 1 ? '' : 'es'} + guard).`),
    h('div', { class: 'row wrap' }, [...b.attackers, ...b.defenders].map((id) => portrait(hero(st, id), 2))));
  if (both || !mineSide) {
    // the other human decides (or both must fight): in multiplayer, fights between players are always live
    if (both) { modal('Battle!', summary, [['Fight!', fight, 'primary']]); return; }
    net.ask({ t: 'askFight', tid: b.tid }).then((ans) => (ans === 'auto' ? auto() : fight()));
    toast('The other player is deciding…');
    return;
  }
  modal(mineSide === 'att' ? 'Your attack' : 'You are under attack!', summary, [['Auto-resolve', auto], ['Fight!', fight, 'primary']]);
}

function startBattle(b) {
  const st = S.state;
  const ctl = (kid) => (isHumanKingdom(st, kid) ? st.kingdoms[kid].player : 'ai');
  go('battle', { state: st, battle: b, control: { att: ctl(b.att), def: b.def >= 0 ? ctl(b.def) : 'ai' }, me: S.me });
}

function resumeQueue(result) {
  const st = S.state, b = S.current;
  if (result && b) {
    const rep = applyBattle(st, b, result);
    S.reports.push(rep);
    if (net.role === 'host') net.broadcastState();
  }
  S.current = null;
  nextBattle();
}
export function resumeAfterBattle(result) { resumeQueue(result); }

function finishTurn() {
  const st = S.state;
  const myKid = st.players[S.me].kingdom;
  const mine = S.reports.filter((r) => st.kingdoms[r.att].player >= 0 || (r.def >= 0 && st.kingdoms[r.def].player >= 0));
  const prevTurn = st.turn;
  const extra = endTurn(st);
  S.busy = false;
  persist();
  if (net.role === 'host') { net.broadcastState(); net.send({ t: 'turnDone', turn: st.turn }); }
  refreshUI();
  showTurnSummary(prevTurn, mine, extra);
}

export function showTurnSummary(prevTurn, mine, extra = []) {
  const st = S.state;
  const myKid = st.players[S.me].kingdom;
  if (st.over) return gameOver();
  if (!st.kingdoms[myKid].alive && !S.toldFallen) {
    S.toldFallen = true;
    return modal('Your realm has fallen', h('div', {}, 'Every territory you held has been taken. You can keep watching the war unfold or leave.'), [['Watch'], ['Title screen', () => { if (net.role !== 'single') net.close(); else clearSave(); go('title'); }, 'danger']]);
  }
  const items = [];
  for (const r of mine || []) {
    const t = st.territories[r.tid];
    const iAtt = r.att === myKid, iDef = r.def === myKid;
    if (!iAtt && !iDef) continue;
    const won = (iAtt && r.attWon) || (iDef && !r.attWon);
    items.push(h('div', { class: won ? 'good' : 'bad' }, `${won ? 'Victory' : 'Defeat'} at ${t.name}` +
      (r.evolved ? ` · ${r.evolved} soldier${r.evolved > 1 ? 's' : ''} evolved!` : '') + (r.promoted ? ` · ${r.promoted} promotions` : '') +
      (r.loot != null && won ? ` · found ${st.items[r.loot].name}` : '')));
  }
  const logs = st.log.filter((l) => l.turn === prevTurn).slice(-14).map((l) => h('div', {}, l.text));
  modal(`Turn ${prevTurn} complete`, h('div', { class: 'col' }, items, extra.map((e) => h('div', { class: 'gold' }, e)), h('div', { class: 'log' }, logs)), [['Continue', () => { if (st.pendingCaptives.length || captivesOf(st, myKid).length && mine?.some((r) => r.captured.length)) showCaptives(); }, 'primary']], { dismiss: false });
}

function gameOver() {
  const st = S.state, myKid = st.players[S.me].kingdom;
  const win = st.over.winner === myKid;
  if (net.role === 'single') clearSave();
  modal(win ? 'Victory!' : 'Defeat', h('div', {}, win ? 'Every realm now bows to you. The dynasty is yours.' : 'Your realm has fallen.'), [['Title screen', () => { if (net.role !== 'single') net.close(); go('title'); }, 'primary']]);
}
