// Orders for computer-run kingdoms.
import { kingdomHeroes, kingdomTerritories, setOrder, restPrice, rngFor, powerAt, friendly, validTargets, DIFFICULTY } from './world.js';
import { squadCap, squadPower, developCost } from './rules.js';
import { aiWildsOrder } from './neutral.js';

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
  const aggression = Math.min(1.4, 0.85 + state.turn * 0.02) * (0.85 + rng() * 0.3) * diff.aggr * (raider ? 1.25 : 1);

  const owned = kingdomTerritories(state, kid);
  const dev = owned.filter((t) => t.level < 3).sort((a, b) => a.level - b.level)[0];
  if (dev && !raider && k.gold > developCost(dev) * 2.2) { k.gold -= developCost(dev); dev.level++; }

  const free = new Set();
  for (const h of heroes) {
    const cap = squadCap(h, k);
    if ((h.troops.length < cap * 0.65 && k.gold >= restPrice(state, h) * 0.4) || h.hp < 45) { setOrder(state, h.id, { type: 'rest' }); continue; }
    free.add(h);
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
      if (ownerK && ownerK.player >= 0 && state.turn < diff.grace) continue; // grace period for new players
      const ratio = ours / Math.max(1, powerAt(state, n));
      const grudge = ownerK ? Math.max(0, -(k.rel[ownerK.id] || 0)) / 200 : 0;
      const bias = (ownerK && ownerK.player >= 0 ? 0.92 : 1) * (1 + t.level * 0.05) * (1 + grudge) * (ownerK && (ownerK.kind === 'bandit' || ownerK.kind === 'monster') ? 1.1 : 1);
      // free hamlets are poor prizes early on: most realms court or guard them before conquering them
      const wild = !ownerK ? Math.min(1, 0.3 + state.turn * 0.004) : 1;
      const score = ratio * bias * wild;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    let attackers = group;
    if (loc === k.capital && group.length > 1 && !raider) attackers = group.slice(1);
    if (best != null && bestScore * aggression > 1.25) {
      for (const h of attackers) { setOrder(state, h.id, { type: 'attack', target: best }); free.delete(h); }
    } else if (k.buildings.spies && rng() < 0.15) {
      const h = group.find((x) => free.has(x));
      if (h) { setOrder(state, h.id, { type: 'spy', target: rng.pick(targets) }); free.delete(h); }
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
    setOrder(state, h.id, { type: h.troops.length < squadCap(h, k) && k.gold > restPrice(state, h) ? 'rest' : 'drill' });
  }
}

export function runAI(state) {
  for (const k of state.kingdoms) if (k.alive && k.player < 0) aiOrders(state, k.id);
}
