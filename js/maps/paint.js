// Shared terrain painting: smooth HAS-style coasts, deep water, rivers, autotiles.
// Everything works on 16px cells and paints into canvases once (baked), so drawing each frame is one drawImage.
import { img, loadImage } from '../engine/assets.js';
import { makeRng, makeNoise } from '../engine/rng.js';
import { BIOMES, BIOME_IDS, TILE, OCEAN } from '../data/art.js';

export const TS = 16;
export const C_DARK = [36, 34, 52];
export const C_FOAM = [166, 252, 219];
export const C_SHADOW = [40, 92, 196];
export const C_WATER = [36, 159, 222];
export const C_SPARK = [32, 214, 199];

const ROAD_SHEET = 'assets/has2020/Landscape Objects/RoadSpriteSheet.png';
const FENCE_SHEET = 'assets/has2020/Landscape Objects/FenceSpriteSheet.png';
export { ROAD_SHEET, FENCE_SHEET };

// ---- 4-way connection autotile (roads, fences): bits N=1 E=2 S=4 W=8 ----
const AT4 = {
  0: [32, 32], 1: [0, 48], 2: [16, 0], 3: [16, 48], 4: [0, 16], 5: [0, 32], 6: [16, 16], 7: [16, 32],
  8: [48, 0], 9: [48, 48], 10: [32, 0], 11: [32, 48], 12: [48, 16], 13: [48, 32], 14: [32, 16], 15: [32, 32],
};
export function at4(mask) { return AT4[mask & 15]; }

export function maskAt(grid, W, H, x, y, test) {
  const g = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && test(grid[yy * W + xx]);
  return (g(x, y - 1) ? 1 : 0) | (g(x + 1, y) ? 2 : 0) | (g(x, y + 1) ? 4 : 0) | (g(x - 1, y) ? 8 : 0);
}

// rim colour per biome: second pixel row of the coast top-edge piece in each LandTileset
const rimCache = new Map();
export function rimColor(biome) {
  if (rimCache.has(biome)) return rimCache.get(biome);
  const B = BIOMES[biome] || BIOMES.grass;
  const im = img(B.src);
  let col = [156, 219, 67];
  if (im) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1;
    const x = c.getContext('2d'); x.drawImage(im, 120, 129, 1, 1, 0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data; col = [d[0], d[1], d[2]];
    rimCache.set(biome, col);
  }
  return col;
}

