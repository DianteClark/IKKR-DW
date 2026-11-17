// Battle "juice": pixel particles, damage numbers, shockwaves and screen shake.
// All coordinates are world pixels (16 px per tile). Draw with the camera transform applied.
const MAX = 700;

export function createFx() {
  const P = [];       // particles
  const T = [];       // floating texts
  const W = [];       // shockwave rings
  let shakeT = 0, shakeDur = 0, shakeI = 0, sx = 0, sy = 0;

  const add = (p) => { if (P.length >= MAX) P.shift(); P.push(p); };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.ang != null ? o.ang + rnd(-o.spread, o.spread) : Math.random() * Math.PI * 2;
      const sp = rnd(o.spMin ?? 20, o.spMax ?? 60);
      add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (o.vy || 0), g: o.g ?? 90, life: rnd(o.lMin ?? 0.25, o.lMax ?? 0.5), age: 0, size: o.size ?? 1, color: Array.isArray(o.color) ? o.color[i % o.color.length] : o.color, drag: o.drag ?? 2, fade: o.fade ?? true, grow: o.grow || 0 });
    }
  }

  return {
    hit(x, y, color = '#ffffff') {
      burst(x, y - 4, 5, { color: [color, '#ffffff'], spMin: 25, spMax: 60, lMin: 0.12, lMax: 0.28, g: 120 });
    },
    damage(x, y, amount, color = '#ffe0a0') {
      if (T.length > 60) T.shift();
      T.push({ x: x + rnd(-3, 3), y: y - 10, vy: -26, age: 0, life: 0.8, text: String(Math.round(amount)), color, size: amount >= 20 ? 9 : 7 });
    },
    dust(x, y) {
      burst(x, y, 4, { color: ['#c9a87a', '#9c7e58', '#e2cfa8'], spMin: 6, spMax: 18, lMin: 0.3, lMax: 0.6, g: -6, drag: 3, size: 2, grow: 2 });
    },
    sparks(x, y, color = '#ffd86b') {
      burst(x, y - 4, 9, { color: [color, '#fff6d0', '#ff9a3a'], spMin: 40, spMax: 110, lMin: 0.18, lMax: 0.4, g: 160 });
    },
    shockwave(x, y, color = '#ffffff') {
      if (W.length > 20) W.shift();
      W.push({ x, y, age: 0, life: 0.55, color, r: 4, max: 34 });
    },
    fire(x, y) {
      burst(x, y, 6, { color: ['#ffef8a', '#ffb43a', '#ff5a2a', '#c8301e'], ang: -Math.PI / 2, spread: 0.6, spMin: 14, spMax: 38, lMin: 0.3, lMax: 0.7, g: -40, drag: 1.5, size: 2 });
    },
    smoke(x, y) {
      burst(x, y, 4, { color: ['#5a5466', '#77708a', '#3e3a48'], ang: -Math.PI / 2, spread: 0.5, spMin: 6, spMax: 16, lMin: 0.8, lMax: 1.4, g: -12, drag: 1, size: 2, grow: 3 });
    },
    confetti(x, y) {
      burst(x, y, 40, { color: ['#ffd86b', '#8ee06b', '#6fb7ff', '#ff6f5e', '#b58bff', '#ffffff'], ang: -Math.PI / 2, spread: 1.2, spMin: 50, spMax: 130, lMin: 0.9, lMax: 1.6, g: 110, drag: 1.2, size: 2 });
    },
    floatText(x, y, text, color = '#ffd86b') {
      if (T.length > 60) T.shift();
      T.push({ x, y: y - 14, vy: -18, age: 0, life: 1.3, text, color, size: 8, bold: true });
    },
    shake(intensity = 3, dur = 0.25) {
      if (intensity >= shakeI * (1 - shakeT / Math.max(0.001, shakeDur))) { shakeI = intensity; shakeDur = dur; shakeT = 0; }
    },
    update(dt) {
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.age += dt;
        if (p.age >= p.life) { P.splice(i, 1); continue; }
        p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt;
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; t.age += dt; t.y += t.vy * dt; t.vy *= 1 - 2.5 * dt; if (t.age >= t.life) T.splice(i, 1); }
      for (let i = W.length - 1; i >= 0; i--) { const w = W[i]; w.age += dt; if (w.age >= w.life) W.splice(i, 1); }
      if (shakeDur > 0) {
        shakeT += dt;
        const k = Math.max(0, 1 - shakeT / shakeDur);
        sx = (Math.random() * 2 - 1) * shakeI * k; sy = (Math.random() * 2 - 1) * shakeI * k;
        if (k <= 0) { shakeDur = 0; shakeI = 0; sx = sy = 0; }
      }
    },
    draw(ctx) {
      for (const w of W) {
        const k = w.age / w.life;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = w.color; ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.ellipse(w.x, w.y, w.r + (w.max - w.r) * k, (w.r + (w.max - w.r) * k) * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (const p of P) {
        const k = p.age / p.life;
        ctx.globalAlpha = p.fade ? Math.min(1, (1 - k) * 1.6) : 1;
        ctx.fillStyle = p.color;
        const s = p.size + p.grow * k;
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.max(1, Math.round(s)), Math.max(1, Math.round(s)));
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of T) {
        const k = t.age / t.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const pop = k < 0.12 ? 1 + (0.12 - k) * 5 : 1;
        ctx.font = `${t.bold ? 700 : 600} ${Math.round(t.size * pop)}px Pixelify, monospace`;
        const x = Math.round(t.x), y = Math.round(t.y);
        ctx.fillStyle = '#0b0a10';
        ctx.fillText(t.text, x + 1, y + 1); ctx.fillText(t.text, x - 1, y + 1); ctx.fillText(t.text, x, y + 2);
        ctx.fillStyle = t.color; ctx.fillText(t.text, x, y);
      }
      ctx.globalAlpha = 1;
    },
    offset() { return { x: sx, y: sy }; },
    count() { return P.length + T.length + W.length; },
  };
}
