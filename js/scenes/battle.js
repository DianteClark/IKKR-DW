import { registerScene, go, game } from '../main.js';
import { ctx, screen, Camera } from '../engine/view.js';
import { h, btn, mount, modal, toast, bar, sprite, clearUI, banner, stratagemCard, chip, confirm } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { hashStr } from '../engine/rng.js';
import { drawUnit, drawHero, drawSpriteRef, DUNGEON_TILES } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import { createBattle, step, command, aiThink, battleResult, snapshot, applySnapshot, liveCount, DT, stratagemTargets } from '../battle/sim.js';
import { renderGround, drawFieldOverlay, postRef, TS } from '../battle/field.js';
import { createFx } from '../battle/fx.js';
import { formationSlots, FORMATIONS, FORMATION_IDS, STRATAGEMS, commandPool, tierIndex } from '../game/rules.js';
import { hero, hasIntel } from '../game/world.js';
import { line } from '../game/dialogue.js';
import { portrait, unitIcon } from '../campaign/widgets.js';
import { sfx, music } from '../engine/audio.js';
import { net } from '../net/net.js';

const cam = new Camera();
const B = { sim: null, ground: null, side: null, sel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false, colors: null, setup: null, state: null, juice: null, aim: null };
window.__dw = Object.assign(window.__dw || {}, { B, cam, sendCmd: (c) => send(c) });
const SPELL = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
const stratIcon = (id, scale = 2) => { const s = SPELL[STRATAGEMS[id].icon]; return s && s.icon ? sprite(s.icon, 0, 0, 16, 16, scale) : null; };

// args: { state, battle, control:{att,def}, me } (host/single) or { client:true, setup, items, me, state }
registerScene('battle', {
  enter(args) {
    Object.assign(B, { sel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false, aim: null });
    let setup = args.setup;
    if (!setup) {
      const st = args.state, b = args.battle;
      const t = st.territories[b.tid];
      const A = st.kingdoms[b.att], D = b.def >= 0 ? st.kingdoms[b.def] : null;
      const atk = b.attackers.map((id) => hero(st, id)), dfd = b.defenders.map((id) => hero(st, id));
      setup = {
        seed: hashStr(`${st.seed}:${st.turn}:${b.tid}:${b.att}`), biome: t.biome, level: t.level, place: t.name, siege: !!b.siege,
        attackers: JSON.parse(JSON.stringify(atk)), defenders: JSON.parse(JSON.stringify(dfd)),
        attFid: A.fid, defFid: D ? D.fid : (t.race || 'castle'), attName: A.name, defName: D ? D.name : 'Town guard',
        attKid: A.id, defKid: D ? D.id : -1, attMorale: A.morale, defMorale: D ? D.morale : 60,
        attLoadout: (A.loadout || []).slice(), defLoadout: D ? (D.loadout || []).slice() : [],
        attPool: commandPool(atk, tierIndex(A), A.buildings.academy), defPool: D ? commandPool(dfd, tierIndex(D), D.buildings.academy) : 4,
        colors: { att: A.color, def: D ? D.color : '#9aa7b8' }, control: args.control,
        garrison: { squads: dfd.length ? 1 : 2 + Math.min(2, t.level), size: dfd.length ? 4 + t.level * 2 : 6 + t.level * 3 },
        intel: hasIntel(st, A.id, b.tid),
      };
      B.state = st;
    }
    B.setup = setup;
    B.client = !!args.client;
    if (B.client) B.state = args.state || null;
    B.me = args.me ?? 0;
    B.side = setup.control.att === B.me ? 'att' : setup.control.def === B.me ? 'def' : null;
    B.colors = { ...setup.colors };
    const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [a, d] = [rgb(B.colors.att), rgb(B.colors.def)];
    if (Math.hypot(a[0] - d[0], a[1] - d[1], a[2] - d[2]) < 130) B.colors.def = a[2] > 150 ? '#f5c630' : '#3a7bf0';
    B.sim = createBattle({ ...setup, items: B.state ? B.state.items : (args.items || {}) });
    B.sim.ai = { att: setup.control.att === 'ai', def: setup.control.def === 'ai' };
    B.ground = renderGround(B.sim.field);
    B.juice = createFx();
    if (net.role === 'host') {
      net.send({ t: 'battleStart', setup, items: B.state.items });
      net.on('cmd', (m) => { const side = setup.control.att === 1 ? 'att' : setup.control.def === 1 ? 'def' : null; if (side) command(B.sim, side, m.c); });
    }
    if (B.client) { net.on('snap', (m) => applySnapshot(B.sim, m.s)); net.on('battleEnd', (m) => endBattle(m.result)); }
    music.start('battle');
    fitCamera();
    buildUI();
    intro();
  },
  exit() { net.off('cmd'); net.off('snap'); net.off('battleEnd'); net.off('battleGo'); },
  update(dt) {
    const sim = B.sim; if (!sim) return;
    if (!B.client && B.started && !B.paused && !B.ended) {
      B.acc += dt * B.speed;
      let n = 0;
      while (B.acc >= DT && n++ < 10) {
        B.acc -= DT;
        for (const side of ['att', 'def']) if (B.setup.control[side] === 'ai') aiThink(sim, side);
        step(sim);
        if (net.role === 'host' && sim.tick % 2 === 0) net.send({ t: 'snap', s: snapshot(sim) });
        if (sim.winner) break;
      }
      if (sim.winner && !B.ended) { if (net.role === 'host') net.send({ t: 'snap', s: snapshot(sim) }); B.ended = true; setTimeout(() => finish(), 1400); }
    }
    consumeEvents();
    updateRender(dt);
    B.juice.update(dt);
    if ((game.time * 4 | 0) !== B._uiTick) { B._uiTick = game.time * 4 | 0; refreshHUD(); }
  },
  render() { draw(); },
  onTap(sx, sy) { tap(sx, sy); },
  onPan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; cam.clamp(); },
  onPinch(cx, cy, f, mx, my) { cam.zoomAt(cx, cy, f); cam.x -= mx / cam.zoom; cam.y -= my / cam.zoom; cam.clamp(); },
  onResize() { fitCamera(); },
});

