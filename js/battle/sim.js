// Real-time battle simulation (fixed 20 Hz). Pure data, so the host can stream it to a peer.
// Squads move along post-to-post routes, fight in formations, use stratagems; the land itself can change mid-battle.
import { makeRng } from '../engine/rng.js';
import {
  soldierStats, isRanged, heroTotals, formationEdge, FORMATIONS, formationChangeTime, STRATAGEMS, unitClass,
} from '../game/rules.js';
import { makeField, shortestPath, nearestPost, terrainAt, passable, nearestRoadPoint, BW, BH, TERRAIN } from './field.js';

// pikes and spears: stop charges cold and punish horsemen
const PIKES = { castle: [0], orcs: [3], dwarves: [2], rampart: [1], stronghold: [3] };
const isPike = (fid, ui) => (PIKES[fid] || []).includes(ui);
// hero callings in battle: an active skill on a cooldown
export const SKILLS = {
  commander: { name: 'Rally Cry', cd: 40, desc: 'Morale +25 for this squad and nearby allies; routing squads recover.' },
  duelist: { name: 'Challenge', cd: 55, desc: 'Call out the nearest enemy hero to a duel (you have the edge).' },
  strategist: { name: 'Read the Field', cd: 50, desc: '+3 command points and enemy routes are revealed for 15s.' },
  scout: { name: 'Scout Ahead', cd: 45, desc: 'Lifts the fog, reveals traps and the squad moves 50% faster for 10s.' },
};

// every troop type has one drill of its own: a button in the selection panel, on a cooldown (the AI uses them too)
export const ABILITIES = {
  charge: { name: 'Charge', btn: 'Charge', cd: 26, desc: 'Draw a lane: the riders thunder along it, smashing and scattering every squad in the way. Disordered for a few seconds after.' },
  brace: { name: 'Brace Pikes', btn: 'Brace', cd: 22, desc: 'Plant the pikes for 8s: charges break on them and horsemen are punished, but the squad stands still.' },
  fire: { name: 'Fire Arrows', btn: 'Fire', cd: 30, desc: '8s of burning volleys: harder hits that set the ground alight (weak in storms).' },
  shields: { name: 'Shield Wall', btn: 'Shields', cd: 24, desc: 'Lock shields for 10s: arrows barely hurt and melee hurts less, but the squad crawls.' },
  blast: { name: 'Arcane Blast', btn: 'Blast', cd: 32, desc: 'Strike the nearest enemy (and anyone beside it) with raw magic.' },
  roar: { name: 'Roar', btn: 'Roar', cd: 28, desc: 'Terrify enemies close by: their morale drops and the faint-hearted panic.' },
  dive: { name: 'Dive', btn: 'Dive', cd: 24, desc: 'Swoop over walls and rivers onto the nearest archers (or nearest foe) and hit hard.' },
};
function abilityOf(s) {
  if (s.mounted) return 'charge';
  if (s.pike) return 'brace';
  const c = unitClass(s.fid, s.unit);
  if (s.ranged || c === 'ranged') return 'fire';
  if (c === 'caster') return 'blast';
  if (c === 'beast') return 'roar';
  if (c === 'flying') return 'dive';
  return 'shields';
}
const AMMO = 24; // volleys in the quiver; refilled at your bases
export const CHARGE_LEN = 10; // longest charge lane, in tiles

export const DT = 0.05;
const MELEE = 1.25, RANGE = 5.2, SIGHT = 5.5, CAP_R = 2.4, TIME_LIMIT = 240, HILL_R = 1.9;

export function createBattle(setup) {
  const { seed, biome, level, attackers, defenders, attFid, defFid, items, garrison } = setup;
  const rng = makeRng(seed);
  const n = attackers.length + defenders.length;
  const size = n > 7 ? 'grand' : n > 3 ? 'standard' : 'skirmish';
  const reinf = setup.reinforce || { att: [], def: [] };
  const field = makeField(seed, biome, 4 + Math.min(2, Math.floor(n / 3)), { size, siege: !!setup.siege, level, land: setup.land || null });
  field.W = field.W || BW; field.H = field.H || BH; field.blocked = field.blocked || [];
  const sim = {
    seed, t: 0, tick: 0, field, squads: [], winner: null, events: [], evSeq: 0, attFid, defFid, level, retreat: null,
    routTimer: { att: 0, def: 0 }, fires: [], ai: { att: false, def: false },
    strat: {
      att: { pool: setup.attPool || 6, max: setup.attPool || 6, list: (setup.attLoadout || []).map((id) => ({ id, used: false })) },
      def: { pool: setup.defPool || 6, max: setup.defPool || 6, list: (setup.defLoadout || []).map((id) => ({ id, used: false })) },
    },
    kids: { att: setup.attKid ?? -1, def: setup.defKid ?? -1 },
    rng, lastAction: 0, duel: null, duelCd: 20, duelled: [],
    nextEvent: 55 + rng() * 60, eventsLeft: field.eventSpots && field.eventSpots.length ? 2 : 1, fog: setup.weather === 'fog' ? 9999 : 0,
    // campaign weather carries into the fight: fog shortens sight, blizzards slow and chill, storms ruin archery and douse fires, droughts feed them
    weather: setup.weather || null,
    reveal: { att: 0, def: 0 }, trapsSeen: { att: 0, def: 0 },
    nemesis: Array.isArray(setup.nemesis) ? setup.nemesis.filter((p) => Array.isArray(p) && p.length === 2) : [], nemesisMet: [], nemesisResult: [],
    ladders: [],
    // ~1 in 5 battles is fought at night (or when the campaign says so): short sight, deadly ambushes, torchlight
    night: setup.night != null ? !!setup.night : (Math.imul((seed | 0) ^ 0x5bd1e995, 2654435761) >>> 0) % 100 < 20,
    hills: [], obj: null,
  };
  // siege: gates hold until broken; attackers can't pass an intact gate (defenders sally through it)
  const G = field._grid && field._grid.gates ? field._grid.gates : [];
  field._gates = sim.gates = field.siege ? G.map((g) => ({ cx: g.x, cy: g.y, x: g.x + 0.5, y: g.y + 0.5, hp: 240 + (level || 0) * 110, max: 240 + (level || 0) * 110 })) : [];
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
      formation: FORMATIONS[formation] ? formation : 'line', /* old saves' Loose becomes Line */ x: p.x + Math.cos(ang) * slot, y: p.y + Math.sin(ang) * slot, dir: side === 'att' ? 0 : Math.PI,
      soldiers, ranged: isRanged(fid, unit), lead: t.lead, tags, loyalty: hero ? hero.loyalty : 100,
      heroHp: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroMax: hero ? 40 + hero.level * 8 + t.def * 3 : 0, heroAlive: !!hero,
      atkMul: (1 + t.atk * 0.045) * bonus, defMul: (1 + t.def * 0.04) * bonus, heroAtk: hero ? 2.5 + t.atk * 0.6 : 0, int: t.int,
      spd: st1.spd * (1 + (t.spd || 0)), morale: Math.min(100, (hero ? baseMorale : 55 + level * 5) + (t.morale || 0)),
      special: 0.25, spell: hero ? hero.spell : null, home: post,
      traitor: hero && hero.secret >= 0 && hero.secret === enemyKid ? 25 + rng() * 50 : 0,
      state: 'idle', path: [], goal: null, chase: null, engaged: null, forced: false, holdFast: false, shootCd: 0, reform: null, buffs: {}, formCd: 0,
      queue: [], rally: null, role: hero ? hero.role || null : null, skillCd: hero && hero.role ? 8 : 0, mounted: unitClass(fid, unit) === 'mounted',
      pike: isPike(fid, unit), moveT: 0, ally: false, arriveAt: 0,
      abCd: 5, guard: null, charge: null, dive: null, regroup: 0, revived: 0,
    };
    sq.abil = abilityOf(sq);
    sq.ammoMax = sq.ranged ? AMMO : 0; sq.ammo = sq.ammoMax;
    sim.squads.push(sq);
    return sq;
  };
  attackers.forEach((h, i) => mk('att', h, h.ufid || h.fid, h.unit, h.troops, h.formation, 0, 1 + i * 0.9));
  // a besieged army starts inside its walls; otherwise defenders are spread over their posts
  const defPosts = field.wallRect ? [field.posts.findIndex((p) => p.main)] : field.posts.filter((p) => p.owner === 'def').map((p) => p.id);
  defenders.forEach((h, i) => mk('def', h, h.ufid || h.fid, h.unit, h.troops, h.formation, defPosts[i % defPosts.length], 1 + Math.floor(i / defPosts.length)));
  if (garrison) {
    for (let i = 0; i < garrison.squads; i++) {
      const troops = Array.from({ length: garrison.size }, () => ({ s: 1, r: level > 1 ? 1 : 0, xp: 0 }));
      mk('def', null, defFid, Math.min(i, 2), troops, 'square', defPosts[(i + defenders.length) % defPosts.length], 0.8);
    }
  }
  for (const s of sim.squads) if (s.side === 'def') s.state = 'hold';
  // allied heroes from neighbouring lands march in partway through the fight
  for (const side of ['att', 'def']) (reinf[side] || []).forEach((h, i) => {
    const entry = side === 'att' ? 0 : field.posts.findIndex((p) => p.main);
    const sq = mk(side, h, h.ufid || h.fid, h.unit, h.troops, h.formation, Math.max(0, entry), 1.2);
    sq.ally = true; sq.state = 'reinforce'; sq.arriveAt = 50 + i * 12 + (seed % 15); sq.allyName = h.allyName || 'Allies';
  });
  sim.hills = findHills(field);
  sim.obj = setupObjective(sim, setup);
  return sim;
}

const alive = (s) => s.state !== 'dead' && s.state !== 'reserve' && s.state !== 'reinforce';
const fighting = (s) => alive(s) && s.state !== 'rout';
// the nearest enemy that is locked in melee with one of s's friends, within r: squads jump into fights they come upon
function brawlNear(sim, s, r) {
  let best = null, bd = r;
  for (const f of sim.squads) {
    if (f === s || f.side !== s.side || f.state !== 'fight' || f.engaged == null || !alive(f)) continue;
    const e = sim.squads.find((q) => q.id === f.engaged);
    if (!e || !fighting(e) || e.side === s.side || !visibleTo(sim, s.side, e)) continue;
    const d = dist(s, e); if (d < bd) { bd = d; best = e; }
  }
  return best;
}
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
  if (c.type === 'duel') return duelPick(sim, side, c.pick);
  const s = sim.squads.find((q) => q.id === c.squad);
  if (!s || s.side !== side) return false;
  if (c.type === 'reserve') { if (sim.t > 0.5 || s.ally || s.state === 'dead') return false; s.state = s.state === 'reserve' ? 'idle' : 'reserve'; return true; }
  if (c.type === 'callReserve') return callReserve(sim, s);
  if (!alive(s) || s.ally) return false;
  if (s.state === 'rout') return false;
  // queued orders wait until the current march is done
  if (c.queue && (c.type === 'move' || c.type === 'moveTo') && (s.path.length || s.chase || s.queue.length)) {
    if (s.queue.length < 4) s.queue.push(c.type === 'move' ? { post: c.post } : { x: c.x, y: c.y });
    return true;
  }
  if (c.type === 'skill') return useSkill(sim, s);
  if (c.type === 'ability') return useAbility(sim, s, c);
  if (s.charge || s.dive) return false; // mid-charge: the riders are committed
  if (c.type === 'ladder') { s.queue = []; s.guard = null; s.regroup = 0; return startLadder(sim, s, c.x, c.y); }
  if (s.ladder && s.ladder.phase === 'climb') return false; // halfway up a ladder
  s.ladder = null;
  if (c.type === 'move' || c.type === 'moveTo' || c.type === 'spot') {
    if (!c.queue) s.queue = [];
    const ok = c.type === 'move' ? routeTo(sim, s, c.post, true) : c.type === 'spot' ? routeToSpot(sim, s, c.x, c.y) : routeToPoint(sim, s, c.x, c.y);
    if (ok) { disengage(sim, s); s.guard = null; s.regroup = 0; }
    return ok;
  }
  s.queue = [];
  if (c.type === 'camp') return startRegroup(sim, s);
  if (c.type === 'guard') return setGuard(sim, s, c.x, c.y, c.r);
  if (c.type !== 'formation' && c.type !== 'special') { s.guard = null; s.regroup = 0; }
  if (c.type === 'chase') {
    const t = sim.squads.find((q) => q.id === c.target);
    if (!t || !alive(t) || t.side === s.side) return false;
    if (s.engaged && s.engaged !== t.id) disengage(sim, s);
    s.chase = c.target; s.path = []; s.goal = null; s.forced = true; s.holdFast = false; s.state = 'move'; return true;
  }
  if (c.type === 'hold') { s.path = []; s.goal = null; s.chase = null; s.forced = false; s.holdFast = true; if (s.state !== 'fight') s.state = 'hold'; return true; }
  if (c.type === 'formation' && FORMATIONS[c.formation]) return changeFormation(sim, s, c.formation);
  if (c.type === 'special') return castSpecial(sim, s);
  return false;
}

