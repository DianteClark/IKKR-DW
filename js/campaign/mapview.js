// Campaign map rendering.
//
// API (how campaign.js should use it)
//   const tc = renderTerrain(T)        once per map. Small/medium/large maps return the full baked canvas (old behaviour);
//                                      huge/enormous return a 1x1 placeholder and switch to lazy chunks.
//   drawTerrain(ctx, T, view)          every frame instead of ctx.drawImage(terrainCanvas, 0, 0). view = { x, y, w, h } in
//                                      world px (camera rect). Works for every size; chunks render on demand (LRU cached)
//                                      and a low-res overview is used when zoomed far out.
//   drawOverlay(ctx, T, state, view)   every frame: smooth vector borders (realm lines, glow, dotted splits, neutral).
//                                      renderOverlay(T, state) still returns a baked canvas for small maps (legacy path).
//   drawAnimated(ctx, T, time, view)   water glints, landmarks, docks, ships, birds.
//   drawSites(ctx, state, T, time, view)  neutral sites from state.sites = [{ id, spot, kind, status }] (spot -> T.siteSpots).
//   drawTowns(ctx, state, time, view)  settlements: huts -> houses -> walled towns -> faction towns, flags, smoke, capture fx.
//   drawHeroes(ctx, state, time, travel)  portrait pins; travel optional Map/obj heroId -> { from, to, t } walks along roads.
//   drawOrders(ctx, state, kid, time)  order arcs.
//   drawSeason(ctx, T, season, time, view)  'Spring'|'Summer'|'Autumn'|'Winter' tint + particles (draw last, world space).
//   captureFx(state, tid)              call when a land changes hands: a ~1s light sweep is drawn by drawTowns.
//   renderMinimap(T, state) -> canvas (1px per cell); updateMinimap(canvas, T, state) when owners change.
//   hitTest(T, state, wx, wy) -> { kind: 'hero'|'town'|'site'|'land', id } | null   (wx, wy world px)
//   siteAt(T, state, wx, wy) -> site id | null
import { img, loadImage } from '../engine/assets.js';
import { BIOMES, BIOME_IDS, TREES, FACTIONS, FACTION_IDS, drawHero, drawUnit, drawSpriteRef, portraitRef, STRUCT, OCEAN } from '../data/art.js';
import { paintLandWater, paintRiver, drawBlobs, drawLandmark, preloadLandmarks, ROAD_SHEET, FENCE_SHEET, maskAt, at4, hash2, LANDMARKS } from '../maps/paint.js';
import { makeNoise } from '../engine/rng.js';

export const TS = 16;
const FIELD_SHEET = 'assets/has2020/Landscape Objects/FieldSpriteSheet.png';
const DOCKS = 'assets/weekly/DockAndLighthouseSpriteSheet.png';
const SHIP = 'assets/weekly/Ship/Ship.png';
const WALLS = 'assets/weekly/WallsSpriteSheet.png';
const DUNGEON_PROPS = 'assets/dungeon/Overworld Dungeon/HAS-Dungeon.png';
[FIELD_SHEET, DOCKS, SHIP, ROAD_SHEET, FENCE_SHEET, WALLS, DUNGEON_PROPS, STRUCT].forEach((s) => loadImage(s));
preloadLandmarks();

const CHUNK = 48;          // cells per chunk side
const CHUNKED_ABOVE = 16000; // cells; bigger maps render lazily in chunks
const LRU_MAX = 16;

const hashI = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

const DECOR = {
  flower: [[32, 0], [48, 0], [32, 16], [48, 16]],
  rock: [[64, 0], [80, 0], [64, 16], [80, 16]],
  bush: [[96, 0], [112, 0], [96, 16], [112, 16]],
  log: [[128, 0], [144, 0], [128, 16], [144, 16]],
  grass: [[96, 16], [112, 0]],
};
// static outskirts houses: [row y, x0, n] in StructuresSpriteSheet
const HOUSE_ROW = { grass: [0, 48, 9], dirt: [0, 48, 9], sand: [16, 48, 9], lava: [48, 48, 9], marsh: [32, 48, 5], deepmarsh: [32, 48, 5], ice: [48, 48, 9], christmas: [48, 48, 9], cave: [32, 48, 5], dungeon: [48, 48, 9] };
// settlement sprites by biome: huts for hamlets, houses for villages/towns (lists of [sx, sy])
const range = (y, x0, n) => Array.from({ length: n }, (_, i) => [x0 + i * 16, y]);
const HUTS = {
  sand: [[48, 64], [48, 16], [64, 16], [80, 16]],
  ice: [[32, 80], [48, 80], [64, 80], [96, 80]], christmas: [[32, 80], [48, 80], [64, 80], [96, 80]],
};
const HOUSES = {
  sand: range(16, 48, 9), ice: range(32, 128, 4).concat(range(80, 32, 4)), christmas: range(32, 128, 4).concat(range(80, 32, 4)),
  lava: range(48, 48, 9), dungeon: range(48, 48, 9), cave: range(48, 48, 9),
};
const hutsFor = (b) => HUTS[b] || range(32, 48, 5);
const housesFor = (b) => HOUSES[b] || range(0, 48, 9);

// ------------------------------------------------------------------ terrain preparation
function prep(T) {
  if (T._prep) return T._prep;
  const { W, H, land, biome } = T;
  const N = W * H;
  const bIdx = new Uint8Array(N), wdist = new Uint16Array(N).fill(65535);
  let fr = [];
  for (let i = 0; i < N; i++) if (land[i]) { bIdx[i] = biome[i]; wdist[i] = 0; fr.push(i); }
  while (fr.length) {
    const nf = [];
    for (const j of fr) {
      const x = j % W, y = (j / W) | 0;
      if (x > 0) { const k = j - 1; if (wdist[k] > wdist[j] + 1) { wdist[k] = wdist[j] + 1; bIdx[k] = bIdx[j]; nf.push(k); } }
      if (x < W - 1) { const k = j + 1; if (wdist[k] > wdist[j] + 1) { wdist[k] = wdist[j] + 1; bIdx[k] = bIdx[j]; nf.push(k); } }
      if (y > 0) { const k = j - W; if (wdist[k] > wdist[j] + 1) { wdist[k] = wdist[j] + 1; bIdx[k] = bIdx[j]; nf.push(k); } }
      if (y < H - 1) { const k = j + W; if (wdist[k] > wdist[j] + 1) { wdist[k] = wdist[j] + 1; bIdx[k] = bIdx[j]; nf.push(k); } }
    }
    fr = nf;
  }
  // bridges sit on water but should not make it deep
  const deep = new Uint8Array(N);
  const dn = makeNoise(T.decorSeed ^ 0x3a);
  for (let i = 0; i < N; i++) if (!land[i] && wdist[i] >= 3 + (dn((i % W) / 7, ((i / W) | 0) / 7, 2) > 0.62 ? 1 : 0)) deep[i] = 1;
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!deep[i]) continue;
    if (!(deep[i - 1] || deep[i + 1]) || !(deep[i - W] || deep[i + W])) deep[i] = 0;
  }
  // water glints, bucketed by chunk so drawing only touches what's on screen
  const sparkles = new Map();
  for (let i = 0; i < N; i++) {
    if (land[i] || wdist[i] < 2 || (T.bridge && T.bridge[i])) continue;
    const x = i % W, y = (i / W) | 0, h = hashI(x * 3 + 1, y * 7 + 5);
    if (h % 100 >= 5) continue;
    const key = ((y / CHUNK) | 0) * 1000 + ((x / CHUNK) | 0);
    if (!sparkles.has(key)) sparkles.set(key, []);
    sparkles.get(key).push([x * TS + 2 + (h >>> 8) % 12, y * TS + 2 + (h >>> 12) % 12, ((h >>> 16) % 600) / 100]);
  }
  T._prep = { bIdx, wdist, deep, sparkles };
  T._sparkles = [];
  return T._prep;
}

