// DOM helpers and the UI component kit for the overlay.
import { url, img, loadImage } from './assets.js';

export const uiRoot = document.getElementById('ui');

// optional click sound hook (set by audio.js to avoid an import cycle)
let clickHook = null;
export function setClickHook(fn) { clickHook = fn; }

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function btn(label, onClick, cls = '') {
  return h('button', { class: 'btn ' + cls, onClick: (e) => { e.stopPropagation(); clickHook && clickHook(cls); onClick && onClick(e); } }, label);
}

export function iconBtn(iconEl, label, onClick, cls = '') {
  return h('button', { class: 'btn iconbtn ' + cls, onClick: (e) => { e.stopPropagation(); clickHook && clickHook(cls); onClick && onClick(e); } }, iconEl, label ? h('span', { class: 'lbl' }, label) : null);
}

export function clearUI() { uiRoot.innerHTML = ''; }

export function mount(el) { uiRoot.appendChild(el); return el; }

function closeAnimated(back) {
  if (back._closing) return;
  back._closing = true;
  back.classList.add('closing');
  setTimeout(() => back.remove(), 160);
}

// actions: [[label, fn(close) -> false keeps open, cls], ...]
export function modal(title, body, actions = [], opts = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { closeAnimated(back); opts.onClose && opts.onClose(); };
  const acts = actions.map(([label, fn, cls]) => btn(label, () => { if (fn && fn(close) === false) return; close(); }, cls));
  const head = title ? h('div', { class: 'modal-head' }, opts.icon || null, h('h2', {}, title), opts.dismiss ? btn('✕', close, 'tiny ghost') : null) : null;
  const box = h('div', { class: 'panel modal', style: opts.width ? { maxWidth: opts.width } : null },
    head,
    h('div', { class: 'body' }, body),
    acts.length ? h('div', { class: 'actions' }, acts) : null);
  back.appendChild(box);
  if (opts.dismiss) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  uiRoot.appendChild(back);
  return { close, el: back, box };
}

export function confirm(title, text, yes = 'Confirm', no = 'Cancel', cls = 'primary') {
  return new Promise((res) => {
    modal(title, h('div', { class: 'dim-text' }, text), [[no, () => res(false)], [yes, () => res(true), cls]]);
  });
}

// drawer from the right or bottom
function overlayCount() { const n = uiRoot.querySelectorAll('.sheet-back, .modal-back:not(.closing)').length; document.body.classList.toggle('overlay-open', n > 0); }
const overlayObs = new MutationObserver(() => overlayCount());
overlayObs.observe(uiRoot, { childList: true });
export function sheet(title, body, actions = [], opts = {}) {
  const side = opts.side || 'right';
  const back = h('div', { class: 'sheet-back' });
  const close = () => { closeAnimated(back); opts.onClose && opts.onClose(); };
  const acts = actions.map(([label, fn, cls]) => btn(label, () => { if (fn && fn(close) === false) return; close(); }, cls));
  const box = h('div', { class: 'sheet ' + side },
    h('div', { class: 'panel' },
      h('div', { class: 'modal-head' }, h('h2', {}, title), btn('✕', close, 'tiny ghost')),
      h('div', { class: 'body scroll grow', style: { minHeight: 0 } }, body),
      acts.length ? h('div', { class: 'actions' }, acts) : null));
  back.appendChild(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  uiRoot.appendChild(back);
  return { close, el: back, box };
}

export function toast(text, cls = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
  const t = h('div', { class: 'chip toast ' + cls }, text);
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 2700);
}

// big center announcement: banner('VICTORY', 'good', 'The town is yours')
export function banner(text, cls = '', sub = '') {
  let box = document.getElementById('banners');
  if (!box) { box = h('div', { id: 'banners' }); document.body.appendChild(box); }
  box.innerHTML = '';
  const b = h('div', { class: 'banner ' + cls }, h('div', { class: 'ribbon' }), h('div', { class: 'txt' }, text), sub ? h('div', { class: 'sub' }, sub) : null);
  box.appendChild(b);
  setTimeout(() => b.remove(), 2200);
  return b;
}

// A sprite cut from a sheet, shown as a span with a scaled background.
export function sprite(src, sx, sy, sw, sh, scale = 2, extra = {}) {
  const im = img(src);
  const W = im ? im.width : 0, H = im ? im.height : 0;
  const el = h('span', {
    class: 'spr ' + (extra.class || ''),
    style: {
      width: sw * scale + 'px', height: sh * scale + 'px',
      backgroundImage: `url("${url(src)}")`,
      backgroundPosition: `${-sx * scale}px ${-sy * scale}px`,
      backgroundSize: W ? `${W * scale}px ${H * scale}px` : 'auto',
      ...(extra.style || {}),
    },
  });
  if (!W) loadImage(src).then((i) => { if (i && i.width) el.style.backgroundSize = `${i.width * scale}px ${i.height * scale}px`; });
  return el;
}

