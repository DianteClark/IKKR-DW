import { picon, drawIcon } from '../engine/icons.js';
import { showChat } from './campaign.js';
import { weatherAtId } from '../game/weather.js';
import { autumnizeCanvas } from '../campaign/mapview.js';
import { seasonOf } from '../game/family.js';
import { registerScene, go, game } from '../main.js';
import { ctx, screen, Camera, canvas } from '../engine/view.js';
import { h, btn, mount, modal, toast, bar, sprite, clearUI, banner, stratagemCard, chip, confirm } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { hashStr } from '../engine/rng.js';
import { drawUnit, drawHero, drawSpriteRef, DUNGEON_TILES } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import { serializeSim, deserializeSim, createBattle, step, command, aiThink, battleResult, snapshot, applySnapshot, liveCount, DT, stratagemTargets, planRoute, routeProblem, SKILLS, queuePoints, canClimb, ladderSpot, ABILITIES, DUEL_PICKS, DUEL_PICK_TIME, CHARGE_LEN, visibleTo, campOf } from '../battle/sim.js';
const FORMS = ['wedge', 'line', 'square']; // Loose was retired: three formations, one clear cycle
import { renderGround, drawFieldOverlay, postRef, TS, nearestPost, nearestRoadPoint, terrainAt, TERRAIN } from '../battle/field.js';
import { createFx } from '../battle/fx.js';
import { formationSlots, FORMATIONS, FORMATION_IDS, STRATAGEMS, commandPool, tierIndex, formationEdge } from '../game/rules.js';
import { hero, hasIntel, terrainOf } from '../game/world.js';
import { alliesOf } from '../game/diplomacy.js';
import { line } from '../game/dialogue.js';
import { portrait, unitIcon } from '../campaign/widgets.js';
import { sfx, music } from '../engine/audio.js';
import { prefs, buzz } from '../engine/prefs.js';
import { saveBattle, clearBattle } from '../game/save.js';
import { net } from '../net/net.js';

const cam = new Camera();
const HIDDEN = (s) => s.state === 'dead' || s.state === 'reserve' || s.state === 'reinforce';

// what the land itself looks like, so the battlefield matches the place on the campaign map
function landInfo(st, tid) {
  try {
    const T = terrainOf(st), W = T.W;
    let n = 0, forest = 0, mtn = 0, river = false, lake = false, coast = false;
    let start = -1;
    for (let i = 0; i < T.terr.length; i++) {
      if (T.terr[i] !== tid) continue;
      n++; if (start < 0) start = i;
      if (T.feat[i] === 1) forest++; else if (T.feat[i] === 2) mtn++;
      if (T.river && T.river[i]) river = true;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < T.land.length && !T.land[j]) { if (T.lake && T.lake[j]) lake = true; else coast = true; }
    }
    // a small landmass reads as an island battle
    let island = false;
    if (start >= 0) {
      const seen = new Set([start]); const q = [start];
      while (q.length && seen.size < 260) { const i = q.pop(); for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < T.land.length && T.land[j] && !seen.has(j)) { seen.add(j); q.push(j); } }
      island = seen.size < 260;
    }
    const sites = (st.sites || []).filter((x) => x.tid === tid).map((x) => x.kind);
    return { forest: n ? forest / n : 0, mtn: n ? mtn / n : 0, river, lake, coast, island, sites };
  } catch { return null; }
}
// heroes of an allied realm standing in a neighbouring land ride to help (up to two)
function allyReinforcements(st, kid, b) {
  const t = st.territories[b.tid];
  const busy = new Set([...b.attackers, ...b.defenders]);
  const out = [];
  for (const a of alliesOf(st, kid)) {
    const K = st.kingdoms[a]; if (!K || !K.alive) continue;
    for (const h of st.heroes) {
      if (out.length >= 2) break;
      if (h.status !== 'active' || h.kingdom !== a || busy.has(h.id) || !t.nb.includes(h.loc) || (h.order && h.order.type === 'attack') || !h.troops.length) continue;
      out.push({ ...JSON.parse(JSON.stringify(h)), allyName: K.name });
    }
  }
  return out;
}
const B = { sim: null, ground: null, side: null, sel: null, selected: [], box: false, drag: null, pick: null, freeze: 0, slow: 0, duel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false, colors: null, setup: null, state: null, juice: null, aim: null };
window.__dw = Object.assign(window.__dw || {}, { B, cam, sendCmd: (c) => send(c), tapWorld: (wx, wy) => { const p = cam.toScreen ? cam.toScreen(wx * TS, wy * TS) : null; if (p) tap(p.x, p.y); } });
const SPELL = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
const stratIcon = (id, scale = 2) => { const s = SPELL[STRATAGEMS[id].icon]; return s && s.icon ? sprite(s.icon, 0, 0, 16, 16, scale) : null; };

// args: { state, battle, control:{att,def}, me, key?, saveCtx? } (host/single) or { client:true, setup, items, me, state }
//   or { resumeBattle: <record.battle>, state, me, key? } to pick up a single-player battle saved mid-fight
registerScene('battle', {
  enter(args) {
    const R = args.resumeBattle || null;
    if (R) args = { ...args, setup: R.setup, battle: R.b, saveCtx: R.ctx, me: args.me ?? R.me ?? 0 };
    Object.assign(B, { practice: args.practice || null, coach: null, origArgs: args.practice ? null : args, resumed: !!R, battle: args.battle || null, saveCtx: args.saveCtx ?? null, key: args.key ?? null, _savedAt: 0, kills: new Map(), sel: null, selected: [], box: false, drag: null, pick: null, freeze: 0, slow: 0, duel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false, aim: null, queue: false, auto: false, mode: null, duelPicked: null });
    let setup = args.setup;
    if (!setup) {
      const st = args.state, b = args.battle;
      const t = st.territories[b.tid];
      const A = st.kingdoms[b.att], D = b.def >= 0 ? st.kingdoms[b.def] : null;
      const atk = b.attackers.map((id) => hero(st, id)), dfd = b.defenders.map((id) => hero(st, id));
      setup = {
        seed: hashStr(`${st.seed}:${st.turn}:${b.tid}:${b.att}`), biome: (seasonOf(st.turn) === 'Winter' && !['sand', 'lava', 'ice', 'christmas'].includes(t.biome)) ? 'ice' : t.biome, season: seasonOf(st.turn), level: b.skirmish ? 0 : t.level, place: t.name, siege: !!b.siege,
        attackers: JSON.parse(JSON.stringify(atk)), defenders: JSON.parse(JSON.stringify(dfd)),
        attFid: A.fid, defFid: D ? D.fid : (t.race || 'castle'), attName: A.name, defName: D ? D.name : (t.owner < 0 ? `Free folk of ${t.name}` : 'Town guard'),
        attKid: A.id, defKid: D ? D.id : -1, attMorale: A.morale, defMorale: D ? D.morale : 60,
        attLoadout: (A.loadout || []).slice(), defLoadout: D ? (D.loadout || []).slice() : [],
        attPool: commandPool(atk, tierIndex(A), A.buildings.academy), defPool: D ? commandPool(dfd, tierIndex(D), D.buildings.academy) : 4,
        colors: { att: A.color, def: D ? D.color : '#9aa7b8' }, control: args.control,
        garrison: b.skirmish ? { squads: 0, size: 0 } : { squads: dfd.length ? 1 : 2 + Math.min(2, t.level), size: dfd.length ? 4 + t.level * 2 : 6 + t.level * 3 },
        skirmish: !!b.skirmish,
        weather: weatherAtId(st, b.tid),
        nemesis: Array.isArray(b.nemesis) ? b.nemesis : [], // [[attackerHeroId, defenderHeroId], …] from the campaign's grudges
        intel: hasIntel(st, A.id, b.tid),
        land: landInfo(st, b.tid),
        reinforce: { att: allyReinforcements(st, A.id, b), def: D ? allyReinforcements(st, D.id, b) : [] },
      };
      B.state = st;
    }
    if (R) B.state = args.state || null;
    B.setup = setup;
    B.client = !!args.client;
    if (B.client) B.state = args.state || null;
    B.me = args.me ?? 0;
    B.side = setup.control.att === B.me ? 'att' : setup.control.def === B.me ? 'def' : null;
    // saves from before Auto kept your seat: Auto used to hand the seat to the AI, which resumed you as a watcher
    if (R && !B.side && B.state && B.state.players && B.state.players[B.me]) {
      const k = B.state.players[B.me].kingdom, sd = setup.attKid === k ? 'att' : setup.defKid === k ? 'def' : null;
      if (sd) { setup.control[sd] = B.me; B.side = sd; R.auto = true; }
    }
    B.colors = { ...setup.colors };
    const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [a, d] = [rgb(B.colors.att), rgb(B.colors.def)];
    if (Math.hypot(a[0] - d[0], a[1] - d[1], a[2] - d[2]) < 130) B.colors.def = a[2] > 150 ? '#f5c630' : '#3a7bf0';
    const simSetup = { ...setup, items: B.state ? B.state.items : (args.items || {}) };
    B.sim = R ? deserializeSim(simSetup, R.sim) : createBattle(simSetup);
    B.sim.ai = { att: setup.control.att === 'ai', def: setup.control.def === 'ai' };
    if (R) { B.kills = new Map(R.kills || []); B.speed = R.speed || 1; B.seenEv = B.sim.evSeq; if (R.auto && B.side) { B.auto = true; B.sim.ai[B.side] = true; } }
    B.ground = renderGround(B.sim.field);
    if (B.setup.season === 'Autumn' && !['sand', 'lava', 'ice', 'christmas'].includes(B.setup.biome)) autumnizeCanvas(B.ground);
    B.juice = createFx();
    if (net.role === 'host') {
      net.send({ t: 'battleStart', setup, items: B.state.items });
      // the other player's orders (Auto keeps their seat, so a later Retreat still counts)
      net.on('cmd', (m) => { const side = setup.control.att === 1 ? 'att' : setup.control.def === 1 ? 'def' : null; if (!side) return; if (m.c.type === 'auto') { B.sim.ai[side] = true; toast('The other player let their generals take over'); return; } command(B.sim, side, m.c); });
    }
    if (net.role !== 'single') net.on('chat', (m) => showChat(m.text, false));
    if (B.client) { net.on('snap', (m) => { const now = performance.now(), prev = new Map(B.sim.squads.map((q) => [q.id, [q.x, q.y]])); const gap = Math.min(0.4, Math.max(0.05, (now - (B.snapAt || now - 100)) / 1000)); applySnapshot(B.sim, m.s); B.snapAt = now; for (const q of B.sim.squads) { const o = prev.get(q.id); q._vx = o ? (q.x - o[0]) / gap : 0; q._vy = o ? (q.y - o[1]) / gap : 0; } }); net.on('battleEnd', (m) => endBattle(m.result)); }
    music.start('battle');
    fitCamera();
    buildUI();
    B._hide = () => { if (document.visibilityState === 'hidden') saveNow(true); };
    B._pagehide = () => saveNow(true);
    document.addEventListener('visibilitychange', B._hide); window.addEventListener('pagehide', B._pagehide);
    if (B.practice) startCoach();
    if (R) resumeIntro(); else if (B.practice) practiceIntro(); else intro();
  },
  exit() {
    document.removeEventListener('visibilitychange', B._hide); window.removeEventListener('pagehide', B._pagehide);
    net.off('cmd'); net.off('snap'); net.off('battleEnd'); net.off('battleGo');
    if (B._down) { canvas.removeEventListener('pointerdown', B._down); canvas.removeEventListener('pointermove', B._move); canvas.removeEventListener('pointerup', B._up); }
  },
  update(dt) {
    const sim = B.sim; if (!sim) return;
    B.freeze = prefs.lowFx ? 0 : Math.max(0, B.freeze - dt); // low effects: no hit-stop
    B.slow = Math.max(0, B.slow - dt);
    if (!B.client && B.started && !B.paused && !B.ended && B.freeze <= 0) {
      B.acc += dt * (myDuel() && myDuel().pending ? 1 : B.speed) * (B.slow > 0 ? 0.3 : 1); // a duel choice waits for you at normal speed
      let n = 0;
      while (B.acc >= DT && n++ < 10) {
        B.acc -= DT;
        for (const side of ['att', 'def']) aiThink(sim, side, !sim.ai[side]); // AI generals, or just the allies of a human side
        step(sim);
        if (net.role === 'host' && sim.tick % 2 === 0) net.send({ t: 'snap', s: snapshot(sim) });
        if (sim.winner) break;
      }
      if (sim.winner && !B.ended) { if (net.role === 'host') net.send({ t: 'snap', s: snapshot(sim) }); B.ended = true; setTimeout(() => finish(), 1400); }
    }
    if (B.started && !B.ended && game.time - B._savedAt > 5) saveNow(false);
    if (B.coach) coachTick();
    consumeEvents();
    updateRender(dt);
    B.juice.update(dt);
    if ((game.time * 4 | 0) !== B._uiTick) { B._uiTick = game.time * 4 | 0; refreshHUD(); }
  },
  render() { draw(); },
  get sim() { return B.sim; }, // for tests and tools
  onTap(sx, sy) { tap(sx, sy); },
  onPanStart(sx, sy) { dragStart(sx, sy); },
  onPan(dx, dy, x, y) {
    if (B.drag && B.drag.mode !== 'pan') { B.drag.x = x; B.drag.y = y; return; }
    cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; cam.clamp();
  },
  onPinch(cx, cy, f, mx, my) { B.drag = null; cam.zoomAt(cx, cy, f); cam.x -= mx / cam.zoom; cam.y -= my / cam.zoom; cam.clamp(); },
  onGestureEnd(x, y) { dragEnd(x, y); },
  onResize() { B._fitOnly = true; fitCamera(); B._fitOnly = false; },
});

const LEFT = 92;
const RIGHT = () => (B.side && B.sim && B.sim.strat[B.side].list.length ? 84 : 0);
function fitCamera() {
  const F = B.sim.field;
  const W = F.W * TS, H = F.H * TS;
  const availW = screen.w - LEFT - 8 - RIGHT(), availH = screen.h - 52;
  cam.zoom = Math.min(availW / W, availH / H);
  cam.min = cam.zoom; cam.max = Math.max(cam.zoom * 4, 3);
  cam.bounds = { x: -LEFT / cam.zoom, y: -44 / cam.zoom, w: W + (LEFT + RIGHT()) / cam.zoom, h: H + 44 / cam.zoom };
  cam.x = W / 2 - ((LEFT - RIGHT()) / 2) / cam.zoom; cam.y = H / 2 - 20 / cam.zoom;
  // start close enough to read the troops (a tile ~22 CSS px), centred on your army; pinch out for the whole field
  if (B.side && !B._fitOnly) {
    const z = Math.max(cam.zoom, Math.min(cam.max, 1.4));
    if (z > cam.zoom * 1.1) {
      const mine = B.sim.squads.filter((q) => q.side === B.side && q.state !== 'reserve' && q.state !== 'reinforce');
      const foeMain = F.posts.find((p) => p.main) || F.posts[0];
      const ax = mine.length ? mine.reduce((a, q) => a + q.x, 0) / mine.length : W / TS / 2, ay = mine.length ? mine.reduce((a, q) => a + q.y, 0) / mine.length : H / TS / 2;
      // look a little toward the objective
      const tx = (ax * 0.7 + foeMain.x * 0.3) * TS, ty = (ay * 0.7 + foeMain.y * 0.3) * TS;
      cam.zoom = z; cam.x = tx - ((LEFT - RIGHT()) / 2) / cam.zoom; cam.y = ty; cam.clamp();
    }
  }
}