const LEFT = 84, RIGHT = 0;
function fitCamera() {
  const F = B.sim.field;
  const W = F.W * TS, H = F.H * TS;
  const availW = screen.w - LEFT - 8 - RIGHT, availH = screen.h - 8;
  cam.zoom = Math.min(availW / W, availH / H);
  cam.min = cam.zoom; cam.max = Math.max(cam.zoom * 4, 3);
  cam.bounds = { x: -LEFT / cam.zoom, y: 0, w: W + LEFT / cam.zoom, h: H };
  cam.x = W / 2 - (LEFT / 2) / cam.zoom; cam.y = H / 2;
}

// ---------- render state ----------
function updateRender(dt) {
  for (const s of B.sim.squads) {
    let r = B.render.get(s.id);
    if (!r) { r = { x: s.x, y: s.y, soldiers: s.soldiers.map(() => ({ x: s.x * TS, y: s.y * TS })), hx: s.x * TS, hy: s.y * TS, flash: 0 }; B.render.set(s.id, r); }
    const k = Math.min(1, dt * (B.client ? 8 : 14));
    r.x += (s.x - r.x) * k; r.y += (s.y - r.y) * k;
    r.flash = Math.max(0, r.flash - dt * 4);
    const alive = s.soldiers.filter((x) => x.alive);
    const f = s.reform && s.reform.t / (s.reform.total || 1) > 0.5 ? s.reform.to : s.formation;
    const slots = formationSlots(f, alive.length);
    const c = Math.cos(s.dir), sn = Math.sin(s.dir);
    const jit = s.reform ? 0.25 : 0;
    let j = 0;
    s.soldiers.forEach((so, i) => {
      const rp = r.soldiers[i];
      if (!so.alive) return;
      const [ox, oy] = slots[j++] || [0, 0];
      const jx = jit ? Math.sin(game.time * 9 + i) * jit : 0;
      const tx = (r.x + ox * c - oy * sn + jx) * TS, ty = (r.y + ox * sn + oy * c) * TS;
      const kk = Math.min(1, dt * 6);
      rp.x += (tx - rp.x) * kk; rp.y += (ty - rp.y) * kk;
    });
    const hx = (r.x - 0.95 * c) * TS, hy = (r.y - 0.95 * sn) * TS;
    r.hx += (hx - r.hx) * Math.min(1, dt * 6); r.hy += (hy - r.hy) * Math.min(1, dt * 6);
  }
  B.fx = B.fx.filter((f) => (f.age += dt) < f.life);
}