// Best route from where the squad stands: try the nearest few posts as an entry point onto the road network
// and take the shortest total walk. Returns post ids or null when the target can't be reached.
export function planRoute(sim, s, post) {
  const F = sim.field;
  if (!F.posts[post]) return null;
  if (dist(s, F.posts[post]) < 4) return [post];
  const cands = F.posts.map((p) => ({ p, d: dist(s, p) })).sort((a, b) => a.d - b.d).slice(0, 3);
  let best = null;
  for (const { p, d } of cands) {
    const path = shortestPath(F, p.id, post);
    if (path[path.length - 1] !== post) continue;
    let len = d;
    for (let i = 0; i + 1 < path.length; i++) len += dist(F.posts[path[i]], F.posts[path[i + 1]]);
    if (!best || len < best.len) best = { path, len };
  }
  if (!best) return null;
  const path = best.path.slice();
  // don't walk back to an entry post we're already past
  while (path.length > 1 && dist(s, F.posts[path[1]]) <= dist(F.posts[path[0]], F.posts[path[1]]) + 0.5) path.shift();
  return path;
}
// why an order can't be carried out (for the HUD)
export function routeProblem(sim, s, post) {
  if (planRoute(sim, s, post)) return null;
  return sim.field.blocked.length ? 'The road there has been cut' : 'No road leads there';
}
// spread squads that share a destination into slots around the post instead of one shoving pile
// (all inside the capture ring, so every squad that arrives helps take the post)
const SLOTS = [[0, 0], [1.7, 0.8], [-1.7, 0.8], [1.7, -0.9], [-1.7, -0.9], [0, 1.6], [0, -1.6], [2.2, 0], [-2.2, 0]];
function slotFor(sim, s, post) {
  const p = sim.field.posts[post], F = sim.field;
  // the spots friends bound for the same post already claimed (their last waypoint)
  const taken = sim.squads.filter((q) => q.side === s.side && alive(q) && q.goal === post && q.id !== s.id && q.path.length).map((q) => q.path[q.path.length - 1]);
  let first = null;
  for (const [ox, oy] of SLOTS) {
    const at = { x: Math.max(1, Math.min(F.W - 1, p.x + ox)), y: Math.max(1.4, Math.min(F.H - 1, p.y + oy)) };
    if (!passable(F, at.x, at.y)) continue; // never a slot in the water or a wall: it could not be reached
    if (!first) first = at;
    if (taken.every((t) => Math.hypot(t.x - at.x, t.y - at.y) > 0.8)) return at;
  }
  return first || { x: p.x, y: p.y };
}
function routeTo(sim, s, post, forced) {
  const ids = planRoute(sim, s, post);
  if (!ids) return false;
  const slot = slotFor(sim, s, post);
  s.path = ids.map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y }));
  s.path[s.path.length - 1] = slot;
  s.goal = post; s.chase = null;
  s.forced = !!forced; s.holdFast = false;
  if (forced) s.engaged = null;
  if (s.state !== 'rout') s.state = 'move';
  return true;
}
// march to any point on (or near) a road and hold there: a bridge, a crossroads, an ambush spot
function routeToPoint(sim, s, x, y) {
  const F = sim.field;
  const rp = nearestRoadPoint(F, x, y);
  if (!rp || rp.d > 3) return false;
  const pt = { x: rp.x, y: rp.y };
  let path;
  if (Math.hypot(s.x - pt.x, s.y - pt.y) < 4 || (nearestRoadPoint(F, s.x, s.y) || {}).edge === rp.edge) path = [pt];
  else {
    let best = null;
    for (const end of [rp.a, rp.b]) {
      const ids = planRoute(sim, s, end); if (!ids) continue;
      let len = Math.hypot(F.posts[ids[0]].x - s.x, F.posts[ids[0]].y - s.y) + Math.hypot(F.posts[end].x - pt.x, F.posts[end].y - pt.y);
      for (let i = 0; i + 1 < ids.length; i++) len += Math.hypot(F.posts[ids[i]].x - F.posts[ids[i + 1]].x, F.posts[ids[i]].y - F.posts[ids[i + 1]].y);
      if (!best || len < best.len) best = { ids, len };
    }
    if (!best) return false;
    path = [...best.ids.map((id) => ({ x: F.posts[id].x, y: F.posts[id].y })), pt];
  }
  s.path = path; s.goal = null; s.chase = null; s.rally = pt;
  s.forced = true; s.holdFast = false; s.engaged = null;
  if (s.state !== 'rout') s.state = 'move';
  return true;
}
function nextQueued(sim, s) {
  while (s.queue.length) {
    const q = s.queue.shift();
    const ok = q.post != null ? routeTo(sim, s, q.post, true) : routeToPoint(sim, s, q.x, q.y);
    if (ok) return true;
  }
  return false;
}
function callReserve(sim, s) {
  if (s.state !== 'reserve') return false;
  const F = sim.field;
  const home = s.side === 'att' ? F.posts.find((p) => p.camp) : F.posts.find((p) => p.main && p.owner === 'def') || F.posts.find((p) => p.owner === 'def');
  if (!home) return false;
  s.x = home.x + 0.6; s.y = home.y + 0.6; s.state = 'hold'; s.home = home.id;
  ev(sim, { k: 'reserve', id: s.id, x: s.x, y: s.y });
  return true;
}
function useSkill(sim, s) {
  if (!s.role || !SKILLS[s.role] || s.skillCd > 0 || !s.heroAlive) return false;
  const S = sim.squads;
  if (s.role === 'commander') {
    for (const q of S) if (q.side === s.side && alive(q) && dist(q, s) < 6.5) { q.morale = Math.min(100, q.morale + 25); if (q.state === 'rout' && q.morale > 40) { q.state = 'hold'; q.path = []; } }
  } else if (s.role === 'duelist') {
    if (sim.duel) return false;
    const e = S.filter((q) => q.side !== s.side && alive(q) && q.heroAlive && dist(q, s) < 6).sort((a, b) => dist(a, s) - dist(b, s))[0];
    if (!e) return false;
    // both heroes step out; squads close in
    s.chase = e.id; s.path = [];
    sim.duel = newDuel(s.id, e.id, s.id);
    ev(sim, { k: 'duelStart', a: s.id, b: e.id, x: (s.x + e.x) / 2, y: (s.y + e.y) / 2, challenge: true });
  } else if (s.role === 'strategist') {
    const st = sim.strat[s.side]; st.pool = Math.min(st.max + 3, st.pool + 3); sim.reveal[s.side] = 15;
  } else if (s.role === 'scout') {
    sim.fog = 0; s.buffs.march = Math.max(s.buffs.march || 0, 10); sim.trapsSeen[s.side] = 30;
  }
  s.skillCd = SKILLS[s.role].cd;
  ev(sim, { k: 'skill', id: s.id, role: s.role, side: s.side, x: s.x, y: s.y });
  return true;
}

function disengage(sim, s) {
  if (s.state !== 'fight' && !s.engaged) return;
  s.engaged = null;
  s.morale = Math.max(5, s.morale - 5);
  s.buffs.exposed = Math.max(s.buffs.exposed || 0, 2);
  ev(sim, { k: 'disengage', id: s.id });
}