// UI icons from the HAS icon sheet (16x16 cells, 6 cols)
const ICON_SRC = 'assets/has2020/UI/Separate/Icons/_Icons.png';
const ICONS = { amulet: [0, 0], helm: [1, 0], armor: [2, 0], flag: [3, 0], screen: [4, 0], book: [5, 0], sword: [0, 1], chest: [1, 1], shield: [2, 1], castle: [3, 1], save: [4, 1], ladder: [5, 1], ring: [0, 2], pants: [1, 2], glove: [2, 2], blade: [3, 2], hammer: [4, 2], pick: [5, 2], boots: [1, 3], axe: [3, 3], scythe: [4, 3], whip: [5, 3], orb: [3, 4], wand: [4, 4] };
export function icon(name, scale = 1.25) {
  const c = ICONS[name] || [3, 0];
  return sprite(ICON_SRC, c[0] * 16, c[1] * 16, 16, 16, scale, { class: 'ico' });
}

export function bar(frac, cls = '') {
  return h('div', { class: 'bar ' + cls }, h('i', { style: { width: Math.max(0, Math.min(1, frac)) * 100 + '%' } }));
}

export function panel(opts = {}, ...children) {
  return h('div', { class: 'panel ' + (opts.class || ''), style: opts.style || null }, opts.title ? h('h2', {}, opts.title) : null, ...children);
}

export function chip(text, cls = '') { return h('span', { class: 'chip ' + cls }, text); }

export function statRow(label, value) { return h('div', { class: 'statrow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value)); }

// items: [{ id, label }], returns element; onChange(id)
export function tabs(items, onChange, active) {
  let cur = active ?? (items[0] && items[0].id);
  const el = h('div', { class: 'tabs' });
  const draw = () => {
    el.innerHTML = '';
    for (const it of items) el.appendChild(h('button', { class: 'tab' + (it.id === cur ? ' on' : ''), onClick: () => { if (cur === it.id) return; cur = it.id; clickHook && clickHook('tab'); draw(); onChange && onChange(it.id); } }, it.label));
  };
  draw();
  return el;
}

// options: [{ value, label }] or strings
export function segmented(options, value, onChange) {
  let cur = value;
  const el = h('div', { class: 'seg' });
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const draw = () => {
    el.innerHTML = '';
    for (const o of opts) el.appendChild(h('button', { class: o.value === cur ? 'on' : '', onClick: (e) => { e.stopPropagation(); cur = o.value; clickHook && clickHook('seg'); draw(); onChange && onChange(o.value); } }, o.label));
  };
  draw();
  return el;
}

// blue (left / attacker) vs red (right / defender) odds
export function oddsBar(pAttacker, labels = {}, known = true) {
  const p = Math.max(0.02, Math.min(0.98, pAttacker));
  const pct = Math.round(p * 100);
  return h('div', { class: 'odds' + (known ? '' : ' unknown') },
    h('div', { class: 'labels' }, h('span', { class: 'l' }, labels.left || 'You'), h('span', { class: 'r' }, labels.right || 'Enemy')),
    h('div', { class: 'track' },
      h('div', { class: 'a', style: { width: pct + '%' } }), h('div', { class: 'b' }),
      h('div', { class: 'mid', style: { left: `calc(${pct}% - 1px)` } }),
      h('div', { class: 'q' }, known ? `${pct}% · ${100 - pct}%` : `~${pct}% ?`)));
}

export function stratagemCard({ name, icon: ic, cost, desc, selected, disabled, onClick }) {
  return h('div', { class: 'card strat tap' + (selected ? ' sel' : '') + (disabled ? ' disabled' : ''), onClick: (e) => { e.stopPropagation(); clickHook && clickHook('card'); onClick && onClick(e); } },
    cost != null ? h('div', { class: 'cost' }, cost) : null,
    h('div', { class: 'art' }, ic || null),
    h('div', { class: 'name' }, name),
    desc ? h('div', { class: 'desc' }, desc) : null);
}

export function toggle(label, on, onChange) {
  let cur = !!on;
  const el = h('div', { class: 'toggle' + (cur ? ' on' : ''), onClick: () => { cur = !cur; el.classList.toggle('on', cur); clickHook && clickHook('toggle'); onChange && onChange(cur); } }, h('span', { class: 'knob' }), h('span', {}, label));
  return el;
}

export function stepDots(n, i) { return h('div', { class: 'step-dots' }, Array.from({ length: n }, (_, k) => h('i', { class: k === i ? 'on' : '' }))); }