function consumeEvents() {
  const sim = B.sim, J = B.juice;
  for (const e of sim.events) {
    if (e.seq <= B.seenEv) continue;
    B.seenEv = e.seq;
    const sq = (id) => sim.squads.find((s) => s.id === id);
    const mineSide = (side) => B.side && side === B.side;
    if (e.k === 'die') {
      const s = sq(e.id), r = B.render.get(e.id); if (!s || !r) continue;
      const i = s.soldiers.findIndex((x) => x.idx === e.idx), p = r.soldiers[i];
      if (p) { B.fx.push({ k: 'corpse', x: p.x, y: p.y, fid: s.fid, unit: s.unit, stage: s.soldiers[i].s, flip: Math.cos(s.dir) < 0, age: 0, life: 6 }); J.dust(p.x, p.y); }
      sfx('death');
      if (e.elite && mineSide(s.side)) toast(`${e.elite} has fallen!`, 'bad');
    } else if (e.k === 'hit') {
      const r = B.render.get(e.id); if (!r) continue;
      r.flash = 1;
      if (e.d >= 4) J.damage(r.x * TS, r.y * TS - 14, e.d, '#ffd0c0');
      J.hit(r.x * TS + (Math.random() - 0.5) * 10, r.y * TS - 4, '#fff');
      sfx('hit');
    } else if (e.k === 'shot') {
      const a = B.render.get(e.from), b = B.render.get(e.to); if (!a || !b) continue;
      for (let i = 0; i < 3; i++) B.fx.push({ k: 'arrow', x1: a.x * TS + (i - 1) * 4, y1: a.y * TS - 6 + i * 3, x2: b.x * TS + (i - 1) * 5, y2: b.y * TS - 4, age: -i * 0.06, life: 0.4 });
      sfx('arrow');
    } else if (e.k === 'spell') {
      B.fx.push({ k: 'spell', spell: SPELL[e.spell], x: e.x * TS, y: e.y * TS, age: 0, life: 1.1 });
      J.shockwave(e.x * TS, e.y * TS, '#ffd86b'); J.shake(4, 0.35); sfx('spell');
      const s = sq(e.from); if (s) toast(`${s.name}: ${SPELL[e.spell]?.name || 'Special'}!`, mineSide(s.side) ? 'good' : 'bad');
    } else if (e.k === 'capture') {
      const p = sim.field.posts[e.post];
      B.fx.push({ k: 'flash', x: p.x * TS, y: p.y * TS, age: 0, life: 0.8, side: e.side });
      J.confetti(p.x * TS, p.y * TS - 20); sfx(mineSide(e.side) || (!B.side && e.side === 'att') ? 'capture' : 'lost');
      if (B.side) banner(p.main ? (e.side === B.side ? 'MAIN POST TAKEN' : 'MAIN POST LOST') : e.side === B.side ? 'Post captured' : 'Post lost', e.side === B.side ? 'good' : 'bad');
    } else if (e.k === 'heroDown') {
      const s = sq(e.id); if (s) { toast(`${s.name}: “${line('heroDown', null, e.seq)}”`, mineSide(s.side) ? 'bad' : 'good'); const r = B.render.get(e.id); if (r) J.shockwave(r.hx, r.hy, '#ff6a5a'); J.shake(3, 0.3); }
    } else if (e.k === 'rout') {
      const s = sq(e.id); if (s && mineSide(s.side)) toast(`${s.name}'s squad is routing!`, 'bad');
    } else if (e.k === 'trap') {
      B.fx.push({ k: 'trap', x: e.x * TS, y: e.y * TS, age: 0, life: 0.4 }); J.sparks(e.x * TS, e.y * TS, '#ffb347');
    } else if (e.k === 'treachery') {
      const s = sq(e.id);
      sfx('ambush'); J.shake(6, 0.5);
      banner('TREACHERY!', mineSide(s && s.side) ? 'good' : 'bad', s ? `${s.name}: “${line('treachery', null, e.seq)}”` : '');
    } else if (e.k === 'mapEvent') {
      const names = { landslide: 'ROCKSLIDE!', flood: 'FLOOD!', collapse: 'CAVE-IN!', fire: 'WILDFIRE!' };
      banner(names[e.kind] || 'THE LAND SHIFTS', 'bad', 'A route has been cut');
      sfx(e.kind === 'flood' ? 'flood' : e.kind === 'fire' ? 'fire' : 'quake'); J.shake(7, 0.7);
      for (let i = 0; i < 8; i++) J.smoke(e.x * TS + (Math.random() - 0.5) * 40, e.y * TS + (Math.random() - 0.5) * 20);
    } else if (e.k === 'fog') {
      banner('FOG ROLLS IN', 'blue', 'Archers can barely see'); sfx('alert');
    } else if (e.k === 'strat') {
      const S = STRATAGEMS[e.id];
      sfx(e.id === 'ambush' ? 'ambush' : e.id === 'fire' ? 'fire' : e.id === 'landslide' ? 'quake' : 'stratagem');
      banner(S.name.toUpperCase(), mineSide(e.side) ? 'good' : 'bad', mineSide(e.side) ? 'Stratagem' : 'Enemy stratagem!');
      if (e.x || e.y) { J.shockwave(e.x * TS, e.y * TS, mineSide(e.side) ? '#6bb6ff' : '#ff6a5a'); if (e.id === 'fire') for (let i = 0; i < 10; i++) J.fire(e.x * TS + (Math.random() - 0.5) * 50, e.y * TS + (Math.random() - 0.5) * 30); }
      if (e.id === 'ambush') J.shake(5, 0.4);
    } else if (e.k === 'reform') {
      const s = sq(e.id); if (s && mineSide(s.side)) sfx('march');
    }
  }
}

