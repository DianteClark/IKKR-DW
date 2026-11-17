// Campaign state: kingdoms, territories, heroes, orders and turn resolution.
// The state is plain JSON so it can be saved locally and sent to a peer.
import { makeRng } from '../engine/rng.js';
import { FACTIONS, FACTION_IDS } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import { generateTerrain } from './mapgen.js';
import { kingdomName, KINGDOM_COLORS } from './names.js';
import { makeItem, SLOTS } from './items.js';
import {
  squadCap, recruitCost, squadPower, garrisonPower, territoryIncome, developCost, RANK_XP, LEVEL_XP, unitLevel, HIRE_COST,
} from './rules.js';

const DMG_SPELLS = SPELLS.filter((s) => s.kind === 'damage').map((s) => s.id);
let terrainCache = null;
export function terrainOf(state) {
  if (!terrainCache || terrainCache.seed !== state.seed) terrainCache = { seed: state.seed, t: generateTerrain(state.seed, state.territoryCount) };
  return terrainCache.t;
}

export function rngFor(state, salt = 0) { return makeRng((state.seed ^ (state.turn * 7919) ^ (state.rngTick++ * 104729) ^ salt) >>> 0); }

// ---------- creation ----------
function newId(state) { return state.nextId++; }

export function makeHero(state, rng, fid, kingdom, loc, opts = {}) {
  const F = FACTIONS[fid];
  const gender = rng.chance(0.45) ? 'f' : 'm';
  const nUnits = F.units.length;
  // weight toward low/mid units; high units are rarer
  const unit = opts.unit ?? Math.min(nUnits - 1, Math.floor(Math.pow(rng(), 1.6) * nUnits));
  const boost = opts.ruler ? 2 : 0;
  const hero = {
    id: newId(state), name: uniqueName(state, rng, F) + (rng.chance(0.3) ? ' ' + rng.pick(['the Bold', 'the Red', 'Ironhand', 'the Wise', 'Stormborn', 'the Grim', 'Oathkeeper', 'the Swift', 'Dragonsbane', 'the Elder']) : ''),
    fid, gender, portrait: rng.int(0, F.portraits.length - 1), kingdom, loc, unit,
    atk: rng.int(1, 4) + boost, def: rng.int(1, 4) + boost, lead: rng.int(7, 9) + (opts.ruler ? 1 : 0), int: rng.int(1, 4) + boost,
    level: 1 + (opts.level || 0), xp: 0, morale: 70, hp: 100, loyalty: rng.int(55, 95),
    gear: {}, status: opts.status || 'active', captor: -1, formation: rng.pick(['wedge', 'line', 'square']),
    spell: rng.pick(DMG_SPELLS), order: null, troops: [],
  };
  for (let i = 0; i < (opts.level || 0); i++) levelUp(hero, rng);
  const cap = squadCap(hero);
  const n = opts.troops ?? Math.max(4, cap - rng.int(0, 2));
  for (let i = 0; i < n; i++) hero.troops.push({ s: 1, r: rng.chance(0.3) ? 1 : 0, xp: 0 });
  state.heroes.push(hero);
  return hero;
}

function uniqueName(state, rng, F) {
  const used = new Set(state.heroes.map((x) => x.name.split(' ')[0]));
  const free = F.names.filter((n) => !used.has(n));
  return rng.pick(free.length ? free : F.names);
}

function levelUp(hero, rng) {
  const k = rng.pick(['atk', 'atk', 'def', 'def', 'int', 'lead']);
  if (k === 'lead') hero.lead = Math.min(14, hero.lead + 1); else hero[k] += 1;
  hero[rng.pick(['atk', 'def', 'int'])] += 1;
}

export function giveItem(state, rng, kid, tier) {
  const it = makeItem(rng, newId(state), tier);
  state.items[it.id] = it;
  state.kingdoms[kid].items.push(it.id);
  return it;
}

