// Numbers that define units, heroes, formations, stratagems, kingdoms and the economy.
import { FACTIONS } from '../data/art.js';

// ---------------- units ----------------
// per unit level (index 0..6 inside a faction)
const HP = [9, 12, 15.5, 20, 25, 31, 38];
const ATK = [2.6, 3.2, 3.9, 4.7, 5.6, 6.6, 7.8];
const DEF = [1, 1.4, 1.9, 2.4, 3, 3.6, 4.3];
const SPD = [1.15, 1.1, 1.3, 1.0, 0.95, 1.25, 0.9];

export const RANGED = {
  castle: [1, 4], rampart: [3, 5], tower: [0, 3], inferno: [1], necropolis: [5],
  stronghold: [3, 4], enclave: [1, 4], orcs: [0, 4], dwarves: [3], conflux: [4],
};

// stage 1 → stage 2 (new sprite, or stats only) → stage 3 Elite (named, hero-grade stats, stage-2 sprite)
export const STAGE_NAMES = ['', 'Recruit', 'Veteran', 'Elite'];
export const RANK_NAMES = [['Recruit', 'Seasoned'], ['Veteran', 'Hardened'], ['Elite']];
export const EVOLVE_XP = { 1: [2, 5], 2: [4, 9] }; // [xp for rank 1, xp to evolve]

export function unitLevel(fid, ui) { return Math.min(6, Math.round(ui * 6 / Math.max(1, FACTIONS[fid].units.length - 1))); }
// troop classes: foot and ranged troops can be raised anywhere; the rest need the right building
const C = { f: 'foot', r: 'ranged', m: 'mounted', y: 'flying', c: 'caster', b: 'beast' };
const UNIT_CLASS_STR = {
  castle: 'frycmm', rampart: 'yffrbcb', tower: 'fybcybb', inferno: 'frbffyb', necropolis: 'ffbyycm', stronghold: 'fymmcbb',
  enclave: 'brfbcbb', orcs: 'rfffrff', dwarves: 'fffcmmb', conflux: 'ybccc',
};
export const CLASS_INFO = {
  foot: { name: 'Infantry', building: null, perk: 'Sturdy and cheap.' },
  ranged: { name: 'Ranged', building: null, perk: 'Shoots from range.' },
  mounted: { name: 'Mounted', building: 'stables', perk: 'Rides two lands per month through safe ground.' },
  flying: { name: 'Flying', building: 'aerie', perk: 'Crosses sea lanes without ships.' },
  caster: { name: 'Caster', building: 'magetower', perk: 'Wields battle magic.' },
  beast: { name: 'Beast', building: 'beastpit', perk: 'Huge and hard-hitting.' },
};
// beasts and mindless things fight in squads and can become named Elites, but never lead as heroes
const BEASTS = { castle: [2], rampart: [4, 6], tower: [1, 2, 5], inferno: [2], necropolis: [2], enclave: [0, 3, 5], dwarves: [6] };
export function canLead(fid, ui) { return !(BEASTS[fid] || []).includes(ui); }
export function unitClass(fid, ui) {
  if ((RANGED[fid] || []).includes(ui)) return 'ranged';
  const s = UNIT_CLASS_STR[fid] || '';
  return C[s[ui]] || 'foot';
}
export function isRanged(fid, ui) { return (RANGED[fid] || []).includes(ui); }
export function hasUpgradeArt(fid, ui) { return !FACTIONS[fid].units[ui].tint2; }
export function unitName(fid, ui, stage) {
  const n = FACTIONS[fid].units[ui].n;
  if (stage >= 2 && !hasUpgradeArt(fid, ui)) return 'Veteran ' + n[0];
  return n[stage >= 2 ? 1 : 0];
}
export function unitWeight(fid, ui) { return 1 + unitLevel(fid, ui) * 0.22; }