// ---------- drawing ----------
function draw() {
  const sim = B.sim; if (!sim) return;
  const off = B.juice.offset();
  cam.apply();
  ctx.translate(off.x, off.y);
  ctx.drawImage(B.ground, 0, 0);
  const time = game.time;
  drawFieldOverlay(ctx, sim.field, time);
  const dt = img(DUNGEON_TILES);
  for (const tr of sim.field.traps || []) {
    const f = Math.floor(time * 4) % 4;
    const row = tr.kind === 'spikes' ? 128 : tr.kind === 'axe' ? 160 : 176;
    if (dt) ctx.drawImage(dt, 192 + f * 16, row, 16, 16, tr.x * TS - 8, tr.y * TS - 8, 16, 16);
  }
  // fires from stratagems
  for (const f of sim.fires) {
    ctx.fillStyle = `rgba(255,${100 + Math.sin(time * 9) * 30 | 0},40,0.22)`;
    ctx.beginPath(); ctx.ellipse(f.x * TS, f.y * TS, f.r * TS, f.r * TS * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    if (Math.random() < 0.5) B.juice.fire(f.x * TS + (Math.random() - 0.5) * f.r * TS * 1.6, f.y * TS + (Math.random() - 0.5) * f.r * TS);
  }
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel) : null;
  if (sel && sel.goal != null) {
    const p = sim.field.posts[sel.goal];
    ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -time * 10;
    ctx.beginPath(); ctx.moveTo(sel.x * TS, sel.y * TS); ctx.lineTo(p.x * TS, p.y * TS); ctx.stroke(); ctx.setLineDash([]);
  }
  // stratagem targeting highlights
  if (B.aim) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 8);
    ctx.strokeStyle = `rgba(255,216,107,${pulse})`; ctx.lineWidth = 2;
    for (const t of B.aim.targets) {
      if (t.kind === 'squad') { const s = sim.squads.find((q) => q.id === t.id); const r = s && B.render.get(s.id); if (r) { ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS, 1.8 * TS, 1.2 * TS, 0, 0, Math.PI * 2); ctx.stroke(); } }
      if (t.kind === 'post') { const p = sim.field.posts[t.id]; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.6 * TS, 1.8 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
      if (t.kind === 'edge') { const [a, b] = sim.field.edges[t.id]; const A = sim.field.posts[a], Bp = sim.field.posts[b]; ctx.beginPath(); ctx.arc((A.x + Bp.x) / 2 * TS, (A.y + Bp.y) / 2 * TS, 8, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  for (const p of sim.field.posts) {
    const ref = postRef(p, B.setup.defFid, B.setup.attFid);
    const w = p.main ? ref[3] * 0.75 : ref[3], hh = p.main ? ref[4] * 0.75 : ref[4];
    const col = p.owner === 'att' ? B.colors.att : p.owner === 'def' ? B.colors.def : '#d6d0c4';
    ctx.fillStyle = col; ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (p.fort) { ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.5 * TS, 1.7 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (sel && sel.side === B.side && !p.camp) { ctx.strokeStyle = 'rgba(255,210,90,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
    drawSpriteRef(ctx, ref, p.x * TS - w / 2, p.y * TS - hh + 8, w, hh);
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(p.x * TS + w / 2 - 3, p.y * TS - hh, 1, 14);
    ctx.fillStyle = col; ctx.fillRect(p.x * TS + w / 2 - 2, p.y * TS - hh + Math.sin(time * 4 + p.id), 7, 5);
    if (p.prog > 0) {
      ctx.strokeStyle = '#0b0a10'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS - hh - 6, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = p.by === 'att' ? B.colors.att : B.colors.def; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS - hh - 6, 5, -Math.PI / 2, -Math.PI / 2 + p.prog * Math.PI * 2); ctx.stroke();
    }
  }
  const list = [];
  for (const f of B.fx) if (f.k === 'corpse') list.push({ y: f.y - 1, f });
  for (const s of sim.squads) {
    const r = B.render.get(s.id); if (!r) continue;
    const anim = s.state === 'fight' || s.state === 'shoot' ? 'attack' : s.state === 'move' || s.state === 'rout' ? 'walk' : s.state === 'confused' ? 'hit' : 'idle';
    const flip = Math.cos(s.dir) < 0;
    s.soldiers.forEach((so, i) => { if (so.alive) list.push({ y: r.soldiers[i].y, s, so, p: r.soldiers[i], anim, flip, i, flash: r.flash }); });
    if (s.heroAlive) list.push({ y: r.hy, s, hero: true, p: { x: r.hx, y: r.hy }, anim, flip });
  }
  for (const s of sim.squads) {
    if (s.state === 'dead') continue;
    const r = B.render.get(s.id);
    const rad = 1.1 + Math.sqrt(liveCount(s)) * 0.12;
    ctx.fillStyle = B.colors[s.side]; ctx.globalAlpha = s.id === B.sel ? 0.55 : 0.28;
    ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS, rad * 0.66 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (s.id === B.sel) { ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, rad * TS + 1 + Math.sin(time * 6), rad * 0.7 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) {
    if (d.f) { const f = d.f; drawUnit(ctx, f.fid, f.unit, f.stage, 'death', Math.min(3, f.age * 7), f.x, f.y, f.flip, Math.max(0, 1 - Math.max(0, f.age - 3) / 3)); continue; }
    const s = d.s;
    if (d.hero) {
      drawHero(ctx, s.hfid, s.gender, 1, d.anim === 'idle' ? 'walk' : d.anim === 'hit' ? 'hit' : d.anim, d.anim === 'idle' ? 0 : time * 7 + s.id, d.p.x, d.p.y, d.flip);
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(d.p.x - 1 + (d.flip ? 5 : -5), d.p.y - 22, 1, 10);
      ctx.fillStyle = B.colors[s.side]; ctx.fillRect(d.p.x + (d.flip ? 5 : -5), d.p.y - 22, 5, 4);
    } else {
      drawUnit(ctx, s.fid, s.unit, d.so.s, d.anim, time * (d.anim === 'idle' ? 4 : 8) + d.i * 0.7, d.p.x, d.p.y, d.flip, s.state === 'rout' ? 0.7 : 1);
      if (d.so.s === 3) { ctx.fillStyle = '#ffd86b'; ctx.fillRect(d.p.x - 1, d.p.y - 17, 2, 2); }
      if (d.flash > 0.5) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(d.p.x - 4, d.p.y - 12, 8, 10); ctx.globalAlpha = 1; }
    }
  }
  for (const s of sim.squads) {
    if (s.state === 'dead') continue;
    const r = B.render.get(s.id);
    const n = liveCount(s), max = s.soldiers.length;
    const x = r.x * TS - 10, y = r.y * TS - 28;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 1, y - 1, 22, 7);
    ctx.fillStyle = B.colors[s.side]; ctx.fillRect(x, y, 20 * (max ? n / max : 0), 2);
    ctx.fillStyle = s.morale < 25 ? '#ff6a5a' : '#6bb6ff'; ctx.fillRect(x, y + 2, 20 * Math.max(0, s.morale) / 100, 2);
    if (s.reform) { ctx.fillStyle = '#ffd86b'; ctx.fillRect(x, y + 4, 20 * Math.min(1, s.reform.t / (s.reform.total || 1)), 1); }
    if (s.special >= 1 && s.side === B.side && s.heroAlive) { ctx.fillStyle = '#ffd25a'; ctx.fillRect(x + 21, y - 1, 3, 7); }
    if (s.buffs && (s.buffs.confused > 0 || s.state === 'confused')) { ctx.fillStyle = '#c48bff'; ctx.fillRect(x + 6 + Math.sin(time * 8) * 4, y - 5, 3, 3); }
  }
  for (const f of B.fx) {
    if (f.age < 0) continue;
    if (f.k === 'arrow') {
      const t = f.age / f.life, x = f.x1 + (f.x2 - f.x1) * t, y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 10;
      ctx.fillStyle = '#f2e8d5'; ctx.fillRect(x, y, 3, 1);
    } else if (f.k === 'spell' && f.spell) {
      const im = img(f.spell.src);
      if (im) { const fr = Math.min(f.spell.frames - 1, Math.floor(f.age / f.life * f.spell.frames)); ctx.drawImage(im, fr * f.spell.fw, 0, f.spell.fw, f.spell.fh, f.x - f.spell.fw, f.y - f.spell.fh * 1.6, f.spell.fw * 2, f.spell.fh * 2); }
    } else if (f.k === 'flash') {
      ctx.strokeStyle = B.colors[f.side]; ctx.lineWidth = 2; ctx.globalAlpha = 1 - f.age / f.life;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + f.age * 50, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.k === 'trap' && dt) ctx.drawImage(dt, 192 + 48, 176, 16, 16, f.x - 8, f.y - 12, 16, 16);
  }
  B.juice.draw(ctx);
  if (sim.fog > 0) { ctx.fillStyle = `rgba(200,210,225,${Math.min(0.28, sim.fog / 30 * 0.28)})`; ctx.fillRect(0, 0, sim.field.W * TS, sim.field.H * TS); }
}

// ---------- input ----------
function tap(sx, sy) {
  if (!B.started || B.ended || !B.side) return;
  const w = cam.toWorld(sx, sy);
  const wx = w.x / TS, wy = w.y / TS;
  const sim = B.sim;
  if (B.aim) {
    // pick the closest valid target
    let best = null, bd = 3.2;
    for (const t of B.aim.targets) {
      let x, y;
      if (t.kind === 'squad') { const s = sim.squads.find((q) => q.id === t.id); if (!s) continue; x = s.x; y = s.y; }
      if (t.kind === 'post') { x = sim.field.posts[t.id].x; y = sim.field.posts[t.id].y; }
      if (t.kind === 'edge') { const [a, b] = sim.field.edges[t.id]; x = (sim.field.posts[a].x + sim.field.posts[b].x) / 2; y = (sim.field.posts[a].y + sim.field.posts[b].y) / 2; }
      const d = Math.hypot(x - wx, y - wy); if (d < bd) { bd = d; best = t; }
    }
    if (best) { send({ type: 'strat', id: B.aim.id, target: best }); B.aim = null; refreshHUD(true); }
    else toast('Tap a highlighted target');
    return;
  }
  let best = null, bd = 1.8;
  for (const s of sim.squads) { if (s.state === 'dead') continue; const d = Math.hypot(s.x - wx, s.y - (wy + 0.3)); if (d < bd) { bd = d; best = s; } }
  if (best && best.side === B.side) { B.sel = best.id; sfx('click'); refreshHUD(true); return; }
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel && s.state !== 'dead' && s.side === B.side) : null;
  if (!sel) return;
  if (best && best.side !== B.side) { send({ type: 'chase', squad: sel.id, target: best.id }); sfx('clash'); toast(`Attacking ${best.name}`); return; }
  let post = null, pd = 3;
  for (const p of sim.field.posts) { const d = Math.hypot(p.x - wx, p.y - wy); if (d < pd) { pd = d; post = p; } }
  if (post) { send({ type: 'move', squad: sel.id, post: post.id }); sfx('march'); return; }
  B.sel = null; refreshHUD(true);
}

function send(c) {
  if (B.client) net.send({ t: 'cmd', c });
  else command(B.sim, B.side, c);
  if (B.client && c.type === 'move') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) s.goal = c.post; }
}

