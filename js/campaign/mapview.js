// Draws the campaign map: terrain (pre-rendered once), ownership overlay, towns, heroes and orders.
import { img } from '../engine/assets.js';
import { makeRng } from '../engine/rng.js';
import { BIOMES, BIOME_IDS, TILE, TREES, OCEAN, FACTIONS, drawHero, drawSpriteRef } from '../data/art.js';

export const TS = 16;

export function renderTerrain(T) {
  const { W, H, land, biome, feat } = T;
  const c = document.createElement('canvas');
  c.width = W * TS; c.height = H * TS;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const rng = makeRng(T.decorSeed);
  const ocean = img(OCEAN);
  const tiles = BIOME_IDS.map((b) => img(BIOMES[b].src));
  const trees = img(TREES);
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx);
  // base
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    if (!land[i]) {
      const o = [[0, 0], [16, 0], [0, 16], [16, 16]][(cx * 3 + cy * 5) & 3];
      if (ocean) x.drawImage(ocean, o[0], o[1], 16, 16, cx * TS, cy * TS, TS, TS);
      continue;
    }
    const ts = tiles[biome[i]];
    const t = TILE.textured[Math.floor(rng() * TILE.textured.length)];
    if (ts) x.drawImage(ts, t[0], t[1], 16, 16, cx * TS, cy * TS, TS, TS);
  }
  // soften biome seams with a dithered fringe
  const id = x.getImageData(0, 0, c.width, c.height), px = id.data, CW = c.width;
  const copyPx = (sx, sy, dx, dy) => { const s = (sy * CW + sx) * 4, d = (dy * CW + dx) * 4; px[d] = px[s]; px[d + 1] = px[s + 1]; px[d + 2] = px[s + 2]; };
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx; if (!land[i]) continue;
    const r = at(cx + 1, cy), d = at(cx, cy + 1);
    if (r >= 0 && land[r] && biome[r] !== biome[i]) {
      for (let py = 0; py < TS; py++) for (let k = 1; k <= 3; k++) if (rng() < 0.55 - k * 0.12) copyPx(cx * TS + TS + k, cy * TS + py, cx * TS + TS - k, cy * TS + py);
    }
    if (d >= 0 && land[d] && biome[d] !== biome[i]) {
      for (let pxx = 0; pxx < TS; pxx++) for (let k = 1; k <= 3; k++) if (rng() < 0.55 - k * 0.12) copyPx(cx * TS + pxx, cy * TS + TS + k, cx * TS + pxx, cy * TS + TS - k);
    }
  }
  // shoreline: round convex land corners, then outline + foam on water side
  const isLandPx = new Uint8Array(c.width * c.height);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (!land[cy * W + cx]) continue;
    const L = land[at(cx - 1, cy)] === 1, R = land[at(cx + 1, cy)] === 1, U = land[at(cx, cy - 1)] === 1, D = land[at(cx, cy + 1)] === 1;
    for (let py = 0; py < TS; py++) for (let pxx = 0; pxx < TS; pxx++) {
      let keep = true;
      const cut = 5;
      if (!L && !U && pxx + py < cut) keep = false;
      if (!R && !U && (TS - 1 - pxx) + py < cut) keep = false;
      if (!L && !D && pxx + (TS - 1 - py) < cut) keep = false;
      if (!R && !D && (TS - 1 - pxx) + (TS - 1 - py) < cut) keep = false;
      if (keep) isLandPx[(cy * TS + py) * CW + cx * TS + pxx] = 1;
    }
  }
  const PH = c.height;
  for (let py = 0; py < PH; py++) for (let pxx = 0; pxx < CW; pxx++) {
    const k = py * CW + pxx;
    if (isLandPx[k]) continue;
    // nearest land within 3px
    let dmin = 9;
    for (let dy = -3; dy <= 3 && dmin > 1; dy++) {
      const yy = py + dy; if (yy < 0 || yy >= PH) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = pxx + dx; if (xx < 0 || xx >= CW) continue;
        if (isLandPx[yy * CW + xx]) { const dd = Math.max(Math.abs(dx), Math.abs(dy)); if (dd < dmin) dmin = dd; }
      }
    }
    const o = k * 4;
    const cellLand = land[((py / TS) | 0) * W + ((pxx / TS) | 0)];
    if (cellLand) { // a rounded-off corner: paint water there
      px[o] = 36; px[o + 1] = 159; px[o + 2] = 222;
    }
    if (dmin === 1) { px[o] = 6; px[o + 1] = 6; px[o + 2] = 8; }
    else if (dmin === 2) { px[o] = 196; px[o + 1] = 236; px[o + 2] = 255; }
    else if (dmin === 3 && ((pxx + py) & 1)) { px[o] = 120; px[o + 1] = 200; px[o + 2] = 240; }
  }
  x.putImageData(id, 0, 0);

  // decor on open land
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    if (!land[i] || feat[i] || rng() > 0.07) continue;
    const ts = tiles[biome[i]]; const d = TILE.decor[Math.floor(rng() * TILE.decor.length)];
    if (ts) x.drawImage(ts, d[0], d[1], 16, 16, cx * TS, cy * TS, TS, TS);
  }
  // forests and mountains via 3x3 blob tiles
  if (trees) for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx, f = feat[i]; if (!f) continue;
    const b = BIOMES[BIOME_IDS[biome[i]]];
    let base;
    if (f === 1) { if (!b.tree) continue; base = b.tree; } else base = [b.mtn, 336];
    const same = (j) => j >= 0 && feat[j] === f;
    const L = same(at(cx - 1, cy)), R = same(at(cx + 1, cy)), U = same(at(cx, cy - 1)), D = same(at(cx, cy + 1));
    const col = !L ? 0 : !R ? 2 : 1, row = !U ? 0 : !D ? 2 : 1;
    x.drawImage(trees, base[0] + 16 + col * 16, base[1] + row * 16, 16, 16, cx * TS, cy * TS, TS, TS);
  }
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ownership tint + borders, rebuilt when owners change
export function renderOverlay(T, state) {
  const { W, H, terr } = T;
  const c = document.createElement('canvas');
  c.width = W * TS; c.height = H * TS;
  const x = c.getContext('2d');
  const ownerOf = (i) => (i < 0 || terr[i] < 0 ? -2 : state.territories[terr[i]].owner);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx; const t = terr[i]; if (t < 0) continue;
    const o = state.territories[t].owner; if (o < 0) continue;
    const col = state.kingdoms[o].color;
    x.fillStyle = hexA(col, 0.16);
    x.fillRect(cx * TS, cy * TS, TS, TS);
    // borders
    const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of nbs) {
      const nx = cx + dx, ny = cy + dy;
      const j = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
      const nt = j < 0 ? -1 : terr[j];
      if (nt === t) continue;
      const realm = ownerOf(j) !== o;
      x.fillStyle = realm ? col : hexA(col, 0.55);
      const w = realm ? 3 : 1;
      if (!realm && ((cx + cy) & 1)) continue;
      if (dx === 1) x.fillRect(cx * TS + TS - w, cy * TS, w, TS);
      if (dx === -1) x.fillRect(cx * TS, cy * TS, w, TS);
      if (dy === 1) x.fillRect(cx * TS, cy * TS + TS - w, TS, w);
      if (dy === -1) x.fillRect(cx * TS, cy * TS, TS, w);
    }
  }
  return c;
}