function changeFormation(sim, s, f) {
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

// ---------- battle tactics: abilities, charges, guard zones, regrouping ----------
function attackOf(s) { let a = 0; for (const so of s.soldiers) if (so.alive) a += so.atk; return a + (s.heroAlive ? s.heroAtk : 0); }
// march to any open spot (off-road too): roads to the nearest base, then across
function routeToSpot(sim, s, x, y) {
  const F = sim.field;
  if (!passable(F, x, y)) return false;
  let path;
  if (Math.hypot(s.x - x, s.y - y) < 6) path = [{ x, y }];
  else {
    const ids = planRoute(sim, s, nearestPost(F, x, y));
    if (!ids) return false;
    path = [...ids.map((id) => ({ x: F.posts[id].x, y: F.posts[id].y })), { x, y }];
  }
  s.path = path; s.goal = null; s.chase = null; s.rally = { x, y };
  s.forced = true; s.holdFast = false; s.engaged = null;
  if (s.state !== 'rout') s.state = 'move';
  return true;
}
// the friendly rear: attackers fall back to their camp, defenders to the keep (or their nearest base)
export function campOf(sim, side) {
  const P = sim.field.posts;
  if (side === 'att') return P.find((p) => p.camp) || P.find((p) => p.owner === 'att') || null;
  return P.find((p) => p.main && p.owner === 'def') || P.find((p) => p.owner === 'def') || null;
}
// guard an area: engage anything that enters it, never chase out of it
function setGuard(sim, s, x, y, r) {
  if (x == null || y == null || !passable(sim.field, x, y)) return false;
  r = Math.max(1.5, Math.min(6, +r || 3));
  s.guard = { x: +x.toFixed(2), y: +y.toFixed(2), r: +r.toFixed(1) };
  s.chase = null; s.holdFast = false; s.regroup = 0;
  if (Math.hypot(s.x - x, s.y - y) > 1) { if (!routeToSpot(sim, s, x, y)) s.path = [{ x, y }]; s.forced = true; s.rally = null; disengage(sim, s); }
  else { s.path = []; s.forced = false; s.rally = null; if (s.state === 'move') s.state = 'hold'; }
  ev(sim, { k: 'guard', id: s.id, side: s.side, x, y, r });
  return true;
}
// fall back to camp to recover morale, arrows and some of the wounded; any new order sends them back out
function startRegroup(sim, s) {
  const camp = campOf(sim, s.side);
  if (!camp) return false;
  if (!routeTo(sim, s, camp.id, true) && Math.hypot(s.x - camp.x, s.y - camp.y) > 3) return false;
  disengage(sim, s);
  s.guard = null; s.rally = null; s.regroup = 1; s.chase = null;
  ev(sim, { k: 'regroup', id: s.id, side: s.side });
  return true;
}
function useAbility(sim, s, c = {}) {
  const k = s.abil, A = ABILITIES[k];
  if (!A || s.abCd > 0 || !alive(s) || s.state === 'rout' || s.state === 'climb' || s.charge || s.dive || liveCount(s) === 0) return false;
  const foes = sim.squads.filter((e) => e.side !== s.side && alive(e) && e.state !== 'climb' && visibleTo(sim, s.side, e));
  const nearest = (list) => list.sort((a, b) => dist(a, s) - dist(b, s))[0] || null;
  let x = s.x, y = s.y, to = null;
  if (k === 'charge') {
    let tx = c.x, ty = c.y;
    if (tx == null || ty == null) { const t = nearest(foes.filter((e) => dist(e, s) < CHARGE_LEN)); if (!t) return false; tx = t.x; ty = t.y; }
    const d = Math.hypot(tx - s.x, ty - s.y);
    if (d < 1.5) return false;
    const L = Math.min(CHARGE_LEN, d + (c.x == null ? 1.5 : 0));
    tx = Math.max(1, Math.min(sim.field.W - 1, s.x + (tx - s.x) / d * L)); ty = Math.max(1.4, Math.min(sim.field.H - 1, s.y + (ty - s.y) / d * L));
    if (s.engaged) { s.engaged = null; s.buffs.exposed = Math.max(s.buffs.exposed || 0, 1); }
    s.charge = { x: +tx.toFixed(2), y: +ty.toFixed(2), x0: +s.x.toFixed(2), y0: +s.y.toFixed(2), t: 0, hit: [] };
    s.path = []; s.chase = null; s.goal = null; s.forced = false; s.guard = null; s.regroup = 0; s.reform = null; s.holdFast = false; s.queue = []; s.state = 'charge';
    x = tx; y = ty;
  } else if (k === 'brace') {
    s.buffs.brace = 8; s.path = []; s.chase = null; s.forced = false; s.holdFast = true; s.queue = [];
    if (s.state === 'move') s.state = 'hold';
  } else if (k === 'fire') {
    if (s.ammo <= 0) return false;
    s.buffs.fire = 8;
  } else if (k === 'shields') s.buffs.shields = 10;
  else if (k === 'blast') {
    const t = nearest(foes.filter((e) => dist(e, s) < 7.5)); if (!t) return false;
    const power = (5 + liveCount(s) * 1.4) * s.atkMul * (1 + s.int * 0.04);
    for (const e of sim.squads) if (e.side !== s.side && alive(e) && dist(e, t) < 2.2) { hitSquad(sim, e, power, s); e.morale -= 8; }
    x = t.x; y = t.y; to = t.id;
  } else if (k === 'roar') {
    const near = foes.filter((e) => dist(e, s) < 3.8); if (!near.length) return false;
    for (const e of near) { e.morale -= e.morale < 40 ? 16 : 10; if (e.morale < 30 && e.state !== 'rout') e.buffs.confused = Math.max(e.buffs.confused || 0, 1.5); }
    for (const q of sim.squads) if (q.side === s.side && alive(q) && dist(q, s) < 4) q.morale = Math.min(100, q.morale + 4);
  } else if (k === 'dive') {
    const t = nearest(foes.filter((e) => e.ranged && dist(e, s) < 10)) || nearest(foes.filter((e) => dist(e, s) < 7));
    if (!t) return false;
    s.dive = { id: t.id, t: 0 }; s.path = []; s.chase = null; s.goal = null; s.forced = false; s.guard = null; s.regroup = 0; s.engaged = null; s.queue = []; s.state = 'charge';
    x = t.x; y = t.y; to = t.id;
  }
  s.abCd = A.cd;
  sim.lastAction = sim.t;
  ev(sim, { k: 'ability', a: k, id: s.id, side: s.side, x, y, to });
  return true;
}
// riders thunder down their lane: every squad in the way is hit and knocked aside; pikes that stand braced break the charge
function stepCharge(sim, s, speed) {
  const C = s.charge; C.t += DT; s.state = 'charge';
  const ok = moveToward(s, C, Math.max(speed, s.spd * 1.6) * 2.3, sim.field);
  const atk = attackOf(s);
  for (const e of sim.squads) {
    if (e.side === s.side || !alive(e) || C.hit.includes(e.id) || dist(e, s) > 1.35) continue;
    C.hit.push(e.id); sim.lastAction = sim.t;
    if (e.pike && (buff(e, 'brace') || e.formation === 'square')) {
      hitSquad(sim, s, atk * 0.6, e, true); s.morale -= 18;
      ev(sim, { k: 'charge', id: s.id, x: e.x, y: e.y, broken: true });
      endCharge(sim, s, e); return;
    }
    hitSquad(sim, e, atk * 0.8 * s.atkMul * (e.pike ? 0.6 : 1) * (buff(e, 'shields') ? 0.75 : 1), s, true); e.morale -= 12;
    const dx = C.x - C.x0, dy = C.y - C.y0, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    if ((e.x - s.x) * nx + (e.y - s.y) * ny < 0) { nx = -nx; ny = -ny; }
    const px = e.x + nx * 1.3, py = e.y + ny * 1.3;
    if (passable(sim.field, px, py) && !(e.side === 'att' && gateBlocks(sim.field, px, py))) { e.x = px; e.y = py; }
    e.buffs.exposed = Math.max(e.buffs.exposed || 0, 2.5);
    ev(sim, { k: 'chargeHit', id: s.id, to: e.id, x: e.x, y: e.y });
  }
  if (!ok || dist(s, C) < 0.5 || C.t > 4.5) endCharge(sim, s, null);
}
function endCharge(sim, s, e) {
  s.charge = null; s.moveT = 0; s.buffs.disordered = 5; s.state = 'hold';
  if (e) { s.engaged = e.id; s.state = 'fight'; }
  ev(sim, { k: 'chargeEnd', id: s.id });
}
// flyers swoop straight over everything onto their prey
function stepDive(sim, s) {
  const D = s.dive; D.t += DT; s.state = 'charge';
  const e = sim.squads.find((q) => q.id === D.id);
  if (!e || !alive(e) || e.side === s.side || D.t > 3) { s.dive = null; s.state = 'hold'; return; }
  const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
  s.dir = Math.atan2(dy, dx);
  if (d < 1.0) {
    hitSquad(sim, e, attackOf(s) * s.atkMul * 0.8, s, true); e.morale -= 8; sim.lastAction = sim.t;
    s.dive = null; s.engaged = e.id; s.state = 'fight';
    ev(sim, { k: 'diveHit', id: s.id, to: e.id, x: e.x, y: e.y });
    return;
  }
  const m = Math.min(d, 8 * DT); s.x += dx / d * m; s.y += dy / d * m;
}
// night: who can see whom (torches at your bases, fires, the clash of battle, scouts see farther)
export function visibleTo(sim, side, e) {
  if (!sim.night || !side || !e || e.side === side) return true;
  if ((sim.reveal[side] || 0) > 0 || (sim.trapsSeen[side] || 0) > 0) return true;
  if (e.state === 'fight' || e.state === 'shoot' || e.state === 'siege' || e.state === 'charge') return true;
  for (const p of sim.field.posts) if (p.owner === side && Math.hypot(p.x - e.x, p.y - e.y) < 4) return true;
  for (const f of sim.fires) if (Math.hypot(f.x - e.x, f.y - e.y) < f.r + 2.5) return true;
  for (const q of sim.squads) if (q.side === side && alive(q)) { const r = q.role === 'scout' && q.heroAlive ? 9 : 4.6; if (dist(q, e) < r) return true; }
  return false;
}
const onHill = (sim, s) => sim.hills.some((h) => h.owner === s.side && Math.hypot(h.x - s.x, h.y - s.y) < HILL_R + 0.6);
// hilltops away from the bases become small capture points
function findHills(F) {
  const G = F._grid; if (!G || !G.terr) return [];
  const W = F.W, H = F.H, T = G.terr, seen = new Uint8Array(W * H), out = [];
  for (let i = 0; i < W * H; i++) {
    if (T[i] !== 2 || seen[i]) continue;
    const cells = [], q = [i]; seen[i] = 1;
    while (q.length) { const j = q.pop(); cells.push(j); for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && !seen[k] && T[k] === 2 && Math.abs((k % W) - (j % W)) <= 1) { seen[k] = 1; q.push(k); } }
    if (cells.length < 4) continue;
    let best = null, bs = 1e9;
    for (const c of cells) {
      const x = (c % W) + 0.5, y = Math.floor(c / W) + 0.5;
      if (cells.length >= 9 && ![c - 1, c + 1, c - W, c + W].every((k) => T[k] === 2)) continue;
      if (F.posts.some((p) => Math.hypot(p.x - x, p.y - y) < 3.2) || inWalls(F, x, y) || x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
      const rp = nearestRoadPoint(F, x, y);
      const sc = rp ? Math.abs(rp.d - 1.5) + Math.hypot(x - W / 2, y - H / 2) * 0.02 : 99;
      if (sc < bs) { bs = sc; best = { x, y }; }
    }
    if (best && bs < 4 && out.every((h) => Math.hypot(h.x - best.x, h.y - best.y) > 6)) out.push(best);
  }
  out.sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2));
  return out.slice(0, 2).map((h) => ({ x: h.x, y: h.y, owner: null, prog: 0, by: null }));
}
function stepHills(sim) {
  for (const h of sim.hills) {
    let att = 0, def = 0;
    for (const s of sim.squads) if (fighting(s) && Math.hypot(s.x - h.x, s.y - h.y) < HILL_R) { if (s.side === 'att') att++; else def++; }
    const side = att && !def ? 'att' : def && !att ? 'def' : null, n = att + def;
    if (!side) { if (!att && !def) h.prog = Math.max(0, h.prog - DT * 0.15); continue; }
    if (h.owner === side) { h.prog = 0; h.by = null; continue; }
    if (h.by !== side) { h.by = side; h.prog = 0; }
    h.prog += DT * 0.22 * Math.min(2, 0.6 + n * 0.4);
    if (h.prog >= 1) {
      h.owner = side; h.prog = 0; h.by = null; sim.lastAction = sim.t;
      for (const s of sim.squads) if (s.side === side && alive(s) && Math.hypot(s.x - h.x, s.y - h.y) < 6) s.morale = Math.min(100, s.morale + 5);
      ev(sim, { k: 'hill', side, x: h.x, y: h.y });
    }
  }
}
// a rout spreads panic to friends nearby, unless a steady hero stands close
function steadied(sim, q) {
  return sim.squads.some((h) => h.side === q.side && fighting(h) && h.heroAlive && (h.role === 'commander' || h.lead >= 11) && h.morale >= 40 && dist(h, q) < 6);
}
function contagion(sim, s) {
  if (sim.t - (s._routAt ?? -99) < 25) { s._routAt = sim.t; return; } // a squad that keeps breaking stops shocking anyone
  s._routAt = sim.t;
  for (const q of sim.squads) {
    if (q === s || q.side !== s.side || !fighting(q)) continue;
    const d = dist(q, s); if (d > 5.5) continue;
    let drop = 9 * (1 - d / 5.5) + 2;
    const calm = steadied(sim, q);
    if (calm) drop *= 0.35;
    q.morale -= drop;
    if (drop > 5 || calm) ev(sim, { k: 'panic', id: q.id, side: q.side, calm, x: q.x, y: q.y });
  }
}
// ---------- side objectives: a caravan to escort, supplies to burn, a captive to free ----------
function setupObjective(sim, setup) {
  if (setup.objective === false) return null;
  const F = sim.field, rng = sim.rng;
  let kind = ['caravan', 'supplies', 'captive'].includes(setup.objective) ? setup.objective : null;
  if (!kind) { if (rng() > 0.65) return null; kind = ['caravan', 'supplies', 'captive'][Math.floor(rng() * 3)]; }
  const camp = F.posts.find((p) => p.camp), main = F.posts.find((p) => p.main);
  if (!camp || !main) return null;
  const dM = (o) => Math.hypot(o.x - main.x, o.y - main.y), dC = (o) => Math.hypot(o.x - camp.x, o.y - camp.y);
  if (kind === 'caravan') {
    const mid = F.posts.filter((p) => !p.camp && !p.main && !inWalls(F, p.x, p.y)).sort((a, b) => Math.abs(dM(a) - dC(a)) - Math.abs(dM(b) - dC(b)))[0];
    if (!mid) return null;
    const x = mid.x + 0.9, y = mid.y + 0.6;
    return { kind, x: passable(F, x, y) ? x : mid.x, y: passable(F, x, y) ? y : mid.y, done: false, by: null, prog: 0, pby: null, side: null, path: null };
  }
  const spots = F.edges.map((e, i) => { const A = F.posts[e[0]], B = F.posts[e[1]]; return { i, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; })
    .filter((o) => !F.blocked.includes(o.i) && passable(F, o.x, o.y) && F.posts.every((p) => Math.hypot(p.x - o.x, p.y - o.y) > 3) && !inWalls(F, o.x, o.y));
  if (!spots.length) return null;
  const pick = kind === 'supplies' ? spots.filter((o) => dM(o) > 4).sort((a, b) => dM(a) - dM(b))[0] : spots.sort((a, b) => Math.abs(dM(a) - dC(a)) - Math.abs(dM(b) - dC(b)))[0];
  if (!pick) return null;
  return { kind, x: +pick.x.toFixed(2), y: +pick.y.toFixed(2), done: false, by: null, prog: 0, pby: null };
}
function stepObjective(sim) {
  const O = sim.obj; if (!O || O.done) return;
  const near = (side, r) => { let n = 0; for (const s of sim.squads) if (s.side === side && fighting(s) && Math.hypot(s.x - O.x, s.y - O.y) < r) n++; return n; };
  if (O.kind === 'caravan') {
    const a = near('att', 3), d = near('def', 3);
    const side = a && !d ? 'att' : d && !a ? 'def' : null;
    O.pby = side;
    if (!side) return;
    const dest = campOf(sim, side); if (!dest) return;
    if (O.side !== side || !O.path) {
      O.side = side;
      const ids = shortestPath(sim.field, nearestPost(sim.field, O.x, O.y), dest.id);
      O.path = (ids[ids.length - 1] === dest.id ? ids : [dest.id]).map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y }));
    }
    while (O.path.length > 1 && Math.hypot(O.path[0].x - O.x, O.path[0].y - O.y) < 0.5) O.path.shift();
    const t = O.path[0] || dest;
    const dx = t.x - O.x, dy = t.y - O.y, dd = Math.hypot(dx, dy);
    if (dd > 0.01) { const m = Math.min(dd, 0.95 * DT); O.x += dx / dd * m; O.y += dy / dd * m; }
    O.prog = Math.max(0, Math.min(0.99, 1 - Math.hypot(dest.x - O.x, dest.y - O.y) / 30));
    if (sim.tick % 20 === 0) sim.lastAction = sim.t;
    if (Math.hypot(dest.x - O.x, dest.y - O.y) < 1.6) completeObjective(sim, side);
    return;
  }
  const a = near('att', 1.8), d = near('def', O.kind === 'supplies' ? 2.2 : 2.6), a2 = near('att', 2.6);
  let side = null;
  if (O.kind === 'supplies') side = a && !d ? 'att' : null;
  else side = a && !d ? 'att' : d && !a2 ? 'def' : null;
  if (!side) { O.prog = Math.max(0, O.prog - DT / 14); return; }
  if (O.pby !== side) { O.pby = side; O.prog = 0; }
  O.prog += DT / (O.kind === 'supplies' ? 6 : 5);
  if (O.prog >= 1) completeObjective(sim, side);
}
function completeObjective(sim, side) {
  const O = sim.obj;
  O.done = true; O.by = side; O.prog = 1; O.path = null; sim.lastAction = sim.t;
  const st = sim.strat[side];
  if (O.kind === 'caravan') {
    for (const s of sim.squads) if (s.side === side && alive(s)) s.morale = Math.min(100, s.morale + 12);
    st.pool = Math.min(st.max + 3, st.pool + 2);
  } else if (O.kind === 'supplies') {
    for (const s of sim.squads) if (s.side !== side && alive(s)) { s.morale -= 10; if (s.ranged) s.ammo = Math.floor(s.ammo * 0.5); }
    sim.fires.push({ x: O.x, y: O.y, t: 6, r: 1.4, pow: 0.6, side });
  } else {
    for (const s of sim.squads) if (s.side === side && alive(s)) s.morale = Math.min(100, s.morale + 8);
    st.pool = Math.min(st.max + 3, st.pool + 1);
  }
  ev(sim, { k: 'objective', kind: O.kind, side, x: O.x, y: O.y });
}

