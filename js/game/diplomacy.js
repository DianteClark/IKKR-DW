// Alliances, vassals (allegiance by fear), coalitions against a dominant realm, lending heroes, loyalty and defection.
import {
  treaty, allied, friendly, overlordOf, kingdomHeroes, kingdomTerritories, log, clamp, hero, joinKingdom, isHumanKingdom, rngFor,
} from './world.js';
import { squadPower, tierIndex, temper } from './rules.js';

export const opinion = (state, a, b) => (state.kingdoms[a].rel[b] || 0);
function bump(state, a, b, v) { const k = state.kingdoms[a]; k.rel[b] = clamp((k.rel[b] || 0) + v, -100, 100); }

export function realmPower(state, kid) {
  const k = state.kingdoms[kid];
  return kingdomHeroes(state, kid, true).reduce((s, h) => s + squadPower(h, state.items, k.morale), 0) + kingdomTerritories(state, kid).length * 40;
}
export function borders(state, a, b) {
  return state.territories.some((t) => t.owner === a && t.nb.some((n) => state.territories[n].owner === b));
}
export function dominant(state) {
  const counts = new Map();
  for (const t of state.territories) if (t.owner >= 0) counts.set(t.owner, (counts.get(t.owner) || 0) + 1);
  let best = -1, bc = 0;
  for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
  return bc >= state.territories.length * 0.33 ? best : -1;
}
export function alliesOf(state, kid) { return state.treaties.filter((t) => t.type === 'alliance' && (t.a === kid || t.b === kid)).map((t) => (t.a === kid ? t.b : t.a)); }
export function vassalsOf(state, kid) { return state.treaties.filter((t) => t.type === 'vassal' && t.a === kid).map((t) => t.b); }

// how willing `to` is to accept `type` from `from` (>0.5 = yes)
export function willingness(state, to, from, type) {
  const K = state.kingdoms[to];
  if (K.kind === 'monster') return 0;
  const op = opinion(state, to, from) / 100;
  const pTo = realmPower(state, to), pFrom = realmPower(state, from);
  const dom = dominant(state);
  let s = 0.35 + op * 0.5;
  if (type === 'alliance') {
    s += temper(K).ally;
    if (dom >= 0 && dom !== from && dom !== to) s += 0.3;      // band together against the giant
    if (dom === from) s -= 0.35;
    const commonFoes = Object.keys(K.rel).filter((x) => K.rel[x] < -30 && (state.kingdoms[from].rel[x] || 0) < -30).length;
    s += Math.min(0.3, commonFoes * 0.15);
    if (K.kind === 'bandit') s -= dom >= 0 && dom !== from ? 0 : 0.4;
    s += pFrom > pTo * 0.7 ? 0.1 : -0.05;
    if (alliesOf(state, to).length >= 2) s -= 0.6;
    if (alliesOf(state, from).length >= 2 && state.kingdoms[from].player < 0) s -= 0.6;
  } else if (type === 'vassal') {
    const ratio = pFrom / Math.max(1, pTo);
    s = (ratio - 2.2) / 3 + op * 0.3 + (borders(state, from, to) ? 0.15 : -0.3);
    if (K.kind === 'bandit') s -= 0.2;
  } else if (type === 'truce') {
    s = 0.4 + op * 0.4 + (pFrom > pTo ? 0.2 : 0) + temper(K).peace;
  }
  return s;
}

export function makeTreaty(state, a, b, type, proposer) {
  if (treaty(state, a, b, type)) return;
  state.treaties = state.treaties.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)) || t.type === type);
  if (type === 'vassal') state.treaties = state.treaties.filter((t) => !(t.type === 'vassal' && t.b === b));
  state.treaties.push({ a, b, type, proposer, since: state.turn });
  bump(state, a, b, 20); bump(state, b, a, 20);
  const A = state.kingdoms[a], B = state.kingdoms[b];
  log(state, type === 'alliance' ? `${A.name} and ${B.name} formed an alliance.` : type === 'vassal' ? `${B.name} bent the knee to ${A.name}.` : `${A.name} and ${B.name} agreed a truce.`, -1, 'diplomacy');
  // allies drop pending attacks on each other
  for (const h of state.heroes) if (h.order && h.order.type === 'attack') { const o = state.territories[h.order.target].owner; if (friendly(state, h.kingdom, o)) h.order = null; }
}