// ---------- render state ----------
function updateRender(dt) {
  if (B.pick && (B.pick.t -= dt) <= 0) B.pick = null;
  if (B.duel) { const D = B.duel; D.age += dt; if (D.age > 0.7 && D.age < D.life - 0.5 && (D.clashT = (D.clashT || 0) - dt) <= 0) { D.clashT = 0.55 + Math.random() * 0.35; sfx('duelClash'); } if (D.age >= D.life) B.duel = null; }
  const since = B.client && B.snapAt ? Math.min(0.15, (performance.now() - B.snapAt) / 1000) : 0;
  for (const s of B.sim.squads) {
    let r = B.render.get(s.id);
    if (!r) { r = { x: s.x, y: s.y, soldiers: s.soldiers.map(() => ({ x: s.x * TS, y: s.y * TS })), hx: s.x * TS, hy: s.y * TS, flash: 0, dmg: 0, dmgT: 0, dustT: 0 }; B.render.set(s.id, r); }
    const tx0 = s.x + (s._vx || 0) * since, ty0 = s.y + (s._vy || 0) * since;
    const k = Math.min(1, dt * (B.client ? 10 : 14));
    r.x += (tx0 - r.x) * k; r.y += (ty0 - r.y) * k;
    // aggregated damage numbers: one number per squad every ~0.35s instead of a cloud
    r.dmgT -= dt;
    if (r.dmg > 0 && r.dmgT <= 0) { if (r.dmg >= 3) B.juice.damage(r.x * TS, r.y * TS - 16, r.dmg, r.dmg >= 20 ? '#ff9a7a' : '#ffd0c0'); r.dmg = 0; r.dmgT = 0.35; }
    // dust kicked up by marching / charging squads
    r.dustT -= dt;
    if (s.state === 'move' && r.dustT <= 0 && s.state !== 'dead') {
      r.dustT = s.chase != null ? 0.12 : 0.3;
      const live = r.soldiers.filter((_, i) => s.soldiers[i] && s.soldiers[i].alive);
      const p = live[Math.floor(Math.random() * live.length)];
      if (p) B.juice.dust(p.x, p.y);
    }
    r.flash = Math.max(0, r.flash - dt * 4);
    const alive = s.soldiers.filter((x) => x.alive);
    const f = s.reform && s.reform.t / (s.reform.total || 1) > 0.5 ? s.reform.to : s.formation;
    const slots = formationSlots(f, alive.length);
    const c = Math.cos(s.dir), sn = Math.sin(s.dir);
    const jit = s.reform ? 0.25 : 0;
    let j = 0;
    s.soldiers.forEach((so, i) => {
      const rp = r.soldiers[i];
      if (!so.alive) return;
      const [ox, oy] = slots[j++] || [0, 0];
      const jx = jit ? Math.sin(game.time * 9 + i) * jit : 0;
      const tx = (r.x + ox * c - oy * sn + jx) * TS, ty = (r.y + ox * sn + oy * c) * TS;
      const kk = Math.min(1, dt * 6);
      rp.x += (tx - rp.x) * kk; rp.y += (ty - rp.y) * kk;
    });
    const hx = (r.x - 0.95 * c) * TS, hy = (r.y - 0.95 * sn) * TS;
    r.hx += (hx - r.hx) * Math.min(1, dt * 6); r.hy += (hy - r.hy) * Math.min(1, dt * 6);
  }
  B.fx = B.fx.filter((f) => (f.age += dt) < f.life);
}

function consumeEvents() {
  const sim = B.sim, J = B.juice;
  for (const e of sim.events) {
    if (e.seq <= B.seenEv) continue;
    B.seenEv = e.seq;
    const sq = (id) => sim.squads.find((s) => s.id === id);
    const mineSide = (side) => B.side && side === B.side;
    if (e.k === 'die') {
      if (e.by != null && e.by >= 0) B.kills.set(e.by, (B.kills.get(e.by) || 0) + 1);
      const s = sq(e.id), r = B.render.get(e.id); if (!s || !r) continue;
      const i = s.soldiers.findIndex((x) => x.idx === e.idx), p = r.soldiers[i];
      if (p) { B.fx.push({ k: 'corpse', x: p.x, y: p.y, fid: s.fid, unit: s.unit, stage: s.soldiers[i].s, flip: Math.cos(s.dir) < 0, age: 0, life: prefs.lowFx ? 2.5 : 6 }); J.dust(p.x, p.y); }
      sfx('death');
      if (e.elite && mineSide(s.side)) toast(`${e.elite} has fallen!`, 'bad');
    } else if (e.k === 'hit') {
      const r = B.render.get(e.id); if (!r) continue;
      r.flash = 1;
      r.dmg = (r.dmg || 0) + e.d;
      J.hit(r.x * TS + (Math.random() - 0.5) * 10, r.y * TS - 4, '#fff');
      if (e.d >= 14 && (B._bigHit || 0) < game.time) { B._bigHit = game.time + 0.6; B.freeze = Math.max(B.freeze, 0.06); J.sparks(r.x * TS, r.y * TS - 6, '#ffd86b'); J.shake(2, 0.15); const hs = sq(e.id); if (hs && mineSide(hs.side)) buzz('hit'); }
      sfx(e.d >= 14 ? 'heavy' : 'hit');
    } else if (e.k === 'shot') {
      const a = B.render.get(e.from), b = B.render.get(e.to); if (!a || !b) continue;
      for (let i = 0; i < 3; i++) B.fx.push({ k: 'arrow', x1: a.x * TS + (i - 1) * 4, y1: a.y * TS - 6 + i * 3, x2: b.x * TS + (i - 1) * 5, y2: b.y * TS - 4, age: -i * 0.06, life: 0.4 });
      if (Math.random() < 0.3) sfx('volley', { n: 3 + Math.floor(Math.random() * 3) }); else sfx('arrow');
    } else if (e.k === 'spell') {
      B.fx.push({ k: 'spell', spell: SPELL[e.spell], x: e.x * TS, y: e.y * TS, age: 0, life: 1.1 });
      J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); J.shake(4, 0.35); sfx('spell');
      const s = sq(e.from); if (s) toast(`${s.name}: ${SPELL[e.spell]?.name || 'Special'}!`, mineSide(s.side) ? 'good' : 'bad');
    } else if (e.k === 'capture') {
      const p = sim.field.posts[e.post];
      B.fx.push({ k: 'flash', x: p.x * TS, y: p.y * TS, age: 0, life: 0.8, side: e.side });
      J.confetti(p.x * TS, p.y * TS - 20);
      { const good = mineSide(e.side) || (!B.side && e.side === 'att'); sfx(p.main ? (good ? 'fanfare' : 'mainLost') : good ? 'capture' : 'lost'); if (B.side) buzz(p.main ? 'heavy' : good ? 'tap' : 'alert'); }
      B.fx.push({ k: 'flag', x: p.x * TS + 10, y: p.y * TS - 8, age: 0, life: 2.4, col: B.colors[e.side] });
      if (p.main) { B.slow = 1.6; J.shake(6, 0.6); J.shockwave(p.x * TS, p.y * TS, '#ffd86b'); }
      if (B.side) banner(p.main ? (e.side === B.side ? 'MAIN POST TAKEN' : 'MAIN POST LOST') : e.side === B.side ? 'Post captured' : 'Post lost', e.side === B.side ? 'good' : 'bad');
    } else if (e.k === 'heroDown') {
      const s = sq(e.id); if (s) { toast(`${s.name}: “${line('heroDown', null, e.seq)}”`, mineSide(s.side) ? 'bad' : 'good'); const r = B.render.get(e.id); if (r) J.shockwave(r.hx, r.hy, '#ff6a5a'); J.shake(3, 0.3); B.freeze = Math.max(B.freeze, 0.12); }
    } else if (e.k === 'rout') {
      const s = sq(e.id), r = B.render.get(e.id);
      if (r) { J.floatText(r.x * TS, r.y * TS - 30, 'ROUTED!', mineSide(s && s.side) ? '#ff6a5a' : '#8fd06b'); B.fx.push({ k: 'whiteflag', x: r.x * TS + 8, y: r.y * TS - 10, age: 0, life: 2 }); }
      sfx('rout');
      if (s && mineSide(s.side)) buzz('lose');
      if (s && mineSide(s.side)) toast(`${s.name}'s squad is routing!`, 'bad');
    } else if (e.k === 'flank') {
      J.floatText(e.x * TS, e.y * TS - 24, e.rear ? 'REAR ATTACK!' : 'FLANKED!', '#ffb347'); sfx('flank');
    } else if (e.k === 'charge') {
      const s = sq(e.id);
      if (e.broken) { J.floatText(e.x * TS, e.y * TS - 26, 'BROKEN ON PIKES!', '#ff6a5a'); J.sparks(e.x * TS, e.y * TS - 6, '#ff9a7a'); }
      else { J.floatText(e.x * TS, e.y * TS - 26, 'CHARGE!', '#ffd86b'); J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); J.shake(4, 0.3); B.freeze = Math.max(B.freeze, 0.08); }
      sfx(e.broken ? 'heavy' : 'charge');
      if (s && mineSide(s.side) && e.broken) toast(`${s.name}'s charge broke on enemy pikes`, 'bad');
    } else if (e.k === 'reserve') {
      const s = sq(e.id); J.shockwave(e.x * TS, e.y * TS, '#8fd06b'); sfx('horn');
      if (s) banner('RESERVES!', mineSide(s.side) ? 'good' : 'bad', `${s.name} takes the field`);
    } else if (e.k === 'reinforce') {
      J.shockwave(e.x * TS, e.y * TS, '#6bb6ff'); sfx('horn');
      banner('ALLIES ARRIVE', mineSide(e.side) ? 'good' : 'bad', `${e.name || 'Allies'} join the ${e.side === 'att' ? 'attack' : 'defence'}`);
    } else if (e.k === 'skill') {
      const s = sq(e.id), S = SKILLS[e.role];
      J.shockwave(e.x * TS, e.y * TS, mineSide(e.side) ? '#6bb6ff' : '#ff6a5a'); sfx('stratagem');
      if (s && S) { J.floatText(e.x * TS, e.y * TS - 30, S.name.toUpperCase() + '!', '#ffd86b'); if (e.role !== 'duelist') toast(`${s.name}: ${S.name}`, mineSide(e.side) ? 'good' : 'bad'); }
      if (e.role === 'scout' && mineSide(e.side)) banner('THE WAY IS CLEAR', 'blue', 'Fog lifts · traps revealed');
    } else if (e.k === 'trap') {
      B.fx.push({ k: 'trap', x: e.x * TS, y: e.y * TS, age: 0, life: 0.4 }); J.sparks(e.x * TS, e.y * TS, '#ffb347');
    } else if (e.k === 'treachery') {
      const s = sq(e.id);
      sfx('ambush'); J.shake(6, 0.5);
      banner('TREACHERY!', mineSide(s && s.side) ? 'good' : 'bad', s ? `${s.name}: “${line('treachery', null, e.seq)}”` : '');
    } else if (e.k === 'mapEvent') {
      const names = { landslide: 'ROCKSLIDE!', flood: 'FLOOD!', collapse: 'CAVE-IN!', fire: 'WILDFIRE!' };
      banner(names[e.kind] || 'THE LAND SHIFTS', 'bad', 'A route has been cut');
      sfx(e.kind === 'flood' ? 'flood' : e.kind === 'fire' ? 'fire' : 'quake'); J.shake(7, 0.7);
      for (let i = 0; i < 8; i++) J.smoke(e.x * TS + (Math.random() - 0.5) * 40, e.y * TS + (Math.random() - 0.5) * 20);
    } else if (e.k === 'fog') {
      banner('FOG ROLLS IN', 'blue', 'Archers can barely see'); sfx('alert');
    } else if (e.k === 'strat') {
      const S = STRATAGEMS[e.id];
      sfx(e.id === 'ambush' ? 'ambush' : e.id === 'fire' ? 'fire' : e.id === 'landslide' ? 'quake' : 'stratagem');
      banner(S.name.toUpperCase(), mineSide(e.side) ? 'good' : 'bad', mineSide(e.side) ? 'Stratagem' : 'Enemy stratagem!');
      if (e.x || e.y) { J.shockwave(e.x * TS, e.y * TS, mineSide(e.side) ? '#6bb6ff' : '#ff6a5a'); if (e.id === 'fire') for (let i = 0; i < 10; i++) J.fire(e.x * TS + (Math.random() - 0.5) * 50, e.y * TS + (Math.random() - 0.5) * 30); }
      if (e.id === 'ambush') J.shake(5, 0.4);
    } else if (e.k === 'duelStart') {
      const a = sq(e.a), b = sq(e.b);
      B.duel = { a: e.a, b: e.b, age: 0, life: 99 };
      if (myDuel()) toast('Duel! Choose Strike, Guard or Feint below each round', 'gold'); // only when the choice really is yours (not in Auto, not an ally's hero)
      B.slow = Math.max(B.slow, 1.1); // heroes meet: a breath of slow motion
      sfx('duel'); J.shake(3, 0.25);
      banner(e.challenge ? 'CHALLENGE!' : 'DUEL!', mineSide(a && a.side) || mineSide(b && b.side) ? '' : 'blue', `${a ? a.name : '?'} vs ${b ? b.name : '?'}`);
    } else if (e.k === 'duelEnd') {
      if (B.duel) B.duel.life = Math.min(B.duel.life, B.duel.age + 0.4);
      if (e.win != null) {
        const w = sq(e.win), l = sq(e.lose);
        B.freeze = Math.max(B.freeze, 0.15); J.shake(5, 0.4);
        if (e.x != null) { J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); J.sparks(e.x * TS, e.y * TS - 8, '#ffd86b'); }
        sfx(mineSide(w && w.side) ? 'capture' : 'lost');
        if (w) banner(`${w.name.toUpperCase()} WINS THE DUEL`, mineSide(w.side) ? 'good' : B.side ? 'bad' : '', (e.wins ? `${Math.max(...e.wins)}–${Math.min(...e.wins)} · ` : '') + (l ? `${l.name} is wounded` : ''));
        if (B.side && w) buzz(mineSide(w.side) ? 'heavy' : 'lose');
      }
    } else if (e.k === 'gateHit') {
      if ((B._gateT || 0) < game.time) { B._gateT = game.time + 0.45; J.sparks(e.x * TS, e.y * TS, '#ffd86b'); J.shake(1.5, 0.12); sfx('hit'); }
    } else if (e.k === 'gateBroken') {
      J.shockwave(e.x * TS, e.y * TS, '#ffb347'); J.shake(7, 0.6); B.freeze = Math.max(B.freeze, 0.15); sfx('gate'); buzz('heavy');
      for (let i = 0; i < 8; i++) J.smoke(e.x * TS + (Math.random() - 0.5) * 30, e.y * TS + (Math.random() - 0.5) * 20);
      banner('THE GATE FALLS!', B.side === 'att' ? 'good' : B.side === 'def' ? 'bad' : '', 'The way into the keep is open');
    } else if (e.k === 'ladder') {
      const s = sq(e.id); J.dust(e.x * TS, e.y * TS); sfx('ladder');
      if (s && B.side && s.side !== B.side) toast('Ladders on the walls! Shoot the climbers', 'bad');
    } else if (e.k === 'ladderFail') {
      const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name} can't reach that stretch of wall`, 'bad');
    } else if (e.k === 'overWall') {
      const s = sq(e.id); J.shockwave(e.x * TS, e.y * TS, '#ffd86b');
      if (s) J.floatText(e.x * TS, e.y * TS - 24, 'OVER THE WALL!', mineSide(s.side) ? '#8fd06b' : '#ff6a5a');
    } else if (e.k === 'nemesisMeet') {
      const a = sq(e.a), b = sq(e.b);
      if (a && b) { J.floatText(e.x * TS, e.y * TS - 30, 'NEMESIS!', '#ff6a5a'); toast(`${a.name.split(' ')[0]}: “${b.name.split(' ')[0]}! You again!”`, mineSide(a.side) ? 'gold' : 'bad'); sfx('clash'); }
    } else if (e.k === 'nemesis') {
      const w = sim.squads.find((q) => q.id === e.ws), l = sim.squads.find((q) => q.id === e.ls);
      if (w && l) banner('A GRUDGE SETTLED', mineSide(w.side) ? 'good' : B.side ? 'bad' : '', `${w.name} bests ${l.name}`);
    } else if (e.k === 'arrive') {
      const s = sq(e.id); if (s && mineSide(s.side)) { const r = B.render.get(s.id); if (r) B.fx.push({ k: 'ring', x: r.x * TS, y: r.y * TS, age: 0, life: 0.45, col: '#8fd06b' }); }
    } else if (e.k === 'join') {
      const s = sq(e.id);
      if (s && mineSide(s.side)) { const r = B.render.get(s.id); if (r) J.floatText(r.x * TS, r.y * TS - 26, 'TO ARMS!', '#ffd25a'); }
    } else if (e.k === 'disengage') {
      const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name} breaks off the fight`);
    } else if (e.k === 'reform') {
      const s = sq(e.id); if (s && mineSide(s.side)) sfx('march');
    } else tacticEvent(e, sq, mineSide);
  }
}

const PICK_NAME = { strike: 'Strike', guard: 'Guard', feint: 'Feint' };
function tacticEvent(e, sq, mineSide) {
  const J = B.juice;
  if (e.k === 'ability') {
    const s = sq(e.id), A = ABILITIES[e.a]; if (!s || !A) return;
    const r = B.render.get(s.id), px = (r ? r.x : s.x) * TS, py = (r ? r.y : s.y) * TS, vis = seenBy(s);
    if (vis) J.floatText(px, py - 30, A.name.toUpperCase() + '!', mineSide(s.side) ? '#9fd0ff' : '#ff9a7a');
    if (e.a === 'charge') { sfx('charge'); J.shake(3, 0.25); if (mineSide(s.side)) buzz('heavy'); }
    else if (e.a === 'brace') sfx('brace');
    else if (e.a === 'shields') sfx('shields');
    else if (e.a === 'fire') sfx('fire');
    else if (e.a === 'blast') { const sp = SPELL[s.spell] || SPELLS[0]; B.fx.push({ k: 'spell', spell: sp, x: e.x * TS, y: e.y * TS, age: 0, life: 1.1 }); J.shockwave(e.x * TS, e.y * TS, '#c48bff'); J.shake(3, 0.3); sfx('spell'); }
    else if (e.a === 'roar') { if (vis) J.shockwave(px, py, '#ff9a3a'); J.shake(4, 0.35); sfx('roar'); if (B.side && !mineSide(s.side)) buzz('alert'); }
    else if (e.a === 'dive') sfx('dive');
  } else if (e.k === 'chargeHit' || e.k === 'diveHit') {
    J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); J.sparks(e.x * TS, e.y * TS - 6, '#ffd86b'); J.shake(3, 0.2);
    B.freeze = Math.max(B.freeze, 0.05); sfx(e.k === 'diveHit' ? 'heavy' : 'trample');
    J.floatText(e.x * TS, e.y * TS - 20, e.k === 'diveHit' ? 'SWOOP!' : 'TRAMPLED!', '#ffd86b');
    const t = sq(e.to); if (t && mineSide(t.side)) buzz('hit');
  } else if (e.k === 'chargeEnd') {
    const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name}'s riders are disordered for a moment`);
  } else if (e.k === 'ammoOut') {
    const s = sq(e.id); if (s && mineSide(s.side)) { toast(`${s.name} is out of arrows · send them to a base or Camp to resupply`, 'bad'); sfx('alert'); }
  } else if (e.k === 'guard') {
    const s = sq(e.id); if (s && mineSide(s.side)) B.fx.push({ k: 'ring', x: e.x * TS, y: e.y * TS, age: 0, life: 0.6, col: '#9fd0ff' });
  } else if (e.k === 'regroup') {
    const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name} falls back to regroup`);
  } else if (e.k === 'regrouped') {
    const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name} regroups at camp · any order sends them back out`, 'good');
  } else if (e.k === 'rejoin') {
    const s = sq(e.id), r = B.render.get(e.id);
    if (s && r && seenBy(s)) { J.floatText(r.x * TS, r.y * TS - 26, '+1', '#8fd06b'); if (mineSide(s.side)) sfx('rejoin'); }
  } else if (e.k === 'panic') {
    const s = sq(e.id), r = B.render.get(e.id);
    if (s && r && seenBy(s)) J.floatText(r.x * TS, r.y * TS - 24, e.calm ? 'STEADY!' : 'PANIC!', e.calm ? '#9fd0ff' : '#ff9a7a');
    if (s && mineSide(s.side) && !e.calm) sfx('panic');
  } else if (e.k === 'hill') {
    J.shockwave(e.x * TS, e.y * TS, B.colors[e.side]); sfx(mineSide(e.side) ? 'capture' : 'lost');
    if (B.side) toast(mineSide(e.side) ? 'High ground taken · squads up there shoot farther and take less harm' : 'The enemy holds the high ground', mineSide(e.side) ? 'good' : 'bad');
  } else if (e.k === 'objective') {
    const mine = mineSide(e.side);
    const T = { caravan: ['CARAVAN DELIVERED', 'Fresh supplies: morale and command points'], supplies: ['SUPPLIES BURNED', 'Enemy arrows and morale run short'], captive: ['CAPTIVE FREED', 'The rescued captive joins the cheering'] }[e.kind] || ['OBJECTIVE', ''];
    banner(T[0], B.side ? (mine ? 'good' : 'bad') : '', T[1]);
    sfx(mine || !B.side ? 'objective' : 'lost'); if (B.side) buzz(mine ? 'heavy' : 'alert');
    J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); if (mine && !prefs.lowFx) J.confetti(e.x * TS, e.y * TS - 16);
    if (e.kind === 'supplies') for (let i = 0; i < 6; i++) J.fire(e.x * TS + (Math.random() - 0.5) * 24, e.y * TS + (Math.random() - 0.5) * 14);
  } else if (e.k === 'duelRound') {
    const a = sq(e.a), b = sq(e.b), w = sq(e.win);
    J.floatText(e.x * TS, e.y * TS - 34, `${PICK_NAME[e.pa]} vs ${PICK_NAME[e.pb]}`, '#f7efe0');
    J.sparks(e.x * TS, e.y * TS - 8, '#ffd86b'); J.shake(2, 0.15); sfx('duelClash');
    if (w && B.side && (mineSide(a && a.side) || mineSide(b && b.side))) {
      const won = mineSide(w.side);
      toast(`Round ${e.round}: ${won ? 'your' : 'their'} ${PICK_NAME[w.id === e.a ? e.pa : e.pb]} wins`, won ? 'good' : 'bad'); buzz(won ? 'tap' : 'hit');
    }
  }
}
const seenBy = (s) => !B.side || s.side === B.side || visibleTo(B.sim, B.side, s);
// a duel my hero is in, and whether it waits on my choice
function myDuel() {
  const d = B.sim && B.sim.duel; if (!d || !B.side || B.auto) return null;
  const a = B.sim.squads.find((q) => q.id === d.a), b = B.sim.squads.find((q) => q.id === d.b);
  const mineA = !!(a && a.side === B.side && !a.ally), mineB = !!(b && b.side === B.side && !b.ally);
  if (!mineA && !mineB) return null;
  const key = `${d.a}:${d.b}:${d.round}`;
  const picked = !!(mineA ? d.pa : d.pb) || B.duelPicked === key;
  return { d, me: mineA ? a : b, foe: mineA ? b : a, key, pending: d.rt >= 0 && !picked, left: Math.max(0, DUEL_PICK_TIME - d.rt), wins: mineA ? d.wins : [d.wins[1], d.wins[0]] };
}
function pickDuel(k) {
  const m = myDuel(); if (!m || !m.pending) return;
  B.duelPicked = m.key; send({ type: 'duel', pick: k }); sfx('duelPick'); buzz('tap'); refreshHUD(true);
}

