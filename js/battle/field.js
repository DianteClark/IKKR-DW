// Battlefield generation from hand-designed templates: posts (bases), the roads between them, and composed
// terrain (rivers with bridges, mountain passes, forests, lakes, coasts, siege walls, dungeon halls).
// Deterministic from a seed so both peers build the same field.
import { makeRng, makeNoise } from '../engine/rng.js';
import { img, loadImage } from '../engine/assets.js';
import { BIOMES, BIOME_IDS, TREES, DUNGEON_TILES, FACTIONS, STRUCT, drawSpriteRef } from '../data/art.js';
import { paintLandWater, drawBlobs, drawLandmark, preloadLandmarks, ROAD_SHEET, FENCE_SHEET, maskAt, at4 } from '../maps/paint.js';

export const TS = 16;
const FIELD_SIZES = { skirmish: [40, 22], standard: [52, 28], grand: [68, 36] };
export const BW = 52, BH = 28;
const WALLS = 'assets/weekly/WallsSpriteSheet.png';
const GATES = 'assets/weekly/Walls/GatesSpriteSheet.png';
[WALLS, GATES, ROAD_SHEET, FENCE_SHEET, DUNGEON_TILES].forEach((s) => loadImage(s));
preloadLandmarks();

const UNDERGROUND = new Set(['dungeon', 'cave']);
const BY_BIOME = {
  grass: ['plains', 'river', 'forest', 'pass', 'ruins', 'lake', 'islands'],
  dirt: ['plains', 'pass', 'river', 'ruins'],
  sand: ['plains', 'coast', 'ruins', 'pass', 'islands'],
  ice: ['pass', 'plains', 'lake', 'islands'],
  christmas: ['plains', 'forest', 'lake'],
  marsh: ['river', 'lake', 'forest', 'islands'],
  deepmarsh: ['river', 'lake', 'forest'],
  lava: ['pass', 'plains', 'ruins'],
};

// the battlefield follows the land where the battle is fought: its water, woods and heights
function pickTemplate(rng, biome, land) {
  const fits = BY_BIOME[biome] || ['plains'];
  if (!land) return rng.pick(fits);
  const want = [];
  if (land.island) want.push('islands');
  if (land.river) want.push('river');
  if (land.lake) want.push('lake');
  if (land.coast && fits.includes('coast')) want.push('coast');
  if (land.mtn > 0.16) want.push('pass');
  if (land.forest > 0.28 && BIOMES[biome] && BIOMES[biome].tree) want.push('forest');
  if (land.sites && land.sites.includes('ruin')) want.push('ruins');
  const ok = want.filter((t) => t === 'coast' || t === 'pass' || t === 'forest' || t === 'ruins' || fits.includes(t) || t === 'river' || t === 'lake');
  if (ok.length && rng() < 0.85) return ok[0];
  return fits.includes('plains') ? 'plains' : rng.pick(fits);
}

// ---------------- battlefield terrain ----------------
// codes: 0 open, 1 forest, 2 hills, 3 water, 4 ford, 5 mud, 6 wall, 7 bridge
export const TERRAIN = [
  { name: 'Open ground', spd: 1 },
  { name: 'Forest', spd: 0.72, cover: 0.6, tip: 'slow · cover from arrows' },
  { name: 'Hills', spd: 0.62, def: 1.25, range: 1.25, tip: 'slow · +defence · archers shoot farther' },
  { name: 'Water', spd: 0.35 },
  { name: 'Ford', spd: 0.6, tip: 'shallow crossing · slow' },
  { name: 'Mud', spd: 0.78, tip: 'boggy ground · slow' },
  { name: 'Wall', spd: 1 },
  { name: 'Bridge', spd: 1, tip: 'a narrow crossing' },
];
export function terrainAt(F, x, y) {
  const G = F._grid; if (!G || !G.terr) return 0;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= F.W || cy >= F.H) return 0;
  return G.terr[cy * F.W + cx];
}
export function passable(F, x, y) { const t = terrainAt(F, x, y); return t !== 3 && t !== 6; }
// closest point on an open road to (x, y)
export function nearestRoadPoint(F, x, y) {
  let best = null;
  F.edges.forEach(([a, b], ei) => {
    if (F.blocked && F.blocked.includes(ei)) return;
    const A = F.posts[a], Bp = F.posts[b];
    const dx = Bp.x - A.x, dy = Bp.y - A.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / L));
    const px = A.x + dx * t, py = A.y + dy * t, d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { edge: ei, a, b, t, x: px, y: py, d };
  });
  return best;
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
};