// players: [{fid}] — each gets a one-territory start far from the other
export function createWorld(seed, players, opts = {}) {
  const territoryCount = opts.territories || 44;
  const state = {
    v: 1, seed, territoryCount, turn: 1, nextId: 1, rngTick: 0, mode: players.length > 1 ? 'p2p' : 'single',
    territories: [], kingdoms: [], heroes: [], items: {}, log: [], players: [], pendingCaptives: [], over: null,
  };
  const T = terrainOf(state);
  const rng = makeRng(seed ^ 0xabcdef);
  state.territories = T.territories.map((t) => ({ id: t.id, name: t.name, cx: t.cx, cy: t.cy, biome: t.biome, nb: t.nb, owner: -1, level: rng.int(0, 1), ruined: 0 }));
  const terrs = state.territories;
  const dist = (a, b) => Math.hypot(terrs[a].cx - terrs[b].cx, terrs[a].cy - terrs[b].cy);

  // player starts: far apart
  const starts = [];
  const order = rng.shuffle(terrs.map((t) => t.id));
  for (const p of players) {
    let best = order[0], bd = -1;
    for (const id of order) {
      if (starts.includes(id)) continue;
      const d = starts.length ? Math.min(...starts.map((s) => dist(s, id))) : rng() * 10;
      if (d > bd) { bd = d; best = id; }
    }
    starts.push(best);
  }

  // AI kingdom capitals by farthest-point sampling from the player starts
  const K = opts.kingdoms || 15;
  const capitals = [...starts];
  while (capitals.length < K + starts.length) {
    let best = -1, bd = -1;
    for (const t of terrs) {
      if (capitals.includes(t.id)) continue;
      const d = Math.min(...capitals.map((c) => dist(c, t.id))) * (0.75 + rng() * 0.5);
      if (d > bd) { bd = d; best = t.id; }
    }
    capitals.push(best);
  }
  let colorI = 0;
  const mkKingdom = (fid, cap, player) => {
    const k = { id: state.kingdoms.length, name: kingdomName(rng, terrs[cap].name), fid, color: KINGDOM_COLORS[colorI++ % KINGDOM_COLORS.length], gold: player >= 0 ? 600 : 500, alive: true, player, ruler: -1, capital: cap, items: [] };
    state.kingdoms.push(k);
    terrs[cap].owner = k.id;
    return k;
  };
  players.forEach((p, i) => {
    const k = mkKingdom(p.fid, starts[i], i);
    k.name = p.name || k.name;
    terrs[starts[i]].level = 1;
    state.players.push({ kingdom: k.id });
  });
  for (let i = starts.length; i < capitals.length; i++) {
    const cap = capitals[i];
    const fits = FACTION_IDS.filter((f) => FACTIONS[f].biomes.includes(terrs[cap].biome));
    const fid = fits.length && rng.chance(0.75) ? rng.pick(fits) : rng.pick(FACTION_IDS);
    mkKingdom(fid, cap, -1);
  }
  // grow AI kingdoms with uneven quotas (large and small realms); players stay at 1 territory
  const quota = state.kingdoms.map((k) => (k.player >= 0 ? 0 : rng.pick([0, 1, 1, 2, 2, 3, 4, 5])));
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of rng.shuffle([...state.kingdoms])) {
      if (quota[k.id] <= 0) continue;
      const frontier = terrs.filter((t) => t.owner === k.id).flatMap((t) => t.nb).filter((n) => terrs[n].owner < 0);
      if (!frontier.length) { quota[k.id] = 0; continue; }
      terrs[rng.pick(frontier)].owner = k.id; quota[k.id]--; grew = true;
    }
  }
  // leftover land → independent minor realms (one territory each) or absorbed by a neighbor
  for (const t of terrs) {
    if (t.owner >= 0) continue;
    const owners = t.nb.map((n) => terrs[n].owner).filter((o) => o >= 0 && state.kingdoms[o].player < 0);
    if (owners.length && rng.chance(0.55)) t.owner = rng.pick(owners);
    else {
      const fits = FACTION_IDS.filter((f) => FACTIONS[f].biomes.includes(t.biome));
      mkKingdom(fits.length ? rng.pick(fits) : rng.pick(FACTION_IDS), t.id, -1);
    }
  }
  // second pass for any still unowned (neighbor of a fresh minor)
  for (const t of terrs) if (t.owner < 0) mkKingdom(rng.pick(FACTION_IDS), t.id, -1);

  // heroes for AI kingdoms
  for (const k of state.kingdoms) {
    if (k.player >= 0) continue;
    const owned = terrs.filter((t) => t.owner === k.id);
    terrs[k.capital].level = Math.min(3, 1 + Math.floor(owned.length / 2));
    const n = Math.max(1, Math.round(owned.length * 1.2));
    for (let i = 0; i < n; i++) {
      const h = makeHero(state, rng, k.fid, k.id, i === 0 ? k.capital : rng.pick(owned).id, { ruler: i === 0, level: rng.int(0, 1) });
      if (i === 0) k.ruler = h.id;
    }
    k.gold = 300 + owned.length * 120;
  }
  // player candidates: 6 heroes of their race to pick 2-3 from
  state.players.forEach((p, i) => {
    const k = state.kingdoms[p.kingdom];
    p.candidates = [];
    const usedUnits = new Set();
    for (let j = 0; j < 6; j++) {
      let unit;
      do { unit = rng.int(0, FACTIONS[k.fid].units.length - 1); } while (usedUnits.has(unit) && usedUnits.size < FACTIONS[k.fid].units.length);
      usedUnits.add(unit);
      const h = makeHero(state, rng, k.fid, k.id, k.capital, { status: 'candidate', unit, ruler: j === 0 });
      p.candidates.push(h.id);
    }
    for (let j = 0; j < 3; j++) giveItem(state, rng, k.id, 0);
  });
  // a few vagabonds roam from the start
  for (let i = 0; i < 4; i++) makeHero(state, rng, rng.pick(FACTION_IDS), -1, rng.pick(terrs).id, { status: 'vagabond' });
  log(state, 'The age of war begins.');
  return state;
}