// ---------- hero duels: three rounds of strike / guard / feint ----------
export const DUEL_PICKS = ['strike', 'guard', 'feint'];
const BEATS = { strike: 'feint', feint: 'guard', guard: 'strike' }; // a strike cuts through a feint, a feint slips a guard, a guard turns a strike
export const DUEL_PICK_TIME = 4;
const newDuel = (a, b, edge) => ({ a, b, t: 0, round: 1, rt: -1.2, pa: null, pb: null, la: null, lb: null, wins: [0, 0], edge: edge || null });
const duelScore = (d, q) => q.heroAtk + q.heroHp / 25 + q.morale / 40 + (q.role === 'duelist' ? 2.5 : 0) + (d.edge === q.id ? 1.2 : 0);
function duelPick(sim, side, pick) {
  const d = sim.duel; if (!d || !BEATS[pick] || d.rt < 0) return false;
  const a = sim.squads.find((q) => q.id === d.a), b = sim.squads.find((q) => q.id === d.b);
  if (a && a.side === side && !d.pa) { d.pa = pick; return true; }
  if (b && b.side === side && !d.pb) { d.pb = pick; return true; }
  return false;
}
// the computer reads the fighters: the stronger presses the attack, the weaker guards, and both try to counter the last move
function aiDuelPick(sim, d, q, o, last) {
  const adv = Math.max(-0.6, Math.min(0.6, (duelScore(d, q) - duelScore(d, o)) / 8));
  const w = { strike: 1 + adv, guard: 1 - adv * 0.6, feint: 1 };
  if (last) for (const k of DUEL_PICKS) if (BEATS[k] === last) w[k] += 0.5;
  let r = sim.rng() * (w.strike + w.guard + w.feint);
  for (const k of DUEL_PICKS) { r -= w[k]; if (r <= 0) return k; }
  return 'strike';
}

// ---------- stratagems ----------
function touchesCamp(sim, i) { const [a, b] = sim.field.edges[i]; return sim.field.posts[a].camp || sim.field.posts[b].camp; }
// would cutting this road split the field in two (an army stranded, the main post out of reach for good)?
function splitsField(sim, i) {
  const F = sim.field, n = F.posts.length, seen = new Uint8Array(n), q = [0];
  seen[0] = 1;
  while (q.length) {
    const u = q.pop();
    F.edges.forEach(([a, b], ei) => {
      if (ei === i || F.blocked.includes(ei)) return;
      const v = a === u ? b : b === u ? a : -1;
      if (v >= 0 && !seen[v]) { seen[v] = 1; q.push(v); }
    });
  }
  return seen.some((x) => !x);
}
const cuttable = (sim, i) => !sim.field.blocked.includes(i) && !touchesCamp(sim, i) && !splitsField(sim, i);
export function stratagemTargets(sim, side, id) {
  const st = STRATAGEMS[id];
  const S = sim.squads;
  if (!st) return [];
  if (st.target === 'army') return [{ kind: 'army' }];
  if (st.target === 'own') return S.filter((s) => s.side === side && fighting(s) && (id !== 'warcry' || s.heroAlive) && (id !== 'feint' || s.state === 'fight')).map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'enemy') return S.filter((s) => s.side !== side && alive(s)).map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'enemyFighting') return S.filter((s) => s.side !== side && alive(s) && s.state === 'fight').map((s) => ({ kind: 'squad', id: s.id }));
  if (st.target === 'post') return sim.field.posts.filter((p) => p.owner === side).map((p) => ({ kind: 'post', id: p.id }));
  if (st.target === 'route') return sim.field.edges.map((e, i) => i).filter((i) => cuttable(sim, i)).map((i) => ({ kind: 'edge', id: i }));
  return [];
}

