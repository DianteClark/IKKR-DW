// Hall of Fame: finished campaigns and achievements kept on this device.
import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, chip, tabs } from '../engine/ui.js';
import { hallOfFame, ACHIEVEMENTS, unlockedAchievements } from '../game/legacy.js';
import { bannerEl } from '../engine/banner.js';
import { FACTIONS } from '../data/art.js';
import { portrait } from '../campaign/widgets.js';
import { sfx, music } from '../engine/audio.js';

let tab = 'fame';
function render() {
  clearUI();
  const list = hallOfFame(), got = unlockedAchievements();
  const fame = list.length ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } }, list.map((e) => h('div', { class: 'card', style: { alignItems: 'flex-start', gap: '10px' } },
    e.banner ? bannerEl(e.banner, 1.6) : null,
    h('div', { class: 'col grow', style: { gap: '3px', minWidth: 0 } },
      h('b', { class: 'ellipsis' }, e.realm),
      h('div', { class: 'row wrap', style: { gap: '4px' } }, chip(e.result === 'victory' ? 'Victory' : e.result === 'alliance' ? 'Alliance victory' : 'Fallen', e.result === 'defeat' ? 'bad' : 'good'), chip(`${e.years} years`), chip(`${e.lands} lands`), chip(FACTIONS[e.fid] ? FACTIONS[e.fid].race : '')),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, `Ruler: ${e.ruler}`),
      h('div', { class: 'row wrap', style: { gap: '6px' } }, (e.heroes || []).map((x) => h('span', { class: 'row', style: { gap: '4px' } }, portrait(x, 1.2), h('span', { style: { fontSize: '12px' } }, `${x.name} · Lv ${x.level}`)))))))) : h('div', { class: 'muted' }, 'No campaigns finished yet. Every campaign you win or lose is remembered here.');
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  const ach = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } }, ACHIEVEMENTS.map((a) => h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '2px', opacity: got[a.id] ? 1 : 0.5, borderColor: got[a.id] ? '#ffd86b' : undefined } },
    h('b', { class: got[a.id] ? 'gold' : '' }, (got[a.id] ? '★ ' : '☆ ') + a.name),
    h('span', { class: 'muted', style: { fontSize: '12px' } }, a.desc + (a.unlock ? ' · unlocks a banner emblem' : '')))));
  mount(h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row' }, btn('‹ Back', () => { sfx('close'); go('title'); }, 'small'), h('h2', { class: 'grow', style: { margin: 0 } }, 'Hall of Fame'), chip(`${n}/${ACHIEVEMENTS.length} achievements`, 'gold')),
      tabs([{ id: 'fame', label: 'Dynasties' }, { id: 'ach', label: 'Achievements' }], (id) => { tab = id; sfx('click'); render(); }, tab),
      h('div', { class: 'scroll grow', style: { minHeight: 0, paddingTop: '6px' } }, tab === 'fame' ? fame : ach))));
}
registerScene('fame', { enter() { music.start('title'); render(); } });
