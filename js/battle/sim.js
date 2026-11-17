// Real-time battle simulation (fixed 20 Hz). Pure data, so the host can stream it to a peer.
import { makeRng } from '../engine/rng.js';
import { soldierStats, isRanged, heroTotals, formationEdge, FORMATIONS, unitName } from '../game/rules.js';
import { makeField, shortestPath, nearestPost, BW, BH } from './field.js';

export const DT = 0.05;
const MELEE = 1.25, RANGE = 5.2, SIGHT = 5.5, CAP_R = 2.4, TIME_LIMIT = 240;

// heroes: arrays of hero objects; items for gear lookup
export function createBattle({ seed, biome, level, attackers, defenders, attFid, defFid, items, garrison }) {
  const rng = makeRng(seed);
  const field = makeField(seed, biome, 4 + Math.min(2, Math.floor((attackers.length + defenders.length) / 3)));
  const sim = { seed, t: 0, tick: 0, field, squads: [], winner: null, events: [], evSeq: 0, attFid, defFid, level, retreat: null, routTimer: { att: 0, def: 0 } };
  let sid = 1;
  const mk = (side, hero, fid, unit, troops, formation, post, slot) => {
    const t = hero ? heroTotals(hero, items) : { atk: 1, def: 1 + level, lead: 6, int: 0, morale: 0, spd: 0 };
    const soldiers = troops.map((tr, i) => { const st = soldierStats(fid, unit, tr); return { idx: i, s: tr.s, r: tr.r, hp: st.hp, max: st.hp, alive: true }; });
    const st1 = soldierStats(fid, unit, { s: 1, r: 0 });
    const p = field.posts[post];
    const ang = rng() * Math.PI * 2;
    const sq = {
      id: sid++, side, hero: hero ? hero.id : null, name: hero ? hero.name : 'Town Guard', fid, unit, gender: hero ? hero.gender : 'm',
      formation: formation || 'line', x: p.x + Math.cos(ang) * slot, y: p.y + Math.sin(ang) * slot, dir: side === 'att' ? 0 : Math.PI,
      soldiers, ranged: isRanged(fid, unit),
      heroHp: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroMax: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroAlive: !!hero,
      atkMul: 1 + t.atk * 0.045, defMul: 1 + t.def * 0.04, heroAtk: hero ? 2.5 + t.atk * 0.6 : 0, int: t.int,
      spd: st1.spd * (1 + (t.spd || 0)), morale: Math.min(100, (hero ? hero.morale : 60) + (t.morale || 0)),
      special: 0.25, spell: hero ? hero.spell : null, home: post,
      state: 'idle', path: [], goal: null, chase: null, engaged: null, shootCd: 0, lastShot: null, ai: null,
    };
    sim.squads.push(sq);
    return sq;
  };
  // attackers gather at camp
  attackers.forEach((h, i) => mk('att', h, h.fid, h.unit, h.troops, h.formation, 0, 1 + i * 0.9));
  // defenders: heroes spread over main + outposts, guards on the rest
  const defPosts = field.posts.filter((p) => p.owner === 'def').map((p) => p.id);
  defenders.forEach((h, i) => mk('def', h, h.fid, h.unit, h.troops, h.formation, defPosts[i % defPosts.length], 1 + Math.floor(i / defPosts.length)));
  if (garrison) {
    const g = garrison;
    for (let i = 0; i < g.squads; i++) {
      const troops = Array.from({ length: g.size }, () => ({ s: 1, r: Math.min(2, level), xp: 0 }));
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
function ev(sim, e) { e.seq = ++sim.evSeq; e.t = sim.t; sim.events.push(e); if (sim.events.length > 200) sim.events.splice(0, 100); }

// ---------- commands ----------
export function command(sim, side, c) {
  if (sim.winner) return;
  if (c.type === 'retreat') { if (!sim.retreat) { sim.retreat = side; sim.winner = side === 'att' ? 'def' : 'att'; ev(sim, { k: 'end' }); } return; }
  const s = sim.squads.find((q) => q.id === c.squad);
  if (!s || s.side !== side || !alive(s)) return;
  if (c.type === 'move') {
    const from = nearestPost(sim.field, s.x, s.y);
    s.path = shortestPath(sim.field, from, c.post).map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y }));
    if (s.path.length > 1 && dist(s, s.path[0]) < 2.5) s.path.shift();
    s.goal = c.post; s.chase = null; s.engaged = null;
    if (s.state !== 'rout') s.state = 'move';
  } else if (c.type === 'chase') {
    s.chase = c.target; s.path = []; s.goal = null; if (s.state !== 'rout') s.state = 'move';
  } else if (c.type === 'hold') { s.path = []; s.goal = null; s.chase = null; if (s.state !== 'rout') s.state = 'hold'; }
  else if (c.type === 'formation' && FORMATIONS[c.formation]) { s.formation = c.formation; ev(sim, { k: 'form', id: s.id }); }
  else if (c.type === 'special') castSpecial(sim, s);
}

