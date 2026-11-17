// Orders for computer-run kingdoms.
import { kingdomHeroes, kingdomTerritories, heroesAt, setOrder, recruitPrice, develop, rngFor, powerAt } from './world.js';
import { squadCap, squadPower, developCost } from './rules.js';

function frontierDistance(state, kid) {
  // BFS distance from each territory to the nearest enemy-owned territory
  const T = state.territories;
  const d = new Array(T.length).fill(1e9);
  let q = T.filter((t) => t.owner !== kid).map((t) => t.id);
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
  const aggression = Math.min(1.35, 0.85 + state.turn * 0.02) * (0.85 + rng() * 0.3);

  // develop when rich
  const owned = kingdomTerritories(state, kid);
  const dev = owned.filter((t) => t.level < 3).sort((a, b) => a.level - b.level)[0];
  if (dev && k.gold > developCost(dev) * 2.2) develop(state, kid, dev.id);

  const free = new Set();
  for (const h of heroes) {
    const cap = squadCap(h);
    if (h.troops.length < cap * 0.65 && k.gold >= recruitPrice(h) * 0.5) { setOrder(state, h.id, { type: 'recruit' }); continue; }
    if (h.morale < 40 || h.hp < 45) { setOrder(state, h.id, { type: 'rest' }); continue; }
    free.add(h);
  }
  // attacks, grouped by location
  const byLoc = new Map();
  for (const h of free) { if (!byLoc.has(h.loc)) byLoc.set(h.loc, []); byLoc.get(h.loc).push(h); }
  for (const [loc, group] of byLoc) {
    const t = state.territories[loc];
    const targets = t.nb.filter((n) => state.territories[n].owner !== kid);
    if (!targets.length) continue;
    const ours = group.reduce((s, h) => s + squadPower(h, items), 0);
    let best = null, bestScore = 0;
    for (const n of targets) {
      const ratio = ours / Math.max(1, powerAt(state, n));
      const owner = state.territories[n].owner;
      const ownerK = owner >= 0 ? state.kingdoms[owner] : null;
      if (ownerK && ownerK.player >= 0 && state.turn < 5) continue; // grace period for new players
      const bias = (ownerK && ownerK.player >= 0 ? 1.05 : 1) * (1 + state.territories[n].level * 0.05);
      const score = ratio * bias;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    // keep one hero home if this is the capital and an enemy borders it
    let attackers = group;
    if (loc === k.capital && group.length > 1) attackers = group.slice(1);
    if (best != null && bestScore * aggression > 1.25) {
      for (const h of attackers) { setOrder(state, h.id, { type: 'attack', target: best }); free.delete(h); }
    }
  }
  // move inland heroes toward the front, others drill
  const fd = frontierDistance(state, kid);
  for (const h of free) {
    const t = state.territories[h.loc];
    if (fd[h.loc] > 1) {
      const step = t.nb.filter((n) => state.territories[n].owner === kid).sort((a, b) => fd[a] - fd[b])[0];
      if (step != null && fd[step] < fd[h.loc]) { setOrder(state, h.id, { type: 'move', target: step }); continue; }
    }
    // reinforce threatened neighbours
    setOrder(state, h.id, { type: h.troops.length < squadCap(h) && k.gold > recruitPrice(h) ? 'recruit' : 'drill' });
  }
}

export function runAI(state) {
  for (const k of state.kingdoms) if (k.alive && k.player < 0) aiOrders(state, k.id);
}