// Paints water + land with smooth rounded coastlines.
// cells: { W, H, land:Uint8Array (1 land), biomeIdx:Uint8Array (biome for every cell, water cells too), deep?:Uint8Array }
// returns canvas
export function paintLandWater(cells, seed, opts = {}) {
  const { W, H, land, biomeIdx } = cells;
  const PW = W * TS, PH = H * TS;
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false;
  const rng = makeRng(seed);
  const ocean = img(OCEAN);
  const tiles = BIOME_IDS.map((b) => img(BIOMES[b].src));
  // 1) water layer
  const shallow = [[0, 0], [16, 0]];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (!ocean) break;
    const i = cy * W + cx;
    if (cells.deep && cells.deep[i]) {
      const d = (xx, yy) => xx < 0 || yy < 0 || xx >= W || yy >= H || cells.deep[yy * W + xx];
      const L = d(cx - 1, cy), R = d(cx + 1, cy), U = d(cx, cy - 1), D = d(cx, cy + 1);
      let sx, sy;
      if (L && R && U && D) {
        if (!d(cx + 1, cy + 1)) [sx, sy] = [80, 0];
        else if (!d(cx - 1, cy + 1)) [sx, sy] = [112, 0];
        else if (!d(cx + 1, cy - 1)) [sx, sy] = [80, 32];
        else if (!d(cx - 1, cy - 1)) [sx, sy] = [112, 32];
        else [sx, sy] = [48, 16];
      } else {
        const col = !L ? 0 : !R ? 2 : 1, row = !U ? 0 : !D ? 2 : 1;
        [sx, sy] = [32 + col * 16, row * 16];
      }
      x.drawImage(ocean, sx, sy, 16, 16, cx * TS, cy * TS, TS, TS);
    } else {
      const t = shallow[((cx * 7 + cy * 13) >> 1) & 1];
      x.drawImage(ocean, t[0], t[1], 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // 2) land layer: biomes layered by priority using each tileset's own transparent edge pieces,
  //    plain ground with organic textured patches (the HAS look)
  const lc = document.createElement('canvas'); lc.width = PW; lc.height = PH;
  const lx = lc.getContext('2d', { willReadFrequently: true }); lx.imageSmoothingEnabled = false;
  paintBiomeLayer(lx, W, H, biomeIdx, tiles, seed, opts);
  const ld = lx.getImageData(0, 0, PW, PH), lp = ld.data;
  // 3) smooth land mask: bilinear of cell centres + a little noise
  const M = new Uint8Array(PW * PH);
  const val = (cx, cy) => (cx < 0 || cy < 0 || cx >= W || cy >= H ? 0 : land[cy * W + cx]);
  const nz = new Float32Array(64 * 64);
  for (let i = 0; i < nz.length; i++) nz[i] = rng() - 0.5;
  for (let py = 0; py < PH; py++) {
    const fy = (py + 0.5) / TS - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    for (let px = 0; px < PW; px++) {
      const fx = (px + 0.5) / TS - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const a = val(x0, y0), b = val(x0 + 1, y0), cc = val(x0, y0 + 1), d = val(x0 + 1, y0 + 1);
      if (a === b && b === cc && cc === d) { M[py * PW + px] = a; continue; }
      const v = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + cc * (1 - tx) * ty + d * tx * ty;
      const n = nz[((py >> 2) & 63) * 64 + ((px >> 2) & 63)] * 0.16;
      M[py * PW + px] = v + n > 0.5 ? 1 : 0;
    }
  }
  // 4) compose + coast styling
  const dd = x.getImageData(0, 0, PW, PH), dp = dd.data;
  const rims = BIOME_IDS.map((b) => rimColor(b));
  const set = (k, c) => { dp[k * 4] = c[0]; dp[k * 4 + 1] = c[1]; dp[k * 4 + 2] = c[2]; dp[k * 4 + 3] = 255; };
  for (let k = 0; k < PW * PH; k++) if (M[k]) { const o = k * 4; dp[o] = lp[o]; dp[o + 1] = lp[o + 1]; dp[o + 2] = lp[o + 2]; dp[o + 3] = 255; }
  const styled = new Uint8Array(PW * PH);
  const biomeOfPx = (px, py) => biomeIdx[Math.min(H - 1, (py / TS) | 0) * W + Math.min(W - 1, (px / TS) | 0)];
  // south-facing cliffs: scan columns downward
  for (let px = 0; px < PW; px++) {
    let since = 99, lastBiome = 0;
    for (let py = 0; py < PH; py++) {
      const k = py * PW + px;
      if (M[k]) { since = 0; lastBiome = biomeOfPx(px, py); continue; }
      since++;
      if (since === 1 && py > 0) { set(k - PW, rims[lastBiome]); styled[k - PW] = 1; }
      if (since <= 3) { set(k, (since === 2 && ((px + py) % 7 === 0)) ? [74, 84, 98] : C_DARK); styled[k] = 1; }
      else if (since === 4) { set(k, C_FOAM); styled[k] = 1; }
      else if (since <= 6) { set(k, C_SHADOW); styled[k] = 2; }
    }
  }
  // other edges: outline + foam ring + land rim
  const isL = (px, py) => px >= 0 && py >= 0 && px < PW && py < PH && M[py * PW + px] === 1;
  for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) {
    const k = py * PW + px;
    if (M[k]) {
      if (!styled[k] && (!isL(px - 1, py) || !isL(px + 1, py) || !isL(px, py + 1) || !isL(px, py - 1))) { set(k, rims[biomeOfPx(px, py)]); styled[k] = 1; }
      continue;
    }
    if (styled[k] === 1) continue;
    let near = 9;
    for (let r = 1; r <= 2 && near > r; r++) {
      if (isL(px - r, py) || isL(px + r, py) || isL(px, py - r) || isL(px, py + r) || (r === 1 && (isL(px - 1, py - 1) || isL(px + 1, py - 1) || isL(px - 1, py + 1) || isL(px + 1, py + 1)))) near = r;
    }
    if (near === 1) set(k, C_DARK);
    else if (near === 2) set(k, C_FOAM);
  }
  x.putImageData(dd, 0, 0);
  c.landMask = M;
  return c;
}

// Paint a river ribbon along cell-centre path points (cell coords). Width in px grows with t.
export function paintRiver(ctx, path, opts = {}) {
  if (path.length < 2) return;
  const c = ctx.canvas, PW = c.width, PH = c.height;
  // smooth path (Chaikin)
  let pts = path.map(([cx, cy]) => [cx * TS + 8, cy * TS + 8]);
  for (let it = 0; it < 2; it++) {
    const n = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      n.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    n.push(pts[pts.length - 1]); pts = n;
  }
  // bounding box
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  const pad = 10; x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad)); x1 = Math.min(PW - 1, Math.ceil(x1 + pad)); y1 = Math.min(PH - 1, Math.ceil(y1 + pad));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const R = new Uint8Array(bw * bh);
  const w0 = opts.w0 ?? 2.6, w1 = opts.w1 ?? 4.6;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1), r = w0 + (w1 - w0) * t;
    const [cx, cy] = pts[i];
    const nx = i + 1 < pts.length ? pts[i + 1] : pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(nx[0] - cx, nx[1] - cy)));
    for (let s = 0; s < steps; s++) {
      const qx = cx + (nx[0] - cx) * s / steps, qy = cy + (nx[1] - cy) * s / steps;
      for (let yy = Math.floor(qy - r); yy <= Math.ceil(qy + r); yy++) for (let xx = Math.floor(qx - r); xx <= Math.ceil(qx + r); xx++) {
        if ((xx - qx) ** 2 + (yy - qy) ** 2 > r * r) continue;
        const lx = xx - x0, ly = yy - y0; if (lx < 0 || ly < 0 || lx >= bw || ly >= bh) continue;
        R[ly * bw + lx] = 1;
      }
    }
  }
  const id = ctx.getImageData(x0, y0, bw, bh), p = id.data;
  const inR = (lx, ly) => lx >= 0 && ly >= 0 && lx < bw && ly < bh && R[ly * bw + lx] === 1;
  const set = (k, col) => { p[k * 4] = col[0]; p[k * 4 + 1] = col[1]; p[k * 4 + 2] = col[2]; p[k * 4 + 3] = 255; };
  for (let ly = 0; ly < bh; ly++) for (let lx = 0; lx < bw; lx++) {
    const k = ly * bw + lx;
    if (R[k]) {
      const edge = !inR(lx - 1, ly) || !inR(lx + 1, ly) || !inR(lx, ly - 1) || !inR(lx, ly + 1);
      const gx = lx + x0, gy = ly + y0;
      set(k, edge ? C_FOAM : (((gx * 3 + gy * 5) % 23 === 0) ? C_SPARK : (inR(lx, ly - 2) && !inR(lx, ly - 3) ? C_SHADOW : C_WATER)));
    } else if (inR(lx - 1, ly) || inR(lx + 1, ly) || inR(lx, ly - 1) || inR(lx, ly + 1)) set(k, C_DARK);
  }
  ctx.putImageData(id, x0, y0);
  return pts;
}