// returns 'accepted' | 'refused' | 'pending'
export function propose(state, from, to, type) {
  if (from === to || !state.kingdoms[to].alive) return 'refused';
  if (treaty(state, from, to, type)) return 'accepted';
  if (type === 'vassal' && tierIndex(state.kingdoms[from]) < 2 && !isHumanKingdom(state, to)) { /* only empires can demand */ if (state.kingdoms[from].player >= 0) return 'refused'; }
  if (isHumanKingdom(state, to)) {
    if (!state.proposals.some((p) => p.from === from && p.to === to && p.type === type)) state.proposals.push({ id: state.nextId++, from, to, type, turn: state.turn });
    return 'pending';
  }
  const w = willingness(state, to, from, type) + (rngFor(state, from * 7 + to)() - 0.5) * 0.15;
  if (w > 0.5) { makeTreaty(state, type === 'vassal' ? from : from, to, type, from); return 'accepted'; }
  bump(state, to, from, type === 'vassal' ? -25 : -5);
  if (type === 'vassal') log(state, `${state.kingdoms[to].name} refused to bow to ${state.kingdoms[from].name}.`, -1, 'diplomacy');
  return 'refused';
}

export function respondProposal(state, id, accept) {
  const p = state.proposals.find((x) => x.id === id);
  if (!p) return false;
  state.proposals = state.proposals.filter((x) => x.id !== id);
  if (p.type === 'peace') {
    // gold > 0: the offerer pays; gold < 0: the receiver pays to end it
    if (accept) { const pay = p.gold || 0; const F = state.kingdoms[p.from], T = state.kingdoms[p.to];
      if (pay > 0 && F.gold >= pay) { F.gold -= pay; T.gold += pay; } else if (pay < 0 && T.gold >= -pay) { T.gold += pay; F.gold -= pay; }
      makePeace(state, p.from, p.to); }
    else log(state, `${state.kingdoms[p.to].name} rejected peace with ${state.kingdoms[p.from].name}.`, -1, 'war');
    return true;
  }
  if (accept) makeTreaty(state, p.from, p.to, p.type, p.from);
  else { bump(state, p.from, p.to, p.type === 'vassal' ? -30 : -10); log(state, `${state.kingdoms[p.to].name} rejected ${state.kingdoms[p.from].name}'s ${p.type === 'vassal' ? 'demand for fealty' : 'offer of ' + p.type}.`, -1, 'diplomacy'); }
  return true;
}

export function breakTreaty(state, kid, other) {
  const t = treaty(state, kid, other);
  if (!t) return false;
  state.treaties = state.treaties.filter((x) => x !== t);
  bump(state, other, kid, -50);
  for (const k of state.kingdoms) if (k.alive && k.id !== kid && k.id !== other) bump(state, k.id, kid, -8); // word of betrayal travels
  const K = state.kingdoms[kid]; K.stability = clamp(K.stability - 6);
  // lent heroes come home
  for (const h of state.heroes) if ((h.kingdom === kid && h.lentTo === other) || (h.kingdom === other && h.lentTo === kid)) { h.lentTo = -1; h.lentTurns = 0; }
  log(state, `${K.name} broke its ${t.type === 'vassal' ? (t.a === kid ? 'hold over' : 'oath to') : t.type + ' with'} ${state.kingdoms[other].name}!`, -1, 'betrayal');
  return true;
}

