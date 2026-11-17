// Battlefield generation: ground, posts (bases) and the paths between them. Deterministic from a seed.
import { makeRng, makeNoise } from '../engine/rng.js';
import { img } from '../engine/assets.js';
import { BIOMES, TILE, TREES, DUNGEON_TILES, FACTIONS, drawSpriteRef } from '../data/art.js';

export const BW = 48, BH = 26, TS = 16;
const UNDERGROUND = new Set(['dungeon', 'cave']);

export function makeField(seed, biome, nOutposts = 5) {
  const rng = makeRng(seed);
  const posts = [];
  const cy = BH / 2;
  posts.push({ id: 0, x: 3.5, y: cy + rng.int(-4, 4), owner: 'att', camp: true });
  posts.push({ id: 1, x: BW - 5, y: cy + rng.int(-3, 3), owner: 'def', main: true });
  // outposts spread across the middle, no two too close
  let tries = 0;
  while (posts.length < nOutposts + 2 && tries++ < 400) {
    const x = rng.int(11, BW - 12) + 0.5, y = rng.int(3, BH - 4) + 0.5;
    if (posts.every((p) => Math.hypot(p.x - x, p.y - y) > 8)) posts.push({ id: posts.length, x, y, owner: x < BW * 0.35 ? 'neutral' : 'def' });
  }
  for (const p of posts) { p.prog = 0; p.by = null; }
  // edges: minimum spanning tree + a few extra short links
  const edges = [];
  const inTree = new Set([0]);
  while (inTree.size < posts.length) {
    let best = null;
    for (const a of inTree) for (const b of posts) {
      if (inTree.has(b.id)) continue;
      const d = Math.hypot(posts[a].x - b.x, posts[a].y - b.y);
      if (!best || d < best[2]) best = [a, b.id, d];
    }
    edges.push([best[0], best[1]]); inTree.add(best[1]);
  }
  for (const p of posts) {
    const near = posts.filter((q) => q.id !== p.id).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 2);
    for (const q of near) if (!edges.some(([a, b]) => (a === p.id && b === q.id) || (a === q.id && b === p.id)) && Math.hypot(q.x - p.x, q.y - p.y) < 17) edges.push([p.id, q.id]);
  }
  // traps (dungeon/caves only): spike patches on some paths
  const traps = [];
  if (UNDERGROUND.has(biome)) {
    for (const [a, b] of edges) if (rng.chance(0.5)) {
      const t = 0.35 + rng() * 0.3, A = posts[a], B = posts[b];
      traps.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, kind: rng.pick(['spikes', 'axe', 'fire']) });
    }
  }
  return { seed, biome, posts, edges, traps, underground: UNDERGROUND.has(biome) };
}

export function shortestPath(field, from, to) {
  const n = field.posts.length, d = new Array(n).fill(1e9), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  d[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || d[u] >= 1e9) break;
    done[u] = true;
    for (const [a, b] of field.edges) {
      const v = a === u ? b : b === u ? a : -1; if (v < 0) continue;
      const w = Math.hypot(field.posts[u].x - field.posts[v].x, field.posts[u].y - field.posts[v].y);
      if (d[u] + w < d[v]) { d[v] = d[u] + w; prev[v] = u; }
    }
  }
  const path = [];
  for (let v = to; v >= 0; v = prev[v]) path.unshift(v);
  return path[0] === from ? path : [from, to];
}

export function nearestPost(field, x, y) {
  let best = 0, bd = 1e9;
  for (const p of field.posts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.id; } }
  return best;
}