// Forests and mountains: stamp the single tree / peak sprite of a block on the same staggered lattice the
// sheet's own fills use (16px grid + half-offset rows), so masses read as dense, overlapping woods and ridges
// with naturally ragged edges. baseFor(cx,cy) -> [x,y] of the 13x3 block in the TreesAndMountains sheet.
export const BIG_PEAK = 'assets/starter/SP-Mountains.png';
export function drawBlobs(ctx, sheet, W, H, feat, f, baseFor) {
  if (!sheet) return;
  const has = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H && feat[cy * W + cx] === f;
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 1000; };
  const pts = [];
  const peak = img(BIG_PEAK);
  const bigUsed = new Uint8Array(W * H);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (!has(cx, cy)) continue;
    const base = baseFor(cx, cy); if (!base) continue;
    const h = hash(cx, cy);
    const inner = has(cx - 1, cy) && has(cx + 1, cy) && has(cx, cy - 1) && has(cx, cy + 1);
    // occasional big peak inside brown ranges
    if (f === 2 && peak && base[0] === 0 && inner && has(cx + 1, cy + 1) && has(cx - 1, cy - 1) && h < 70 && !bigUsed[cy * W + cx]) {
      let ok = true; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (bigUsed[(cy + dy) * W + cx + dx]) ok = false;
      if (ok) { bigUsed[cy * W + cx] = 1; pts.push([cx * TS - 8, cy * TS - 12, null, 1]); continue; }
    }
    if (inner || h > 160) pts.push([cx * TS, cy * TS, base]);
    if (has(cx + 1, cy) && has(cx, cy + 1) && has(cx + 1, cy + 1)) pts.push([cx * TS + 8, cy * TS + 8, base]);
    else if (h > 820 && (has(cx + 1, cy) || has(cx, cy + 1))) pts.push([cx * TS + 8, cy * TS + 6, base]);
  }
  pts.sort((a, b) => (a[1] + (a[3] ? 22 : 0)) - (b[1] + (b[3] ? 22 : 0)) || a[0] - b[0]);
  for (const [px, py, base, big] of pts) {
    if (big) ctx.drawImage(peak, 208, 0, 32, 32, px, py, 32, 32);
    else ctx.drawImage(sheet, base[0] + 16, base[1], 16, 16, px, py, 16, 16);
  }
}