// Paint a rectangle of cells [cx0, cx0+cw) x [cy0, cy0+ch) into its own canvas. Paints a margin around it and crops,
// using only global-coordinate randomness, so neighbouring chunks line up seamlessly.
export function renderRegion(T, cx0, cy0, cw, ch) {
  const P = prep(T);
  const { W, H, land, biome, feat } = T;
  const m = 3;
  const wx0 = Math.max(0, cx0 - m), wy0 = Math.max(0, cy0 - m), wx1 = Math.min(W, cx0 + cw + m), wy1 = Math.min(H, cy0 + ch + m);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  const sl = new Uint8Array(ww * wh), sb = new Uint8Array(ww * wh), sd = new Uint8Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const g = (y + wy0) * W + x + wx0, l = y * ww + x;
    sl[l] = land[g]; sb[l] = P.bIdx[g]; sd[l] = P.deep[g];
  }
  const c = paintLandWater({ W: ww, H: wh, land: sl, biomeIdx: sb, deep: sd }, T.decorSeed, { ox: wx0, oy: wy0 });
  let x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const tiles = BIOME_IDS.map((b) => img(BIOMES[b].src));
  const inWin = (cx, cy, pad = 1) => cx >= wx0 - pad && cy >= wy0 - pad && cx < wx1 + pad && cy < wy1 + pad;
  // rivers (pixel-level paint, uses canvas coords)
  for (const r of T.rivers || []) {
    if (!r.some(([rx, ry]) => inWin(rx, ry, 6))) continue;
    paintRiver(x, r.filter((_, i) => i % 2 === 0 || i === r.length - 1), { w0: 2.2, w1: 3.6, ox: wx0 * TS, oy: wy0 * TS });
  }
  // everything else is drawn straight onto the (GPU-friendly) output canvas
  const out = document.createElement('canvas'); out.width = cw * TS; out.height = ch * TS;
  const ox = out.getContext('2d'); ox.imageSmoothingEnabled = false;
  ox.drawImage(c, (cx0 - wx0) * TS, (cy0 - wy0) * TS, cw * TS, ch * TS, 0, 0, cw * TS, ch * TS);
  c.width = 0; c.height = 0;
  x = ox;
  x.save();
  x.translate(-cx0 * TS, -cy0 * TS);
  // fields
  const fs = img(FIELD_SHEET);
  if (fs) for (const f of T.fields || []) {
    if (!inWin(f.x, f.y, 5)) continue;
    const bx = f.kind === 2 || f.kind === 3 ? 64 : 0, by = f.kind === 1 || f.kind === 3 ? 16 : 0;
    for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
      const col = dx === 0 ? 0 : dx === f.w - 1 ? 3 : 1 + (dx % 2);
      x.drawImage(fs, bx + col * 16, by, 16, 16, (f.x + dx) * TS, (f.y + dy) * TS, TS, TS);
    }
  }
  // roads, river bridges and sea bridges
  const roadSheet = img(ROAD_SHEET);
  if (T.road && roadSheet) {
    const isRoad = (v) => v === 1;
    for (let cy = wy0; cy < wy1; cy++) for (let cx = wx0; cx < wx1; cx++) {
      const i = cy * W + cx; if (!T.road[i]) continue;
      const m4 = maskAt(T.road, W, H, cx, cy, isRoad);
      const horiz = (m4 & 2) || (m4 & 8);
      if ((T.river && T.river[i]) || (T.bridge && T.bridge[i])) {
        if (T.bridge && T.bridge[i]) { x.fillStyle = 'rgba(10,20,40,.28)'; x.fillRect(cx * TS + (horiz ? 0 : 2), cy * TS + (horiz ? 4 : 0) + 2, horiz ? TS : 12, horiz ? 9 : TS); }
        x.drawImage(roadSheet, horiz ? 192 : 208, 288, 16, 16, cx * TS, cy * TS, TS, TS);
        continue;
      }
      const [sx, sy] = at4(m4);
      x.drawImage(roadSheet, sx, sy, 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // decor (choice by cell hash so it never depends on which chunk paints it)
  for (const d of T.decor || []) {
    if (!inWin(d.x, d.y)) continue;
    const ts = tiles[biome[d.y * W + d.x]]; if (!ts) continue;
    const opts = DECOR[d.k] || DECOR.flower; const t = opts[hashI(d.x, d.y) % opts.length];
    x.drawImage(ts, t[0], t[1], 16, 16, d.x * TS, d.y * TS, TS, TS);
  }
  // forests and mountains
  const trees = img(TREES);
  const win = { x0: wx0, y0: wy0, x1: wx1, y1: wy1 };
  drawBlobs(x, trees, W, H, feat, 1, (cx, cy) => BIOMES[BIOME_IDS[biome[cy * W + cx]]].tree, win);
  drawBlobs(x, trees, W, H, feat, 2, (cx, cy) => [BIOMES[BIOME_IDS[biome[cy * W + cx]]].mtn, 336], win);
  // fences + outskirts houses
  const fence = img(FENCE_SHEET);
  if (T.fences && fence) {
    const snowy = (cx, cy) => { const b = BIOME_IDS[biome[cy * W + cx]]; return b === 'ice' || b === 'christmas'; };
    for (let cy = wy0; cy < wy1; cy++) for (let cx = wx0; cx < wx1; cx++) {
      if (!T.fences[cy * W + cx]) continue;
      const m4 = maskAt(T.fences, W, H, cx, cy, (v) => v === 1);
      const AT = { 0: [32, 0], 2: [16, 0], 8: [48, 0], 10: [32, 0] };
      const p = AT[m4 & 10] || [32, 0];
      x.drawImage(fence, 64 + p[0], (snowy(cx, cy) ? 64 : 0) + p[1], 16, 16, cx * TS, cy * TS + 4, TS, TS);
    }
  }
  const st = img(STRUCT);
  if (st) for (const hs of T.houses || []) {
    if (!inWin(hs.x, hs.y)) continue;
    const [row, x0, n] = HOUSE_ROW[hs.biome] || HOUSE_ROW.grass;
    x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(hs.x * TS + 8, hs.y * TS + 14, 7, 2.5, 0, 0, Math.PI * 2); x.fill();
    x.drawImage(st, x0 + (hs.v % n) * 16, row, 16, 16, hs.x * TS, hs.y * TS, TS, TS);
  }
  x.restore();
  return out;
}

export function renderTerrain(T) {
  prep(T);
  T._chunks = null; T._full = null; T._overview = null;
  if (T.W * T.H <= CHUNKED_ABOVE) {
    T._full = renderRegion(T, 0, 0, T.W, T.H);
    return T._full;
  }
  T._chunks = new Map();
  T._ovQueue = [];
  for (let cy = 0; cy < Math.ceil(T.H / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(T.W / CHUNK); cx++) T._ovQueue.push([cx, cy]);
  const ph = document.createElement('canvas'); ph.width = 1; ph.height = 1;
  return ph;
}

// stylised 4px-per-cell overview, progressively upgraded with real chunks rendered in spare frames
const OV = 4;
function overview(T) {
  if (T._overview) return T._overview;
  const P = prep(T);
  const { W, H, land, biome, feat } = T;
  const c = document.createElement('canvas'); c.width = W * OV; c.height = H * OV;
  const x = c.getContext('2d');
  const id = x.createImageData(c.width, c.height), d = id.data;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const bcol = BIOME_IDS.map((b) => hex(BIOMES[b].col));
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    let col;
    if (!land[i]) col = T.bridge && T.bridge[i] ? [150, 100, 60] : P.deep[i] ? [30, 110, 205] : [42, 160, 226];
    else if (T.road && T.road[i]) col = [222, 196, 140];
    else if (T.river && T.river[i]) col = [42, 160, 226];
    else {
      col = bcol[biome[i]];
      if (feat[i] === 1) col = col.map((v) => v * 0.62);
      else if (feat[i] === 2) col = [col[0] * 0.55 + 50, col[1] * 0.55 + 40, col[2] * 0.55 + 36];
    }
    for (let py = 0; py < OV; py++) for (let px = 0; px < OV; px++) {
      const o = ((cy * OV + py) * c.width + cx * OV + px) * 4;
      const sh = feat[i] && land[i] && ((px + py + cx + cy) & 1) ? 0.85 : 1;
      d[o] = col[0] * sh; d[o + 1] = col[1] * sh; d[o + 2] = col[2] * sh; d[o + 3] = 255;
    }
  }
  x.putImageData(id, 0, 0);
  T._overview = c;
  return c;
}
function blitOverview(T, ccx, ccy, canvas) {
  const ov = overview(T); const x = ov.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.drawImage(canvas, ccx * CHUNK * OV, ccy * CHUNK * OV, canvas.width / (TS / OV), canvas.height / (TS / OV));
  if (T._ovQueue) T._ovQueue = T._ovQueue.filter(([a, b]) => a !== ccx || b !== ccy);
}
function chunk(T, ccx, ccy) {
  const key = ccy * 1000 + ccx;
  let c = T._chunks.get(key);
  if (c) { T._chunks.delete(key); T._chunks.set(key, c); return c; }
  const cw = Math.min(CHUNK, T.W - ccx * CHUNK), ch = Math.min(CHUNK, T.H - ccy * CHUNK);
  c = renderRegion(T, ccx * CHUNK, ccy * CHUNK, cw, ch);
  T._chunks.set(key, c);
  blitOverview(T, ccx, ccy, c);
  while (T._chunks.size > LRU_MAX) T._chunks.delete(T._chunks.keys().next().value);
  return c;
}

export function drawTerrain(ctx, T, view) {
  if (!T._full && !T._chunks) renderTerrain(T);
  if (T._full) {
    if (!view) { ctx.drawImage(T._full, 0, 0); return; }
    const x0 = Math.max(0, Math.floor(view.x)), y0 = Math.max(0, Math.floor(view.y));
    const x1 = Math.min(T._full.width, Math.ceil(view.x + view.w)), y1 = Math.min(T._full.height, Math.ceil(view.y + view.h));
    if (x1 > x0 && y1 > y0) ctx.drawImage(T._full, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    return;
  }
  const v = view || { x: 0, y: 0, w: T.W * TS, h: T.H * TS };
  const C = CHUNK * TS;
  const ax = Math.max(0, Math.floor(v.x / C)), ay = Math.max(0, Math.floor(v.y / C));
  const bx = Math.min(Math.ceil(T.W / CHUNK) - 1, Math.floor((v.x + v.w) / C)), by = Math.min(Math.ceil(T.H / CHUNK) - 1, Math.floor((v.y + v.h) / C));
  const count = (bx - ax + 1) * (by - ay + 1);
  const ov = overview(T);
  const prevSmooth = ctx.imageSmoothingEnabled;
  if (count > 16) {
    // far zoom: draw the overview, and quietly upgrade one more of it per few frames
    ctx.imageSmoothingEnabled = false;
    const sx = Math.max(0, v.x / (TS / OV)), sy = Math.max(0, v.y / (TS / OV));
    const sw = Math.min(ov.width - sx, v.w / (TS / OV)), sh = Math.min(ov.height - sy, v.h / (TS / OV));
    if (sw > 0 && sh > 0) ctx.drawImage(ov, sx, sy, sw, sh, sx * (TS / OV), sy * (TS / OV), sw * (TS / OV), sh * (TS / OV));
    T._ovTick = (T._ovTick || 0) + 1;
    if (T._ovQueue && T._ovQueue.length && T._ovTick % 4 === 0) {
      const [a, b] = T._ovQueue.shift();
      const cw = Math.min(CHUNK, T.W - a * CHUNK), ch = Math.min(CHUNK, T.H - b * CHUNK);
      blitOverview(T, a, b, renderRegion(T, a * CHUNK, b * CHUNK, cw, ch));
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    return;
  }
  let fresh = 0;
  for (let cy = ay; cy <= by; cy++) for (let cx = ax; cx <= bx; cx++) {
    const key = cy * 1000 + cx;
    if (!T._chunks.has(key) && fresh >= 1) {
      // not rendered yet: show the overview for this patch, real tiles arrive next frame
      ctx.imageSmoothingEnabled = false;
      const cw = Math.min(CHUNK, T.W - cx * CHUNK), ch = Math.min(CHUNK, T.H - cy * CHUNK);
      ctx.drawImage(ov, cx * CHUNK * OV, cy * CHUNK * OV, cw * OV, ch * OV, cx * C, cy * C, cw * TS, ch * TS);
      continue;
    }
    if (!T._chunks.has(key)) fresh++;
    ctx.drawImage(chunk(T, cx, cy), cx * C, cy * C);
  }
  ctx.imageSmoothingEnabled = prevSmooth;
  // prefetch one neighbouring chunk when the main thread is idle, so panning finds tiles ready
  if (!T._prefetching) {
    let want = null;
    for (let cy = ay - 1; cy <= by + 1 && !want; cy++) for (let cx = ax - 1; cx <= bx + 1; cx++) {
      if (cx < 0 || cy < 0 || cx >= Math.ceil(T.W / CHUNK) || cy >= Math.ceil(T.H / CHUNK)) continue;
      if (!T._chunks.has(cy * 1000 + cx)) { want = [cx, cy]; break; }
    }
    if (want && T._chunks.size < LRU_MAX) {
      T._prefetching = true;
      const run = () => { T._prefetching = false; if (!T._chunks.has(want[1] * 1000 + want[0])) chunk(T, want[0], want[1]); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 600 }); else setTimeout(run, 120);
    }
  }
}

// ------------------------------------------------------------------ minimap
export function renderMinimap(T, state) {
  const c = document.createElement('canvas'); c.width = T.W; c.height = T.H;
  updateMinimap(c, T, state);
  return c;
}
export function updateMinimap(c, T, state) {
  const P = prep(T);
  const x = c.getContext('2d');
  const id = x.createImageData(T.W, T.H), d = id.data;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const bcol = BIOME_IDS.map((b) => hex(BIOMES[b].col).map((v) => v * 0.55 + 30));
  const kcol = state ? state.kingdoms.map((k) => hex(k.color || '#888888')) : [];
  const owners = state ? state.territories.map((t) => t.owner) : null;
  for (let i = 0; i < T.W * T.H; i++) {
    let col;
    if (!T.land[i]) col = P.deep[i] ? [22, 70, 140] : [34, 112, 180];
    else {
      const t = T.terr[i], o = owners && t >= 0 ? owners[t] : -1;
      col = bcol[T.biome[i]];
      if (o >= 0 && kcol[o]) col = [col[0] * 0.35 + kcol[o][0] * 0.65, col[1] * 0.35 + kcol[o][1] * 0.65, col[2] * 0.35 + kcol[o][2] * 0.65];
      if (T.feat[i]) col = col.map((v) => v * 0.85);
      // land borders a shade darker
      const xx = i % T.W;
      if (t >= 0 && ((xx + 1 < T.W && T.terr[i + 1] >= 0 && T.terr[i + 1] !== t) || (i + T.W < T.terr.length && T.terr[i + T.W] >= 0 && T.terr[i + T.W] !== t))) col = col.map((v) => v * 0.6);
    }
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}

// ------------------------------------------------------------------ smooth borders
// Boundary edges of every land are traced on cell corners (land on the right), turned into edge midpoints and
// Chaikin-smoothed; each stretch remembers which land lies across it.
function traceBorders(T) {
  if (T._borders) return T._borders;
  const { W, H, terr } = T;
  const tAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -2 : terr[y * W + x]);
  const n = T.territories.length;
  const edges = Array.from({ length: n }, () => []);
  const C = (x, y) => y * (W + 1) + x;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = terr[y * W + x]; if (t < 0) continue;
    const E = edges[t];
    let o;
    if ((o = tAt(x, y - 1)) !== t) E.push([C(x, y), C(x + 1, y), o]);
    if ((o = tAt(x + 1, y)) !== t) E.push([C(x + 1, y), C(x + 1, y + 1), o]);
    if ((o = tAt(x, y + 1)) !== t) E.push([C(x + 1, y + 1), C(x, y + 1), o]);
    if ((o = tAt(x - 1, y)) !== t) E.push([C(x, y + 1), C(x, y), o]);
  }
  const runs = [];
  const cx = (c) => (c % (W + 1)) * TS, cy = (c) => Math.floor(c / (W + 1)) * TS;
  for (let t = 0; t < n; t++) {
    const E = edges[t];
    const byStart = new Map();
    E.forEach((e, i) => { if (!byStart.has(e[0])) byStart.set(e[0], []); byStart.get(e[0]).push(i); });
    const used = new Uint8Array(E.length);
    for (let s0 = 0; s0 < E.length; s0++) {
      if (used[s0]) continue;
      const loop = [];
      let cur = s0;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1; loop.push(cur);
        const nx = byStart.get(E[cur][1]) || [];
        cur = -1;
        for (const j of nx) if (!used[j]) { cur = j; break; }
      }
      if (loop.length < 3) continue;
      // midpoints with labels
      let P = loop.map((i) => [(cx(E[i][0]) + cx(E[i][1])) / 2, (cy(E[i][0]) + cy(E[i][1])) / 2, E[i][2]]);
      for (let it = 0; it < 2; it++) {
        const Q = [];
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2]], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
        }
        P = Q;
      }
      // split into runs by neighbour label
      let start = 0;
      for (let i = 0; i < P.length; i++) if (P[i][2] !== P[(i - 1 + P.length) % P.length][2]) { start = i; break; }
      const closed = P.every((p) => p[2] === P[0][2]);
      const rot = P.slice(start).concat(P.slice(0, start));
      let i = 0;
      while (i < rot.length) {
        let j = i; while (j + 1 < rot.length && rot[j + 1][2] === rot[i][2]) j++;
        const label = rot[i][2];
        if (label >= 0) {
          const pts = rot.slice(i, j + 1).map((p) => [p[0], p[1]]);
          if (!closed) { const nxt = rot[(j + 1) % rot.length]; pts.push([nxt[0], nxt[1]]); if (i > 0 || true) { const prv = rot[(i - 1 + rot.length) % rot.length]; pts.unshift([prv[0], prv[1]]); } }
          else pts.push([rot[0][0], rot[0][1]]);
          runs.push(makeRun(t, label, pts));
        }
        i = j + 1;
      }
    }
  }
  T._borders = runs;
  return runs;
}
function makeRun(t, nb, pts) {
  const off = (d) => {
    const p = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const x = pts[i][0] - dy * d, y = pts[i][1] + dx * d;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    return p;
  };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { t, nb, line: off(0), edge: off(1.4), g1: off(3.6), g2: off(7.5), box: [x0 - 10, y0 - 10, x1 + 10, y1 + 10] };
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
export function drawOverlay(ctx, T, state, view) {
  const runs = traceBorders(T);
  const own = (t) => (t >= 0 && state.territories[t] ? state.territories[t].owner : -1);
  const vis = (r) => !view || !(r.box[2] < view.x || r.box[3] < view.y || r.box[0] > view.x + view.w || r.box[1] > view.y + view.h);
  const far = view && view.w > 2400;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // 1) soft inner glow along realm frontiers
  if (!far) for (const r of runs) {
    if (!vis(r)) continue;
    const o = own(r.t), p = own(r.nb); if (o < 0 || o === p) continue;
    const col = state.kingdoms[o].color;
    ctx.strokeStyle = hexA(col, 0.13); ctx.lineWidth = 5; ctx.stroke(r.g2);
    ctx.strokeStyle = hexA(col, 0.26); ctx.lineWidth = 3; ctx.stroke(r.g1);
  }
  // 2) dotted splits between lands of one realm, and neutral lines
  ctx.setLineDash([2, 4]);
  for (const r of runs) {
    if (!vis(r) || r.t > r.nb) continue;
    const o = own(r.t), p = own(r.nb);
    if (o === p) { ctx.strokeStyle = o >= 0 ? 'rgba(255,255,255,.42)' : 'rgba(255,248,230,.32)'; ctx.lineWidth = 1; ctx.stroke(r.line); }
    else if (o < 0 && p < 0) { ctx.strokeStyle = 'rgba(255,248,230,.32)'; ctx.lineWidth = 1; ctx.stroke(r.line); }
  }
  ctx.setLineDash([]);
  // 3) realm frontier: dark core with each realm's colour on its own side
  for (const r of runs) {
    if (!vis(r)) continue;
    const o = own(r.t), p = own(r.nb); if (o === p) continue;
    if (r.t < r.nb) { ctx.strokeStyle = 'rgba(10,8,16,.6)'; ctx.lineWidth = far ? 3 : 2; ctx.stroke(r.line); }
    if (o >= 0) { ctx.strokeStyle = state.kingdoms[o].color; ctx.lineWidth = far ? 3 : 2; ctx.stroke(far ? r.line : r.edge); }
  }
  ctx.restore();
}
// legacy: a baked overlay canvas (small maps only; big maps return a 1x1 canvas, use drawOverlay)
export function renderOverlay(T, state) {
  const c = document.createElement('canvas');
  if (T.W * T.H > CHUNKED_ABOVE) { c.width = 1; c.height = 1; return c; }
  c.width = T.W * TS; c.height = T.H * TS;
  drawOverlay(c.getContext('2d'), T, state, null);
  return c;
}

// ------------------------------------------------------------------ animated details
export function drawAnimated(ctx, T, time, view) {
  const P = prep(T);
  const v = view || { x: 0, y: 0, w: T.W * TS, h: T.H * TS };
  const inV = (px, py, m = 48) => px > v.x - m && py > v.y - m && px < v.x + v.w + m && py < v.y + v.h + m;
  const C = CHUNK * TS;
  if (v.w < 2600) {
    for (let cy = Math.max(0, Math.floor(v.y / C)); cy <= Math.floor((v.y + v.h) / C); cy++) for (let cx = Math.max(0, Math.floor(v.x / C)); cx <= Math.floor((v.x + v.w) / C); cx++) {
      for (const [sx, sy, ph] of P.sparkles.get(cy * 1000 + cx) || []) {
        if (!inV(sx, sy, 4)) continue;
        const k = (time * 1.4 + ph) % 6;
        if (k < 0.5) { ctx.fillStyle = '#d6fff4'; ctx.fillRect(sx, sy, 3, 1); }
        else if (k < 1) { ctx.fillStyle = '#a6fcdb'; ctx.fillRect(sx + 1, sy, 1, 1); }
      }
    }
  }
  for (const L of T.landmarks || []) {
    const px = L.x * TS, py = L.y * TS;
    if (!inV(px, py)) continue;
    const small = L.kind in SMALL;
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(px + (small ? 8 : 16), py + (small ? 14 : 29), small ? 6 : 13, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawLandmark(ctx, L.kind, px, py, time, L.x + L.y);
  }
  const dk = img(DOCKS);
  if (dk) for (const d of T.docks || []) {
    const px = d.x * TS, py = d.y * TS;
    if (!inV(px, py)) continue;
    const f = Math.floor(time * 4 + d.x) % 5;
    ctx.drawImage(dk, 48 + f * 16, 0, 16, 32, px, py - 18, 16, 32);
  }
  const ship = img(SHIP);
  if (ship) for (const r of T.seaRoutes || []) {
    const pts = r.pts; if (pts.length < 2) continue;
    let len = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); len += l; }
    const tt = (time * 1.1 + (r.a * 7 % 11)) % (len * 2);
    let d = tt < len ? tt : len * 2 - tt; const fwd = tt < len;
    let i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const a = pts[i], b = pts[i + 1], f = seg[i] ? d / seg[i] : 0;
    const wx = (a[0] + (b[0] - a[0]) * f) * TS + 8, wy = (a[1] + (b[1] - a[1]) * f) * TS + 8;
    if (!inV(wx, wy)) continue;
    let ang = Math.atan2((b[1] - a[1]), (b[0] - a[0])); if (!fwd) ang += Math.PI;
    const dir = (Math.round(((ang + Math.PI / 2) / (Math.PI * 2)) * 8) % 8 + 8) % 8;
    const bob = Math.sin(time * 3 + r.a) * 0.8;
    ctx.fillStyle = 'rgba(166,252,219,.55)'; ctx.fillRect(Math.round(wx - 6), Math.round(wy + 5), 12, 1);
    ctx.drawImage(ship, dir * 16, 48, 16, 48, Math.round(wx - 8), Math.round(wy - 40 + bob), 16, 48);
  }
  // a small flock now and then, with shadows on the ground
  const cycle = 22, k = Math.floor(time / cycle), ph = (time % cycle) / cycle;
  if (ph < 0.6 && v.w < 2600) {
    const h = hashI(k, 99), dir = h & 1 ? 1 : -1;
    const by = v.y + v.h * (0.15 + ((h >>> 3) % 60) / 100);
    const bx = dir > 0 ? v.x - 30 + (v.w + 60) * (ph / 0.6) : v.x + v.w + 30 - (v.w + 60) * (ph / 0.6);
    for (let i = 0; i < 4; i++) {
      const ox = -dir * (i * 9 + (i % 2) * 3), oy = (i % 2 ? 5 : -2) + i * 2;
      const flap = Math.sin(time * 14 + i) > 0;
      const x = Math.round(bx + ox), y = Math.round(by + oy + Math.sin(time * 2 + i) * 2);
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x + 6, y + 26, 4, 1);
      ctx.fillStyle = '#26202e';
      ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 4, y, 1, 1); ctx.fillRect(x + 2, y + 1, 1, 1);
      if (flap) { ctx.fillRect(x + 1, y - 1, 1, 1); ctx.fillRect(x + 3, y - 1, 1, 1); } else { ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + 3, y + 1, 1, 1); }
    }
  }
}
const SMALL = { campfire: 1, fountain: 1, monolith: 1, monolithb: 1, eye: 1, dragonvein: 1, rallyflag: 1 };