function castSpecial(sim, s) {
  if (s.special < 1 || !s.heroAlive || s.state === 'rout') return;
  // target: densest enemy squad within reach
  let best = null, bd = 1e9;
  for (const e of sim.squads) if (e.side !== s.side && alive(e)) { const d = dist(s, e); if (d < 8 && d < bd) { bd = d; best = e; } }
  if (!best) return;
  s.special = 0;
  const power = 7 + s.int * 2.2 + s.heroAtk;
  ev(sim, { k: 'spell', spell: s.spell, x: best.x, y: best.y, from: s.id });
  for (const e of sim.squads) {
    if (e.side === s.side || !alive(e)) continue;
    if (dist(e, best) > 2.6) continue;
    for (const so of e.soldiers) if (so.alive) damageSoldier(sim, e, so, power * (0.55 + 0.25 * ((so.idx * 7 + sim.tick) % 10) / 10), s);
    if (liveCount(e) === 0) damageHero(sim, e, power * 0.5);
    e.morale -= 12;
  }
  s.morale = Math.min(100, s.morale + 10);
}

// ---------- tick ----------
export function step(sim) {
  if (sim.winner) return;
  sim.t += DT; sim.tick++;
  const S = sim.squads;
  for (const s of S) {
    if (!alive(s)) continue;
    s.shootCd = Math.max(0, s.shootCd - DT);
    s.special = Math.min(1, s.special + DT / 45);
    if (s.engaged) { const e = S.find((q) => q.id === s.engaged); if (!e || !alive(e) || dist(s, e) > MELEE + 0.6) s.engaged = null; }
  }
  // movement + target acquisition
  for (const s of S) {
    if (!alive(s)) continue;
    const f = FORMATIONS[s.formation];
    let speed = s.spd * f.spd * 2.1 * (0.75 + 0.25 * s.morale / 100);
    if (s.state === 'rout') {
      speed *= 1.15;
      const home = nearestOwnedPost(sim, s);
      if (home && dist(s, home) > 1.2) moveToward(s, home, speed);
      s.morale += DT * (home && dist(s, home) < 2 ? 9 : 2.5);
      if (s.morale >= 45) { s.state = 'hold'; s.path = []; }
      continue;
    }
    // nearest enemy
    let foe = null, fd = 1e9;
    for (const e of S) if (e.side !== s.side && alive(e)) { const d = dist(s, e); if (d < fd) { fd = d; foe = e; } }
    if (s.chase) { const c = S.find((q) => q.id === s.chase); if (!c || !alive(c)) s.chase = null; else { foe = c; fd = dist(s, c); } }
    // melee contact blocks movement
    if (foe && fd < MELEE) { s.engaged = foe.id; s.state = 'fight'; face(s, foe); continue; }
    // ranged squads stop to shoot when not ordered to move
    if (s.ranged && foe && fd < RANGE && (s.state !== 'move' || s.chase)) {
      face(s, foe);
      s.state = 'shoot';
      if (s.shootCd <= 0) { shoot(sim, s, foe); s.shootCd = 1.1; }
      continue;
    }
    if (s.chase && foe) { moveToward(s, foe, speed); s.state = 'move'; continue; }
    if (s.path.length) {
      const wp = s.path[0];
      if (dist(s, wp) < (s.path.length === 1 ? 1.3 : 0.6)) s.path.shift();
      else moveToward(s, wp, speed);
      s.state = 'move';
      // fight back when an enemy is right next to the path
      if (foe && fd < 2.0 && !s.ranged) { s.chase = foe.id; }
      continue;
    }
    // idle/hold: engage nearby enemies, otherwise stay
    if (foe && fd < SIGHT) { if (s.ranged) { s.state = 'hold'; } else { moveToward(s, foe, speed); s.state = 'move'; } continue; }
    if (s.state === 'move' || s.state === 'fight' || s.state === 'shoot') s.state = 'hold';
  }
  // separation so squads don't stack
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i], b = S[j]; if (!alive(a) || !alive(b)) continue;
    const d = dist(a, b), min = a.side === b.side ? 1.6 : 1.0;
    if (d < min && d > 0.001) { const push = (min - d) * 0.25, ux = (a.x - b.x) / d, uy = (a.y - b.y) / d; a.x += ux * push; a.y += uy * push; b.x -= ux * push; b.y -= uy * push; }
  }
  for (const s of S) { s.x = Math.max(0.8, Math.min(BW - 0.8, s.x)); s.y = Math.max(1.2, Math.min(BH - 0.8, s.y)); }
  // melee damage
  for (const s of S) {
    if (s.state !== 'fight' || !s.engaged) continue;
    const e = S.find((q) => q.id === s.engaged); if (!e || !alive(e)) continue;
    const n = liveCount(s);
    const st = soldierStats(s.fid, s.unit, { s: 1, r: 0 });
    let dmg = 0;
    for (const so of s.soldiers) if (so.alive) dmg += soldierStats(s.fid, s.unit, so).atk;
    if (s.heroAlive) dmg += s.heroAtk;
    if (s.ranged) dmg *= 0.6;
    const fa = FORMATIONS[s.formation], fb = FORMATIONS[e.formation];
    dmg *= s.atkMul * fa.atk * formationEdge(s.formation, e.formation) * (0.6 + 0.4 * s.morale / 100) * 0.055 * DT;
    if (fb.arrowGuard) dmg *= 1.1;
    hitSquad(sim, e, dmg, s);
    if (n === 0 && !s.heroAlive) s.state = 'dead';
  }
  // traps
  for (const tr of sim.field.traps) {
    for (const s of S) if (fighting(s) && Math.hypot(s.x - tr.x, s.y - tr.y) < 0.9 && sim.tick % 10 === 0) { hitSquad(sim, s, 6, null); ev(sim, { k: 'trap', x: tr.x, y: tr.y }); }
  }
  // posts
  for (const p of sim.field.posts) {
    let att = 0, def = 0;
    for (const s of S) if (fighting(s) && Math.hypot(s.x - p.x, s.y - p.y) < CAP_R) { if (s.side === 'att') att++; else def++; }
    const rate = p.main ? 0.075 : 0.16;
    const contest = (side, n) => {
      if (p.owner === side) { p.prog = Math.max(0, p.prog - DT * 0.3); return; }
      if (p.by !== side) { p.by = side; p.prog = 0; }
      p.prog += DT * rate * Math.min(3, n);
      if (p.prog >= 1) {
        p.owner = side; p.prog = 0; p.by = null;
        ev(sim, { k: 'capture', post: p.id, side });
        for (const s of S) if (alive(s)) s.morale = Math.max(0, Math.min(100, s.morale + (s.side === side ? 8 : -8)));
        if (p.main && side === 'att') { sim.winner = 'att'; ev(sim, { k: 'end' }); }
      }
    };
    if (att && !def) contest('att', att);
    else if (def && !att) contest('def', def);
    else if (!att && !def) p.prog = Math.max(0, p.prog - DT * 0.2);
  }
  // rout + defeat checks
  for (const s of S) if (fighting(s) && s.morale < 12) { s.state = 'rout'; s.path = []; s.chase = null; s.engaged = null; ev(sim, { k: 'rout', id: s.id }); }
  for (const side of ['att', 'def']) {
    const mine = S.filter((s) => s.side === side && alive(s));
    if (!mine.length) { sim.winner = side === 'att' ? 'def' : 'att'; ev(sim, { k: 'end' }); return; }
    const allRout = mine.every((s) => s.state === 'rout');
    sim.routTimer[side] = allRout ? sim.routTimer[side] + DT : 0;
    if (sim.routTimer[side] > 10) { sim.winner = side === 'att' ? 'def' : 'att'; ev(sim, { k: 'end' }); return; }
  }
  if (sim.t >= TIME_LIMIT) { sim.winner = 'def'; ev(sim, { k: 'end', timeout: true }); }
}

