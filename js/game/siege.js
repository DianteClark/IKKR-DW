// Siege blockade: heroes next to an enemy walled town (level >= 2, or any town of a kingdom or empire) can besiege it instead of storming it.
// Each season of siege the town starves (owner loses food, morale and garrison strength). After three seasons the
// town may surrender (it changes hands without a battle) or the besiegers storm the weakened walls.
import { hero, heroesAt, friendly, log, validTargets, isHumanKingdom, clamp } from './world.js';
import { squadPower } from './rules.js';
import { actOfWar } from './diplomacy.js';

export const SIEGE_TURNS = 3;
export function canBesiege(state, h, tid) {
  const t = state.territories[tid];
  const walled = t && t.owner >= 0 && (t.level >= 2 || ['kingdom', 'empire'].includes(state.kingdoms[t.owner].tier));
  return !!walled && t.owner >= 0 && t.owner !== h.kingdom && !friendly(state, h.kingdom, t.owner) && validTargets(state, h).includes(tid);
}
export function besiegeTargets(state, h) { return validTargets(state, h).filter((tid) => canBesiege(state, h, tid)); }

// run before other orders each season; returns nothing, pushes notes into results
export function applySieges(state, rng, results) {
  const by = new Map(); // tid -> besieging heroes
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.type !== 'besiege') continue;
    if (!canBesiege(state, h, h.order.target)) { h.order = null; continue; }
    if (!by.has(h.order.target)) by.set(h.order.target, []);
    by.get(h.order.target).push(h);
  }
  for (const t of state.territories) if (t.siege && !by.has(t.id)) { t.siege = null; }
  for (const [tid, list] of by) {
    const t = state.territories[tid], kid = list[0].kingdom, K = state.kingdoms[t.owner];
    if (!t.siege || t.siege.kid !== kid) { t.siege = { kid, turns: 0 }; actOfWar(state, kid, t.owner, `the siege of ${t.name}`); }
    t.siege.turns++;
    K.food = Math.max(-40, K.food - 15); K.morale = clamp(K.morale - 3);
    for (const d of heroesAt(state, tid, t.owner)) d.hp = Math.max(30, d.hp - 8);
    const note = (text) => { for (const k of new Set([kid, t.owner])) if (isHumanKingdom(state, k)) results.push({ kid: k, text }); };
    if (t.siege.turns < SIEGE_TURNS) { note(`${t.name} is besieged (${t.siege.turns}/${SIEGE_TURNS}): the town starves.`); continue; }
    const ours = list.reduce((s, h) => s + squadPower(h, state.items, state.kingdoms[kid].morale), 0);
    const theirs = heroesAt(state, tid, t.owner).reduce((s, h) => s + squadPower(h, state.items, K.morale), 0) + 40 * t.level * 0.5;
    if (theirs < ours * 0.8 || rng() < 0.3) {
      // surrender: the gates open
      const old = t.owner;
      for (const d of heroesAt(state, tid, old)) { const home = state.territories.find((x) => x.owner === old && x.id !== tid); if (home) d.loc = home.id; }
      t.owner = kid; t.siege = null;
      for (const h of list) { h.loc = tid; h.order = null; }
      log(state, `${t.name} surrendered to ${state.kingdoms[kid].name} after a long siege.`, -1, 'conquest');
      note(`${t.name} surrendered after ${SIEGE_TURNS} seasons of siege!`);
    } else {
      // the walls are weak now: storm them
      for (const h of list) h.order = { type: 'attack', target: tid };
      t.level = Math.max(1, t.level - 1); // breached walls
      note(`The siege of ${t.name} ends: the besiegers storm the weakened walls.`);
      t.siege = null;
    }
  }
}
