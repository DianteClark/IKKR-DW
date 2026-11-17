// Real-time battle simulation (fixed 20 Hz). Pure data, so the host can stream it to a peer.
// Squads move along post-to-post routes, fight in formations, use stratagems; the land itself can change mid-battle.
import { makeRng } from '../engine/rng.js';
import {
  soldierStats, isRanged, heroTotals, formationEdge, FORMATIONS, unitName, formationChangeTime, STRATAGEMS,
} from '../game/rules.js';
import { makeField, shortestPath, nearestPost, BW, BH } from './field.js';

export const DT = 0.05;
const MELEE = 1.25, RANGE = 5.2, SIGHT = 5.5, CAP_R = 2.4, TIME_LIMIT = 240;

export function createBattle(setup) {
  const { seed, biome, level, attackers, defenders, attFid, defFid, items, garrison } = setup;
  const rng = makeRng(seed);
  const n = attackers.length + defenders.length;
  const size = n > 7 ? 'grand' : n > 3 ? 'standard' : 'skirmish';
  const field = makeField(seed, biome, 4 + Math.min(2, Math.floor(n / 3)), { size, siege: !!setup.siege, level });
  field.W = field.W || BW; field.H = field.H || BH; field.blocked = field.blocked || [];
  const sim = {
    seed, t: 0, tick: 0, field, squads: [], winner: null, events: [], evSeq: 0, attFid, defFid, level, retreat: null,
    routTimer: { att: 0, def: 0 }, fires: [], ai: { att: false, def: false },
    strat: {
      att: { pool: setup.attPool || 6, max: setup.attPool || 6, list: (setup.attLoadout || []).map((id) => ({ id, used: false })) },
      def: { pool: setup.defPool || 6, max: setup.defPool || 6, list: (setup.defLoadout || []).map((id) => ({ id, used: false })) },
    },
    kids: { att: setup.attKid ?? -1, def: setup.defKid ?? -1 },
    nextEvent: 55 + rng() * 60, eventsLeft: field.eventSpots && field.eventSpots.length ? 2 : 1, fog: 0,
  };
  let sid = 1;
  const kin = { att: {}, def: {} };
  for (const h of attackers) kin.att[h.fid] = (kin.att[h.fid] || 0) + 1;
  for (const h of defenders) kin.def[h.fid] = (kin.def[h.fid] || 0) + 1;
  const pure = (list, fid) => list.length > 1 && list.every((h) => h.fid === fid && (h.ufid || h.fid) === fid);
  const pureAtt = pure(attackers, attFid), pureDef = pure(defenders, defFid);
  const mk = (side, hero, fid, unit, troops, formation, post, slot) => {
    const t = hero ? heroTotals(hero, items) : { atk: 1, def: 1 + level, lead: 6, int: 0, morale: 0, spd: 0 };
    const soldiers = troops.map((tr, i) => { const st = soldierStats(fid, unit, tr); return { idx: i, s: tr.s, r: tr.r, name: tr.name, hp: st.hp, max: st.hp, atk: st.atk, def: st.def, alive: true }; });
    const st1 = soldierStats(fid, unit, { s: 1, r: 0 });
    const p = field.posts[post];
    const ang = rng() * Math.PI * 2;
    let bonus = 1;
    const tags = [];
    if (hero && hero.fid === fid) { bonus *= 1.1; tags.push('Race match'); }
    const kinN = hero ? (kin[side][hero.fid] || 1) - 1 : 0;
    if (kinN > 0) { bonus *= 1 + Math.min(0.12, kinN * 0.03); tags.push('Kinship'); }
    if (side === 'att' ? pureAtt : pureDef) { bonus *= 1.05; tags.push('Pure realm'); }
    const baseMorale = setup[side + 'Morale'] ?? 60;
    const enemyKid = side === 'att' ? sim.kids.def : sim.kids.att;
    const sq = {
      id: sid++, side, hero: hero ? hero.id : null, name: hero ? hero.name : 'Town Guard', fid, unit, hfid: hero ? hero.fid : fid, gender: hero ? hero.gender : 'm',
      formation: formation || 'line', x: p.x + Math.cos(ang) * slot, y: p.y + Math.sin(ang) * slot, dir: side === 'att' ? 0 : Math.PI,
      soldiers, ranged: isRanged(fid, unit), lead: t.lead, tags, loyalty: hero ? hero.loyalty : 100,
      heroHp: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroMax: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroAlive: !!hero,
      atkMul: (1 + t.atk * 0.045) * bonus, defMul: (1 + t.def * 0.04) * bonus, heroAtk: hero ? 2.5 + t.atk * 0.6 : 0, int: t.int,
      spd: st1.spd * (1 + (t.spd || 0)), morale: Math.min(100, (hero ? baseMorale : 55 + level * 5) + (t.morale || 0)),
      special: 0.25, spell: hero ? hero.spell : null, home: post,
      traitor: hero && hero.secret >= 0 && hero.secret === enemyKid ? 25 + rng() * 50 : 0,
      state: 'idle', path: [], goal: null, chase: null, engaged: null, shootCd: 0, reform: null, buffs: {}, formCd: 0,
    };
    sim.squads.push(sq);
    return sq;
  };
  attackers.forEach((h, i) => mk('att', h, h.ufid || h.fid, h.unit, h.troops, h.formation, 0, 1 + i * 0.9));
  const defPosts = field.posts.filter((p) => p.owner === 'def').map((p) => p.id);
  defenders.forEach((h, i) => mk('def', h, h.ufid || h.fid, h.unit, h.troops, h.formation, defPosts[i % defPosts.length], 1 + Math.floor(i / defPosts.length)));
  if (garrison) {
    for (let i = 0; i < garrison.squads; i++) {
      const troops = Array.from({ length: garrison.size }, () => ({ s: 1, r: level > 1 ? 1 : 0, xp: 0 }));
      mk('def', null, defFid, Math.min(i, 2), troops, 'square', defPosts[(i + defenders.length) % defPosts.length], 0.8);
    }
  }
  for (const s of sim.squads) if (s.side === 'def') s.state = 'hold';
  return sim;
}

