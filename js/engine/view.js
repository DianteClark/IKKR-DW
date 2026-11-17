// Canvas, camera and touch gestures (pan, pinch, tap).
export const canvas = document.getElementById('view');
export const ctx = canvas.getContext('2d', { alpha: false });

export const screen = { w: 0, h: 0, dpr: 1 };

export function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  screen.dpr = dpr;
  // the canvas's own CSS box is the truth (innerWidth/innerHeight lag behind on iOS rotation and URL-bar changes,
  // which made the pixel buffer and the displayed size disagree and stretched the art)
  const r = canvas.getBoundingClientRect();
  screen.w = Math.max(1, Math.round(r.width || window.innerWidth));
  screen.h = Math.max(1, Math.round(r.height || window.innerHeight));
  canvas.width = Math.round(screen.w * dpr);
  canvas.height = Math.round(screen.h * dpr);
  ctx.imageSmoothingEnabled = false;
}

// true when the drawing buffer no longer matches what is on screen
export function sizeChanged() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return Math.round(r.width) !== screen.w || Math.round(r.height) !== screen.h || dpr !== screen.dpr;
}

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 2; this.min = 0.5; this.max = 6; this.bounds = null; }
  // device pixels per world pixel
  get scale() { return this.zoom * screen.dpr; }
  apply() {
    const s = this.scale;
    const tx = Math.round(canvas.width / 2 - this.x * s);
    const ty = Math.round(canvas.height / 2 - this.y * s);
    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.imageSmoothingEnabled = false;
  }
  toWorld(sx, sy) {
    const s = this.zoom;
    return { x: (sx - screen.w / 2) / s + this.x, y: (sy - screen.h / 2) / s + this.y };
  }
  toScreen(wx, wy) {
    const s = this.zoom;
    return { x: (wx - this.x) * s + screen.w / 2, y: (wy - this.y) * s + screen.h / 2 };
  }
  clamp() {
    if (!this.bounds) return;
    const b = this.bounds;
    const hw = screen.w / 2 / this.zoom, hh = screen.h / 2 / this.zoom;
    const minX = b.x + Math.min(hw, (b.w) / 2), maxX = b.x + b.w - Math.min(hw, b.w / 2);
    const minY = b.y + Math.min(hh, (b.h) / 2), maxY = b.y + b.h - Math.min(hh, b.h / 2);
    this.x = Math.max(minX - (b.pad || 0), Math.min(maxX + (b.pad || 0), this.x));
    this.y = Math.max(minY - (b.pad || 0), Math.min(maxY + (b.pad || 0), this.y));
  }
  // zoom so the whole box fits, snapped so device pixels per world pixel is a whole number when possible
  fit(w, h, margin = 0) {
    const z = Math.min(screen.w / (w + margin), screen.h / (h + margin));
    const s = z * screen.dpr;
    const snapped = s >= 1 ? Math.floor(s) / screen.dpr : z;
    this.zoom = Math.max(this.min, snapped);
    return this.zoom;
  }
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.min, Math.min(this.max, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }
  snapZoom() {
    const s = this.zoom * screen.dpr;
    if (s >= 1) this.zoom = Math.max(this.min, Math.round(s) / screen.dpr);
  }
}

// Gesture handling. handler: { onTap(x,y), onPanStart?, onPan?(dx,dy), onPinch?(cx,cy,f), onGestureEnd? }
export function attachGestures(el, getHandler) {
  const pts = new Map();
  let moved = false, downAt = 0, startX = 0, startY = 0, pinchD = 0, lastMid = null;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = false; downAt = performance.now(); startX = e.clientX; startY = e.clientY; }
    if (pts.size === 2) { pinchD = dist(); lastMid = mid(); moved = true; }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const h = getHandler();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 14) { moved = true; h && h.onPanStart && h.onPanStart(startX, startY); }
      if (moved && h && h.onPan) h.onPan(dx, dy, e.clientX, e.clientY);
    } else if (pts.size === 2) {
      const d = dist(), m = mid();
      if (h && h.onPinch && pinchD > 0) h.onPinch(m.x, m.y, d / pinchD, m.x - lastMid.x, m.y - lastMid.y);
      pinchD = d; lastMid = m;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const h = getHandler();
    if (pts.size === 0) {
      // generous taps: finger jitter under 14px and presses up to 1.5s still count; a cancelled touch never taps
      if (!moved && e.type !== 'pointercancel' && performance.now() - downAt < 1500 && h && h.onTap) h.onTap(e.clientX, e.clientY);
      if (moved && h && h.onGestureEnd) h.onGestureEnd(e.clientX, e.clientY);
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); const h = getHandler(); h && h.onPinch && h.onPinch(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9, 0, 0); h && h.onGestureEnd && h.onGestureEnd(); }, { passive: false });
}