// ------------------------------------------------------------------ settlements
export function townRef(state, t) {
  const fid = t.owner >= 0 && state.kingdoms[t.owner] ? state.kingdoms[t.owner].fid : 'castle';
  const stage = t.ruined > 0 ? 4 : t.level;
  return FACTIONS[fid].town(stage);
}
// what a land's settlement looks like: 'hamlet' | 'village' | 'walled' | 'town' | 'ruin'
export function settlementKind(state, t) {
  if (t.ruined > 0) return 'ruin';
  const k = t.owner >= 0 ? state.kingdoms[t.owner] : null;
  const tier = k ? k.tier || 'village' : 'neutral';
  if (tier === 'kingdom' || tier === 'empire') return (k.capital === t.id || t.level >= 2) ? 'town' : 'walled';
  return t.level >= 1 ? 'village' : 'hamlet';
}
const HAMLET_SLOTS = [[-12, -1], [11, -5], [-1, -17]];
const VILLAGE_SLOTS = [[-24, 0], [0, 2], [22, -3], [-14, -16], [10, -19], [30, -17]];
const WALLED_SLOTS = [[-18, -14], [2, -18], [20, -13], [-8, -28], [12, -31]];
function settlementPieces(state, t) {
  const kind = settlementKind(state, t);
  const seedH = hashI(t.id, 7);
  const pieces = []; // [sx, sy, dx, dy] 16x16 sprites from STRUCT relative to anchor (bottom-centre)
  if (kind === 'hamlet') {
    const pool = hutsFor(t.biome), n = 2 + (seedH % 2);
    for (let i = 0; i < n; i++) { const s = pool[(seedH >>> (i * 3)) % pool.length]; pieces.push([s[0], s[1], HAMLET_SLOTS[i][0], HAMLET_SLOTS[i][1]]); }
  } else if (kind === 'village' || kind === 'walled') {
    const pool = housesFor(t.biome), slots = kind === 'walled' ? WALLED_SLOTS : VILLAGE_SLOTS;
    const n = kind === 'walled' ? 5 : 4 + (seedH % 3);
    for (let i = 0; i < n; i++) { const s = pool[(seedH >>> (i * 2)) % pool.length]; pieces.push([s[0], s[1], slots[i][0], slots[i][1]]); }
  }
  pieces.sort((a, b) => a[3] - b[3]);
  return { kind, pieces };
}
const captures = [];
export function captureFx(state, tid) { captures.push({ tid, t0: performance.now() / 1000 }); }