const alive = (s) => s.state !== 'dead';
const fighting = (s) => alive(s) && s.state !== 'rout';
export const liveCount = (s) => s.soldiers.reduce((n, x) => n + (x.alive ? 1 : 0), 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function ev(sim, e) { e.seq = ++sim.evSeq; e.t = sim.t; sim.events.push(e); if (sim.events.length > 240) sim.events.splice(0, 120); }
const other = (side) => (side === 'att' ? 'def' : 'att');
const buff = (s, k) => (s.buffs[k] || 0) > 0;

// ---------- commands ----------
export function command(sim, side, c) {
  if (sim.winner) return false;
  if (c.type === 'retreat') { if (!sim.retreat) { sim.retreat = side; sim.winner = other(side); ev(sim, { k: 'end' }); } return true; }
  if (c.type === 'strat') return useStratagem(sim, side, c.id, c.target);
  const s = sim.squads.find((q) => q.id === c.squad);
  if (!s || s.side !== side || !alive(s)) return false;
  if (c.type === 'move') { routeTo(sim, s, c.post); return true; }
  if (c.type === 'chase') { s.chase = c.target; s.path = []; s.goal = null; if (s.state !== 'rout') s.state = 'move'; return true; }
  if (c.type === 'hold') { s.path = []; s.goal = null; s.chase = null; if (s.state !== 'rout') s.state = 'hold'; return true; }
  if (c.type === 'formation' && FORMATIONS[c.formation]) return changeFormation(sim, s, c.formation);
  if (c.type === 'special') return castSpecial(sim, s);
  return false;
}

function routeTo(sim, s, post) {
  const from = nearestPost(sim.field, s.x, s.y);
  s.path = shortestPath(sim.field, from, post).map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y }));
  if (s.path.length > 1 && dist(s, s.path[0]) < 2.5) s.path.shift();
  s.goal = post; s.chase = null; s.engaged = null;
  if (s.state !== 'rout') s.state = 'move';
}

export function changeFormation(sim, s, f) {
  if (s.formation === f && !s.reform) return false;
  if (s.reform && s.reform.to === f) return false;
  const total = formationChangeTime(s.reform ? s.reform.from : s.formation, f, liveCount(s), s.lead || 8);
  s.reform = { from: s.reform ? s.reform.from : s.formation, to: f, t: 0, total };
  ev(sim, { k: 'reform', id: s.id, to: f, total });
  return true;
}

function castSpecial(sim, s) {
  if (s.special < 1 || !s.heroAlive || s.state === 'rout') return false;
  let best = null, bd = 1e9;
  for (const e of sim.squads) if (e.side !== s.side && alive(e)) { const d = dist(s, e); if (d < 8 && d < bd) { bd = d; best = e; } }
  if (!best) return false;
  s.special = 0;
  const power = 7 + s.int * 2.2 + s.heroAtk;
  ev(sim, { k: 'spell', spell: s.spell, x: best.x, y: best.y, from: s.id });
  for (const e of sim.squads) {
    if (e.side === s.side || !alive(e) || dist(e, best) > 2.6) continue;
    for (const so of e.soldiers) if (so.alive) damageSoldier(sim, e, so, power * (0.55 + 0.25 * ((so.idx * 7 + sim.tick) % 10) / 10), s);
    if (liveCount(e) === 0) damageHero(sim, e, power * 0.5);
    e.morale -= 12;
  }
  s.morale = Math.min(100, s.morale + 10);
  return true;
}

