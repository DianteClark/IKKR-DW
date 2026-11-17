import { registerScene, go, game } from '../main.js';
import { ctx, screen, Camera } from '../engine/view.js';
import { h, btn, mount, modal, toast, bar, sprite, clearUI } from '../engine/ui.js';
import { img } from '../engine/assets.js';
import { hashStr } from '../engine/rng.js';
import { drawUnit, drawHero, drawSpriteRef, DUNGEON_TILES, FACTIONS } from '../data/art.js';
import { SPELLS } from '../data/spells.js';
import { createBattle, step, command, aiThink, battleResult, snapshot, applySnapshot, liveCount, DT } from '../battle/sim.js';
import { renderGround, postRef, BW, BH, TS } from '../battle/field.js';
import { formationSlots, FORMATIONS, FORMATION_IDS, unitName } from '../game/rules.js';
import { hero } from '../game/world.js';
import { portrait, unitIcon } from '../campaign/widgets.js';
import { net } from '../net/net.js';

const cam = new Camera();
const B = { sim: null, ground: null, side: null, sel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false, colors: null, ctl: null, battle: null, state: null };
window.__dw = Object.assign(window.__dw || {}, { B });
const SPELL_BY_ID = Object.fromEntries(SPELLS.map((s) => [s.id, s]));

// args: { state, battle, control:{att,def}, me } — host/single; client gets { client:true, setup }
registerScene('battle', {
  enter(args) {
    Object.assign(B, { sel: null, acc: 0, render: new Map(), fx: [], seenEv: 0, paused: false, speed: 1, ended: false, started: false });
    let setup = args.setup;
    if (!setup) {
      const st = args.state, b = args.battle;
      const t = st.territories[b.tid];
      const A = st.kingdoms[b.att], D = b.def >= 0 ? st.kingdoms[b.def] : null;
      const atk = b.attackers.map((id) => hero(st, id)), dfd = b.defenders.map((id) => hero(st, id));
      setup = {
        seed: hashStr(`${st.seed}:${st.turn}:${b.tid}:${b.att}`), biome: t.biome, level: t.level, place: t.name,
        attackers: JSON.parse(JSON.stringify(atk)), defenders: JSON.parse(JSON.stringify(dfd)),
        attFid: A.fid, defFid: D ? D.fid : 'castle', attName: A.name, defName: D ? D.name : 'Town guard',
        colors: { att: A.color, def: D ? D.color : '#9aa7b8' }, control: args.control,
        garrison: { squads: dfd.length ? 1 : 2 + Math.min(2, t.level), size: dfd.length ? 4 + t.level : 5 + t.level * 2 },
      };
      B.state = st;
    }
    B.setup = setup;
    B.client = !!args.client;
    B.me = args.me ?? 0;
    B.side = setup.control.att === B.me ? 'att' : setup.control.def === B.me ? 'def' : null;
    B.colors = setup.colors;
    B.sim = createBattle({ ...setup, items: B.state ? B.state.items : (args.items || {}) });
    B.sim.ai = { att: setup.control.att === 'ai', def: setup.control.def === 'ai' };
    B.ground = renderGround(B.sim.field);
    if (net.role === 'host') {
      net.send({ t: 'battleStart', setup, items: B.state.items });
      net.on('cmd', (m) => { const side = setup.control.att === 1 ? 'att' : setup.control.def === 1 ? 'def' : null; if (side) command(B.sim, side, m.c); });
    }
    if (B.client) net.on('snap', (m) => applySnapshot(B.sim, m.s));
    if (B.client) net.on('battleEnd', (m) => endBattle(m.result));
    fitCamera();
    buildUI();
    intro();
  },
  exit() { net.off('cmd'); net.off('snap'); net.off('battleEnd'); },
  update(dt) {
    const sim = B.sim; if (!sim) return;
    if (!B.client && B.started && !B.paused && !B.ended) {
      B.acc += dt * B.speed;
      let n = 0;
      while (B.acc >= DT && n++ < 8) {
        B.acc -= DT;
        for (const side of ['att', 'def']) if (B.setup.control[side] === 'ai') aiThink(sim, side);
        step(sim);
        if (net.role === 'host' && sim.tick % 2 === 0) net.send({ t: 'snap', s: snapshot(sim) });
        if (sim.winner) break;
      }
      if (sim.winner && !B.ended) { if (net.role === 'host') net.send({ t: 'snap', s: snapshot(sim) }); setTimeout(() => finish(), 1200); B.ended = true; }
    }
    consumeEvents();
    updateRender(dt);
    if ((game.time * 4 | 0) !== B._uiTick) { B._uiTick = game.time * 4 | 0; refreshHUD(); }
  },
  render() { draw(); },
  onTap(sx, sy) { tap(sx, sy); },
  onPan(dx, dy) { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; cam.clamp(); },
  onPinch(cx, cy, f, mx, my) { cam.zoomAt(cx, cy, f); cam.x -= mx / cam.zoom; cam.y -= my / cam.zoom; cam.clamp(); },
  onResize() { fitCamera(); },
});

