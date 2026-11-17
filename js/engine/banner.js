// Kingdom banners: field colour, pattern, cloth shape, trim and an emblem taken from the HAS item art.
// Drawn as pixel art with folds, shading and a waving cloth (4 cached frames per design).
// Players design theirs in the Banner maker; every computer realm gets a generated one.
import { img } from './assets.js';

const ITEMS = 'assets/has2020/Items/AllItems.png';

export const BANNER_COLORS = [
  '#9b1c1c', '#d63a2f', '#f07a2a', '#e8b23a', '#f5d860', '#7a4a1f',
  '#2f7d32', '#57b84a', '#1f6e66', '#2ec4b6', '#1d3f8f', '#3a7bf0',
  '#5a2d91', '#9b4ce0', '#c2417f', '#f08ab0', '#f4ecd8', '#c9c2b0',
  '#8a8a96', '#3b3a4a', '#1a1420', '#4a2a18', '#b88a3a', '#6b8fb8',
];
export const TRIMS = { gold: ['#f5d860', '#a8742a'], silver: ['#e8eef4', '#8a96a8'], bronze: ['#d89058', '#7a4422'], none: null };
export const TRIM_NAMES = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', none: 'None' };
export const SHAPES = ['swallow', 'point', 'straight', 'tongues', 'round'];
export const SHAPE_NAMES = { swallow: 'Swallowtail', point: 'Pointed', straight: 'Fringed', tongues: 'Three tails', round: 'Rounded' };
export const PATTERNS = ['plain', 'pale', 'fess', 'chevron', 'quarters', 'saltire', 'bend', 'chief', 'cross', 'bordure', 'paly', 'checky', 'lozenge', 'per pale', 'per fess', 'gyronny'];
export const PATTERN_NAMES = { plain: 'Plain', pale: 'Pale', fess: 'Band', chevron: 'Chevron', quarters: 'Quarters', saltire: 'Saltire', bend: 'Bend', chief: 'Chief', cross: 'Cross', bordure: 'Border', paly: 'Stripes', checky: 'Checks', lozenge: 'Diamond', 'per pale': 'Halves', 'per fess': 'Top & bottom', gyronny: 'Gyrons' };
// emblems: [col, row] of a 16x16 icon in AllItems.png (names kept compatible with older saves)
const ICON = {
  crown: [21, 59], sword: [22, 19], swords: [23, 58], axe: [22, 14], helm: [2, 19], shield: [22, 8], lion: [25, 9],
  skull: [27, 11], eagle: [25, 58], dove: [20, 57], angel: [20, 51], beast: [1, 24], bull: [0, 33], eye: [6, 32],
  sun: [2, 32], star: [28, 57], heart: [28, 51], clover: [28, 58], horseshoe: [5, 31], key: [37, 62], flame: [24, 9],
  gem: [3, 48], goblet: [5, 45], harp: [8, 40], horn: [26, 58], bow: [29, 29], potion: [9, 34], scales: [8, 48],
  book: [0, 44], feather: [1, 38], hourglass: [4, 33], medal: [6, 31],
};
// extra emblems earned through achievements (see js/game/legacy.js); every other option is always available
const EARNED = { royal: [24, 11], heartshield: [25, 11], orb: [26, 51], tree: [29, 9], coins: [21, 58], crossshield: [21, 9] };
Object.assign(ICON, EARNED);
let earnedNow = () => [];
export function setEarnedSource(fn) { earnedNow = fn; }
export function isUnlocked(emblem) { return !(emblem in EARNED) || earnedNow().includes(emblem); }
export const EARNED_EMBLEMS = Object.keys(EARNED);
const LEGACY = { tower: 'helm', tree: 'clover', moon: 'horseshoe', wolf: 'eagle', dragon: 'beast', rose: 'heart' };
export const EMBLEMS = ['none', ...Object.keys(ICON)];
export const EMBLEM_NAMES = Object.fromEntries(EMBLEMS.map((e) => [e, e === 'none' ? 'None' : e[0].toUpperCase() + e.slice(1)]));

// banner size in banner pixels: pole + cloth hanging from a crossbar
const CW = 24, CH = 34;
export const BANNER_W = CW + 4;
export const BANNER_H = CH + 9;
const OX = 2, OY = 3;