// ---------- stratagems ----------
function touchesCamp(sim, i) { const [a, b] = sim.field.edges[i]; return sim.field.posts[a].camp || sim.field.posts[b].camp; }
export function stratagemTargets(sim, side, id) {
  const st = STRATAGEMS[id];
  const S = sim.squads;
  if (!st) return [];
  if (st.target === 'army') return [{ kind: 'army' }];
  if (st.target === 'own') return S.filter((s) => s.side === side && fighting(s) && (id !== 'warcry' || s.heroAlive) && (id !== 'feint' || s.state === 'fight')).map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'enemy') return S.filter((s) => s.side !== side && alive(s)).map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'enemyFighting') return S.filter((s) => s.side !== side && alive(s) && s.state === 'fight').map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'post') return sim.field.posts.filter((p) => p.owner === side).map((p) => ({ kind: 'post', id: p.id }));
  if (st.target === 'route') return sim.field.edges.map((e, i) => i).filter((i) => !sim.field.blocked.includes(i) && !touchesCamp(sim, i)).map((i) => ({ kind: 'edge', id: i }));
  return [];
}

export function useStratagem(sim, side, id, target) {
  const S = sim.strat[side];
  const slot = S.list.find((x) => x.id === id && !x.used);
  const st = STRATAGEMS[id];
  if (!slot || !st || S.pool < st.cost) return false;
  const valid = stratagemTargets(sim, side, id);
  const tgt = st.target === 'army' ? { kind: 'army' } : valid.find((v) => target && v.id === target.id && v.kind === target.kind);
  if (!tgt) return false;
  slot.used = true; S.pool -= st.cost;
  const sq = tgt.kind === 'squad' ? sim.squads.find((q) => q.id === tgt.id) : null;
  let x = sq ? sq.x : 0, y = sq ? sq.y : 0;
  if (id === 'rally') {
    for (const s of sim.squads) if (s.side === side && alive(s)) { s.morale = Math.min(100, s.morale + 30); if (s.state === 'rout' && s.morale > 45) s.state = 'hold'; }
    const own = sim.squads.filter((s) => s.side === side && alive(s)); if (own[0]) { x = own[0].x; y = own[0].y; }
  }
  if (id === 'march') sq.buffs.march = 12;
  if (id === 'smoke') sq.buffs.smoke = 10;
  if (id === 'warcry') { sq.special = 1; sq.buffs.warcry = 10; sq.morale = Math.min(100, sq.morale + 10); }
  if (id === 'confuse') { sq.buffs.confused = 7; sq.path = []; sq.chase = null; sq.engaged = null; }
  if (id === 'ambush') {
    let total = 0; for (const so of sq.soldiers) if (so.alive) total += so.max;
    hitSquad(sim, sq, total * 0.28 + 20, null, true);
    sq.morale -= 25;
    for (const s of sim.squads) if (s.side === side && alive(s) && dist(s, sq) < 6) s.morale = Math.min(100, s.morale + 8);
  }
  if (id === 'fire') sim.fires.push({ x: sq.x, y: sq.y, t: 8, r: 2.2, pow: 3.2 * (sim.field.underground ? 0.35 : 1), side });
  if (id === 'discord') {
    sq.morale -= 35;
    if (sq.traitor === 0 && sq.hero != null && sq.loyalty < 40 && ((sim.tick + sq.id) % 2 === 0)) sq.traitor = sim.t + 0.5;
  }
  if (id === 'feint') {
    const foe = sim.squads.find((q) => q.id === sq.engaged);
    if (foe) { foe.buffs.exposed = 8; foe.chase = sq.id; }
    const home = nearestOwnedPost(sim, sq);
    sq.engaged = null; sq.buffs.feint = 3;
    if (home && home.id != null) routeTo(sim, sq, home.id);
  }
  if (id === 'fortify') { const p = sim.field.posts[tgt.id]; p.fort = { side, t: 15 }; x = p.x; y = p.y; }
  if (id === 'landslide') {
    const [a, b] = sim.field.edges[tgt.id];
    x = (sim.field.posts[a].x + sim.field.posts[b].x) / 2; y = (sim.field.posts[a].y + sim.field.posts[b].y) / 2;
    mapEvent(sim, tgt.id, rockKind(sim, tgt.id));
  }
  ev(sim, { k: 'strat', id, side, x, y, target: tgt.id, tkind: tgt.kind });
  return true;
}
function rockKind(sim, edge) {
  const spot = (sim.field.eventSpots || []).find((s) => s.edge === edge);
  if (spot) return spot.kind;
  return sim.field.underground ? 'collapse' : 'landslide';
}

