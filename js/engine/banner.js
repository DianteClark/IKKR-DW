// Kingdom banners: a field colour, a pattern, and an emblem — drawn as crisp pixel art, cached per design.
// Players design theirs in the Banner maker; every computer realm gets a generated one.
export const BANNER_COLORS = ['#c0392b', '#e8443a', '#f08a2a', '#f5c630', '#3fbf5a', '#1e7a4a', '#2ec4b6', '#3a7bf0', '#24358f', '#7b4ce0', '#b04ce0', '#e85aa8', '#f4ecd8', '#8a8a96', '#2a2236', '#6b3b1f'];
export const PATTERNS = ['plain', 'pale', 'fess', 'chevron', 'quarters', 'saltire', 'bend', 'border', 'chief', 'cross'];
export const PATTERN_NAMES = { plain: 'Plain', pale: 'Pale', fess: 'Band', chevron: 'Chevron', quarters: 'Quarters', saltire: 'Saltire', bend: 'Bend', border: 'Border', chief: 'Chief', cross: 'Cross' };
// 7x7 emblems ('#' = ink)
const E = {
  none: [],
  crown: ['.......', '#.#.#.#', '#######', '#.###.#', '#######', '#######', '.......'],
  sword: ['...#...', '...#...', '...#...', '...#...', '.#####.', '...#...', '...#...'],
  tower: ['#.#.#.#', '#######', '.#####.', '.##.##.', '.#####.', '.##.##.', '.#####.'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  skull: ['.#####.', '#######', '#..#..#', '#######', '.##.##.', '.#####.', '.#.#.#.'],
  tree: ['...#...', '..###..', '.#####.', '..###..', '.#####.', '#######', '...#...'],
  sun: ['#..#..#', '.#####.', '.#####.', '#######', '.#####.', '.#####.', '#..#..#'],
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  axe: ['.##.#..', '####...', '####...', '.##.#..', '....#..', '....#..', '....#..'],
  shield: ['#######', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  wolf: ['#.....#', '##...##', '#######', '#.###.#', '#######', '.#####.', '..#.#..'],
  dragon: ['##...##', '.##.##.', '..###..', '#######', '..###..', '.#.#.#.', '#.....#'],
  key: ['.###...', '#...#..', '.###...', '..#....', '..##...', '..#....', '..##...'],
  flame: ['...#...', '..##...', '..###..', '.####..', '.#####.', '#######', '.#####.'],
  rose: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...', '..##...'],
};
export const EMBLEMS = Object.keys(E);
export const EMBLEM_NAMES = { none: 'None', crown: 'Crown', sword: 'Sword', tower: 'Tower', star: 'Star', skull: 'Skull', tree: 'Tree', sun: 'Sun', moon: 'Moon', axe: 'Axe', shield: 'Shield', wolf: 'Wolf', dragon: 'Dragon', key: 'Key', flame: 'Flame', rose: 'Rose' };

const FW = 11, FH = 14; // cloth size in banner pixels
export const BANNER_W = FW + 2, BANNER_H = FH + 6;

export function randomBanner(rng, color) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const bg = color || pick(BANNER_COLORS);
  let fg = pick(BANNER_COLORS); if (fg === bg) fg = bg === '#f4ecd8' ? '#2a2236' : '#f4ecd8';
  let ec = pick(['#f5c630', '#f4ecd8', '#2a2236']); if (ec === bg) ec = '#f4ecd8';
  return { bg, fg, ec, pattern: pick(PATTERNS), emblem: pick(EMBLEMS.slice(1)) };
}
export function bannerKey(b) { return b ? `${b.bg}|${b.fg}|${b.ec}|${b.pattern}|${b.emblem}` : 'none'; }

function inPattern(p, x, y) {
  const w = FW, h = FH;
  switch (p) {
    case 'pale': return x >= 4 && x <= 6;
    case 'fess': return y >= 5 && y <= 8;
    case 'chevron': return Math.abs(x - 5) + 9 - y >= 0 && Math.abs(x - 5) + 9 - y <= 2;
    case 'quarters': return (x < 5.5) !== (y < 7);
    case 'saltire': return Math.abs(x * (h / w) - y) < 1.4 || Math.abs((w - 1 - x) * (h / w) - y) < 1.4;
    case 'bend': return Math.abs(x * (h / w) - y) < 2;
    case 'border': return x === 0 || x === w - 1 || y === 0 || y === h - 4 || (y > h - 4 && Math.abs(x - 5) > 7 - (h - y));
    case 'chief': return y < 4;
    case 'cross': return x === 5 || y === 6;
    default: return false;
  }
}

// one frame of a banner as a small canvas (wave 0/1 bends the cloth by a pixel)
const cache = new Map();
export function bannerCanvas(b, wave = 0) {
  const key = bannerKey(b) + '#' + wave;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = BANNER_W; c.height = BANNER_H;
  const x = c.getContext('2d');
  // pole + finial
  x.fillStyle = '#2a1d14'; x.fillRect(0, 1, 1, BANNER_H - 1);
  x.fillStyle = '#f5c630'; x.fillRect(0, 0, 1, 1);
  // cloth with a swallow-tail bottom, outlined
  for (let yy = 0; yy < FH; yy++) for (let xx = 0; xx < FW; xx++) {
    const tail = yy >= FH - 3 && Math.abs(xx - 5) < (yy - (FH - 4)) * 1.6; // notch
    if (tail) continue;
    const edge = xx === 0 || xx === FW - 1 || yy === 0 || yy === FH - 1 || (yy >= FH - 4 && Math.abs(xx - 5) < (yy - (FH - 5)) * 1.6);
    const off = wave && xx > 5 ? 1 : 0;
    x.fillStyle = edge ? '#1a1420' : inPattern(b.pattern, xx, yy) ? b.fg : b.bg;
    x.fillRect(1 + xx, 1 + yy + off, 1, 1);
  }
  // emblem centred on the cloth
  const em = E[b.emblem] || [];
  for (let yy = 0; yy < em.length; yy++) for (let xx = 0; xx < 7; xx++) if (em[yy][xx] === '#') {
    const off = wave && xx + 2 > 5 ? 1 : 0;
    x.fillStyle = b.ec; x.fillRect(1 + 2 + xx, 1 + 3 + yy + off, 1, 1);
  }
  cache.set(key, c);
  return c;
}

// draw on the map: (x, y) is the foot of the pole, in world px; scale in world px per banner px
export function drawBanner(ctx, b, x, y, time = 0, seed = 0, scale = 1) {
  if (!b) return;
  const wave = Math.floor(time * 3 + seed) % 2;
  const c = bannerCanvas(b, wave);
  ctx.drawImage(c, Math.round(x), Math.round(y - BANNER_H * scale), BANNER_W * scale, BANNER_H * scale);
}

// a crisp DOM preview for menus
export function bannerEl(b, scale = 4) {
  const c = document.createElement('canvas');
  const px = Math.max(1, Math.ceil(scale)) * 2; // draw sharp, display at the requested size
  c.width = BANNER_W * px; c.height = BANNER_H * px;
  c.style.width = Math.round(BANNER_W * scale) + 'px'; c.style.height = Math.round(BANNER_H * scale) + 'px'; c.style.imageRendering = 'pixelated';
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(bannerCanvas(b, 0), 0, 0, c.width, c.height);
  return c;
}

// the player's saved design (device profile)
const KEY = 'ikkr-dw-banner';
export function loadMyBanner() { try { const b = JSON.parse(localStorage.getItem(KEY)); if (b && b.bg) return b; } catch {} return null; }
export function saveMyBanner(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} }