function flag(ctx, x, y, col, time, id) {
  const wave = Math.floor(time * 4 + id) % 2;
  ctx.fillStyle = '#1b1420'; ctx.fillRect(x, y, 1, 14);
  ctx.fillStyle = '#0b0a10'; ctx.fillRect(x + 1, y, 8, 6);
  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, 7, 4 - wave); if (wave) ctx.fillRect(x + 1, y + 4, 5, 1);
}
function smoke(ctx, x, y, time, seed) {
  for (let k = 0; k < 3; k++) {
    const ph = (time * 0.45 + k / 3 + (seed % 97) / 97) % 1;
    const a = (1 - ph) * 0.32;
    ctx.fillStyle = `rgba(235,235,240,${a.toFixed(3)})`;
    const r = 1 + ph * 2.5;
    ctx.fillRect(Math.round(x + Math.sin(ph * 5 + seed) * 2.5 + ph * 3 - r / 2), Math.round(y - ph * 15 - r / 2), Math.ceil(r), Math.ceil(r));
  }
}

export function drawTowns(ctx, state, time, view) {
  const st = img(STRUCT), walls = img(WALLS);
  const v = view;
  for (const t of state.territories) {
    const ax = t.cx * TS + 8, ay = t.cy * TS + 14;
    if (v && (ax < v.x - 80 || ay < v.y - 40 || ax > v.x + v.w + 80 || ay > v.y + v.h + 90)) continue;
    const col = t.owner >= 0 && state.kingdoms[t.owner] ? state.kingdoms[t.owner].color : null;
    const { kind, pieces } = settlementPieces(state, t);
    if (kind === 'town' || kind === 'ruin') {
      const r = townRef(state, t);
      const w = r[3], hh = r[4];
      const px = ax - w / 2, py = ay - hh;
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(ax, ay - 1, w * 0.46, 5, 0, 0, Math.PI * 2); ctx.fill();
      drawSpriteRef(ctx, r, px, py);
      if (kind === 'town') smoke(ctx, ax - 10, py + 14, time, t.id * 13);
      if (col) flag(ctx, Math.round(px + w - 6), Math.round(py + 2), col, time, t.id);
    } else if (st) {
      // ground patch so the cluster reads as a place
      ctx.fillStyle = 'rgba(70,50,30,.16)';
      ctx.beginPath(); ctx.ellipse(ax + 2, ay - 8, kind === 'hamlet' ? 22 : 36, kind === 'hamlet' ? 13 : 20, 0, 0, Math.PI * 2); ctx.fill();
      if (kind === 'walled' && walls) {
        // back wall line
        for (let i = -2; i <= 2; i++) ctx.drawImage(walls, 32, 0, 16, 16, ax - 8 + i * 16, ay - 46, 16, 16);
      }
      for (const [sx, sy, dx, dy] of pieces) {
        const x = Math.round(ax + dx - 8), y = Math.round(ay + dy - 16);
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 14, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(st, sx, sy, 16, 16, x, y, 16, 16);
      }
      if (kind === 'walled' && walls) {
        // side walls and a front wall with a gate gap
        for (let j = 0; j < 3; j++) { ctx.drawImage(walls, 0, 16 + j * 16, 16, 16, ax - 48, ay - 42 + j * 14, 16, 16); ctx.drawImage(walls, 0, 16 + j * 16, 16, 16, ax + 32, ay - 42 + j * 14, 16, 16); }
        for (const i of [-2, -1, 1, 2]) ctx.drawImage(walls, i < 0 ? (i === -2 ? 16 : 32) : (i === 2 ? 48 : 32), 0, 16, 16, ax - 8 + i * 16, ay - 2, 16, 16);
      }
      const top = pieces.reduce((m, p) => (p[3] < m[3] ? p : m), pieces[0] || [0, 0, 0, 0]);
      if (pieces.length) smoke(ctx, ax + top[2] - 2, ay + top[3] - 15, time, t.id * 7);
      if (col) flag(ctx, Math.round(ax + 16), Math.round(ay - (kind === 'hamlet' ? 30 : 40)), col, time, t.id);
    }
  }
  // capture sweeps
  const now = performance.now() / 1000;
  for (let i = captures.length - 1; i >= 0; i--) {
    const c = captures[i], k = (now - c.t0) / 1.1;
    if (k >= 1) { captures.splice(i, 1); continue; }
    const t = state.territories[c.tid]; if (!t) continue;
    const x = t.cx * TS + 8, y = t.cy * TS;
    const col = t.owner >= 0 ? state.kingdoms[t.owner].color : '#ffffff';
    const R = 20 + k * 110;
    const g = ctx.createRadialGradient(x, y, R * 0.6, x, y, R);
    g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.8, hexA(col, 0.35 * (1 - k))); g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,250,220,${(0.5 * (1 - k)).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y - 10, 10 + k * 20, 0, Math.PI * 2); ctx.fill();
  }
}