// the land changes: a path is cut and anyone on it is hurt
export function mapEvent(sim, edge, kind) {
  if (sim.field.blocked.includes(edge)) return;
  sim.field.blocked.push(edge);
  const [a, b] = sim.field.edges[edge];
  const A = sim.field.posts[a], B = sim.field.posts[b];
  for (const s of sim.squads) {
    if (!alive(s)) continue;
    const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((s.x - A.x) * dx + (s.y - A.y) * dy) / L));
    const d = Math.hypot(A.x + dx * t - s.x, A.y + dy * t - s.y);
    if (d < 1.6 && t > 0.15 && t < 0.85) { hitSquad(sim, s, kind === 'flood' ? 18 : 30, null, true); s.morale -= 15; }
    if (s.goal != null && s.state !== 'rout') routeTo(sim, s, s.goal);
  }
  ev(sim, { k: 'mapEvent', kind, edge, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
}

// ---------- tick ----------
export function step(sim) {
  if (sim.winner) return;
  sim.t += DT; sim.tick++;
  const S = sim.squads;
  for (const s of S) {
    if (!alive(s)) continue;
    s.shootCd = Math.max(0, s.shootCd - DT);
    s.formCd = Math.max(0, s.formCd - DT);
    s.special = Math.min(1, s.special + DT / 45);
    for (const k in s.buffs) if (s.buffs[k] > 0) s.buffs[k] -= DT;
    if (s.reform) { s.reform.t += DT; if (s.reform.t >= s.reform.total) { s.formation = s.reform.to; s.reform = null; s.formCd = 4; ev(sim, { k: 'formed', id: s.id }); } }
    if (s.engaged) { const e = S.find((q) => q.id === s.engaged); if (!e || !alive(e) || dist(s, e) > MELEE + 0.6) s.engaged = null; }
    if (s.traitor > 0 && sim.t >= s.traitor) {
      s.traitor = -1; s.side = other(s.side); s.path = []; s.chase = null; s.engaged = null; s.morale = 90; s.turncoat = true; s.state = 'hold';
      for (const q of S) if (q.side === other(s.side) && alive(q)) q.morale -= 18;
      ev(sim, { k: 'treachery', id: s.id, side: s.side });
    }
  }
  for (const p of sim.field.posts) if (p.fort && (p.fort.t -= DT) <= 0) p.fort = null;
  for (const f of sim.fires) {
    f.t -= DT;
    if (sim.tick % 10 === 0) for (const s of S) if (alive(s) && Math.hypot(s.x - f.x, s.y - f.y) < f.r) { hitSquad(sim, s, f.pow * Math.max(3, liveCount(s)) * 0.5, null, true); s.morale -= 2; }
  }
  sim.fires = sim.fires.filter((f) => f.t > 0);
  if (sim.fog > 0) sim.fog -= DT;
  if (sim.t >= sim.nextEvent && sim.eventsLeft > 0) {
    sim.eventsLeft--; sim.nextEvent = sim.t + 50 + ((sim.seed + sim.tick) % 40);
    const spots = (sim.field.eventSpots || []).filter((s) => !sim.field.blocked.includes(s.edge) && !touchesCamp(sim, s.edge));
    if (spots.length) { const sp = spots[(sim.seed + sim.tick) % spots.length]; mapEvent(sim, sp.edge, sp.kind); }
    else { sim.fog = 30; ev(sim, { k: 'fog' }); }
  }
  for (const s of S) {
    if (!alive(s)) continue;
    const f = FORMATIONS[s.formation];
    if (buff(s, 'confused')) { s.state = 'confused'; continue; }
    let speed = s.spd * f.spd * 2.1 * (0.75 + 0.25 * s.morale / 100) * (s.reform ? 0.5 : 1) * (buff(s, 'march') ? 1.6 : 1);
    if (s.state === 'rout') {
      speed *= 1.15;
      const home = nearestOwnedPost(sim, s);
      if (home && dist(s, home) > 1.2) moveToward(s, home, speed);
      s.morale += DT * (home && dist(s, home) < 2 ? 9 : 2.5);
      if (s.morale >= 45) { s.state = 'hold'; s.path = []; }
      continue;
    }
    let foe = null, fd = 1e9;
    for (const e of S) if (e.side !== s.side && alive(e)) { const d = dist(s, e); if (d < fd) { fd = d; foe = e; } }
    if (s.chase) { const c = S.find((q) => q.id === s.chase); if (!c || !alive(c) || c.side === s.side) s.chase = null; else { foe = c; fd = dist(s, c); } }
    if (buff(s, 'feint') && s.path.length) { const wp = s.path[0]; if (dist(s, wp) < 1.3) s.path.shift(); else moveToward(s, wp, speed * 1.2); s.state = 'move'; continue; }
    if (foe && fd < MELEE) { s.engaged = foe.id; s.state = 'fight'; face(s, foe); continue; }
    const range = RANGE * (sim.fog > 0 ? 0.6 : 1);
    if (s.ranged && foe && fd < range && (s.state !== 'move' || s.chase)) {
      face(s, foe); s.state = 'shoot';
      if (s.shootCd <= 0 && !s.reform) { shoot(sim, s, foe); s.shootCd = 1.1; }
      continue;
    }
    if (s.chase && foe) { moveToward(s, foe, speed); s.state = 'move'; continue; }
    if (s.path.length) {
      const wp = s.path[0];
      if (dist(s, wp) < (s.path.length === 1 ? 1.3 : 0.6)) s.path.shift();
      else moveToward(s, wp, speed);
      s.state = 'move';
      if (foe && fd < 2.0 && !s.ranged) s.chase = foe.id;
      continue;
    }
    if (foe && fd < SIGHT) { if (s.ranged) s.state = 'hold'; else { moveToward(s, foe, speed); s.state = 'move'; } continue; }
    if (s.state === 'move' || s.state === 'fight' || s.state === 'shoot' || s.state === 'confused') s.state = 'hold';
  }
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i], b = S[j]; if (!alive(a) || !alive(b)) continue;
    const big = Math.min(1.4, (Math.sqrt(liveCount(a)) + Math.sqrt(liveCount(b))) * 0.12);
    const d = dist(a, b), min = (a.side === b.side ? 1.6 + big : 1.0 + big * 0.4);
    if (d < min && d > 0.001) { const push = (min - d) * 0.25, ux = (a.x - b.x) / d, uy = (a.y - b.y) / d; a.x += ux * push; a.y += uy * push; b.x -= ux * push; b.y -= uy * push; }
  }
  const W = sim.field.W, H = sim.field.H;
  for (const s of S) { s.x = Math.max(0.8, Math.min(W - 0.8, s.x)); s.y = Math.max(1.2, Math.min(H - 0.8, s.y)); }
  for (const s of S) {
    if (s.state !== 'fight' || !s.engaged) continue;
    const e = S.find((q) => q.id === s.engaged); if (!e || !alive(e)) continue;
    let dmg = 0;
    for (const so of s.soldiers) if (so.alive) dmg += so.atk;
    if (s.heroAlive) dmg += s.heroAtk;
    if (s.ranged) dmg *= 0.6;
    const fa = FORMATIONS[s.formation], fb = FORMATIONS[e.formation];
    dmg *= s.atkMul * fa.atk * formationEdge(s.formation, e.formation) * (0.6 + 0.4 * s.morale / 100) * 0.055 * DT;
    if (s.reform) dmg *= 0.75;
    if (buff(s, 'warcry')) dmg *= 1.15;
    if (fb.arrowGuard) dmg *= 1.1;
    if (e.state === 'rout') dmg *= 1.3;
    hitSquad(sim, e, dmg, s);
    if (liveCount(s) === 0 && !s.heroAlive) s.state = 'dead';
  }
  for (const tr of sim.field.traps || []) {
    for (const s of S) if (fighting(s) && Math.hypot(s.x - tr.x, s.y - tr.y) < 0.9 && sim.tick % 20 === 0) { hitSquad(sim, s, 3, null, true); ev(sim, { k: 'trap', x: tr.x, y: tr.y }); }
  }
  for (const p of sim.field.posts) {
    let att = 0, def = 0;
    for (const s of S) if (fighting(s) && Math.hypot(s.x - p.x, s.y - p.y) < CAP_R) { if (s.side === 'att') att++; else def++; }
    const rate = p.main ? 0.075 : 0.16;
    const contest = (side, n) => {
      if (p.owner === side) { p.prog = Math.max(0, p.prog - DT * 0.3); return; }
      if (p.by !== side) { p.by = side; p.prog = 0; }
      p.prog += DT * rate * Math.min(3, n);
      if (p.prog >= 1) {
        p.owner = side; p.prog = 0; p.by = null; p.fort = null;
        ev(sim, { k: 'capture', post: p.id, side });
        for (const s of S) if (alive(s)) s.morale = Math.max(0, Math.min(100, s.morale + (s.side === side ? 8 : -8)));
        if (p.main && side === 'att') { sim.winner = 'att'; ev(sim, { k: 'end' }); }
      }
    };
    if (att && !def) contest('att', att);
    else if (def && !att) contest('def', def);
    else if (!att && !def) p.prog = Math.max(0, p.prog - DT * 0.2);
  }
  for (const s of S) if (fighting(s) && s.morale < 12) { s.state = 'rout'; s.path = []; s.chase = null; s.engaged = null; s.reform = null; ev(sim, { k: 'rout', id: s.id }); }
  for (const side of ['att', 'def']) {
    const mine = S.filter((s) => s.side === side && alive(s));
    if (!mine.length) { sim.winner = other(side); ev(sim, { k: 'end' }); return; }
    const allRout = mine.every((s) => s.state === 'rout');
    sim.routTimer[side] = allRout ? sim.routTimer[side] + DT : 0;
    if (sim.routTimer[side] > 10) { sim.winner = other(side); ev(sim, { k: 'end' }); return; }
  }
  if (sim.t >= TIME_LIMIT) { sim.winner = 'def'; ev(sim, { k: 'end', timeout: true }); }
}

