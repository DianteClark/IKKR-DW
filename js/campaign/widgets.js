// Reusable UI bits: portraits, unit icons, hero cards, item icons.
import { h, sprite, bar } from '../engine/ui.js';
import { FACTIONS, portraitRef, ITEMS } from '../data/art.js';
import { UNIT_SHEETS } from '../data/units.js';
import { unitName, squadCap, heroTotals, isRanged, RANKS, FORMATIONS } from '../game/rules.js';
import { rarityColor } from '../game/items.js';

export function portrait(hero, scale = 2) {
  const r = portraitRef(hero.fid, hero.portrait);
  return sprite(r[0], r[1], r[2], 16, 16, scale, { style: { border: '2px solid #0b0a10', borderRadius: '2px', backgroundColor: '#433a5c' } });
}

export function unitIcon(fid, ui, stage = 1, scale = 2) {
  const sh = UNIT_SHEETS[fid], u = sh.units[ui];
  const el = sprite(sh.src, sh.anims.idle[0], u.y[stage === 2 ? 1 : 0], 16, 16, scale);
  if (stage === 2 && u.tint2) el.style.filter = 'sepia(1) saturate(2.4) hue-rotate(-12deg) brightness(1.15)';
  return el;
}

export function itemIcon(it, scale = 2) {
  const el = sprite(ITEMS, it.icon[0] * 16, it.icon[1] * 16, 16, 16, scale, { style: { border: `2px solid ${rarityColor(it.rarity)}`, borderRadius: '2px', backgroundColor: '#1b1726' } });
  return el;
}

export function troopSummary(hero) {
  const s1 = hero.troops.filter((t) => t.s === 1).length, s2 = hero.troops.length - s1;
  return { s1, s2, cap: squadCap(hero) };
}

export function heroCard(state, hero, opts = {}) {
  const k = hero.kingdom >= 0 ? state.kingdoms[hero.kingdom] : null;
  const ts = troopSummary(hero);
  const t = heroTotals(hero, state.items);
  const stage = ts.s2 > ts.s1 ? 2 : 1;
  const card = h('div', { class: 'card ' + (opts.sel ? 'sel ' : '') + (opts.dim ? 'dim' : ''), onClick: opts.onClick },
    portrait(hero, 2),
    h('div', { class: 'col grow', style: { gap: '3px', minWidth: 0 } },
      h('div', { class: 'row', style: { gap: '4px' } },
        k ? h('span', { class: 'swatch', style: { background: k.color } }) : null,
        h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, hero.name),
        h('span', { class: 'tag' }, 'Lv ' + hero.level)),
      h('div', { class: 'row', style: { gap: '4px' } },
        unitIcon(hero.fid, hero.unit, stage, 1.5),
        h('span', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
          `${unitName(hero.fid, hero.unit, stage)} ${hero.troops.length}/${ts.cap}${ts.s2 ? ` (${ts.s2}★)` : ''}${isRanged(hero.fid, hero.unit) ? ' ·ranged' : ''}`)),
      opts.stats ? h('div', { class: 'muted', style: { fontSize: '11px' } }, `ATK ${t.atk} DEF ${t.def} LEAD ${t.lead} INT ${t.int}`) : null,
      h('div', { class: 'row', style: { gap: '4px' } },
        h('div', { class: 'grow' }, bar(hero.morale / 100, 'mor')),
        opts.order !== false && hero.order ? h('span', { class: 'tag', style: { color: hero.order.type === 'attack' ? '#ff8a7a' : '#ffd25a' } }, orderLabel(state, hero.order)) : null),
    ),
    opts.extra || null,
  );
  return card;
}

export function orderLabel(state, o) {
  if (!o) return '';
  const t = o.target != null ? state.territories[o.target].name : '';
  return { attack: '⚔ ' + t, move: '→ ' + t, rest: 'Rest', drill: 'Drill', recruit: 'Recruit' }[o.type];
}

export function factionBadge(fid, scale = 1) {
  const r = FACTIONS[fid].town(2);
  return sprite(r[0], r[1], r[2], r[3], r[4], scale * (64 / r[3]) * 0.6);
}

export { RANKS, FORMATIONS };