const LEFT = 76;
function fitCamera() {
  const availW = screen.w - LEFT - 8, availH = screen.h - 8;
  cam.zoom = Math.min(availW / (BW * TS), availH / (BH * TS));
  cam.min = cam.zoom; cam.max = cam.zoom * 4;
  cam.bounds = { x: -LEFT / cam.zoom, y: 0, w: BW * TS + LEFT / cam.zoom, h: BH * TS };
  cam.x = BW * TS / 2 - (LEFT / 2) / cam.zoom; cam.y = BH * TS / 2;
}

// ---------- render state ----------
function updateRender(dt) {
  for (const s of B.sim.squads) {
    let r = B.render.get(s.id);
    if (!r) { r = { x: s.x, y: s.y, soldiers: s.soldiers.map(() => ({ x: s.x * TS, y: s.y * TS })), hx: s.x * TS, hy: s.y * TS }; B.render.set(s.id, r); }
    const k = Math.min(1, dt * (B.client ? 8 : 14));
    r.x += (s.x - r.x) * k; r.y += (s.y - r.y) * k;
    const alive = s.soldiers.filter((x) => x.alive);
    const slots = formationSlots(s.formation, alive.length);
    const c = Math.cos(s.dir), sn = Math.sin(s.dir);
    let j = 0;
    s.soldiers.forEach((so, i) => {
      const rp = r.soldiers[i];
      if (!so.alive) return;
      const [ox, oy] = slots[j++] || [0, 0];
      const tx = (r.x + ox * c - oy * sn) * TS, ty = (r.y + ox * sn + oy * c) * TS;
      const kk = Math.min(1, dt * 6);
      rp.x += (tx - rp.x) * kk; rp.y += (ty - rp.y) * kk;
    });
    const hx = (r.x - 0.95 * c) * TS, hy = (r.y - 0.95 * sn) * TS;
    r.hx += (hx - r.hx) * Math.min(1, dt * 6); r.hy += (hy - r.hy) * Math.min(1, dt * 6);
  }
  B.fx = B.fx.filter((f) => (f.age += dt) < f.life);
}