// player picks 2-3 of their candidates
export function confirmPicks(state, playerIdx, heroIds) {
  const p = state.players[playerIdx];
  const k = state.kingdoms[p.kingdom];
  const rng = rngFor(state, 77 + playerIdx);
  for (const id of p.candidates) {
    const h = state.heroes[heroIndex(state, id)];
    if (heroIds.includes(id)) { h.status = 'active'; h.loyalty = 100; }
    else { h.status = 'vagabond'; h.kingdom = -1; h.loc = rng.pick(state.territories).id; }
  }
  k.ruler = heroIds[0];
  p.picked = true;
  delete p.candidates;
}

// ---------- queries ----------
const idxCache = new WeakMap();
export function heroIndex(state, id) {
  let m = idxCache.get(state.heroes);
  if (!m || m.size !== state.heroes.length) { m = new Map(state.heroes.map((h, i) => [h.id, i])); idxCache.set(state.heroes, m); }
  return m.get(id);
}
export function hero(state, id) { const i = heroIndex(state, id); return i == null ? null : state.heroes[i]; }
export function heroesAt(state, tid, kid) { return state.heroes.filter((h) => h.status === 'active' && h.loc === tid && (kid == null || h.kingdom === kid)); }
export function kingdomHeroes(state, kid) { return state.heroes.filter((h) => h.status === 'active' && h.kingdom === kid); }
export function kingdomTerritories(state, kid) { return state.territories.filter((t) => t.owner === kid); }
export function captivesOf(state, kid) { return state.heroes.filter((h) => h.status === 'captive' && h.captor === kid); }
export function vagabondsIn(state, tid) { return state.heroes.filter((h) => h.status === 'vagabond' && h.loc === tid); }
export function log(state, text, kid = -1) { state.log.push({ turn: state.turn, text, kid }); if (state.log.length > 300) state.log.splice(0, state.log.length - 300); }
export function playerKingdom(state, playerIdx) { const p = state.players[playerIdx]; return p ? state.kingdoms[p.kingdom] : null; }

export function validTargets(state, h) {
  const t = state.territories[h.loc];
  return t.nb.filter((n) => state.territories[n].owner !== h.kingdom);
}
export function validMoves(state, h) {
  const t = state.territories[h.loc];
  return t.nb.filter((n) => state.territories[n].owner === h.kingdom);
}

// ---------- orders ----------
// order: {type:'attack'|'move'|'rest'|'drill'|'recruit', target?}
export function setOrder(state, heroId, order) {
  const h = hero(state, heroId);
  if (!h || h.status !== 'active') return false;
  if (order && order.type === 'attack' && !validTargets(state, h).includes(order.target)) return false;
  if (order && order.type === 'move' && !validMoves(state, h).includes(order.target)) return false;
  h.order = order;
  return true;
}