function startAim(id) {
  const st = STRATAGEMS[id];
  const targets = stratagemTargets(B.sim, B.side, id);
  if (st.target === 'army') { send({ type: 'strat', id, target: { kind: 'army' } }); return; }
  if (!targets.length) { toast(st.target === 'enemyFighting' ? 'Ambush needs an enemy already in combat' : 'No valid target right now'); return; }
  B.aim = { id, targets };
  sfx('open');
  refreshHUD(true);
}

// ---------- HUD ----------
let hud = {};
function buildUI() {
  clearUI();
  hud.left = mount(h('div', { class: 'col scroll battle-left', style: { position: 'absolute', left: 'calc(4px + var(--sal))', top: 'calc(4px + var(--sat))', bottom: 'calc(4px + var(--sab))', width: LEFT - 6 + 'px', gap: '4px' } }));
  hud.top = mount(h('div', { class: 'topbar', style: { left: `calc(${LEFT}px + var(--sal))` } }));
  hud.bottom = mount(h('div', { style: { position: 'absolute', bottom: 'calc(4px + var(--sab))', left: `calc(${LEFT}px + var(--sal))`, right: 'calc(4px + var(--sar))', display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'flex-end', pointerEvents: 'none' } }));
  refreshHUD(true);
}

function refreshHUD(full) {
  if (!hud.left || !B.sim) return;
  const sim = B.sim;
  const mine = sim.squads.filter((s) => s.side === B.side);
  hud.left.innerHTML = '';
  for (const s of (B.side ? mine : sim.squads.filter((q) => q.side === 'att'))) {
    const dead = s.state === 'dead';
    const n = liveCount(s);
    const st = B.state && s.hero != null ? hero(B.state, s.hero) : null;
    const icon = s.hero != null && st ? portrait(st, 1.75) : unitIcon(s.fid, s.unit, 1, 1.75);
    const el = h('div', { class: 'card tap' + (s.id === B.sel ? ' sel' : '') + (dead ? ' dim' : ''), style: { padding: '4px', flexDirection: 'column', alignItems: 'stretch', gap: '3px', pointerEvents: 'auto' }, onClick: () => { if (!dead && B.side) { B.sel = s.id; sfx('click'); refreshHUD(true); } } },
      h('div', { class: 'row', style: { gap: '4px' } }, icon, h('b', { style: { fontSize: '14px' } }, dead ? '✝' : `${n}`), s.reform ? h('span', { class: 'gold', style: { fontSize: '11px' } }, '⟳') : null),
      bar(s.soldiers.length ? n / s.soldiers.length : 0, 'thin'), bar(Math.max(0, s.morale) / 100, 'mor thin'),
      s.special >= 1 && !dead && s.heroAlive && B.side ? btn('★', () => { send({ type: 'special', squad: s.id }); }, 'tiny primary') : null);
    hud.left.appendChild(el);
  }
  const posts = sim.field.posts;
  const ownP = B.side ? posts.filter((p) => p.owner === B.side).length : 0;
  const left = Math.max(0, 240 - sim.t);
  const stS = B.side ? sim.strat[B.side] : null;
  hud.top.innerHTML = '';
  hud.top.append(...[
    h('span', { class: 'chip' }, B.setup.place),
    h('span', { class: 'chip ' + (left < 30 ? 'bad' : '') }, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`),
    B.side ? h('span', { class: 'chip' }, `Posts ${ownP}/${posts.length}`) : h('span', { class: 'chip' }, 'Spectating'),
    stS && stS.list.length ? h('span', { class: 'chip gold' }, `⚑ ${stS.pool}/${stS.max}`) : null,
    h('span', { class: 'grow' }),
    !B.client && net.role === 'single' ? btn(B.paused ? '▶' : '❚❚', () => { B.paused = !B.paused; refreshHUD(true); }, 'small') : null,
    !B.client && net.role === 'single' ? btn(B.speed === 1 ? '1x' : '2x', () => { B.speed = B.speed === 1 ? 2 : 1; refreshHUD(true); }, 'small') : null,
    B.side ? btn('Retreat', () => confirm('Sound the retreat?', 'Your army withdraws and the battle is lost. Heroes still standing escape.', 'Retreat', 'Fight on', 'danger').then((ok) => ok && send({ type: 'retreat' })), 'danger small') : null,
  ].filter(Boolean));
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel && s.state !== 'dead' && s.side === B.side) : null;
  const key = (sel ? sel.id + sel.formation + (sel.reform ? sel.reform.to : '') : '') + '|' + (stS ? stS.pool + stS.list.map((x) => x.used).join() : '') + '|' + (B.aim ? B.aim.id : '');
  if (full || hud.key !== key) {
    hud.key = key;
    hud.bottom.innerHTML = '';
    if (B.aim) {
      hud.bottom.appendChild(h('div', { class: 'chip', style: { pointerEvents: 'auto' } }, `${STRATAGEMS[B.aim.id].name}: tap a highlighted target `, btn('Cancel', () => { B.aim = null; refreshHUD(true); }, 'tiny')));
    } else if (sel) {
      const reformTo = sel.reform ? sel.reform.to : null;
      hud.bottom.appendChild(h('div', { class: 'row', style: { pointerEvents: 'auto', background: 'rgba(20,18,28,.9)', padding: '5px', borderRadius: '4px', border: '2px solid #6b4a2a', gap: '4px' } },
        h('span', { style: { fontSize: '13px', maxWidth: '110px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 700 } }, sel.name),
        ...FORMATION_IDS.map((f) => btn(FORMATIONS[f].name + (reformTo === f ? ' ⟳' : ''), () => { send({ type: 'formation', squad: sel.id, formation: f }); refreshHUD(true); }, 'small' + (sel.formation === f && !reformTo ? ' sel' : '') + (reformTo === f ? ' primary' : ''))),
        btn('Hold', () => send({ type: 'hold', squad: sel.id }), 'small')));
    }
    if (stS && stS.list.length && B.started && !B.aim) {
      hud.bottom.appendChild(h('div', { class: 'row', style: { pointerEvents: 'auto', gap: '4px' } }, stS.list.map((x) => {
        const S = STRATAGEMS[x.id];
        return h('div', { class: 'strat-mini' + (x.used || S.cost > stS.pool ? ' disabled' : '') }, stratagemCard({ name: S.name, icon: stratIcon(x.id, 1.5), cost: S.cost, disabled: x.used || S.cost > stS.pool, onClick: () => { if (!x.used && S.cost <= stS.pool) startAim(x.id); } }));
      })));
    }
    if (!sel && !B.aim && B.started && B.side && !(stS && stS.list.length)) hud.bottom.appendChild(h('div', { class: 'chip', style: { pointerEvents: 'none' } }, 'Tap a squad, then a post or an enemy'));
  }
}

function intro() {
  const st = B.setup;
  const side = B.side;
  const tags = B.sim.squads.filter((s) => s.side === side && s.tags && s.tags.length).map((s) => `${s.name.split(' ')[0]}: ${s.tags.join(', ')}`);
  const body = h('div', { class: 'col' },
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B.colors.att } }), h('b', {}, st.attName), h('span', { class: 'muted' }, 'attacking')),
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B.colors.def } }), h('b', {}, st.defName), h('span', { class: 'muted' }, 'defending')),
    h('div', { class: 'muted' }, side === 'att' ? 'Take the enemy main post (the town) to win. Outposts on the way weaken them.'
      : side === 'def' ? 'Hold the main post until time runs out, or rout the attackers.' : 'You are watching this battle.'),
    tags.length ? h('div', { class: 'row wrap', style: { gap: '4px' } }, tags.map((t) => chip(t, 'good'))) : null,
    h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Wedge beats Line, Line beats Square, Square beats Wedge. Changing formation takes a few seconds and leaves the squad exposed. ★ = hero special. ⚑ = command points for stratagems.'));
  const start = () => { if (net.role === 'host') net.send({ t: 'battleGo' }); B.started = true; sfx('horn'); banner('BATTLE!', '', st.place); refreshHUD(true); };
  if (B.client) {
    let m;
    net.on('battleGo', () => { B.started = true; m && m.close(); sfx('horn'); banner('BATTLE!', '', st.place); refreshHUD(true); });
    m = modal(`Battle of ${st.place}`, body, [], {});
    return;
  }
  if (!side && net.role === 'host') { const m = modal(`Battle of ${st.place}`, body, []); setTimeout(() => { m.close(); start(); }, 2500); return; }
  modal(`Battle of ${st.place}`, body, [['Begin', start, 'primary']]);
}

function finish() {
  const result = battleResult(B.sim);
  if (net.role === 'host') net.send({ t: 'battleEnd', result });
  endBattle(result);
}

function endBattle(result) {
  B.ended = true;
  const sim = B.sim;
  const won = B.side ? result.winner === B.side : null;
  sfx(won === false ? 'defeat' : 'victory');
  banner(won == null ? (result.winner === 'att' ? 'ATTACKERS WIN' : 'DEFENDERS WIN') : won ? 'VICTORY' : 'DEFEAT', won === false ? 'bad' : 'good', B.setup.place);
  if (won) B.juice.confetti(sim.field.W * TS / 2, sim.field.H * TS / 2);
  const lines = sim.squads.filter((s) => s.hero != null).map((s) => {
    const lost = s.soldiers.filter((x) => !x.alive).length;
    return h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B.colors[s.side] } }),
      h('span', { class: 'grow' }, s.name + (s.turncoat ? ' (turncoat)' : '')), h('span', { class: s.heroAlive ? 'muted' : 'bad' }, `${s.heroAlive ? '' : 'defeated · '}lost ${lost}/${s.soldiers.length}`));
  });
  setTimeout(() => modal(won == null ? (result.winner === 'att' ? 'Attackers win' : 'Defenders win') : won ? 'Victory!' : 'Defeat',
    h('div', { class: 'col' }, result.retreated ? h('div', { class: 'muted' }, `${result.retreated === 'att' ? 'The attackers' : 'The defenders'} retreated.`) : null, lines),
    [['Continue', () => go('campaign', { resume: B.client ? true : result }), 'primary']]), 900);
}