export function townRef(state, t) {
  const fid = t.owner >= 0 ? state.kingdoms[t.owner].fid : 'castle';
  const stage = t.ruined > 0 ? 4 : t.level;
  return FACTIONS[fid].town(stage);
}

export function drawTowns(ctx, state, time) {
  for (const t of state.territories) {
    const r = townRef(state, t);
    const w = r[3], hh = r[4];
    const px = t.cx * TS + 8 - w / 2, py = t.cy * TS + 14 - hh;
    drawSpriteRef(ctx, r, px, py);
  }
}

export function drawHeroes(ctx, state, time) {
  const by = new Map();
  for (const h of state.heroes) {
    if (h.status !== 'active') continue;
    if (!by.has(h.loc)) by.set(h.loc, []);
    by.get(h.loc).push(h);
  }
  for (const [tid, list] of by) {
    const t = state.territories[tid];
    list.slice(0, 4).forEach((h, i) => {
      const x = t.cx * TS + 8 + 26 + (i % 2) * 14, y = t.cy * TS + 8 + Math.floor(i / 2) * 12 - 6;
      const col = state.kingdoms[h.kingdom].color;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - 6, y - 1, 12, 3);
      ctx.fillStyle = col; ctx.fillRect(x - 7, y - 19, 2, 8); ctx.fillRect(x - 5, y - 19, 4, 3);
      drawHero(ctx, h.fid, h.gender, 3, 'walk', time * 3 + i, x, y, false);
    });
  }
}

export function drawOrders(ctx, state, kid, time) {
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.target == null) continue;
    if (kid != null && h.kingdom !== kid) continue;
    const a = state.territories[h.loc], b = state.territories[h.order.target];
    const x1 = a.cx * TS + 8, y1 = a.cy * TS + 4, x2 = b.cx * TS + 8, y2 = b.cy * TS + 4;
    const atk = h.order.type === 'attack';
    ctx.strokeStyle = atk ? '#ff4a3a' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]); ctx.lineDashOffset = -time * 12;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(ang - 0.5) * 8, y2 - Math.sin(ang - 0.5) * 8); ctx.lineTo(x2 - Math.cos(ang + 0.5) * 8, y2 - Math.sin(ang + 0.5) * 8); ctx.fill();
  }
}

export function drawRoads(ctx, state) {
  ctx.strokeStyle = 'rgba(60,40,20,.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (const t of state.territories) for (const n of t.nb) {
    if (n < t.id) continue;
    const u = state.territories[n];
    ctx.moveTo(t.cx * TS + 8, t.cy * TS + 8); ctx.lineTo(u.cx * TS + 8, u.cy * TS + 8);
  }
  ctx.stroke(); ctx.setLineDash([]);
}
