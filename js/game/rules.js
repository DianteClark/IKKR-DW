// Numbers that define units, heroes, formations and the economy.
import { FACTIONS } from '../data/art.js';

// per unit level (index 0..6 inside a faction)
const HP = [9, 12, 15.5, 20, 25, 31, 38];
const ATK = [2.6, 3.2, 3.9, 4.7, 5.6, 6.6, 7.8];
const DEF = [1, 1.4, 1.9, 2.4, 3, 3.6, 4.3];
const SPD = [1.15, 1.1, 1.3, 1.0, 0.95, 1.25, 0.9];

export const RANGED = {
  castle: [1, 4], rampart: [3, 5], tower: [0, 3], inferno: [1], necropolis: [5],
  stronghold: [3, 4], enclave: [1, 4], orcs: [0, 4], dwarves: [3], conflux: [4],
};

export const RANKS = [['Recruit', 'Veteran', 'Elite'], ['Recruit', 'Veteran', 'Elite', 'Champion']];
// xp needed for next rank, per stage
export const RANK_XP = [[2, 4, 7], [3, 6, 10]];

export function unitLevel(fid, ui) { return Math.min(6, Math.round(ui * 6 / Math.max(1, FACTIONS[fid].units.length - 1))); }
export function isRanged(fid, ui) { return (RANGED[fid] || []).includes(ui); }

export function unitName(fid, ui, stage) { return FACTIONS[fid].units[ui].n[stage === 2 ? 1 : 0]; }

// stats of one soldier
export function soldierStats(fid, ui, s) {
  const L = unitLevel(fid, ui);
  const st = s.s === 2 ? 1.38 : 1;
  const rk = 1 + 0.09 * s.r;
  return { hp: HP[L] * st * rk, atk: ATK[L] * st * rk, def: DEF[L] * st * rk, spd: SPD[L] };
}

export function squadCap(hero) {
  const L = unitLevel(hero.fid, hero.unit);
  return Math.max(5, Math.min(10, Math.round(hero.lead + 1 - L * 0.65)));
}

export function recruitCost(fid, ui) { return 12 + unitLevel(fid, ui) * 9; }

export function heroTotals(hero, items) {
  const t = { atk: hero.atk, def: hero.def, lead: hero.lead, int: hero.int, morale: 0, spd: 0 };
  for (const id of Object.values(hero.gear || {})) {
    const it = items[id];
    if (!it) continue;
    for (const k of ['atk', 'def', 'lead', 'int', 'morale', 'spd']) t[k] += it[k] || 0;
  }
  return t;
}

// rough strength of a hero's squad for AI + auto-resolve
export function squadPower(hero, items) {
  const t = heroTotals(hero, items);
  let p = 0;
  for (const s of hero.troops) {
    const st = soldierStats(hero.fid, hero.unit, s);
    p += st.hp * 0.5 + st.atk * 3 + st.def * 2;
  }
  p *= 1 + t.atk * 0.03 + t.def * 0.025;
  p *= 0.6 + 0.4 * (hero.morale / 100);
  p += 18 + hero.level * 6;
  return p;
}

export function garrisonPower(terr) { return 25 + terr.level * 30; }

// ---- formations ----
export const FORMATIONS = {
  wedge: { name: 'Wedge', beats: 'line', desc: 'Charge: +attack. Beats Line.', atk: 1.12, def: 0.95, spd: 1.05 },
  line: { name: 'Line', beats: 'square', desc: 'Wide front: ranged +25%. Beats Square.', atk: 1.0, def: 1.0, spd: 1.0, ranged: 1.25 },
  square: { name: 'Square', beats: 'wedge', desc: 'Shield wall: +defense. Beats Wedge.', atk: 0.92, def: 1.22, spd: 0.85 },
  loose: { name: 'Loose', beats: null, desc: 'Fast; arrows hurt less, melee hurts more.', atk: 1.0, def: 0.88, spd: 1.3, arrowGuard: 0.65 },
};
export const FORMATION_IDS = Object.keys(FORMATIONS);
export function formationEdge(a, b) {
  if (FORMATIONS[a].beats === b) return 1.25;
  if (FORMATIONS[b].beats === a) return 0.8;
  return 1;
}
// slot offsets (in tiles) for n soldiers, facing +x
export function formationSlots(f, n) {
  const out = [];
  if (f === 'wedge') {
    let i = 0, row = 1;
    while (out.length < n) { for (let k = 0; k <= row && out.length < n; k++) out.push([-row * 0.55, (k - row / 2) * 0.6]); row++; i++; }
  } else if (f === 'line') {
    const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) out.push([0.3 - Math.floor(i / cols) * 0.6, ((i % cols) - (cols - 1) / 2) * 0.6]);
  } else if (f === 'square') {
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) out.push([((i % side) - (side - 1) / 2) * 0.55 - 0.3, (Math.floor(i / side) - (side - 1) / 2) * 0.55]);
  } else {
    for (let i = 0; i < n; i++) { const a = i * 2.39996, r = 0.55 + Math.sqrt(i) * 0.42; out.push([Math.cos(a) * r - 0.3, Math.sin(a) * r]); }
  }
  return out;
}

// ---- economy ----
export const INCOME_BASE = 60;
export function territoryIncome(t) { return INCOME_BASE + t.level * 30 - (t.ruined ? 30 : 0); }
export function developCost(t) { return 250 * (t.level + 1); }
export const HIRE_COST = 400;

export const LEVEL_XP = (lvl) => 6 + lvl * 5;
