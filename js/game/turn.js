// End-of-turn: economy, prisoners, wanderers, world events, diplomacy, then the next turn begins.
import { FACTION_IDS } from '../data/art.js';
import { rngFor, kingdomHeroes, makeHero, decideCaptive, isHumanKingdom, checkKingdoms, log, hero, pickLoadout, tidy, suggestRole } from './world.js';
import { economyTick, aiDevelop, autoPromote } from './kingdom.js';
import { familyTick } from './family.js';
import { neutralTick } from './neutral.js';
import { storyTick } from './stories.js';
import { choiceTick } from './choices.js';
import { weatherTick } from './weather.js';
import { warTick } from './diplomacy.js';
import { worldEvents, vagabondTick, decayMarks } from './events.js';
import { diplomacyTick } from './diplomacy.js';
import { TIERS, tierIndex, ROLE_LEVEL, ROLES } from './rules.js';
import { stewardTick } from './steward.js';

export function endTurn(state) {
  const rng = rngFor(state, 999);
  const notes = [...(state.newsQueue || [])];
  state.newsQueue = [];
  decayMarks(state);
  for (const t of state.territories) if (t.ruined > 0) t.ruined--;
  // the Steward settles each human realm's household before the month is counted
  for (const k of state.kingdoms) if (k.alive && k.player >= 0 && isHumanKingdom(state, k.id)) { const line = stewardTick(state, k); if (line) notes.push({ kid: k.id, kind: 'steward', text: line }); }
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
  const uprisings = []; // revolts raised by wanderers are world events like any other
  vagabondTick(state, rng, uprisings);
  familyTick(state, rng, notes);
  neutralTick(state, rng, notes);
  storyTick(state, rng);
  choiceTick(state, rng);
  const events = [...uprisings, ...worldEvents(state, rng)];
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
  for (const h of state.heroes) {
    if (h.role || h.status !== 'active' || h.level < ROLE_LEVEL || h.kingdom < 0) continue;
    if (!isHumanKingdom(state, h.kingdom)) { if (h.pendingRole) { h.role = h.pendingRole; delete h.pendingRole; } continue; }
    // a player who leaves a calling unchosen for three months: the hero takes the one that suits them
    if ((h.roleWait = (h.roleWait || 0) + 1) >= 3) {
      h.role = ROLES[h.pendingRole] ? h.pendingRole : suggestRole(h); delete h.pendingRole; delete h.roleWait;
      notes.push({ kid: h.kingdom, kind: 'calling', text: `${h.name} took up the calling of ${ROLES[h.role].name}: ${ROLES[h.role].desc}` });
    }
  }
  if (state.turn % 9 === 0) {
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