// ---------- drawing ----------
function draw() {
  const sim = B.sim; if (!sim) return;
  const off = B.juice.offset();
  cam.apply();
  ctx.translate(off.x, off.y);
  ctx.drawImage(B.ground, 0, 0);
  const time = game.time;
  drawFieldOverlay(ctx, sim.field, time);
  const dt = img(DUNGEON_TILES);
  const seen = B.side && sim.trapsSeen && sim.trapsSeen[B.side] > 0;
  for (const tr of sim.field.traps || []) {
    const f = Math.floor(time * 4) % 4;
    const row = tr.kind === 'spikes' ? 128 : tr.kind === 'axe' ? 160 : 176;
    ctx.globalAlpha = seen ? 1 : 0.45;
    if (dt) ctx.drawImage(dt, 192 + f * 16, row, 16, 16, tr.x * TS - 8, tr.y * TS - 8, 16, 16);
    ctx.globalAlpha = 1;
    if (seen) { ctx.strokeStyle = `rgba(255,120,80,${0.5 + 0.4 * Math.sin(time * 6)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(tr.x * TS, tr.y * TS, 10, 0, Math.PI * 2); ctx.stroke(); }
  }
  // fires from stratagems
  for (const f of sim.fires) {
    ctx.fillStyle = `rgba(255,${100 + Math.sin(time * 9) * 30 | 0},40,0.22)`;
    ctx.beginPath(); ctx.ellipse(f.x * TS, f.y * TS, f.r * TS, f.r * TS * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    if (Math.random() < (prefs.lowFx ? 0.12 : 0.5)) B.juice.fire(f.x * TS + (Math.random() - 0.5) * f.r * TS * 1.6, f.y * TS + (Math.random() - 0.5) * f.r * TS);
  }
  const selList = selSquads();
  const sel = selList[0] || null;
  drawRoutes(selList, time);
  if (B.side && sim.reveal && sim.reveal[B.side] > 0) drawRoutes(sim.squads.filter((q) => q.side !== B.side && !HIDDEN(q) && (q.chase != null || (q.path && q.path.length))), time, true);
  // rally points being held
  for (const q of sim.squads) if (!HIDDEN(q) && q.rally && q.holdFast && q.side === B.side) { const px = q.rally.x * TS, py = q.rally.y * TS; ctx.fillStyle = '#0b0a10'; ctx.fillRect(px - 1, py - 14, 2, 14); ctx.fillStyle = B.colors[q.side]; ctx.fillRect(px + 1, py - 14, 7, 5); }
  // stratagem targeting highlights
  if (B.aim) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 8);
    ctx.strokeStyle = `rgba(255,216,107,${pulse})`; ctx.lineWidth = 2;
    for (const t of B.aim.targets) {
      if (t.kind === 'squad') { const s = sim.squads.find((q) => q.id === t.id); const r = s && B.render.get(s.id); if (r) { ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS, 1.8 * TS, 1.2 * TS, 0, 0, Math.PI * 2); ctx.stroke(); } }
      if (t.kind === 'post') { const p = sim.field.posts[t.id]; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.6 * TS, 1.8 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
      if (t.kind === 'edge') { const [a, b] = sim.field.edges[t.id]; const A = sim.field.posts[a], Bp = sim.field.posts[b]; ctx.beginPath(); ctx.arc((A.x + Bp.x) / 2 * TS, (A.y + Bp.y) / 2 * TS, 8, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  for (const p of sim.field.posts) {
    const ref = postRef(p, B.setup.defFid, B.setup.attFid);
    const w = p.main ? ref[3] * 0.75 : ref[3], hh = p.main ? ref[4] * 0.75 : ref[4];
    const col = p.owner === 'att' ? B.colors.att : p.owner === 'def' ? B.colors.def : '#d6d0c4';
    ctx.fillStyle = col; ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (p.fort) { ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.5 * TS, 1.7 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (sel && !B.aim) { ctx.strokeStyle = `rgba(255,210,90,${0.35 + 0.2 * Math.sin(time * 4 + p.id)})`; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    drawSpriteRef(ctx, ref, p.x * TS - w / 2, p.y * TS - hh + 8, w, hh);
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(p.x * TS + w / 2 - 3, p.y * TS - hh, 1, 14);
    ctx.fillStyle = col; ctx.fillRect(p.x * TS + w / 2 - 2, p.y * TS - hh + Math.sin(time * 4 + p.id), 7, 5);
    if (p.prog > 0) {
      ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS - hh - 6, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = p.by === 'att' ? B.colors.att : B.colors.def; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS - hh - 6, 5, -Math.PI / 2, -Math.PI / 2 + p.prog * Math.PI * 2); ctx.stroke();
    }
  }
  drawSiege(time);
  drawTactics(time);
  if (B.coach) drawCoach(time);
  const list = [];
  for (const f of B.fx) if (f.k === 'corpse') list.push({ y: f.y - 1, f });
  for (const s of sim.squads) {
    const r = B.render.get(s.id); if (!r || HIDDEN(s) || !seenBy(s)) continue;
    const anim = s.state === 'fight' || s.state === 'shoot' || s.state === 'siege' ? 'attack' : s.state === 'move' || s.state === 'rout' || s.state === 'climb' || s.state === 'charge' ? 'walk' : s.state === 'confused' ? 'hit' : 'idle';
    const flip = Math.cos(s.dir) < 0;
    s.soldiers.forEach((so, i) => { if (so.alive) list.push({ y: r.soldiers[i].y, s, so, p: r.soldiers[i], anim, flip, i, flash: r.flash }); });
    if (s.heroAlive) list.push({ y: r.hy, s, hero: true, p: { x: r.hx, y: r.hy }, anim, flip });
  }
  for (const s of sim.squads) {
    if (HIDDEN(s) || !seenBy(s)) continue;
    const r = B.render.get(s.id);
    const rad = 1.1 + Math.sqrt(liveCount(s)) * 0.12;
    const isSel = B.selected.includes(s.id);
    const mineSq = B.side && s.side === B.side;
    ctx.fillStyle = B.colors[s.side]; ctx.globalAlpha = isSel ? 0.45 : mineSq ? 0.32 : 0.2;
    ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS, rad * 0.66 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (mineSq && !isSel) {
      // your squads wear a bright ring so they stand out from the enemy at a glance
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.25 * Math.sin(time * 3 + s.id)).toFixed(2) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS, rad * 0.66 * TS, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (B.side && !mineSq) {
      ctx.strokeStyle = 'rgba(255,90,80,.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS, rad * 0.66 * TS, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (isSel) {
      ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS + 1, rad * 0.7 * TS, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS + 1, rad * 0.7 * TS, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) {
    if (d.f) { const f = d.f; drawUnit(ctx, f.fid, f.unit, f.stage, 'death', Math.min(3, f.age * 7), f.x, f.y, f.flip, Math.max(0, 1 - Math.max(0, f.age - 3) / 3)); continue; }
    const s = d.s;
    if (d.hero) {
      drawHero(ctx, s.hfid, s.gender, 1, d.anim === 'idle' ? 'walk' : d.anim === 'hit' ? 'hit' : d.anim, d.anim === 'idle' ? 0 : time * 7 + s.id, d.p.x, d.p.y, d.flip);
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(d.p.x - 1 + (d.flip ? 5 : -5), d.p.y - 22, 1, 10);
      ctx.fillStyle = B.colors[s.side]; ctx.fillRect(d.p.x + (d.flip ? 5 : -5), d.p.y - 22, 5, 4);
    } else {
      drawUnit(ctx, s.fid, s.unit, d.so.s, d.anim, time * (d.anim === 'idle' ? 4 : 8) + d.i * 0.7, d.p.x, d.p.y, d.flip, s.state === 'rout' ? 0.7 : 1);
      if (d.so.s === 3) { ctx.fillStyle = '#ffd86b'; ctx.fillRect(d.p.x - 1, d.p.y - 17, 2, 2); }
      if (d.flash > 0.5) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(d.p.x - 4, d.p.y - 12, 8, 10); ctx.globalAlpha = 1; }
    }
  }
  ctx.font = '600 6px monospace'; ctx.textBaseline = 'top';
  for (const s of sim.squads) {
    if (HIDDEN(s) || !seenBy(s)) continue;
    const r = B.render.get(s.id);
    const n = liveCount(s), max = s.soldiers.length;
    const x = r.x * TS - 10, y = r.y * TS - 28;
    // troop count beside the bars, and a formation matchup arrow while locked in melee
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x + 21, y - 1, String(n).length * 4 + 3, 7);
    ctx.fillStyle = s.ally ? '#9fd0ff' : '#f7efe0'; ctx.fillText(String(n), x + 22.5, y);
    if (s.state === 'fight' && s.engaged != null && (!B.side || s.side === B.side)) {
      const foe = sim.squads.find((q) => q.id === s.engaged);
      const edge = foe ? formationEdge(s.formation, foe.formation) : 1;
      if (edge !== 1) {
        const up = edge > 1, ax = x - 18, ay = y + 2 + (up ? 0 : 1) + Math.round(Math.sin(time * 6) * 1);
        ctx.fillStyle = '#0b0a10'; ctx.beginPath(); if (up) { ctx.moveTo(ax - 4, ay + 3); ctx.lineTo(ax + 4, ay + 3); ctx.lineTo(ax, ay - 3); } else { ctx.moveTo(ax - 4, ay - 3); ctx.lineTo(ax + 4, ay - 3); ctx.lineTo(ax, ay + 3); } ctx.fill();
        ctx.fillStyle = up ? '#8fd06b' : '#ff6a5a'; ctx.beginPath(); if (up) { ctx.moveTo(ax - 2.5, ay + 2); ctx.lineTo(ax + 2.5, ay + 2); ctx.lineTo(ax, ay - 1.5); } else { ctx.moveTo(ax - 2.5, ay - 2); ctx.lineTo(ax + 2.5, ay - 2); ctx.lineTo(ax, ay + 1.5); } ctx.fill();
      }
    }
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 1, y - 1, 22, 7);
    ctx.fillStyle = B.colors[s.side]; ctx.fillRect(x, y, 20 * (max ? n / max : 0), 2);
    ctx.fillStyle = s.morale < 25 ? '#ff6a5a' : '#6bb6ff'; ctx.fillRect(x, y + 2, 20 * Math.max(0, s.morale) / 100, 2);
    if (s.reform) { ctx.fillStyle = '#ffd86b'; ctx.fillRect(x, y + 4, 20 * Math.min(1, s.reform.t / (s.reform.total || 1)), 1); }
    if (s.ammoMax) { ctx.fillStyle = s.ammo > 0 ? '#e8d070' : (Math.floor(time * 4) % 2 ? '#ff6a5a' : '#0b0a10'); ctx.fillRect(x, y + 5, s.ammo > 0 ? 20 * s.ammo / s.ammoMax : 20, 1); }
    tacticMarks(s, x + 21 + String(n).length * 4 + 4, y - 1, time);
    if (s.special >= 1 && s.side === B.side && s.heroAlive) { ctx.fillStyle = '#ffd25a'; ctx.fillRect(x - 3, y - 1, 2, 7); }
    if (s.ally) { ctx.fillStyle = '#6bb6ff'; ctx.fillRect(x, y - 3, 20, 1); }
    if (s.buffs && (s.buffs.confused > 0 || s.state === 'confused')) { ctx.fillStyle = '#c48bff'; ctx.fillRect(x + 6 + Math.sin(time * 8) * 4, y - 5, 3, 3); }
    drawBadge(s, x - 9, y - 2, time);
    if (B.selected.includes(s.id)) {
      const ay = y - 9 + Math.round(Math.sin(time * 6) * 1.5), ax = Math.round(r.x * TS);
      ctx.fillStyle = '#0b0a10'; ctx.beginPath(); ctx.moveTo(ax - 5, ay - 1); ctx.lineTo(ax + 5, ay - 1); ctx.lineTo(ax, ay + 5); ctx.fill();
      ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.moveTo(ax - 3.5, ay); ctx.lineTo(ax + 3.5, ay); ctx.lineTo(ax, ay + 3.5); ctx.fill();
    }
  }
  drawOverlays(time);
  for (const f of B.fx) {
    if (f.age < 0) continue;
    if (f.k === 'arrow') {
      const t = f.age / f.life, x = f.x1 + (f.x2 - f.x1) * t, y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 10;
      ctx.fillStyle = '#f2e8d5'; ctx.fillRect(x, y, 3, 1);
    } else if (f.k === 'spell' && f.spell) {
      const im = img(f.spell.src);
      if (im) { const fr = Math.min(f.spell.frames - 1, Math.floor(f.age / f.life * f.spell.frames)); ctx.drawImage(im, fr * f.spell.fw, 0, f.spell.fw, f.spell.fh, f.x - f.spell.fw, f.y - f.spell.fh * 1.6, f.spell.fw * 2, f.spell.fh * 2); }
    } else if (f.k === 'flash') {
      ctx.strokeStyle = B.colors[f.side]; ctx.lineWidth = 2; ctx.globalAlpha = 1 - f.age / f.life;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + f.age * 50, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.k === 'trap' && dt) ctx.drawImage(dt, 192 + 48, 176, 16, 16, f.x - 8, f.y - 12, 16, 16);
    else if (f.k === 'ring') {
      const k = f.age / f.life; ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 10 + k * 14, 7 + k * 9, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.k === 'whiteflag') {
      const k = Math.min(1, f.age / 0.3), up = f.age * 6;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, f.age - 1.4) / 0.6);
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(f.x, f.y - 14 * k - up, 1, 14 * k);
      ctx.fillStyle = '#f4ecd8'; ctx.fillRect(f.x + 1, f.y - 14 * k - up, 7, 5);
      ctx.globalAlpha = 1;
    } else if (f.k === 'flag') {
      // pole rises, then the new colours unfurl
      const k = Math.min(1, f.age / 0.7), h0 = 26;
      const top = f.y - h0 * k;
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(f.x - 1, top, 2, h0 * k);
      if (k >= 1) { const wv = Math.sin(f.age * 10) * 1.5; ctx.fillStyle = '#0b0a10'; ctx.fillRect(f.x + 1, top - 1, 12, 9); ctx.fillStyle = f.col; ctx.fillRect(f.x + 1, top, 11, 7 + wv * 0.3); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(f.x + 1, top, 11, 2); }
    }
  }
  drawNight(time);
  drawDuel(time);
  B.juice.draw(ctx);
  if (sim.fog > 0) { ctx.fillStyle = `rgba(200,210,225,${Math.min(0.28, sim.fog / 30 * 0.28)})`; ctx.fillRect(0, 0, sim.field.W * TS, sim.field.H * TS); }
}

// battle tactics on the ground: hilltop flags, the side objective, guard zones, charge lanes
function drawTactics(time) {
  const sim = B.sim;
  for (const h of sim.hills || []) {
    const x = h.x * TS, y = h.y * TS, col = h.owner ? B.colors[h.owner] : '#d6d0c4';
    ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.ellipse(x, y, 1.9 * TS, 1.3 * TS, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 1, y - 16, 2, 16); ctx.fillRect(x + 1, y - 17, 8, 7);
    ctx.fillStyle = col; ctx.fillRect(x + 1, y - 16 + Math.round(Math.sin(time * 4 + h.x)), 7, 5);
    if (h.prog > 0 && h.by) {
      ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y - 23, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = B.colors[h.by]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 23, 4, -Math.PI / 2, -Math.PI / 2 + h.prog * Math.PI * 2); ctx.stroke();
    }
  }
  const O = sim.obj;
  if (O) {
    const x = O.x * TS, y = O.y * TS;
    if (!O.done) { const k = (time * 1.2) % 1; ctx.strokeStyle = `rgba(255,216,107,${0.7 * (1 - k)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, (1 + k * 1.2) * TS, (0.7 + k * 0.8) * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = O.done ? 0.55 : 1;
    if (O.kind === 'caravan') {
      if (!O.done || O.by) drawIcon(ctx, 'wagon', x - 8, y - 14 + (O.pby && !O.done ? Math.round(Math.sin(time * 10)) : 0), 16);
    } else if (O.kind === 'supplies') {
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 9, y - 9, 18, 11);
      ctx.fillStyle = O.done ? '#3a3036' : '#9a6a36'; ctx.fillRect(x - 8, y - 8, 7, 9); ctx.fillRect(x + 1, y - 8, 7, 9);
      ctx.fillStyle = O.done ? '#241e22' : '#c48a48'; ctx.fillRect(x - 8, y - 5, 7, 1); ctx.fillRect(x + 1, y - 5, 7, 1); ctx.fillRect(x - 5, y - 8, 1, 9); ctx.fillRect(x + 4, y - 8, 1, 9);
    } else {
      ctx.fillStyle = '#0b0a10'; ctx.beginPath(); ctx.moveTo(x - 10, y - 6); ctx.lineTo(x, y - 15); ctx.lineTo(x + 10, y - 6); ctx.fill();
      ctx.fillStyle = '#b08a4a'; ctx.beginPath(); ctx.moveTo(x - 8, y - 7); ctx.lineTo(x, y - 13); ctx.lineTo(x + 8, y - 7); ctx.fill();
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 7, y - 7, 14, 9); ctx.fillStyle = '#7a5a34'; ctx.fillRect(x - 6, y - 6, 12, 7);
      ctx.fillStyle = O.done ? '#0b0a10' : '#3a3036'; ctx.fillRect(x - 2, y - 4, 4, 5);
      if (!O.done) { ctx.fillStyle = '#8a96a8'; for (let i = 0; i < 3; i++) ctx.fillRect(x - 2 + i * 1.5, y - 4, 0.6, 5); }
    }
    ctx.globalAlpha = 1;
    if (!O.done && O.prog > 0 && O.pby && O.kind !== 'caravan') {
      ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y - 22, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = B.colors[O.pby]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 22, 4, -Math.PI / 2, -Math.PI / 2 + O.prog * Math.PI * 2); ctx.stroke();
    }
  }
  for (const q of sim.squads) {
    if (HIDDEN(q)) continue;
    if (q.guard && (q.side === B.side || !B.side)) {
      const sel = B.selected.includes(q.id);
      ctx.strokeStyle = sel ? 'rgba(159,208,255,.9)' : 'rgba(159,208,255,.35)'; ctx.lineWidth = sel ? 1.5 : 1; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -time * 6;
      ctx.beginPath(); ctx.ellipse(q.guard.x * TS, q.guard.y * TS, q.guard.r * TS, q.guard.r * 0.72 * TS, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (q.charge && seenBy(q)) {
      const C = q.charge;
      ctx.strokeStyle = B.colors[q.side]; ctx.globalAlpha = 0.55; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -time * 40;
      ctx.beginPath(); ctx.moveTo(C.x0 * TS, C.y0 * TS); ctx.lineTo(C.x * TS, C.y * TS); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      drawArrowHead(C.x0, C.y0, C.x, C.y, B.colors[q.side]);
    }
  }
}
function drawArrowHead(x0, y0, x1, y1, col) {
  const a = Math.atan2(y1 - y0, x1 - x0), x = x1 * TS, y = y1 * TS;
  ctx.fillStyle = '#0b0a10'; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); ctx.lineTo(x + Math.cos(a + 2.5) * 7, y + Math.sin(a + 2.5) * 7); ctx.lineTo(x + Math.cos(a - 2.5) * 7, y + Math.sin(a - 2.5) * 7); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); ctx.lineTo(x + Math.cos(a + 2.5) * 5, y + Math.sin(a + 2.5) * 5); ctx.lineTo(x + Math.cos(a - 2.5) * 5, y + Math.sin(a - 2.5) * 5); ctx.fill();
}
// tiny markers beside a squad's bars: shield wall, braced pikes, fire arrows, guarding, regrouping, disordered
function tacticMarks(s, x, y, time) {
  const b = s.buffs || {}, m = [];
  if (b.shields > 0) m.push('shield');
  if (b.brace > 0) m.push('lock');
  if (b.fire > 0) m.push('sun');
  if (b.disordered > 0) m.push('broken');
  if (s.regroup) m.push('camp');
  else if (s.guard && s.side === B.side) m.push('guard');
  m.slice(0, 3).forEach((k, i) => drawIcon(ctx, k, x + i * 7, y, 6));
}
// night: darkness with holes of torchlight around what your side can see
function drawNight(time) {
  const sim = B.sim; if (!sim.night) return;
  const F = sim.field, W = F.W * TS, H = F.H * TS, S = 0.5;
  if (!B.nightCv || B.nightCv.width !== Math.ceil(W * S)) { B.nightCv = document.createElement('canvas'); B.nightCv.width = Math.ceil(W * S); B.nightCv.height = Math.ceil(H * S); }
  const c = B.nightCv, x = c.getContext('2d');
  x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = 'rgba(8,10,34,0.62)'; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out';
  const lights = [];
  const flick = (i) => 1 + Math.sin(time * 7 + i * 1.7) * 0.04;
  for (const q of sim.squads) {
    if (HIDDEN(q)) continue;
    const r = B.render.get(q.id) || q;
    if (!B.side || q.side === B.side) lights.push([r.x, r.y, q.role === 'scout' && q.heroAlive ? 8 : 4.4, 1]);
    else if (seenBy(q)) lights.push([r.x, r.y, 2.2, 0.75]);
  }
  for (const p of F.posts) if (p.owner === B.side || (!B.side && p.owner !== 'none')) lights.push([p.x, p.y, 4, 0.9]); else lights.push([p.x, p.y, 1.6, 0.5]);
  for (const f of sim.fires) lights.push([f.x, f.y, f.r + 2.4, 1]);
  if (sim.obj && !sim.obj.done) lights.push([sim.obj.x, sim.obj.y, 1.4, 0.6]);
  lights.forEach(([lx, ly, lr, a], i) => {
    const px = lx * TS * S, py = ly * TS * S, rr = lr * TS * S * flick(i);
    if (prefs.lowFx) { x.fillStyle = `rgba(0,0,0,${a * 0.85})`; x.beginPath(); x.arc(px, py, rr * 0.8, 0, Math.PI * 2); x.fill(); return; }
    const g = x.createRadialGradient(px, py, rr * 0.25, px, py, rr);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rr, 0, Math.PI * 2); x.fill();
  });
  x.globalCompositeOperation = 'source-over';
  ctx.drawImage(c, 0, 0, W, H);
  if (prefs.lowFx) return;
  // warm torch glow on your own squads and bases
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [lx, ly, lr, a] of lights.slice(0, 40)) {
    if (a < 0.9) continue;
    const px = lx * TS, py = ly * TS, rr = Math.min(lr, 4) * TS * 0.55;
    const g = ctx.createRadialGradient(px, py - 4, 0, px, py - 4, rr);
    g.addColorStop(0, `rgba(255,170,70,${0.16 + Math.sin(time * 9 + lx) * 0.03})`); g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py - 4, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// siege works: gate strength, broken gates, ladders against the wall
function drawSiege(time) {
  const sim = B.sim, F = sim.field;
  if (!F.wallRect) return;
  const R = F.wallRect;
  // a faint stone tint inside the walls reads the keep as one place
  ctx.fillStyle = 'rgba(40,34,52,.10)'; ctx.fillRect((R.x0 + 1) * TS, (R.y0 + 1) * TS, (R.x1 - R.x0 - 1) * TS, (R.y1 - R.y0 - 1) * TS);
  for (const g of sim.gates || []) {
    const x = g.cx * TS, y = g.cy * TS;
    if (g.hp <= 0) {
      ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x + 1, y + 9, 5, 3); ctx.fillRect(x + 8, y + 11, 6, 3); ctx.fillStyle = '#7a6040'; ctx.fillRect(x + 3, y + 12, 3, 2); ctx.fillRect(x + 10, y + 9, 3, 2);
      continue;
    }
    // shut gate: heavy timber with iron bands, and its strength above
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x, y - 2, TS, TS + 2);
    ctx.fillStyle = '#6b4424'; ctx.fillRect(x + 1, y - 1, TS - 2, TS);
    ctx.fillStyle = '#8a5a30'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 2 + i * 5, y, 3, TS - 2);
    ctx.fillStyle = '#3a3a46'; ctx.fillRect(x + 1, y + 3, TS - 2, 2); ctx.fillRect(x + 1, y + 10, TS - 2, 2);
  }
  for (const l of sim.ladders || []) {
    const x = l.x * TS, y = l.y * TS;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 5, y - 12, 2, 22); ctx.fillRect(x + 3, y - 12, 2, 22);
    ctx.fillStyle = '#b07a3a'; ctx.fillRect(x - 4, y - 11, 1, 20); ctx.fillRect(x + 4, y - 11, 1, 20);
    for (let i = 0; i < 5; i++) ctx.fillRect(x - 4, y - 9 + i * 4, 9, 1);
  }
}
// planned route for each selected squad: dotted, animated, along the real roads
function drawRoutes(list, time, enemy = false) {
  const sim = B.sim;
  for (const s of list) {
    const r = B.render.get(s.id) || s;
    let pts = null, col = enemy ? 'rgba(255,106,90,.75)' : '#ffd25a';
    if (s.chase != null) {
      const t = sim.squads.find((q) => q.id === s.chase && q.state !== 'dead');
      if (t) {
        col = '#ff6a5a';
        const ids = Math.hypot(t.x - s.x, t.y - s.y) > 6 ? planRoute(sim, s, nearestPost(sim.field, t.x, t.y)) : null;
        pts = [[r.x, r.y], ...(ids || []).map((id) => [sim.field.posts[id].x, sim.field.posts[id].y]), [t.x, t.y]];
      }
    }
    else if (s.path && s.path.length) pts = [[r.x, r.y], ...s.path.map((p) => [p.x, p.y])];
    else if (s.goal != null && s.state === 'move') { const ids = planRoute(sim, s, s.goal); if (ids) pts = [[r.x, r.y], ...ids.map((id) => [sim.field.posts[id].x, sim.field.posts[id].y])]; }
    // queued waypoints continue the line in a cooler colour
    const q = enemy ? [] : (B.client ? s._qpts || [] : queuePoints(sim, s));
    if (q.length) {
      const from = pts && pts.length ? pts[pts.length - 1] : [r.x, r.y];
      ctx.strokeStyle = 'rgba(10,8,16,.5)'; ctx.lineWidth = 3; ctx.setLineDash([2, 4]); ctx.lineDashOffset = -time * 10;
      // follow the roads between waypoints, like the march itself will
      const line = [from];
      let at = { x: from[0], y: from[1] };
      for (const p of q) {
        const post = sim.field.posts.find((o) => Math.abs(o.x - p[0]) < 0.01 && Math.abs(o.y - p[1]) < 0.01);
        const ids = post ? planRoute(sim, at, post.id) : null;
        if (ids) for (const id of ids) line.push([sim.field.posts[id].x, sim.field.posts[id].y]); else line.push(p);
        at = { x: p[0], y: p[1] };
      }
      ctx.beginPath(); ctx.moveTo(line[0][0] * TS, line[0][1] * TS); for (const p of line) ctx.lineTo(p[0] * TS, p[1] * TS); ctx.stroke();
      ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(line[0][0] * TS, line[0][1] * TS); for (const p of line) ctx.lineTo(p[0] * TS, p[1] * TS); ctx.stroke(); ctx.setLineDash([]);
      q.forEach((p, i) => { ctx.fillStyle = '#0b0a10'; ctx.fillRect(p[0] * TS - 4, p[1] * TS - 4, 8, 8); ctx.fillStyle = '#9fd0ff'; ctx.fillRect(p[0] * TS - 3, p[1] * TS - 3, 6, 6); ctx.fillStyle = '#0b0a10'; ctx.font = '600 6px monospace'; ctx.textBaseline = 'top'; ctx.fillText(String(i + 2), p[0] * TS - 1.5, p[1] * TS - 3); });
    }
    if (!pts || pts.length < 2) continue;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,8,16,.55)'; ctx.lineWidth = 3.5; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.moveTo(pts[0][0] * TS, pts[0][1] * TS); for (const p of pts.slice(1)) ctx.lineTo(p[0] * TS, p[1] * TS); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0] * TS, pts[0][1] * TS); for (const p of pts.slice(1)) ctx.lineTo(p[0] * TS, p[1] * TS); ctx.stroke();
    ctx.setLineDash([]);
    const e = pts[pts.length - 1];
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(e[0] * TS, e[1] * TS, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}
// small pixel status icon: marching, fighting, holding, reforming, routing
function drawBadge(s, x, y, time) {
  let kind = s.state === 'rout' ? 'rout' : s.reform ? 'reform' : s.state === 'fight' || s.state === 'shoot' ? 'fight' : s.state === 'move' ? 'march' : 'hold';
  const bg = { rout: '#ff6a5a', reform: '#ffd25a', fight: '#ff9a3a', march: '#6bb6ff', hold: '#8fd06b' }[kind];
  ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 1, y - 1, 9, 9);
  ctx.fillStyle = bg; ctx.fillRect(x, y, 7, 7);
  ctx.fillStyle = '#0b0a10';
  if (kind === 'march') { ctx.fillRect(x + 1, y + 3, 4, 1); ctx.fillRect(x + 4, y + 2, 1, 3); ctx.fillRect(x + 5, y + 3, 1, 1); }
  else if (kind === 'fight') { for (let i = 0; i < 5; i++) { ctx.fillRect(x + 1 + i, y + 1 + i, 1, 1); ctx.fillRect(x + 5 - i, y + 1 + i, 1, 1); } }
  else if (kind === 'hold') { ctx.fillRect(x + 2, y + 1, 3, 4); ctx.fillRect(x + 3, y + 5, 1, 1); ctx.fillStyle = bg; ctx.fillRect(x + 3, y + 2, 1, 2); }
  else if (kind === 'reform') { const k = Math.floor(time * 6) % 4; const pts = [[1, 1], [5, 1], [5, 5], [1, 5]]; for (let i = 0; i < 4; i++) if (i !== k) ctx.fillRect(x + pts[i][0], y + pts[i][1], 1, 1); }
  else if (kind === 'rout') { ctx.fillRect(x + 3, y + 1, 1, 3); ctx.fillRect(x + 3, y + 5, 1, 1); }
}
// screen-level overlays drawn in world space: order confirmation ring, drag order arrow, duel spotlight
function drawGateBars() {
  for (const g of (B.sim && B.sim.gates) || []) {
    if (g.hp <= 0) continue;
    const x = g.cx * TS, y = g.cy * TS, k = g.hp / g.max;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 5, y - 10, TS + 10, 6);
    ctx.fillStyle = k > 0.5 ? '#8fd06b' : k > 0.25 ? '#ffb347' : '#ff6a5a'; ctx.fillRect(x - 4, y - 9, (TS + 8) * k, 4);
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x + TS / 2 - 1, y - 9, 1, 4);
  }
}
function drawOverlays(time) {
  drawGateBars();
  if (B.pick) {
    const k = 1 - B.pick.t / 0.8;
    ctx.strokeStyle = B.pick.foe ? '#ff6a5a' : '#ffd25a'; ctx.globalAlpha = Math.max(0, 1 - k); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(B.pick.x * TS, B.pick.y * TS, (1 + k * 2) * TS, (0.7 + k * 1.4) * TS, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  const d = B.drag;
  if (d && d.mode === 'order') {
    const a = selSquads(); const w = cam.toWorld(d.x, d.y);
    for (const s of a) {
      const r = B.render.get(s.id) || s;
      ctx.strokeStyle = 'rgba(255,210,90,.9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(r.x * TS, r.y * TS); ctx.lineTo(w.x, w.y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(255,210,90,.9)'; ctx.beginPath(); ctx.arc(w.x, w.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (d && d.mode === 'lane' && B.mode) {
    const w = cam.toWorld(d.x, d.y);
    for (const s of laneSquads()) { const e = laneEnd(s, w.x / TS, w.y / TS); ctx.strokeStyle = 'rgba(255,216,107,.9)'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(s.x * TS, s.y * TS); ctx.lineTo(e.x * TS, e.y * TS); ctx.stroke(); ctx.setLineDash([]); drawArrowHead(s.x, s.y, e.x, e.y, '#ffd86b'); }
  }
  if (d && d.mode === 'guard' && B.mode) {
    const a = cam.toWorld(d.sx, d.sy), b = cam.toWorld(d.x, d.y);
    const r = Math.max(1.5, Math.min(6, Math.hypot(b.x - a.x, b.y - a.y) / TS));
    ctx.fillStyle = 'rgba(159,208,255,.12)'; ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(a.x, a.y, r * TS, r * 0.72 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }
  if (d && d.mode === 'box') {
    const a = cam.toWorld(d.sx, d.sy), b = cam.toWorld(d.x, d.y);
    ctx.fillStyle = 'rgba(255,210,90,.12)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.setLineDash([]);
  }
}
// duel spotlight sits above everything in world space
function drawDuel(time) {
  const D = B.duel; if (!D) return;
  const a = B.render.get(D.a), b = B.render.get(D.b); if (!a || !b) return;
  const x = (a.x + b.x) / 2 * TS, y = (a.y + b.y) / 2 * TS;
  const F = B.sim.field;
  const k = Math.min(1, D.age / 0.3) * Math.min(1, Math.max(0, (D.life - D.age) / 0.3));
  ctx.save();
  ctx.fillStyle = `rgba(8,6,14,${0.45 * k})`;
  ctx.beginPath(); ctx.rect(-40, -40, F.W * TS + 80, F.H * TS + 80); ctx.arc(x, y, 3.2 * TS, 0, Math.PI * 2, true); ctx.fill('evenodd');
  ctx.strokeStyle = `rgba(255,216,107,${0.8 * k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 3.2 * TS + Math.sin(time * 8), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ---------- input ----------
// Taps: tap your squad to select it (or a card on the left); "All" selects the whole army; with "Box" on,
// dragging on the ground draws a selection box. Dragging FROM one of your squads gives an order where you let go.
// With squads selected: tap an enemy to attack it, tap a base (anywhere in its ring) or the ground near a road
// to march to the nearest base. Taps that don't fit an order explain why instead of dropping the selection.
const hitR = () => Math.max(1.3, 30 / (cam.zoom * TS)); // ~30 CSS px, in tiles
function selSquads() {
  const sim = B.sim; if (!sim) return [];
  B.selected = B.selected.filter((id) => { const s = sim.squads.find((q) => q.id === id); return s && !HIDDEN(s) && !s.ally && s.side === B.side; });
  B.sel = B.selected[0] ?? null;
  return B.selected.map((id) => sim.squads.find((q) => q.id === id));
}
function setSel(ids) { B.selected = ids.slice(); B.sel = ids[0] ?? null; if (!ids.length) B.mode = null; refreshHUD(true); }
function squadAt(wx, wy, side, r) {
  let best = null, bd = r;
  for (const s of B.sim.squads) {
    if (HIDDEN(s) || (side && s.side !== side) || !seenBy(s)) continue;
    const rr = B.render.get(s.id) || s;
    const d = Math.hypot(rr.x - wx, rr.y - 0.35 - wy);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// every visible squad of a side within r, nearest first
function squadsAt(wx, wy, side, r) {
  const out = [];
  for (const s of B.sim.squads) {
    if (HIDDEN(s) || (side && s.side !== side) || !seenBy(s)) continue;
    const rr = B.render.get(s.id) || s;
    const d = Math.hypot(rr.x - wx, rr.y - 0.35 - wy);
    if (d < r) out.push([d, s]);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}
const unitClassOf = (q) => (q.ranged ? 'ranged' : q.mounted ? 'mounted' : q.abil || 'foot');
function postAt(wx, wy, r) {
  let best = null, bd = r;
  for (const p of B.sim.field.posts) { const d = Math.hypot(p.x - wx, (p.y - wy) * 1.3); if (d < bd) { bd = d; best = p; } }
  return best;
}
// fromDrag: the drop point of a drag that began on one of your squads, always an order (never a reselect)
function tap(sx, sy, fromDrag = false) {
  if (!B.started || B.ended || !B.side) return;
  const w = cam.toWorld(sx, sy);
  const wx = w.x / TS, wy = w.y / TS;
  const sim = B.sim, R = hitR();
  if (B.aim) {
    let best = null, bd = Math.max(3.2, R * 1.4);
    for (const t of B.aim.targets) {
      let x, y;
      if (t.kind === 'squad') { const s = sim.squads.find((q) => q.id === t.id); if (!s) continue; x = s.x; y = s.y; }
      if (t.kind === 'post') { x = sim.field.posts[t.id].x; y = sim.field.posts[t.id].y; }
      if (t.kind === 'edge') { const [a, b] = sim.field.edges[t.id]; x = (sim.field.posts[a].x + sim.field.posts[b].x) / 2; y = (sim.field.posts[a].y + sim.field.posts[b].y) / 2; }
      const d = Math.hypot(x - wx, y - wy); if (d < bd) { bd = d; best = t; }
    }
    if (best) { send({ type: 'strat', id: B.aim.id, target: best }); B.aim = null; refreshHUD(true); }
    else toast('Tap one of the glowing targets');
    return;
  }
  if (B.mode) { modeOrder(wx, wy, null); return; }
  const sel = selSquads();
  const now = performance.now();
  // with squads selected, only a tap right on another squad's body selects it; a looser tap near friends is an order
  // to go there. Nothing selected: the generous radius picks the nearest squad. Stacked squads cycle on repeat taps.
  const tight = Math.max(0.8, 16 / (cam.zoom * TS));
  const pool = fromDrag ? [] : squadsAt(wx, wy, B.side, sel.length ? tight : R);
  let own = pool[0] || null;
  // the base building itself is an order target even with friends standing beside it: closer to the building than
  // to the squad's body means "go there"
  if (own && sel.length && !sel.some((q) => q.id === own.id)) {
    const base = postAt(wx, wy, 2.4), rr = B.render.get(own.id) || own;
    if (base && Math.hypot(base.x - wx, base.y - 0.4 - wy) < Math.hypot(rr.x - wx, rr.y - 0.35 - wy)) own = null;
  }
  // a quick second tap on the squad just selected is a double-tap (all of its kind), a slower one cycles the stack
  const dbl = B.lastTap && now - B.lastTap.t < 450 && sel.length === 1 && sel[0].id === B.lastTap.id && pool.some((q) => q.id === B.lastTap.id);
  if (dbl) own = sel[0];
  else if (own && pool.length > 1 && B.lastTap && now - B.lastTap.t < 900 && pool.some((q) => q.id === B.lastTap.id)) {
    own = pool[(pool.findIndex((q) => q.id === B.lastTap.id) + 1) % pool.length];
  }
  if (own) {
    const twice = B.lastTap && B.lastTap.id === own.id && now - B.lastTap.t < 450;
    B.lastTap = { id: own.id, t: now };
    if (own.ally) { toast(`${own.name} fights for ${own.allyName || 'your ally'} and follows their own orders`); return; }
    if (twice && sel.length === 1 && sel[0].id === own.id) {
      // double-tap: every squad of the same kind in view
      const a0 = cam.toWorld(0, 0), a1 = cam.toWorld(screen.w, screen.h), v = { x: a0.x, y: a0.y, w: a1.x - a0.x, h: a1.y - a0.y }, cls = unitClassOf(own);
      const ids = B.sim.squads.filter((q) => q.side === B.side && !HIDDEN(q) && !q.ally && q.state !== 'rout' && unitClassOf(q) === cls && (!v || (q.x * TS > v.x && q.x * TS < v.x + v.w && q.y * TS > v.y && q.y * TS < v.y + v.h))).map((q) => q.id);
      if (ids.length > 1) { setSel([own.id, ...ids.filter((i) => i !== own.id)]); toast(`${ids.length} squads selected`); buzz('tap'); sfx('click'); for (const q of selSquads()) pulseSquad(q); return; }
    }
    if (sel.length === 1 && sel[0].id === own.id) { pulseSquad(own); return; }
    setSel([own.id]); sfx('click'); buzz('tap'); pulseSquad(own); return;
  }
  const foe = squadAt(wx, wy, B.side === 'att' ? 'def' : 'att', R);
  if (!sel.length) { toast(foe ? `${foe.name} · ${liveCount(foe)} troops. Select one of your squads first` : 'Tap one of your squads first, or use All'); return; }
  if (foe) { orderAttack(sel, foe); return; }
  // tap the castle wall: foot squads put up ladders there
  if (sim.field.wallRect && (terrainAt(sim.field, wx, wy) === 6 || terrainAt(sim.field, wx, wy + 0.5) === 6) && B.side === 'att') {
    const climbers = sel.filter(canClimb);
    const spot = ladderSpot(sim, wx, wy);
    if (!climbers.length) { toast('Riders and beasts can\'t climb ladders · break the gate instead', 'bad'); return; }
    if (!spot) { toast('No footing for ladders there · try a straight stretch of wall', 'bad'); return; }
    for (const q of climbers) send({ type: 'ladder', squad: q.id, x: wx, y: wy });
    B.pick = { x: spot.wx, y: spot.wy, t: 0.8 }; sfx('march');
    toast(`${climbers.length > 1 ? 'Squads raise' : climbers[0].name + ' raises'} ladders · exposed while climbing`); return;
  }
  // a hilltop flag or the side objective: march straight there
  const spot = (sim.hills || []).find((q) => Math.hypot(q.x - wx, q.y - wy) < 1.7) || (sim.obj && !sim.obj.done && Math.hypot(sim.obj.x - wx, sim.obj.y - wy) < 1.6 ? sim.obj : null);
  if (spot) {
    for (const q of sel) send({ type: 'spot', squad: q.id, x: +spot.x.toFixed(2), y: +spot.y.toFixed(2) });
    B.pick = { x: spot.x, y: spot.y, t: 0.8 }; sfx('march');
    toast(spot.kind ? { caravan: 'Escort the caravan: stay beside it and it rolls toward your lines', supplies: B.side === 'att' ? 'Burn the supplies: hold beside them, unopposed' : 'Guard your supplies from the raiders', captive: 'Free the captive: hold the hut with no enemy close' }[spot.kind] : 'Taking the high ground');
    return;
  }
  let post = postAt(wx, wy, Math.max(2.8, R));
  if (post) { orderMove(sel, post); return; }
  // on (or near) a road: march to that exact spot and hold it — a bridge, a crossroads, an ambush
  const rp = nearestRoadPoint(sim.field, wx, wy);
  if (rp && rp.d < Math.max(2.2, R)) { orderPoint(sel, rp); return; }
  const near = postAt(wx, wy, 8);
  if (near) { orderMove(sel, near); return; }
  setSel([]); toast('Selection cleared · tap a base, a road or an enemy to give orders');
}
function pulseSquad(s) { const r = B.render.get(s.id); if (r) B.fx.push({ k: 'ring', x: r.x * TS, y: r.y * TS, age: 0, life: 0.45, col: '#ffd25a' }); }
function orderPoint(list, rp) {
  for (const s of list) send({ type: 'moveTo', squad: s.id, x: rp.x, y: rp.y, queue: B.queue || undefined });
  B.pick = { x: rp.x, y: rp.y, t: 0.8 };
  sfx('march'); toast(B.queue ? 'Waypoint added' : 'Marching to hold the road here');
}
function orderMove(list, post) {
  let ok = 0, why = null;
  for (const s of list) {
    const prob = routeProblem(B.sim, s, post.id);
    if (prob) { why = prob; continue; }
    send({ type: 'move', squad: s.id, post: post.id, queue: B.queue || undefined }); ok++;
  }
  if (ok) {
    B.pick = { x: post.x, y: post.y, t: 0.8 };
    if (B.queue) toast('Waypoint added');
    sfx('march');
    if (why) toast(`${list.length - ok} squad${list.length - ok > 1 ? 's' : ''} can't get there: ${why.toLowerCase()}`, 'bad');
  } else { toast(why || 'No route there', 'bad'); sfx('alert'); }
}
function orderAttack(list, foe) {
  for (const s of list) send({ type: 'chase', squad: s.id, target: foe.id });
  B.pick = { x: foe.x, y: foe.y, t: 0.8, foe: true };
  sfx('clash'); toast(`Attacking ${foe.name}`);
}
// tactic orders that need a spot on the field: a charge lane, or an area to guard
function laneSquads() { return B.mode && B.mode.k === 'lane' ? selSquads().filter((q) => q.abil === 'charge' && (q.abCd || 0) <= 0 && q.state !== 'rout') : []; }
function laneEnd(s, x, y) {
  const d = Math.hypot(x - s.x, y - s.y) || 1, L = Math.min(CHARGE_LEN, d);
  return { x: s.x + (x - s.x) / d * L, y: s.y + (y - s.y) / d * L };
}
function setMode(k) {
  if (B.mode && B.mode.k === k) { B.mode = null; refreshHUD(true); return; }
  B.mode = { k }; B.aim = null; sfx('open');
  toast(k === 'lane' ? 'Charge: tap (or drag to) where the riders should thunder through' : 'Guard: tap a spot to guard it, or drag out the area', 'gold');
  refreshHUD(true);
}
function modeOrder(x, y, r) {
  const M = B.mode; B.mode = null;
  const sel = selSquads();
  if (M.k === 'lane') {
    const riders = sel.filter((q) => q.abil === 'charge' && (q.abCd || 0) <= 0 && q.state !== 'rout');
    if (!riders.length) { toast('No riders ready to charge', 'bad'); refreshHUD(true); return; }
    for (const q of riders) { const e = laneEnd(q, x, y); send({ type: 'ability', squad: q.id, x: +e.x.toFixed(2), y: +e.y.toFixed(2) }); }
    B.pick = { x, y, t: 0.8, foe: true };
  } else {
    const F = B.sim.field;
    if (terrainAt(F, x, y) === 3 || terrainAt(F, x, y) === 6) { toast('Pick open ground to guard', 'bad'); B.mode = M; return; }
    for (const q of sel) send({ type: 'guard', squad: q.id, x: +x.toFixed(2), y: +y.toFixed(2), r: r == null ? 3 : +Math.max(1.5, Math.min(6, r)).toFixed(1) });
    B.pick = { x, y, t: 0.8 }; sfx('march');
    toast(`${sel.length > 1 ? 'Squads guard' : sel[0].name + ' guards'} the area · they engage anything that enters, but never chase out`);
  }
  refreshHUD(true);
}
function dragStart(sx, sy) {
  B.drag = null;
  if (!B.started || B.ended || !B.side || B.aim) return;
  if (B.mode) { B.drag = { mode: B.mode.k, sx, sy, x: sx, y: sy }; return; }
  const w = cam.toWorld(sx, sy), wx = w.x / TS, wy = w.y / TS;
  const own = squadAt(wx, wy, B.side, B.selected.length ? Math.max(0.8, 16 / (cam.zoom * TS)) : hitR());
  if (own && !own.ally) {
    if (!B.selected.includes(own.id)) setSel([own.id]);
    B.drag = { mode: 'order', sx, sy, x: sx, y: sy };
  } else if (B.box) B.drag = { mode: 'box', sx, sy, x: sx, y: sy };
  else B.drag = { mode: 'pan' };
}
function dragEnd(x, y) {
  const d = B.drag; B.drag = null;
  cam.clamp();
  if (!d || d.mode === 'pan' || x == null) return;
  if (d.mode === 'order') { tap(x, y, true); return; }
  if ((d.mode === 'lane' || d.mode === 'guard') && B.mode) {
    const a = cam.toWorld(d.sx, d.sy), b = cam.toWorld(x, y);
    if (d.mode === 'guard') { const r = Math.hypot(b.x - a.x, b.y - a.y) / TS; if (r < 0.9) modeOrder(b.x / TS, b.y / TS, null); else modeOrder(a.x / TS, a.y / TS, r); }
    else modeOrder(b.x / TS, b.y / TS, null);
    return;
  }
  if (d.mode === 'box') {
    const a = cam.toWorld(Math.min(d.sx, x), Math.min(d.sy, y)), b = cam.toWorld(Math.max(d.sx, x), Math.max(d.sy, y));
    const ids = B.sim.squads.filter((s) => s.side === B.side && !HIDDEN(s) && !s.ally && s.x * TS >= a.x - 8 && s.x * TS <= b.x + 8 && s.y * TS >= a.y - 8 && s.y * TS <= b.y + 8).map((s) => s.id);
    if (ids.length) { setSel(ids); sfx('click'); toast(`${ids.length} squad${ids.length > 1 ? 's' : ''} selected`); }
    else toast('No squads in the box');
  }
}

function send(c) {
  if (B.client) net.send({ t: 'cmd', c });
  else command(B.sim, B.side, c);
  if (B.client && c.type === 'move' && !c.queue) { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.goal = c.post; s.state = 'move'; } }
  if (B.client && c.type === 'moveTo' && !c.queue) { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.rally = { x: c.x, y: c.y }; s.path = [{ x: c.x, y: c.y }]; s.state = 'move'; } }
  if (B.client && c.type === 'chase') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.chase = c.target; s.goal = null; s.guard = null; s.regroup = 0; } }
  if (B.client && c.type === 'spot') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.path = [{ x: c.x, y: c.y }]; s.state = 'move'; s.guard = null; s.regroup = 0; } }
  if (B.client && c.type === 'guard') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.guard = { x: c.x, y: c.y, r: c.r }; s.regroup = 0; } }
  if (B.client && c.type === 'camp') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) { s.regroup = 1; s.guard = null; } }
}