export function randomBanner(rng, color) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const bg = color || pick(BANNER_COLORS);
  let fg = pick(BANNER_COLORS); if (fg === bg) fg = bg === '#f4ecd8' ? '#1a1420' : '#f4ecd8';
  return { bg, fg, ec: pick(['#f5d860', '#f4ecd8', '#1a1420', '#e8b23a']), pattern: pick(PATTERNS), emblem: pick(EMBLEMS.slice(1).filter((e) => !(e in EARNED))), shape: pick(SHAPES), trim: pick(['gold', 'gold', 'silver', 'bronze']), style: 'tint' };
}
export function normalize(b) {
  if (!b) return null;
  const e = LEGACY[b.emblem] || b.emblem;
  return { bg: b.bg, fg: b.fg || '#f4ecd8', ec: b.ec || '#f5d860', pattern: PATTERNS.includes(b.pattern) ? b.pattern : (b.pattern === 'border' ? 'bordure' : 'plain'), emblem: EMBLEMS.includes(e) ? e : 'none', shape: SHAPES.includes(b.shape) ? b.shape : 'swallow', trim: TRIMS[b.trim] !== undefined ? b.trim : 'gold', style: b.style === 'full' ? 'full' : 'tint' };
}
export function bannerKey(b) { return b ? `${b.bg}|${b.fg}|${b.ec}|${b.pattern}|${b.emblem}|${b.shape}|${b.trim}|${b.style}` : 'none'; }

// ---- colour helpers ----
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (c, f) => (f >= 1 ? c.map((v) => Math.min(255, Math.round(v + (255 - v) * (f - 1)))) : c.map((v) => Math.round(v * f)));
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function inPattern(p, u, v) {
  switch (p) {
    case 'pale': return u > 0.36 && u < 0.64;
    case 'fess': return v > 0.38 && v < 0.6;
    case 'chevron': { const y = 0.95 - Math.abs(u - 0.5) * 1.1; return v > y - 0.2 && v < y; }
    case 'quarters': return (u < 0.5) !== (v < 0.5);
    case 'saltire': return Math.abs(u - v) < 0.09 || Math.abs(1 - u - v) < 0.09;
    case 'bend': return Math.abs(u - v) < 0.14;
    case 'chief': return v < 0.26;
    case 'cross': return Math.abs(u - 0.5) < 0.1 || Math.abs(v - 0.42) < 0.08;
    case 'bordure': return u < 0.16 || u > 0.84 || v < 0.12;
    case 'paly': return Math.floor(u * 6) % 2 === 1;
    case 'checky': return (Math.floor(u * 5) + Math.floor(v * 7)) % 2 === 1;
    case 'lozenge': return Math.abs(u - 0.5) * 1.5 + Math.abs(v - 0.45) < 0.38;
    case 'per pale': return u >= 0.5;
    case 'per fess': return v >= 0.5;
    case 'gyronny': { const a = Math.atan2(v - 0.5, u - 0.5); return Math.floor((a + Math.PI) / (Math.PI / 4)) % 2 === 1; }
    default: return false;
  }
}

// is there cloth at (x, y)? the bottom 6 rows form the tail
function clothAt(shape, x, y) {
  const body = CH - 6;
  if (y < body) return true;
  const t = y - body, mid = (CW - 1) / 2;
  switch (shape) {
    case 'point': return Math.abs(x - mid) <= mid - t * (mid / 6);
    case 'straight': return t < 2;
    case 'tongues': { const w = CW / 3, k = x - Math.floor(x / w) * w; return t < 1 || Math.abs(k - (w - 1) / 2) <= (w - 1) / 2 - t * 0.6; }
    case 'round': return Math.hypot((x - mid) / (mid + 0.5), t / 6) <= 1;
    default: return !(Math.abs(x - mid) < t * 1.7);
  }
}

// emblem pixels, tinted to one colour keeping the icon's own light and shade (or in full colour)
const iconCache = new Map();
function emblemPixels(b) {
  const key = b.emblem + '|' + b.ec + '|' + b.style;
  if (iconCache.has(key)) return iconCache.get(key);
  const im = img(ITEMS), pos = ICON[b.emblem];
  if (!im || !pos) return null;
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, pos[0] * 16, pos[1] * 16, 16, 16, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  const ec = rgb(b.ec);
  const out = [];
  for (let i = 0; i < 256; i++) {
    if (d[i * 4 + 3] < 128) continue;
    const r = d[i * 4], g = d[i * 4 + 1], bb = d[i * 4 + 2];
    let col;
    if (b.style === 'full') col = [r, g, bb];
    else { const lum = (r * 0.3 + g * 0.59 + bb * 0.11) / 255; col = lum < 0.16 ? shade(ec, 0.22) : shade(ec, 0.55 + lum * 0.75); }
    out.push([i % 16, (i / 16) | 0, col]);
  }
  iconCache.set(key, out);
  return out;
}

