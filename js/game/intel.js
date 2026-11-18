// Scouting: a Spy Network gives a realm a few reveals each month (Scout-calling heroes add one each).
// Scouting a land reveals its defenders and the exact battle odds until the end of next month.
import { kingdomHeroes, log } from './world.js';

export function scoutsPerSeason(state, k) {
  if (!k.buildings || !k.buildings.spies) return 0;
  return 2 + kingdomHeroes(state, k.id).filter((h) => h.role === 'scout').length;
}
export function scoutsLeft(state, k) {
  const used = k.scouted && k.scouted.turn === state.turn ? k.scouted.n : 0;
  return Math.max(0, scoutsPerSeason(state, k) + (k.scoutBonus === state.turn ? 1 : 0) - used); // a turned spy lends one more
}
// lands worth scouting: anything within two steps of your lands or heroes
export function scoutableLands(state, kid) {
  const near = new Set();
  const seed = [...state.territories.filter((t) => t.owner === kid).map((t) => t.id), ...kingdomHeroes(state, kid).map((h) => h.loc)];
  for (const a of seed) { near.add(a); for (const b of state.territories[a].nb) { near.add(b); for (const c of state.territories[b].nb) near.add(c); } }
  return [...near].filter((id) => state.territories[id].owner !== kid);
}
export function scoutLand(state, kid, tid) {
  const k = state.kingdoms[kid];
  if (!k || scoutsLeft(state, k) <= 0 || tid == null || !state.territories[tid]) return false;
  if (!scoutableLands(state, kid).includes(tid)) return false;
  if (!k.scouted || k.scouted.turn !== state.turn) k.scouted = { turn: state.turn, n: 0 };
  k.scouted.n++;
  const t = state.territories[tid];
  if ((t.weather || {}).kind === 'fog' && (t.weather.until || 0) >= state.turn) { log(state, `Fog hid ${t.name} from ${k.name}'s scouts.`, kid, 'intel'); return 'fog'; }
  k.intel[tid] = { turn: state.turn + 1 };
  log(state, `${k.name}'s scouts mapped the defences of ${t.name}.`, kid, 'intel');
  return true;
}
