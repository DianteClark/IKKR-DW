// Orders for computer-run kingdoms.
import { kingdomHeroes, kingdomTerritories, setOrder, restPrice, rngFor, powerAt, friendly, validTargets, DIFFICULTY } from './world.js';
import { squadCap, squadPower, developCost, temper } from './rules.js';
import { aiWildsOrder } from './neutral.js';
import { atWar } from './diplomacy.js';
import { scoutLand } from './intel.js';
import { raidableHere } from './trade.js';
import { canBesiege } from './siege.js';
import { skirmishTargets, heroesAt } from './world.js';

function frontierDistance(state, kid) {
  const T = state.territories;
  const d = new Array(T.length).fill(1e9);
  let q = T.filter((t) => t.owner !== kid && !friendly(state, kid, t.owner)).map((t) => t.id);
  q.forEach((id) => (d[id] = 0));
  while (q.length) {
    const nq = [];
    for (const id of q) for (const n of T[id].nb) if (d[n] > d[id] + 1) { d[n] = d[id] + 1; nq.push(n); }
    q = nq;
  }
  return d;
}

export function aiOrders(state, kid) {
  const k = state.kingdoms[kid];
  if (!k.alive) return;
  const rng = rngFor(state, kid * 101);
  const heroes = kingdomHeroes(state, kid);
  const items = state.items;
  const diff = DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
  const raider = k.kind === 'bandit' || k.kind === 'monster';
  const aggression = Math.min(1.4, 0.85 + state.turn * 0.02) * (0.85 + rng() * 0.3) * diff.aggr * (raider ? 1.25 : temper(k).aggr);

  const owned = kingdomTerritories(state, kid);
  const dev = owned.filter((t) => t.level < 3).sort((a, b) => a.level - b.level)[0];
  if (dev && !raider && k.gold > developCost(dev) * 2.2) { k.gold -= developCost(dev); dev.level++; }

  const free = new Set();
  for (const h of heroes) {
    const cap = squadCap(h, k);
    if ((h.troops.length < cap * 0.65 && k.gold >= restPrice(state, h) * 0.4) || h.hp < 45) { setOrder(state, h.id, { type: 'rest' }); continue; }
    free.add(h);
  }
  // enemies met in the same land: fight them if at war (or a raider) and clearly stronger
  for (const h of [...free]) {
    for (const foe of skirmishTargets(state, h)) {
      if (!atWar(state, kid, foe) && !raider) continue;
      const mine = heroesAt(state, h.loc, kid).filter((x) => free.has(x));
      const ours = mine.reduce((s, x) => s + squadPower(x, items, k.morale), 0), theirs = heroesAt(state, h.loc, foe).reduce((s, x) => s + squadPower(x, items, 60), 0);
      if (ours > theirs * 1.3) { for (const x of mine) { setOrder(state, x.id, { type: 'skirmish', target: foe }); free.delete(x); } break; }
    }
  }
  // warlike realms and raiders rob caravans passing through
  for (const h of [...free]) {
    const r = raidableHere(state, h); if (!r) continue;
    const victims = [state.territories[r[0]].owner, state.territories[r[1]].owner];
    const keen = raider ? 0.6 : k.temper === 'warlike' ? 0.45 : victims.some((v) => atWar(state, kid, v)) ? 0.5 : k.temper === 'treacherous' ? 0.15 : 0;
    if (rng() < keen) { setOrder(state, h.id, { type: 'raid' }); free.delete(h); }
  }
  // the wilds: keep guarding hamlets, explore sites, court wanderers, plunder if you're a raider
  for (const h of [...free]) {
    if (h.order && h.order.type === 'protect' && state.territories[h.loc].owner < 0) { free.delete(h); continue; }
    if (rng() < (raider ? 0.6 : 0.4) && aiWildsOrder(state, h, rng)) free.delete(h);
  }
  const byLoc = new Map();
  for (const h of free) { if (!byLoc.has(h.loc)) byLoc.set(h.loc, []); byLoc.get(h.loc).push(h); }
  for (const [loc, group] of byLoc) {
    const targets = validTargets(state, group[0]);
    if (!targets.length) continue;
    const ours = group.reduce((s, h) => s + squadPower(h, items, k.morale), 0);
    let best = null, bestScore = 0;
    for (const n of targets) {
      const t = state.territories[n];
      const ownerK = t.owner >= 0 ? state.kingdoms[t.owner] : null;
      const war = ownerK && atWar(state, kid, ownerK.id);
      if (ownerK && ownerK.player >= 0 && state.turn < diff.grace && !war) continue; // grace period for new players (unless they started a war)
      const ratio = ours / Math.max(1, powerAt(state, n));
      const grudge = ownerK ? Math.max(0, -(k.rel[ownerK.id] || 0)) / (k.temper === 'zealous' ? 100 : 200) : 0;
      const bias = (ownerK && ownerK.player >= 0 ? 0.92 : 1) * (1 + t.level * 0.05) * (1 + grudge) * (ownerK && (ownerK.kind === 'bandit' || ownerK.kind === 'monster') ? 1.1 : 1);
      // free hamlets are poor prizes early on: most realms court or guard them before conquering them
      const wild = !ownerK ? Math.min(1, 0.3 + state.turn * 0.004) : 1;
      // after the grace period, realms grow bold against a player only gradually
      const since = state.turn - diff.grace;
      const wary = ownerK && ownerK.player >= 0 && !war ? 1 + (diff.wary - 1) * Math.max(0, 1 - since / diff.ramp) : 1;
      const score = ratio * bias * wild * (war ? 1.6 : 1) / wary;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    let attackers = group;
    if (loc === k.capital && group.length > 1 && !raider) attackers = group.slice(1);
    const walled = best != null && state.territories[best].level >= 2 && !raider && canBesiege(state, group[0], best);
    const sc = bestScore * aggression;
    // walls ahead: patient realms starve them out; even bold ones besiege a town they can't yet storm
    if (walled && sc > 0.55 && (sc <= 1.5 || ['cautious', 'trader', 'zealous'].includes(k.temper)) && !(k.temper === 'warlike' && sc > 1.1)) {
      for (const h of attackers) { setOrder(state, h.id, { type: 'besiege', target: best }); free.delete(h); }
    } else if (best != null && bestScore * aggression > 1.25) {
      for (const h of attackers) { setOrder(state, h.id, { type: 'attack', target: best }); free.delete(h); }
    } else if (k.buildings.spies && rng() < 0.3) {
      scoutLand(state, kid, rng.pick(targets));
    }
  }
  const fd = frontierDistance(state, kid);
  for (const h of free) {
    const t = state.territories[h.loc];
    if (fd[h.loc] > 1) {
      const step = t.nb.filter((n) => state.territories[n].owner === kid).sort((a, b) => fd[a] - fd[b])[0];
      if (step != null && fd[step] < fd[h.loc]) { setOrder(state, h.id, { type: 'move', target: step }); continue; }
    }
    // wander into neighbouring wilds that hold something worth doing
    if (rng() < 0.25 && h.troops.length >= squadCap(h, k) * 0.7) {
      const wild = t.nb.filter((n) => state.territories[n].owner < 0 && ((state.sites || []).some((s) => s.tid === n && s.status === 'active') || state.heroes.some((v) => v.status === 'vagabond' && v.loc === n) || (!raider && !state.territories[n].protect && rng() < 0.3)));
      if (wild.length) { setOrder(state, h.id, { type: 'move', target: rng.pick(wild) }); continue; }
    }
    setOrder(state, h.id, { type: 'rest' });
  }
}

export function runAI(state) {
  for (const k of state.kingdoms) if (k.alive && k.player < 0) aiOrders(state, k.id);
}