// ------------------------------------------------------------------ neutral sites
const MONSTERS = ['necropolis', 'inferno', 'stronghold', 'orcs'];
const MINE_BY_BIOME = { lava: 'sulfurmine', cave: 'crystalmine', dungeon: 'crystalmine', ice: 'gemmine', christmas: 'gemmine', sand: 'goldmine', dirt: 'orepit' };
export function drawSites(ctx, state, T, time, view) {
  if (!state || !state.sites || !T.siteSpots) return;
  const st = img(STRUCT), props = img(DUNGEON_PROPS), trees = img(TREES);
  for (const s of state.sites) {
    const sp = T.siteSpots[s.spot]; if (!sp) continue;
    const x = sp.x * TS, y = sp.y * TS;
    if (view && (x < view.x - 48 || y < view.y - 48 || x > view.x + view.w + 48 || y > view.y + view.h + 48)) continue;
    const done = s.status === 'cleared' || s.status === 'plundered';
    const h = hashI(sp.x, sp.y);
    const bt = BIOMES[T.territories[sp.tid] ? T.territories[sp.tid].biome : 'grass'] || BIOMES.grass;
    ctx.save();
    if (done) ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x + 16, y + 28, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
    const kind = s.kind || sp.kind;
    if (kind === 'mine') {
      drawLandmark(ctx, MINE_BY_BIOME[T.territories[sp.tid].biome] || 'goldmine', x, y, done ? 0 : time, h);
    } else if (kind === 'ruin') {
      // ancient entrance: the tileset's cave mouth, with rubble
      const ts = img(bt.src);
      if (ts) ctx.drawImage(ts, 224, 0, 32, 32, x, y + 2, 32, 32);
      if (props) { ctx.drawImage(props, 96 + (h % 3) * 16, 0, 16, 16, x - 6, y + 16, 16, 16); ctx.drawImage(props, 96 + ((h >>> 3) % 3) * 16, 16, 16, 16, x + 22, y + 18, 16, 16); }
    } else if (kind === 'lair') {
      if (props) { ctx.drawImage(props, 64, 0, 16, 16, x - 2, y + 16, 16, 16); ctx.drawImage(props, 80, 16, 16, 16, x + 18, y + 18, 16, 16); }
      if (!done) drawUnit(ctx, MONSTERS[h % MONSTERS.length], 3 + (h >>> 4) % 3, 1, 'idle', time * 3 + h, x + 16, y + 26, (h & 1) === 1);
      else if (st) ctx.drawImage(st, 96, 64, 16, 16, x + 8, y + 10, 16, 16);
    } else if (kind === 'camp') {
      if (st) { ctx.drawImage(st, 96, 64, 16, 16, x, y + 8, 16, 16); ctx.drawImage(st, 48, 64, 16, 16, x + 17, y + 4, 16, 16); }
      if (!done) { drawLandmark(ctx, 'campfire', x + 9, y + 18, time, h); drawUnit(ctx, 'orcs', 0, 1, 'idle', time * 3 + h, x + 26, y + 30, true); }
    } else if (kind === 'shrine') {
      const which = ['eye', 'monolith', 'fountain', 'monolithb', 'dragonvein'][h % 5];
      drawLandmark(ctx, which, x + 8, y + 8, done ? 0 : time, h);
      if (props) { ctx.drawImage(props, 112, 0, 16, 16, x - 4, y + 18, 16, 16); ctx.drawImage(props, 128, 16, 16, 16, x + 20, y + 18, 16, 16); }
      if (!done) { const a = 0.25 + 0.2 * Math.sin(time * 3 + h); ctx.fillStyle = `rgba(190,170,255,${a.toFixed(3)})`; ctx.beginPath(); ctx.arc(x + 16, y + 12, 9, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === 'grove' && trees) {
      for (const [dx, dy] of [[0, 4], [16, 2], [8, 12]]) ctx.drawImage(trees, 432, 240, 16, 16, x + dx, y + dy, 16, 16);
      if (!done) for (let i = 0; i < 3; i++) { const ph = (time * 0.7 + i / 3 + h % 7) % 1; ctx.fillStyle = `rgba(255,240,160,${(0.8 * (1 - ph)).toFixed(3)})`; ctx.fillRect(Math.round(x + 6 + ((h >>> i) % 20)), Math.round(y + 22 - ph * 22), 1, 1); }
    }
    if (s.status === 'plundered') smoke(ctx, x + 16, y + 10, time, h);
    ctx.restore();
    if (s.status === 'claimed') { ctx.fillStyle = '#ffd25a'; ctx.fillRect(x + 28, y + 2, 1, 10); ctx.fillRect(x + 29, y + 2, 5, 4); }
  }
}
export function siteAt(T, state, wx, wy) {
  if (!state || !state.sites || !T.siteSpots) return null;
  let best = null, bd = 18;
  for (const s of state.sites) {
    const sp = T.siteSpots[s.spot]; if (!sp) continue;
    const d = Math.hypot(sp.x * TS + 16 - wx, sp.y * TS + 18 - wy);
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}

// ------------------------------------------------------------------ heroes
function pinAt(t, n, time) {
  return [t.cx * TS + 8 + 28 + (n - 1) * 4.5, t.cy * TS - 24 + (time == null ? 0 : Math.round(Math.sin(time * 2 + t.id) * 1.2))];
}
function pathPoint(pts, f) {
  let len = 0; const seg = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); len += l; }
  let d = Math.max(0, Math.min(1, f)) * len, i = 0;
  while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
  const a = pts[i], b = pts[i + 1] || pts[i], k = seg[i] ? d / seg[i] : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, b[0] - a[0]];
}
function pin(ctx, state, lead, px, py, count) {
  const col = state.kingdoms[lead.kingdom] ? state.kingdoms[lead.kingdom].color : '#cccccc';
  ctx.fillStyle = 'rgba(10,8,16,.85)';
  ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(px - 5, py + 8); ctx.lineTo(px + 5, py + 8); ctx.lineTo(px, py + 15); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(px - 4, py + 7); ctx.lineTo(px + 4, py + 7); ctx.lineTo(px, py + 13); ctx.fill();
  ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.clip();
  drawSpriteRef(ctx, portraitRef(lead.fid, lead.portrait), px - 8, py - 8, 16, 16);
  ctx.restore();
  if (count > 1) {
    const bx = Math.round(px + 9), by = Math.round(py - 8);
    ctx.fillStyle = '#0b0a10'; ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1420'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(count), bx, by + 0.5); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
}
export function drawHeroes(ctx, state, time, travel, T) {
  const tr = travel ? (travel instanceof Map ? travel : new Map(Object.entries(travel).map(([k, v]) => [+k, v]))) : null;
  const by = new Map();
  const walking = [];
  for (const h of state.heroes) {
    if (h.status !== 'active') continue;
    if (tr && tr.has(h.id)) { walking.push(h); continue; }
    if (!by.has(h.loc)) by.set(h.loc, []);
    by.get(h.loc).push(h);
  }
  for (const [tid, list] of by) {
    const t = state.territories[tid];
    const n = Math.min(3, list.length);
    list.slice(0, 3).forEach((h, i) => {
      const x = t.cx * TS + 8 + 28 + i * 9, y = t.cy * TS + 10 - (i % 2) * 3;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
      drawHero(ctx, h.fid, h.gender, 3, 'walk', time * 3 + i, x, y, false);
    });
    const [px, py] = pinAt(t, n, time);
    pin(ctx, state, list[0], px, py, list.length);
  }
  // heroes on the move follow the road between lands
  for (const h of walking) {
    const m = tr.get(h.id);
    const a = state.territories[m.from], b = state.territories[m.to];
    if (!a || !b) continue;
    const pts = T && T.roadPath ? T.roadPath(m.from, m.to) : [[a.cx * TS + 8, a.cy * TS + 8], [b.cx * TS + 8, b.cy * TS + 8]];
    const [x, y, dx] = pathPoint(pts, m.t);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 4, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
    // dust behind the boots
    const ph = (time * 3) % 1; ctx.fillStyle = `rgba(220,200,160,${(0.5 * (1 - ph)).toFixed(3)})`; ctx.fillRect(Math.round(x - Math.sign(dx || 1) * (5 + ph * 4)), Math.round(y + 2 - ph * 3), 2, 2);
    drawHero(ctx, h.fid, h.gender, 3, 'walk', time * 6, x, y + 4, dx < 0);
    pin(ctx, state, h, x, y - 28, 1);
  }
}

export function drawOrders(ctx, state, kid, time) {
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.target == null) continue;
    if (kid != null && h.kingdom !== kid) continue;
    const a = state.territories[h.loc], b = state.territories[h.order.target];
    if (!a || !b) continue;
    const x1 = a.cx * TS + 8, y1 = a.cy * TS + 4, x2 = b.cx * TS + 8, y2 = b.cy * TS + 4;
    const atk = h.order.type === 'attack';
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.18;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,8,16,.6)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
    ctx.strokeStyle = atk ? '#ff4a3a' : '#ffffff'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(y2 - my, x2 - mx);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(ang - 0.5) * 9, y2 - Math.sin(ang - 0.5) * 9); ctx.lineTo(x2 - Math.cos(ang + 0.5) * 9, y2 - Math.sin(ang + 0.5) * 9); ctx.fill();
  }
}
// roads are baked into the terrain; kept for API compatibility
export function drawRoads() {}