export function lendHero(state, kid, heroId, ally, turns = 3) {
  const h = hero(state, heroId);
  if (!h || h.kingdom !== kid || h.status !== 'active' || !allied(state, kid, ally) || kid === ally) return false;
  const host = kingdomTerritories(state, ally);
  if (!host.length) return false;
  // the hero marches to the ally's land nearest to them
  const from = state.territories[h.loc];
  host.sort((a, b) => Math.hypot(a.cx - from.cx, a.cy - from.cy) - Math.hypot(b.cx - from.cx, b.cy - from.cy));
  h.lentTo = ally; h.lentTurns = turns; h.loc = host[0].id; h.order = null;
  bump(state, ally, kid, 12);
  log(state, `${state.kingdoms[kid].name} lent ${h.name} to ${state.kingdoms[ally].name}.`, kid, 'diplomacy');
  return true;
}
export function recallHero(state, kid, heroId) {
  const h = hero(state, heroId);
  if (!h || h.kingdom !== kid || h.lentTo < 0) return false;
  h.lentTo = -1; h.lentTurns = 0;
  const own = kingdomTerritories(state, kid);
  if (own.length) h.loc = own[0].id;
  return true;
}

// once per turn
export function diplomacyTick(state, rng, notes) {
  const alive = state.kingdoms.filter((k) => k.alive);
  const dom = dominant(state);
  for (const k of alive) {
    for (const o of alive) {
      if (o.id === k.id) continue;
      const r = k.rel[o.id] || 0;
      let d = -r * 0.04; // grudges fade
      if (allied(state, k.id, o.id)) d += 1.5;
      if (borders(state, k.id, o.id) && !friendly(state, k.id, o.id)) d -= 0.6;
      if (o.id === dom && k.id !== dom && !friendly(state, k.id, dom)) d -= 4; // fear of the giant
      if (o.kind === 'bandit' || o.kind === 'monster') d -= 1;
      k.rel[o.id] = clamp(r + d, -100, 100);
    }
  }
  // lent heroes: serve their term, may be tempted away
  for (const h of state.heroes) {
    if (h.status !== 'active' || h.lentTo < 0) continue;
    const host = state.kingdoms[h.lentTo];
    if (!host || !host.alive || !allied(state, h.kingdom, h.lentTo)) { recallHero(state, h.kingdom, h.id); continue; }
    h.loyalty = clamp(h.loyalty - 1);
    if (h.loyalty < 40 && host.morale > state.kingdoms[h.kingdom].morale && rng() < 0.1) {
      const from = state.kingdoms[h.kingdom];
      joinKingdom(state, h, host.id, 70);
      notes.push({ kid: from.id, kind: 'defect', text: `${h.name}, lent to ${host.name}, chose to stay and serve them instead!` });
      log(state, `${h.name} left ${from.name} to serve ${host.name}.`, -1, 'betrayal');
      continue;
    }
    if (--h.lentTurns <= 0) { recallHero(state, h.kingdom, h.id); notes.push({ kid: h.kingdom, kind: 'return', text: `${h.name} returned from service with ${host.name}.` }); }
  }
  // loyalty drift + defection / sleepers
  for (const h of state.heroes) {
    if (h.status !== 'active' || h.kingdom < 0) continue;
    const k = state.kingdoms[h.kingdom];
    if (!k || k.kind !== 'realm' && k.kind !== 'rebel') continue;
    const ruler = hero(state, k.ruler);
    let d = k.morale > 60 ? 1 : k.morale < 40 ? -1 : 0;
    if (k.morale < 25) d -= 1;
    if (h.trait === 'loyal') d += 1;
    if (h.trait === 'ambitious' && ruler && ruler.id !== h.id && h.level >= ruler.level) d -= 1;
    if (k.landless) d -= 1;
    if (h.id === k.ruler) { h.loyalty = 100; continue; }
    h.loyalty = clamp(h.loyalty + d);
    if (h.loyalty < 25 && h.secret < 0 && rng() < 0.07) {
      // pick a suitor: an ally, or the strongest hostile neighbour
      const suitors = state.kingdoms.filter((o) => o.alive && o.id !== k.id && o.kind === 'realm' && (borders(state, k.id, o.id) || allied(state, k.id, o.id)));
      if (!suitors.length) continue;
      suitors.sort((a, b) => realmPower(state, b.id) - realmPower(state, a.id));
      const to = suitors[0];
      if (!allied(state, k.id, to.id) && rng() < 0.5) {
        h.secret = to.id; // stays, waiting to strike in battle
        if (isHumanKingdom(state, to.id)) notes.push({ kid: to.id, kind: 'plot', text: `${h.name} of ${k.name} secretly offered you their sword. They will turn when you face them in battle.` });
      } else {
        joinKingdom(state, h, to.id, 65);
        notes.push({ kid: k.id, kind: 'defect', text: `${h.name} deserted ${k.name} and joined ${to.name}!` });
        log(state, `${h.name} deserted ${k.name} for ${to.name}.`, -1, 'betrayal');
      }
    }
  }
  // AI alliances are not forever: old pacts lapse, and opportunists betray weak allies
  for (const t of [...state.treaties]) {
    if (t.type !== 'alliance') continue;
    const A = state.kingdoms[t.a], B = state.kingdoms[t.b];
    for (const [k, o] of [[A, B], [B, A]]) {
      if (k.player >= 0 || !state.treaties.includes(t)) continue;
      const age = state.turn - t.since;
      const op = k.rel[o.id] || 0;
      if (age > 12 && op < 45 && rng() < 0.25 * temper(k).betray) { breakTreaty(state, k.id, o.id); notes.push({ kid: o.id, kind: 'betrayal', text: `${k.name} ended its alliance with ${o.name}.` }); }
      else if (borders(state, k.id, o.id) && realmPower(state, k.id) > realmPower(state, o.id) * 1.8 && op < 20 && rng() < 0.08 * temper(k).betray) { breakTreaty(state, k.id, o.id); notes.push({ kid: o.id, kind: 'betrayal', text: `${k.name} betrayed its alliance with ${o.name}!` }); }
    }
  }
  // AI diplomacy
  for (const k of alive) {
    if (k.player >= 0 || k.kind === 'monster' || k.landless) continue;
    if (rng() > 0.35) continue;
    const others = alive.filter((o) => o.id !== k.id && !friendly(state, k.id, o.id) && o.kind !== 'monster');
    if (!others.length) continue;
    // coalitions against the dominant realm, alliances with friendly neighbours
    const cands = others.filter((o) => (dom >= 0 && o.id !== dom && k.id !== dom) || (k.rel[o.id] || 0) > 25);
    if (cands.length) {
      const o = rng.pick(cands);
      const r = propose(state, k.id, o.id, 'alliance');
      if (r === 'pending') notes.push({ kid: o.id, kind: 'proposal', text: `${k.name} proposes an alliance.` });
    }
    // empires demand fealty from small neighbours
    if (tierIndex(k) >= 2 && rng() < 0.3) {
      const weak = others.filter((o) => borders(state, k.id, o.id) && realmPower(state, k.id) > realmPower(state, o.id) * 2.5);
      if (weak.length) {
        const o = rng.pick(weak);
        const r = propose(state, k.id, o.id, 'vassal');
        if (r === 'pending') notes.push({ kid: o.id, kind: 'demand', text: `${k.name} demands your fealty.` });
      }
    }
  }
  // AI answers to human proposals that the AI received are instant (propose); stale human-received proposals expire
  state.proposals = state.proposals.filter((p) => state.turn - p.turn <= 2 && state.kingdoms[p.from].alive && state.kingdoms[p.to].alive);
}