function nearestOwnedPost(sim, s) {
  let best = null, bd = 1e9;
  for (const p of sim.field.posts) if (p.owner === s.side) { const d = dist(s, p); if (d < bd) { bd = d; best = p; } }
  return best || { x: s.side === 'att' ? 1 : sim.field.W - 1, y: s.y, id: null };
}
function moveToward(s, t, speed) {
  const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const m = Math.min(d, speed * DT);
  s.x += dx / d * m; s.y += dy / d * m;
  s.dir = Math.atan2(dy, dx);
}
function face(s, t) { s.dir = Math.atan2(t.y - s.y, t.x - s.x); }

function shoot(sim, s, foe) {
  let dmg = 0;
  for (const so of s.soldiers) if (so.alive) dmg += so.atk;
  const f = FORMATIONS[s.formation], fb = FORMATIONS[foe.formation];
  dmg *= s.atkMul * (f.ranged || 1) * (fb.arrowGuard || 1) * (0.6 + 0.4 * s.morale / 100) * 0.07;
  if (buff(foe, 'smoke')) dmg *= 0.3;
  ev(sim, { k: 'shot', from: s.id, to: foe.id });
  if (sim.ai[foe.side] && !foe.ranged && !foe.chase && foe.state !== 'rout' && foe.state !== 'fight') foe.chase = s.id;
  hitSquad(sim, foe, dmg, s);
}