// Biome ground. Higher-priority biomes are laid over lower ones with their own ragged edge pieces
// (plain blob at 160,272), and plain ground gets textured patches (textured blob at 160,224).
const PRIORITY = { cave: 1, sand: 2, dirt: 3, marsh: 4, deepmarsh: 5, grass: 6, dungeon: 7, lava: 8, ice: 9, christmas: 10 };
export function paintBiomeLayer(ctx, W, H, biomeIdx, tiles, seed, opts = {}) {
  const pr = BIOME_IDS.map((b) => PRIORITY[b] || 0);
  const nz = makeNoise(seed ^ 0x5eed);
  const at = (cx, cy) => biomeIdx[Math.max(0, Math.min(H - 1, cy)) * W + Math.max(0, Math.min(W - 1, cx))];
  const piece = (same) => { const L = same(-1, 0), R = same(1, 0), U = same(0, -1), D = same(0, 1); return [!L ? 0 : !R ? 2 : 1, !U ? 0 : !D ? 2 : 1]; };
  // texture patches
  const patch = new Uint8Array(W * H);
  const thr = opts.patch ?? 0.56;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const b = biomeIdx[cy * W + cx];
    let uniform = true; for (let dy = -1; dy <= 1 && uniform; dy++) for (let dx = -1; dx <= 1; dx++) if (at(cx + dx, cy + dy) !== b) { uniform = false; break; }
    if (uniform && nz(cx / 4.5, cy / 4.5, 3) > thr) patch[cy * W + cx] = 1;
  }
  for (let pass = 0; pass < 2; pass++) for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx; if (!patch[i]) continue;
    const p = (dx, dy) => { const x2 = cx + dx, y2 = cy + dy; return x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && patch[y2 * W + x2]; };
    if (!(p(-1, 0) || p(1, 0)) || !(p(0, -1) || p(0, 1))) patch[i] = 0;
  }
  const P = TILE.plain;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx, b = biomeIdx[i], ts = tiles[b]; if (!ts) continue;
    const px = cx * TS, py = cy * TS;
    // lowest-priority different neighbour decides the ground underneath an edge
    let under = -1;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nb = at(cx + dx, cy + dy); if (pr[nb] < pr[b] && (under < 0 || pr[nb] < pr[under])) under = nb; }
    if (under >= 0) {
      if (tiles[under]) ctx.drawImage(tiles[under], P[0], P[1], 16, 16, px, py, TS, TS);
      const [c, r] = piece((dx, dy) => pr[at(cx + dx, cy + dy)] >= pr[b]);
      ctx.drawImage(ts, 160 + c * 16, 272 + r * 16, 16, 16, px, py, TS, TS);
      continue;
    }
    ctx.drawImage(ts, P[0], P[1], 16, 16, px, py, TS, TS);
    if (patch[i]) {
      const [c, r] = piece((dx, dy) => { const x2 = cx + dx, y2 = cy + dy; return x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && patch[y2 * W + x2]; });
      ctx.drawImage(ts, 160 + c * 16, 224 + r * 16, 16, 16, px, py, TS, TS);
    }
  }
}

// Draw 4-way autotiled network (road or fence) from a grid of booleans.
export function drawNetwork(ctx, sheet, W, H, grid, val, bx, by, skip) {
  if (!sheet) return;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (grid[cy * W + cx] !== val) continue;
    if (skip && skip(cx, cy)) continue;
    const m = maskAt(grid, W, H, cx, cy, (v) => v === val);
    const [sx, sy] = at4(m);
    ctx.drawImage(sheet, bx + sx, by + sy, 16, 16, cx * TS, cy * TS, TS, TS);
  }
}