function consumeEvents() {
  const sim = B.sim;
  for (const e of sim.events) {
    if (e.seq <= B.seenEv) continue;
    B.seenEv = e.seq;
    const sq = (id) => sim.squads.find((s) => s.id === id);
    if (e.k === 'die') {
      const s = sq(e.id), r = B.render.get(e.id); if (!s || !r) continue;
      const i = s.soldiers.findIndex((x) => x.idx === e.idx), p = r.soldiers[i];
      if (p) B.fx.push({ k: 'corpse', x: p.x, y: p.y, fid: s.fid, unit: s.unit, stage: s.soldiers[i].s, flip: Math.cos(s.dir) < 0, age: 0, life: 6 });
    } else if (e.k === 'shot') {
      const a = B.render.get(e.from), b = B.render.get(e.to); if (!a || !b) continue;
      for (let i = 0; i < 3; i++) B.fx.push({ k: 'arrow', x1: a.x * TS + (i - 1) * 4, y1: a.y * TS - 6 + i * 3, x2: b.x * TS + (i - 1) * 5, y2: b.y * TS - 4, age: -i * 0.06, life: 0.4 });
    } else if (e.k === 'spell') {
      B.fx.push({ k: 'spell', spell: SPELL_BY_ID[e.spell], x: e.x * TS, y: e.y * TS, age: 0, life: 1.1 });
      const s = sq(e.from); if (s) toast(`${s.name}: ${SPELL_BY_ID[e.spell]?.name || 'Special'}!`);
    } else if (e.k === 'capture') {
      const p = sim.field.posts[e.post];
      B.fx.push({ k: 'flash', x: p.x * TS, y: p.y * TS, age: 0, life: 0.8, side: e.side });
      if (B.side) toast(e.side === B.side ? (p.main ? 'Main post taken!' : 'Post captured!') : (p.main ? 'The main post has fallen!' : 'A post was lost!'), e.side === B.side ? 'good' : 'bad');
    } else if (e.k === 'heroDown') {
      const s = sq(e.id); if (s) toast(`${s.name} is down!`, s.side === B.side ? 'bad' : 'good');
    } else if (e.k === 'rout') {
      const s = sq(e.id); if (s && s.side === B.side) toast(`${s.name}'s squad is routing!`, 'bad');
    } else if (e.k === 'trap') {
      B.fx.push({ k: 'trap', x: e.x * TS, y: e.y * TS, age: 0, life: 0.4 });
    }
  }
}