function hitSquad(sim, e, dmg, src, raw) {
  const n = liveCount(e);
  if (n === 0) { damageHero(sim, e, dmg); return; }
  let defAvg = 0;
  for (const so of e.soldiers) if (so.alive) defAvg += so.def;
  defAvg = (defAvg / n) * e.defMul * FORMATIONS[e.formation].def * (e.reform ? 0.8 : 1) * (buff(e, 'exposed') ? 0.7 : 1);
  if (!raw) dmg = dmg / (1 + defAvg * 0.11);
  if (sim.field.posts.some((p) => p.fort && p.fort.side === e.side && Math.hypot(p.x - e.x, p.y - e.y) < CAP_R + 0.5)) dmg *= 0.6;
  if (dmg >= 1.5) ev(sim, { k: 'hit', id: e.id, d: Math.round(dmg) });
  let left = dmg;
  for (const so of e.soldiers) {
    if (!so.alive) continue;
    const d = Math.min(left, so.hp);
    damageSoldier(sim, e, so, d, src);
    left -= d;
    if (left <= 0.0001) break;
  }
  if (left > 0) damageHero(sim, e, left);
}

function damageSoldier(sim, e, so, d, src) {
  so.hp -= d;
  if (so.hp <= 0 && so.alive) {
    so.alive = false;
    ev(sim, { k: 'die', id: e.id, idx: so.idx, elite: so.s === 3 ? so.name : null });
    e.morale -= 55 / Math.max(5, e.soldiers.length) * (so.s === 3 ? 3 : 1);
    if (src) { src.morale = Math.min(100, src.morale + 2.5); src.special = Math.min(1, src.special + 0.02); }
  }
}
function damageHero(sim, e, d) {
  if (!e.heroAlive) { if (liveCount(e) === 0) e.state = 'dead'; return; }
  e.heroHp -= d;
  if (e.heroHp <= 0) { e.heroAlive = false; e.state = 'dead'; ev(sim, { k: 'heroDown', id: e.id }); for (const q of sim.squads) if (q.side === e.side && alive(q)) q.morale -= 15; }
}

