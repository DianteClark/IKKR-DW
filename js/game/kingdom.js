// Realm-wide management: gold, food, morale and stability, policies, edicts, tiers and buildings.
// Decisions apply to the whole kingdom, so even a large realm stays simple to run.
import {
  POLICIES, EDICTS, TIERS, tierIndex, PROMOTE, BUILDINGS, territoryIncome, territoryFood, squadCap, newSoldier,
  STRATAGEMS, STRATAGEM_IDS,
} from './rules.js';
import { SEASON_FOOD, seasonOf } from './family.js';
import { tradeIncome } from './trade.js';
import { kingdomHeroes, kingdomTerritories, totalTroops, log, clamp, rngFor, overlordOf, isSeaLink } from './world.js';

export function economyPreview(state, k) {
  const lands = kingdomTerritories(state, k.id);
  const tax = POLICIES.tax[k.policy.tax], rat = POLICIES.rations[k.policy.rations];
  let gold = 0, food = 0;
  for (const t of lands) { gold += territoryIncome(t); food += territoryFood(t); }
  const landGold = gold, landFood = food;
  gold = Math.round(gold * tax.gold);
  if (k.buildings.granary) food = Math.round(food * 1.25);
  const season = seasonOf(state.turn);
  food = Math.round(food * SEASON_FOOD[season]);
  const heroes = kingdomHeroes(state, k.id, true);
  const soldiers = heroes.reduce((n, h) => n + h.troops.length, 0);
  const eat = k.landless ? 0 : Math.round((soldiers * 0.6 + heroes.length * 2) * rat.food); // wanderers live off the land
  // tribute: vassals pay a fifth of their gold income to their overlord
  const lord = overlordOf(state, k.id);
  const tributeOut = lord >= 0 ? Math.round(gold * 0.2) : 0;
  let tributeIn = 0;
  for (const t of state.treaties) if (t.type === 'vassal' && t.a === k.id) {
    const v = state.kingdoms[t.b];
    if (v && v.alive) tributeIn += Math.round(kingdomTerritories(state, v.id).reduce((s, x) => s + territoryIncome(x), 0) * POLICIES.tax[v.policy.tax].gold * 0.2);
  }
  const trade = k.landless ? 0 : tradeIncome(state, k.id);
  return { gold: gold - tributeOut + tributeIn + trade, trade, food: food - eat, foodMade: food, foodEaten: eat, tributeIn, tributeOut, soldiers, lands: lands.length,
    morale: tax.morale + rat.morale, stability: tax.stability || 0,
    // parts, for the economy breakdown
    landGold, landFood, taxGold: tax.gold, granary: !!k.buildings.granary, season, seasonFood: SEASON_FOOD[season], rationFood: rat.food,
    heroCount: heroes.length, ruined: lands.filter((t) => t.ruined > 0).length };
}

export function economyTick(state, k, rng, notes) {
  if (!k.alive) return;
  const p = economyPreview(state, k);
  k.gold = Math.max(0, k.gold + p.gold);
  k.food += p.food;
  // drift toward a resting point, then policy effects
  k.morale = clamp(k.morale + (55 - k.morale) * 0.08 + p.morale);
  k.stability = clamp(k.stability + (55 - k.stability) * 0.06 + p.stability - kingdomTerritories(state, k.id).filter((t) => t.ruined > 0).length * 1.5);
  if (k.landless) { k.morale = clamp(k.morale - 1); }
  if (k.food < 0) {
    // famine: troops desert, morale and stability collapse
    const sev = Math.min(1, -k.food / 80);
    k.morale = clamp(k.morale - 6 - 6 * sev); k.stability = clamp(k.stability - 4 - 6 * sev);
    let lost = 0;
    for (const h of kingdomHeroes(state, k.id, true)) { const n = Math.floor(h.troops.length * (0.08 + 0.12 * sev)); h.troops.splice(h.troops.length - n, n); lost += n; }
    k.food = Math.max(-40, Math.floor(k.food / 2));
    if (!k.buildings.granary || sev > 0.5) { notes.push({ kid: k.id, kind: 'famine', text: `Famine grips ${k.name}! ${lost} soldiers deserted.` }); log(state, `Famine in ${k.name}: ${lost} soldiers deserted.`, k.id, 'famine'); }
  }
  k.food = Math.min(k.food, 400 + kingdomTerritories(state, k.id).length * 60);
  for (const h of kingdomHeroes(state, k.id, true)) h.morale = k.morale; // heroes share the realm's mood
}

export function setPolicy(state, kid, kind, value) {
  const k = state.kingdoms[kid];
  if (!POLICIES[kind] || !POLICIES[kind][value]) return false;
  k.policy[kind] = value;
  return true;
}