function nearestOwnedPost(sim, s) {
  let best = null, bd = 1e9;
  for (const p of sim.field.posts) if (p.owner === s.side) { const d = dist(s, p); if (d < bd) { bd = d; best = p; } }
  return best || { x: s.side === 'att' ? 1 : BW - 1, y: s.y };
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
  for (const so of s.soldiers) if (so.alive) dmg += soldierStats(s.fid, s.unit, so).atk;
  const f = FORMATIONS[s.formation], fb = FORMATIONS[foe.formation];
  dmg *= s.atkMul * (f.ranged || 1) * (fb.arrowGuard || 1) * (0.6 + 0.4 * s.morale / 100) * 0.07;
  ev(sim, { k: 'shot', from: s.id, to: foe.id });
  // computer-run squads charge whoever shoots them
  if (sim.ai && sim.ai[foe.side] && !foe.ranged && !foe.chase && foe.state !== 'rout' && foe.state !== 'fight') foe.chase = s.id;
  hitSquad(sim, foe, dmg, s);
}

function hitSquad(sim, e, dmg, src) {
  const n = liveCount(e);
  if (n === 0) { damageHero(sim, e, dmg); return; }
  const defAvg = soldierStats(e.fid, e.unit, { s: 1, r: 0 }).def * e.defMul * FORMATIONS[e.formation].def;
  dmg = dmg / (1 + defAvg * 0.11);
  // spread over the front soldiers
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
    ev(sim, { k: 'die', id: e.id, idx: so.idx });
    e.morale -= 55 / Math.max(5, e.soldiers.length);
    if (src) { src.morale = Math.min(100, src.morale + 2.5); src.special = Math.min(1, src.special + 0.02); }
  }
}
function damageHero(sim, e, d) {
  if (!e.heroAlive) { if (liveCount(e) === 0) e.state = 'dead'; return; }
  e.heroHp -= d;
  if (e.heroHp <= 0) { e.heroAlive = false; e.state = 'dead'; ev(sim, { k: 'heroDown', id: e.id }); for (const q of sim.squads) if (q.side === e.side && alive(q)) q.morale -= 15; }
}