export function makeField(seed, biome, nOutposts = 5, opts = {}) {
  const rng = makeRng(seed);
  const noise = makeNoise(seed ^ 0x99);
  const [W, H] = FIELD_SIZES[opts.size] || FIELD_SIZES.standard;
  const underground = UNDERGROUND.has(biome);
  let template = opts.template || (underground ? 'dungeon' : pickTemplate(rng, biome, opts.land));
  if (template === 'forest' && !(BIOMES[biome] && BIOMES[biome].tree)) template = 'plains';
  const siege = !!opts.siege && template !== 'dungeon';
  const n = Math.max(3, Math.min(8, nOutposts + (opts.size === 'grand' ? 2 : opts.size === 'skirmish' ? -1 : 0)));
  const cy = H / 2;

  // ---------------- posts ----------------
  const posts = [];
  const add = (x, y, owner, extra = {}) => posts.push({ id: posts.length, x: Math.round(x) + 0.5, y: Math.round(y) + 0.5, owner, prog: 0, by: null, ...extra });
  add(3.5, cy + rng.int(-3, 3), 'att', { camp: true });
  add(W - (siege ? 7 : 5), cy + rng.int(-2, 2), 'def', { main: true });
  const ownerAt = (x) => (x < W * 0.36 ? 'neutral' : 'def');
  const okPos = (x, y, d) => posts.every((p) => Math.hypot(p.x - x, p.y - y) > d);
  const lakeC = { x: W / 2 + rng.int(-2, 2), y: cy + rng.int(-1, 1), rx: W * 0.16, ry: H * 0.2 };
  const riverX = (y) => W * 0.46 + Math.sin(y * 0.35 + seed % 7) * 2.2 + (noise(1.3, y / 6) - 0.5) * 4;
  let lanes = [];
  if (template === 'pass') { lanes = rng.chance(0.5) ? [H * 0.28, H * 0.72] : [H * 0.22, H * 0.5, H * 0.78]; }
  if (template === 'dungeon') {
    // rooms on a jittered grid; camp = left room, main = right room
    const cols = Math.max(3, Math.round(W / 13)), rows = Math.max(2, Math.round(H / 11));
    posts.length = 0;
    add(3.5, cy, 'att', { camp: true });
    add(W - 5, cy, 'def', { main: true });
    const slots = [];
    for (let c = 1; c < cols; c++) for (let r = 0; r < rows; r++) slots.push([W * c / cols + rng.int(-1, 1), (H * (r + 0.5)) / rows + rng.int(-1, 1)]);
    rng.shuffle(slots);
    for (const [x, y] of slots) { if (posts.length >= n + 2) break; if (okPos(x, y, 7)) add(x, y, ownerAt(x)); }
  } else {
    let tries = 0;
    const minD = Math.max(template === 'islands' ? 8 : 6.5, Math.sqrt((W * H) / (n + 2)) * (template === 'islands' ? 0.7 : 0.62));
    while (posts.length < n + 2 && tries++ < 1500) {
      let x = rng.int(10, W - 10), y = rng.int(4, H - 5);
      if (template === 'river') { const rx = riverX(y); if (Math.abs(x - rx) < 5) continue; }
      if (template === 'pass') { y = rng.pick(lanes) + rng.int(-1, 1); }
      if (template === 'lake' && ((x - lakeC.x) / (lakeC.rx + 3)) ** 2 + ((y - lakeC.y) / (lakeC.ry + 3)) ** 2 < 1) continue;
      if (template === 'coast' && y > H * 0.66) continue;
      if (siege && x > W - 17) continue;
      if (okPos(x, y, minD)) add(x, y, ownerAt(x));
    }
    if (siege) {
      // a gatehouse post just outside the walls
      const gy = posts[1].y + (rng.chance(0.5) ? -1 : 1);
      if (okPos(W - 15, gy, 4)) add(W - 15, gy, 'def');
    }
  }

  // ---------------- edges: MST + short extra links ----------------
  const P = posts;
  const blockedLine = (a, b) => {
    if (template === 'lake') {
      for (let t = 0.1; t < 0.9; t += 0.05) { const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; if (((x - lakeC.x) / lakeC.rx) ** 2 + ((y - lakeC.y) / lakeC.ry) ** 2 < 1) return true; }
    }
    if (template === 'pass' && lanes.length) {
      // only lane-following or short cross links
      const dy = Math.abs(a.y - b.y); if (dy > 4 && Math.abs(a.x - b.x) < dy * 1.2) return true;
    }
    return false;
  };
  const edges = [];
  const has = (a, b) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const inTree = new Set([0]);
  while (inTree.size < P.length) {
    let best = null;
    for (const a of inTree) for (const b of P) {
      if (inTree.has(b.id)) continue;
      const d = Math.hypot(P[a].x - b.x, P[a].y - b.y) * (blockedLine(P[a], b) ? 3 : 1);
      if (!best || d < best[2]) best = [a, b.id, d];
    }
    edges.push([best[0], best[1], { kind: 'road' }]); inTree.add(best[1]);
  }
  for (const p of P) {
    const near = P.filter((q) => q.id !== p.id).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 3);
    for (const q of near) {
      if (has(p.id, q.id) || blockedLine(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < (template === 'dungeon' ? 15 : 17) && rng.chance(0.75)) edges.push([p.id, q.id, { kind: 'road' }]);
    }
  }
  if (template === 'river') {
    const side = (p) => Math.sign(p.x - riverX(p.y));
    const crossing = () => edges.filter(([a, b]) => side(P[a]) !== side(P[b]));
    let guard = 0;
    while (crossing().length < 2 && guard++ < 10) {
      const used = crossing().map(([a, b]) => (P[a].y + P[b].y) / 2);
      let best = null;
      for (const a of P) for (const b of P) {
        if (side(a) >= 0 || side(b) <= 0 || has(a.id, b.id)) continue;
        const my = (a.y + b.y) / 2; if (used.some((u) => Math.abs(u - my) < H * 0.25)) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y); if (!best || d < best[2]) best = [a.id, b.id, d];
      }
      if (!best) break;
      edges.push([best[0], best[1], { kind: 'road' }]);
    }
  }
  // never let the camp link straight to the main post (forces a real fight for the middle)
  for (let i = edges.length - 1; i >= 0; i--) { const [a, b] = edges[i]; if ((a === 0 && b === 1) || (a === 1 && b === 0)) { const ok = edges.filter((_, j) => j !== i); if (connected(P.length, ok)) edges.splice(i, 1); } }

  // corridor mask: keep paths and post areas clear
  const N = W * H;
  const corridor = new Float32Array(N).fill(99);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d = 99;
    for (const [a, b] of edges) d = Math.min(d, segDist(x + 0.5, y + 0.5, P[a].x, P[a].y, P[b].x, P[b].y));
    for (const p of P) d = Math.min(d, Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) - (p.main ? 2.5 : 1.3));
    corridor[y * W + x] = d;
  }

  // ---------------- terrain ----------------
  const water = new Uint8Array(N), feat = new Uint8Array(N), voidc = new Uint8Array(N), wall = new Uint8Array(N);
  if (template === 'river') {
    for (let y = 0; y < H; y++) { const rx = riverX(y + 0.5); const w = 1.4 + noise(4, y / 5) * 0.8; for (let x = 0; x < W; x++) if (Math.abs(x + 0.5 - rx) < w) water[y * W + x] = 1; }
  } else if (template === 'lake') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = ((x + 0.5 - lakeC.x) / lakeC.rx) ** 2 + ((y + 0.5 - lakeC.y) / lakeC.ry) ** 2 + (noise(x / 4, y / 4) - 0.5) * 0.7;
      if (v < 1 && corridor[y * W + x] > 1.2) water[y * W + x] = 1;
    }
  } else if (template === 'coast') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y > H * 0.74 + (noise(x / 6, 3) - 0.5) * 6 && corridor[y * W + x] > 1.5) water[y * W + x] = 1;
  }
  else if (template === 'islands') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let land = false;
      for (const p of P) {
        const r = (p.main ? 5.2 : p.camp ? 4.6 : 3.4) + (noise(x / 3.5, y / 3.5) - 0.5) * 2.2;
        if (Math.hypot((x + 0.5 - p.x) * 0.9, (y + 0.5 - p.y) * 1.1) < r) { land = true; break; }
      }
      if (!land && x > 2 && x < W - 3 && y > 1 && y < H - 2) water[y * W + x] = 1;
    }
  }
  // small ponds on plains/ruins
  if ((template === 'plains' || template === 'ruins') && biome !== 'lava') {
    for (let k = 0; k < 2; k++) {
      const px = rng.int(8, W - 8), py = rng.int(3, H - 4), r = rng.int(2, 3);
      for (let y = py - r; y <= py + r; y++) for (let x = px - r - 1; x <= px + r + 1; x++) if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && ((x - px) / (r + 1)) ** 2 + ((y - py) / r) ** 2 < 1 && corridor[y * W + x] > 2.2) water[y * W + x] = 1;
    }
  }
  // features
  const fNoise = makeNoise(seed ^ 0x123);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (water[i]) continue;
    const c = corridor[i];
    const fv = fNoise(x / 5, y / 5, 2);
    if (template === 'pass') {
      const ld = Math.min(...lanes.map((l) => Math.abs(y + 0.5 - l)));
      if (c > 1.8 && ld > 2.2 && x > 7 && x < W - 8) feat[i] = 2;
      else if (c > 2.4 && fv > 0.62) feat[i] = 1;
    } else if (template === 'forest') {
      if (c > 1.9 && fv > 0.3) feat[i] = 1;
      else if (c > 3 && fv < 0.2) feat[i] = 2;
    } else if (template === 'dungeon') {
      // void everywhere except rooms/corridors
      if (c > 1.2) voidc[i] = 1;
    } else {
      const fTh = (template === 'plains' ? 0.56 : 0.6) - (opts.land ? Math.max(-0.08, Math.min(0.14, (opts.land.forest - 0.2) * 0.5)) : 0);
      if (c > (template === 'islands' ? 1.6 : 2.4) && fv > fTh) feat[i] = 1;
      else if ((c > 3.4 && fv < 0.2 && (y < 4 || y > H - 5 || x > W - 10 || x < 8)) || (c > 3.8 && fv < 0.25)) feat[i] = 2;
    }
  }
  if (!(BIOMES[biome] && BIOMES[biome].tree)) for (let i = 0; i < N; i++) if (feat[i] === 1) feat[i] = 0;
  // rooms in dungeons are rectangles around posts
  if (template === 'dungeon') for (const p of P) {
    const rw = p.main ? 5 : 3, rh = p.main ? 4 : 3;
    for (let y = Math.floor(p.y) - rh; y <= Math.floor(p.y) + rh; y++) for (let x = Math.floor(p.x) - rw; x <= Math.floor(p.x) + rw; x++) if (x > 0 && y > 0 && x < W - 1 && y < H - 1) voidc[y * W + x] = 0;
  }
  // tidy 1-wide features
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, f = feat[i]; if (!f) continue;
    if (!((feat[i - 1] === f) || (feat[i + 1] === f)) || !((feat[i - W] === f) || (feat[i + W] === f))) feat[i] = 0;
  }
  // siege walls: rectangle around the main post with gates where roads cross
  const gates = [];
  let wallRect = null;
  if (siege) {
    const m = P[1];
    const x0 = Math.floor(m.x) - 5, x1 = Math.floor(m.x) + 4, y0 = Math.floor(m.y) - 5, y1 = Math.floor(m.y) + 3;
    wallRect = { x0, x1, y0, y1 };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      if (x === x0 || x === x1 || y === y0 || y === y1) { const i = y * W + x; wall[i] = 1; feat[i] = 0; water[i] = 0; }
    }
    // gates where an edge crosses the wall
    edges.forEach((e, ei) => {
      const [a, b] = e; const A = P[a], Bp = P[b];
      if (!(a === 1 || b === 1)) return;
      for (let t = 0; t <= 1; t += 0.01) {
        const x = Math.floor(A.x + (Bp.x - A.x) * t), y = Math.floor(A.y + (Bp.y - A.y) * t);
        const i = y * W + x;
        if (wall[i] === 1) { wall[i] = 2; gates.push({ x, y, vertical: x === x0 || x === x1, edge: ei }); e[2].kind = 'gate'; break; }
      }
    });
  }

  // edge kinds + crossings
  const crossings = [];
  edges.forEach((e, ei) => {
    const [a, b] = e; const A = P[a], Bp = P[b];
    const cells = [];
    const L = Math.hypot(Bp.x - A.x, Bp.y - A.y);
    for (let s = 0; s <= L * 3; s++) { const t = s / (L * 3); const x = Math.floor(A.x + (Bp.x - A.x) * t), y = Math.floor(A.y + (Bp.y - A.y) * t); const i = y * W + x; if (!cells.includes(i)) cells.push(i); }
    let wet = cells.filter((i) => water[i]);
    if (wet.length) {
      const i0 = cells.indexOf(wet[0]), i1 = cells.indexOf(wet[wet.length - 1]);
      wet = cells.slice(Math.max(0, i0 - 1), Math.min(cells.length, i1 + 2));
      const kind = template === 'river' && rng.chance(0.45) ? 'ford' : 'bridge';
      if (e[2].kind !== 'gate') e[2].kind = kind;
      crossings.push({ edge: ei, cells: wet, kind, horiz: Math.abs(Bp.x - A.x) >= Math.abs(Bp.y - A.y) });
    } else if (template === 'dungeon') e[2].kind = 'tunnel';
    else if (template === 'pass' && cells.some((i) => { const x = i % W, y = (i / W) | 0; return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => feat[(y + dy) * W + x + dx] === 2); })) e[2].kind = 'pass';
    e[2].len = L;
  });

  // traps along dungeon corridors (and a few in caves)
  const traps = [];
  if (underground) for (const [a, b] of edges) if (rng.chance(0.55)) {
    const t = 0.35 + rng() * 0.3, A = P[a], Bp = P[b];
    traps.push({ x: A.x + (Bp.x - A.x) * t, y: A.y + (Bp.y - A.y) * t, kind: rng.pick(['spikes', 'axe', 'fire']) });
  }
  // battlefield events that fit this ground
  const eventSpots = [];
  edges.forEach((e, ei) => {
    const k = e[2].kind;
    if (k === 'bridge' || k === 'ford') eventSpots.push({ edge: ei, kind: 'flood' });
    else if (k === 'pass') eventSpots.push({ edge: ei, kind: 'landslide' });
    else if (k === 'tunnel') eventSpots.push({ edge: ei, kind: 'collapse' });
    else if (template === 'forest' || (template !== 'dungeon' && rng.chance(0.25))) eventSpots.push({ edge: ei, kind: template === 'forest' ? 'fire' : rng.pick(['fire', 'landslide']) });
  });

  // ---------------- composed decor ----------------
  const occ = new Uint8Array(N);
  const props = [], anim = [];
  const freeCell = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && !water[y * W + x] && !feat[y * W + x] && !voidc[y * W + x] && !wall[y * W + x] && !occ[y * W + x] && corridor[y * W + x] > 1.15;
  const ring = (p, r0, r1, fn, count) => {
    let placed = 0;
    for (let k = 0; k < 60 && placed < count; k++) {
      const a = rng() * Math.PI * 2, r = r0 + rng() * (r1 - r0);
      const x = Math.floor(p.x + Math.cos(a) * r), y = Math.floor(p.y + Math.sin(a) * r * 0.8);
      if (!freeCell(x, y)) continue;
      occ[y * W + x] = 1; fn(x, y); placed++;
    }
  };
  if (template === 'dungeon') {
    for (const p of P) {
      ring(p, 1.6, 3.2, (x, y) => props.push({ x, y, src: DUNGEON_TILES, sx: rng.pick([240, 224, 192, 208]), sy: rng.pick([0, 16, 48, 64]) }), p.main ? 4 : 2);
      ring(p, 1.8, 3.5, (x, y) => anim.push({ x, y, k: 'brazier' }), 1);
    }
  } else {
    const camp = P[0];
    ring(camp, 1.4, 2.8, (x, y) => anim.push({ x, y, k: 'campfire' }), 1);
    ring(camp, 1.6, 3.4, (x, y) => props.push({ x, y, src: STRUCT, sx: 48, sy: 64 }), 3);
    ring(camp, 1.5, 3.2, (x, y) => anim.push({ x, y, k: 'rallyflag' }), 2);
    ring(camp, 1.5, 3.4, (x, y) => props.push({ x, y, src: DUNGEON_TILES, sx: rng.pick([224, 240]), sy: 0 }), 2);
    const houseRow = { sand: 16, lava: 16, ice: 48, christmas: 48, marsh: 32, deepmarsh: 32 }[biome] ?? 0;
    for (const p of P) {
      if (p.camp) continue;
      // the town gets a tidy cluster of houses; outposts stay clean so bases read clearly
      if (p.main) ring(p, 3.4, 5.4, (x, y) => props.push({ x, y, src: STRUCT, sx: 48 + rng.int(0, houseRow === 32 ? 4 : 8) * 16, sy: houseRow, shadow: true }), 4);
      if (!p.main && rng.chance(0.6)) ring(p, 1.5, 2.6, (x, y) => anim.push({ x, y, k: 'rallyflag' }), 1);
    }
    if (template === 'ruins') {
      for (let k = 0; k < 14; k++) {
        const x = rng.int(6, W - 7), y = rng.int(2, H - 3);
        if (!freeCell(x, y)) continue;
        occ[y * W + x] = 1;
        props.push({ x, y, src: WALLS, sx: rng.pick([0, 16, 48, 64]), sy: rng.pick([64, 80, 96]) });
      }
    }
  }
  // natural decor clustered by terrain
  const decor = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!freeCell(x, y)) continue;
    const nearM = feat[i - 1] === 2 || feat[i + 1] === 2 || feat[i - W] === 2 || feat[i + W] === 2;
    const nearF = feat[i - 1] === 1 || feat[i + 1] === 1 || feat[i - W] === 1 || feat[i + W] === 1;
    const nearW = water[i - 1] || water[i + 1] || water[i - W] || water[i + W];
    const fl = fNoise(x / 3, y / 3 + 40, 2);
    if (template === 'dungeon') { if (rng() < 0.03) decor.push({ x, y, d: 'bones' }); continue; }
    if (nearM && rng() < 0.4) decor.push({ x, y, d: 'rock' });
    else if (nearF && rng() < 0.28) decor.push({ x, y, d: 'bush' });
    else if (nearW && rng() < 0.25) decor.push({ x, y, d: 'grass' });
    else if (fl > 0.66 && rng() < 0.5) decor.push({ x, y, d: 'flower' });
    else if (rng() < 0.01) decor.push({ x, y, d: 'log' });
  }

  // terrain grid: what the units feel matches what is drawn
  const terr = new Uint8Array(N);
  const marshy = biome === 'marsh' || biome === 'deepmarsh';
  for (let i = 0; i < N; i++) {
    if (wall[i] === 1) terr[i] = 6;
    else if (water[i]) terr[i] = 3;
    else if (feat[i] === 1) terr[i] = 1;
    else if (feat[i] === 2) terr[i] = 2;
    else if (marshy && corridor[i] > 1.2) {
      const x = i % W, y = (i / W) | 0;
      let wet = false; for (let dy = -2; dy <= 2 && !wet; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * W + x + dx; if (j >= 0 && j < N && water[j]) { wet = true; break; } }
      if (wet || fNoise(x / 4 + 9, y / 4, 2) > 0.62) terr[i] = 5;
    }
  }
  for (const cr of crossings) for (const i of cr.cells) {
    const code = cr.kind === 'ford' ? 4 : 7;
    const x = i % W, y = (i / W) | 0;
    // a crossing is three cells wide so a squad never gets pinned beside the bridge
    for (const [dx, dy] of cr.horiz ? [[0, 0], [0, -1], [0, 1]] : [[0, 0], [-1, 0], [1, 0]]) { const j = (y + dy) * W + x + dx; if (j >= 0 && j < N && (terr[j] === 3 || j === i)) terr[j] = code; }
  }
  for (const g of gates) terr[g.y * W + g.x] = 0;
  return { seed, biome, W, H, posts: P, edges, traps, underground, template, eventSpots, blocked: [], siege, land: opts.land || null, wallRect,
    _grid: { water, feat, voidc, wall, corridor, gates, crossings, props, anim, decor, terr } };
}