export function edictCost(state, k, id) {
  const e = EDICTS[id];
  const n = kingdomHeroes(state, k.id).length;
  return { gold: (e.cost.gold || 0) * (e.cost.perHero ? n : 1), food: e.cost.food || 0 };
}
export function canEdict(state, kid, id) {
  const k = state.kingdoms[kid];
  if (!EDICTS[id] || k.edictTurn === state.turn) return false;
  const c = edictCost(state, k, id);
  return k.gold >= c.gold && k.food >= c.food;
}
export function issueEdict(state, kid, id) {
  if (!canEdict(state, kid, id)) return false;
  const k = state.kingdoms[kid];
  const c = edictCost(state, k, id);
  k.gold -= c.gold; k.food -= c.food; k.edictTurn = state.turn;
  const hs = kingdomHeroes(state, kid, true);
  if (id === 'festival') k.morale = clamp(k.morale + 12);
  if (id === 'martial') { k.stability = clamp(k.stability + 15); k.morale = clamp(k.morale - 8); }
  if (id === 'conscript') {
    const rng = rngFor(state, kid * 91);
    for (const h of hs) { const cap = squadCap(h, k); while (h.troops.length < cap) h.troops.push(newSoldier(rng)); }
    k.stability = clamp(k.stability - 10); k.morale = clamp(k.morale - 6);
  }
  for (const h of hs) h.morale = k.morale;
  log(state, `${k.name} proclaimed: ${EDICTS[id].name}.`, kid, 'edict');
  return true;
}

// ---------- tiers ----------
export function promotionStatus(state, kid) {
  const k = state.kingdoms[kid];
  const ti = tierIndex(k);
  if (ti >= TIERS.length - 1) return null;
  const P = PROMOTE[ti + 1];
  const heroes = kingdomHeroes(state, kid, true).length, troops = totalTroops(state, kid), lands = kingdomTerritories(state, kid).length;
  return { next: TIERS[ti + 1], cost: P.cost, need: P.need, ok: P.ok(heroes, troops, lands) && !k.landless, afford: k.gold >= P.cost, heroes, troops, lands };
}
export function promoteRealm(state, kid) {
  const s = promotionStatus(state, kid);
  if (!s || !s.ok || !s.afford) return false;
  const k = state.kingdoms[kid];
  k.gold -= s.cost; k.tier = s.next.id; k.morale = clamp(k.morale + 10); k.stability = clamp(k.stability + 10);
  log(state, `${k.name} has risen to become a${s.next.id === 'empire' ? 'n' : ''} ${s.next.name}!`, kid, 'tier');
  return true;
}

// a village with enough heroes is a kingdom whether it pays for the ceremony or not
export function autoPromote(state) {
  for (const k of state.kingdoms) {
    if (!k.alive || k.landless || k.kind !== 'realm' || tierIndex(k) !== 0) continue;
    const s = promotionStatus(state, k.id);
    if (s && PROMOTE[1].auto && s.heroes >= PROMOTE[1].auto) { k.gold += s.cost; promoteRealm(state, k.id); }
  }
}

export function build(state, kid, bid) {
  const k = state.kingdoms[kid], b = BUILDINGS[bid];
  if (!b || k.buildings[bid] || tierIndex(k) < b.tier || k.gold < b.cost || k.landless) return false;
  k.gold -= b.cost; k.buildings[bid] = true;
  log(state, `${k.name} built ${b.name}.`, kid, 'build');
  return true;
}

export function loadoutOptions(state, kid) {
  const k = state.kingdoms[kid];
  const t = TIERS[tierIndex(k)];
  return STRATAGEM_IDS.filter((id) => STRATAGEMS[id].tier <= t.stratTier);
}
export function loadoutSlots(state, kid) {
  const k = state.kingdoms[kid];
  return TIERS[tierIndex(k)].stratSlots + (k.buildings.council ? 1 : 0);
}
export function setLoadout(state, kid, ids) {
  const opts = loadoutOptions(state, kid), n = loadoutSlots(state, kid);
  state.kingdoms[kid].loadout = ids.filter((id) => opts.includes(id)).slice(0, n);
  return true;
}

// AI realms grow up on their own
export function aiDevelop(state, k, rng) {
  const s = promotionStatus(state, k.id);
  if (s && s.ok && s.afford && k.gold > s.cost * 1.3) promoteRealm(state, k.id);
  const coastal = state.territories.some((t) => t.owner === k.id && t.nb.some((n) => isSeaLink(state, t.id, n)));
  const want = [coastal ? 'harbour' : null, 'stables', 'spies', 'pits', 'granary', 'beastpit', 'academy', 'magetower', 'aerie', 'council'].filter(Boolean);
  for (const b of want) if (!k.buildings[b] && tierIndex(k) >= BUILDINGS[b].tier && k.gold > BUILDINGS[b].cost * 2) { build(state, k.id, b); break; }
  if (k.food < 30) k.policy.rations = 'half'; else if (k.morale < 35) k.policy.rations = 'feast'; else k.policy.rations = 'normal';
  if (k.stability < 30) k.policy.tax = 'low'; else if (k.gold < 150) k.policy.tax = 'high'; else k.policy.tax = 'normal';
  if (k.edictTurn !== state.turn) {
    if (k.stability < 25) issueEdict(state, k.id, 'martial');
    else if (k.morale < 35) issueEdict(state, k.id, 'festival');
  }
}
