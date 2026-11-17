// Campaign state: kingdoms, territories, heroes, orders and battles.
// The state is plain JSON so it can be saved locally and sent to a peer.
import { makeRng } from '../engine/rng.js';
import { FACTIONS, FACTION_IDS, portraitFor, portraitFits } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import { generateTerrain } from './mapgen.js';
import { kingdomName, KINGDOM_COLORS } from './names.js';
import { namesFor } from '../data/givennames.js';
import { randomBanner } from '../engine/banner.js';
import { initNeutral, applyNeutralOrders, validNeutralOrder } from './neutral.js';
import { makeItem, SLOTS } from './items.js';
import {
  squadCap, recruitCost, squadPower, garrisonPower, unitLevel, HIRE_COST, EVOLVE_XP, LEVEL_XP, MAX_LEVEL,
  newSoldier, TIERS, tierIndex, PROMOTE_ELITE_COST, STRATAGEMS, STRATAGEM_IDS, unitClass, CLASS_INFO, ROLE_LEVEL, ROLES,
} from './rules.js';

export const SIZES = {
  small: { territories: 24, kingdoms: 8, label: 'Small' },
  medium: { territories: 44, kingdoms: 15, label: 'Medium' },
  large: { territories: 70, kingdoms: 24, label: 'Large' },
  huge: { territories: 150, kingdoms: 40, label: 'Huge' },
  enormous: { territories: 300, kingdoms: 72, label: 'Enormous' },
};
export const DIFFICULTY = { easy: { aggr: 0.8, bonus: 0.85, grace: 20 }, normal: { aggr: 1, bonus: 1, grace: 12 }, hard: { aggr: 1.2, bonus: 1.2, grace: 7 } };
export const TRAITS = ['loyal', 'proud', 'cunning', 'honorable', 'greedy', 'fierce', 'calm', 'ambitious'];

const DMG_SPELLS = SPELLS.filter((s) => s.kind === 'damage').map((s) => s.id);
let terrainCache = null;
export function terrainOf(state) {
  const key = state.seed + ':' + (state.size || state.territoryCount);
  if (!terrainCache || terrainCache.key !== key) terrainCache = { key, t: generateTerrain(state.seed, state.size ? { size: state.size } : state.territoryCount) };
  return terrainCache.t;
}

export function rngFor(state, salt = 0) { return makeRng((state.seed ^ (state.turn * 7919) ^ (state.rngTick++ * 104729) ^ salt) >>> 0); }
function newId(state) { return state.nextId++; }
export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// ---------- creation ----------
function uniqueName(state, rng, F, list) {
  const pool = list || F.names;
  const used = new Set(state.heroes.map((x) => x.name.split(' ')[0]));
  const free = pool.filter((n) => !used.has(n));
  return rng.pick(free.length ? free : pool);
}
const EPITHETS = ['the Bold', 'the Red', 'Ironhand', 'the Wise', 'Stormborn', 'the Grim', 'Oathkeeper', 'the Swift', 'Dragonsbane', 'the Elder', 'Halfhand', 'the Silent', 'Ashborn', 'the Just'];

export function makeHero(state, rng, fid, kingdom, loc, opts = {}) {
  const F = FACTIONS[fid];
  const gender = opts.gender || (rng.chance(0.45) ? 'f' : 'm');
  const nUnits = F.units.length;
  const maxU = Math.min(nUnits - 1, opts.maxUnit ?? nUnits - 1);
  const unit = opts.unit ?? Math.min(maxU, Math.floor(Math.pow(rng(), 1.6) * (maxU + 1)));
  const boost = opts.ruler ? 2 : 0;
  const hero = {
    id: newId(state), name: (opts.name || uniqueName(state, rng, F, namesFor(fid, gender))) + (!opts.name && rng.chance(0.3) ? ' ' + rng.pick(EPITHETS) : ''),
    fid, ufid: opts.ufid || fid, gender, portrait: portraitFor(fid, gender, rng()), kingdom, origin: kingdom, loc, unit,
    atk: rng.int(1, 4) + boost, def: rng.int(1, 4) + boost, lead: rng.int(7, 9) + (opts.ruler ? 1 : 0), int: rng.int(1, 4) + boost,
    level: 1, xp: 0, morale: 60, hp: 100, loyalty: rng.int(55, 95), trait: opts.trait || rng.pick(TRAITS), ambition: rng.int(10, 90),
    gear: {}, status: opts.status || 'active', captor: -1, formation: rng.pick(['wedge', 'line', 'square']),
    spell: rng.pick(DMG_SPELLS), order: null, troops: [], secret: -1, lentTo: -1, lentTurns: 0,
  };
  for (let i = 0; i < (opts.level || 0); i++) levelUp(hero, rng);
  const cap = squadCap(hero);
  const n = Math.min(cap, opts.troops ?? Math.max(4, cap - rng.int(0, 2)));
  for (let i = 0; i < n; i++) { const s = newSoldier(rng); if (rng.chance(0.25)) s.r = 1; hero.troops.push(s); }
  state.heroes.push(hero);
  return hero;
}

function levelUp(hero, rng) {
  hero.level++;
  const k = rng.pick(['atk', 'atk', 'def', 'def', 'int', 'lead']);
  if (k === 'lead') hero.lead = Math.min(16, hero.lead + 1); else hero[k] += 1;
  hero[rng.pick(['atk', 'def', 'int'])] += 1;
}