function startAim(id) {
  const st = STRATAGEMS[id];
  const targets = stratagemTargets(B.sim, B.side, id);
  if (st.target === 'army') { send({ type: 'strat', id, target: { kind: 'army' } }); return; }
  if (!targets.length) { toast(st.target === 'enemyFighting' ? 'Ambush needs an enemy already in combat' : 'No valid target right now'); return; }
  B.aim = { id, targets };
  sfx('open');
  refreshHUD(true);
}

// ---------- HUD ----------
// Left: your squads (tap a card to select; All / Box above). Right: stratagems. Top: battle info and controls.
// Bottom: the selected squad(s) with formations, Hold, special and deselect.
let hud = {};
function buildUI() {
  clearUI();
  const hasStrat = B.side && B.sim.strat[B.side].list.length;
  hud.left = mount(h('div', { class: 'col battle-left', style: { position: 'absolute', left: 'calc(4px + var(--sal))', top: 'calc(4px + var(--sat))', bottom: 'calc(4px + var(--sab))', width: LEFT - 6 + 'px', gap: '4px' } }));
  hud.right = hasStrat ? mount(h('div', { class: 'col battle-right', style: { position: 'absolute', right: 'calc(4px + var(--sar))', top: 'calc(50px + var(--sat))', bottom: 'calc(4px + var(--sab))', width: RIGHT() - 6 + 'px', gap: '6px' } })) : null;
  hud.top = mount(h('div', { class: 'topbar battle-top', style: { left: `calc(${LEFT}px + var(--sal))` } }));
  hud.bottom = mount(h('div', { class: 'battle-bottom', style: { left: `calc(${LEFT}px + var(--sal))`, right: `calc(${RIGHT() + 4}px + var(--sar))` } }));
  hud.key = null; hud.leftKey = null;
  refreshHUD(true);
}

