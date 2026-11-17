// Fog of war (campaign map, players only). A realm sees its own lands and their neighbours, the lands its heroes
// stand in and their neighbours, its allies' lands, and anything scouted this month. The AI is not affected.
import { friendly, kingdomHeroes } from './world.js';

export const fogOn = (state) => !!state.fog;
let cache = { key: '', vis: null };
export function visibleLands(state, kid) {
  const k = state.kingdoms[kid];
  const key = state.turn + '|' + kid + '|' + state.territories.map((t) => t.owner).join(',') + '|' + kingdomHeroes(state, kid).map((h) => h.loc).join(',') + '|' + Object.keys(k.intel || {}).join(',');
  if (cache.key === key) return cache.vis;
  const vis = new Uint8Array(state.territories.length);
  const see = (id, nb) => { vis[id] = 1; if (nb) for (const n of state.territories[id].nb) vis[n] = 1; };
  for (const t of state.territories) {
    if (t.owner === kid) see(t.id, true);
    else if (t.owner >= 0 && friendly(state, kid, t.owner)) see(t.id, false);
  }
  for (const h of kingdomHeroes(state, kid, true)) see(h.loc, true);
  for (const id in k.intel || {}) if (k.intel[id] && k.intel[id].turn >= state.turn) vis[+id] = 1;
  cache = { key, vis };
  return vis;
}