// ------------------------------------------------------------------ seasons
export function drawSeason(ctx, T, season, time, view) {
  const v = view || { x: 0, y: 0, w: T.W * TS, h: T.H * TS };
  const tint = { Winter: 'rgba(225,236,255,.16)', Autumn: 'rgba(255,160,70,.07)', Spring: 'rgba(255,230,240,.04)', Summer: 'rgba(255,240,180,.035)' }[season];
  if (tint) { ctx.fillStyle = tint; ctx.fillRect(v.x, v.y, v.w, v.h); }
  const n = season === 'Winter' ? 90 : season === 'Autumn' ? 22 : season === 'Spring' ? 18 : 0;
  for (let i = 0; i < n; i++) {
    const h = hashI(i, 4321);
    const sp = 0.5 + ((h >>> 4) % 100) / 100;
    const fx = (h % 1000) / 1000, fy = ((h >>> 10) % 1000) / 1000;
    const fall = season === 'Winter' ? 22 : 12;
    let x = v.x + ((fx * v.w + Math.sin(time * sp + i) * 10 + time * (season === 'Winter' ? 4 : 14) * sp) % v.w + v.w) % v.w;
    let y = v.y + ((fy * v.h + time * fall * sp) % v.h);
    x = Math.round(x); y = Math.round(y);
    if (season === 'Winter') { ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.55)'; ctx.fillRect(x, y, i % 4 ? 1 : 2, i % 4 ? 1 : 2); }
    else if (season === 'Autumn') { ctx.fillStyle = ['#e0702a', '#c9461f', '#f0a030'][i % 3]; const s = Math.sin(time * 3 + i) > 0; ctx.fillRect(x, y, s ? 2 : 1, s ? 1 : 2); }
    else { ctx.fillStyle = i % 2 ? '#ffc8dc' : '#fff0f6'; ctx.fillRect(x, y, 1, 1); }
  }
}

