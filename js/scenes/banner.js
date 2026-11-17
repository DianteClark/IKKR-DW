// Banner maker: design the banner that flies over every land your realm holds.
import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, toast } from '../engine/ui.js';
import { BANNER_COLORS, PATTERNS, PATTERN_NAMES, EMBLEMS, EMBLEM_NAMES, bannerEl, loadMyBanner, saveMyBanner, randomBanner } from '../engine/banner.js';
import { sfx, music } from '../engine/audio.js';

let B = null, back = 'title';

function swatches(field) {
  return h('div', { class: 'row wrap', style: { gap: '4px' } }, BANNER_COLORS.map((c) => h('button', {
    class: 'swatch-btn' + (B[field] === c ? ' on' : ''), style: { background: c }, 'aria-label': c,
    onClick: () => { B[field] = c; sfx('click'); render(); },
  })));
}
function choices(list, names, field, preview) {
  return h('div', { class: 'row wrap', style: { gap: '4px' } }, list.map((id) => {
    const el = btn('', () => { B[field] = id; sfx('click'); render(); }, 'small' + (B[field] === id ? ' good' : ''));
    el.replaceChildren(preview ? bannerEl({ ...B, [field]: id }, 1.6) : names[id]);
    el.title = names[id];
    return el;
  }));
}

function render() {
  clearUI();
  const big = bannerEl(B, 7);
  mount(h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row' },
        btn('‹ Back', () => { sfx('close'); go(back); }, 'small'),
        h('h2', { class: 'grow', style: { margin: 0 } }, 'Your banner'),
        btn('Random', () => { B = randomBanner(Math.random); sfx('click'); render(); }, 'small'),
        btn('Save', () => { saveMyBanner(B); sfx('levelup'); toast('Banner saved — it will fly over your lands in your next campaign', 'good'); go(back); }, 'small primary')),
      h('div', { class: 'row grow', style: { minHeight: 0, alignItems: 'flex-start', gap: '14px' } },
        h('div', { class: 'col', style: { alignItems: 'center', flex: 'none', paddingTop: '6px' } }, big,
          h('div', { class: 'muted small-text', style: { maxWidth: '120px', textAlign: 'center' } }, 'Flies over every land your realm holds.')),
        h('div', { class: 'scroll grow col', style: { minHeight: 0, gap: '6px' } },
          h('b', {}, 'Field colour'), swatches('bg'),
          h('b', {}, 'Pattern'), choices(PATTERNS, PATTERN_NAMES, 'pattern', true),
          h('b', {}, 'Pattern colour'), swatches('fg'),
          h('b', {}, 'Emblem'), choices(EMBLEMS, EMBLEM_NAMES, 'emblem', true),
          h('b', {}, 'Emblem colour'), swatches('ec'))))));
}

registerScene('banner', {
  enter(args = {}) {
    back = args.back || 'title';
    music.start('title');
    B = loadMyBanner() || randomBanner(Math.random);
    render();
  },
});