// a freshly recruited soldier with rolled stats
export function newSoldier(rng) {
  const r = () => 88 + Math.floor((rng ? rng() : Math.random()) * 25);
  return { s: 1, r: 0, xp: 0, g: [r(), r(), r()] };
}

// stats of one soldier
export function soldierStats(fid, ui, s) {
  const L = unitLevel(fid, ui);
  const g = s.g || [100, 100, 100];
  const noArt = !hasUpgradeArt(fid, ui);
  const base = noArt ? 1.15 : 1; // factions without upgraded sprites start stronger
  if (s.s === 3) {
    // Elite: named, roughly a level-2 hero
    return { hp: Math.max(52, HP[L] * 2.6) * g[0] / 100 * base, atk: Math.max(6.5, ATK[L] * 2.0) * g[1] / 100 * base, def: Math.max(4, DEF[L] * 1.9) * g[2] / 100 * base, spd: SPD[L] };
  }
  const st = s.s === 2 ? 1.38 : 1;
  const rk = 1 + 0.08 * (s.r || 0);
  return { hp: HP[L] * st * rk * base * g[0] / 100, atk: ATK[L] * st * rk * base * g[1] / 100, def: DEF[L] * st * rk * base * g[2] / 100, spd: SPD[L] };
}
export function soldierTitle(fid, ui, s) {
  if (s.s === 3) return s.name || 'Elite';
  if (s.heir) return `${s.name} · ${RANK_NAMES[s.s - 1][s.r || 0]}`;
  return RANK_NAMES[s.s - 1][s.r || 0];
}

// ---------------- heroes ----------------
export const MAX_LEVEL = 30;
export const LEVEL_XP = (lvl) => 6 + lvl * 5;

// command points: how many soldiers a hero can lead (bigger units take more room)
// a hero picks a calling at level 5 that shapes how they fight
export const ROLE_LEVEL = 5;
export const ROLES = {
  commander: { name: 'Commander', desc: '+4 command: a bigger squad.' },
  duelist: { name: 'Duelist', desc: '+3 attack and the edge in hero duels.' },
  strategist: { name: 'Strategist', desc: '+3 stratagem points in every battle they join.' },
  scout: { name: 'Scout', desc: 'Spies always succeed; +2 defence.' },
};
export function commandCap(hero, kingdom) {
  const pits = kingdom && kingdom.buildings && kingdom.buildings.pits ? 3 : 0;
  return Math.min(49, 5 + Math.floor((hero.level - 1) * 1.6) + Math.max(0, hero.lead - 8) + pits + (hero.role === 'commander' ? 4 : 0));
}
export function squadCap(hero, kingdom) {
  return Math.max(1, Math.floor(commandCap(hero, kingdom) / unitWeight(hero.ufid || hero.fid, hero.unit) + 1e-6));
}
export function recruitCost(fid, ui) { return 10 + unitLevel(fid, ui) * 8; }

export function heroTotals(hero, items) {
  const t = { atk: hero.atk + (hero.role === 'duelist' ? 3 : 0), def: hero.def + (hero.role === 'scout' ? 2 : 0), lead: hero.lead, int: hero.int, morale: 0, spd: 0 };
  for (const id of Object.values(hero.gear || {})) {
    const it = items[id];
    if (!it) continue;
    for (const k of ['atk', 'def', 'lead', 'int', 'morale', 'spd']) t[k] += it[k] || 0;
  }
  return t;
}
export function raceMatch(hero) { return (hero.ufid || hero.fid) === hero.fid; }