// ---------- drawing ----------
function draw() {
  const sim = B.sim; if (!sim) return;
  cam.apply();
  ctx.drawImage(B.ground, 0, 0);
  const time = game.time;
  // traps
  const dt = img(DUNGEON_TILES);
  for (const tr of sim.field.traps) {
    const f = Math.floor(time * 4) % 4;
    const row = tr.kind === 'spikes' ? 128 : tr.kind === 'axe' ? 160 : 176;
    if (dt) ctx.drawImage(dt, 192 + f * 16, row, 16, 16, tr.x * TS - 8, tr.y * TS - 8, 16, 16);
  }
  // selected path
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel) : null;
  if (sel && sel.goal != null) {
    const p = sim.field.posts[sel.goal];
    ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -time * 10;
    ctx.beginPath(); ctx.moveTo(sel.x * TS, sel.y * TS); ctx.lineTo(p.x * TS, p.y * TS); ctx.stroke(); ctx.setLineDash([]);
  }
  // posts
  for (const p of sim.field.posts) {
    const ref = postRef(p, B.setup.defFid, B.setup.attFid);
    const w = p.main ? ref[3] * 0.75 : ref[3], hh = p.main ? ref[4] * 0.75 : ref[4];
    const col = p.owner === 'att' ? B.colors.att : p.owner === 'def' ? B.colors.def : '#d6d0c4';
    ctx.fillStyle = col; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (sel && sel.side === B.side && !p.camp) { ctx.strokeStyle = 'rgba(255,210,90,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x * TS, p.y * TS, 2.4 * TS, 1.6 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
    drawSpriteRef(ctx, ref, p.x * TS - w / 2, p.y * TS - hh + 8, w, hh);
    // banner
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(p.x * TS + w / 2 - 3, p.y * TS - hh, 1, 14);
    ctx.fillStyle = col; ctx.fillRect(p.x * TS + w / 2 - 2, p.y * TS - hh, 7, 5);
    if (p.prog > 0) {
      ctx.strokeStyle = p.by === 'att' ? B.colors.att : B.colors.def; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x * TS, p.y * TS - hh - 6, 5, -Math.PI / 2, -Math.PI / 2 + p.prog * Math.PI * 2); ctx.stroke();
    }
  }
  // drawables sorted by y
  const list = [];
  for (const f of B.fx) if (f.k === 'corpse') list.push({ y: f.y - 1, f });
  for (const s of sim.squads) {
    const r = B.render.get(s.id); if (!r) continue;
    const anim = s.state === 'fight' || s.state === 'shoot' ? 'attack' : s.state === 'move' || s.state === 'rout' ? 'walk' : 'idle';
    const flip = Math.cos(s.dir) < 0;
    s.soldiers.forEach((so, i) => { if (so.alive) list.push({ y: r.soldiers[i].y, s, so, p: r.soldiers[i], anim, flip, i }); });
    if (s.heroAlive) list.push({ y: r.hy, s, hero: true, p: { x: r.hx, y: r.hy }, anim, flip });
  }
  // squad markers under units
  for (const s of sim.squads) {
    if (s.state === 'dead') continue;
    const r = B.render.get(s.id);
    ctx.fillStyle = B.colors[s.side]; ctx.globalAlpha = s.id === B.sel ? 0.55 : 0.28;
    ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, 1.3 * TS, 0.85 * TS, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (s.id === B.sel) { ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r.x * TS, r.y * TS + 2, 1.35 * TS + Math.sin(time * 6), 0.9 * TS, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) {
    if (d.f) { const f = d.f; drawUnit(ctx, f.fid, f.unit, f.stage, 'death', Math.min(3, f.age * 7), f.x, f.y, f.flip, Math.max(0, 1 - Math.max(0, f.age - 3) / 3)); continue; }
    const s = d.s;
    if (d.hero) {
      drawHero(ctx, s.fid, s.gender, 1, d.anim === 'idle' ? 'walk' : d.anim, d.anim === 'idle' ? 0 : time * 7 + s.id, d.p.x, d.p.y, d.flip);
      ctx.fillStyle = '#0b0a10'; ctx.fillRect(d.p.x - 1 + (d.flip ? 5 : -5), d.p.y - 22, 1, 10);
      ctx.fillStyle = B.colors[s.side]; ctx.fillRect(d.p.x + (d.flip ? 5 : -5), d.p.y - 22, 5, 4);
    } else {
      drawUnit(ctx, s.fid, s.unit, d.so.s, d.anim, time * (d.anim === 'idle' ? 4 : 8) + d.i * 0.7, d.p.x, d.p.y, d.flip, s.state === 'rout' ? 0.7 : 1);
    }
  }
  // squad bars
  for (const s of sim.squads) {
    if (s.state === 'dead') continue;
    const r = B.render.get(s.id);
    const n = liveCount(s), max = s.soldiers.length;
    const x = r.x * TS - 9, y = r.y * TS - 26;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(x - 1, y - 1, 20, 6);
    ctx.fillStyle = B.colors[s.side]; ctx.fillRect(x, y, 18 * (max ? n / max : 0), 2);
    ctx.fillStyle = s.morale < 25 ? '#ff6a5a' : '#6bb6ff'; ctx.fillRect(x, y + 2, 18 * Math.max(0, s.morale) / 100, 2);
    if (s.special >= 1 && s.side === B.side) { ctx.fillStyle = '#ffd25a'; ctx.fillRect(x + 19, y - 1, 3, 6); }
  }
  // effects
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
    } else if (f.k === 'trap' && dt) {
      ctx.drawImage(dt, 192 + 48, 176, 16, 16, f.x - 8, f.y - 12, 16, 16);
    }
  }
}