export function recruitPrice(h) { return Math.max(0, squadCap(h) - h.troops.length) * recruitCost(h.fid, h.unit); }

export function develop(state, kid, tid) {
  const t = state.territories[tid], k = state.kingdoms[kid];
  if (t.owner !== kid || t.level >= 3) return false;
  const c = developCost(t);
  if (k.gold < c) return false;
  k.gold -= c; t.level++; t.ruined = 0;
  log(state, `${k.name} developed ${t.name} (level ${t.level}).`, kid);
  return true;
}

export function hireVagabond(state, kid, heroId) {
  const h = hero(state, heroId), k = state.kingdoms[kid];
  if (!h || h.status !== 'vagabond' || state.territories[h.loc].owner !== kid || k.gold < HIRE_COST) return false;
  k.gold -= HIRE_COST; h.status = 'active'; h.kingdom = kid; h.loyalty = 60; h.order = null;
  log(state, `${h.name} swore loyalty to ${k.name}.`, kid);
  return true;
}

export function equip(state, kid, heroId, itemId) {
  const h = hero(state, heroId), k = state.kingdoms[kid], it = state.items[itemId];
  if (!h || !it || h.kingdom !== kid) return;
  const i = k.items.indexOf(itemId); if (i < 0) return;
  k.items.splice(i, 1);
  if (h.gear[it.slot] != null) k.items.push(h.gear[it.slot]);
  h.gear[it.slot] = itemId;
}
export function unequip(state, kid, heroId, slot) {
  const h = hero(state, heroId), k = state.kingdoms[kid];
  if (!h || h.kingdom !== kid || h.gear[slot] == null) return;
  k.items.push(h.gear[slot]); delete h.gear[slot];
}

export function changeUnit(state, heroId, unit) {
  // switching unit type disbands the squad (fresh recruits next refill)
  const h = hero(state, heroId);
  if (!h || h.unit === unit) return;
  h.unit = unit; h.troops = [];
}

// ---------- troop growth ----------
export function gainTroopXp(h, amount) {
  const promos = [];
  for (const s of h.troops) {
    s.xp += amount;
    const table = RANK_XP[s.s - 1];
    while (s.r < table.length && s.xp >= table[s.r]) {
      if (s.s === 1 && s.r === table.length - 1) { s.s = 2; s.r = 0; s.xp = 0; promos.push('evolve'); break; }
      s.r++; promos.push('rank');
    }
  }
  return promos;
}
export function gainHeroXp(h, amount, rng) {
  h.xp += amount;
  let ups = 0;
  while (h.xp >= LEVEL_XP(h.level)) { h.xp -= LEVEL_XP(h.level); h.level++; levelUp(h, rng); ups++; }
  return ups;
}

// ---------- battles ----------
// Collects this turn's attacks into battles, grouped by attacking kingdom + target.
export function collectBattles(state) {
  const groups = new Map();
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.type !== 'attack') continue;
    const key = h.kingdom + ':' + h.order.target;
    if (!groups.has(key)) groups.set(key, { att: h.kingdom, tid: h.order.target, attackers: [] });
    groups.get(key).attackers.push(h.id);
  }
  return [...groups.values()];
}

// Called right before a battle runs: refreshes defender + validity.
export function prepareBattle(state, b) {
  const t = state.territories[b.tid];
  b.attackers = b.attackers.filter((id) => { const h = hero(state, id); return h && h.status === 'active' && h.kingdom === b.att; });
  if (!b.attackers.length || t.owner === b.att) return null;
  b.def = t.owner;
  b.defenders = heroesAt(state, b.tid, t.owner).map((h) => h.id);
  b.level = t.level; b.biome = t.biome;
  return b;
}

export function isHumanKingdom(state, kid) { return kid >= 0 && state.kingdoms[kid] && state.kingdoms[kid].player >= 0; }