const cache = new Map();
export const FRAMES = 4;
export function bannerCanvas(b0, frame = 0) {
  const b = normalize(b0);
  const key = bannerKey(b) + '#' + frame;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = BANNER_W; c.height = BANNER_H;
  const x = c.getContext('2d');
  const bg = rgb(b.bg), fg = rgb(b.fg), trim = TRIMS[b.trim], ink = [26, 20, 32];
  const ph = (frame / FRAMES) * Math.PI * 2;
  // pole, finial and crossbar
  x.fillStyle = '#3a2618'; x.fillRect(0, 2, 1, BANNER_H - 2);
  x.fillStyle = '#7a5530'; x.fillRect(1, 2, 1, BANNER_H - 2);
  x.fillStyle = '#f5d860'; x.fillRect(0, 0, 2, 2); x.fillStyle = '#a8742a'; x.fillRect(1, 1, 1, 1);
  x.fillStyle = '#8a6238'; x.fillRect(1, OY - 2, CW + 3, 1);
  x.fillStyle = '#3a2618'; x.fillRect(1, OY - 1, CW + 3, 1);
  x.fillStyle = trim ? trim[0] : '#f5d860'; x.fillRect(CW + 3, OY - 2, 1, 2);
  const em = b.emblem !== 'none' ? emblemPixels(b) || [] : [];
  const eOX = Math.round((CW - 16) / 2), eOY = 7;
  const emMap = new Map(); for (const [ex, ey, col] of em) emMap.set((ey + eOY) * 64 + ex + eOX, col);
  const has = (xx, yy) => xx >= 0 && xx < CW && yy >= 0 && yy < CH && clothAt(b.shape, xx, yy);
  for (let xx = 0; xx < CW; xx++) {
    const dy = Math.round(Math.sin(xx * 0.32 - ph) * 1.1 * (xx / CW));
    // broad soft folds: light catches the cloth every ~10 px, quantised so the pixel art stays clean
    const fold = 1 + Math.round(Math.sin(xx * 0.33 - ph) * 2) * 0.045 - 0.04 * (xx / CW);
    for (let yy = 0; yy < CH; yy++) {
      if (!has(xx, yy)) continue;
      const edge = !has(xx - 1, yy) || !has(xx + 1, yy) || !has(xx, yy + 1);
      let col;
      if (edge) col = ink;
      else {
        const inner = !has(xx - 2, yy) || !has(xx + 2, yy) || !has(xx, yy + 2) || yy === 0;
        if (trim && inner && b.shape !== 'straight') col = shade(rgb(trim[0]), fold * (yy % 6 === 3 ? 0.8 : 1));
        else {
          const base = inPattern(b.pattern, xx / (CW - 1), yy / (CH - 7)) ? fg : bg;
          const e = emMap.get(yy * 64 + xx);
          col = e ? shade(e, 0.92 + (fold - 1) * 0.6) : shade(base, fold * (1.06 - (yy / CH) * 0.14));
        }
      }
      x.fillStyle = css(col); x.fillRect(OX + xx, OY + yy + dy, 1, 1);
    }
    if (b.shape === 'straight' && trim) { x.fillStyle = (xx % 2) ? trim[0] : trim[1]; x.fillRect(OX + xx, OY + CH - 4 + dy, 1, 1 + (xx % 2)); }
  }
  if (img(ITEMS) || b.emblem === 'none') cache.set(key, c);
  return c;
}

// map: (x, y) is the foot of the pole in world px
export function drawBanner(ctx, b, x, y, time = 0, seed = 0, scale = 0.5) {
  if (!b) return;
  const frame = Math.floor(time * 5 + seed) % FRAMES;
  const c = bannerCanvas(b, frame);
  const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round(x), Math.round(y - BANNER_H * scale), BANNER_W * scale, BANNER_H * scale);
  ctx.imageSmoothingEnabled = prev;
}

// a crisp DOM preview for menus (waving if asked)
export function bannerEl(b, scale = 4, animate = false) {
  const c = document.createElement('canvas');
  const px = Math.max(1, Math.ceil(scale));
  c.width = BANNER_W * px; c.height = BANNER_H * px;
  c.style.width = Math.round(BANNER_W * scale) + 'px'; c.style.height = Math.round(BANNER_H * scale) + 'px'; c.style.imageRendering = 'pixelated';
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  const paint = (f) => { x.clearRect(0, 0, c.width, c.height); x.drawImage(bannerCanvas(b, f), 0, 0, c.width, c.height); };
  paint(0);
  if (animate) { let f = 0; const id = setInterval(() => { if (!c.isConnected) { clearInterval(id); return; } f = (f + 1) % FRAMES; paint(f); }, 170); }
  return c;
}
export function emblemEl(b, emblem, scale = 2) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  c.style.width = 16 * scale + 'px'; c.style.height = 16 * scale + 'px'; c.style.imageRendering = 'pixelated';
  const x = c.getContext('2d');
  for (const [ex, ey, col] of emblemPixels({ ...normalize(b), emblem }) || []) { x.fillStyle = css(col); x.fillRect(ex, ey, 1, 1); }
  return c;
}

const KEY = 'ikkr-dw-banner';
export function loadMyBanner() { try { const b = JSON.parse(localStorage.getItem(KEY)); if (b && b.bg) return normalize(b); } catch {} return null; }
export function saveMyBanner(b) { try { localStorage.setItem(KEY, JSON.stringify(normalize(b))); } catch {} }