function squadCard(s) {
  const dead = s.state === 'dead';
  const n = liveCount(s);
  if (s.state === 'reserve' || s.state === 'reinforce') {
    const arriving = s.state === 'reinforce';
    const secs = arriving ? Math.max(0, Math.ceil(s.arriveAt - B.sim.t)) : 0;
    return h('div', { class: 'card tap bsq reserve' + (arriving ? ' dim' : ''), onClick: () => {
      if (arriving) return toast(`${s.allyName || 'Allies'} arrive in ${secs}s`);
      if (!B.started) return toast('Reserves can be called in once the battle begins');
      send({ type: 'callReserve', squad: s.id }); sfx('horn');
    } },
      h('div', { class: 'row', style: { gap: '3px' } }, unitIcon(s.fid, s.unit, 1, 1.6), h('b', { class: 'bsq-n' }, `${n}`)),
      h('span', { class: 'bsq-tag' }, arriving ? `Ally · ${secs}s` : 'Call in'));
  }
  const st = B.state && s.hero != null ? hero(B.state, s.hero) : null;
  const icon = s.hero != null && st ? portrait(st, 1.6) : unitIcon(s.fid, s.unit, 1, 1.6);
  const isSel = B.selected.includes(s.id);
  return h('div', { class: 'card tap bsq' + (isSel ? ' sel' : '') + (dead ? ' dim' : '') + (s.state === 'rout' ? ' rout' : '') + (s.ally ? ' ally' : ''), onClick: () => {
    if (dead || !B.side) return;
    if (s.ally) { focusSquad(s); return toast(`${s.name} fights for ${s.allyName || 'your ally'}`); }
    if (isSel && B.selected.length === 1) { focusSquad(s); return; }
    setSel([s.id]); sfx('click');
  } },
    h('div', { class: 'row', style: { gap: '3px' } }, icon, h('b', { class: 'bsq-n' }, dead ? picon('cross', 12) : `${n}`), s.special >= 1 && !dead && s.heroAlive ? h('span', { class: 'gold bsq-star' }, picon('star', 12)) : s.role && s.skillCd <= 0 && !dead && s.heroAlive ? h('span', { class: 'bsq-star', style: { color: '#9fd0ff' } }, picon('points', 12)) : null),
    s.ally ? h('span', { class: 'bsq-tag' }, 'Ally') : null,
    bar(s.soldiers.length ? n / s.soldiers.length : 0, 'thin'), bar(Math.max(0, s.morale) / 100, 'mor thin'),
    s.ammoMax && !dead ? bar(s.ammo / s.ammoMax, 'amm' + (s.ammo <= 0 ? ' empty' : '')) : null);
}
function focusSquad(s) { cam.x = s.x * TS; cam.y = s.y * TS; if (cam.zoom < cam.min * 1.6) cam.zoom = cam.min * 1.6; cam.clamp(); }