function connected(n, edges) {
  const seen = new Set([0]); let fr = [0];
  while (fr.length) { const nf = []; for (const u of fr) for (const [a, b] of edges) { const v = a === u ? b : b === u ? a : -1; if (v >= 0 && !seen.has(v)) { seen.add(v); nf.push(v); } } fr = nf; }
  return seen.size === n;
}

const isBlocked = (field, ei) => field.blocked && field.blocked.includes(ei);

export function shortestPath(field, from, to) {
  const n = field.posts.length, d = new Array(n).fill(1e9), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  d[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || d[u] >= 1e9) break;
    done[u] = true;
    field.edges.forEach(([a, b], ei) => {
      if (isBlocked(field, ei)) return;
      const v = a === u ? b : b === u ? a : -1; if (v < 0) return;
      const w = Math.hypot(field.posts[u].x - field.posts[v].x, field.posts[u].y - field.posts[v].y);
      if (d[u] + w < d[v]) { d[v] = d[u] + w; prev[v] = u; }
    });
  }
  if (d[to] >= 1e9) return [from];
  const path = [];
  for (let v = to; v >= 0; v = prev[v]) path.unshift(v);
  return path[0] === from ? path : [from];
}

export function nearestPost(field, x, y) {
  let best = 0, bd = 1e9;
  for (const p of field.posts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.id; } }
  return best;
}