// ---------- AI ----------
const COUNTER = { line: 'wedge', square: 'line', wedge: 'square', loose: 'wedge' };
export function aiThink(sim, side) {
  if (sim.tick % 10 !== 0 || sim.winner) return;
  const S = sim.squads.filter((s) => s.side === side && fighting(s));
  const enemies = sim.squads.filter((s) => s.side !== side && alive(s));
  const posts = sim.field.posts;
  aiStratagems(sim, side, S, enemies);
  for (const s of S) {
    if (s.special >= 1 && enemies.some((e) => dist(e, s) < 6)) castSpecial(sim, s);
    const near = enemies.filter((e) => dist(e, s) < 4.5).sort((a, b) => dist(a, s) - dist(b, s))[0];
    if (near && !s.reform && s.formCd <= 0 && COUNTER[near.formation] !== s.formation && !s.ranged && (sim.tick / 10 + s.id) % 3 === 0) changeFormation(sim, s, COUNTER[near.formation]);
    if (buff(s, 'confused') || buff(s, 'feint')) continue;
    if (s.state === 'fight' || s.state === 'shoot') continue;
    if (side === 'att') {
      if (near && !s.ranged) { if (s.chase !== near.id) command(sim, side, { type: 'chase', squad: s.id, target: near.id }); continue; }
      if (s.path.length && !(s.goal != null && posts[s.goal].owner === 'att' && dist(s, posts[s.goal]) < 3)) continue;
      const targets = posts.filter((p) => p.owner !== 'att');
      const outs = targets.filter((p) => !p.main);
      const pool = outs.length && sim.t < 70 ? outs : targets;
      const tgt = pool.sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (tgt) routeTo(sim, s, tgt.id);
    } else {
      // defenders take the fight to the enemy: hunt squads near our land (ranged harassers first), retake lost posts
      const guard = s.hero == null;
      const home = posts[s.home];
      const threats = enemies.filter((e) => e.state !== 'rout' && posts.some((p) => p.owner === 'def' && dist(e, p) < 8));
      threats.sort((a, b) => (b.ranged - a.ranged) || (dist(a, s) - dist(b, s)));
      let tgt = threats[0];
      if (guard) tgt = enemies.filter((e) => dist(e, home) < 7).sort((a, b) => dist(a, s) - dist(b, s))[0];
      else if (!tgt) {
        const lone = enemies.filter((e) => e.state !== 'rout').sort((a, b) => liveCount(a) - liveCount(b))[0];
        if (lone && liveCount(lone) < liveCount(s) * 1.1 && dist(lone, s) < 18) tgt = lone;
      }
      if (tgt) { if (!s.ranged && s.chase !== tgt.id) command(sim, side, { type: 'chase', squad: s.id, target: tgt.id }); continue; }
      const lost = posts.filter((p) => p.owner !== 'def' && !p.camp).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (lost && !guard && !s.path.length) { routeTo(sim, s, lost.id); continue; }
      if (dist(s, home) > 2 && !s.path.length) routeTo(sim, s, home.id);
    }
  }
}

function aiStratagems(sim, side, mine, enemies) {
  const st = sim.strat[side];
  if (!st.list.length || sim.t < 8 || (sim.tick / 10) % 3 !== 0) return;
  for (const slot of st.list) {
    if (slot.used || STRATAGEMS[slot.id].cost > st.pool) continue;
    const id = slot.id;
    let target = null;
    if (id === 'rally' && mine.filter((s) => s.morale < 35).length >= Math.max(1, mine.length / 2)) target = { kind: 'army' };
    if (id === 'ambush') { const e = enemies.find((x) => x.state === 'fight' && liveCount(x) >= 4); if (e) target = { kind: 'squad', id: e.id }; }
    if (id === 'fire' || id === 'confuse' || id === 'discord') { const e = enemies.filter((x) => x.state !== 'rout').sort((a, b) => liveCount(b) - liveCount(a))[0]; if (e && mine.some((m) => dist(m, e) < 7)) target = { kind: 'squad', id: e.id }; }
    if (id === 'march' || id === 'warcry') { const m = mine.find((x) => x.state === 'move' && (id !== 'warcry' || x.heroAlive)); if (m) target = { kind: 'squad', id: m.id }; }
    if (id === 'smoke') { const m = mine.find((x) => enemies.some((e) => e.ranged && dist(e, x) < RANGE)); if (m) target = { kind: 'squad', id: m.id }; }
    if (id === 'fortify') { const p = sim.field.posts.find((q) => q.owner === side && enemies.some((e) => dist(e, q) < 4)); if (p) target = { kind: 'post', id: p.id }; }
    if (id === 'feint') { const m = mine.find((x) => x.state === 'fight' && x.morale < 35); if (m) target = { kind: 'squad', id: m.id }; }
    if (id === 'landslide') {
      const hit = stratagemTargets(sim, side, id).find((o) => { const [a, b] = sim.field.edges[o.id]; const A = sim.field.posts[a], B = sim.field.posts[b]; return enemies.some((e) => Math.hypot((A.x + B.x) / 2 - e.x, (A.y + B.y) / 2 - e.y) < 2.5); });
      if (hit) target = hit;
    }
    if (target && useStratagem(sim, side, id, target)) return;
  }
}

