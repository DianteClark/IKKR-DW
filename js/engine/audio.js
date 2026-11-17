// Procedural retro sound: every effect and music loop is synthesized with WebAudio (no files).
import { setClickHook } from './ui.js';

const KEY = 'ikkr-dw-muted';
let ctx = null, master = null, sfxBus = null, musicBus = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
let noiseBuf = null;
const last = new Map();
let voices = 0;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(comp);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.16; musicBus.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
document.addEventListener('pointerdown', unlock, { passive: true });
document.addEventListener('keydown', unlock);

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
}
export function isMuted() { return muted; }

// ---------- primitives ----------
function tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, at = 0, attack = 0.005, bus = sfxBus, vibrato = 0 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  if (vibrato) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = vibrato; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.02);
  voices++; o.onended = () => voices--;
}
function noise(dur, { vol = 0.3, freq = 1200, q = 0.8, type = 'bandpass', at = 0, slide = 0, bus = sfxBus } = {}) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  voices++; s.onended = () => voices--;
}
const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12); // semitones from C4
const arp = (notes, step, opts) => notes.forEach((n, i) => tone(N(n), opts.dur || step * 1.6, { ...opts, at: (opts.at || 0) + i * step }));

// ---------- effects ----------
const LIMIT = { hit: 0.06, death: 0.07, arrow: 0.09, clash: 0.12, march: 0.25, click: 0.03, coin: 0.05, fire: 0.2, spell: 0.15 };
const SFX = {
  click: () => tone(1320, 0.05, { type: 'square', vol: 0.12, slide: 0.7 }),
  open: () => { tone(520, 0.08, { vol: 0.14, slide: 1.5 }); tone(780, 0.1, { vol: 0.1, at: 0.05 }); },
  close: () => tone(660, 0.09, { vol: 0.12, slide: 0.55 }),
  coin: () => { tone(N(23), 0.06, { vol: 0.16 }); tone(N(28), 0.18, { vol: 0.16, at: 0.06 }); },
  march: () => { noise(0.07, { vol: 0.18, freq: 300, q: 1.2 }); noise(0.07, { vol: 0.14, freq: 260, q: 1.2, at: 0.16 }); },
  clash: () => { noise(0.12, { vol: 0.3, freq: 3200, q: 3 }); tone(N(31), 0.08, { type: 'triangle', vol: 0.1, slide: 0.8 }); },
  hit: () => { noise(0.07, { vol: 0.22, freq: 900 + Math.random() * 600, q: 2 }); tone(140, 0.06, { vol: 0.12, slide: 0.6 }); },
  death: () => { tone(320, 0.22, { type: 'sawtooth', vol: 0.1, slide: 0.35 }); noise(0.12, { vol: 0.12, freq: 500 }); },
  arrow: () => noise(0.14, { vol: 0.14, freq: 4200, q: 6, slide: 0.4 }),
  spell: () => { arp([12, 19, 24, 31], 0.05, { type: 'square', vol: 0.12, dur: 0.18, vibrato: 8 }); noise(0.45, { vol: 0.18, freq: 2400, q: 1, slide: 0.25, at: 0.12 }); },
  capture: () => { arp([7, 12, 16, 19], 0.07, { type: 'square', vol: 0.13 }); tone(N(24), 0.35, { type: 'triangle', vol: 0.2, at: 0.28 }); },
  lost: () => arp([16, 12, 7, 3], 0.09, { type: 'triangle', vol: 0.2 }),
  victory: () => {
    const m = [12, 12, 12, 16, 19, 16, 19, 24];
    const tm = [0, 0.12, 0.24, 0.36, 0.6, 0.78, 0.9, 1.08];
    m.forEach((n, i) => tone(N(n), i === m.length - 1 ? 0.9 : 0.16, { type: 'square', vol: 0.16, at: tm[i], vibrato: i === m.length - 1 ? 6 : 0 }));
    [0, 7, 12].forEach((n) => tone(N(n - 12), 1.6, { type: 'triangle', vol: 0.18, at: 0.6 }));
  },
  defeat: () => { [7, 6, 5, 4].forEach((n, i) => tone(N(n), 0.32, { type: 'square', vol: 0.12, at: i * 0.3, vibrato: 5 })); tone(N(-12), 1.6, { type: 'triangle', vol: 0.2, at: 0.9 }); },
  levelup: () => arp([12, 16, 19, 24, 28], 0.06, { type: 'square', vol: 0.13 }),
  evolve: () => { arp([7, 11, 14, 19, 23, 26, 31], 0.05, { type: 'square', vol: 0.11, vibrato: 10 }); noise(0.6, { vol: 0.1, freq: 6000, q: 1, slide: 0.3, at: 0.1 }); },
  turn: () => { tone(N(7), 0.12, { type: 'triangle', vol: 0.22 }); tone(N(12), 0.25, { type: 'triangle', vol: 0.22, at: 0.12 }); },
  alert: () => { tone(N(19), 0.1, { vol: 0.14 }); tone(N(19), 0.1, { vol: 0.14, at: 0.16 }); },
  horn: () => { tone(N(-5), 0.7, { type: 'sawtooth', vol: 0.14, attack: 0.08, vibrato: 3 }); tone(N(0), 0.9, { type: 'sawtooth', vol: 0.12, attack: 0.1, at: 0.45, vibrato: 3 }); },
  fire: () => noise(0.5, { vol: 0.2, freq: 700, q: 0.6, type: 'lowpass', slide: 2.5 }),
  quake: () => { noise(1.2, { vol: 0.4, freq: 120, q: 0.7, type: 'lowpass' }); tone(45, 1.1, { type: 'sine', vol: 0.35, slide: 0.7 }); },
  flood: () => { noise(1.0, { vol: 0.28, freq: 900, q: 0.5, slide: 0.3 }); noise(0.8, { vol: 0.16, freq: 2400, q: 0.9, at: 0.25, slide: 0.5 }); },
  stratagem: () => { arp([0, 7, 12, 19], 0.06, { type: 'square', vol: 0.12 }); tone(N(24), 0.4, { type: 'triangle', vol: 0.16, at: 0.24, vibrato: 6 }); },
  ambush: () => { tone(N(1), 0.12, { type: 'sawtooth', vol: 0.16 }); tone(N(1), 0.12, { type: 'sawtooth', vol: 0.16, at: 0.14 }); tone(N(-11), 0.5, { type: 'sawtooth', vol: 0.18, at: 0.28, slide: 0.9 }); noise(0.3, { vol: 0.2, freq: 2000, at: 0.28 }); },
  recruit: () => { arp([0, 4, 7, 12], 0.07, { type: 'triangle', vol: 0.2 }); },
  execute: () => { noise(0.25, { vol: 0.3, freq: 1800, q: 2, slide: 0.2 }); tone(80, 0.5, { type: 'sine', vol: 0.3, slide: 0.5, at: 0.05 }); },
};