// rough strength of a hero's squad for AI + auto-resolve
export function squadPower(hero, items, morale = 60) {
  const t = heroTotals(hero, items);
  const uf = hero.ufid || hero.fid;
  let p = 0;
  for (const s of hero.troops) {
    const st = soldierStats(uf, hero.unit, s);
    p += st.hp * 0.5 + st.atk * 3 + st.def * 2;
  }
  p *= 1 + t.atk * 0.03 + t.def * 0.025;
  if (raceMatch(hero)) p *= 1.1;
  p *= 0.6 + 0.4 * (Math.min(100, morale + t.morale) / 100);
  p *= 0.5 + 0.5 * (hero.hp ?? 100) / 100;
  p += 18 + hero.level * 6;
  return p;
}
export function garrisonPower(terr) { return (25 + terr.level * 30 + (terr.owner < 0 ? (terr.militia || 0) * 10 : 0)) * (terr.siege ? Math.max(0.4, 1 - 0.18 * terr.siege.turns) : 1); }

// ---------------- formations ----------------
export const FORMATIONS = {
  wedge: { name: 'Wedge', beats: 'line', desc: 'Charge: +attack. Beats Line.', atk: 1.12, def: 0.95, spd: 1.05, time: 3 },
  line: { name: 'Line', beats: 'square', desc: 'Wide front: ranged +25%. Beats Square.', atk: 1.0, def: 1.0, spd: 1.0, ranged: 1.25, time: 2.5 },
  square: { name: 'Square', beats: 'wedge', desc: 'Shield wall: +defense. Beats Wedge.', atk: 0.92, def: 1.22, spd: 0.85, time: 3.5 },
};
export const FORMATION_IDS = Object.keys(FORMATIONS);
export function formationEdge(a, b) {
  if (!FORMATIONS[a] || !FORMATIONS[b]) return 1;
  if (FORMATIONS[a].beats === b) return 1.25;
  if (FORMATIONS[b].beats === a) return 0.8;
  return 1;
}
// seconds to switch formation; big squads and stiff formations take longer, leadership helps
export function formationChangeTime(from, to, n, lead) {
  let t = FORMATIONS[to].time;
  if (from === 'loose') t *= 0.8;
  if (from === 'square') t *= 1.25;
  t *= 0.85 + Math.min(0.6, n / 40);
  t -= Math.max(0, lead - 8) * 0.08;
  return Math.max(1, t);
}
// slot offsets (in tiles) for n soldiers, facing +x. spacing tightens as squads grow
export function formationSlots(f, n) {
  const out = [];
  const sp = n > 20 ? 0.42 : n > 10 ? 0.5 : 0.58;
  if (f === 'wedge') {
    let row = 1;
    while (out.length < n) { for (let k = 0; k <= row && out.length < n; k++) out.push([-row * sp, (k - row / 2) * sp * 1.05]); row++; }
  } else if (f === 'line') {
    const rows = n > 24 ? 3 : 2, cols = Math.ceil(n / rows);
    for (let i = 0; i < n; i++) out.push([0.3 - Math.floor(i / cols) * sp, ((i % cols) - (cols - 1) / 2) * sp]);
  } else if (f === 'square') {
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) out.push([((i % side) - (side - 1) / 2) * sp - 0.3, (Math.floor(i / side) - (side - 1) / 2) * sp]);
  } else {
    for (let i = 0; i < n; i++) { const a = i * 2.39996, r = 0.55 + Math.sqrt(i) * sp * 0.75; out.push([Math.cos(a) * r - 0.3, Math.sin(a) * r]); }
  }
  return out;
}

