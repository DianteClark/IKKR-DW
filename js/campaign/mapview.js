// Draws the campaign map: terrain (pre-rendered once), ownership overlay, towns, heroes, orders and animated details.
import { img, loadImage } from '../engine/assets.js';
import { makeRng, makeNoise } from '../engine/rng.js';
import { BIOMES, BIOME_IDS, TREES, FACTIONS, drawHero, drawSpriteRef, portraitRef, STRUCT } from '../data/art.js';
import { paintLandWater, paintRiver, drawBlobs, drawNetwork, drawLandmark, preloadLandmarks, ROAD_SHEET, FENCE_SHEET, maskAt } from '../maps/paint.js';

export const TS = 16;
const FIELD_SHEET = 'assets/has2020/Landscape Objects/FieldSpriteSheet.png';
const DOCKS = 'assets/weekly/DockAndLighthouseSpriteSheet.png';
const SHIP = 'assets/weekly/Ship/Ship.png';
[FIELD_SHEET, DOCKS, SHIP, ROAD_SHEET, FENCE_SHEET].forEach((s) => loadImage(s));
preloadLandmarks();

const DECOR = {
  flower: [[32, 0], [48, 0], [32, 16], [48, 16]],
  rock: [[64, 0], [80, 0], [64, 16], [80, 16]],
  bush: [[96, 0], [112, 0], [96, 16], [112, 16]],
  log: [[128, 0], [144, 0], [128, 16], [144, 16]],
  grass: [[96, 16], [112, 0]],
};
const HOUSE_ROW = { grass: [0, 48, 9], dirt: [0, 48, 9], sand: [16, 48, 9], lava: [16, 48, 9], marsh: [32, 48, 5], deepmarsh: [32, 48, 5], ice: [48, 48, 9], christmas: [48, 48, 9], cave: [32, 48, 5], dungeon: [0, 48, 9] };

export function renderTerrain(T) {
  const { W, H, land, biome, feat } = T;
  const N = W * H;
  // biome for water cells = nearest land biome (so coast pixels are textured right); distance for deep water
  const bIdx = new Uint8Array(N), wdist = new Uint16Array(N).fill(65535);
  let fr = [];
  for (let i = 0; i < N; i++) if (land[i]) { bIdx[i] = biome[i]; wdist[i] = 0; fr.push(i); }
  while (fr.length) {
    const nf = [];
    for (const j of fr) {
      const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx; if (wdist[k] > wdist[j] + 1) { wdist[k] = wdist[j] + 1; bIdx[k] = bIdx[j]; nf.push(k); }
      }
    }
    fr = nf;
  }
  const deep = new Uint8Array(N);
  const dn = makeNoise(T.decorSeed ^ 0x3a);
  for (let i = 0; i < N; i++) if (!land[i] && wdist[i] >= 3 + (dn((i % W) / 7, ((i / W) | 0) / 7, 2) > 0.62 ? 1 : 0)) deep[i] = 1;
  // deep patches need to be at least 2 cells thick for the blob tiles
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x2 = 1; x2 < W - 1; x2++) {
    const i = y * W + x2; if (!deep[i]) continue;
    if (!(deep[i - 1] || deep[i + 1]) || !(deep[i - W] || deep[i + W])) deep[i] = 0;
  }
  const c = paintLandWater({ W, H, land, biomeIdx: bIdx, deep }, T.decorSeed);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const rng = makeRng(T.decorSeed ^ 0x51);
  const tiles = BIOME_IDS.map((b) => img(BIOMES[b].src));
  // fields
  const fs = img(FIELD_SHEET);
  if (fs) for (const f of T.fields || []) {
    const bx = f.kind === 2 || f.kind === 3 ? 64 : 0, by = f.kind === 1 || f.kind === 3 ? 16 : 0;
    for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
      const col = dx === 0 ? 0 : dx === f.w - 1 ? 3 : 1 + (dx % 2);
      x.drawImage(fs, bx + col * 16, by, 16, 16, (f.x + dx) * TS, (f.y + dy) * TS, TS, TS);
    }
  }
  // rivers
  for (const r of T.rivers || []) paintRiver(x, r.filter((_, i) => i % 2 === 0 || i === r.length - 1), { w0: 2.2, w1: 3.6 });
  // roads (bridges where they cross rivers)
  const roadSheet = img(ROAD_SHEET);
  if (T.road && roadSheet) {
    drawNetwork(x, roadSheet, W, H, T.road, 1, 0, 0, (cx, cy) => T.river && T.river[cy * W + cx]);
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx; if (!T.road[i] || !T.river[i]) continue;
      const m = maskAt(T.road, W, H, cx, cy, (v) => v === 1);
      const horiz = (m & 2) || (m & 8);
      x.drawImage(roadSheet, horiz ? 192 : 208, 288, 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // decor (clustered by the generator)
  for (const d of T.decor || []) {
    const ts = tiles[biome[d.y * W + d.x]]; if (!ts) continue;
    const opts = DECOR[d.k] || DECOR.flower; const t = opts[Math.floor(rng() * opts.length)];
    x.drawImage(ts, t[0], t[1], 16, 16, d.x * TS, d.y * TS, TS, TS);
  }
  // forests and mountains
  const trees = img(TREES);
  drawBlobs(x, trees, W, H, feat, 1, (cx, cy) => BIOMES[BIOME_IDS[biome[cy * W + cx]]].tree);
  drawBlobs(x, trees, W, H, feat, 2, (cx, cy) => [BIOMES[BIOME_IDS[biome[cy * W + cx]]].mtn, 336]);
  // fences + hamlet houses
  const fence = img(FENCE_SHEET);
  if (T.fences && fence) {
    const snowy = (cx, cy) => { const b = BIOME_IDS[biome[cy * W + cx]]; return b === 'ice' || b === 'christmas'; };
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      if (!T.fences[cy * W + cx]) continue;
      const m = maskAt(T.fences, W, H, cx, cy, (v) => v === 1);
      const AT = { 0: [32, 0], 2: [16, 0], 8: [48, 0], 10: [32, 0] };
      const p = AT[m & 10] || [32, 0];
      x.drawImage(fence, 64 + p[0], (snowy(cx, cy) ? 64 : 0) + p[1], 16, 16, cx * TS, cy * TS + 4, TS, TS);
    }
  }
  const st = img(STRUCT);
  if (st) for (const hs of T.houses || []) {
    const [row, x0, n] = HOUSE_ROW[hs.biome] || HOUSE_ROW.grass;
    x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(hs.x * TS + 8, hs.y * TS + 14, 7, 2.5, 0, 0, Math.PI * 2); x.fill();
    x.drawImage(st, x0 + (hs.v % n) * 16, row, 16, 16, hs.x * TS, hs.y * TS, TS, TS);
  }
  // sparkle spots for animated water
  T._sparkles = [];
  const sr = makeRng(T.decorSeed ^ 0x99);
  for (let i = 0; i < N; i++) if (!land[i] && wdist[i] >= 2 && sr() < 0.05) T._sparkles.push([(i % W) * TS + sr.int(2, 13), ((i / W) | 0) * TS + sr.int(2, 13), sr() * 6]);
  return c;
}