function useStratagem(sim, side, id, target) {
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
    hitSquad(sim, sq, (total * 0.28 + 20) * (sim.night ? 2 : 1), null, true); // out of the dark: twice as deadly at night
    sq.morale -= sim.night ? 40 : 25;
    for (const s of sim.squads) if (s.side === side && alive(s) && dist(s, sq) < 6) s.morale = Math.min(100, s.morale + 8);
  }
  if (id === 'fire') { const wf = sim.weather === 'storm' ? 0.4 : sim.weather === 'drought' ? 1.5 : sim.weather === 'blizzard' ? 0.7 : 1; sim.fires.push({ x: sq.x, y: sq.y, t: 8 * wf, r: 2.2 * Math.sqrt(wf), pow: 3.2 * (sim.field.underground ? 0.35 : 1), side }); }
  if (id === 'discord') {
    sq.morale -= 35;
    if (sq.traitor === 0 && sq.hero != null && sq.loyalty < 40 && ((sim.tick + sq.id) % 2 === 0)) sq.traitor = sim.t + 0.5;
  }
  if (id === 'feint') {
    const foe = sim.squads.find((q) => q.id === sq.engaged);
    if (foe) { foe.buffs.exposed = 8; foe.chase = sq.id; }
    const home = nearestOwnedPost(sim, sq);
    sq.engaged = null; sq.buffs.feint = 3;
    if (home && home.id != null) routeTo(sim, sq, home.id, true);
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
    if (s.state === 'reinforce' && sim.t >= s.arriveAt) {
      const entry = s.side === 'att' ? sim.field.posts.find((p) => p.camp) : sim.field.posts.find((p) => p.owner === 'def' && p.main) || sim.field.posts.find((p) => p.owner === 'def');
      if (entry) { s.x = entry.x - 0.8; s.y = entry.y + 0.8; s.state = 'hold'; ev(sim, { k: 'reinforce', id: s.id, side: s.side, name: s.allyName, x: s.x, y: s.y }); }
    }
    if (!alive(s)) continue;
    s.skillCd = Math.max(0, s.skillCd - DT);
    s.abCd = Math.max(0, (s.abCd || 0) - DT);
    // quivers refill at your bases (slowly while still shooting)
    if (s.ranged && s.ammo < s.ammoMax && s.regroup !== 2 && sim.tick % 5 === 0) {
      const p = sim.field.posts.find((q) => q.owner === s.side && Math.hypot(q.x - s.x, q.y - s.y) < CAP_R + 1.2);
      if (p) { s._ammoT = (s._ammoT || 0) + 0.25 * (p.main || p.camp ? 2 : 1) * (s.state === 'shoot' ? 0.4 : 1); if (s._ammoT >= 1) { s._ammoT -= 1; s.ammo++; } }
    }
    if (s.regroup === 2) {
      const camp = campOf(sim, s.side);
      if (!camp || Math.hypot(s.x - camp.x, s.y - camp.y) > 4.5 || s.state === 'rout') s.regroup = 0;
      else {
        s.morale = Math.min(100, s.morale + DT * 5);
        if (s.heroAlive) s.heroHp = Math.min(s.heroMax, s.heroHp + DT * 1.5);
        for (const so of s.soldiers) if (so.alive && so.hp < so.max) so.hp = Math.min(so.max, so.hp + so.max * 0.02 * DT);
        if (s.ranged && s.ammo < s.ammoMax && sim.tick % 8 === 0) s.ammo++;
        s._rg = (s._rg || 0) + DT;
        // the walking wounded rejoin, a few at a time (up to 30% of the squad)
        if (s._rg >= 7) {
          s._rg = 0;
          const so = s.soldiers.find((x) => !x.alive);
          if (so && s.revived < Math.ceil(s.soldiers.length * 0.3)) { so.alive = true; so.hp = so.max * 0.5; s.revived++; ev(sim, { k: 'rejoin', id: s.id, side: s.side, idx: so.idx }); }
        }
      }
    }
    s.moveT = s.state === 'move' ? s.moveT + DT : 0;
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
  if (sim.fog > 0 && sim.weather !== 'fog') sim.fog -= DT;
  if (sim.weather === 'blizzard' && sim.tick % 40 === 0) for (const s of S) if (alive(s) && s.morale > 40) s.morale -= 0.6; // the cold gnaws at morale
  for (const k of ['att', 'def']) { if (sim.reveal[k] > 0) sim.reveal[k] -= DT; if (sim.trapsSeen[k] > 0) sim.trapsSeen[k] -= DT; }
  if (sim.t >= sim.nextEvent && sim.eventsLeft > 0) {
    sim.eventsLeft--; sim.nextEvent = sim.t + 50 + ((sim.seed + sim.tick) % 40);
    const spots = (sim.field.eventSpots || []).filter((s) => cuttable(sim, s.edge));
    if (spots.length) { const sp = spots[(sim.seed + sim.tick) % spots.length]; mapEvent(sim, sp.edge, sp.kind); }
    else { sim.fog = 30; ev(sim, { k: 'fog' }); }
  }
  for (const s of S) {
    if (!alive(s)) continue;
    const f = FORMATIONS[s.formation];
    if (buff(s, 'confused') && s.state !== 'rout') { s.state = 'confused'; continue; } // a routing squad keeps running
    const ter = TERRAIN[terrainAt(sim.field, s.x, s.y)] || TERRAIN[0];
    let speed = (sim.weather === 'blizzard' ? 0.8 : 1) * s.spd * f.spd * 2.1 * (0.75 + 0.25 * s.morale / 100) * (s.reform ? 0.5 : 1) * (buff(s, 'march') ? (s.role === 'scout' ? 1.5 : 1.6) : 1) * ter.spd;
    if (s.state === 'rout') {
      speed *= 1.15;
      const home = nearestOwnedPost(sim, s);
      if (home && dist(s, home) > 1.2) moveToward(s, home, speed, sim.field);
      s.morale += DT * (home && dist(s, home) < 2 ? 9 : 2.5);
      if (s.morale >= 45) { s.state = 'hold'; s.path = []; }
      continue;
    }
    if (s.charge) { stepCharge(sim, s, speed); continue; }
    if (s.dive) { stepDive(sim, s); continue; }
    if (buff(s, 'brace')) speed = 0;
    if (buff(s, 'shields')) speed *= 0.45;
    if (buff(s, 'disordered')) speed *= 0.8;
    if (s.ladder && stepLadder(sim, s, speed)) continue;
    let foe = null, fd = 1e9;
    for (const e of S) if (e.side !== s.side && alive(e)) { const d = dist(s, e); if (d < fd) { fd = d; foe = e; } }
    // battering the gate: attackers stuck at an intact gate hammer it (beasts and riders hit hardest)
    if (s.side === 'att' && sim.gates.length && !s.ranged && !(foe && fd < MELEE)) {
      const g = sim.gates.find((q) => q.hp > 0 && Math.hypot(q.x - s.x, q.y - s.y) < 1.9);
      if (g && (s.path.length || s.chase || s.goal != null || s.state === 'siege')) {
        let atk = 0; for (const so of s.soldiers) if (so.alive) atk += so.atk;
        const cls = unitClass(s.fid, s.unit), heavy = cls === 'beast' ? 2.6 : s.mounted ? 1.6 : 1;
        g.hp -= (atk + (s.heroAlive ? s.heroAtk : 0)) * heavy * 0.32 * DT;
        s.state = 'siege'; face(s, g); sim.lastAction = sim.t;
        if (sim.tick % 12 === 0) ev(sim, { k: 'gateHit', x: g.x, y: g.y, hp: Math.max(0, Math.round(g.hp)) });
        if (g.hp <= 0) { g.hp = 0; ev(sim, { k: 'gateBroken', x: g.x, y: g.y }); for (const q of S) if (alive(q)) q.morale = Math.max(0, Math.min(100, q.morale + (q.side === 'att' ? 10 : -12))); }
        continue;
      }
      if (s.state === 'siege') s.state = 'hold';
    }
    if (s.chase) { const c = S.find((q) => q.id === s.chase); if (!c || !alive(c) || c.side === s.side) s.chase = null; else { foe = c; fd = dist(s, c); } }
    if (buff(s, 'feint') && s.path.length) { const wp = s.path[0]; if (dist(s, wp) < 1.3) s.path.shift(); else moveToward(s, wp, speed * 1.2, sim.field); s.state = 'move'; continue; }
    // a direct order is obeyed: march on through, ignoring skirmishers along the way
    if (s.forced && s.path.length && !s.chase) {
      // passing a friend locked in melee: if the march ends near that fight anyway, wade in instead of walking by
      if (!s.ranged && !s.regroup && sim.tick % 6 === s.id % 6) {
        const end = s.path[s.path.length - 1], b = brawlNear(sim, s, 2.6);
        if (b && Math.hypot(b.x - end.x, b.y - end.y) < 5) { s.chase = b.id; s.path = []; s.goal = null; s.rally = null; ev(sim, { k: 'join', id: s.id, x: b.x, y: b.y }); continue; }
      }
      followPath(sim, s, speed * (s.buffs.exposed > 0 ? 0.85 : 1));
      s.state = 'move'; s.engaged = null;
      if (!s.path.length) {
        s.forced = false; s.state = 'hold';
        ev(sim, { k: 'arrive', id: s.id, post: s.goal });
        if (s.regroup === 1) { s.regroup = 2; s.holdFast = true; s._rg = 0; s._rgAt = sim.t; ev(sim, { k: 'regrouped', id: s.id, side: s.side }); }
        else if (!nextQueued(sim, s)) {
          const b = !s.ranged ? brawlNear(sim, s, s.rally ? 3 : 4.5) : null;
          if (b) { s.chase = b.id; s.forced = true; s.rally = null; ev(sim, { k: 'join', id: s.id, x: b.x, y: b.y }); }
          else if (s.rally) s.holdFast = true; // a rally point is held until told otherwise
        }
      }
      continue;
    }
    if (foe && fd < MELEE) {
      if (s.engaged !== foe.id) contact(sim, s, foe);
      s.engaged = foe.id; s.state = 'fight'; face(s, foe); if (!s.chase) s.forced = false; continue;
    }
    const range = RANGE * (sim.fog > 0 ? 0.6 : 1) * (sim.weather === 'storm' ? 0.8 : 1) * (sim.night ? 0.8 : 1) * (ter.range || 1) * (s.side === 'def' && nearWallInside(sim.field, s.x, s.y) ? 1.2 : 1) * (onHill(sim, s) ? 1.2 : 1);
    if (s.ranged && s.ammo > 0 && foe && fd < range && (s.state !== 'move' || s.chase) && visibleTo(sim, s.side, foe)) {
      face(s, foe); s.state = 'shoot';
      if (s.shootCd <= 0 && !s.reform) { shoot(sim, s, foe); s.shootCd = 1.1; }
      continue;
    }
    // guarding an area: engage whatever enters it, never chase out of it, drift back to the middle
    if (s.guard && !s.forced && !s.path.length) {
      const G = s.guard, dz = (e) => Math.hypot(e.x - G.x, e.y - G.y);
      if (s.chase) { const c = S.find((q) => q.id === s.chase); if (!c || dz(c) > G.r + 1.5) s.chase = null; }
      let t = s.chase ? S.find((q) => q.id === s.chase) : null;
      if (!t) { let bd = 1e9; for (const e of S) if (e.side !== s.side && fighting(e) && dz(e) < G.r + 0.4 && visibleTo(sim, s.side, e)) { const d = dist(s, e); if (d < bd) { bd = d; t = e; } } }
      if (t && !s.ranged) { moveToward(s, t, speed * 1.05, sim.field); s.state = 'move'; continue; }
      if (dist(s, G) > 0.7) { moveToward(s, G, speed, sim.field); s.state = 'move'; continue; }
      if (s.state !== 'hold') s.state = 'hold';
      continue;
    }
    if (s.chase && foe) {
      // distant targets are reached by road (no wading through lakes), close ones charged directly
      if (fd > 6 || (s._stuck || 0) > 0.6) {
        if (!s._cp || sim.tick % 20 === 0) { const ids = planRoute(sim, s, nearestPost(sim.field, foe.x, foe.y)); s._cp = ids ? ids.map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y })) : null; }
        if (s._cp && s._cp.length && dist(s, s._cp[0]) < 0.8) s._cp.shift();
        if (s._stuck > 0) s._stuck -= DT * 0.4;
        moveToward(s, s._cp && s._cp.length ? s._cp[0] : foe, speed, sim.field);
      } else { s._cp = null; s._stuck = moveToward(s, foe, speed * 1.1, sim.field) ? Math.max(0, (s._stuck || 0) - DT) : (s._stuck || 0) + DT; }
      s.state = 'move'; continue;
    }
    if (s.path.length) {
      // attack-move (AI marches): stop to fight anyone who blocks the road
      followPath(sim, s, speed);
      s.state = 'move';
      if (!s.path.length) nextQueued(sim, s);
      if (!s.ranged) { const b = foe && fd < 2.0 ? foe : brawlNear(sim, s, 3.2); if (b) s.chase = b.id; }
      continue;
    }
    if (!s.ranged && s.regroup !== 2 && sim.tick % 6 === s.id % 6) {
      const b = brawlNear(sim, s, s.holdFast ? 2.4 : (sim.night ? 4.5 : SIGHT + 1.5));
      if (b) { s.chase = b.id; s.forced = true; s.holdFast = false; s.state = 'move'; ev(sim, { k: 'join', id: s.id, x: b.x, y: b.y }); continue; }
    }
    if (foe && fd < (sim.night ? 3.8 : SIGHT) && !s.holdFast && visibleTo(sim, s.side, foe)) { if (s.ranged) s.state = 'hold'; else { moveToward(s, foe, speed, sim.field); s.state = 'move'; } continue; }
    if (s.state === 'move' || s.state === 'fight' || s.state === 'shoot' || s.state === 'confused') s.state = 'hold';
  }
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i], b = S[j]; if (!alive(a) || !alive(b)) continue;
    const big = Math.min(1.4, (Math.sqrt(liveCount(a)) + Math.sqrt(liveCount(b))) * 0.12);
    const d = dist(a, b), min = (a.side === b.side ? 1.6 + big * 0.7 : 1.0 + big * 0.4);
    if (d < min && d > 0.001) { const push = (min - d) * (a.side === b.side ? 0.18 : 0.25), ux = (a.x - b.x) / d, uy = (a.y - b.y) / d; a.x += ux * push; a.y += uy * push; b.x -= ux * push; b.y -= uy * push; }
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
    dmg *= s.atkMul * fa.atk * formationEdge(s.formation, e.formation) * (0.6 + 0.4 * s.morale / 100) * 0.026 * DT;
    if (s.reform) dmg *= 0.75;
    if (buff(s, 'warcry')) dmg *= 1.15;
    if (fb.arrowGuard) dmg *= 1.1;
    if (e.state === 'rout') dmg *= 1.3;
    const fl = flankOf(s, e);
    if (fl === 2) { dmg *= 1.4; e.morale -= DT * 2.2; } else if (fl === 1) { dmg *= 1.18; e.morale -= DT * 1; }
    if (s.pike && e.mounted) dmg *= buff(s, 'brace') ? 2.1 : 1.5;
    if (buff(e, 'shields')) dmg *= 0.85;
    if (buff(s, 'disordered')) dmg *= 0.8;
    if (isNem(sim, s, e)) dmg *= 1.15;
    const et = TERRAIN[terrainAt(sim.field, e.x, e.y)];
    if (et && et.def) dmg /= et.def;
    hitSquad(sim, e, dmg, s);
    if (liveCount(s) === 0 && !s.heroAlive) s.state = 'dead';
  }
  duels(sim, S);
  stepHills(sim);
  stepObjective(sim);
  // routing squads keep spreading fear to friends close by
  if (sim.tick % 20 === 0) for (const s of S) if (s.state === 'rout') for (const q of S) if (q !== s && q.side === s.side && fighting(q) && dist(q, s) < 3.5) q.morale -= steadied(sim, q) ? 0.2 : 0.6;
  for (const tr of sim.field.traps || []) {
    for (const s of S) if (fighting(s) && Math.hypot(s.x - tr.x, s.y - tr.y) < 0.9 && sim.tick % 20 === 0) { hitSquad(sim, s, 3, null, true); ev(sim, { k: 'trap', x: tr.x, y: tr.y }); }
  }
  for (const p of sim.field.posts) {
    let att = 0, def = 0;
    for (const s of S) if (fighting(s) && Math.hypot(s.x - p.x, s.y - p.y) < CAP_R) { if (s.side === 'att') att++; else def++; }
    const rate = p.main ? 0.03 : 0.09;
    const contest = (side, n) => {
      if (p.owner === side) { p.prog = Math.max(0, p.prog - DT * 0.3); return; }
      if (p.by !== side) { p.by = side; p.prog = 0; }
      p.prog += DT * rate * Math.min(2, 0.6 + n * 0.4); sim.lastAction = sim.t;
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
  for (const s of S) if (fighting(s) && s.morale < 12) {
    const by = s.engaged != null ? S.find((q) => q.id === s.engaged) : null;
    s.state = 'rout'; s.path = []; s.chase = null; s.engaged = null; s.reform = null; s.ladder = null; s.charge = null; s.dive = null; s.regroup = 0; ev(sim, { k: 'rout', id: s.id });
    if (by) nemesisWin(sim, by, s);
    contagion(sim, s);
  }
  for (const side of ['att', 'def']) {
    const mine = S.filter((s) => s.side === side && alive(s));
    if (!mine.length) {
      // last stand: reserves and late allies take the field rather than lose the battle unseen
      const left = S.filter((s) => s.side === side && (s.state === 'reserve' || s.state === 'reinforce'));
      if (left.length) { for (const q of left) { if (q.state === 'reserve') callReserve(sim, q); else q.arriveAt = sim.t; } continue; }
      sim.winner = other(side); ev(sim, { k: 'end' }); return;
    }
    const allRout = mine.every((s) => s.state === 'rout');
    sim.routTimer[side] = allRout ? sim.routTimer[side] + DT : 0;
    if (sim.routTimer[side] > 10) { sim.winner = other(side); ev(sim, { k: 'end' }); return; }
  }
  if (sim.t >= TIME_LIMIT) { sim.winner = 'def'; ev(sim, { k: 'end', timeout: true }); }
}

// Hero duels: when two heroes' squads are locked together, the heroes may square off. Short spotlight,
// winner's army takes heart, loser is wounded (and may fall).
function duels(sim, S) {
  const d = sim.duel;
  if (d) {
    const a = S.find((q) => q.id === d.a), b = S.find((q) => q.id === d.b);
    d.t += DT;
    if (!a || !b || !a.heroAlive || !b.heroAlive || a.state === 'rout' || b.state === 'rout' || dist(a, b) > 8) {
      sim.duel = null; sim.duelCd = sim.t + 10; ev(sim, { k: 'duelEnd', win: null });
      return;
    }
    if (d.rt < 0) { d.rt = Math.min(0, d.rt + DT); return; } // the heroes circle between rounds
    d.rt += DT;
    // the computer picks for its own heroes (and allies); a player who hesitates too long has the choice made for them
    const auto = (q) => sim.ai[q.side] || q.ally;
    if (!d.pa && ((auto(a) && d.rt > 0.8) || d.rt >= DUEL_PICK_TIME)) d.pa = aiDuelPick(sim, d, a, b, d.lb);
    if (!d.pb && ((auto(b) && d.rt > 0.8) || d.rt >= DUEL_PICK_TIME)) d.pb = aiDuelPick(sim, d, b, a, d.la);
    if (!d.pa || !d.pb) return;
    let win;
    if (d.pa === d.pb) win = duelScore(d, a) * (0.75 + sim.rng() * 0.5) >= duelScore(d, b) * (0.75 + sim.rng() * 0.5) ? a : b;
    else {
      win = BEATS[d.pa] === d.pb ? a : b;
      const lose = win === a ? b : a;
      // a far stronger fighter can still win an exchange they read wrong
      if (sim.rng() < Math.max(0, Math.min(0.3, (duelScore(d, lose) - duelScore(d, win)) * 0.03))) win = lose;
    }
    const lose = win === a ? b : a, wp = win === a ? d.pa : d.pb;
    const dmg = (4 + duelScore(d, win) * 0.9) * (wp === 'strike' ? 1.25 : wp === 'guard' ? 0.8 : 1);
    lose.heroHp = Math.max(1, lose.heroHp - dmg);
    d.wins[win === a ? 0 : 1]++;
    ev(sim, { k: 'duelRound', a: a.id, b: b.id, pa: d.pa, pb: d.pb, win: win.id, round: d.round, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    d.la = d.pa; d.lb = d.pb; d.pa = null; d.pb = null;
    if (d.round < 3) { d.round++; d.rt = -1.4; return; }
    const W = d.wins[0] > d.wins[1] ? a : b, L = W === a ? b : a;
    sim.duel = null; sim.duelCd = sim.t + 25;
    // the whole field watched: a big swing in heart either way
    W.morale = Math.min(100, W.morale + 35);
    for (const q of S) if (alive(q) && q.id !== W.id && q.id !== L.id && dist(q, W) < 8) q.morale = Math.max(0, Math.min(100, q.morale + (q.side === W.side ? 12 : -12)));
    L.morale = Math.max(0, L.morale - 30);
    ev(sim, { k: 'duelEnd', win: W.id, lose: L.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, wins: d.wins.slice() });
    damageHero(sim, L, L.heroMax * 0.25);
    return;
  }
  if (sim.t < sim.duelCd || sim.tick % 20 !== 0) return;
  for (const s of S) {
    if (s.state !== 'fight' || !s.heroAlive || !s.engaged) continue;
    const e = S.find((q) => q.id === s.engaged);
    if (!e || !e.heroAlive || e.engaged !== s.id || e.side === s.side) continue;
    const key = Math.min(s.id, e.id) + ':' + Math.max(s.id, e.id);
    if (sim.duelled.includes(key) || sim.rng() > 0.25) continue;
    sim.duelled.push(key);
    sim.duel = newDuel(s.id, e.id, null);
    ev(sim, { k: 'duelStart', a: s.id, b: e.id, x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 });
    return;
  }
}

function nearestOwnedPost(sim, s) {
  let best = null, bd = 1e9;
  for (const p of sim.field.posts) if (p.owner === s.side) { const d = dist(s, p); if (d < bd) { bd = d; best = p; } }
  return best || { x: s.side === 'att' ? 1 : sim.field.W - 1, y: s.y, id: null };
}
// march along the path one step. A squad that makes no headway for a while (a river in the way of a shortcut,
// friends shoving over the same spot) re-plans by road, or counts a waypoint it can't get closer to as reached.
function followPath(sim, s, speed) {
  const wp = s.path[0], d = dist(s, wp);
  if (d < (s.path.length === 1 ? 0.5 : 0.7)) { s.path.shift(); s._bd = null; return; }
  moveToward(s, wp, speed, sim.field);
  const d2 = dist(s, wp);
  if (s._bd == null || d2 < s._bd - 0.05) { s._bd = d2; s._bt = 0; return; }
  if ((s._bt = (s._bt || 0) + DT) < 2) return;
  s._bd = null; s._bt = 0;
  const F = sim.field, np = F.posts[nearestPost(F, s.x, s.y)], last = s.path.length === 1;
  if (!np || (last && (d2 < 2.2 || s.goal === np.id)) || Math.hypot(wp.x - np.x, wp.y - np.y) < 0.5 || dist(s, np) < 1) { s.path.shift(); return; }
  if (s.goal != null) {
    const ids = shortestPath(F, np.id, s.goal);
    if (ids[ids.length - 1] === s.goal) { const end = s.path[s.path.length - 1]; s.path = [...ids.slice(0, -1).map((id) => ({ x: F.posts[id].x, y: F.posts[id].y })), end]; return; }
  }
  s.path.unshift({ x: np.x, y: np.y });
}
function moveToward(s, t, speed, F) {
  const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  const m = Math.min(d, speed * DT);
  let nx = s.x + dx / d * m, ny = s.y + dy / d * m;
  // water is crossed only at bridges and fords: slide along the bank instead of wading in
  let slid = false;
  const ok = (x, y) => passable(F, x, y) && !(s.side === 'att' && gateBlocks(F, x, y));
  if (F && !ok(nx, ny) && ok(s.x, s.y)) {
    slid = true;
    if (ok(nx, s.y)) ny = s.y; else if (ok(s.x, ny)) nx = s.x; else { s.dir = Math.atan2(dy, dx); return false; }
  }
  s.x = nx; s.y = ny;
  s.dir = Math.atan2(dy, dx);
  return !slid;
}
function gateBlocks(F, x, y) {
  if (!F._gates || !F._gates.length) return false;
  const cx = Math.floor(x), cy = Math.floor(y);
  return F._gates.some((g) => g.hp > 0 && g.cx === cx && g.cy === cy);
}
const inWalls = (F, x, y) => !!F.wallRect && x > F.wallRect.x0 + 0.5 && x < F.wallRect.x1 + 0.5 && y > F.wallRect.y0 + 0.5 && y < F.wallRect.y1 + 0.5;
const nearWallInside = (F, x, y) => inWalls(F, x, y) && (x - F.wallRect.x0 < 3 || F.wallRect.x1 + 1 - x < 3 || y - F.wallRect.y0 < 3 || F.wallRect.y1 + 1 - y < 3);
const isNem = (sim, a, b) => a.hero != null && b.hero != null && sim.nemesis.some(([x, y]) => (x === a.hero && y === b.hero) || (x === b.hero && y === a.hero));
// ladders: foot troops climb a chosen stretch of wall (slow, and badly exposed while on the rungs)
export const canClimb = (s) => !s.mounted && ['foot', 'ranged'].includes(unitClass(s.fid, s.unit));
export function ladderSpot(sim, x, y) {
  const F = sim.field, R = F.wallRect; if (!R) return null;
  let best = null, bd = 3.5;
  for (let cy = R.y0; cy <= R.y1; cy++) for (let cx = R.x0; cx <= R.x1; cx++) {
    if (!(cx === R.x0 || cx === R.x1 || cy === R.y0 || cy === R.y1)) continue;
    if (terrainAt(F, cx + 0.5, cy + 0.5) !== 6) continue;
    if ((cx === R.x0 || cx === R.x1) && (cy === R.y0 || cy === R.y1)) continue; // no corners
    const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y); if (d >= bd) continue;
    const ox = cx === R.x0 ? -1 : cx === R.x1 ? 1 : 0, oy = cy === R.y0 ? -1 : cy === R.y1 ? 1 : 0;
    const out = { x: cx + 0.5 + ox * 1.1, y: cy + 0.5 + oy * 1.1 }, inn = { x: cx + 0.5 - ox * 1.2, y: cy + 0.5 - oy * 1.2 };
    if (!passable(F, out.x, out.y) || !passable(F, inn.x, inn.y)) continue;
    bd = d; best = { wx: cx + 0.5, wy: cy + 0.5, out, inn };
  }
  return best;
}
function startLadder(sim, s, x, y) {
  if (!canClimb(s) || !alive(s) || s.state === 'rout') return false;
  const sp = ladderSpot(sim, x, y); if (!sp) return false;
  s.ladder = { ...sp, phase: 'go', t: 0, len: 5 + Math.sqrt(liveCount(s)) * 0.6, way: [] };
  // far from the wall: take the roads to the nearest base first, then cut across to the ladder spot
  if (dist(s, sp.out) > 5) { const ids = planRoute(sim, s, nearestPost(sim.field, sp.out.x, sp.out.y)); if (ids) s.ladder.way = ids.map((id) => ({ x: sim.field.posts[id].x, y: sim.field.posts[id].y })); }
  s.path = []; s.chase = null; s.goal = null; s.forced = true; s.holdFast = false; s.engaged = null; s.state = 'move';
  ev(sim, { k: 'ladderOrder', id: s.id, x: sp.wx, y: sp.wy });
  return true;
}
function stepLadder(sim, s, speed) {
  const L = s.ladder;
  if (s.state === 'rout') { s.ladder = null; return false; }
  if (L.phase === 'go') {
    if (dist(s, L.out) < 0.6) { L.phase = 'climb'; s.state = 'climb'; sim.ladders.push({ id: s.id, x: L.wx, y: L.wy, side: s.side }); ev(sim, { k: 'ladder', id: s.id, x: L.wx, y: L.wy }); }
    else {
      while (L.way.length && dist(s, L.way[0]) < 0.8) L.way.shift();
      const ok = moveToward(s, L.way.length ? L.way[0] : L.out, speed, sim.field);
      L.stuck = ok ? 0 : (L.stuck || 0) + DT;
      if (L.stuck > 3) { s.ladder = null; s.state = 'hold'; ev(sim, { k: 'ladderFail', id: s.id }); return false; }
      s.state = 'move';
    }
    return true;
  }
  s.state = 'climb'; L.t += DT;
  s.x += (L.wx - s.x) * 0.05; s.y += (L.wy - s.y) * 0.05;
  if (L.t >= L.len) {
    s.x = L.inn.x; s.y = L.inn.y; s.ladder = null; s.state = 'hold'; s.forced = false;
    sim.ladders = sim.ladders.filter((l) => l.id !== s.id);
    ev(sim, { k: 'overWall', id: s.id, x: s.x, y: s.y });
  }
  return true;
}
// 0 = front, 1 = side, 2 = rear, as seen from the target
function flankOf(s, e) {
  if (e.engaged === s.id && e.state === 'fight') return 0;
  const a = Math.atan2(s.y - e.y, s.x - e.x);
  let d = Math.abs(a - e.dir) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d;
  return d > 2.2 ? 2 : d > 1.15 ? 1 : 0;
}
// first contact: cavalry charges land a hammer blow, unless they hit a wall of pikes
function contact(sim, s, e) {
  if (isNem(sim, s, e)) {
    const key = Math.min(s.hero, e.hero) + ':' + Math.max(s.hero, e.hero);
    if (!sim.nemesisMet.includes(key)) { sim.nemesisMet.push(key); ev(sim, { k: 'nemesisMeet', a: s.id, b: e.id, x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); }
  }
  if (s.mounted && s.moveT > 1.2 && s.state !== 'rout') {
    let atk = 0; for (const so of s.soldiers) if (so.alive) atk += so.atk;
    if (e.pike) {
      const braced = buff(e, 'brace');
      hitSquad(sim, s, atk * (braced ? 0.8 : 0.5), e, true); s.morale -= braced ? 22 : 15;
      ev(sim, { k: 'charge', id: s.id, x: e.x, y: e.y, broken: true });
    } else {
      hitSquad(sim, e, atk * 0.9 * s.atkMul, s, true); e.morale -= 14;
      ev(sim, { k: 'charge', id: s.id, x: e.x, y: e.y });
    }
    s.moveT = 0;
  }
  const fl = flankOf(s, e);
  if (fl) { ev(sim, { k: 'flank', id: s.id, x: e.x, y: e.y, rear: fl === 2 }); e.morale -= fl === 2 ? 10 : 5; }
}
function face(s, t) { s.dir = Math.atan2(t.y - s.y, t.x - s.x); }

function shoot(sim, s, foe) {
  let dmg = 0;
  for (const so of s.soldiers) if (so.alive) dmg += so.atk;
  const f = FORMATIONS[s.formation], fb = FORMATIONS[foe.formation];
  dmg *= s.atkMul * (f.ranged || 1) * (fb.arrowGuard || 1) * (0.6 + 0.4 * s.morale / 100) * 0.039;
  if (buff(foe, 'smoke')) dmg *= 0.3;
  if (sim.weather === 'storm') dmg *= 0.75; else if (sim.weather === 'blizzard') dmg *= 0.85;
  const ts = TERRAIN[terrainAt(sim.field, s.x, s.y)], tf = TERRAIN[terrainAt(sim.field, foe.x, foe.y)];
  if (ts && ts.range > 1) dmg *= 1.2;
  if (s.side === 'def' && nearWallInside(sim.field, s.x, s.y)) dmg *= 1.3;
  if (tf && tf.cover) dmg *= tf.cover;
  if (onHill(sim, s)) dmg *= 1.15;
  if (buff(foe, 'shields')) dmg *= 0.35;
  if (buff(s, 'fire')) {
    dmg *= 1.35;
    // burning arrows set the ground alight where the enemy stands (not on friends locked in melee, not in a storm)
    if (sim.weather !== 'storm' && foe.state !== 'fight' && ((s._fn = (s._fn || 0) + 1) % 3 === 1)) { sim.fires.push({ x: foe.x, y: foe.y, t: 3.5, r: 1.1, pow: 1.0 * (sim.field.underground ? 0.35 : 1), side: s.side }); }
  }
  if (s.ranged) { s.ammo = Math.max(0, s.ammo - 1); if (s.ammo === 0) ev(sim, { k: 'ammoOut', id: s.id, side: s.side }); }
  ev(sim, { k: 'shot', from: s.id, to: foe.id, fire: buff(s, 'fire') || undefined });
  if (sim.ai[foe.side] && !foe.ranged && !foe.chase && foe.state !== 'rout' && foe.state !== 'fight') foe.chase = s.id;
  hitSquad(sim, foe, dmg, s);
}

function hitSquad(sim, e, dmg, src, raw) {
  const n = liveCount(e);
  if (n === 0) { damageHero(sim, e, dmg); return; }
  let defAvg = 0;
  for (const so of e.soldiers) if (so.alive) defAvg += so.def;
  defAvg = (defAvg / n) * e.defMul * FORMATIONS[e.formation].def * (e.reform ? 0.8 : 1) * (buff(e, 'exposed') ? 0.7 : 1) * (buff(e, 'disordered') ? 0.75 : 1);
  if (!raw) dmg = dmg / (1 + defAvg * 0.11);
  if (e.state === 'climb') dmg *= 1.6;
  if (sim.hills.length && onHill(sim, e)) dmg *= 0.82;
  if (src && src.ranged && e.side === 'def' && nearWallInside(sim.field, e.x, e.y) && !inWalls(sim.field, src.x, src.y)) dmg *= 0.7; // battlements
  if (sim.field.posts.some((p) => p.fort && p.fort.side === e.side && Math.hypot(p.x - e.x, p.y - e.y) < CAP_R + 0.5)) dmg *= 0.6;
  // defenders fight harder on their own ground
  else if (e.side === 'def' && sim.field.posts.some((p) => p.owner === 'def' && Math.hypot(p.x - e.x, p.y - e.y) < CAP_R + 1)) dmg *= 0.72;
  if (dmg > 0.05) sim.lastAction = sim.t;
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
    ev(sim, { k: 'die', id: e.id, idx: so.idx, elite: so.s === 3 ? so.name : null, by: src ? src.id : -1 });
    if (src) src.kills = (src.kills || 0) + 1;
    e.morale -= 55 / Math.max(5, e.soldiers.length) * (so.s === 3 ? 3 : 1);
    if (src) { src.morale = Math.min(100, src.morale + 2.5); src.special = Math.min(1, src.special + 0.02); }
  }
}
function damageHero(sim, e, d) {
  if (!e.heroAlive) { if (liveCount(e) === 0) e.state = 'dead'; return; }
  e.heroHp -= d;
  if (e.heroHp <= 0) { e.heroAlive = false; e.state = 'dead'; ev(sim, { k: 'heroDown', id: e.id }); { const by = sim.squads.find((q) => q.id === e.engaged || q.engaged === e.id); if (by) nemesisWin(sim, by, e); } for (const q of sim.squads) if (q.side === e.side && alive(q)) q.morale -= 15; }
}

function nemesisWin(sim, w, l) {
  if (!isNem(sim, w, l) || sim.nemesisResult.some((r) => r.lose === l.hero)) return;
  sim.nemesisResult.push({ win: w.hero, lose: l.hero });
  ev(sim, { k: 'nemesis', win: w.hero, lose: l.hero, ws: w.id, ls: l.id, x: l.x, y: l.y });
}
// ---------- AI ----------
const COUNTER = { line: 'wedge', square: 'line', wedge: 'square' };
export function aiThink(sim, side, alliesOnly = false) {
  if (sim.tick % 10 !== 0 || sim.winner) return;
  const S = sim.squads.filter((s) => s.side === side && fighting(s) && (!alliesOnly || s.ally));
  if (!S.length) return;
  const enemies = sim.squads.filter((s) => s.side !== side && alive(s));
  const posts = sim.field.posts;
  if (!alliesOnly) {
    aiStratagems(sim, side, S, enemies);
    // computer generals call their reserves once the fight is on
    if (sim.t > 30) for (const q of sim.squads) if (q.side === side && q.state === 'reserve') callReserve(sim, q);
  }
  for (const s of S) aiSkill(sim, s, enemies);
  const seen = enemies.filter((e) => visibleTo(sim, side, e));
  for (const s of S) aiAbility(sim, s, seen);
  aiObjective(sim, side, S, seen);
  // stall breaker: nothing has happened for a while, so force the issue
  if (sim.t - sim.lastAction > 18) {
    for (const s of S) {
      if (s.state === 'fight') continue;
      if (side === 'att') {
        const tgt = posts.filter((p) => p.owner !== 'att').sort((a, b) => dist(a, s) - dist(b, s))[0];
        if (tgt && s.goal !== tgt.id) routeTo(sim, s, tgt.id, false);
      } else {
        const e = enemies.filter((q) => q.state !== 'rout').sort((a, b) => dist(a, s) - dist(b, s))[0];
        if (e) { s.chase = e.id; s.path = []; s.holdFast = false; s.state = 'move'; }
      }
    }
    return;
  }
  for (const s of S) {
    if (s.special >= 1 && enemies.some((e) => dist(e, s) < 6)) castSpecial(sim, s);
    // focus fire: among nearby enemies prefer the weakest (fewest troops, routing, low morale)
    // also: hit enemies already locked with a friend (flank them), pikes go for horsemen, horsemen avoid pikes
    const score = (e) => liveCount(e) + e.morale / 25 + dist(e, s) * 0.8 - (e.state === 'rout' ? 3 : 0)
      - (e.state === 'fight' && e.engaged !== s.id ? 4 : 0) - (s.pike && e.mounted ? 5 : 0) + (s.mounted && e.pike ? 8 : 0);
    const near = seen.filter((e) => dist(e, s) < 4.5).sort((a, b) => score(a) - score(b))[0];
    if (near && !s.reform && s.formCd <= 0 && COUNTER[near.formation] !== s.formation && !s.ranged && (sim.tick / 10 + s.id) % 3 === 0) changeFormation(sim, s, COUNTER[near.formation]);
    if (buff(s, 'confused') || buff(s, 'feint')) continue;
    if (s.ladder || s.state === 'siege' || s.charge || s.dive || buff(s, 'brace')) continue;
    // fall back to camp to recover, then march out again
    if (s.regroup === 1) continue;
    if (s.regroup === 2) {
      if ((s.morale >= 85 && (s.revived >= Math.ceil(s.soldiers.length * 0.3) || !s.soldiers.some((x) => !x.alive))) || sim.t - (s._rgAt || 0) > 28) { s.regroup = 0; s.holdFast = false; }
      else continue;
    }
    if (!s._rgDone && !s.ally && s.state !== 'fight' && S.length > 1 && sim.t < TIME_LIMIT - 70 && (s.morale < 28 || liveCount(s) <= s.soldiers.length * 0.35) && !S.some((q) => q.regroup)) {
      const camp = campOf(sim, side);
      if (camp && dist(s, camp) < 22 && dist(s, camp) > 3 && startRegroup(sim, s)) { s._rgDone = 1; continue; }
    }
    if (s.state === 'fight' || s.state === 'shoot') continue;
    if (s.guard) continue; // guards hold their ground (the sim engages whatever walks in)
    // empty quivers: back to the nearest base to resupply
    if (s.ranged && s.ammo <= 0) s._resup = 1;
    if (s._resup) {
      if (s.ammo >= s.ammoMax * 0.75) s._resup = 0;
      else {
        const p = nearestOwnedPost(sim, s);
        if (p && p.id != null && dist(s, p) > 2 && s.goal !== p.id) routeTo(sim, s, p.id, true);
        continue;
      }
    }
    // already wading into a fight nearby (joined a friend's brawl): don't march it off again
    if (s.chase != null && !s.ranged) { const c = sim.squads.find((q) => q.id === s.chase); if (c && fighting(c) && c.side !== side && dist(c, s) < 9) continue; }
    if (s._obj && sim.obj && !sim.obj.done) {
      if (near && !s.ranged && dist(near, s) < 3) { if (s.chase !== near.id) command(sim, side, { type: 'chase', squad: s.id, target: near.id }); }
      continue;
    }
    s._obj = 0;
    // archers take the high ground when nothing better is near
    if (s.ranged && !near && sim.hills.length) {
      const hl = sim.hills.find((h) => h.owner !== side && dist(h, s) < 9 && !S.some((q) => q !== s && dist(q, h) < HILL_R + 0.5));
      if (hl) { if (!s.rally || Math.hypot(s.rally.x - hl.x, s.rally.y - hl.y) > 0.5) { if (routeToSpot(sim, s, hl.x, hl.y)) { s.forced = false; } } continue; }
      const mine = sim.hills.find((h) => h.owner === side && dist(h, s) < HILL_R + 0.4);
      if (mine && side === 'def' && posts.some((p) => p.owner === 'def' && dist(p, mine) < 8)) continue; // defenders keep their archers up there
    }
    if (side === 'att') {
      // siege: with the gate still standing, some foot squads go over the wall instead
      const R = sim.field.wallRect;
      if (R && sim.t > 18 && canClimb(s) && !s.ranged && sim.gates.some((g) => g.hp > 0) && !sim.ladders.some((l) => l.side === side) && (sim.tick / 10 + s.id) % 6 === 0) {
        const cx = Math.max(R.x0, Math.min(R.x1, s.x)), cy = Math.max(R.y0, Math.min(R.y1, s.y));
        if (Math.hypot(cx - s.x, cy - s.y) < 8 && startLadder(sim, s, cx, cy)) continue;
      }
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
      const R = sim.field.wallRect;
      // behind walls the garrison holds the keep: only foes at (or inside) the walls are worth sallying for
      const nearKeep = (e) => !R || (e.x > R.x0 - 2.5 && e.x < R.x1 + 3.5 && e.y > R.y0 - 2.5 && e.y < R.y1 + 3.5);
      const threats = seen.filter((e) => e.state !== 'rout' && nearKeep(e) && posts.some((p) => p.owner === 'def' && dist(e, p) < 6));
      threats.sort((a, b) => (b.ranged - a.ranged) || (dist(a, s) - dist(b, s)));
      let tgt = threats[0];
      if (guard && home && !s._g0) { s._g0 = 1; setGuard(sim, s, home.x + (s.id % 3) * 0.6 - 0.6, home.y + 0.6, R ? 3.5 : 5); continue; }
      if (guard) tgt = seen.filter((e) => dist(e, home) < 7).sort((a, b) => dist(a, s) - dist(b, s))[0];
      else if (!tgt && !R) {
        const lone = seen.filter((e) => e.state !== 'rout').sort((a, b) => liveCount(a) - liveCount(b))[0];
        if (lone && liveCount(lone) < liveCount(s) * 1.1 && dist(lone, s) < 18) tgt = lone;
      }
      if (tgt) { if (!s.ranged && s.chase !== tgt.id) command(sim, side, { type: 'chase', squad: s.id, target: tgt.id }); continue; }
      const lost = posts.filter((p) => p.owner !== 'def' && !p.camp).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (lost && !guard && !s.path.length) { routeTo(sim, s, lost.id); continue; }
      if (dist(s, home) > 2 && !s.path.length) routeTo(sim, s, home.id);
    }
  }
}

// every troop type's drill, used when it pays off
function aiAbility(sim, s, seen) {
  if (s.abCd > 0 || (sim.tick / 10 + s.id) % 2 !== 0 || s.charge || s.dive || s.regroup || liveCount(s) === 0) return;
  const d = (e) => dist(e, s), k = s.abil;
  let go = false, c = {};
  if (k === 'charge') {
    if (s.state === 'fight' || s.reform) return;
    const t = seen.filter((e) => e.state !== 'rout' && d(e) > 2.5 && d(e) < 8 && !(e.pike && (buff(e, 'brace') || e.formation === 'square'))).sort((a, b) => (b.ranged - a.ranged) || (d(a) - d(b)))[0];
    if (t) { go = true; const dd = d(t); c = { x: s.x + (t.x - s.x) / dd * Math.min(CHARGE_LEN, dd + 2), y: s.y + (t.y - s.y) / dd * Math.min(CHARGE_LEN, dd + 2) }; }
  } else if (k === 'brace') go = seen.some((e) => e.mounted && e.state !== 'rout' && d(e) < 4.5) && s.state !== 'move';
  else if (k === 'fire') go = s.state === 'shoot' && s.ammo > 5;
  else if (k === 'shields') go = s.state !== 'fight' && seen.some((e) => e.ranged && e.ammo > 0 && d(e) < RANGE + 0.5) && !seen.some((e) => !e.ranged && d(e) < 2.5);
  else if (k === 'blast') go = seen.some((e) => d(e) < 7 && liveCount(e) >= 3);
  else if (k === 'roar') go = seen.filter((e) => d(e) < 3.6).length >= 1 && (s.state === 'fight' || seen.some((e) => d(e) < 3.6 && e.morale < 50));
  else if (k === 'dive') go = seen.some((e) => e.ranged && d(e) < 10) || (s.state !== 'fight' && seen.some((e) => d(e) < 6));
  if (go) useAbility(sim, s, c);
}
// one squad goes after the side objective (escort the caravan, burn or guard the supplies, free the captive)
function aiObjective(sim, side, S, seen) {
  const O = sim.obj;
  if (!O || O.done || (sim.tick / 10) % 3 !== 0 || sim.t < 6) return;
  if (O.kind === 'supplies' && side === 'def') {
    // the defenders post a guard on their stores once attackers come near
    if (!seen.some((e) => Math.hypot(e.x - O.x, e.y - O.y) < 10) || S.some((q) => q._obj)) return;
  }
  let q = S.find((x) => x._obj);
  if (!q) {
    const cands = S.filter((x) => !x.ranged && !x.ally && !x.guard && !x.regroup && !x.ladder && x.state !== 'fight' && liveCount(x) >= 3 && Math.hypot(x.x - O.x, x.y - O.y) < 18);
    if (cands.length < (side === 'att' ? 2 : 1) && S.length > 1) return; // never strip the main effort bare
    q = cands.sort((a, b) => Math.hypot(a.x - O.x, a.y - O.y) - Math.hypot(b.x - O.x, b.y - O.y))[0];
    if (!q) return;
    q._obj = 1;
  }
  const dd = Math.hypot(q.x - O.x, q.y - O.y);
  if (O.kind === 'supplies' && side === 'def') { if (!q.guard) setGuard(sim, q, O.x, O.y, 3); return; }
  if (dd > (O.kind === 'caravan' ? 1.4 : 0.9) && (!q.rally || Math.hypot(q.rally.x - O.x, q.rally.y - O.y) > 1 || !q.path.length)) {
    if (!routeToSpot(sim, q, O.x, O.y)) { q.path = [{ x: O.x, y: O.y }]; q.forced = true; }
  }
}
function aiSkill(sim, s, enemies) {
  if (!s.role || s.skillCd > 0 || !s.heroAlive || (sim.tick / 10 + s.id) % 4 !== 0) return;
  const friends = sim.squads.filter((q) => q.side === s.side && fighting(q) && dist(q, s) < 6.5);
  let go = false;
  if (s.role === 'commander') go = friends.some((q) => q.morale < 45);
  else if (s.role === 'duelist') go = !sim.duel && enemies.some((e) => e.heroAlive && dist(e, s) < 5) && s.heroHp > s.heroMax * 0.5;
  else if (s.role === 'strategist') go = sim.strat[s.side].pool < 4 && sim.strat[s.side].list.some((x) => !x.used);
  else if (s.role === 'scout') go = sim.fog > 0 || (s.state === 'move' && sim.t > 10);
  if (go) useSkill(sim, s);
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
  // side objective: { kind: 'caravan'|'supplies'|'captive', done, by: 'att'|'def'|null } (null when the field had none)
  const objective = sim.obj ? { kind: sim.obj.kind, done: !!sim.obj.done, by: sim.obj.by || null } : null;
  return { winner: sim.winner, heroes, retreated: sim.retreat, treachery, nemesisResult: sim.nemesisResult.slice(), objective, night: !!sim.night };
}

// queued waypoints as world points (posts resolved), for drawing
export function queuePoints(sim, s) {
  return (s.queue || []).map((q) => (q.post != null ? [sim.field.posts[q.post].x, sim.field.posts[q.post].y] : [+q.x.toFixed(1), +q.y.toFixed(1)]));
}
// ---------- network snapshot ----------
export function snapshot(sim) {
  return {
    t: sim.t, w: sim.winner, r: sim.retreat, fog: Math.min(sim.fog, 600), wx: sim.weather,
    p: sim.field.posts.map((p) => [p.owner, Math.round(p.prog * 100), p.by, p.fort ? p.fort.side : 0]),
    b: sim.field.blocked.slice(),
    f: sim.fires.map((f) => [+f.x.toFixed(1), +f.y.toFixed(1), +f.t.toFixed(1), f.r]),
    st: { att: [sim.strat.att.pool, sim.strat.att.list.map((x) => (x.used ? 1 : 0))], def: [sim.strat.def.pool, sim.strat.def.list.map((x) => (x.used ? 1 : 0))] },
    s: sim.squads.map((s) => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.dir.toFixed(2), s.state, s.formation, Math.round(s.morale), +s.special.toFixed(2),
      s.heroAlive ? Math.round(s.heroHp) : -1, s.soldiers.map((x) => (x.alive ? Math.max(1, Math.round(x.hp)) : 0)), s.goal ?? -1,
      s.reform ? [s.reform.to, +(s.reform.t / s.reform.total).toFixed(2)] : 0, Object.keys(s.buffs).filter((k) => s.buffs[k] > 0).join(','), s.side,
      Math.ceil(s.skillCd), queuePoints(sim, s), s.rally ? [+s.rally.x.toFixed(1), +s.rally.y.toFixed(1)] : 0, s.holdFast ? 1 : 0, s.chase ?? -1,
      s.path.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]),
      Math.ceil(s.abCd || 0), s.ammo || 0, s.guard ? [s.guard.x, s.guard.y, s.guard.r] : 0, s.regroup || 0,
      s.charge ? [s.charge.x0, s.charge.y0, s.charge.x, s.charge.y] : 0, s.dive ? s.dive.id : -1, s.revived || 0, s.engaged ?? -1]),
    n: sim.night ? 1 : 0,
    hl: sim.hills.map((h) => [h.owner, Math.round(h.prog * 100), h.by]),
    du: sim.duel ? [sim.duel.a, sim.duel.b, sim.duel.round, +sim.duel.rt.toFixed(2), sim.duel.pa ? 1 : 0, sim.duel.pb ? 1 : 0, sim.duel.wins[0], sim.duel.wins[1], sim.duel.edge] : 0,
    ob: sim.obj ? [sim.obj.kind, +sim.obj.x.toFixed(2), +sim.obj.y.toFixed(2), +sim.obj.prog.toFixed(2), sim.obj.done ? 1 : 0, sim.obj.by, sim.obj.pby] : 0,
    g: sim.gates.map((q) => Math.round(q.hp)), l: sim.ladders.map((q) => [q.id, q.x, q.y, q.side]),
    rv: [sim.reveal.att > 0 ? 1 : 0, sim.reveal.def > 0 ? 1 : 0, sim.trapsSeen.att > 0 ? 1 : 0, sim.trapsSeen.def > 0 ? 1 : 0],
    e: sim.events.slice(-50),
  };
}
export function applySnapshot(sim, snap) {
  sim.t = snap.t; sim.winner = snap.w; sim.retreat = snap.r; sim.fog = snap.fog || 0; sim.weather = snap.wx || sim.weather || null;
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
    if (q.length > 14) {
      s.skillCd = q[14]; s._qpts = q[15] || []; s.rally = q[16] ? { x: q[16][0], y: q[16][1] } : null; s.holdFast = !!q[17];
      s.chase = q[18] >= 0 ? q[18] : null; s.path = (q[19] || []).map(([x, y]) => ({ x, y }));
    }
    if (q.length > 20) {
      s.abCd = q[20]; s.ammo = q[21]; s.guard = q[22] ? { x: q[22][0], y: q[22][1], r: q[22][2] } : null; s.regroup = q[23];
      s.charge = q[24] ? { x0: q[24][0], y0: q[24][1], x: q[24][2], y: q[24][3], t: 0, hit: [] } : null; s.dive = q[25] >= 0 ? { id: q[25], t: 0 } : null; s.revived = q[26];
    }
    if (q.length > 27) s.engaged = q[27] >= 0 ? q[27] : null; // the melee matchup arrow on the client
  }
  if (snap.g) snap.g.forEach((hp, i) => { if (sim.gates[i]) sim.gates[i].hp = hp; });
  if (snap.l) sim.ladders = snap.l.map(([id, x, y, side]) => ({ id, x, y, side }));
  if (snap.n != null) sim.night = !!snap.n;
  if (snap.hl) snap.hl.forEach((q, i) => { const h = sim.hills[i]; if (h) { h.owner = q[0]; h.prog = q[1] / 100; h.by = q[2]; } });
  if (snap.du !== undefined) {
    const D = snap.du;
    if (!D) sim.duel = null;
    else {
      if (!sim.duel || sim.duel.a !== D[0] || sim.duel.b !== D[1]) sim.duel = newDuel(D[0], D[1], D[8]);
      Object.assign(sim.duel, { round: D[2], rt: D[3], pa: D[4] ? '?' : null, pb: D[5] ? '?' : null, wins: [D[6], D[7]] });
    }
  }
  if (snap.ob !== undefined) {
    const O = snap.ob;
    if (!O) sim.obj = null;
    else { sim.obj = sim.obj || { kind: O[0] }; Object.assign(sim.obj, { kind: O[0], x: O[1], y: O[2], prog: O[3], done: !!O[4], by: O[5], pby: O[6] }); }
  }
  if (snap.rv) { sim.reveal.att = snap.rv[0]; sim.reveal.def = snap.rv[1]; sim.trapsSeen.att = snap.rv[2]; sim.trapsSeen.def = snap.rv[3]; }
  for (const e of snap.e) if (e.seq > sim.evSeq) { sim.events.push(e); sim.evSeq = e.seq; }
}