export function autoResolve(state, b) {
  const rng = rngFor(state, b.tid * 31 + b.att);
  const items = state.items;
  const H = (ids) => ids.map((id) => hero(state, id));
  const att = H(b.attackers), def = H(b.defenders);
  const ap = att.reduce((s, h) => s + squadPower(h, items), 0);
  const dp = def.reduce((s, h) => s + squadPower(h, items), 0) + garrisonPower(state.territories[b.tid]) * (def.length ? 0.6 : 1.2);
  const r = ap / (ap + dp);
  const attWins = r + (rng() - 0.5) * 0.3 > 0.5;
  const out = { winner: attWins ? 'att' : 'def', heroes: {} };
  const apply = (list, won, ratio) => {
    for (const h of list) {
      const lossFrac = won ? 0.1 + 0.35 * (1 - ratio) : 0.45 + 0.4 * (1 - ratio);
      const alive = h.troops.map((_, i) => i).filter(() => rng() > lossFrac);
      out.heroes[h.id] = { alive, defeated: !won ? rng() < 0.35 : rng() < 0.04 };
    }
  };
  apply(att, attWins, r);
  apply(def, !attWins, 1 - r);
  return out;
}

// result: { winner:'att'|'def', heroes: { [heroId]: { alive:[troop idx], defeated:bool } }, retreated?:bool }
export function applyBattle(state, b, result) {
  const rng = rngFor(state, b.tid * 17 + 5);
  const t = state.territories[b.tid];
  const attK = state.kingdoms[b.att], defK = b.def >= 0 ? state.kingdoms[b.def] : null;
  const attWon = result.winner === 'att';
  const report = { tid: b.tid, att: b.att, def: b.def, attWon, captured: [], died: [], retreated: [], promoted: 0, evolved: 0, loot: null };
  const settle = (ids, won) => {
    for (const id of ids) {
      const h = hero(state, id); if (!h) continue;
      const r = result.heroes[id] || { alive: h.troops.map((_, i) => i), defeated: false };
      h.troops = r.alive.map((i) => h.troops[i]).filter(Boolean);
      const promos = gainTroopXp(h, won ? 2 : 1);
      report.promoted += promos.filter((p) => p === 'rank').length;
      report.evolved += promos.filter((p) => p === 'evolve').length;
      gainHeroXp(h, won ? 4 : 2, rng);
      h.morale = Math.max(5, Math.min(100, h.morale + (won ? 10 : -18)));
      h.order = null;
      if (r.defeated) h.hp = Math.max(10, h.hp - 45);
      h._defeated = r.defeated;
    }
  };
  settle(b.attackers, attWon);
  settle(b.defenders, !attWon);

  const capture = (h, captorK) => {
    if (rng() < 0.15) { h.status = 'dead'; report.died.push(h.id); log(state, `${h.name} fell in battle at ${t.name}.`); return; }
    h.status = 'captive'; h.captor = captorK; h.kingdom = h.kingdom; h.order = null;
    report.captured.push(h.id);
    log(state, `${h.name} was captured by ${state.kingdoms[captorK].name}.`);
    if (isHumanKingdom(state, captorK)) state.pendingCaptives.push(h.id);
  };

  if (attWon) {
    t.owner = b.att; t.ruined = 2; t.level = Math.max(0, t.level - 1);
    for (const id of b.attackers) { const h = hero(state, id); if (h && h.status === 'active') h.loc = b.tid; }
    for (const id of b.defenders) {
      const h = hero(state, id); if (!h || h.status !== 'active') continue;
      const home = retreatSpot(state, h, b.tid);
      if (h._defeated || home == null) capture(h, b.att);
      else { h.loc = home; report.retreated.push(h.id); }
    }
    const it = giveItem(state, rng, b.att, Math.min(3, Math.floor(state.turn / 8) + (rng.chance(0.3) ? 1 : 0)));
    report.loot = it.id;
    log(state, `${attK.name} conquered ${t.name}${defK ? ' from ' + defK.name : ''}.`);
  } else {
    for (const id of b.attackers) {
      const h = hero(state, id); if (!h || h.status !== 'active') continue;
      if (h._defeated && b.def >= 0 && rng() < 0.6) capture(h, b.def);
    }
    if (defK) { const it = giveItem(state, rng, b.def, Math.min(3, Math.floor(state.turn / 10))); report.loot = it.id; }
    log(state, `${defK ? defK.name : 'The defenders'} held ${t.name} against ${attK.name}.`);
  }
  for (const h of state.heroes) delete h._defeated;
  checkKingdoms(state);
  return report;
}

