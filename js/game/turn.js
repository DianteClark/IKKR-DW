// End-of-turn: economy, prisoners, wanderers, world events, diplomacy, then the next turn begins.
import { FACTION_IDS } from '../data/art.js';
import { rngFor, kingdomHeroes, makeHero, decideCaptive, isHumanKingdom, checkKingdoms, log, hero, pickLoadout, tidy, suggestRole, courtSize } from './world.js';
import { economyTick, aiDevelop, autoPromote } from './kingdom.js';
import { familyTick } from './family.js';
import { neutralTick } from './neutral.js';
import { storyTick } from './stories.js';
import { choiceTick } from './choices.js';
import { weatherTick } from './weather.js';
import { warTick } from './diplomacy.js';
import { worldEvents, vagabondTick, decayMarks } from './events.js';
import { diplomacyTick } from './diplomacy.js';
import { TIERS, tierIndex, ROLE_LEVEL, ROLES, courtCap, squadCap } from './rules.js';
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
    const pick = r < harsh ? 'execute' : r < 0.55 ? 'recruit' : r < 0.85 ? 'release' : 'keep';
    if (decideCaptive(state, h.id, pick) === 'full') decideCaptive(state, h.id, 'release');
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
  // a realm can only keep so many lords: over the limit, the least of them leaves each month to wander
  for (const k of state.kingdoms) {
    if (!k.alive || k.kind !== 'realm') continue;
    const over = courtSize(state, k.id) - courtCap(k);
    if (over <= 0) continue;
    const court = state.heroes.filter((x) => x.kingdom === k.id && x.status === 'active' && x.lentTo < 0);
    const leaving = court.filter((x) => x.id !== k.ruler).sort((a, b) => a.level - b.level || a.loyalty - b.loyalty).slice(0, Math.max(3, Math.ceil(over / 3)));
    if (!leaving.length) continue;
    const stay = court.filter((x) => !leaving.includes(x));
    for (const go of leaving) {
      // their soldiers stay with the realm where there is room
      for (const sol of go.troops.splice(0)) { const to = stay.find((x) => x.troops.length < squadCap(x, k)); if (to) to.troops.push(sol); }
      go.status = 'vagabond'; go.kingdom = -1; go.order = null;
      log(state, `${go.name} left ${k.name} to wander.`, k.id);
    }
    if (isHumanKingdom(state, k.id)) notes.push({ kid: k.id, kind: 'defect', text: `${leaving.map((x) => x.name).join(', ')} left your service: a ${TIERS[tierIndex(k)].name.toLowerCase()} can keep ${courtCap(k)} heroes at court.` });
  }
  // computer realms can't hoard endless treasure: past a point, it goes to courts, feasts and walls
  for (const k of state.kingdoms) if (k.alive && k.player < 0) k.gold = Math.min(k.gold, 3000 + 1500 * tierIndex(k));
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