// ---------- input ----------
function tap(sx, sy) {
  if (!B.started || B.ended || !B.side) return;
  const w = cam.toWorld(sx, sy);
  const wx = w.x / TS, wy = w.y / TS;
  const sim = B.sim;
  let best = null, bd = 1.6;
  for (const s of sim.squads) { if (s.state === 'dead') continue; const d = Math.hypot(s.x - wx, s.y - (wy + 0.3)); if (d < bd) { bd = d; best = s; } }
  if (best && best.side === B.side) { B.sel = best.id; refreshHUD(true); return; }
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel && s.state !== 'dead') : null;
  if (!sel) return;
  if (best && best.side !== B.side) { send({ type: 'chase', squad: sel.id, target: best.id }); toast(`Attacking ${best.name}`); return; }
  let post = null, pd = 3;
  for (const p of sim.field.posts) { const d = Math.hypot(p.x - wx, p.y - wy); if (d < pd) { pd = d; post = p; } }
  if (post) { send({ type: 'move', squad: sel.id, post: post.id }); return; }
  B.sel = null; refreshHUD(true);
}

function send(c) {
  if (B.client) net.send({ t: 'cmd', c });
  else command(B.sim, B.side, c);
  // instant local feedback on goal for the client
  if (B.client && c.type === 'move') { const s = B.sim.squads.find((q) => q.id === c.squad); if (s) s.goal = c.post; }
}

// ---------- HUD ----------
let hud = {};
function buildUI() {
  clearUI();
  hud.left = mount(h('div', { class: 'col scroll', style: { position: 'absolute', left: 'calc(4px + var(--sal))', top: 'calc(4px + var(--sat))', bottom: 'calc(4px + var(--sab))', width: LEFT - 6 + 'px', gap: '4px' } }));
  hud.top = mount(h('div', { class: 'topbar', style: { left: `calc(${LEFT}px + var(--sal))` } }));
  hud.bottom = mount(h('div', { style: { position: 'absolute', bottom: 'calc(4px + var(--sab))', left: `calc(${LEFT}px + var(--sal))`, right: 'calc(4px + var(--sar))', display: 'flex', gap: '4px', justifyContent: 'center', pointerEvents: 'none' } }));
  refreshHUD(true);
}