function retreatSpot(state, h, fromTid) {
  const owned = state.territories.filter((t) => t.owner === h.kingdom && t.id !== fromTid);
  if (!owned.length) return null;
  const from = state.territories[fromTid];
  const nb = owned.filter((t) => from.nb.includes(t.id));
  const pool = nb.length ? nb : owned;
  pool.sort((a, b) => Math.hypot(a.cx - from.cx, a.cy - from.cy) - Math.hypot(b.cx - from.cx, b.cy - from.cy));
  return pool[0].id;
}

// ---------- captives ----------
export function decideCaptive(state, heroId, decision) {
  const h = hero(state, heroId);
  if (!h || h.status !== 'captive') return 'gone';
  const captor = state.kingdoms[h.captor];
  const rng = rngFor(state, heroId * 13);
  state.pendingCaptives = state.pendingCaptives.filter((x) => x !== heroId);
  if (decision === 'execute') { h.status = 'dead'; log(state, `${captor.name} executed ${h.name}.`); return 'executed'; }
  if (decision === 'release') { h.status = 'vagabond'; h.kingdom = -1; h.captor = -1; h.loyalty = rng.int(20, 60); log(state, `${captor.name} released ${h.name}, who now wanders as a vagabond.`); return 'released'; }
  if (decision === 'recruit') {
    const oldK = state.kingdoms[h.kingdom];
    const isRuler = oldK && oldK.ruler === h.id && oldK.alive;
    const chance = (isRuler ? 0.12 : 0.3) + (1 - h.loyalty / 100) * 0.55;
    if (rng() < chance) {
      if (isRuler) oldK.ruler = -1;
      h.status = 'active'; h.kingdom = h.captor; h.captor = -1; h.loyalty = 50; h.loc = captor.capital; h.order = null;
      if (state.territories[h.loc].owner !== captor.id) { const own = kingdomTerritories(state, captor.id); if (own.length) h.loc = own[0].id; }
      log(state, `${h.name} joined ${captor.name}.`);
      checkKingdoms(state);
      return 'joined';
    }
    h.loyalty = Math.max(0, h.loyalty - 15);
    return 'refused';
  }
  return 'kept';
}

// ---------- kingdoms ----------
export function checkKingdoms(state) {
  for (const k of state.kingdoms) {
    if (!k.alive) continue;
    const owned = kingdomTerritories(state, k.id);
    if (!owned.length) {
      k.alive = false;
      log(state, `${k.name} has fallen.`);
      for (const h of state.heroes) if (h.kingdom === k.id && h.status === 'active') { h.status = 'vagabond'; h.kingdom = -1; h.order = null; }
      continue;
    }
    if (!owned.some((t) => t.id === k.capital)) k.capital = owned[0].id;
    const r = hero(state, k.ruler);
    if (!r || r.status !== 'active' || r.kingdom !== k.id) {
      const hs = kingdomHeroes(state, k.id).sort((a, b) => b.level - a.level);
      if (hs.length) { k.ruler = hs[0].id; }
    }
  }
  // victory
  const alivePlayers = state.players.filter((p) => state.kingdoms[p.kingdom].alive);
  const owners = new Set(state.territories.map((t) => t.owner));
  if (owners.size === 1) {
    const w = [...owners][0];
    state.over = { winner: w };
  } else if (!alivePlayers.length) state.over = { winner: -1 };
}

// ---------- end of turn ----------
export function applyOrders(state) {
  // non-combat orders (attacks resolve as battles)
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order) continue;
    const k = state.kingdoms[h.kingdom];
    const o = h.order;
    if (o.type === 'move' && state.territories[o.target].owner === h.kingdom) h.loc = o.target;
    else if (o.type === 'rest') { h.morale = Math.min(100, h.morale + 25); h.hp = Math.min(100, h.hp + 40); }
    else if (o.type === 'drill') { h.morale = Math.min(100, h.morale + 10); gainTroopXp(h, 1); }
    else if (o.type === 'recruit') {
      const cap = squadCap(h), cost = recruitCost(h.fid, h.unit);
      while (h.troops.length < cap && k.gold >= cost) { k.gold -= cost; h.troops.push({ s: 1, r: 0, xp: 0 }); }
      h.morale = Math.min(100, h.morale + 5);
    }
    if (o.type !== 'attack') h.order = null;
  }
}