function refreshHUD(full) {
  if (!hud.left || !B.sim) return;
  const sim = B.sim;
  const sels = selSquads();
  const mine = B.side ? sim.squads.filter((s) => s.side === B.side) : sim.squads.filter((q) => q.side === 'att');
  const leftKey = mine.map((s) => `${s.id}${s.state.slice(0, 3)}${liveCount(s)}${Math.round(s.morale / 5)}${s.special >= 1 ? 1 : 0}${s.skillCd > 0 ? 0 : 1}${s.state === 'reinforce' ? Math.ceil(s.arriveAt - sim.t) : ''}${s.ammoMax ? Math.ceil(s.ammo / 3) : ''}`).join() + '|' + B.selected.join() + B.box;
  if (full || leftKey !== hud.leftKey) {
    hud.leftKey = leftKey;
    hud.left.innerHTML = '';
    if (B.side) hud.left.appendChild(h('div', { class: 'row', style: { gap: '3px' } },
      btn('All', () => { const ids = mine.filter((s) => s.state !== 'dead').map((s) => s.id); setSel(ids); sfx('click'); }, 'tiny grow'),
      btn('Box', () => { B.box = !B.box; toast(B.box ? 'Box select on: drag on the ground to select squads' : 'Box select off: drag pans the map'); refreshHUD(true); }, 'tiny grow' + (B.box ? ' primary' : ''))));
    const list = h('div', { class: 'col scroll grow', style: { gap: '4px', minHeight: 0 } }, mine.map(squadCard));
    hud.left.appendChild(list);
  }
  const posts = sim.field.posts;
  const ownP = B.side ? posts.filter((p) => p.owner === B.side).length : 0;
  const left = Math.max(0, 240 - sim.t);
  const stS = B.side ? sim.strat[B.side] : null;
  const topKey = `${Math.floor(left)}|${ownP}|${stS ? stS.pool : ''}|${B.paused}|${B.speed}|${B.auto}`;
  if (full || topKey !== hud.topKey) {
    hud.topKey = topKey;
    hud.top.innerHTML = '';
    hud.top.append(...[
      h('span', { class: 'chip', style: { maxWidth: '150px' } }, h('span', { class: 'ellipsis' }, B.setup.place)),
      h('span', { class: 'chip ' + (left < 30 ? 'bad' : '') }, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`),
      B.side ? h('span', { class: 'chip' }, picon('flag', 14), ` ${ownP}/${posts.length}`) : h('span', { class: 'chip' }, 'Watching'),
      stS && stS.list.length ? h('span', { class: 'chip gold', title: 'Command points' }, picon('points', 14), ` ${stS.pool}`) : null,
      h('span', { class: 'grow' }),
      !B.client && net.role === 'single' ? btn(B.paused ? '▶' : '❚❚', () => { B.paused = !B.paused; refreshHUD(true); }, 'tiny') : null,
      !B.client && net.role === 'single' && !B.auto ? btn(`${B.speed}x`, () => { B.speed = B.speed >= 3 ? 1 : B.speed + 1; refreshHUD(true); }, 'tiny') : null,
      B.side && B.started && !B.auto ? btn('Auto', autoBattle, 'tiny') : B.auto ? h('span', { class: 'chip gold' }, 'Auto') : null,
      B.side ? btn('Retreat', () => confirm('Sound the retreat?', 'Your army withdraws and the battle is lost. Heroes still standing escape.', 'Retreat', 'Fight on', 'danger').then((ok) => ok && send({ type: 'retreat' })), 'danger tiny') : null,
    ].filter(Boolean));
  }
  if (hud.right && stS) {
    const rk = stS.pool + stS.list.map((x) => x.used).join() + (B.aim ? B.aim.id : '') + B.started;
    if (full || rk !== hud.rightKey) {
      hud.rightKey = rk;
      hud.right.innerHTML = '';
      for (const x of stS.list) {
        const S = STRATAGEMS[x.id];
        const off = x.used || S.cost > stS.pool || !B.started;
        hud.right.appendChild(h('div', { class: 'strat-mini' + (off ? ' disabled' : '') + (B.aim && B.aim.id === x.id ? ' aiming' : '') }, stratagemCard({ name: S.name, icon: stratIcon(x.id, 1.5), cost: S.cost, disabled: off, onClick: () => { if (!off) startAim(x.id); } })));
      }
    }
  }
  const md = myDuel();
  const key = sels.map((q) => q.id + q.formation + (q.reform ? q.reform.to : '') + (q.special >= 1 ? '*' : '') + (q.holdFast ? 'h' : '') + Math.ceil(q.skillCd || 0) + terrainAt(sim.field, q.x, q.y) + 'a' + Math.ceil(q.abCd || 0) + (q.guard ? 'g' : '') + (q.regroup || '') + (q.state === 'rout' ? 'r' : '')).join() + '|' + (B.aim ? B.aim.id : '') + B.started + B.queue + '|' + (B.mode ? B.mode.k : '') + '|' + (md ? `${md.key}${md.pending}${Math.ceil(md.left)}${md.wins}` : '');
  if (full || hud.key !== key) {
    hud.key = key;
    hud.bottom.innerHTML = '';
    if (md) {
      const R = Math.min(3, md.d.round);
      hud.bottom.appendChild(h('div', { class: 'bpanel duel-panel' },
        h('span', { class: 'bpanel-name' }, h('span', { class: 'ellipsis' }, `${md.me.name} vs ${md.foe.name}`), h('small', { class: 'bpanel-ter' }, `Round ${R}/3 · ${md.wins[0]}–${md.wins[1]}`)),
        ...(md.pending ? [
          ...DUEL_PICKS.map((k) => btn(PICK_NAME[k], () => pickDuel(k), 'tiny duel-pick ' + k)),
          h('span', { class: 'duel-time' + (md.left < 1.6 ? ' bad' : '') }, `${Math.ceil(md.left)}s`),
          h('small', { class: 'duel-help' }, 'Strike › Feint › Guard › Strike'),
        ] : [h('span', { class: 'muted' }, md.d.rt < 0 ? 'The heroes circle…' : 'Waiting for your foe…')])));
    } else if (B.aim) {
      hud.bottom.appendChild(h('div', { class: 'bpanel' }, h('span', { class: 'gold' }, `${STRATAGEMS[B.aim.id].name}:`), h('span', {}, 'tap a glowing target'), btn('Cancel', () => { B.aim = null; refreshHUD(true); }, 'tiny')));
    } else if (B.mode && sels.length) {
      hud.bottom.appendChild(h('div', { class: 'bpanel' }, h('span', { class: 'gold' }, B.mode.k === 'lane' ? 'Charge:' : 'Guard:'),
        h('span', {}, B.mode.k === 'lane' ? 'tap or drag where to charge' : 'tap a spot · drag to size the area'), btn('Cancel', () => { B.mode = null; refreshHUD(true); }, 'tiny')));
    } else if (sels.length) {
      const one = sels.length === 1 ? sels[0] : null;
      const forms = new Set(sels.map((q) => (q.reform ? q.reform.to : q.formation)));
      const cur = forms.size === 1 ? [...forms][0] : null;
      const reforming = sels.some((q) => q.reform);
      const specials = sels.filter((q) => q.special >= 1 && q.heroAlive);
      const skillers = sels.filter((q) => q.role && SKILLS[q.role] && q.heroAlive);
      const ter = one ? TERRAIN[terrainAt(sim.field, one.x, one.y)] : null;
      const SK = { commander: 'Rally', duelist: 'Duel', strategist: 'Read', scout: 'Scout' };
      // one button per troop drill among the selection (cooldown shown)
      const kinds = [...new Set(sels.filter((q) => q.state !== 'rout').map((q) => q.abil).filter(Boolean))].slice(0, 4);
      const abBtns = kinds.map((k) => {
        const qs = sels.filter((q) => q.abil === k && q.state !== 'rout'), ready = qs.filter((q) => (q.abCd || 0) <= 0), A = ABILITIES[k];
        const cd = ready.length ? 0 : Math.min(...qs.map((q) => Math.ceil(q.abCd || 0)));
        return btn(cd ? `${A.btn} ${cd}` : A.btn, () => {
          if (!ready.length) return toast(`${A.name} is ready in ${cd}s`);
          if (k === 'charge') return setMode('lane');
          for (const q of ready) send({ type: 'ability', squad: q.id });
          toast(`${A.name}: ${A.desc}`);
        }, 'tiny ab' + (cd ? ' dim' : ' good'));
      });
      const guarding = sels.every((q) => q.guard), camping = sels.every((q) => q.regroup);
      const row2 = [
        ...abBtns,
        btn('Guard', () => setMode('guard'), 'tiny' + (guarding ? ' sel' : '')),
        btn('Camp', () => {
          if (camping) return toast('Already regrouping · any order sends them back out');
          for (const q of sels) send({ type: 'camp', squad: q.id });
          toast(`${sels.length > 1 ? 'Squads fall' : one.name + ' falls'} back to camp: morale, arrows and some wounded recover`); sfx('march');
        }, 'tiny' + (camping ? ' sel' : '')),
        ...(skillers.length === 1 ? [skillers[0]] : []).map((q) => btn(q.skillCd > 0 ? `${SK[q.role]} ${Math.ceil(q.skillCd)}` : SK[q.role], () => { if (q.skillCd > 0) return toast(`${SKILLS[q.role].name} is ready in ${Math.ceil(q.skillCd)}s`); send({ type: 'skill', squad: q.id }); toast(`${SKILLS[q.role].name}: ${SKILLS[q.role].desc}`); }, 'tiny' + (q.skillCd > 0 ? ' dim' : ' good'))),
        specials.length ? btn(picon('star', 16), () => { for (const q of specials) send({ type: 'special', squad: q.id }); }, 'tiny primary') : null,
      ].filter(Boolean);
      hud.bottom.appendChild(h('div', { class: 'bpanel bpanel2' },
        h('div', { class: 'bprow' },
          h('span', { class: 'bpanel-name', title: ter && ter.tip ? `${ter.name}: ${ter.tip}` : '' }, h('span', { class: 'ellipsis' }, one ? one.name : `${sels.length} squads`), ter && ter.tip ? h('small', { class: 'bpanel-ter' }, ter.name) : null),
          ...FORMS.map((f) => btn(FORMATIONS[f].name + (reforming && cur === f ? '…' : ''), () => { for (const q of sels) send({ type: 'formation', squad: q.id, formation: f }); refreshHUD(true); }, 'tiny' + (cur === f ? (reforming ? ' primary' : ' sel') : ''))),
          btn('Hold', () => { for (const q of sels) send({ type: 'hold', squad: q.id }); toast('Holding position'); refreshHUD(true); }, 'tiny' + (sels.every((q) => q.holdFast && !q.regroup) ? ' sel' : '')),
          btn('+Then', () => { B.queue = !B.queue; toast(B.queue ? 'Queue on: each order is added after the last one' : 'Queue off'); refreshHUD(true); }, 'tiny' + (B.queue ? ' primary' : '')),
          btn('✕', () => { setSel([]); }, 'tiny')),
        h('div', { class: 'bprow' }, ...row2)));
    } else if (B.started && B.side) {
      hud.bottom.appendChild(h('div', { class: 'bpanel hint' }, B.auto ? 'Your generals are in command' : 'Tap a squad, then a base, a road or an enemy · double-tap a squad for all of its kind'));
    }
  }
}

// hand the rest of the battle to your generals (solo: fast-forward to the end)
function autoBattle() {
  if (B.auto || !B.side) return;
  const go = () => {
    B.auto = true; B.selected = []; B.aim = null;
    if (B.client) send({ type: 'auto' });
    else { B.sim.ai[B.side] = true; if (net.role === 'single') B.speed = 8; } // your seat stays yours (saves and Retreat keep working)
    toast(net.role === 'single' ? 'Your generals finish the battle' : 'Your generals take command');
    refreshHUD(true);
  };
  confirm('Auto-battle?', net.role === 'single' ? 'Your generals fight the rest of this battle at high speed.' : 'Your generals take command of your squads for the rest of this battle.', 'Auto', 'Keep command', 'primary').then((ok) => ok && go());
}

function intro() {
  const st = B.setup;
  const side = B.side;
  const tags = B.sim.squads.filter((s) => s.side === side && s.tags && s.tags.length).map((s) => `${s.name.split(' ')[0]}: ${s.tags.join(', ')}`);
  const body = h('div', { class: 'col' },
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B.colors.att } }), h('b', {}, st.attName), h('span', { class: 'muted' }, 'attacking')),
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B.colors.def } }), h('b', {}, st.defName), h('span', { class: 'muted' }, 'defending')),
    h('div', { class: 'muted' }, side === 'att' ? 'Take the enemy main post (the town) to win. Outposts on the way weaken them.'
      : side === 'def' ? 'Hold the main post until time runs out, or rout the attackers.' : 'You are watching this battle.'),
    tags.length ? h('div', { class: 'good', style: { fontSize: '12px' } }, `Bonuses: ${[...new Set(B.sim.squads.filter((s) => s.side === side).flatMap((s) => s.tags || []))].join(', ')}`) : null,
    tacticChips(side),
    strengthRow(side),
    reserveRow(side),
    allyLine(side),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, [terrainLine(), B.sim.field.wallRect ? (side === 'att' ? 'Batter the gate, or tap the wall to raise ladders.' : 'Your archers shoot best from behind the walls.') : '', 'Wedge › Line › Square › Wedge · flank for extra damage.'].filter(Boolean).join(' ')));
  const start = () => { if (net.role === 'host') net.send({ t: 'battleGo' }); B.started = true; sfx('horn'); banner('BATTLE!', '', st.place); refreshHUD(true); };
  if (B.client) {
    let m;
    net.on('battleGo', () => { B.started = true; m && m.close(); sfx('horn'); banner('BATTLE!', '', st.place); refreshHUD(true); });
    m = modal(`Battle of ${st.place}`, body, [], {});
    return;
  }
  if (!side && net.role === 'host') { const m = modal(`Battle of ${st.place}`, body, []); setTimeout(() => { m.close(); start(); }, 2500); return; }
  if (side && net.role === 'single' && !practiced()) {
    const orig = B.origArgs;
    modal(`Battle of ${st.place}`, h('div', { class: 'col' }, body, h('div', { class: 'gold', style: { fontSize: '12px' } }, 'First battle? A two-minute practice fight shows you the controls.')),
      [['Skip', () => { setPracticed(); start(); }], ['Practice first', () => startPractice({ back: 'battle', backArgs: orig }), 'primary']]);
    return;
  }
  modal(`Battle of ${st.place}`, body, [['Begin', start, 'primary']]);
}

// a quick read of the odds from what's on the field (reserves and late allies included)
function strengthRow(side) {
  const pow = (k) => B.sim.squads.filter((q) => q.side === k).reduce((a, q) => a + q.soldiers.reduce((b, x) => b + x.atk * Math.sqrt(x.max), 0) * q.atkMul * q.defMul + (q.hero != null ? q.heroAtk * 6 : 0), 0) + (k === 'def' && B.sim.gates.length ? 40 : 0);
  const a = pow('att'), d = pow('def'), mine = side === 'def' ? d : a, theirs = side === 'def' ? a : d;
  const p = mine / Math.max(1, mine + theirs);
  const word = p > 0.62 ? 'You are stronger' : p > 0.52 ? 'Slight edge' : p > 0.45 ? 'Even fight' : p > 0.35 ? 'They are stronger' : 'Badly outmatched';
  const col = p > 0.52 ? '#8fd06b' : p > 0.45 ? '#ffd86b' : '#ff6a5a';
  if (!side) return null;
  return h('div', { class: 'row', style: { gap: '8px' } },
    h('div', { class: 'grow', style: { height: '8px', background: B.colors[side === 'def' ? 'att' : 'def'], border: '2px solid #0b0a10', borderRadius: '2px', position: 'relative' } },
      h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.round(p * 100) + '%', background: B.colors[side] } })),
    h('b', { style: { color: col, whiteSpace: 'nowrap', fontSize: '13px' } }, word));
}
function terrainLine() {
  const t = B.sim.field.template;
  const wx = ({ fog: 'Thick fog: archers see less.', blizzard: 'Blizzard: troops march slowly and morale wanes.', storm: 'Storm: arrows fly short and fires sputter.', drought: 'Drought: fire spreads fast.' })[B.sim.weather] || '';
  return (wx + ' ' + (({ river: 'A river cuts the field: cross at bridges and fords.', lake: 'A lake sits in the middle.', forest: 'Thick woods give cover from arrows.', pass: 'High ground: hills slow troops but favour defenders and archers.', islands: 'Islands linked by bridges.', coast: 'The sea guards one flank.', ruins: 'Old ruins dot the field.', dungeon: 'Underground halls; beware traps.' })[t] || '')).trim();
}
// what's special about this field: night, hilltops, a side goal
function tacticChips(side) {
  const sim = B.sim, O = sim.obj, out = [];
  const c = (icon, text, tip) => h('span', { class: 'tchip', title: tip }, picon(icon, 14), ' ' + text);
  if (sim.night) out.push(c('moon', 'Night', 'You see only what your torches light. Ambushes strike twice as hard; scouts see farther.'));
  if (sim.hills && sim.hills.length) out.push(c('hill', 'High ground', 'Hold a hilltop flag: squads there shoot farther and take less harm.'));
  if (O) out.push(c(O.kind === 'caravan' ? 'wagon' : O.kind === 'supplies' ? 'warning' : 'lock',
    ({ caravan: 'Escort the caravan', supplies: side === 'def' ? 'Guard the supplies' : 'Burn the supplies', captive: 'Free the captive' })[O.kind],
    ({ caravan: 'Stand by the caravan with no enemy near and it rolls to your lines.', supplies: 'Hold a squad by the supply cache, unopposed, to burn it.', captive: 'Hold the hut with no enemy close to free the captive.' })[O.kind]));
  return out.length ? h('div', { class: 'row wrap', style: { gap: '4px' } }, ...out) : null;
}
function allyLine(side) {
  if (!side) return null;
  const mine = B.sim.squads.filter((q) => q.ally && q.state === 'reinforce');
  const ours = mine.filter((q) => q.side === side), theirs = mine.filter((q) => q.side !== side);
  if (!ours.length && !theirs.length) return null;
  return h('div', { class: 'row wrap', style: { gap: '4px' } },
    ours.length ? chip(`Allies coming: ${ours.map((q) => q.name).join(', ')}`, 'good') : null,
    theirs.length ? chip(`Enemy allies coming: ${theirs.length}`, 'bad') : null);
}
// keep one squad back to call in later
function reserveRow(side) {
  if (!side) return null;
  const mine = B.sim.squads.filter((q) => q.side === side && q.hero != null && !q.ally);
  if (mine.length < 2) return null;
  const row = h('div', { class: 'row wrap', style: { gap: '4px' } });
  const paint = () => {
    row.innerHTML = '';
    row.append(h('span', { class: 'muted' }, 'Reserve:'));
    row.append(btn('None', () => { for (const q of mine) if (q.state === 'reserve') { send({ type: 'reserve', squad: q.id }); if (B.client) q.state = 'idle'; } setTimeout(paint, 60); }, 'tiny' + (mine.some((q) => q.state === 'reserve') ? '' : ' sel')));
    for (const q of mine) row.append(btn(q.name.split(' ')[0], () => {
      for (const o of mine) if (o.state === 'reserve' && o.id !== q.id) send({ type: 'reserve', squad: o.id });
      send({ type: 'reserve', squad: q.id }); if (B.client) q.state = q.state === 'reserve' ? 'idle' : 'reserve'; setTimeout(paint, 60);
    }, 'tiny' + (q.state === 'reserve' ? ' sel' : '')));
  };
  paint();
  return row;
}

function finish() {
  const result = battleResult(B.sim);
  if (net.role === 'host') net.send({ t: 'battleEnd', result });
  endBattle(result);
}

function endBattle(result) {
  B.ended = true;
  if (canSave()) clearBattle(B.state.cid, B.key);
  const sim = B.sim;
  const won = B.side ? result.winner === B.side : null;
  sfx(won === false ? 'defeat' : 'victory'); buzz(won === false ? 'lose' : 'win');
  banner(won == null ? (result.winner === 'att' ? 'ATTACKERS WIN' : 'DEFENDERS WIN') : won ? 'VICTORY' : 'DEFEAT', won === false ? 'bad' : 'good', B.setup.place);
  if (won) B.juice.confetti(sim.field.W * TS / 2, sim.field.H * TS / 2);
  // recap: losses on each side, the squad of the battle, elites lost, heroes wounded or taken
  const side = (k) => sim.squads.filter((q) => q.side === k && q.state !== 'reinforce');
  const lost = (k) => side(k).reduce((a, q) => a + q.soldiers.filter((x) => !x.alive).length, 0);
  const total = (k) => side(k).reduce((a, q) => a + q.soldiers.length, 0);
  const me = B.side || 'att', them = me === 'att' ? 'def' : 'att';
  const mvp = [...sim.squads].filter((q) => q.side === (won === false ? them : me)).sort((a, b) => (B.kills.get(b.id) || 0) - (B.kills.get(a.id) || 0))[0];
  const elitesLost = sim.squads.filter((q) => q.side === me).flatMap((q) => q.soldiers.filter((x) => !x.alive && x.s === 3).map((x) => x.name || 'an Elite'));
  const hurt = sim.squads.filter((q) => q.hero != null && !q.heroAlive);
  const survivors = sim.squads.filter((q) => q.side === me && q.soldiers.some((x) => x.alive)).length;
  const stat = (label, a, b) => h('div', { class: 'row recap-row' }, h('span', { class: 'grow muted' }, label), h('b', {}, a), h('span', { class: 'muted' }, ' · '), h('b', { class: 'muted' }, b));
  const lines = [
    h('div', { class: 'row recap-row' }, h('span', { class: 'grow' }), h('span', { class: 'swatch', style: { background: B.colors[me] } }), h('span', { class: 'muted' }, B.side ? 'yours' : 'attackers'), h('span', { class: 'swatch', style: { background: B.colors[them] } }), h('span', { class: 'muted' }, B.side ? 'theirs' : 'defenders')),
    stat('Troops lost', `${lost(me)}/${total(me)}`, `${lost(them)}/${total(them)}`),
    mvp && (B.kills.get(mvp.id) || 0) > 0 ? h('div', { class: 'row recap-row' }, h('span', { class: 'gold' }, 'MVP · Squad of the battle'), h('span', { class: 'grow ellipsis', style: { textAlign: 'right' } }, `${mvp.name} · ${B.kills.get(mvp.id)} felled`)) : null,
    survivors && won !== false ? h('div', { class: 'good', style: { fontSize: '12px' } }, `${survivors} squad${survivors > 1 ? 's' : ''} gain experience; veterans may rise to Elite.`) : null,
    elitesLost.length ? h('div', { class: 'bad', style: { fontSize: '12px' } }, `Fallen Elites: ${elitesLost.slice(0, 4).join(', ')}${elitesLost.length > 4 ? '…' : ''}`) : null,
    hurt.length ? h('div', { style: { fontSize: '12px' } }, h('span', { class: 'muted' }, 'Heroes beaten: '), hurt.map((q) => q.name.split(' ')[0] + (q.side === me ? ' (yours)' : '')).join(', '), h('span', { class: 'muted' }, ' — they may be wounded or taken prisoner.')) : null,
    (result.nemesisResult || []).length ? h('div', { class: 'gold', style: { fontSize: '12px' } }, 'A nemesis grudge was settled on this field.') : null,
    result.objective ? h('div', { class: result.objective.done ? (result.objective.by === me ? 'good' : 'bad') : 'muted', style: { fontSize: '12px' } },
      result.objective.done ? `${({ caravan: 'Caravan delivered', supplies: 'Supplies burned', captive: 'Captive freed' })[result.objective.kind]} by ${result.objective.by === me ? (B.side ? 'your army' : 'the attackers') : (B.side ? 'the enemy' : 'the defenders')}.`
        : `${({ caravan: 'The caravan', supplies: 'The supply cache', captive: 'The captive' })[result.objective.kind]} was left ${result.objective.kind === 'supplies' ? 'standing' : 'behind'}.`) : null,
  ];
  setTimeout(() => modal(won == null ? (result.winner === 'att' ? 'Attackers win' : 'Defenders win') : won ? 'Victory!' : 'Defeat',
    h('div', { class: 'col recap' }, result.retreated ? h('div', { class: 'muted' }, `${result.retreated === 'att' ? 'The attackers' : 'The defenders'} retreated.`) : null, lines),
    [['Continue', () => (B.practice ? leavePractice() : go('campaign', { resume: B.client ? true : result })), 'primary']]), 900);
}

// ---------- guided practice battle ----------
const PRACTICED = 'ikkr-dw-practiced';
export function practiced() { try { return !!localStorage.getItem(PRACTICED); } catch { return true; } }
function setPracticed() { try { localStorage.setItem(PRACTICED, '1'); } catch {} }
// opts.back: scene to return to afterwards ('title' by default), opts.backArgs: its args
export function startPractice(opts = {}) {
  const back = opts.back || 'title', backArgs = opts.backArgs || {};
  const troops = (n) => Array.from({ length: n }, (_, i) => ({ s: i < 2 ? 2 : 1, r: 0, xp: 0 }));
  const capt = (id, name, gender, unit) => ({ id, name, gender, fid: 'castle', ufid: 'castle', unit, troops: troops(8), formation: 'line', loyalty: 100, level: 3, atk: 5, def: 4, lead: 6, int: 3, spell: null, role: null, secret: -1, gear: {}, portrait: 0 });
  const setup = {
    seed: 4242, biome: 'grass', season: 'Spring', level: 0, place: 'Training Field', siege: false,
    attackers: [capt(9001, 'Captain Aldric', 'm', 0), capt(9002, 'Sergeant Mira', 'f', 1)], defenders: [],
    attFid: 'castle', defFid: 'orcs', attName: 'Your Company', defName: 'Training Raiders', attKid: -1, defKid: -2, attMorale: 80, defMorale: 35,
    attLoadout: ['rally', 'march'], defLoadout: [], attPool: 6, defPool: 0,
    colors: { att: '#3a7bf0', def: '#d8402f' }, control: { att: 0, def: 'ai' },
    garrison: { squads: 2, size: 4 }, skirmish: true, weather: null, nemesis: [], intel: true,
    land: { forest: 0, mtn: 0, river: false, lake: false, coast: false, island: false, sites: [] }, reinforce: { att: [], def: [] },
    night: false, objective: false, // keep the first fight simple
  };
  go('battle', { setup, items: {}, me: 0, practice: { back, backArgs } });
}
function leavePractice() {
  setPracticed();
  const P = B.practice; B.practice = null; B.coach = null;
  go(P.back, P.backArgs);
}
const COACH = [
  { text: 'Tap one of your squads (on the field or in the list on the left).', done: () => B.selected.length > 0, glow: '.battle-left .bsq', ring: () => own()[0] },
  { text: 'Now tap the glowing outpost to march there and capture it.', done: () => own().some((q) => q.goal != null || (q.path && q.path.length)), ring: () => nextPost() },
  { text: 'Tap an enemy squad (red) to attack it.', done: () => own().some((q) => q.chase != null || q.state === 'fight'), ring: () => foes()[0] },
  { text: 'Change formation: pick Wedge, Line or Square in the bar below. Wedge beats Line, Line beats Square, Square beats Wedge.', done: () => own().some((q) => q.reform || q.formation !== 'line'), glow: '.battle-bottom .bpanel', ring: () => (B.selected.length ? null : own()[0]) },
  { text: 'Use a stratagem on the right: Rally lifts every squad\u2019s morale.', done: () => B.sim.strat.att.list.some((x) => x.used), glow: '.strat-mini:not(.disabled)' },
  { text: 'Last step: take the enemy main base (the big flag). Win the battle!', done: () => B.sim.winner === 'att', ring: () => B.sim.field.posts.find((p) => p.main) },
];
const own = () => B.sim.squads.filter((q) => q.side === 'att' && !HIDDEN(q));
const foes = () => B.sim.squads.filter((q) => q.side === 'def' && !HIDDEN(q) && q.state !== 'rout');
function nextPost() {
  const ps = B.sim.field.posts.filter((p) => p.owner !== 'att' && !p.main);
  const o = own()[0]; if (!ps.length) return B.sim.field.posts.find((p) => p.main);
  return o ? ps.sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y))[0] : ps[0];
}
function startCoach() {
  B.coach = { i: 0, el: null, glowed: [] };
  B.sim.eventsLeft = 0; B.sim.nextEvent = 1e9; // no rockslides while learning
}
function practiceIntro() {
  modal('Practice battle', h('div', { class: 'col' },
    h('div', {}, 'Two of your squads against a pair of raiders. Follow the prompts at the top to learn the controls.'),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, 'You can skip at any time.')),
  [['Skip practice', () => leavePractice()], ['Start', () => { B.started = true; sfx('horn'); banner('PRACTICE', '', 'Training Field'); refreshHUD(true); coachRender(); }, 'primary']]);
}
function coachRender() {
  const C = B.coach; if (!C) return;
  if (!C.el || !C.el.isConnected) C.el = mount(h('div', { class: 'coach' }));
  const st = COACH[C.i];
  C.el.innerHTML = '';
  if (!st) return;
  C.el.append(h('span', { class: 'coach-n' }, `${C.i + 1}/${COACH.length}`), h('span', { class: 'coach-t grow' }, st.text), btn('Skip', () => confirm('Skip the practice?', 'You can replay it later from How to play.', 'Skip', 'Keep going').then((ok) => ok && leavePractice()), 'tiny'));
  C.el.classList.remove('coach-pop'); void C.el.offsetWidth; C.el.classList.add('coach-pop');
}
function coachTick() {
  const C = B.coach;
  if (!B.started || B.ended) return;
  if (B.sim.t > 150 && C.i < COACH.length - 1) B.sim.t = 150; // the clock waits while you learn
  const st = COACH[C.i];
  if (st && st.done()) {
    C.i++; sfx('coin'); buzz('tap');
    coachRender();
  }
  // glow the UI element the step is about
  for (const el of C.glowed) el.classList.remove('coach-glow');
  C.glowed = [];
  const cur = COACH[C.i];
  if (cur && cur.glow) C.glowed = [...document.querySelectorAll(cur.glow)];
  for (const el of C.glowed) el.classList.add('coach-glow');
}
function drawCoach(time) {
  const st = COACH[B.coach.i]; if (!st || !st.ring || !B.started) return;
  const t = st.ring(); if (!t) return;
  const r = t.soldiers ? B.render.get(t.id) : null;
  const x = (r ? r.x : t.x) * TS, y = (r ? r.y : t.y) * TS;
  const k = (time * 1.6) % 1;
  ctx.strokeStyle = `rgba(255,216,107,${1 - k})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x, y, (1.4 + k * 1.6) * TS, (0.9 + k * 1.1) * TS, 0, 0, Math.PI * 2); ctx.stroke();
  const bob = Math.sin(time * 6) * 3;
  ctx.fillStyle = '#ffd86b'; ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y - 24 + bob); ctx.lineTo(x - 6, y - 34 + bob); ctx.lineTo(x + 6, y - 34 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
}

// ---------- mid-battle saves (single player campaign only) ----------
function canSave() { return net.role === 'single' && !B.client && !B.practice && B.state && B.state.cid && B.sim && B.battle; }
function saveNow(sync) {
  B._savedAt = game.time;
  if (!canSave() || !B.started || B.ended || B.sim.winner) return;
  const data = { v: 1, setup: B.setup, sim: serializeSim(B.sim), b: B.battle, ctx: B.saveCtx, me: B.me, kills: [...B.kills], speed: B.speed, auto: B.auto || undefined, place: B.setup.place, t: B.sim.t };
  saveBattle(B.state.cid, B.key, data, B.state, { sync });
}
function resumeIntro() {
  const st = B.setup;
  const left = Math.max(0, Math.round(240 - B.sim.t));
  modal(`Battle of ${st.place}`, h('div', { class: 'col' },
    h('div', {}, 'The battle was saved mid-fight. Your squads stand where you left them.'),
    h('div', { class: 'muted', style: { fontSize: '12px' } }, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left on the clock.`)),
  [['Resume', () => { B.started = true; sfx('horn'); banner('BATTLE RESUMED', '', st.place); refreshHUD(true); }, 'primary']]);
}

// the other player dropped mid-battle: their squads fight on under AI control (host), the client waits for a resync
export function battlePeerLost() {
  if (!B.sim || B.ended || !B.setup) return;
  if (net.role === 'host') {
    for (const side of ['att', 'def']) if (B.setup.control[side] === 1) B.sim.ai[side] = true;
    toast('Player 2 lost connection — their army fights on under their generals', 'gold');
  }
}
