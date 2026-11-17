// End-of-turn: economy, prisoners, wanderers, world events, diplomacy, then the next turn begins.
import { FACTION_IDS } from '../data/art.js';
import { rngFor, kingdomHeroes, makeHero, decideCaptive, isHumanKingdom, checkKingdoms, log, hero, pickLoadout, tidy } from './world.js';
import { economyTick, aiDevelop, autoPromote } from './kingdom.js';
import { familyTick } from './family.js';
import { neutralTick } from './neutral.js';
import { storyTick } from './stories.js';
import { choiceTick } from './choices.js';
import { weatherTick } from './weather.js';
import { warTick } from './diplomacy.js';
import { worldEvents, vagabondTick, decayMarks } from './events.js';
import { diplomacyTick } from './diplomacy.js';
import { TIERS, tierIndex } from './rules.js';

export function endTurn(state) {
  const rng = rngFor(state, 999);
  const notes = [...(state.newsQueue || [])];
  state.newsQueue = [];
  decayMarks(state);
  for (const t of state.territories) if (t.ruined > 0) t.ruined--;
  for (const k of state.kingdoms) economyTick(state, k, rng, notes);
  for (const h of state.heroes) {
    if (h.status !== 'active') continue;
    h.hp = Math.min(100, h.hp + 10);
    // standing orders (guarding a hamlet, a siege) carry on month after month until changed
    if (h.order && !['protect', 'besiege'].includes(h.order.type)) h.order = null;
  }
  // AI decides the fate of its prisoners
  for (const h of state.heroes) {
    if (h.status !== 'captive' || isHumanKingdom(state, h.captor)) continue;
    const r = rng();
    const k = state.kingdoms[h.captor];
    const harsh = k.kind === 'bandit' || k.kind === 'monster' ? 0.35 : 0.15;
    decideCaptive(state, h.id, r < harsh ? 'execute' : r < 0.55 ? 'recruit' : r < 0.85 ? 'release' : 'keep');
  }
  vagabondTick(state, rng, notes);
  familyTick(state, rng, notes);
  neutralTick(state, rng, notes);
  storyTick(state, rng);
  choiceTick(state, rng);
  const events = worldEvents(state, rng);
  diplomacyTick(state, rng, notes);
  warTick(state, rng);
  // realms with land but no heroes raise a champion; AI realms grow
  for (const k of state.kingdoms) {
    if (!k.alive || k.landless) continue;
    if (!kingdomHeroes(state, k.id, true).length) {
      const h = makeHero(state, rng, k.fid, k.id, k.capital, { troops: 5, maxUnit: TIERS[tierIndex(k)].maxUnitLevel });
      if (!hero(state, k.ruler) || hero(state, k.ruler).status !== 'active') k.ruler = h.id;
      log(state, `${h.name} rose to defend ${k.name}.`, k.id);
    }
    if (k.player < 0) { aiDevelop(state, k, rng); if (state.turn % 5 === 0) k.loadout = pickLoadout(k, rng); }
  }
  autoPromote(state);
  for (const h of state.heroes) if (h.pendingRole && !h.role && !isHumanKingdom(state, h.kingdom)) { h.role = h.pendingRole; delete h.pendingRole; }
  if (state.turn % 3 === 0) {
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) makeHero(state, rng, rng.pick(FACTION_IDS), -1, rng.pick(state.territories).id, { status: 'vagabond', level: Math.floor(state.turn / 6) });
  }
  checkKingdoms(state);
  tidy(state);
  state.turn++;
  weatherTick(state, rng, notes);
  notes.push(...(state.newsQueue || [])); state.newsQueue = [];
  state.events = events;
  return { events, notes };
}