export function sfx(name, opts = {}) {
  if (muted) return;
  const c = ensure(); if (!c || c.state !== 'running') { if (c) c.resume(); if (!c || c.state !== 'running') return; }
  const now = performance.now() / 1000;
  const lim = LIMIT[name];
  if (lim && now - (last.get(name) || 0) < lim) return;
  if (voices > 48 && lim) return;
  last.set(name, now);
  const f = SFX[name];
  if (f) f(opts);
}

setClickHook((cls) => { if (cls && /tab|seg|toggle|card/.test(cls)) sfx('click'); else sfx('click'); });

// ---------- music ----------
const MOODS = {
  title: { bpm: 84, root: -10, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 5, 3, 4], lead: 'triangle', drums: false, density: 0.55 },
  campaign: { bpm: 96, root: -5, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 3], lead: 'square', drums: false, density: 0.45 },
  battle: { bpm: 136, root: -7, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 6, 4], lead: 'square', drums: true, density: 0.7 },
  tension: { bpm: 72, root: -8, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 5], lead: 'triangle', drums: false, density: 0.3 },
};
const CHORD_OF = (scale, deg) => [scale[deg % scale.length] + (deg >= scale.length ? 12 : 0), scale[(deg + 2) % scale.length] + (deg + 2 >= scale.length ? 12 : 0), scale[(deg + 4) % scale.length] + (deg + 4 >= scale.length ? 12 : 0)];

export const music = {
  mood: null, timer: null, nextTime: 0, step: 0, lastNote: 0,
  start(mood) {
    if (this.mood === mood) return;
    this.stop();
    this.mood = mood;
    const c = ensure(); if (!c) return;
    this.nextTime = c.currentTime + 0.15; this.step = 0;
    this.timer = setInterval(() => this.tick(), 90);
  },
  stop() { clearInterval(this.timer); this.timer = null; this.mood = null; },
  tick() {
    if (!ctx || ctx.state !== 'running' || muted) { if (ctx) this.nextTime = ctx.currentTime + 0.1; return; }
    const M = MOODS[this.mood]; if (!M) return;
    const s16 = 60 / M.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.35) {
      const st = this.step, bar = Math.floor(st / 16) % M.prog.length, pos = st % 16;
      const deg = M.prog[bar];
      const chord = CHORD_OF(M.scale, deg).map((n) => n + M.root);
      const at = this.nextTime - ctx.currentTime;
      const opt = (o) => ({ ...o, bus: musicBus, at });
      // bass on beats
      if (pos % 4 === 0) tone(N(chord[0] - 12), s16 * 3.2, opt({ type: 'triangle', vol: 0.5 }));
      if (M.drums && pos % 8 === 4) tone(N(chord[0] - 12), s16 * 1.5, opt({ type: 'triangle', vol: 0.4 }));
      // arpeggio pad
      if (pos % 2 === 0 && Math.random() < 0.85) tone(N(chord[(pos / 2) % 3] + 12), s16 * 1.8, opt({ type: 'square', vol: 0.08 }));
      // melody: stepwise walk on the scale
      if ((pos % 2 === 0 || M.drums) && Math.random() < M.density * (pos % 4 === 0 ? 1 : 0.6)) {
        const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
        this.lastNote = Math.max(0, Math.min(M.scale.length * 2 - 1, this.lastNote + move));
        const n = M.scale[this.lastNote % M.scale.length] + 12 * Math.floor(this.lastNote / M.scale.length) + M.root + 12;
        tone(N(n), s16 * (pos % 4 === 0 ? 3 : 1.6), opt({ type: M.lead, vol: 0.22, vibrato: 4 }));
      }
      // drums
      if (M.drums) {
        if (pos % 4 === 0) { tone(110, 0.12, opt({ type: 'sine', vol: 0.6, slide: 0.4 })); }
        if (pos % 8 === 4) noise(0.12, opt({ vol: 0.25, freq: 1800, q: 0.7 }));
        if (pos % 2 === 1) noise(0.04, opt({ vol: 0.08, freq: 7000, q: 1.5 }));
      }
      this.nextTime += s16; this.step++;
    }
  },
};