// ------------------------------------------------------------------ tap hit-testing
export function hitTest(T, state, wx, wy) {
  // hero pins first: they are small and sit on top
  const groups = new Map();
  for (const h of state.heroes) if (h.status === 'active') { if (!groups.has(h.loc)) groups.set(h.loc, []); groups.get(h.loc).push(h); }
  let best = null, bd = 16;
  for (const [tid, list] of groups) {
    const t = state.territories[tid];
    const [px, py] = pinAt(t, Math.min(3, list.length));
    const d = Math.min(Math.hypot(px - wx, py - wy), Math.hypot(t.cx * TS + 40 - wx, t.cy * TS + 4 - wy) + 4);
    if (d < bd) { bd = d; best = { kind: 'hero', id: list[0].id, tid }; }
  }
  if (best) return best;
  for (const t of state.territories) {
    const ax = t.cx * TS + 8, ay = t.cy * TS + 14;
    if (wx > ax - 30 && wx < ax + 30 && wy > ay - 50 && wy < ay + 6) {
      const d = Math.hypot(ax - wx, ay - 18 - wy);
      if (!best || d < best.d) best = { kind: 'town', id: t.id, d };
    }
  }
  if (best) return { kind: 'town', id: best.id };
  const s = siteAt(T, state, wx, wy);
  if (s != null) return { kind: 'site', id: s };
  const cx = Math.floor(wx / TS), cy = Math.floor(wy / TS);
  if (cx < 0 || cy < 0 || cx >= T.W || cy >= T.H) return null;
  const t = T.terr[cy * T.W + cx];
  return t >= 0 ? { kind: 'land', id: t } : null;
}
