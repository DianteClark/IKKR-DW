// Trade caravans: wherever a realm's land borders a friendly realm (ally, vassal or overlord) a trade road runs,
// paying both sides each season. Caravans walk those roads on the map. A hero standing on a trade land of two
// other realms can raid the caravan for gold — an act of war against the land's owner.
import { friendly, log, hero } from './world.js';
import { actOfWar } from './diplomacy.js';
import { temper } from './rules.js';

export const TRADE_GOLD = 14, MAX_ROUTES = 6;

// all trade routes in the world: [landA, landB] with different, friendly owners
export function tradeRoutes(state) {
  if (state._tr && state._tr.turn === state.turn && state._tr.n === state.treaties.length) return state._tr.list;
  const list = [];
  for (const t of state.territories) {
    if (t.owner < 0) continue;
    for (const n of t.nb) {
      if (n < t.id) continue;
      const u = state.territories[n];
      if (u.owner < 0 || u.owner === t.owner || !friendly(state, t.owner, u.owner)) continue;
      if (t.raided === state.turn || u.raided === state.turn) continue;
      list.push([t.id, n]);
    }
  }
  Object.defineProperty(state, '_tr', { value: { turn: state.turn, n: state.treaties.length, list }, enumerable: false, configurable: true, writable: true });
  return list;
}
export function tradeIncome(state, kid) {
  const k = state.kingdoms[kid];
  const n = tradeRoutes(state).filter(([a, b]) => state.territories[a].owner === kid || state.territories[b].owner === kid).length;
  return Math.round(Math.min(MAX_ROUTES, n) * TRADE_GOLD * (k && k.player < 0 ? temper(k).trade : 1));
}
// can this hero raid a caravan where they stand?
export function raidableHere(state, h) {
  if (!h || h.status !== 'active') return null;
  const r = tradeRoutes(state).find(([a, b]) => (a === h.loc || b === h.loc) && ![state.territories[a].owner, state.territories[b].owner].some((o) => o === h.kingdom || friendly(state, h.kingdom, o)));
  return r || null;
}
export function resolveRaid(state, h, results) {
  const r = raidableHere(state, h);
  if (!r) return;
  const t = state.territories[h.loc], victim = t.owner;
  const gold = 60 + Math.round(h.level * 8);
  state.kingdoms[h.kingdom].gold += gold;
  t.raided = state.turn; state.territories[r[0] === h.loc ? r[1] : r[0]].raided = state.turn;
  results.push({ kid: h.kingdom, text: `${h.name} raided a caravan at ${t.name}: +${gold}g.` });
  log(state, `${h.name} raided a caravan at ${t.name}.`, -1, 'war');
  if (victim >= 0) actOfWar(state, h.kingdom, victim, `a caravan raid at ${t.name}`);
}
