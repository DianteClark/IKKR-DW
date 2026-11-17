// Early goals: teach by doing. Each completes on its own by watching the campaign, pays a small reward
// (through the 'goal' action, so the host stays in charge in two-player games) and leaves a short tip.
import { kingdomHeroes, kingdomTerritories } from '../game/world.js';
import { tierIndex } from '../game/rules.js';

export const GOALS = [
  { id: 'recruit', title: 'Recruit a wanderer', how: 'Find a wanderer in your lands (or court one in the wilds) and hire them.', reward: 120,
    tip: 'Every hero who joins brings their people\'s troops to your realm.',
    done: (st, k) => kingdomHeroes(st, k.id, true).some((h) => h.origin !== k.id) },
  { id: 'hamlet', title: 'Protect or claim a hamlet', how: 'Send a hero into a free hamlet: Protect it for 3 months, or take it by force.', reward: 120,
    tip: 'Protected hamlets join peacefully and lend you their militia.',
    done: (st, k) => kingdomTerritories(st, k.id).length >= 2 || st.territories.some((t) => t.protect && t.protect.kid === k.id) },
  { id: 'battle', title: 'Win your first battle', how: 'Attack a weak neighbour. Check the odds first, and spy for exact ones.', reward: 150,
    tip: 'Survivors rank up and evolve. Rest after battle to refill the squad.',
    done: (st, k) => (st.log || []).some((l) => l.text.startsWith(k.name) && (l.kind === 'conquest' || l.kind === 'defense' || (l.kind === 'skirmish' && l.text.includes(' routed ')))) },
  { id: 'explore', title: 'Explore a wild site', how: 'Move a hero to a ruin, lair, camp, shrine, mine or grove and use it.', reward: 100,
    tip: 'Ruins give gear, mines pay every month, shrines bless a hero for life.',
    done: (st, k) => (st.sites || []).some((s) => s.owner === k.id) || kingdomHeroes(st, k.id, true).some((h) => h.blessed) },
  { id: 'build', title: 'Build something', how: 'Open Realm → Build. Stables let heroes lead riders who move two lands a month.', reward: 100,
    tip: 'Buildings unlock troop types: Stables, Aerie, Mage Tower, Beast Pit.',
    done: (st, k) => Object.keys(k.buildings || {}).length > 0 },
  { id: 'kingdom', title: 'Become a Kingdom', how: 'Gather 5 heroes and your village is crowned a kingdom.', reward: 250,
    tip: 'Kingdoms bring three stratagems per battle, spies and stronger troops.',
    done: (st, k) => tierIndex(k) >= 1 },
];

export function goalState(st, kid) {
  st.goals = st.goals || {};
  return (st.goals[kid] = st.goals[kid] || { done: {}, hidden: false });
}
// goals this kingdom has completed but not yet been paid for
export function newlyDone(st, k) {
  const g = goalState(st, k.id);
  return GOALS.filter((x) => !g.done[x.id] && x.done(st, k));
}
// the 'goal' action: verify and pay
export function claimGoal(st, kid, id) {
  const k = st.kingdoms[kid], G = GOALS.find((x) => x.id === id);
  if (!k || !G) return false;
  const g = goalState(st, kid);
  if (g.done[id] || !G.done(st, k)) return false;
  g.done[id] = st.turn; k.gold += G.reward;
  return true;
}
export function hideGoals(st, kid, hidden = true) { goalState(st, kid).hidden = hidden; return true; }