export function giveItem(state, rng, kid, tier) {
  const it = makeItem(rng, newId(state), tier);
  state.items[it.id] = it;
  state.kingdoms[kid].items.push(it.id);
  return it;
}

export function newKingdom(state, rng, { fid, cap, player = -1, name, kind = 'realm', tier = 'village', banner = null }) {
  const usedColors = new Set(state.kingdoms.filter((k) => k.alive).map((k) => k.color));
  const color = banner ? banner.bg : KINGDOM_COLORS.find((c) => !usedColors.has(c)) || KINGDOM_COLORS[state.kingdoms.length % KINGDOM_COLORS.length];
  const k = {
    id: state.kingdoms.length, name: name || kingdomName(rng, state.territories[cap].name), fid, color, kind,
    gold: player >= 0 ? 800 : 500, food: 120, morale: 60, stability: 60, tier,
    buildings: {}, policy: { tax: 'normal', rations: 'normal' }, edictTurn: -1,
    troopRaces: [fid], alive: true, landless: false, player, ruler: -1, capital: cap, items: [], rel: {}, intel: {}, loadout: [],
    banner: banner || randomBanner(rng, color),
  };
  state.kingdoms.push(k);
  if (cap != null && cap >= 0) state.territories[cap].owner = k.id;
  return k;
}

// players: [{fid}] — each gets a one-territory start far from the others
export function createWorld(seed, players, opts = {}) {
  const size = opts.size || 'medium';
  const conf = SIZES[size] || SIZES.medium;
  const state = {
    v: 2, seed, size, territoryCount: conf.territories, difficulty: opts.difficulty || 'normal', turn: 1, nextId: 1, rngTick: 0,
    mode: players.length > 1 ? 'p2p' : 'single', territories: [], kingdoms: [], heroes: [], items: {}, log: [], players: [],
    pendingCaptives: [], treaties: [], events: [], over: null, dialogue: [], demands: [], proposals: [],
  };
  const T = terrainOf(state);
  const rng = makeRng(seed ^ 0xabcdef);
  state.territories = T.territories.map((t) => ({ id: t.id, name: t.name, cx: t.cx, cy: t.cy, biome: t.biome, nb: t.nb, owner: -1, level: rng.int(0, 1), ruined: 0, race: null, fx: [] }));
  const terrs = state.territories;
  const dist = (a, b) => Math.hypot(terrs[a].cx - terrs[b].cx, terrs[a].cy - terrs[b].cy);

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
  const capitals = [...starts];
  while (capitals.length < conf.kingdoms + starts.length && capitals.length < terrs.length) {
    let best = -1, bd = -1;
    for (const t of terrs) {
      if (capitals.includes(t.id)) continue;
      const d = Math.min(...capitals.map((c) => dist(c, t.id))) * (0.75 + rng() * 0.5);
      if (d > bd) { bd = d; best = t.id; }
    }
    capitals.push(best);
  }
  // Most realms begin as a one-land village with 3 heroes. A few great kingdoms start with several lands and
  // 5 heroes: the powers everyone else should steer clear of until they've grown.
  const villageName = (cap) => `Village of ${terrs[cap].name}`;
  players.forEach((p, i) => {
    const k = newKingdom(state, rng, { fid: p.fid, cap: starts[i], player: i, name: p.name || villageName(starts[i]), banner: p.banner || null });
    terrs[starts[i]].level = 1;
    state.players.push({ kingdom: k.id });
  });
  const greatN = { small: 1, medium: 2, large: 3, huge: 5, enormous: 9 }[size] || 2;
  // great kingdoms take the capitals farthest from every player
  const aiCaps = capitals.slice(starts.length);
  const farFromPlayers = (id) => Math.min(...starts.map((s) => dist(s, id)));
  const greatCaps = new Set([...aiCaps].sort((a, b) => farFromPlayers(b) - farFromPlayers(a)).slice(0, greatN));
  for (const cap of aiCaps) {
    const fits = FACTION_IDS.filter((f) => FACTIONS[f].biomes.includes(terrs[cap].biome));
    const great = greatCaps.has(cap);
    const fid = fits.length && rng.chance(0.75) ? rng.pick(fits) : rng.pick(FACTION_IDS);
    const k = newKingdom(state, rng, { fid, cap, tier: great ? 'kingdom' : 'village', name: great ? undefined : villageName(cap) });
    k.great = great;
  }
  const quota = state.kingdoms.map((k) => (k.player >= 0 ? 0 : k.great ? rng.int(4, 5) : rng.chance(0.3) ? 1 : 0));
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
  // whatever no realm claimed stays free: neutral hamlets between the powers (about a third of the world)
  for (const t of terrs) {
    if (t.owner >= 0) continue;
    const owners = t.nb.map((n) => terrs[n].owner).filter((o) => o >= 0 && state.kingdoms[o].player < 0 && !state.kingdoms[o].great && terrs.filter((x) => x.owner === o).length < 2);
    if (owners.length && rng.chance(0.15)) t.owner = rng.pick(owners);
  }
  for (const t of terrs) {
    if (t.owner >= 0) { t.race = state.kingdoms[t.owner].fid; continue; }
    const fits = FACTION_IDS.filter((f) => FACTIONS[f].biomes.includes(t.biome));
    t.race = fits.length ? rng.pick(fits) : rng.pick(FACTION_IDS);
  }

  const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
  for (const k of state.kingdoms) {
    if (k.player >= 0) continue;
    const owned = terrs.filter((t) => t.owner === k.id);
    if (k.great) k.buildings = { spies: true };
    terrs[k.capital].level = k.great ? 3 : 1;
    const n = k.great ? Math.round(5 * diff.bonus) : 3;
    const maxU = TIERS[tierIndex(k)].maxUnitLevel;
    for (let i = 0; i < n; i++) {
      const h = makeHero(state, rng, k.fid, k.id, i === 0 ? k.capital : rng.pick(owned).id, { ruler: i === 0, level: k.great ? rng.int(1, 2) : rng.int(0, 1), maxUnit: maxU });
      if (i === 0) k.ruler = h.id;
    }
    k.gold = Math.round((300 + owned.length * 120) * diff.bonus);
    k.food = 100 + owned.length * 30;
    k.loadout = pickLoadout(k, rng);
  }
  state.players.forEach((p) => {
    const k = state.kingdoms[p.kingdom];
    p.candidates = [];
    const usedUnits = new Set();
    for (let j = 0; j < 6; j++) {
      let unit;
      do { unit = rng.int(0, 2); } while (usedUnits.has(unit) && usedUnits.size < 3);
      usedUnits.add(unit);
      const h = makeHero(state, rng, k.fid, k.id, k.capital, { status: 'candidate', unit, ruler: j === 0, troops: 5 });
      p.candidates.push(h.id);
    }
    for (let j = 0; j < 3; j++) giveItem(state, rng, k.id, 0);
    k.loadout = ['rally'];
  });
  for (let i = 0; i < Math.round(conf.territories / 10); i++) makeHero(state, rng, rng.pick(FACTION_IDS), -1, rng.pick(terrs).id, { status: 'vagabond' });
  initNeutral(state, T, rng);
  log(state, 'The age of war begins.');
  return state;
}