// ---------------- rendering ----------------
const DECOR = {
  flower: [[32, 0], [48, 0], [32, 16], [48, 16]], rock: [[64, 0], [80, 0], [64, 16], [80, 16]],
  bush: [[96, 0], [112, 0], [96, 16], [112, 16]], log: [[128, 0], [144, 0], [128, 16], [144, 16]], grass: [[96, 16], [112, 16]],
};

export function renderGround(field) {
  const { W, H, biome } = field, G = field._grid, N = W * H;
  const P = field.posts;
  if (field.template === 'dungeon') return renderDungeon(field);
  const bi = BIOME_IDS.indexOf(BIOMES[biome] ? biome : 'grass');
  const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = G.water[i] ? 0 : 1;
  const c = paintLandWater({ W, H, land, biomeIdx: new Uint8Array(N).fill(bi) }, field.seed ^ 0x77);
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const rng = makeRng(field.seed ^ 0x5151);
  const tiles = img(BIOMES[biome] ? BIOMES[biome].src : BIOMES.grass.src);
  // worn dirt roads (soft ribbons) between posts
  const dark = biome === 'ice' || biome === 'christmas' ? ['rgba(150,140,170,.55)', 'rgba(120,110,150,.35)'] : biome === 'lava' ? ['rgba(120,112,124,.7)', 'rgba(40,34,44,.45)'] : ['rgba(196,150,96,.82)', 'rgba(120,80,44,.5)'];
  for (const [a, b] of field.edges) {
    const A = P[a], Bp = P[b];
    const L = Math.hypot(Bp.x - A.x, Bp.y - A.y) * TS;
    const nx = -(Bp.y - A.y) * TS / L, ny = (Bp.x - A.x) * TS / L;
    for (let s = 0; s <= L; s += 2) {
      const t = s / L, wob = Math.sin(s * 0.05 + a) * 1.2;
      const px = A.x * TS + (Bp.x - A.x) * TS * t + nx * wob, py = A.y * TS + (Bp.y - A.y) * TS * t + ny * wob;
      x.fillStyle = dark[1]; x.fillRect(Math.round(px - 6), Math.round(py - 5), 12, 10);
    }
    for (let s = 0; s <= L; s += 2) {
      const t = s / L, wob = Math.sin(s * 0.05 + a) * 1.2;
      const px = A.x * TS + (Bp.x - A.x) * TS * t + nx * wob, py = A.y * TS + (Bp.y - A.y) * TS * t + ny * wob;
      x.fillStyle = dark[0]; x.fillRect(Math.round(px - 4), Math.round(py - 3), 8, 6);
    }
  }
  // post plazas
  for (const p of P) {
    x.fillStyle = dark[1]; x.beginPath(); x.ellipse(p.x * TS, p.y * TS + 2, p.main ? 40 : 22, p.main ? 26 : 14, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = dark[0]; x.beginPath(); x.ellipse(p.x * TS, p.y * TS + 2, p.main ? 34 : 17, p.main ? 21 : 10, 0, 0, Math.PI * 2); x.fill();
  }
  // decor
  if (tiles) for (const d of G.decor) { const t = DECOR[d.d] || DECOR.flower; const s = t[Math.floor(rng() * t.length)]; x.drawImage(tiles, s[0], s[1], 16, 16, d.x * TS, d.y * TS, TS, TS); }
  // bridges / fords
  const road = img(ROAD_SHEET);
  for (const cr of G.crossings) {
    const [a, b] = field.edges[cr.edge];
    for (const i of cr.cells) {
      const cx = i % W, cy = (i / W) | 0;
      if (cr.kind === 'ford') {
        x.fillStyle = 'rgba(214,196,150,.75)'; x.fillRect(cx * TS + 1, cy * TS + 3, 14, 10);
        if (tiles) { const s = DECOR.rock[(cx + cy) % 4]; x.drawImage(tiles, s[0], s[1], 16, 16, cx * TS, cy * TS - 2, TS, TS); }
      } else if (road) {
        if (cr.horiz) x.drawImage(road, (cx + cy) % 2 ? 160 : 176, 288, 16, 16, cx * TS, cy * TS, TS, TS);
        else x.drawImage(road, 208, 288, 16, 16, cx * TS, cy * TS, TS, TS);
      }
    }
  }
  // forests + mountains
  const trees = img(TREES);
  const B = BIOMES[biome] || BIOMES.grass;
  drawBlobs(x, trees, W, H, G.feat, 1, () => B.tree);
  drawBlobs(x, trees, W, H, G.feat, 2, () => [B.mtn, 336]);
  // siege walls
  const walls = img(WALLS);
  if (walls && field.siege) {
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx; if (!G.wall[i]) continue;
      if (G.wall[i] === 2) continue;
      const m = maskAt(G.wall, W, H, cx, cy, (v) => v > 0);
      const [sx, sy] = at4(m);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(cx * TS + 2, cy * TS + 12, 14, 5);
      x.drawImage(walls, sx, sy, 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // static props (tents, houses, crates, ruins)
  for (const pr of G.props) {
    const im = img(pr.src); if (!im) continue;
    x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(pr.x * TS + 8, pr.y * TS + 14, 7, 2.5, 0, 0, Math.PI * 2); x.fill();
    x.drawImage(im, pr.sx, pr.sy, 16, 16, pr.x * TS, pr.y * TS, TS, TS);
  }
  return c;
}

function renderDungeon(field) {
  const { W, H } = field, G = field._grid, N = W * H;
  const c = document.createElement('canvas'); c.width = W * TS; c.height = H * TS;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const d = img(DUNGEON_TILES);
  const rng = makeRng(field.seed ^ 0x66);
  x.fillStyle = '#141018'; x.fillRect(0, 0, c.width, c.height);
  if (!d) return c;
  const V = G.voidc;
  const isV = (cx, cy) => cx < 0 || cy < 0 || cx >= W || cy >= H || V[cy * W + cx] === 1;
  const floors = [[64, 0], [80, 0], [96, 0], [64, 16], [16, 16], [32, 16], [48, 16], [16, 0 + 16]];
  // room floors: framed 3x3 floor set at (0..48, 96..144) around each post room; corridors: plain floors
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (isV(cx, cy)) continue;
    const f = floors[Math.floor(rng() * 6)];
    x.drawImage(d, f[0], f[1], 16, 16, cx * TS, cy * TS, TS, TS);
  }
  // void with brick rims; wall faces where floor lies below
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (!isV(cx, cy)) continue;
    const below = !isV(cx, cy + 1), above = !isV(cx, cy - 1), left = !isV(cx - 1, cy), right = !isV(cx + 1, cy);
    if (below) {
      const l = isV(cx - 1, cy) && !isV(cx - 1, cy + 1), r = isV(cx + 1, cy) && !isV(cx + 1, cy + 1);
      x.drawImage(d, !l ? 16 : !r ? 48 : 32, 80, 16, 16, cx * TS, cy * TS, TS, TS);
    } else if (above || left || right) {
      const sx = left && !right ? 96 : right && !left ? 64 : 80;
      const sy = above ? 64 : 48;
      x.drawImage(d, sx, sy, 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // doors where corridors meet rooms (cells on a room edge with a void cell either side)
  for (const p of field.posts) {
    const rw = p.main ? 5 : 3;
    for (const side of [-1, 1]) {
      const cx = Math.floor(p.x) + side * (rw + 1), cy = Math.floor(p.y);
      if (cx > 0 && cx < W - 1 && !isV(cx, cy) && isV(cx, cy - 1)) x.drawImage(d, 128, 48, 16, 16, cx * TS, (cy - 1) * TS, TS, TS);
    }
  }
  for (const pr of G.props) x.drawImage(d, pr.sx, pr.sy, 16, 16, pr.x * TS, pr.y * TS, TS, TS);
  for (const dc of G.decor) x.drawImage(d, 192, 64, 16, 16, dc.x * TS, dc.y * TS, TS, TS);
  return c;
}

// animated decor + event visuals (blocked routes). Call after the ground, before units.
export function drawFieldOverlay(ctx, field, time) {
  const G = field._grid; if (!G) return;
  const d = img(DUNGEON_TILES);
  for (const a of G.anim) {
    const px = a.x * TS, py = a.y * TS;
    if (a.k === 'brazier') { if (d) ctx.drawImage(d, 192 + (Math.floor(time * 6 + a.x) % 4) * 16, 96, 16, 16, px, py, 16, 16); }
    else drawLandmark(ctx, a.k, px, py, time, a.x + a.y);
  }
  // siege gates (drawn here so they sit above roads)
  const gates = img(GATES);
  if (gates) for (const g of G.gates) {
    if (g.vertical) ctx.drawImage(gates, 16, 208, 32, 48, g.x * TS - 8, g.y * TS - 24, 32, 48);
    else ctx.drawImage(gates, field.blocked.includes(g.edge) ? 0 : 48, 16, 16, 48, g.x * TS, g.y * TS - 28, 16, 48);
  }
  // blocked routes
  const tiles = img(BIOMES[field.biome] ? BIOMES[field.biome].src : BIOMES.grass.src);
  const trees = img(TREES);
  for (const ei of field.blocked || []) {
    const e = field.edges[ei]; if (!e) continue;
    const A = field.posts[e[0]], B = field.posts[e[1]];
    const spot = (field.eventSpots || []).find((s) => s.edge === ei);
    const kind = spot ? spot.kind : 'landslide';
    const mx = (A.x + B.x) / 2 * TS, my = (A.y + B.y) / 2 * TS;
    const ang = Math.atan2(B.y - A.y, B.x - A.x);
    const ox = -Math.sin(ang), oy = Math.cos(ang);
    for (let k = -2; k <= 2; k++) {
      const px = Math.round(mx + ox * k * 9), py = Math.round(my + oy * k * 9);
      if (kind === 'flood') {
        ctx.fillStyle = '#242234'; ctx.fillRect(px - 11, py - 8, 22, 16);
        ctx.fillStyle = '#285cc4'; ctx.fillRect(px - 10, py - 7, 20, 14);
        ctx.fillStyle = '#249fde'; ctx.fillRect(px - 10, py - 5, 20, 9);
        ctx.fillStyle = '#a6fcdb';
        for (let w = 0; w < 3; w++) ctx.fillRect(px - 9 + ((time * 10 + k * 5 + w * 7) % 16), py - 5 + w * 4, 4, 1);
        if (k === 0 && tiles) ctx.drawImage(tiles, 128, 0, 16, 16, px - 8 + Math.sin(time * 2) * 3, py - 8, 16, 16);
      } else if (kind === 'fire') {
        drawLandmark(ctx, 'campfire', px - 8, py - 10, time * 1.6, k + 2);
        ctx.fillStyle = 'rgba(40,30,30,.35)'; ctx.fillRect(px - 9, py + 4, 18, 3);
      } else if (kind === 'collapse') {
        if (d) ctx.drawImage(d, 192 + ((k + 2) % 2) * 16, 64, 16, 16, px - 8, py - 8, 16, 16);
        ctx.fillStyle = '#2a2430'; ctx.fillRect(px - 7, py + 2, 14, 5);
      } else {
        if (trees) ctx.drawImage(trees, (BIOMES[field.biome] || BIOMES.grass).mtn + 16, 336, 16, 16, px - 8, py - 12, 16, 16);
        if (tiles) ctx.drawImage(tiles, 64 + ((k + 2) % 2) * 16, 0, 16, 16, px - 8 + 5, py - 2, 16, 16);
      }
    }
  }
}

// post sprites
export function postRef(post, defFid, attFid) {
  if (post.main) return FACTIONS[defFid].town(post.owner === 'att' ? 4 : 2);
  if (post.camp) return ['assets/has2020/Buildings/2x2/Animated/MercenaryCamp(Frame 1).png', 0, 0, 32, 32];
  const fid = post.owner === 'att' ? attFid : defFid;
  return FACTIONS[fid].dwelling(post.id % 7);
}
export { drawSpriteRef };
