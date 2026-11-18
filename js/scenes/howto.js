import { picon } from '../engine/icons.js';
import { startPractice } from './battle.js';
// How to play: short illustrated pages, reachable from the title screen and the in-game menu.
import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, modal } from '../engine/ui.js';
import { sfx, music } from '../engine/audio.js';

export const PAGES = [
  { title: 'Your goal', lines: [
    'You start as a small village with 3 heroes. Grow it into a kingdom, then an empire, until every realm bows to you (or to you and the allies you invited).',
    'Each turn is one month. Three months make a season, twelve a year. Seasons change the land, harvests and weather.',
    'You only lose when your last hero falls. A landless band of heroes can still rise again.',
  ] },
  { title: 'The map', lines: [
    'Drag to look around, pinch to zoom. The minimap (bottom right) jumps anywhere. The house button takes you home; "Idle" finds armies without orders.',
    'Banners show who owns a land. No banner = free hamlet. Border guards stand along each realm\'s edge.',
    'Tap a land to open its panel: owner, sites, heroes there and what you can do.',
    'Fog of war hides what your lands, heroes and allies can\'t see.',
  ] },
  { title: 'Heroes and orders', lines: [
    'Each hero leads a squad. Heroes of your realm in the same land form an army automatically: one card, one set of orders. Split it to order heroes one by one.',
    'Each month the army gets up to four orders that fit where it stands. At home: Rest & train, Move, Attack. In a free hamlet: Protect, Take, Explore. Next to enemy walls: Attack or Besiege.',
    'Everything else possible there (plunder, courting a wanderer, fighting foreign heroes) is under "Act here…".',
    'Protecting a hamlet and besieging a town last for months. The banner on the army shows progress, like "Besieging Ostvale · month 2 of 3". Tap its cross to stop.',
    'End Turn shows what still needs you (idle armies, offers, children to name, callings). Walk through them, or skip all and end the month.',
  ] },
  { title: 'Hero stats', lines: [
    'ATK — attack: how hard the hero and squad hit.',
    'DEF — defence: how much damage the squad shrugs off.',
    'LEAD — leadership: how many soldiers the hero can command (squad size) and how fast they change formation.',
    'INT — intellect: stratagem points in battle and the power of the hero\'s special.',
    'SQD 4/5 means 4 soldiers out of a possible 5. Rest to fill the gap. Squads grow as heroes level up.',
    'At level 5 a hero picks a calling: Commander, Duelist, Strategist or Scout.',
  ] },
  { title: 'Soldiers and races', lines: [
    'Soldiers who survive battles rank up, evolve into stronger units, and finally become named Elites.',
    'Any hero can lead any troops your realm can raise. A hero leading their own race fights better.',
    'Mounted troops need Stables, flyers an Aerie, casters a Mage Tower, beasts a Beast Pit.',
    'Beasts like griffins fight and can become Elites, but only people can lead.',
  ] },
  { title: 'Battles', lines: [
    'Tap one of your squads (or All), then tap a base to march there, a road to hold it, or an enemy to attack.',
    'Wedge beats Line, Line beats Square, Square beats Wedge. Hitting from the side or rear deals extra damage.',
    'Take the enemy\'s main base to win as the attacker; hold out or rout them to win as the defender.',
    'Use stratagems (right side), call in your reserve, and use hero skills when their buttons light up.',
  ] },
  { title: 'Your realm', lines: [
    'Gold pays for soldiers and buildings; food feeds your armies; Order keeps the peace and steadies your armies. Tap any of them in the top bar to see why it changes.',
    'Order falls with high taxes, famine, defeats and plunder; below 24 lands may revolt, below 12 you can be overthrown.',
    'The Steward runs taxes, rations, edicts, buildings and town growth each month (Grow, Defend or Prosper) and reports in one line. Turn him off in Realm to do it yourself.',
    'Gather 5 heroes and your village becomes a kingdom.',
    'Heroes marry, have children and pass on their strengths. Name your children when they are born.',
    'Offers and demands from other realms arrive as Accept / Refuse cards in the month summary. Diplomacy lists every realm with one main action. Rulers have temperaments: some never forget.',
    'Trade caravans, weather and bandits run on their own; you will see what they did in the month summary.',
  ] },
  { title: 'Playing together', lines: [
    'Multiplayer: one player hosts (choosing map and rules) and shares the room code; the other joins.',
    'Both give orders, then both press End Turn. Battles between you are fought live.',
    'If the connection drops, the game reconnects by itself. Saved two-player games can be resumed from Continue by either player.',
  ] },
];

function pageView(i, onNav) {
  const p = PAGES[i];
  return h('div', { class: 'col', style: { gap: '8px' } },
    h('div', { class: 'row wrap', style: { gap: '4px' } }, PAGES.map((q, j) => btn(q.title, () => onNav(j), 'tiny' + (j === i ? ' sel' : '')))),
    h('h3', { style: { margin: '4px 0 0' } }, p.title),
    p.lines.map((l) => h('div', { class: 'howto-line' }, l)));
}

// in-game: as a modal
export function howToModal(start = 0) {
  let i = start, m;
  const nav = (j) => { i = j; sfx('click'); m.box.querySelector('.body').replaceChildren(pageView(i, nav)); };
  m = modal('How to play', pageView(i, nav), [['Close', null, 'primary']], { dismiss: true, width: '720px' });
}

registerScene('howto', {
  enter() {
    music.start('title');
    let i = 0;
    const render = () => {
      clearUI();
      mount(h('div', { class: 'screen fade-in' },
        h('div', { class: 'panel col grow', style: { minHeight: 0 } },
          h('div', { class: 'row' }, btn('‹ Back', () => { sfx('close'); go('title'); }, 'small'), h('h2', { class: 'grow', style: { margin: 0 } }, 'How to play'),
            btn(h('span', { class: 'row', style: { gap: '5px' } }, picon('swords', 14), 'Practice battle'), () => { sfx('horn'); startPractice({ back: 'howto' }); }, 'small good'),
            i > 0 ? btn('‹', () => { i--; sfx('click'); render(); }, 'small') : null,
            i < PAGES.length - 1 ? btn('Next ›', () => { i++; sfx('click'); render(); }, 'small primary') : btn('Done', () => go('title'), 'small primary')),
          h('div', { class: 'scroll grow', style: { minHeight: 0 } }, pageView(i, (j) => { i = j; sfx('click'); render(); })))));
    };
    render();
  },
});
