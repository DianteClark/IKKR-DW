// World generation. Everything is derived from the seed, so peers rebuild the same map locally.
// Sizes: small (~24 lands), medium (~44), large (~70), huge (~100, archipelago linked by sea lanes).
import { makeRng, makeNoise } from '../engine/rng.js';
import { BIOME_IDS } from '../data/art.js';
import { placeName } from './names.js';
import { astar } from '../maps/paint.js';

export const SIZES = {
  small: { W: 80, H: 48, n: 24, scale: 15 },
  medium: { W: 112, H: 68, n: 44, scale: 20 },
  large: { W: 140, H: 86, n: 70, scale: 23 },
  huge: { W: 188, H: 116, n: 100, scale: 18, islands: true },
};
export const MAP_W = SIZES.medium.W, MAP_H = SIZES.medium.H;

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function components(W, H, grid, want) {
  const N = W * H, id = new Int32Array(N).fill(-1), sizes = [];
  for (let i = 0; i < N; i++) {
    if (grid[i] !== want || id[i] >= 0) continue;
    const c = sizes.length; let sz = 0; const st = [i]; id[i] = c;
    while (st.length) {
      const j = st.pop(); sz++;
      const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx; if (grid[k] === want && id[k] < 0) { id[k] = c; st.push(k); }
      }
    }
    sizes.push(sz);
  }
  return { id, sizes };
}

