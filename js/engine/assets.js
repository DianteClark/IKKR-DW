// Image loading + cached recolors. All art paths are repo-relative.
const cache = new Map();
const tintCache = new Map();

export function url(src) { return encodeURI(src); }

export function loadImage(src) {
  if (cache.has(src)) return cache.get(src).promise;
  const img = new Image();
  const entry = { img, ok: false };
  entry.promise = new Promise((res) => {
    img.onload = () => { entry.ok = true; res(img); };
    img.onerror = () => { console.warn('missing image', src); res(img); };
  });
  img.src = url(src);
  cache.set(src, entry);
  return entry.promise;
}

export function img(src) {
  const e = cache.get(src);
  if (!e) { loadImage(src); return null; }
  return e.ok ? e.img : null;
}

export async function loadAll(list, onProgress) {
  let done = 0;
  await Promise.all(list.map((s) => loadImage(s).then(() => { done++; onProgress && onProgress(done / list.length); })));
}

// Returns a canvas copy of an image passed through a per-pixel color function.
export function recolor(src, key, fn) {
  const k = src + '|' + key;
  if (tintCache.has(k)) return tintCache.get(k);
  const base = img(src);
  if (!base) return null;
  const c = document.createElement('canvas');
  c.width = base.width; c.height = base.height;
  const x = c.getContext('2d');
  x.drawImage(base, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const o = fn(p[i], p[i + 1], p[i + 2]);
    p[i] = o[0]; p[i + 1] = o[1]; p[i + 2] = o[2];
  }
  x.putImageData(d, 0, 0);
  tintCache.set(k, c);
  return c;
}

// Elite recolor: warm, brighter, used for stage-2 units that have no drawn upgrade.
export function eliteTint(r, g, b) {
  return [Math.min(255, r * 1.15 + 30), Math.min(255, g * 0.95 + 10), Math.max(0, b * 0.7)];
}
