// Armies: heroes of one realm standing in the same land march and fight under one banner.
// They form on their own and split when someone walks away. Battles still use each hero's squad.
import { kingdomHeroes } from './world.js';
import { SIEGE_TURNS } from './siege.js';
import { PROTECT_TURNS } from './neutral.js';

// the ruler leads if present, else the highest level (then the biggest squad)
export function commanderOf(state, list) {
  if (!list || !list.length) return null;
  const k = state.kingdoms[list[0].kingdom];
  return list.find((h) => k && h.id === k.ruler) || [...list].sort((a, b) => b.level - a.level || b.troops.length - a.troops.length || a.id - b.id)[0];
}
// my heroes in one land, commander first
export function armyAt(state, kid, tid) {
  const members = kingdomHeroes(state, kid).filter((h) => h.loc === tid);
  const lead = commanderOf(state, members);
  return lead ? [lead, ...members.filter((h) => h !== lead)] : [];
}
// every group of a realm's heroes: [[commander, ...members], ...]
export function armiesOf(state, kid) {
  const by = new Map();
  for (const h of kingdomHeroes(state, kid)) { if (!by.has(h.loc)) by.set(h.loc, []); by.get(h.loc).push(h); }
  return [...by.keys()].map((tid) => armyAt(state, kid, tid));
}
// the shared order of a group, or null if they disagree / have none
export function sharedOrder(list) {
  const o = list[0] && list[0].order;
  if (!o) return list.every((h) => !h.order) ? null : 'mixed';
  return list.every((h) => h.order && h.order.type === o.type && h.order.target === o.target && h.order.site === o.site) ? o : 'mixed';
}
const STANDING = ['protect', 'besiege'];
export function isStanding(o) { return !!o && STANDING.includes(o.type); }
// one line describing an order, with progress for orders that last several months
export function orderStatus(state, h) {
  const o = h.order; if (!o) return null;
  const T = (id) => (state.territories[id] || {}).name || '';
  if (o.type === 'besiege') {
    const t = state.territories[o.target];
    const n = t && t.siege && t.siege.kid === h.kingdom ? t.siege.turns : 0;
    return { text: `Besieging ${T(o.target)} · month ${Math.min(SIEGE_TURNS, n + 1)} of ${SIEGE_TURNS}`, standing: true, icon: 'siege', cls: 'bad' };
  }
  if (o.type === 'protect') {
    const t = state.territories[h.loc];
    const n = t && t.protect && t.protect.kid === h.kingdom ? t.protect.turns : 0;
    return { text: `Protecting ${T(h.loc)} ${n}/${PROTECT_TURNS}`, standing: true, icon: 'shield', cls: 'good' };
  }
  const site = o.site != null ? (state.sites || []).find((s) => s.id === o.site) : null;
  const txt = {
    attack: o.target === h.loc ? `Taking ${T(o.target)}` : `Attacking ${T(o.target)}`, move: `Marching to ${T(o.target)}`, rest: 'Resting & training',
    plunder: `Plundering ${T(h.loc)}`, explore: site ? `Exploring the ${site.kind}` : 'Exploring', court: 'Courting a wanderer',
    skirmish: `Fighting ${((state.kingdoms[o.target] || {}).name || '').split(' of ').pop()}'s heroes`, raid: 'Raiding a caravan',
  }[o.type] || o.type;
  return { text: txt, standing: false, icon: o.type === 'attack' || o.type === 'skirmish' ? 'swords' : o.type === 'move' ? 'march' : null, cls: o.type === 'attack' || o.type === 'skirmish' || o.type === 'plunder' ? 'bad' : o.type === 'rest' ? 'good' : 'gold' };
}