export function generateTerrain(seed, opts) {
  let size = 'medium', count = null;
  if (typeof opts === 'number') { count = opts; size = opts <= 28 ? 'small' : opts <= 50 ? 'medium' : opts <= 80 ? 'large' : 'huge'; }
  else if (opts && opts.size && SIZES[opts.size]) size = opts.size;
  const cfg = SIZES[size];
  const W = cfg.W, H = cfg.H, N = W * H;
  const territoryCount = count || cfg.n;
  const rng = makeRng(seed);
  const nLand = makeNoise(seed ^ 0x1111), nTemp = makeNoise(seed ^ 0x2222), nWet = makeNoise(seed ^ 0x3333), nSpec = makeNoise(seed ^ 0x4444);
  const nForest = makeNoise(seed ^ 0x5555), nMtn = makeNoise(seed ^ 0x6666), nFlower = makeNoise(seed ^ 0x7777);
  const sc = cfg.scale;

  // ---- land mask ----
  const land = new Uint8Array(N);
  if (cfg.islands) {
    const K = rng.int(5, 6);
    const centers = [];
    let tries = 0;
    while (centers.length < K && tries++ < 500) {
      const cx = rng.int(Math.floor(W * 0.14), Math.floor(W * 0.86)), cy = rng.int(Math.floor(H * 0.16), Math.floor(H * 0.84));
      if (centers.every((c) => Math.hypot(c.x - cx, (c.y - cy) * 1.3) > W * 0.24)) centers.push({ x: cx, y: cy, r: W * (0.15 + rng() * 0.06) });
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let b = 0;
      for (const c of centers) { const d = Math.hypot(x - c.x, (y - c.y) * 1.25) / c.r; b = Math.max(b, 1 - d); }
      const v = nLand(x / sc, y / sc, 4) * 0.55 + b * 0.85;
      land[y * W + x] = v > 0.6 ? 1 : 0;
    }
  } else {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ex = Math.min(x, W - 1 - x) / (W * 0.5), ey = Math.min(y, H - 1 - y) / (H * 0.5);
      const edge = Math.min(1, Math.min(ex, ey * 1.1) * 2.1);
      const v = edge + (nLand(x / (sc * 1.5), y / (sc * 1.5), 4) - 0.5) * 2.2 + (nSpec(x / 6, y / 6, 2) - 0.5) * 0.35;
      land[y * W + x] = v > 0.5 ? 1 : 0;
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) land[y * W + x] = 0;
  // smoothing pass so coastlines aren't jagged
  for (let pass = 0; pass < 2; pass++) {
    const copy = land.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += copy[(y + dy) * W + x + dx];
      const i = y * W + x; if (n >= 6) land[i] = 1; else if (n <= 3) land[i] = 0;
    }
  }
  let L = components(W, H, land, 1);
  if (cfg.islands) {
    for (let i = 0; i < N; i++) if (land[i] && L.sizes[L.id[i]] < 70) land[i] = 0;
  } else {
    const big = L.sizes.indexOf(Math.max(...L.sizes));
    for (let i = 0; i < N; i++) if (land[i] && L.id[i] !== big) land[i] = 0;
  }
  const Wt = components(W, H, land, 0);
  // fill puddles; keep real lakes
  const oceanComp = Wt.id[0];
  for (let i = 0; i < N; i++) if (!land[i] && Wt.id[i] !== oceanComp && Wt.sizes[Wt.id[i]] < 18) land[i] = 1;
  L = components(W, H, land, 1);

  // ---- biomes ----
  const biome = new Uint8Array(N);
  const B = Object.fromEntries(BIOME_IDS.map((b, i) => [b, i]));
  const bs = sc * 1.25;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H + (nTemp(x / bs, y / bs, 3) - 0.5) * 0.45;
    const m = nWet(x / (bs * 0.75), y / (bs * 0.75), 3), s = nSpec(x / (bs * 0.6), y / (bs * 0.6), 3);
    let b;
    if (t < 0.2) b = m > 0.58 ? 'christmas' : 'ice';
    else if (t > 0.84) b = m < 0.45 ? 'lava' : 'sand';
    else if (t > 0.66) b = m < 0.47 ? 'sand' : 'dirt';
    else if (m > 0.64) b = s > 0.55 ? 'deepmarsh' : 'marsh';
    else if (m < 0.34) b = 'dirt';
    else b = 'grass';
    if (s > 0.76) b = 'cave';
    else if (s < 0.2 && t > 0.3 && t < 0.75) b = 'dungeon';
    biome[y * W + x] = B[b];
  }

  for (let pass = 0; pass < 2; pass++) {
    const copy = biome.slice(); const cnt = new Uint8Array(BIOME_IDS.length);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      cnt.fill(0); let best = copy[y * W + x], bc = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const b = copy[(y + dy) * W + x + dx]; if (++cnt[b] > bc) { bc = cnt[b]; best = b; } }
      if (bc >= 5) biome[y * W + x] = best;
    }
  }

  // ---- territories ----
  const landCells = [];
  for (let i = 0; i < N; i++) if (land[i]) landCells.push(i);
  rng.shuffle(landCells);
  const seeds = [];
  let minD = Math.max(5, Math.sqrt(landCells.length / territoryCount) * 0.95);
  const far = (c, d) => { const x = c % W, y = (c / W) | 0; return seeds.every((s) => Math.hypot((s % W) - x, ((s / W) | 0) - y) >= d); };
  // every landmass gets at least one territory
  const compSeeded = new Set();
  for (const c of landCells) {
    const comp = L.id[c];
    if (compSeeded.has(comp)) continue;
    const x = c % W, y = (c / W) | 0;
    if (x < 3 || y < 4 || x > W - 4 || y > H - 3) continue;
    seeds.push(c); compSeeded.add(comp);
  }
  while (seeds.length < territoryCount && minD > 3) {
    for (const c of landCells) {
      if (seeds.length >= territoryCount) break;
      const x = c % W, y = (c / W) | 0;
      if (x < 3 || y < 5 || x > W - 4 || y > H - 3) continue;
      if (far(c, minD)) seeds.push(c);
    }
    minD -= 0.75;
  }
  // grow lands outward from their seeds by travel cost: high ground and wild noise are slow to cross,
  // so borders settle along ridges and read as natural frontiers instead of random zig-zags
  const terr = new Int16Array(N).fill(-1);
  const nBorder = makeNoise(seed ^ 0x9a9a);
  const stepCost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const ridge = 1 - Math.abs(2 * nMtn(x / 11, y / 11, 3) - 1);
    stepCost[i] = 1 + Math.max(0, ridge - 0.7) * 14 + nBorder(x / 5, y / 5, 2) * 0.9;
  }
  {
    const best = new Float32Array(N).fill(Infinity);
    const heap = [];
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    seeds.forEach((s0, i) => { best[s0] = 0; terr[s0] = i; push(0, s0); });
    while (heap.length) {
      const [g, j] = pop(); if (g > best[j]) continue;
      const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx; if (!land[k]) continue;
        const ng = g + stepCost[k];
        if (ng < best[k]) { best[k] = ng; terr[k] = terr[j]; push(ng, k); }
      }
    }
  }
  // smooth borders: majority vote, never orphaning a seed
  const seedSet = new Set(seeds);
  for (let pass = 0; pass < 2; pass++) {
    const copy = terr.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (!land[i] || seedSet.has(i)) continue;
      const cnt = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = copy[(y + dy) * W + x + dx]; if (t >= 0) cnt.set(t, (cnt.get(t) || 0) + 1); }
      let bt = copy[i], bc = cnt.get(copy[i]) || 0;
      for (const [t, c] of cnt) if (c > bc) { bt = t; bc = c; }
      if (bc >= 6) terr[i] = bt;
    }
  }
  // drop disconnected crumbs of a land into whichever neighbour surrounds them
  {
    const seen = new Uint8Array(N);
    for (let s0 = 0; s0 < seeds.length; s0++) {
      const st = [seeds[s0]]; seen[seeds[s0]] = 1;
      while (st.length) { const j = st.pop(); const x = j % W, y = (j / W) | 0; for (const [dx, dy] of DIRS4) { const k = (y + dy) * W + x + dx; if (!seen[k] && terr[k] === s0) { seen[k] = 1; st.push(k); } } }
    }
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < N; i++) {
      if (!land[i] || seen[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS4) { const k = (y + dy) * W + x + dx; if (seen[k] && terr[k] >= 0) { terr[i] = terr[k]; seen[i] = 1; break; } }
    }
  }
  const used = new Set();
  const T = seeds.map((s, i) => ({ id: i, cells: 0, sx: 0, sy: 0, biomeCount: new Array(BIOME_IDS.length).fill(0), nb: new Set(), comp: L.id[s], coastal: [] }));
  for (let i = 0; i < N; i++) {
    const t = terr[i]; if (t < 0) continue;
    const x = i % W, y = (i / W) | 0, o = T[t];
    o.cells++; o.sx += x; o.sy += y; o.biomeCount[biome[i]]++;
    if (x + 1 < W && terr[i + 1] >= 0 && terr[i + 1] !== t) { o.nb.add(terr[i + 1]); T[terr[i + 1]].nb.add(t); }
    if (y + 1 < H && terr[i + W] >= 0 && terr[i + W] !== t) { o.nb.add(terr[i + W]); T[terr[i + W]].nb.add(t); }
    if (!land[i - 1] || !land[i + 1] || !land[i - W] || !land[i + W]) o.coastal.push(i);
  }
  const zoneBlocked = (x, y, t) => {
    for (let dy = -4; dy <= 1; dy++) for (let dx = -2; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) return true;
      const k = yy * W + xx; if (!land[k] || terr[k] !== t) return true;
    }
    return false;
  };
  const territories = T.map((o) => {
    const cx = o.sx / o.cells, cy = o.sy / o.cells;
    let best = seeds[o.id], bd = 1e9;
    for (let y = Math.max(5, Math.floor(cy) - 7); y <= Math.min(H - 3, Math.floor(cy) + 7); y++)
      for (let x = Math.max(3, Math.floor(cx) - 7); x <= Math.min(W - 4, Math.floor(cx) + 7); x++) {
        const k = y * W + x; if (terr[k] !== o.id) continue;
        const d = Math.hypot(x - cx, y - cy) + (zoneBlocked(x, y, o.id) ? 25 : 0);
        if (d < bd) { bd = d; best = k; }
      }
    // tundra/desert/etc. read by the land: one biome per land so terrain and borders agree
    const b = o.biomeCount.indexOf(Math.max(...o.biomeCount));
    return { id: o.id, name: placeName(rng, used), cx: best % W, cy: (best / W) | 0, biome: BIOME_IDS[b], size: o.cells, nb: [...o.nb] };
  });

  for (let i = 0; i < N; i++) if (terr[i] >= 0) biome[i] = BIOME_IDS.indexOf(territories[terr[i]].biome);
  // water cells next to land take that land's biome (for coast texturing)
  // town footprint occupancy (no trees/roads through the town itself)
  const occ = new Uint8Array(N); // 1 town, 2 road, 3 field, 4 house/landmark, 5 river
  const townZone = (t, fn) => { for (let dy = -4; dy <= 0; dy++) for (let dx = -2; dx <= 3; dx++) { const x = t.cx + dx, y = t.cy + dy; if (x >= 0 && y >= 0 && x < W && y < H) fn(y * W + x, dx, dy); } };
  for (const t of territories) townZone(t, (k) => (occ[k] = 1));

  // ---- sea links ----
  const seaLinks = [];
  const linkKey = new Set();
  const addLink = (a, b) => { const k = Math.min(a, b) + ':' + Math.max(a, b); if (linkKey.has(k) || a === b) return; linkKey.add(k); seaLinks.push([a, b]); };
  const coastalT = territories.filter((t) => T[t.id].coastal.length > 0);
  const tdist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const comps = [...new Set(territories.map((t) => T[t.id].comp))];
  if (comps.length > 1) {
    const inTree = new Set([comps[0]]);
    while (inTree.size < comps.length) {
      let best = null;
      for (const a of coastalT) for (const b of coastalT) {
        if (!inTree.has(T[a.id].comp) || inTree.has(T[b.id].comp)) continue;
        const d = tdist(a, b); if (!best || d < best[2]) best = [a.id, b.id, d];
      }
      if (!best) break;
      addLink(best[0], best[1]); inTree.add(T[best[1]].comp);
    }
    // extra cross links for loops
    for (let e = 0; e < Math.ceil(comps.length / 2); e++) {
      const a = rng.pick(coastalT);
      const cands = coastalT.filter((b) => T[b.id].comp !== T[a.id].comp).sort((p, q2) => tdist(a, p) - tdist(a, q2));
      if (cands.length) addLink(a.id, cands[0].id);
    }
  } else if (size === 'large' || size === 'medium') {
    // one or two coastal shipping lanes between far-apart shores
    for (let e = 0; e < (size === 'large' ? 2 : 1); e++) {
      const a = rng.pick(coastalT);
      const cands = coastalT.filter((b) => b.id !== a.id && !a.nb.includes(b.id) && tdist(a, b) > 14 && tdist(a, b) < 40);
      if (cands.length) addLink(a.id, rng.pick(cands).id);
    }
  }
  for (const [a, b] of seaLinks) { if (!territories[a].nb.includes(b)) territories[a].nb.push(b); if (!territories[b].nb.includes(a)) territories[b].nb.push(a); }
  for (const t of territories) t.nb.sort((a, b) => a - b);

  // dock spots: coastal land cell of a facing b, water cell next to it
  const docks = [];
  const dockOf = new Map();
  const coastWater = (k) => { const x = k % W, y = (k / W) | 0; for (const [dx, dy] of DIRS4) { const j = (y + dy) * W + x + dx; if (!land[j]) return j; } return -1; };
  const findDock = (a, b) => {
    const key = a + '>' + b; if (dockOf.has(key)) return dockOf.get(key);
    const tb = territories[b];
    let best = null, bd = 1e9;
    for (const k of T[a].coastal) {
      if (occ[k]) continue;
      const kx = k % W, ky = (k / W) | 0;
      if (land[k - 1] + land[k + 1] + land[k - W] + land[k + W] < 3 || ky < 3) continue;
      const w = coastWater(k); if (w < 0) continue;
      const d = Math.hypot((k % W) - tb.cx, ((k / W) | 0) - tb.cy);
      if (d < bd) { bd = d; best = { land: k, water: w, tid: a }; }
    }
    if (best) { docks.push({ x: best.land % W, y: (best.land / W) | 0, wx: best.water % W, wy: (best.water / W) | 0, tid: a }); occ[best.land] = 4; }
    dockOf.set(key, best);
    return best;
  };
  const seaRoutes = [];
  for (const [a, b] of seaLinks) {
    const da = findDock(a, b), db = findDock(b, a);
    if (!da || !db) continue;
    // sail around land: A* over water
    const path = astar(W, H, da.water, db.water, (k) => (land[k] ? Infinity : 1));
    if (path) seaRoutes.push({ a, b, pts: path.filter((_, i) => i % 2 === 0 || i === path.length - 1).map((k) => [k % W, (k / W) | 0]) });
  }

  // ---- height + rivers ----
  const dist = new Float32Array(N).fill(1e9);
  let fr = []; for (let i = 0; i < N; i++) if (!land[i]) { dist[i] = 0; fr.push(i); }
  while (fr.length) { const nf = []; for (const j of fr) { const x = j % W, y = (j / W) | 0; for (const [dx, dy] of DIRS4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const k = ny * W + nx; if (dist[k] > dist[j] + 1) { dist[k] = dist[j] + 1; nf.push(k); } } } fr = nf; }
  const height = new Float32Array(N);
  const nMeander = makeNoise(seed ^ 0x8888);
  for (let i = 0; i < N; i++) height[i] = dist[i] * 0.8 + nMtn((i % W) / 9, ((i / W) | 0) / 9, 3) * 6 + nMeander((i % W) / 4, ((i / W) | 0) / 4, 2) * 7;
  const river = new Uint8Array(N);
  const rivers = [];
  const nRivers = { small: 2, medium: 3, large: 5, huge: 5 }[size];
  const srcCands = landCells.filter((c) => dist[c] >= 5 && !occ[c]).sort((a, b) => height[b] - height[a]);
  for (let r = 0, tries = 0; r < nRivers && tries < 60; tries++) {
    const src = srcCands[Math.floor(Math.pow(rng(), 2) * Math.min(srcCands.length, 400))];
    if (src == null || river[src]) continue;
    const path = [src]; const seen = new Set([src]); let cur = src, ok = false;
    for (let step = 0; step < 200; step++) {
      const x = cur % W, y = (cur / W) | 0;
      let best = -1, bh = Infinity;
      for (const [dx, dy] of DIRS4) {
        const k = (y + dy) * W + x + dx;
        if (seen.has(k) || occ[k] === 1) continue;
        const h = height[k] + rng() * 0.8;
        if (h < bh) { bh = h; best = k; }
      }
      if (best < 0) break;
      path.push(best); seen.add(best); cur = best;
      if (!land[best] || river[best]) { ok = true; break; }
    }
    if (!ok || path.length < 9) continue;
    for (const k of path) if (land[k]) { river[k] = 1; occ[k] = occ[k] || 5; }
    rivers.push(path.map((k) => [k % W, (k / W) | 0]));
    r++;
  }

  // ---- features: dense forests and mountain ranges ----
  // forests: large masses (~40% of open land); mountains: ridgelines, strongest along frontiers between lands
  const feat = new Uint8Array(N);
  const border = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (terr[i] < 0) continue;
    for (const [dx, dy] of DIRS4) { const k = (y + dy) * W + x + dx; if (terr[k] >= 0 && terr[k] !== terr[i]) border[i] = 1; }
  }
  const nogrow = { sand: 1, cave: 1, dungeon: 1 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!land[i] || occ[i] || dist[i] < 2) continue;
    const ridge = 1 - Math.abs(2 * nMtn(x / 11, y / 11, 3) - 1);
    const f = nForest(x / 8, y / 8, 3);
    const bid = BIOME_IDS[biome[i]];
    const nearBorder = border[i] || border[i - 1] || border[i + 1] || border[i - W] || border[i + W];
    if (dist[i] >= 3 && (ridge > 0.9 || (nearBorder && ridge > 0.72 && nMtn(x / 4, y / 4, 2) > 0.45))) feat[i] = 2;
    else if (!nogrow[bid] && f > 0.45) feat[i] = 1;
    else if (bid === 'sand' && f > 0.66) feat[i] = 2;
  }
  // keep a clearing around towns for houses/fields/heroes
  for (const t of territories) for (let dy = -6; dy <= 3; dy++) for (let dx = -5; dx <= 6; dx++) {
    const x = t.cx + dx, y = t.cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
    if (Math.hypot(dx * 0.9, dy * 1.1) < 3.4) feat[y * W + x] = 0;
  }

  // ---- roads between land neighbours ----
  const road = new Uint8Array(N);
  const gate = (t) => (t.cy + 1) * W + t.cx;
  // a road network, not a web: spanning tree over neighbouring lands (shortest first) plus a few loops
  const edges = [];
  for (const t of territories) for (const n of T[t.id].nb) if (n > t.id) edges.push([t.id, n, tdist(t, territories[n])]);
  edges.sort((a, b) => a[2] - b[2]);
  const uf = territories.map((_, i) => i);
  const find = (a) => (uf[a] === a ? a : (uf[a] = find(uf[a])));
  const roadEdges = [];
  for (const e of edges) { const a = find(e[0]), b = find(e[1]); if (a !== b) { uf[a] = b; roadEdges.push(e); } else if (rng() < 0.22) roadEdges.push(e); }
  for (const [ta, tb] of roadEdges) {
    const t = territories[ta], u = territories[tb];
    const path = astar(W, H, gate(t), gate(u), (k) => {
      if (!land[k]) return Infinity;
      if (occ[k] === 1) return Infinity;
      if (road[k]) return 0.35;
      return 1 + (feat[k] === 2 ? 9 : feat[k] === 1 ? 2.5 : 0) + (river[k] ? 5 : 0);
    });
    if (path) for (const k of path) { road[k] = 1; if (feat[k]) feat[k] = 0; if (!occ[k]) occ[k] = 2; }
  }
  // roads from towns to their docks
  for (const d of docks) {
    const t = territories[d.tid];
    const path = astar(W, H, gate(t), d.y * W + d.x, (k) => (!land[k] || occ[k] === 1 ? Infinity : road[k] ? 0.35 : 1 + (feat[k] === 2 ? 9 : feat[k] ? 2.5 : 0) + (river[k] ? 5 : 0)));
    if (path) for (const k of path) { road[k] = 1; feat[k] = 0; if (!occ[k] || occ[k] === 4) occ[k] = occ[k] || 2; }
  }
  // tidy 1-wide features
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, f = feat[i]; if (!f) continue;
    const hh = (feat[i - 1] === f) + (feat[i + 1] === f), v = (feat[i - W] === f) + (feat[i + W] === f);
    if (hh === 0 || v === 0) feat[i] = 0;
  }

  // ---- fields, houses, landmarks near towns ----
  const free = (x, y, w, h) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) return false;
      const k = yy * W + xx; if (!land[k] || occ[k] || feat[k] || river[k] || road[k]) return false;
    }
    return true;
  };
  const claim = (x, y, w, h, v) => { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) occ[(y + dy) * W + x + dx] = v; };
  const fields = [], houses = [], landmarks = [], fences = new Uint8Array(N);
  const fieldKind = { grass: 1, dirt: 0, marsh: 2, sand: 3, deepmarsh: 2, lava: -1, cave: -1, dungeon: -1, ice: -1, christmas: -1 };
  for (const t of territories) {
    const fk = fieldKind[t.biome];
    // fields + fence below
    let placedF = 0;
    for (let tr = 0; tr < 30 && placedF < (fk >= 0 ? 2 : 0); tr++) {
      const w = rng.int(3, 4), h = 2;
      const x = t.cx + rng.int(-7, 6), y = t.cy + rng.int(-5, 4);
      if (!free(x - 1, y - 1, w + 2, h + 2)) continue;
      claim(x, y, w, h, 3); fields.push({ x, y, w, h, kind: fk });
      for (let dx = -1; dx <= w; dx++) { fences[(y + h) * W + x + dx] = 1; occ[(y + h) * W + x + dx] = 3; }
      placedF++;
    }
    // hamlet houses
    const nh = rng.int(2, 4);
    for (let tr = 0, placed = 0; tr < 40 && placed < nh; tr++) {
      const x = t.cx + rng.int(-5, 6), y = t.cy + rng.int(-4, 3);
      if (Math.abs(x - t.cx) <= 3 && y >= t.cy - 4 && y <= t.cy + 1) continue;
      if (!free(x, y, 1, 1)) continue;
      claim(x, y, 1, 1, 4); houses.push({ x, y, biome: t.biome, v: rng.int(0, 7) }); placed++;
    }
    // a landmark that fits the surroundings
    let nearM = 0, nearF = 0, nearR = 0;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const x = t.cx + dx, y = t.cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = y * W + x; if (terr[k] !== t.id) continue;
      if (feat[k] === 2) nearM++; else if (feat[k] === 1) nearF++; if (river[k]) nearR++;
    }
    const mine = { lava: 'sulfurmine', cave: 'crystalmine', dungeon: 'crystalmine', ice: 'gemmine', christmas: 'gemmine', sand: 'goldmine', dirt: 'orepit' }[t.biome] || rng.pick(['goldmine', 'orepit']);
    const kinds = [];
    if (nearM > 4) kinds.push(mine);
    if (nearR > 0) kinds.push('watermill');
    if (nearF > 6) kinds.push('sawmill');
    if (fields.some((f) => Math.abs(f.x - t.cx) < 9 && Math.abs(f.y - t.cy) < 9)) kinds.push('windmill');
    if (rng.chance(0.25)) kinds.push(rng.pick(['alchemist', 'stables', 'mercenary', 'fountainyouth']));
    const kind = kinds.length ? rng.pick(kinds) : null;
    if (kind) for (let tr = 0; tr < 50; tr++) {
      const x = t.cx + rng.int(-9, 8), y = t.cy + rng.int(-7, 6);
      if (!free(x, y, 2, 2) || terr[y * W + x] !== t.id) continue;
      if (kind === 'watermill' && !(river[(y + 2) * W + x] || river[y * W + x - 1] || river[y * W + x + 2] || river[(y + 2) * W + x + 1])) continue;
      claim(x, y, 2, 2, 4); landmarks.push({ x, y, kind }); break;
    }
    // occasional magical 1x1 sight
    if (rng.chance(0.3)) for (let tr = 0; tr < 30; tr++) {
      const x = t.cx + rng.int(-9, 9), y = t.cy + rng.int(-8, 7);
      if (!free(x, y, 1, 1) || terr[y * W + x] !== t.id) continue;
      claim(x, y, 1, 1, 4); landmarks.push({ x, y, kind: rng.pick(['monolith', 'monolithb', 'eye', 'fountain', 'dragonvein', 'campfire']) }); break;
    }
  }

  // decor: meadow flowers in patches, rocks near mountains, bushes at forest edges
  const decor = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!land[i] || feat[i] || occ[i] || road[i] || river[i]) continue;
    const nearMtn = feat[i - 1] === 2 || feat[i + 1] === 2 || feat[i - W] === 2 || feat[i + W] === 2;
    const nearFor = feat[i - 1] === 1 || feat[i + 1] === 1 || feat[i - W] === 1 || feat[i + W] === 1;
    const fl = nFlower(x / 4, y / 4, 2);
    if (nearMtn && rng() < 0.35) decor.push({ x, y, k: 'rock' });
    else if (nearFor && rng() < 0.22) decor.push({ x, y, k: 'bush' });
    else if (fl > 0.64 && rng() < 0.45) decor.push({ x, y, k: 'flower' });
    else if (rng() < 0.012) decor.push({ x, y, k: rng.pick(['log', 'rock', 'grass']) });
  }

  const decorSeed = rng.int(0, 1e9);
  return { size, W, H, land, biome, terr, feat, territories, decorSeed, seaLinks, seaRoutes, docks, rivers, river, road, fields, fences, houses, landmarks, decor, dist };
}