// ---------- results ----------
export function battleResult(sim) {
  const heroes = {};
  const treachery = [];
  for (const s of sim.squads) {
    if (s.hero == null) continue;
    heroes[s.hero] = { alive: s.soldiers.filter((x) => x.alive).map((x) => x.idx), defeated: !s.heroAlive };
    if (s.turncoat) treachery.push(s.hero);
  }
  return { winner: sim.winner, heroes, retreated: sim.retreat, treachery };
}

// ---------- network snapshot ----------
export function snapshot(sim) {
  return {
    t: sim.t, w: sim.winner, r: sim.retreat, fog: sim.fog,
    p: sim.field.posts.map((p) => [p.owner, Math.round(p.prog * 100), p.by, p.fort ? p.fort.side : 0]),
    b: sim.field.blocked.slice(),
    f: sim.fires.map((f) => [+f.x.toFixed(1), +f.y.toFixed(1), +f.t.toFixed(1), f.r]),
    st: { att: [sim.strat.att.pool, sim.strat.att.list.map((x) => (x.used ? 1 : 0))], def: [sim.strat.def.pool, sim.strat.def.list.map((x) => (x.used ? 1 : 0))] },
    s: sim.squads.map((s) => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.dir.toFixed(2), s.state, s.formation, Math.round(s.morale), +s.special.toFixed(2),
      s.heroAlive ? Math.round(s.heroHp) : -1, s.soldiers.map((x) => (x.alive ? Math.max(1, Math.round(x.hp)) : 0)), s.goal ?? -1,
      s.reform ? [s.reform.to, +(s.reform.t / s.reform.total).toFixed(2)] : 0, Object.keys(s.buffs).filter((k) => s.buffs[k] > 0).join(','), s.side]),
    e: sim.events.slice(-50),
  };
}
export function applySnapshot(sim, snap) {
  sim.t = snap.t; sim.winner = snap.w; sim.retreat = snap.r; sim.fog = snap.fog || 0;
  snap.p.forEach((q, i) => { const p = sim.field.posts[i]; p.owner = q[0]; p.prog = q[1] / 100; p.by = q[2]; p.fort = q[3] ? { side: q[3], t: 1 } : null; });
  sim.field.blocked = snap.b || [];
  sim.fires = (snap.f || []).map((f) => ({ x: f[0], y: f[1], t: f[2], r: f[3] }));
  if (snap.st) for (const side of ['att', 'def']) { sim.strat[side].pool = snap.st[side][0]; snap.st[side][1].forEach((u, i) => { if (sim.strat[side].list[i]) sim.strat[side].list[i].used = !!u; }); }
  for (const q of snap.s) {
    const s = sim.squads.find((x) => x.id === q[0]); if (!s) continue;
    s.x = q[1]; s.y = q[2]; s.dir = q[3]; s.state = q[4]; s.formation = q[5]; s.morale = q[6]; s.special = q[7];
    s.heroAlive = q[8] >= 0; if (q[8] >= 0) s.heroHp = q[8];
    q[9].forEach((hp, i) => { const so = s.soldiers[i]; if (!so) return; so.alive = hp > 0; if (hp > 0) so.hp = hp; });
    s.goal = q[10] >= 0 ? q[10] : null;
    s.reform = q[11] ? { to: q[11][0], t: q[11][1], total: 1 } : null;
    s.buffs = {}; if (q[12]) for (const k of q[12].split(',')) s.buffs[k] = 1;
    s.side = q[13] || s.side;
  }
  for (const e of snap.e) if (e.seq > sim.evSeq) { sim.events.push(e); sim.evSeq = e.seq; }
}

export { unitName };