// ---------------- stratagems ----------------
// target: 'enemyFighting' enemy squad already in combat · 'enemy' any enemy squad · 'own' own squad · 'army' all own · 'post' own post · 'route' a path
export const STRATAGEMS = {
  rally: { name: 'Rally', cost: 2, tier: 0, target: 'army', icon: 'Bless', desc: 'All your squads regain 30 morale.' },
  march: { name: 'Forced March', cost: 1, tier: 0, target: 'own', icon: 'Haste', desc: 'A squad moves 60% faster for 12s.' },
  ambush: { name: 'Ambush', cost: 3, tier: 0, target: 'enemyFighting', icon: 'FirstStrike', desc: 'Hidden troops strike an enemy squad that is already fighting.' },
  fire: { name: 'Fire Attack', cost: 3, tier: 1, target: 'enemy', icon: 'Inferno', desc: 'Set fire around an enemy squad. Burns for 8s. Weak underground.' },
  confuse: { name: 'Confusion', cost: 2, tier: 1, target: 'enemy', icon: 'Hypnotize', desc: 'An enemy squad stops and mills about for 7s.' },
  fortify: { name: 'Fortify', cost: 2, tier: 1, target: 'post', icon: 'StoneSkin', desc: 'Your squads at a post take 40% less damage for 15s.' },
  smoke: { name: 'Smoke Screen', cost: 1, tier: 1, target: 'own', icon: 'Blind', desc: 'Arrows barely hurt this squad for 10s.' },
  feint: { name: 'Feigned Retreat', cost: 2, tier: 1, target: 'own', icon: 'DeflectMissle', desc: 'Break off and fall back; the enemy that chases is left exposed.' },
  discord: { name: 'Sow Discord', cost: 3, tier: 2, target: 'enemy', icon: 'Curse', desc: 'Enemy squad loses 35 morale. A disloyal hero may turn on his lord.' },
  landslide: { name: 'Rockslide', cost: 4, tier: 2, target: 'route', icon: 'StoneSpikes', desc: 'Trigger the land itself: cut a path and crush anyone on it.' },
  warcry: { name: 'War Cry', cost: 2, tier: 2, target: 'own', icon: 'Bloodlust', desc: "Fill a hero's special at once and +15% attack for 10s." },
};
export const STRATAGEM_IDS = Object.keys(STRATAGEMS);
export function commandPool(heroes, tierIdx, academy) {
  const bestInt = heroes.reduce((m, h) => Math.max(m, h.int || 0), 0);
  return 4 + Math.floor(bestInt / 2) + tierIdx * 2 + (academy ? 2 : 0) + (heroes.some((h) => h.role === 'strategist') ? 3 : 0);
}

// ---------------- kingdoms ----------------
export const TIERS = [
  { id: 'village', name: 'Village', maxUnitLevel: 2, stratSlots: 1, stratTier: 0, desc: 'A young holding. Weak troops only, one stratagem.' },
  { id: 'kingdom', name: 'Kingdom', maxUnitLevel: 4, stratSlots: 3, stratTier: 1, desc: 'Three stratagems per battle, buildings, alliances and spies.' },
  { id: 'empire', name: 'Empire', maxUnitLevel: 6, stratSlots: 3, stratTier: 2, desc: 'All troop tiers, grand stratagems, demand vassals.' },
];
export function tierIndex(k) { return Math.max(0, TIERS.findIndex((t) => t.id === (k.tier || 'village'))); }
export const PROMOTE = [
  null,
  { cost: 400, need: 'Lead 4 heroes (happens on its own at 5)', ok: (heroes) => heroes >= 4, auto: 5 },
  { cost: 1200, need: 'Hold 8 lands with 8 heroes, or 200 soldiers', ok: (heroes, troops, lands) => lands >= 8 && (heroes >= 8 || troops >= 200) },
];
export const BUILDINGS = {
  pits: { name: 'Training Pits', cost: 500, tier: 1, desc: '+3 command for every hero; resting heroes train twice as hard.' },
  spies: { name: 'Spy Network', cost: 300, tier: 1, desc: 'Scout two lands each month (more with Scout heroes) to reveal armies and exact odds.' },
  academy: { name: 'War Academy', cost: 600, tier: 1, desc: '+2 command points for stratagems; heroes learn faster.' },
  granary: { name: 'Granaries', cost: 350, tier: 1, desc: '+25% food and protection from famine.' },
  council: { name: 'War Council', cost: 900, tier: 2, desc: 'Bring a 4th stratagem into battle.' },
  stables: { name: 'Stables', cost: 300, tier: 0, desc: 'Heroes may lead mounted troops, who ride two lands per month.' },
  harbour: { name: 'Harbour', cost: 250, tier: 0, desc: 'Ships carry your heroes across sea lanes.' },
  beastpit: { name: 'Beast Pit', cost: 500, tier: 1, desc: 'Heroes may lead great beasts and monsters.' },
  magetower: { name: 'Mage Tower', cost: 600, tier: 1, desc: 'Heroes may lead casters and spellblades.' },
  aerie: { name: 'Aerie', cost: 700, tier: 1, desc: 'Heroes may lead flyers, who cross sea lanes on their own.' },
};