// A* on a cell grid; cost(i) returns Infinity for blocked
export function astar(W, H, from, to, cost, bb) {
  if (bb) { const r = astarBox(W, H, from, to, cost, bb); if (r) return r; }
  return astarBox(W, H, from, to, cost, null);
}
const AS = {};
function astarBox(W, H, from, to, cost, bb) {
  const bx0 = bb ? Math.max(0, bb.x0) : 0, by0 = bb ? Math.max(0, bb.y0) : 0, bx1 = bb ? Math.min(W - 1, bb.x1) : W - 1, by1 = bb ? Math.min(H - 1, bb.y1) : H - 1;
  const N = W * H;
  if (!AS.g || AS.g.length < N) { AS.g = new Float32Array(N); AS.prev = new Int32Array(N); AS.stamp = new Uint32Array(N); AS.closed = new Uint32Array(N); AS.gen = 0; }
  const gen = ++AS.gen * 2;
  const G = AS.g, P = AS.prev, ST = AS.stamp, CL = AS.closed;
  // lazily-reset arrays: a cell is "fresh" when its stamp is from an older search
  const g = { get: (i) => (ST[i] === gen ? G[i] : Infinity) };
  const closed = { has: (i) => CL[i] === gen, add: (i) => { CL[i] = gen; } };
  const setG = (i, v, p) => { ST[i] = gen; G[i] = v; P[i] = p; };
  const tx = to % W, ty = (to / W) | 0;
  const heap = [];
  const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  setG(from, 0, -1); push(from, 0);
  while (heap.length) {
    const [, u] = pop();
    if (closed.has(u)) continue; closed.add(u);
    if (u === to) break;
    const ux = u % W, uy = (u / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ux + dx, ny = uy + dy; if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
      const v = ny * W + nx; if (closed.has(v)) continue;
      const c = cost(v); if (!isFinite(c)) continue;
      const ng = g.get(u) + c;
      if (ng < g.get(v)) { setG(v, ng, u); push(v, ng + Math.abs(nx - tx) + Math.abs(ny - ty)); }
    }
  }
  if (!isFinite(g.get(to))) return null;
  const path = [];
  for (let v = to; v >= 0; v = P[v]) path.push(v);
  return path.reverse();
}

// animated landmark sprites (individual frame files)
const B = 'assets/has2020/Buildings/';
export const LANDMARKS = {
  goldmine: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/GoldMine(Frame ${i}).png`) },
  orepit: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/OrePit(Frame ${i}).png`) },
  gemmine: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/GemMine${i}.png`) },
  crystalmine: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/CrystalMine(Frame ${i}).png`) },
  sulfurmine: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/SulfurMine(Frame ${i}).png`) },
  sawmill: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/Sawmill(Frame ${i}).png`) },
  watermill: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/WaterMill(Frame ${i}).png`) },
  windmill: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x1/Animated/WindMill(Frame ${i}).png`) },
  alchemist: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/AlchemistLab(Frame ${i}).png`) },
  stables: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/Stables(Frame ${i}).png`) },
  mercenary: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/MercenaryCamp(Frame ${i}).png`) },
  fountainyouth: { w: 32, h: 32, frames: [1, 2, 3, 4].map((i) => `${B}2x2/Animated/FountainOfYouth(Frame ${i}).png`) },
  campfire: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/Campfire(Frame ${i}).png`) },
  fountain: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/Fountain(Frame ${i}).png`) },
  monolith: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/TwoWayMonolithPurple(Frame ${i}).png`) },
  monolithb: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/TwoWayMonolithBlue(Frame ${i}).png`) },
  eye: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/EyeOfTheMagi(Frame ${i}).png`) },
  dragonvein: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/DragonVein(Frame ${i}).png`) },
  rallyflag: { w: 16, h: 16, frames: [1, 2, 3, 4].map((i) => `${B}1x1/Animated/RallyFlag(Frame ${i}).png`) },
};
export function preloadLandmarks() { for (const L of Object.values(LANDMARKS)) for (const f of L.frames) loadImage(f); loadImage(ROAD_SHEET); loadImage(FENCE_SHEET); loadImage(BIG_PEAK); }
export function drawLandmark(ctx, kind, x, y, time, phase = 0) {
  const L = LANDMARKS[kind]; if (!L) return;
  const im = img(L.frames[Math.floor(time * 5 + phase) % L.frames.length]) || img(L.frames[0]);
  if (im) ctx.drawImage(im, Math.round(x), Math.round(y));
}