// ---------- AI ----------
export function aiThink(sim, side) {
  if (sim.tick % 10 !== 0 || sim.winner) return;
  const S = sim.squads.filter((s) => s.side === side && fighting(s));
  const enemies = sim.squads.filter((s) => s.side !== side && alive(s));
  const posts = sim.field.posts;
  for (const s of S) {
    if (s.special >= 1 && enemies.some((e) => dist(e, s) < 6)) castSpecial(sim, s);
    if (s.state === 'fight' || s.state === 'shoot') continue;
    if (side === 'att') {
      const near = enemies.filter((e) => dist(e, s) < 4.5).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (near && !s.ranged) { if (s.chase !== near.id) command(sim, side, { type: 'chase', squad: s.id, target: near.id }); continue; }
      if (s.path.length && !(s.goal != null && posts[s.goal].owner === 'att' && dist(s, posts[s.goal]) < 3)) continue;
      // next post to take: nearest not owned, main last unless it's all that's left
      const targets = posts.filter((p) => p.owner !== 'att');
      const outs = targets.filter((p) => !p.main);
      const pool = outs.length && sim.t < 70 ? outs : targets;
      const tgt = pool.sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (tgt) command(sim, side, { type: 'move', squad: s.id, post: tgt.id });
    } else {
      // defend: engage attackers that come near any of our posts, else go home / retake
      const threats = enemies.filter((e) => posts.some((p) => p.owner === 'def' && dist(e, p) < 6.5));
      const near = (threats.length ? threats : enemies.filter((e) => dist(e, s) < 5)).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (near && (dist(near, s) < 9 || s.hero) && !(s.hero == null && dist(near, posts[s.home]) > 7)) {
        if (!s.ranged && s.chase !== near.id) command(sim, side, { type: 'chase', squad: s.id, target: near.id });
        continue;
      }
      const home = posts[s.home];
      if (home.owner !== 'def' && !s.path.length) { command(sim, side, { type: 'move', squad: s.id, post: home.id }); continue; }
      if (dist(s, home) > 2 && !s.path.length) command(sim, side, { type: 'move', squad: s.id, post: home.id });
    }
  }
}