export function endTurn(state) {
  const rng = rngFor(state, 999);
  const summary = [];
  // income + upkeep
  for (const k of state.kingdoms) {
    if (!k.alive) continue;
    let inc = 0;
    for (const t of kingdomTerritories(state, k.id)) inc += territoryIncome(t);
    k.gold += inc;
  }
  for (const t of state.territories) if (t.ruined > 0) t.ruined--;
  // heroes recover a little, idle morale drifts to 60
  for (const h of state.heroes) {
    if (h.status !== 'active') continue;
    h.hp = Math.min(100, h.hp + 10);
    if (h.morale < 60) h.morale += 3; else if (h.morale > 80) h.morale -= 2;
    h.order = null;
  }
  // captives held by AI
  for (const h of state.heroes) {
    if (h.status !== 'captive' || isHumanKingdom(state, h.captor)) continue;
    const r = rng();
    decideCaptive(state, h.id, r < 0.2 ? 'execute' : r < 0.55 ? 'recruit' : r < 0.8 ? 'release' : 'keep');
  }
  // vagabonds wander, join AI lords, or rise up
  for (const h of state.heroes) {
    if (h.status !== 'vagabond') continue;
    const t = state.territories[h.loc];
    if (rng() < 0.5) h.loc = rng.pick(t.nb);
    const here = state.territories[h.loc];
    const ownerK = here.owner >= 0 ? state.kingdoms[here.owner] : null;
    if (ownerK && ownerK.player < 0 && rng() < 0.1) {
      h.status = 'active'; h.kingdom = ownerK.id; h.loyalty = 55;
      log(state, `The vagabond ${h.name} joined ${ownerK.name}.`);
      continue;
    }
    const defenders = heroesAt(state, here.id, here.owner);
    if (!defenders.length && state.turn > 3 && rng() < 0.07) {
      const win = rng() < (squadPower(h, state.items) / (squadPower(h, state.items) + garrisonPower(here)));
      if (win) {
        const old = ownerK ? ownerK.name : 'nobody';
        const k = { id: state.kingdoms.length, name: `Uprising of ${here.name}`, fid: h.fid, color: KINGDOM_COLORS[state.kingdoms.length % KINGDOM_COLORS.length], gold: 200, alive: true, player: -1, ruler: h.id, capital: here.id, items: [] };
        state.kingdoms.push(k);
        here.owner = k.id; here.ruined = 1;
        h.status = 'active'; h.kingdom = k.id; h.loyalty = 100;
        log(state, `${h.name} led an uprising and seized ${here.name} from ${old}!`);
        summary.push(`Uprising! ${h.name} seized ${here.name}.`);
      } else {
        h.troops = h.troops.slice(0, Math.floor(h.troops.length / 2));
        log(state, `An uprising led by ${h.name} at ${here.name} was crushed.`);
      }
    }
  }
  // a realm with land but no heroes raises a new champion
  for (const k of state.kingdoms) {
    if (!k.alive || kingdomHeroes(state, k.id).length) continue;
    const h = makeHero(state, rng, k.fid, k.id, k.capital, { troops: 5 });
    if (k.ruler < 0 || !hero(state, k.ruler) || hero(state, k.ruler).status !== 'active') k.ruler = h.id;
    log(state, `${h.name} rose to defend ${k.name}.`, k.id);
  }
  // new wanderers now and then
  if (state.turn % 3 === 0) {
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) makeHero(state, rng, rng.pick(FACTION_IDS), -1, rng.pick(state.territories).id, { status: 'vagabond', level: Math.floor(state.turn / 6) });
  }
  checkKingdoms(state);
  state.turn++;
  return summary;
}

export function powerAt(state, tid) {
  const t = state.territories[tid];
  return heroesAt(state, tid, t.owner).reduce((s, h) => s + squadPower(h, state.items), 0) + garrisonPower(t);
}

export { SLOTS, unitLevel };