// ---------- full save / restore (single-player mid-battle saves) ----------
// The field is rebuilt from the setup's seed; everything that changes during the fight is stored.
const SKIP = new Set(['field', 'rng', 'gates', 'events']);
export function serializeSim(sim) {
  const o = {};
  for (const k of Object.keys(sim)) if (!SKIP.has(k)) o[k] = sim[k];
  o.rngState = sim.rng.state ? sim.rng.state() : 0;
  o.gateHp = sim.gates.map((g) => g.hp);
  o.posts = sim.field.posts.map((p) => [p.owner, p.prog, p.by ?? null, p.fort || null]);
  o.blocked = sim.field.blocked.slice();
  return JSON.parse(JSON.stringify(o));
}
export function deserializeSim(setup, data) {
  const sim = createBattle(setup);
  for (const k of Object.keys(data)) if (!['rngState', 'gateHp', 'posts', 'blocked'].includes(k) && !SKIP.has(k)) sim[k] = data[k];
  if (sim.rng.setState) sim.rng.setState(data.rngState || 0);
  (data.gateHp || []).forEach((hp, i) => { if (sim.gates[i]) sim.gates[i].hp = hp; });
  (data.posts || []).forEach((q, i) => { const p = sim.field.posts[i]; if (!p) return; p.owner = q[0]; p.prog = q[1]; p.by = q[2]; p.fort = q[3]; });
  sim.field.blocked = (data.blocked || []).slice();
  sim.events = [];
  return sim;
}