// ---------- results ----------
export function battleResult(sim) {
  const heroes = {};
  for (const s of sim.squads) {
    if (s.hero == null) continue;
    heroes[s.hero] = { alive: s.soldiers.filter((x) => x.alive).map((x) => x.idx), defeated: !s.heroAlive };
  }
  return { winner: sim.winner, heroes, retreated: sim.retreat };
}

// ---------- network snapshot ----------
export function snapshot(sim) {
  return {
    t: sim.t, w: sim.winner, r: sim.retreat,
    p: sim.field.posts.map((p) => [p.owner, Math.round(p.prog * 100), p.by]),
    s: sim.squads.map((s) => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.dir.toFixed(2), s.state, s.formation, Math.round(s.morale), +s.special.toFixed(2), s.heroAlive ? Math.round(s.heroHp) : -1, s.soldiers.map((x) => (x.alive ? Math.max(1, Math.round(x.hp)) : 0)), s.goal ?? -1]),
    e: sim.events.slice(-40),
  };
}
export function applySnapshot(sim, snap) {
  sim.t = snap.t; sim.winner = snap.w; sim.retreat = snap.r;
  snap.p.forEach((q, i) => { const p = sim.field.posts[i]; p.owner = q[0]; p.prog = q[1] / 100; p.by = q[2]; });
  for (const q of snap.s) {
    const s = sim.squads.find((x) => x.id === q[0]); if (!s) continue;
    s.px = s.x; s.py = s.y;
    s.x = q[1]; s.y = q[2]; s.dir = q[3]; s.state = q[4]; s.formation = q[5]; s.morale = q[6]; s.special = q[7];
    s.heroAlive = q[8] >= 0; if (q[8] >= 0) s.heroHp = q[8];
    q[9].forEach((hp, i) => { const so = s.soldiers[i]; if (!so) return; so.alive = hp > 0; if (hp > 0) so.hp = hp; });
    s.goal = q[10] >= 0 ? q[10] : null;
  }
  for (const e of snap.e) if (e.seq > sim.evSeq) { sim.events.push(e); sim.evSeq = e.seq; }
}

export { unitName };
