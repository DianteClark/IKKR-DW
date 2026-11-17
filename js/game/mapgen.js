// World generation. Everything here is derived from the seed, so peers rebuild the same map locally.
import { makeRng, makeNoise } from '../engine/rng.js';
import { BIOME_IDS } from '../data/art.js';
import { placeName } from './names.js';

export const MAP_W = 112, MAP_H = 68;

export function generateTerrain(seed, territoryCount = 44) {
  const W = MAP_W, H = MAP_H, N = W * H;
  const rng = makeRng(seed);
  const nLand = makeNoise(seed ^ 0x1111), nTemp = makeNoise(seed ^ 0x2222), nWet = makeNoise(seed ^ 0x3333), nSpec = makeNoise(seed ^ 0x4444);
  const nForest = makeNoise(seed ^ 0x5555), nMtn = makeNoise(seed ^ 0x6666);
  const land = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ex = Math.min(x, W - 1 - x) / (W * 0.5), ey = Math.min(y, H - 1 - y) / (H * 0.5);
    const edge = Math.min(1, Math.min(ex, ey) * 3.2);
    const v = nLand(x / 20, y / 20, 4) * 0.75 + edge * 0.55;
    land[y * W + x] = v > 0.62 ? 1 : 0;
  }
  // keep largest landmass, fill small lakes
  const comp = (want) => {
    const id = new Int32Array(N).fill(-1); const sizes = [];
    for (let i = 0; i < N; i++) {
      if (land[i] !== want || id[i] >= 0) continue;
      const c = sizes.length; let sz = 0; const st = [i]; id[i] = c;
      while (st.length) {
        const j = st.pop(); sz++;
        const x = j % W, y = (j / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx; if (land[k] === want && id[k] < 0) { id[k] = c; st.push(k); }
        }
      }
      sizes.push(sz);
    }
    return { id, sizes };
  };
  let L = comp(1);
  const big = L.sizes.indexOf(Math.max(...L.sizes));
  for (let i = 0; i < N; i++) if (land[i] && L.id[i] !== big) land[i] = 0;
  const Wt = comp(0);
  for (let i = 0; i < N; i++) if (!land[i] && Wt.sizes[Wt.id[i]] < 14) land[i] = 1;

  // biomes
  const biome = new Uint8Array(N);
  const B = Object.fromEntries(BIOME_IDS.map((b, i) => [b, i]));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H + (nTemp(x / 26, y / 26, 3) - 0.5) * 0.45;
    const m = nWet(x / 18, y / 18, 3), s = nSpec(x / 14, y / 14, 3);
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

  // territories: spaced seeds then flood fill
  const landCells = [];
  for (let i = 0; i < N; i++) if (land[i]) landCells.push(i);
  rng.shuffle(landCells);
  const seeds = [];
  let minD = 11;
  while (seeds.length < territoryCount && minD > 4) {
    for (const c of landCells) {
      if (seeds.length >= territoryCount) break;
      const x = c % W, y = (c / W) | 0;
      if (x < 3 || y < 3 || x > W - 4 || y > H - 4) continue;
      if (seeds.every((s) => Math.hypot((s % W) - x, ((s / W) | 0) - y) >= minD)) seeds.push(c);
    }
    minD -= 1;
  }
  const terr = new Int16Array(N).fill(-1);
  let q = seeds.map((s, i) => { terr[s] = i; return s; });
  while (q.length) {
    const nq = [];
    rng.shuffle(q);
    for (const j of q) {
      const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx; if (land[k] && terr[k] < 0) { terr[k] = terr[j]; nq.push(k); }
      }
    }
    q = nq;
  }

  // territory data
  const used = new Set();
  const T = seeds.map((s, i) => ({ id: i, cells: 0, sx: 0, sy: 0, biomeCount: new Array(BIOME_IDS.length).fill(0), nb: new Set() }));
  for (let i = 0; i < N; i++) {
    const t = terr[i]; if (t < 0) continue;
    const x = i % W, y = (i / W) | 0, o = T[t];
    o.cells++; o.sx += x; o.sy += y; o.biomeCount[biome[i]]++;
    if (x + 1 < W && terr[i + 1] >= 0 && terr[i + 1] !== t) { o.nb.add(terr[i + 1]); T[terr[i + 1]].nb.add(t); }
    if (y + 1 < H && terr[i + W] >= 0 && terr[i + W] !== t) { o.nb.add(terr[i + W]); T[terr[i + W]].nb.add(t); }
  }
  const territories = T.map((o) => {
    let cx = o.sx / o.cells, cy = o.sy / o.cells;
    // snap center to a cell inside the territory, away from its border
    let best = seeds[o.id], bd = 1e9;
    for (let y = Math.max(2, Math.floor(cy) - 6); y <= Math.min(H - 3, Math.floor(cy) + 6); y++)
      for (let x = Math.max(2, Math.floor(cx) - 6); x <= Math.min(W - 3, Math.floor(cx) + 6); x++) {
        const k = y * W + x; if (terr[k] !== o.id) continue;
        let inside = true;
        for (let dy = -2; dy <= 1 && inside; dy++) for (let dx = -2; dx <= 1; dx++) if (terr[k + dy * W + dx] !== o.id) { inside = false; break; }
        const d = Math.hypot(x - cx, y - cy) + (inside ? 0 : 20);
        if (d < bd) { bd = d; best = k; }
      }
    const b = o.biomeCount.indexOf(Math.max(...o.biomeCount));
    return { id: o.id, name: placeName(rng, used), cx: best % W, cy: (best / W) | 0, biome: BIOME_IDS[b], size: o.cells, nb: [...o.nb].sort((a, b) => a - b) };
  });

  // features: 1 forest, 2 mountain. keep clear around towns
  const feat = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!land[i]) continue;
    const t = territories[terr[i]];
    if (Math.abs(x - t.cx) <= 3 && y >= t.cy - 4 && y <= t.cy + 2) continue;
    const f = nForest(x / 7, y / 7, 3), m = nMtn(x / 9, y / 9, 3);
    if (m > 0.68) feat[i] = 2; else if (f > 0.6) feat[i] = 1;
  }
  // remove 1-wide features so autotile edges look right
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, f = feat[i]; if (!f) continue;
    const h = (feat[i - 1] === f) + (feat[i + 1] === f), v = (feat[i - W] === f) + (feat[i + W] === f);
    if (h === 0 || v === 0) feat[i] = 0;
  }
  const decorSeed = rng.int(0, 1e9);
  return { W, H, land, biome, terr, feat, territories, decorSeed };
}
