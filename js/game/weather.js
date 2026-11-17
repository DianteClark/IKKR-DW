// Weather: each month a few regions get weather that matters.
//   storm    — sea lanes from these lands are closed this month
//   blizzard — mounted troops lose their two-land ride; attacking into it costs the attacker morale
//   drought  — harvests in these lands fail (−food)
//   fog      — scouting fails here
import { log, isHumanKingdom } from './world.js';
import { seasonOf } from './family.js';

export const WEATHER = {
  storm: { name: 'Storm', icon: '⛈', desc: 'Sea lanes closed this month.' },
  blizzard: { name: 'Blizzard', icon: '❄', desc: 'Riders slowed; attacking here costs morale.' },
  drought: { name: 'Drought', icon: '☀', desc: 'Harvest fails: −10 food from this land.' },
  fog: { name: 'Fog', icon: '☁', desc: 'Scouts see nothing here.' },
};
const COLD = new Set(['sand', 'lava']);
export const weatherAt = (state, t) => (t && t.weather && t.weather.until >= state.turn ? t.weather.kind : null);
export const weatherAtId = (state, tid) => weatherAt(state, state.territories[tid]);

export function weatherTick(state, rng, notes) {
  const season = seasonOf(state.turn); // the season that is starting
  for (const t of state.territories) if (t.weather && t.weather.until < state.turn) t.weather = null;
  const regions = Math.max(1, Math.round(state.territories.length / 22));
  const kinds = { Spring: ['fog', 'storm'], Summer: ['drought', 'drought', 'storm'], Autumn: ['storm', 'fog', 'fog'], Winter: ['blizzard', 'blizzard', 'storm'] }[season];
  for (let r = 0; r < regions; r++) {
    if (rng() < 0.35) continue;
    const kind = rng.pick(kinds);
    const c = rng.pick(state.territories);
    if (kind === 'blizzard' && COLD.has(c.biome)) continue;
    if (kind === 'drought' && (c.biome === 'ice' || c.biome === 'christmas')) continue;
    const area = [c, ...c.nb.map((n) => state.territories[n]).filter(() => rng() < 0.6)];
    for (const t of area) if (!(kind === 'blizzard' && COLD.has(t.biome))) t.weather = { kind, until: state.turn };
    for (const p of state.players) {
      const kid = p.kingdom;
      if (area.some((t) => t.owner === kid) && isHumanKingdom(state, kid)) notes.push({ kid, kind: 'raid', text: `${WEATHER[kind].icon} ${WEATHER[kind].name} over ${c.name}: ${WEATHER[kind].desc}` });
    }
  }
}
