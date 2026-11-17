// Tiny DOM helpers for the overlay UI.
import { url, img } from './assets.js';

export const uiRoot = document.getElementById('ui');

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
  return h('button', { class: 'btn ' + cls, onClick: (e) => { e.stopPropagation(); onClick && onClick(e); } }, label);
}

export function clearUI() { uiRoot.innerHTML = ''; }

export function mount(el) { uiRoot.appendChild(el); return el; }

export function modal(title, body, actions = [], opts = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const acts = actions.map(([label, fn, cls]) => btn(label, () => { if (fn && fn(close) === false) return; close(); }, cls));
  const box = h('div', { class: 'panel modal', style: opts.width ? { maxWidth: opts.width } : null },
    title ? h('h2', {}, title) : null,
    h('div', { class: 'body' }, body),
    acts.length ? h('div', { class: 'row wrap', style: { marginTop: '8px', justifyContent: 'flex-end' } }, acts) : null);
  back.appendChild(box);
  if (opts.dismiss) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  uiRoot.appendChild(back);
  return { close, el: back, box };
}

export function toast(text, cls = '') {
  const t = h('div', { class: 'chip toast ' + cls }, text);
  uiRoot.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

// A sprite cut from a sheet, shown as a div with a scaled background.
export function sprite(src, sx, sy, sw, sh, scale = 2, extra = {}) {
  const im = img(src);
  const W = im ? im.width : 0, H = im ? im.height : 0;
  return h('span', {
    class: 'spr ' + (extra.class || ''),
    style: {
      width: sw * scale + 'px', height: sh * scale + 'px',
      backgroundImage: `url("${url(src)}")`,
      backgroundPosition: `${-sx * scale}px ${-sy * scale}px`,
      backgroundSize: W ? `${W * scale}px ${H * scale}px` : 'auto',
      ...(extra.style || {}),
    },
  });
}

export function bar(frac, cls = '') {
  return h('div', { class: 'bar ' + cls }, h('i', { style: { width: Math.max(0, Math.min(1, frac)) * 100 + '%' } }));
}