// ---------------- war ----------------
// Attacking a realm's land or its heroes is an act of war. The wronged realm either declares war (and comes for
// you) or, if it is weaker, sues for peace. War makes AI realms prefer your lands; peace ends it.
export const atWar = (state, a, b) => (state.wars || []).some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
export function warsOf(state, kid) { return (state.wars || []).filter((w) => w.a === kid || w.b === kid).map((w) => (w.a === kid ? w.b : w.a)); }
export function actOfWar(state, by, against, what, notes) {
  if (!notes) notes = (state.newsQueue = state.newsQueue || []);
  if (by < 0 || against < 0 || by === against) return;
  const A = state.kingdoms[by], V = state.kingdoms[against];
  if (!A || !V || !V.alive) return;
  bump(state, against, by, -30);
  for (const k of state.kingdoms) if (k.alive && k.id !== by && k.id !== against && allied(state, k.id, against)) bump(state, k.id, by, -12);
  if (atWar(state, by, against)) return;
  state.wars = state.wars || [];
  const pV = realmPower(state, against), pA = realmPower(state, by);
  if (!isHumanKingdom(state, against) && V.kind === 'realm' && pV < pA * 0.7) {
    // too weak to fight back: offers gold for peace
    state.wars.push({ a: by, b: against, since: state.turn, cause: what });
    const gold = Math.max(60, Math.round(V.gold * 0.3));
    if (isHumanKingdom(state, by)) {
      state.proposals.push({ id: state.nextId++, from: against, to: by, type: 'peace', gold, turn: state.turn });
      if (notes) notes.push({ kid: by, kind: 'diplomacy', text: `${V.name} is outmatched and offers ${gold}g for peace.` });
    } else if (willingness(state, by, against, 'truce') > 0.3) { V.gold -= gold; A.gold += gold; makePeace(state, by, against); }
    log(state, `${A.name} committed an act of war against ${V.name} (${what}).`, against, 'war');
    return;
  }
  state.wars.push({ a: by, b: against, since: state.turn, cause: what });
  log(state, `${V.name} declares war on ${A.name} after ${what}!`, -1, 'war');
  if (notes && isHumanKingdom(state, by)) notes.push({ kid: by, kind: 'war', text: `${V.name} declares war on you after ${what}! Expect them to come for your lands.` });
  if (notes && isHumanKingdom(state, against)) notes.push({ kid: against, kind: 'war', text: `You are at war with ${A.name} after ${what}.` });
}
export function makePeace(state, a, b) {
  state.wars = (state.wars || []).filter((w) => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
  bump(state, a, b, 15); bump(state, b, a, 15);
  log(state, `${state.kingdoms[a].name} and ${state.kingdoms[b].name} made peace.`, -1, 'diplomacy');
  for (const h of state.heroes) if (h.order && h.order.type === 'skirmish' && ((h.kingdom === a && h.order.target === b) || (h.kingdom === b && h.order.target === a))) h.order = null;
}
// a player asks for peace: the other side weighs strength, grudges and how long the war has run
export function offerPeace(state, from, to, gold = 0) {
  if (!atWar(state, from, to)) return 'refused';
  if (isHumanKingdom(state, to)) { state.proposals.push({ id: state.nextId++, from, to, type: 'peace', gold: -gold, turn: state.turn }); return 'pending'; }
  const w = (state.wars || []).find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  const pT = realmPower(state, to), pF = realmPower(state, from);
  const s = 0.35 + temper(state.kingdoms[to]).peace + opinion(state, to, from) / 200 + (pF > pT ? 0.25 : -0.1) + Math.min(0.3, (state.turn - w.since) * 0.03) + gold / Math.max(200, state.kingdoms[to].gold + 200);
  if (s > 0.5 && state.kingdoms[from].gold >= gold) { state.kingdoms[from].gold -= gold; state.kingdoms[to].gold += gold; makePeace(state, from, to); return 'accepted'; }
  return 'refused';
}