// ---------- ground rendering ----------
export function renderGround(field) {
  const c = document.createElement('canvas');
  c.width = BW * TS; c.height = BH * TS;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const rng = makeRng(field.seed ^ 0x77);
  const noise = makeNoise(field.seed ^ 0x99);
  if (field.underground) {
    const d = img(DUNGEON_TILES);
    const floors = [[64, 0], [80, 0], [64, 16], [80, 16], [16, 16], [32, 16], [48, 16], [192 - 128, 144]];
    for (let cy = 0; cy < BH; cy++) for (let cx = 0; cx < BW; cx++) {
      const f = floors[Math.floor(rng() * 6)];
      if (d) x.drawImage(d, f[0], f[1], 16, 16, cx * TS, cy * TS, TS, TS);
    }
    // rubble walls along the edges and pillars
    for (let cx = 0; cx < BW; cx++) { if (d) { x.drawImage(d, 32, 80, 16, 16, cx * TS, 0, TS, TS); x.drawImage(d, 32, 80, 16, 16, cx * TS, (BH - 1) * TS, TS, TS); } }
    // decor: barrels, crates, braziers away from paths
    for (let i = 0; i < 26; i++) {
      const px = rng.int(1, BW - 2), py = rng.int(1, BH - 2);
      if (nearPath(field, px + 0.5, py + 0.5, 2.2)) continue;
      const deco = rng.pick([[240, 0], [224, 0], [192, 64], [208, 64], [240, 16], [192, 48]]);
      if (d) x.drawImage(d, deco[0], deco[1], 16, 16, px * TS, py * TS, TS, TS);
    }
  } else {
    const B = BIOMES[field.biome] || BIOMES.grass;
    const t = img(B.src), trees = img(TREES);
    for (let cy = 0; cy < BH; cy++) for (let cx = 0; cx < BW; cx++) {
      const f = TILE.textured[Math.floor(rng() * TILE.textured.length)];
      if (t) x.drawImage(t, f[0], f[1], 16, 16, cx * TS, cy * TS, TS, TS);
    }
    for (let i = 0; i < 60; i++) {
      const px = rng.int(0, BW - 1), py = rng.int(0, BH - 1);
      const dd = TILE.decor[Math.floor(rng() * TILE.decor.length)];
      if (t) x.drawImage(t, dd[0], dd[1], 16, 16, px * TS, py * TS, TS, TS);
    }
    // tree / rock clumps away from paths (blob tiles)
    const feat = new Uint8Array(BW * BH);
    for (let cy = 0; cy < BH; cy++) for (let cx = 0; cx < BW; cx++) {
      if (nearPath(field, cx + 0.5, cy + 0.5, 3.2)) continue;
      const n = noise(cx / 5, cy / 5, 2);
      if (n > 0.6) feat[cy * BW + cx] = 1; else if (n < 0.24) feat[cy * BW + cx] = 2;
    }
    const has = (cx, cy, f) => cx >= 0 && cy >= 0 && cx < BW && cy < BH && feat[cy * BW + cx] === f;
    for (let cy = 0; cy < BH; cy++) for (let cx = 0; cx < BW; cx++) {
      const f = feat[cy * BW + cx]; if (!f || !trees) continue;
      const base = f === 1 ? B.tree : [B.mtn, 336];
      if (!base) continue;
      const col = !has(cx - 1, cy, f) ? 0 : !has(cx + 1, cy, f) ? 2 : 1, row = !has(cx, cy - 1, f) ? 0 : !has(cx, cy + 1, f) ? 2 : 1;
      x.drawImage(trees, base[0] + 16 + col * 16, base[1] + row * 16, 16, 16, cx * TS, cy * TS, TS, TS);
    }
  }
  // dirt roads between posts
  for (const [a, b] of field.edges) {
    const A = field.posts[a], B2 = field.posts[b];
    const n = Math.ceil(Math.hypot(B2.x - A.x, B2.y - A.y) * 4);
    for (let i = 0; i <= n; i++) {
      const px = (A.x + (B2.x - A.x) * i / n) * TS, py = (A.y + (B2.y - A.y) * i / n) * TS;
      x.fillStyle = field.underground ? 'rgba(20,18,26,.35)' : 'rgba(110,78,44,.55)';
      x.fillRect(Math.round(px - 5), Math.round(py - 4), 10, 8);
    }
  }
  return c;
}

function nearPath(field, x, y, r) {
  for (const p of field.posts) if (Math.hypot(p.x - x, p.y - y) < r + 1.5) return true;
  for (const [a, b] of field.edges) {
    const A = field.posts[a], B = field.posts[b];
    const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / L));
    if (Math.hypot(A.x + dx * t - x, A.y + dy * t - y) < r) return true;
  }
  return false;
}

// post sprites
export function postRef(post, defFid, attFid) {
  if (post.main) return FACTIONS[defFid].town(post.owner === 'att' ? 4 : 2);
  if (post.camp) return ['assets/has2020/Buildings/2x2/Animated/MercenaryCamp(Frame 1).png', 0, 0, 32, 32];
  const fid = post.owner === 'att' ? attFid : defFid;
  return FACTIONS[fid].dwelling(post.id % 7);
}
export { drawSpriteRef };