// older saves: give every hero a face that matches their gender
export function fixPortraits(state) {
  for (const h of state.heroes) if (!portraitFits(h.fid, h.gender, h.portrait)) h.portrait = (h.portrait % 20) + (h.gender === 'f' ? 20 : 0);
  // older saves: every realm gets a banner
  for (const k of state.kingdoms) if (!k.banner) k.banner = randomBanner(makeRng((state.seed ^ (k.id * 7919)) >>> 0), k.color);
}

export function pickLoadout(k, rng) {
  const tier = TIERS[tierIndex(k)];
  const pool = STRATAGEM_IDS.filter((id) => STRATAGEMS[id].tier <= tier.stratTier);
  return rng.shuffle([...pool]).slice(0, tier.stratSlots + (k.buildings && k.buildings.council ? 1 : 0));
}

export function confirmPicks(state, playerIdx, heroIds) {
  const p = state.players[playerIdx];
  const k = state.kingdoms[p.kingdom];
  const rng = rngFor(state, 77 + playerIdx);
  for (const id of p.candidates) {
    const h = hero(state, id);
    if (heroIds.includes(id)) { h.status = 'active'; h.loyalty = 90; }
    else { h.status = 'vagabond'; h.kingdom = -1; h.origin = -1; h.loc = rng.pick(state.territories).id; }
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
export function heroesAt(state, tid, kid) { return state.heroes.filter((h) => h.status === 'active' && h.loc === tid && h.lentTo < 0 && (kid == null || h.kingdom === kid)); }
export function kingdomHeroes(state, kid, includeLent = false) { return state.heroes.filter((h) => h.status === 'active' && h.kingdom === kid && (includeLent || h.lentTo < 0)); }
export function kingdomTerritories(state, kid) { return state.territories.filter((t) => t.owner === kid); }
export function captivesOf(state, kid) { return state.heroes.filter((h) => h.status === 'captive' && h.captor === kid); }
export function vagabondsIn(state, tid) { return state.heroes.filter((h) => h.status === 'vagabond' && h.loc === tid); }
export function totalTroops(state, kid) { return kingdomHeroes(state, kid, true).reduce((n, h) => n + h.troops.length, 0); }
export function log(state, text, kid = -1, kind = '') { state.log.push({ turn: state.turn, text, kid, kind }); if (state.log.length > 400) state.log.splice(0, state.log.length - 400); }
export function playerKingdom(state, playerIdx) { const p = state.players[playerIdx]; return p ? state.kingdoms[p.kingdom] : null; }
export function isHumanKingdom(state, kid) { return kid >= 0 && state.kingdoms[kid] && state.kingdoms[kid].player >= 0; }

export function treaty(state, a, b, type) {
  return state.treaties.find((t) => (!type || t.type === type) && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function allied(state, a, b) { return a === b || !!treaty(state, a, b, 'alliance'); }
export function overlordOf(state, kid) { const t = state.treaties.find((x) => x.type === 'vassal' && x.b === kid); return t ? t.a : -1; }
export function friendly(state, a, b) {
  if (a < 0 || b < 0) return false;
  if (a === b || allied(state, a, b)) return true;
  const oa = overlordOf(state, a), ob = overlordOf(state, b);
  return oa === b || ob === a || (oa >= 0 && oa === ob) || (oa >= 0 && allied(state, oa, b)) || (ob >= 0 && allied(state, ob, a));
}

// sea lanes need a Harbour (or flyers, or a wandering warband)
export function isSeaLink(state, a, b) {
  if (!state._sea) { state._sea = new Set(); for (const [x, y] of terrainOf(state).seaLinks || []) { state._sea.add(x + ':' + y); state._sea.add(y + ':' + x); } Object.defineProperty(state, '_sea', { enumerable: false, value: state._sea, writable: true }); }
  return state._sea.has(a + ':' + b);
}
export function canSail(state, h) {
  const k = state.kingdoms[h.kingdom];
  return !!(k.landless || (k.buildings && k.buildings.harbour) || unitClass(h.ufid || h.fid, h.unit) === 'flying');
}
const reach = (state, h, from) => state.territories[from].nb.filter((n) => !isSeaLink(state, from, n) || canSail(state, h));
export function validTargets(state, h) {
  const k = state.kingdoms[h.kingdom];
  const t = state.territories[h.loc];
  if (k.landless) return t.owner !== h.kingdom && !friendly(state, h.kingdom, t.owner) ? [t.id] : []; // a warband rises up where it stands
  return reach(state, h, t.id).filter((n) => { const o = state.territories[n].owner; return o !== h.kingdom && !friendly(state, h.kingdom, o); });
}
export function validMoves(state, h) {
  const k = state.kingdoms[h.kingdom];
  const t = state.territories[h.loc];
  if (k.landless) return t.nb; // wanderers go anywhere
  const safe = (n) => { const o = state.territories[n].owner; return o < 0 || o === h.kingdom || friendly(state, h.kingdom, o); };
  const one = reach(state, h, t.id).filter(safe);
  if (unitClass(h.ufid || h.fid, h.unit) !== 'mounted') return one;
  // riders cover two lands in a season through safe ground
  const two = new Set(one);
  for (const n of one) for (const m of reach(state, h, n)) if (m !== t.id && safe(m)) two.add(m);
  return [...two];
}
export function validSpyTargets(state, h) {
  const k = state.kingdoms[h.kingdom];
  if (!k.buildings.spies) return [];
  return validTargets(state, h);
}
// unit types this hero may lead: any race the realm can raise, up to the realm's tier
export function troopOptions(state, h) {
  const k = state.kingdoms[h.kingdom];
  const maxL = TIERS[tierIndex(k)].maxUnitLevel;
  const out = [];
  for (const fid of k.troopRaces) FACTIONS[fid].units.forEach((u, i) => {
    if (unitLevel(fid, i) > maxL) return;
    const cls = unitClass(fid, i), need = CLASS_INFO[cls].building;
    out.push({ fid, ui: i, cls, locked: need && !(k.buildings && k.buildings[need]) ? need : null });
  });
  return out;
}

// ---------- orders ----------
// order: {type:'attack'|'move'|'rest'|'drill'|'spy', target?}
export function setOrder(state, heroId, order) {
  const h = hero(state, heroId);
  if (!h || h.status !== 'active' || h.lentTo >= 0) return false;
  if (order && order.type === 'attack' && !validTargets(state, h).includes(order.target)) return false;
  if (order && order.type === 'move' && !validMoves(state, h).includes(order.target)) return false;
  if (order && order.type === 'spy' && !validSpyTargets(state, h).includes(order.target)) return false;
  if (order && ['plunder', 'protect', 'explore', 'court'].includes(order.type) && !validNeutralOrder(state, h, order)) return false;
  h.order = order;
  return true;
}

export function restPrice(state, h) {
  const k = state.kingdoms[h.kingdom];
  return Math.round(Math.max(0, squadCap(h, k) - h.troops.length) * recruitCost(h.ufid, h.unit) * (k.landless ? 1.6 : 1));
}

export function equip(state, kid, heroId, itemId) {
  const h = hero(state, heroId), k = state.kingdoms[kid], it = state.items[itemId];
  if (!h || !it || h.kingdom !== kid) return;
  const i = k.items.indexOf(itemId); if (i < 0) return;
  k.items.splice(i, 1);
  if (h.gear[it.slot] != null) k.items.push(h.gear[it.slot]);
  h.gear[it.slot] = itemId;
  h.loyalty = Math.min(100, h.loyalty + 2);
}
export function unequip(state, kid, heroId, slot) {
  const h = hero(state, heroId), k = state.kingdoms[kid];
  if (!h || h.kingdom !== kid || h.gear[slot] == null) return;
  k.items.push(h.gear[slot]); delete h.gear[slot];
}
export function changeUnit(state, heroId, ufid, unit) {
  const h = hero(state, heroId);
  if (!h || (h.unit === unit && h.ufid === ufid)) return false;
  if (!troopOptions(state, h).some((o) => o.fid === ufid && o.ui === unit && !o.locked)) return false;
  h.ufid = ufid; h.unit = unit; h.troops = [];
  return true;
}
export function hireVagabond(state, kid, heroId) {
  const h = hero(state, heroId), k = state.kingdoms[kid];
  if (!h || h.status !== 'vagabond' || k.gold < HIRE_COST) return false;
  const ok = k.landless ? kingdomHeroes(state, kid).some((x) => x.loc === h.loc) : state.territories[h.loc].owner === kid;
  if (!ok) return false;
  k.gold -= HIRE_COST; joinKingdom(state, h, kid, 60);
  log(state, `${h.name} swore loyalty to ${k.name}.`, kid);
  return true;
}
export function joinKingdom(state, h, kid, loyalty = 55) {
  const k = state.kingdoms[kid];
  h.status = 'active'; h.kingdom = kid; h.loyalty = loyalty; h.order = null; h.captor = -1; h.secret = -1; h.lentTo = -1;
  if (!k.troopRaces.includes(h.fid)) { k.troopRaces.push(h.fid); log(state, `${k.name} can now raise ${FACTIONS[h.fid].race} troops.`, kid); }
  if (!k.landless && state.territories[h.loc].owner >= 0 && state.territories[h.loc].owner !== kid) { const own = kingdomTerritories(state, kid); if (own.length) h.loc = (own.find((t) => t.id === k.capital) || own[0]).id; }
}

// promote a named Elite soldier into a full hero
export function promoteElite(state, kid, heroId, troopIdx) {
  const h = hero(state, heroId), k = state.kingdoms[kid];
  if (!h || h.kingdom !== kid || k.gold < PROMOTE_ELITE_COST) return null;
  const s = h.troops[troopIdx];
  if (!s || s.s !== 3) return null;
  const rng = rngFor(state, heroId * 3 + troopIdx);
  k.gold -= PROMOTE_ELITE_COST;
  h.troops.splice(troopIdx, 1);
  const fid = h.ufid;
  const nh = makeHero(state, rng, fid, kid, h.loc, { name: s.name, unit: h.unit, ufid: fid, troops: 0, level: 1 });
  nh.loyalty = 85; nh.trait = 'loyal';
  if (!k.troopRaces.includes(fid)) k.troopRaces.push(fid);
  log(state, `${s.name} was raised from the ranks to lead a squad.`, kid);
  return nh;
}

// ---------- troop growth ----------
const ELITE_NAMES = ['Brann', 'Kesh', 'Orla', 'Tamsin', 'Vex', 'Rurik', 'Mira', 'Duro', 'Ilse', 'Gorr', 'Sefa', 'Lukan', 'Yeva', 'Hask', 'Nira', 'Borin', 'Tova', 'Kael', 'Runa', 'Zed'];
const ELITE_TAGS = ['Steelheart', 'the Unbroken', 'Quickblade', 'Stonewall', 'the Lucky', 'Ravenshield', 'Grimtooth', 'the Fox', 'Bloodaxe', 'Lightfoot'];
export function gainTroopXp(h, amount, rng) {
  const promos = { rank: 0, evolve: 0, elite: 0 };
  for (const s of h.troops) {
    if (s.s === 3) continue;
    s.xp += amount;
    const [rx, ex] = EVOLVE_XP[s.s];
    if (!s.r && s.xp >= rx) { s.r = 1; promos.rank++; }
    if (s.xp >= ex) {
      s.xp = 0; s.r = 0;
      if (s.s === 1) { s.s = 2; promos.evolve++; }
      else { s.s = 3; if (!s.heir) s.name = (rng ? rng.pick(ELITE_NAMES) + ' ' + rng.pick(ELITE_TAGS) : 'Elite'); promos.elite++; }
    }
  }
  return promos;
}
export function gainHeroXp(h, amount, rng) {
  h.xp += amount;
  let ups = 0;
  while (h.level < MAX_LEVEL && h.xp >= LEVEL_XP(h.level)) { h.xp -= LEVEL_XP(h.level); levelUp(h, rng); ups++; }
  // computer heroes pick a calling on their own; players choose in the hero sheet
  if (!h.role && h.level >= ROLE_LEVEL && h.kingdom >= 0 && rng && h.autoRole !== false) {
    const best = h.lead >= 11 ? 'commander' : h.atk >= h.def + 2 ? 'duelist' : h.int >= 6 ? 'strategist' : 'scout';
    h.pendingRole = best;
  }
  return ups;
}

// ---------- battles ----------
export function collectBattles(state) {
  const groups = new Map();
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.type !== 'attack') continue;
    const key = h.kingdom + ':' + h.order.target;
    if (!groups.has(key)) groups.set(key, { att: h.kingdom, tid: h.order.target, attackers: [] });
    groups.get(key).attackers.push(h.id);
  }
  // lent heroes join their host's attacks on nearby lands
  for (const h of state.heroes) {
    if (h.status !== 'active' || h.lentTo < 0) continue;
    const g = [...groups.values()].find((b) => b.att === h.lentTo && (b.tid === h.loc || state.territories[b.tid].nb.includes(h.loc)));
    if (g && !g.attackers.includes(h.id)) g.attackers.push(h.id);
  }
  return [...groups.values()];
}

export function prepareBattle(state, b) {
  const t = state.territories[b.tid];
  b.attackers = b.attackers.filter((id) => { const h = hero(state, id); return h && h.status === 'active' && (h.kingdom === b.att || h.lentTo === b.att); });
  if (!b.attackers.length || t.owner === b.att) return null;
  if (t.owner >= 0 && friendly(state, b.att, t.owner)) return null;
  b.def = t.owner;
  b.defenders = heroesAt(state, b.tid, t.owner).map((h) => h.id);
  for (const h of state.heroes) if (h.status === 'active' && h.lentTo === t.owner && h.loc === b.tid) b.defenders.push(h.id);
  b.level = t.level; b.biome = t.biome;
  const attK = state.kingdoms[b.att];
  b.landless = !!attK.landless;
  b.siege = t.level >= 2 && !attK.landless;
  return b;
}

// attacker win chance (0..1). Without spy intel it is only a rough read.
export function battleOdds(state, b, intel) {
  const items = state.items;
  const attK = state.kingdoms[b.att], defK = b.def >= 0 ? state.kingdoms[b.def] : null;
  const ap = b.attackers.reduce((s, id) => s + squadPower(hero(state, id), items, attK.morale), 0) * (1 + tierIndex(attK) * 0.04);
  const dp = b.defenders.reduce((s, id) => s + squadPower(hero(state, id), items, defK ? defK.morale : 60), 0)
    + garrisonPower(state.territories[b.tid]) * (b.defenders.length ? 0.6 : 1.2) * (b.siege ? 1.25 : 1);
  let p = 1 / (1 + Math.exp(-8.8 * (ap / (ap + dp) - 0.5)));
  if (!intel) p = Math.round(p * 5) / 5;
  return Math.max(0.03, Math.min(0.97, p));
}

export function autoResolve(state, b) {
  const rng = rngFor(state, b.tid * 31 + b.att);
  const p = battleOdds(state, b, true);
  const attWins = rng() < p;
  const out = { winner: attWins ? 'att' : 'def', heroes: {}, treachery: [] };
  const apply = (ids, won, ratio) => {
    for (const id of ids) {
      const h = hero(state, id);
      const lossFrac = won ? 0.08 + 0.3 * (1 - ratio) : 0.4 + 0.4 * (1 - ratio);
      const alive = h.troops.map((_, i) => i).filter(() => rng() > lossFrac);
      out.heroes[id] = { alive, defeated: !won ? rng() < 0.35 : rng() < 0.04 };
    }
  };
  apply(b.attackers, attWins, p);
  apply(b.defenders, !attWins, 1 - p);
  // sleepers turn their coats when their true master is on the field
  for (const id of [...b.attackers, ...b.defenders]) { const h = hero(state, id); if (h.secret >= 0 && (h.secret === b.att || h.secret === b.def)) out.treachery.push(id); }
  return out;
}

// result: { winner:'att'|'def', heroes:{[id]:{alive,defeated}}, retreated?, treachery?:[ids] }
export function applyBattle(state, b, result) {
  const rng = rngFor(state, b.tid * 17 + 5);
  const t = state.territories[b.tid];
  const attK = state.kingdoms[b.att], defK = b.def >= 0 ? state.kingdoms[b.def] : null;
  const attWon = result.winner === 'att';
  const report = { tid: b.tid, att: b.att, def: b.def, attWon, captured: [], died: [], retreated: [], promoted: 0, evolved: 0, elites: 0, loot: null, defected: [], leveled: [] };
  for (const id of result.treachery || []) {
    const h = hero(state, id); if (!h || h.status !== 'active') continue;
    const to = h.secret >= 0 ? h.secret : (h.kingdom === b.att ? b.def : b.att);
    if (to >= 0 && state.kingdoms[to].alive) {
      const from = state.kingdoms[h.kingdom];
      joinKingdom(state, h, to, 70);
      report.defected.push(id);
      log(state, `${h.name} betrayed ${from.name} and joined ${state.kingdoms[to].name}!`, -1, 'betrayal');
    }
  }
  const settle = (ids, won) => {
    for (const id of ids) {
      const h = hero(state, id); if (!h) continue;
      const r = result.heroes[id] || { alive: h.troops.map((_, i) => i), defeated: false };
      h.troops = r.alive.map((i) => h.troops[i]).filter(Boolean);
      const pr = gainTroopXp(h, won ? 2 : 1, rng);
      report.promoted += pr.rank; report.evolved += pr.evolve; report.elites += pr.elite;
      if (gainHeroXp(h, won ? 4 : 2, rng)) report.leveled.push(h.id);
      h.loyalty = clamp(h.loyalty + (won ? 2 : -2));
      h.order = null;
      if (r.defeated) h.hp = Math.max(10, h.hp - 45);
      h._defeated = r.defeated;
    }
  };
  settle(b.attackers.filter((id) => !report.defected.includes(id)), attWon);
  settle(b.defenders.filter((id) => !report.defected.includes(id)), !attWon);
  const shift = (k, m, s) => { if (k) { k.morale = clamp(k.morale + m); k.stability = clamp(k.stability + s); } };
  shift(attK, attWon ? 6 : -6, attWon ? 0 : -2);
  shift(defK, attWon ? -8 : 5, attWon ? -5 : 1);
  if (defK) { defK.rel[b.att] = (defK.rel[b.att] || 0) - 25; attK.rel[b.def] = (attK.rel[b.def] || 0) - 10; }

  const capture = (h, captorK) => {
    if (rng() < 0.12) { h.status = 'dead'; report.died.push(h.id); log(state, `${h.name} fell in battle at ${t.name}.`, -1, 'death'); return; }
    h.status = 'captive'; h.captor = captorK; h.order = null; h.lentTo = -1;
    report.captured.push(h.id);
    log(state, `${h.name} was captured by ${state.kingdoms[captorK].name}.`, -1, 'capture');
    if (isHumanKingdom(state, captorK)) state.pendingCaptives.push(h.id);
  };

  if (attWon) {
    t.owner = b.att; t.ruined = 2; t.level = Math.max(0, t.level - 1);
    if (attK.landless) { attK.landless = false; attK.capital = t.id; log(state, `${attK.name} rose from the wilds and seized ${t.name}!`, attK.id, 'uprising'); }
    if (t.race && !attK.troopRaces.includes(t.race)) attK.troopRaces.push(t.race);
    for (const id of b.attackers) { const h = hero(state, id); if (h && h.status === 'active' && !report.defected.includes(id) && h.lentTo < 0) h.loc = b.tid; }
    for (const id of b.defenders) {
      const h = hero(state, id); if (!h || h.status !== 'active' || report.defected.includes(id)) continue;
      const home = retreatSpot(state, h, b.tid);
      if (h._defeated || home == null) capture(h, b.att);
      else { h.loc = home; report.retreated.push(h.id); }
    }
    const it = giveItem(state, rng, b.att, Math.min(3, Math.floor(state.turn / 8) + (rng.chance(0.3) ? 1 : 0)));
    report.loot = it.id;
    log(state, `${attK.name} conquered ${t.name}${defK ? ' from ' + defK.name : ''}.`, -1, 'conquest');
  } else {
    for (const id of b.attackers) {
      const h = hero(state, id); if (!h || h.status !== 'active' || report.defected.includes(id)) continue;
      if (h._defeated && b.def >= 0 && rng() < 0.6) capture(h, b.def);
    }
    if (defK) { const it = giveItem(state, rng, b.def, Math.min(3, Math.floor(state.turn / 10))); report.loot = it.id; }
    log(state, `${defK ? defK.name : 'The defenders'} held ${t.name} against ${attK.name}.`, -1, 'defense');
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
  const homeK = h.kingdom >= 0 ? state.kingdoms[h.kingdom] : null;
  if (decision === 'execute') {
    h.status = 'dead';
    log(state, `${captor.name} executed ${h.name}.`, -1, 'execution');
    for (const x of kingdomHeroes(state, captor.id)) if (x.fid === h.fid) x.loyalty = Math.max(0, x.loyalty - 6);
    if (homeK) homeK.rel[captor.id] = (homeK.rel[captor.id] || 0) - 40;
    checkKingdoms(state);
    return 'executed';
  }
  if (decision === 'release') {
    h.captor = -1;
    if (homeK && homeK.alive && homeK.player >= 0) {
      h.status = 'active';
      if (!homeK.landless) h.loc = (kingdomTerritories(state, homeK.id)[0] || state.territories[h.loc]).id;
      log(state, `${captor.name} released ${h.name}, who returned to ${homeK.name}.`);
    } else { h.status = 'vagabond'; h.kingdom = -1; h.loyalty = rng.int(20, 60); log(state, `${captor.name} released ${h.name}, who now wanders as a vagabond.`); }
    if (homeK) homeK.rel[captor.id] = (homeK.rel[captor.id] || 0) + 15;
    checkKingdoms(state);
    return 'released';
  }
  if (decision === 'recruit') {
    const isRuler = homeK && homeK.ruler === h.id && homeK.alive;
    const traitMod = { loyal: -0.15, proud: -0.1, honorable: -0.05, greedy: 0.1, ambitious: 0.08, cunning: 0.05 }[h.trait] || 0;
    const chance = (isRuler ? 0.1 : 0.28) + (1 - h.loyalty / 100) * 0.5 + traitMod + (captor.morale - 50) / 300;
    if (rng() < chance) {
      if (isRuler) homeK.ruler = -1;
      joinKingdom(state, h, captor.id, 50);
      if (captor.landless) { const mate = kingdomHeroes(state, captor.id).find((x) => x.id !== h.id); if (mate) h.loc = mate.loc; }
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
    const heroes = kingdomHeroes(state, k.id, true);
    if (!owned.length) {
      if (k.player >= 0) {
        if (heroes.length) {
          if (!k.landless) { k.landless = true; state.treaties = state.treaties.filter((t) => t.type !== 'vassal' || (t.a !== k.id && t.b !== k.id)); log(state, `${k.name} has lost all its lands. Its heroes fight on as a wandering warband.`, k.id, 'fall'); }
          continue;
        }
        if (state.heroes.some((h) => h.status === 'captive' && h.kingdom === k.id)) continue; // their fate is still undecided
      }
      k.alive = false;
      log(state, `${k.name} has fallen.`, -1, 'fall');
      for (const h of state.heroes) if (h.kingdom === k.id && h.status === 'active') { h.status = 'vagabond'; h.kingdom = -1; h.order = null; h.lentTo = -1; }
      state.treaties = state.treaties.filter((t) => t.a !== k.id && t.b !== k.id);
      continue;
    }
    if (k.landless) k.landless = false;
    if (!owned.some((t) => t.id === k.capital)) k.capital = owned[0].id;
    const r = hero(state, k.ruler);
    if (!r || r.status !== 'active' || r.kingdom !== k.id) {
      const hs = heroes.sort((a, b) => b.level - a.level);
      if (hs.length) k.ruler = hs[0].id;
    }
  }
  checkVictory(state);
}

function blocs(state) {
  const alive = state.kingdoms.filter((k) => k.alive);
  const parent = new Map(alive.map((k) => [k.id, k.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const t of state.treaties) if ((t.type === 'alliance' || t.type === 'vassal') && parent.has(t.a) && parent.has(t.b)) parent.set(find(t.a), find(t.b));
  const out = new Map();
  for (const k of alive) { const r = find(k.id); if (!out.has(r)) out.set(r, []); out.get(r).push(k.id); }
  return [...out.values()];
}
export function proposedMajority(state, kid) {
  const mine = state.treaties.filter((t) => t.type === 'alliance' && (t.a === kid || t.b === kid));
  if (!mine.length) return true;
  return mine.filter((t) => t.proposer === kid).length * 2 > mine.length;
}
function checkVictory(state) {
  if (state.over) return;
  const owners = new Set(state.territories.map((t) => t.owner).filter((o) => o >= 0));
  if (owners.size === 1) { state.over = { winner: [...owners][0], type: 'solo', members: [...owners] }; return; }
  // a landless human warband keeps the war going
  const wanderers = state.players.map((p) => state.kingdoms[p.kingdom]).filter((k) => k.alive && k.landless).map((k) => k.id);
  for (const bloc of blocs(state)) {
    if (![...owners].every((o) => bloc.includes(o))) continue;
    if (wanderers.some((w) => !bloc.includes(w))) return;
    const humans = bloc.filter((k) => state.kingdoms[k].player >= 0);
    const hasAlliance = state.treaties.some((t) => t.type === 'alliance' && bloc.includes(t.a));
    if (!hasAlliance) { const lord = bloc.find((k) => overlordOf(state, k) < 0); state.over = { winner: lord, type: 'solo', members: bloc }; return; }
    const winners = humans.filter((k) => proposedMajority(state, k));
    if (!humans.length && state.players.some((p) => state.kingdoms[p.kingdom].alive)) return;
    if (winners.length || !humans.length) { state.over = { winner: winners[0] ?? bloc[0], type: 'alliance', members: bloc, winners }; return; }
  }
  const humansAlive = state.players.filter((p) => state.kingdoms[p.kingdom].alive);
  if (state.players.length && !humansAlive.length) state.over = { winner: -1, type: 'defeat', members: [] };
}

// ---------- orders that resolve at end of turn ----------
export function applyOrders(state) {
  const rng = rngFor(state, 4242);
  const results = [];
  applyNeutralOrders(state, rngFor(state, 4343), results);
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order) continue;
    if (h.order.type === 'protect') continue;
    const k = state.kingdoms[h.kingdom];
    const o = h.order;
    if (o.type === 'move' && validMoves(state, h).includes(o.target)) h.loc = o.target;
    else if (o.type === 'rest') {
      h.hp = Math.min(100, h.hp + 45);
      const cap = squadCap(h, k), cost = Math.round(recruitCost(h.ufid, h.unit) * (k.landless ? 1.6 : 1));
      let added = 0;
      while (h.troops.length < cap && k.gold >= cost) { k.gold -= cost; h.troops.push(newSoldier(rng)); added++; }
      h.loyalty = Math.min(100, h.loyalty + 1);
      if (added) results.push({ kid: k.id, text: `${h.name} rested and took in ${added} recruits.` });
    } else if (o.type === 'drill') {
      const pr = gainTroopXp(h, k.buildings.pits ? 2 : 1, rng);
      gainHeroXp(h, k.buildings.academy ? 2 : 1, rng);
      if (pr.evolve || pr.elite) results.push({ kid: k.id, text: `${h.name}'s drills paid off: ${pr.evolve ? pr.evolve + ' evolved' : ''}${pr.elite ? ' ' + pr.elite + ' became Elite' : ''}.` });
    } else if (o.type === 'spy') {
      const t = state.territories[o.target];
      if (h.role === 'scout' || rng() < 0.45 + h.int * 0.06) {
        k.intel[o.target] = { turn: state.turn + 1 };
        results.push({ kid: k.id, text: `${h.name}'s spies mapped the defences of ${t.name}.` });
      } else {
        if (rng() < 0.25) { h.hp = Math.max(20, h.hp - 30); results.push({ kid: k.id, text: `${h.name}'s spies were caught at ${t.name}.` }); }
        else results.push({ kid: k.id, text: `${h.name} learned nothing at ${t.name}.` });
        if (t.owner >= 0) state.kingdoms[t.owner].rel[k.id] = (state.kingdoms[t.owner].rel[k.id] || 0) - 10;
      }
    }
    if (o.type !== 'attack') h.order = null;
  }
  return results;
}
// keep save files small: drop the long dead and items nobody holds
export function tidy(state) {
  state.heroes = state.heroes.filter((h) => h.status !== 'dead' || state.turn - (h.diedTurn ?? state.turn) < 2);
  for (const h of state.heroes) if (h.status === 'dead' && h.diedTurn == null) h.diedTurn = state.turn;
  const held = new Set();
  for (const k of state.kingdoms) {
    if (k.player < 0 && k.items.length) {
      // AI hands spare gear to its heroes, keeps a small armory
      for (const id of [...k.items]) {
        const it = state.items[id]; if (!it) continue;
        const h = kingdomHeroes(state, k.id).find((x) => x.gear[it.slot] == null || (state.items[x.gear[it.slot]] || {}).rarity < it.rarity);
        if (h) equip(state, k.id, h.id, id);
      }
      if (k.items.length > 6) k.items.splice(0, k.items.length - 6);
    }
    if (!k.alive) k.items = [];
    k.items.forEach((id) => held.add(id));
  }
  for (const h of state.heroes) if (h.status !== 'dead') Object.values(h.gear).forEach((id) => held.add(id));
  for (const id of Object.keys(state.items)) if (!held.has(+id)) delete state.items[id];
  if (state.log.length > 250) state.log.splice(0, state.log.length - 250);
}
export function hasIntel(state, kid, tid) { const i = state.kingdoms[kid].intel[tid]; return !!i && i.turn >= state.turn; }

export function powerAt(state, tid) {
  const t = state.territories[tid];
  const k = t.owner >= 0 ? state.kingdoms[t.owner] : null;
  return heroesAt(state, tid, t.owner).reduce((s, h) => s + squadPower(h, state.items, k ? k.morale : 60), 0) + garrisonPower(t);
}

export { SLOTS, unitLevel };
