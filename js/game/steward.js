// The Steward runs the realm's household each month so the player can think about war:
// taxes and rations, edicts, buildings and town development, by a chosen focus.
import { BUILDINGS, POLICIES, EDICTS, tierIndex, developCost } from './rules.js';
import { setPolicy, issueEdict, canEdict, build, economyPreview } from './kingdom.js';
import { kingdomTerritories, isSeaLink } from './world.js';
import { warsOf } from './diplomacy.js';

export const STEWARD_FOCUS = {
  grow: { name: 'Grow', desc: 'Builds up towns and the realm: more gold and stronger heroes over time.' },
  defend: { name: 'Defend', desc: 'Keeps a war chest, raises military buildings and fills squads in wartime.' },
  prosper: { name: 'Prosper', desc: 'Keeps the people fed and happy: high Order, full granaries, rich towns.' },
};
export function stewardOf(k) { return k.steward || { on: false, focus: 'grow' }; }

// run for one realm at the start of the month's reckoning; returns one summary line, or null
export function stewardTick(state, k) {
  const s = stewardOf(k);
  if (!s.on || !k.alive || k.landless) return null;
  const did = [];
  const focus = STEWARD_FOCUS[s.focus] ? s.focus : 'grow';
  const reserve = focus === 'defend' ? 450 : focus === 'grow' ? 250 : 300;
  const eco = economyPreview(state, k);
  const war = warsOf(state, k.id).length > 0;
  // rations: never starve, feast when the people are restless and the stores allow it
  const food = k.food + eco.food;
  const rations = food < 40 || eco.food < -15 ? 'half' : (k.morale < (focus === 'prosper' ? 50 : 38) && k.food > 150) ? 'feast' : 'normal';
  // taxes: ease off when Order is low, squeeze when the treasury is empty and the people can bear it
  const tax = k.morale < (focus === 'prosper' ? 45 : 32) ? 'low' : (k.gold < 120 && k.morale > 50) || (focus === 'defend' && war && k.morale > 60) ? 'high' : 'normal';
  if (k.policy.rations !== rations) { setPolicy(state, k.id, 'rations', rations); did.push(`${POLICIES.rations[rations].name.toLowerCase()} rations`); }
  if (k.policy.tax !== tax) { setPolicy(state, k.id, 'tax', tax); did.push(`${POLICIES.tax[tax].name.toLowerCase()} taxes`); }
  // edicts
  if (k.edictTurn !== state.turn) {
    let e = null;
    if (k.morale < 22) e = 'martial';
    else if (k.morale < (focus === 'prosper' ? 48 : 36) && k.gold > 150 + reserve) e = 'festival';
    else if (focus === 'defend' && war && k.morale > 62) e = 'conscript';
    if (e && canEdict(state, k.id, e) && issueEdict(state, k.id, e)) did.push(EDICTS[e].name.toLowerCase());
  }
  // one building a month
  const coastal = kingdomTerritories(state, k.id).some((t) => t.nb.some((n) => isSeaLink(state, t.id, n)));
  const order = {
    grow: ['pits', 'stables', 'spies', 'academy', coastal && 'harbour', 'granary', 'magetower', 'beastpit', 'council', 'aerie'],
    defend: ['pits', 'spies', 'academy', 'stables', 'council', 'beastpit', 'magetower', 'aerie', coastal && 'harbour', 'granary'],
    prosper: ['granary', coastal && 'harbour', 'spies', 'pits', 'stables', 'academy', 'magetower', 'council', 'beastpit', 'aerie'],
  }[focus].filter(Boolean);
  for (const b of order) {
    if (k.buildings[b] || tierIndex(k) < BUILDINGS[b].tier || k.gold < BUILDINGS[b].cost + reserve) continue;
    if (build(state, k.id, b)) { did.push(`built ${BUILDINGS[b].name}`); break; }
  }
  // develop the cheapest town that can grow
  if (focus !== 'defend' || !war) {
    const towns = kingdomTerritories(state, k.id).filter((t) => t.level < 3 && !(t.siege)).sort((a, b) => developCost(a) - developCost(b));
    const t = towns[0];
    if (t && k.gold >= developCost(t) + reserve + (focus === 'grow' ? 0 : 150)) { k.gold -= developCost(t); t.level++; t.ruined = 0; did.push(`developed ${t.name}`); }
  }
  return did.length ? `Steward (${STEWARD_FOCUS[focus].name}): ${did.join(', ')}.` : `Steward (${STEWARD_FOCUS[focus].name}): all is in order.`;
}