export const POLICIES = {
  // `morale` on a realm is its Order: one value for the people's mood and the peace of the land
  tax: { low: { name: 'Low', gold: 0.75, morale: 4 }, normal: { name: 'Normal', gold: 1, morale: 0 }, high: { name: 'High', gold: 1.3, morale: -5 } },
  rations: { half: { name: 'Half', food: 0.6, morale: -4 }, normal: { name: 'Normal', food: 1, morale: 0 }, feast: { name: 'Feast', food: 1.4, morale: 4 } },
};
export const EDICTS = {
  festival: { name: 'Festival', cost: { gold: 150 }, desc: 'Order +12: the people celebrate.' },
  conscript: { name: 'Conscription', cost: { gold: 0 }, desc: 'Every squad is filled with fresh recruits for free. Order −10.' },
  martial: { name: 'Martial Law', cost: { gold: 0 }, desc: 'Order +9, but your heroes lose 4 loyalty.' },
};

export const FOOD = { grass: 30, marsh: 22, dirt: 18, sand: 10, ice: 10, christmas: 12, deepmarsh: 16, lava: 8, cave: 12, dungeon: 10 };
export function territoryFood(t) { return (FOOD[t.biome] || 15) + t.level * 6 - (t.ruined ? 8 : 0) - (t.blight ? 12 : 0) - (t.weather && t.weather.kind === 'drought' ? 10 : 0); }
export const INCOME_BASE = 60;
export function territoryIncome(t) { return INCOME_BASE + t.level * 30 - (t.ruined ? 30 : 0) - (t.blight ? 20 : 0); }
export function developCost(t) { return 250 * (t.level + 1); }
export const HIRE_COST = 400;
export const PROMOTE_ELITE_COST = 300;

// legacy names still used by some UI code
export const RANKS = [['Recruit', 'Seasoned'], ['Veteran', 'Hardened'], ['Elite', 'Elite']];
export const RANK_XP = [EVOLVE_XP[1], EVOLVE_XP[2]];

// AI ruler temperaments
export const TEMPERS = {
  warlike: { name: 'Warlike', desc: 'Quick to attack, slow to make peace.', aggr: 1.25, ally: -0.1, betray: 1, peace: -0.2, trade: 0.8 },
  trader: { name: 'Trader', desc: 'Prefers trade and alliances; fights when cornered.', aggr: 0.85, ally: 0.15, betray: 0.6, peace: 0.2, trade: 1.5 },
  cautious: { name: 'Cautious', desc: 'Strikes only with overwhelming odds; keeps its word.', aggr: 0.75, ally: 0.05, betray: 0.4, peace: 0.15, trade: 1 },
  treacherous: { name: 'Treacherous', desc: 'Allies readily and betrays when it pays.', aggr: 1.05, ally: 0.1, betray: 2.6, peace: 0, trade: 1 },
  zealous: { name: 'Zealous', desc: 'Holds grudges forever and hates its rivals.', aggr: 1.1, ally: -0.15, betray: 0.8, peace: -0.3, trade: 0.9 },
};
export const TEMPER_IDS = Object.keys(TEMPERS);
export const temper = (k) => TEMPERS[(k && k.temper) || 'cautious'] || TEMPERS.cautious;