// animated bits: landmarks, lighthouses, ships, water glints. viewRect in world px
export function drawAnimated(ctx, T, time, view) {
  const v = view || { x: 0, y: 0, w: 1e9, h: 1e9 };
  const inV = (px, py, m = 48) => px > v.x - m && py > v.y - m && px < v.x + v.w + m && py < v.y + v.h + m;
  // water glints
  for (const [sx, sy, ph] of T._sparkles || []) {
    if (!inV(sx, sy, 4)) continue;
    const k = (time * 1.4 + ph) % 6;
    if (k < 0.5) { ctx.fillStyle = '#d6fff4'; ctx.fillRect(sx, sy, 3, 1); }
    else if (k < 1) { ctx.fillStyle = '#a6fcdb'; ctx.fillRect(sx + 1, sy, 1, 1); }
  }
  for (const L of T.landmarks || []) {
    const px = L.x * TS, py = L.y * TS;
    if (!inV(px, py)) continue;
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(px + (L.kind.length && L.kind in SMALL ? 8 : 16), py + (L.kind in SMALL ? 14 : 29), L.kind in SMALL ? 6 : 13, 3, 0, 0, Math.PI * 2); ctx.fill();
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
    // length + position (ping-pong)
    let len = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); len += l; }
    const speed = 1.1;
    const tt = (time * speed + (r.a * 7 % 11)) % (len * 2);
    let d = tt < len ? tt : len * 2 - tt; const fwd = tt < len;
    let i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const a = pts[i], b = pts[i + 1], f = seg[i] ? d / seg[i] : 0;
    const wx = (a[0] + (b[0] - a[0]) * f) * TS + 8, wy = (a[1] + (b[1] - a[1]) * f) * TS + 8;
    if (!inV(wx, wy)) continue;
    let ang = Math.atan2((b[1] - a[1]), (b[0] - a[0])); if (!fwd) ang += Math.PI;
    const dir = (Math.round(((ang + Math.PI / 2) / (Math.PI * 2)) * 8) % 8 + 8) % 8; // 0=N clockwise
    const bob = Math.sin(time * 3 + r.a) * 0.8;
    ctx.fillStyle = 'rgba(166,252,219,.55)'; ctx.fillRect(Math.round(wx - 6), Math.round(wy + 5), 12, 1);
    ctx.drawImage(ship, dir * 16, 48, 16, 48, Math.round(wx - 8), Math.round(wy - 40 + bob), 16, 48);
  }
}
const SMALL = { campfire: 1, fountain: 1, monolith: 1, monolithb: 1, eye: 1, dragonvein: 1, rallyflag: 1 };

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
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx);
  // clean frontiers: realm edge = kingdom-coloured line on a dark backing with a soft inner glow;
  // lands inside one realm are split by a faint dotted line; no full-map tint
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx; const t = terr[i]; if (t < 0) continue;
    const o = state.territories[t].owner;
    const col = o >= 0 ? state.kingdoms[o].color : '#c8c0b0';
    const px = cx * TS, py = cy * TS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = at(cx + dx, cy + dy);
      const nt = j < 0 ? -1 : terr[j];
      if (nt === t || nt < 0) continue;
      const realm = ownerOf(j) !== o;
      const rect = (off, w, a) => {
        x.fillStyle = a;
        if (dx === 1) x.fillRect(px + TS - off - w, py, w, TS); if (dx === -1) x.fillRect(px + off, py, w, TS);
        if (dy === 1) x.fillRect(px, py + TS - off - w, TS, w); if (dy === -1) x.fillRect(px, py + off, TS, w);
      };
      if (realm && o >= 0) {
        rect(2, 3, hexA(col, 0.28)); rect(5, 3, hexA(col, 0.12));
        rect(0, 2, col); rect(2, 1, 'rgba(10,8,16,.55)');
      } else if (realm) {
        rect(0, 1, 'rgba(10,8,16,.35)');
      } else {
        x.fillStyle = 'rgba(255,255,255,.45)';
        for (let k = 1; k < TS; k += 5) {
          if (dx === 1) x.fillRect(px + TS - 1, py + k, 1, 2); if (dx === -1) x.fillRect(px, py + k, 1, 2);
          if (dy === 1) x.fillRect(px + k, py + TS - 1, 2, 1); if (dy === -1) x.fillRect(px + k, py, 2, 1);
        }
      }
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
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(t.cx * TS + 8, t.cy * TS + 13, w * 0.46, 5, 0, 0, Math.PI * 2); ctx.fill();
    drawSpriteRef(ctx, r, px, py);
    if (t.owner >= 0) {
      const col = state.kingdoms[t.owner].color;
      const fx = Math.round(px + w - 6), fy = Math.round(py + 2);
      const wave = Math.floor(time * 4 + t.id) % 2;
      ctx.fillStyle = '#1b1420'; ctx.fillRect(fx, fy, 1, 14);
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(fx + 1, fy, 8, 6);
      ctx.fillStyle = col; ctx.fillRect(fx + 1, fy + 1, 7, 4 - wave); if (wave) ctx.fillRect(fx + 1, fy + 4, 5, 1);
    }
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
    const n = Math.min(3, list.length);
    list.slice(0, 3).forEach((h, i) => {
      const x = t.cx * TS + 8 + 28 + i * 9, y = t.cy * TS + 10 - (i % 2) * 3;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
      drawHero(ctx, h.fid, h.gender, 3, 'walk', time * 3 + i, x, y, false);
    });
    // portrait pin over the group's leader, ringed in the kingdom colour (HAS hero-pack style)
    const lead = list[0];
    const col = state.kingdoms[lead.kingdom].color;
    const px = t.cx * TS + 8 + 28 + (n - 1) * 4.5, py = t.cy * TS - 24 + Math.round(Math.sin(time * 2 + tid) * 1.2);
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
    if (list.length > 1) {
      const bx = Math.round(px + 9), by = Math.round(py - 8);
      ctx.fillStyle = '#0b0a10'; ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1420'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(list.length), bx, by + 0.5); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }
}

export function drawOrders(ctx, state, kid, time) {
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order || h.order.target == null) continue;
    if (kid != null && h.kingdom !== kid) continue;
    const a = state.territories[h.loc], b = state.territories[h.order.target];
    const x1 = a.cx * TS + 8, y1 = a.cy * TS + 4, x2 = b.cx * TS + 8, y2 = b.cy * TS + 4;
    const atk = h.order.type === 'attack';
    // curved arc for readability
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

// roads are baked into the terrain now; kept for API compatibility
export function drawRoads() {}