function refreshHUD(full) {
  if (!hud.left || !B.sim) return;
  const sim = B.sim;
  const mine = sim.squads.filter((s) => s.side === B.side);
  // left: own squads
  hud.left.innerHTML = '';
  for (const s of (B.side ? mine : sim.squads.filter((q) => q.side === 'att'))) {
    const dead = s.state === 'dead';
    const n = liveCount(s);
    const st = B.state && s.hero != null ? hero(B.state, s.hero) : null;
    const icon = s.hero != null && st ? portrait(st, 1.5) : unitIcon(s.fid, s.unit, 1, 1.5);
    const el = h('div', { class: 'card' + (s.id === B.sel ? ' sel' : '') + (dead ? ' dim' : ''), style: { padding: '3px', flexDirection: 'column', alignItems: 'stretch', gap: '2px', pointerEvents: 'auto' }, onClick: () => { if (!dead && B.side) { B.sel = s.id; refreshHUD(true); } } },
      h('div', { class: 'row', style: { gap: '3px' } }, icon, h('span', { style: { fontSize: '11px' } }, dead ? '✝' : `${n}`)),
      bar(s.soldiers.length ? n / s.soldiers.length : 0), bar(Math.max(0, s.morale) / 100, 'mor'),
      s.special >= 1 && !dead && s.heroAlive && B.side ? btn('★', () => { send({ type: 'special', squad: s.id }); }, 'small primary') : null);
    hud.left.appendChild(el);
  }
  const posts = sim.field.posts;
  const ownP = B.side ? posts.filter((p) => p.owner === B.side).length : 0;
  const left = Math.max(0, 240 - sim.t);
  hud.top.innerHTML = '';
  hud.top.append(...[
    h('span', { class: 'chip' }, B.setup.place),
    h('span', { class: 'chip' }, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`),
    B.side ? h('span', { class: 'chip' }, `Posts ${ownP}/${posts.length}`) : h('span', { class: 'chip' }, 'Spectating'),
    h('span', { class: 'grow' }),
    !B.client && net.role === 'single' ? btn(B.paused ? '▶' : '❚❚', () => { B.paused = !B.paused; refreshHUD(true); }, 'small') : null,
    !B.client && net.role === 'single' ? btn(B.speed === 1 ? '1x' : '2x', () => { B.speed = B.speed === 1 ? 2 : 1; refreshHUD(true); }, 'small') : null,
    B.side ? btn('Retreat', () => modal('Sound the retreat?', h('div', {}, 'Your army withdraws and the battle is lost. Heroes still standing escape.'), [['Keep fighting'], ['Retreat', () => send({ type: 'retreat' }), 'danger']]), 'danger small') : null,
  ].filter(Boolean));
  // bottom: formation controls for the selected squad
  const sel = B.sel != null ? sim.squads.find((s) => s.id === B.sel && s.state !== 'dead') : null;
  if (full || hud.bottomSel !== (sel && sel.id + sel.formation)) {
    hud.bottomSel = sel && sel.id + sel.formation;
    hud.bottom.innerHTML = '';
    if (sel) {
      const wrap = h('div', { class: 'row', style: { pointerEvents: 'auto', background: 'rgba(20,18,28,.86)', padding: '4px', borderRadius: '3px', border: '2px solid #6b4a2a' } },
        h('span', { style: { fontSize: '11px', maxWidth: '110px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, sel.name),
        ...FORMATION_IDS.map((f) => btn(FORMATIONS[f].name, () => { send({ type: 'formation', squad: sel.id, formation: f }); sel.formation = f; refreshHUD(true); }, 'small' + (sel.formation === f ? ' sel' : ''))),
        btn('Hold', () => send({ type: 'hold', squad: sel.id }), 'small'));
      hud.bottom.appendChild(wrap);
    } else if (B.started && B.side) {
      hud.bottom.appendChild(h('div', { class: 'chip', style: { pointerEvents: 'none' } }, 'Tap a squad, then tap a post or an enemy'));
    }
  }
}

function intro() {
  const st = B.setup;
  const side = B.side;
  const body = h('div', { class: 'col' },
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: st.colors.att } }), h('span', {}, `${st.attName} — attacking`)),
    h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: st.colors.def } }), h('span', {}, `${st.defName} — defending`)),
    h('div', { class: 'muted' }, side === 'att' ? 'Take the enemy main post (the town) to win. Capture outposts on the way to weaken them.'
      : side === 'def' ? 'Hold your main post until time runs out, or rout the attackers.' : 'You are watching this battle.'),
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Formations: Wedge beats Line, Line beats Square, Square beats Wedge. Loose is fast and resists arrows. ★ = hero special ready.'));
  const start = () => {
    if (net.role === 'host') { net.send({ t: 'battleGo' }); }
    B.started = true; refreshHUD(true);
  };
  if (B.client) {
    net.on('battleGo', () => { B.started = true; m && m.close(); refreshHUD(true); });
    const m = modal(`Battle of ${st.place}`, body, [], {});
    return;
  }
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
  const lines = sim.squads.filter((s) => s.hero != null).map((s) => {
    const lost = s.soldiers.filter((x) => !x.alive).length;
    return h('div', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'swatch', style: { background: B.colors[s.side] } }),
      h('span', { class: 'grow' }, s.name), h('span', { class: s.heroAlive ? 'muted' : 'bad' }, `${s.heroAlive ? '' : 'defeated · '}lost ${lost}/${s.soldiers.length}`));
  });
  const title = won == null ? (result.winner === 'att' ? 'Attackers win' : 'Defenders win') : won ? 'Victory!' : 'Defeat';
  modal(title, h('div', { class: 'col' }, result.retreated ? h('div', { class: 'muted' }, `${result.retreated === 'att' ? 'The attackers' : 'The defenders'} retreated.`) : null, lines),
    [['Continue', () => go('campaign', { resume: B.client ? true : result }), 'primary']]);
}
