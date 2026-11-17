// Banner maker: design the banner that flies over every land your realm holds.
import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, toast, tabs } from '../engine/ui.js';
import {
  BANNER_COLORS, PATTERNS, PATTERN_NAMES, EMBLEMS, EMBLEM_NAMES, SHAPES, SHAPE_NAMES, TRIMS, TRIM_NAMES,
  bannerEl, emblemEl, loadMyBanner, saveMyBanner, randomBanner, normalize,
} from '../engine/banner.js';
import { sfx, music } from '../engine/audio.js';

let B = null, back = 'title', tab = 'look', colorField = 'bg';

const set = (k, v) => { B[k] = v; sfx('click'); render(); };

function palette(field) {
  return h('div', { class: 'bm-palette' }, BANNER_COLORS.map((c) => h('button', {
    class: 'swatch-btn' + (B[field] === c ? ' on' : ''), style: { background: c }, 'aria-label': c, onClick: () => set(field, c),
  })));
}
function tile(label, el, on, onClick) {
  return h('button', { class: 'bm-tile' + (on ? ' on' : ''), onClick }, el, h('span', {}, label));
}

function content() {
  if (tab === 'look') {
    return h('div', { class: 'col', style: { gap: '8px' } },
      h('b', {}, 'Shape'),
      h('div', { class: 'bm-grid' }, SHAPES.map((s) => tile(SHAPE_NAMES[s], bannerEl({ ...B, shape: s }, 1.5), B.shape === s, () => set('shape', s)))),
      h('b', {}, 'Trim'),
      h('div', { class: 'bm-grid' }, Object.keys(TRIMS).map((t) => tile(TRIM_NAMES[t], bannerEl({ ...B, trim: t }, 1.5), B.trim === t, () => set('trim', t)))));
  }
  if (tab === 'colors') {
    const which = [['bg', 'Field'], ['fg', 'Pattern'], ['ec', 'Emblem']];
    return h('div', { class: 'col', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '6px' } }, which.map(([k, l]) => btn(h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'swatch', style: { background: B[k] } }), l), () => { colorField = k; sfx('click'); render(); }, 'small' + (colorField === k ? ' good' : '')))),
      palette(colorField),
      h('b', {}, 'Emblem style'),
      h('div', { class: 'row', style: { gap: '6px' } },
        btn('One colour', () => set('style', 'tint'), 'small' + (B.style !== 'full' ? ' good' : '')),
        btn('Full colour', () => set('style', 'full'), 'small' + (B.style === 'full' ? ' good' : ''))));
  }
  if (tab === 'pattern') return h('div', { class: 'bm-grid' }, PATTERNS.map((p) => tile(PATTERN_NAMES[p], bannerEl({ ...B, pattern: p, emblem: 'none' }, 1.5), B.pattern === p, () => set('pattern', p))));
  return h('div', { class: 'bm-grid small' }, EMBLEMS.map((e) => tile(EMBLEM_NAMES[e], e === 'none' ? h('span', { class: 'muted', style: { width: '32px', height: '32px', display: 'grid', placeItems: 'center' } }, '—') : emblemEl(B, e, 2), B.emblem === e, () => set('emblem', e))));
}

function render() {
  clearUI();
  mount(h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row' },
        btn('‹ Back', () => { sfx('close'); go(back); }, 'small'),
        h('h2', { class: 'grow', style: { margin: 0 } }, 'Your banner'),
        btn('🎲', () => { B = randomBanner(Math.random); sfx('click'); render(); }, 'small'),
        btn('Save', () => { saveMyBanner(B); sfx('levelup'); toast('Banner saved: it flies over your lands in your next campaign', 'good'); go(back); }, 'small primary')),
      h('div', { class: 'row grow', style: { minHeight: 0, alignItems: 'stretch', gap: '12px' } },
        h('div', { class: 'bm-stage' }, bannerEl(B, 6, true)),
        h('div', { class: 'col grow', style: { minHeight: 0 } },
          tabs([{ id: 'look', label: 'Shape' }, { id: 'colors', label: 'Colours' }, { id: 'pattern', label: 'Pattern' }, { id: 'emblem', label: 'Emblem' }], (id) => { tab = id; sfx('click'); render(); }, tab),
          h('div', { class: 'scroll grow', style: { minHeight: 0, paddingTop: '6px' } }, content()))))));
}

registerScene('banner', {
  enter(args = {}) {
    back = args.back || 'title';
    music.start('title');
    B = loadMyBanner() || randomBanner(Math.random);
    B = normalize(B);
    render();
  },
});
