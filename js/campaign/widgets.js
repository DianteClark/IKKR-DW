import { bannerEl } from '../engine/banner.js';
// Reusable game widgets: portraits, unit icons, hero/unit cards, item icons, kingdom badges.
import { h, sprite, bar } from '../engine/ui.js';
import { FACTIONS, portraitRef, ITEMS } from '../data/art.js';
import { UNIT_SHEETS } from '../data/units.js';
import { unitName, squadCap, heroTotals, isRanged, RANKS, FORMATIONS } from '../game/rules.js';

const uf = (hero) => hero.ufid || hero.fid;
import { rarityColor } from '../game/items.js';

export function portrait(hero, scale = 2) {
  const r = portraitRef(hero.fid, hero.portrait);
  return sprite(r[0], r[1], r[2], 16, 16, scale, { class: 'pfp' });
}

export function unitIcon(fid, ui, stage = 1, scale = 2) {
  const sh = UNIT_SHEETS[fid], u = sh.units[ui];
  return sprite(sh.src, sh.anims.idle[0], u.y[stage >= 2 ? 1 : 0], 16, 16, scale);
}

export function itemIcon(it, scale = 2) {
  return sprite(ITEMS, it.icon[0] * 16, it.icon[1] * 16, 16, 16, scale, { style: { border: `2px solid ${rarityColor(it.rarity)}`, borderRadius: '3px', backgroundColor: '#1b1726', boxShadow: `0 0 6px ${rarityColor(it.rarity)}55` } });
}

export function troopSummary(hero, kingdom) {
  const s1 = hero.troops.filter((t) => t.s === 1).length, s3 = hero.troops.filter((t) => t.s === 3).length, s2 = hero.troops.length - s1 - s3;
  return { s1, s2, s3, cap: squadCap(hero, kingdom) };
}

export function kingdomBadge(k, opts = {}) {
  if (!k) return h('span', { class: 'tag' }, opts.none || 'No realm');
  return h('span', { class: 'row', style: { gap: '5px', minWidth: 0 } },
    k.banner ? (() => { const el = bannerEl(k.banner, 1.2); el.style.flex = 'none'; return el; })() : h('span', { class: 'swatch', style: { background: k.color } }),
    h('span', { class: 'ellipsis', style: { fontWeight: 600 } }, k.name),
    opts.race ? h('span', { class: 'tag' }, FACTIONS[k.fid].name) : null);
}

export function heroCard(state, hero, opts = {}) {
  const k = hero.kingdom >= 0 ? state.kingdoms[hero.kingdom] : null;
  const ts = troopSummary(hero, k);
  const t = heroTotals(hero, state.items);
  const stage = ts.s2 + ts.s3 > ts.s1 ? 2 : 1;
  const badges = [...(opts.badges || [])];
  if (uf(hero) === hero.fid) badges.push('Race match');
  if (isRanged(uf(hero), hero.unit)) badges.push('Ranged');
  if (ts.s2) badges.push(`${ts.s2} veteran`);
  if (ts.s3) badges.push(`${ts.s3} elite`);
  if (hero.lentTo >= 0 && state.kingdoms[hero.lentTo]) badges.push('Lent to ' + state.kingdoms[hero.lentTo].name.split(' of ').pop());
  if (hero.status === 'active' && hero.loyalty < 35 && k && k.ruler !== hero.id) badges.push('Disloyal!');
  const order = opts.order !== false && hero.order ? h('span', { class: 'tag ' + (hero.order.type === 'attack' ? 'bad' : 'gold') }, orderLabel(state, hero.order)) : null;
  return h('div', { class: 'card hero-card tap ' + (opts.sel ? 'sel ' : '') + (opts.dim ? 'dim' : ''), onClick: opts.onClick },
    h('div', { class: 'pframe' }, portrait(hero, opts.big ? 3 : 2.5), h('span', { class: 'lvl' }, 'Lv ' + hero.level)),
    h('div', { class: 'col grow', style: { gap: '3px', minWidth: 0 } },
      h('div', { class: 'row', style: { gap: '6px' } },
        k ? h('span', { class: 'swatch', style: { background: k.color } }) : null,
        h('span', { class: 'name ellipsis grow' }, hero.name),
        order),
      h('div', { class: 'row', style: { gap: '6px' } },
        unitIcon(uf(hero), hero.unit, stage, 1.5),
        h('span', { class: 'sub ellipsis grow' }, `${unitName(uf(hero), hero.unit, stage)}`),
        h('span', { class: 'sub', style: { fontWeight: 700, color: hero.troops.length < ts.cap ? '#ffd86b' : '#f7efe0' } }, `${hero.troops.length}/${ts.cap}`)),
      h('div', { class: 'bars' },
        h('span', {}, 'SQD'), bar(hero.troops.length / Math.max(1, ts.cap), 'thin'),
        h('span', {}, 'HP'), bar((hero.hp ?? 100) / 100, 'thin hp')),
      opts.stats ? h('div', { class: 'row wrap', style: { gap: '4px' } },
        h('span', { class: 'tag' }, `ATK ${t.atk}`), h('span', { class: 'tag' }, `DEF ${t.def}`), h('span', { class: 'tag' }, `LEAD ${t.lead}`), h('span', { class: 'tag' }, `INT ${t.int}`)) : null,
      badges.length ? h('div', { class: 'row wrap', style: { gap: '4px' } }, badges.map((b) => h('span', { class: 'tag gold' }, b))) : null,
    ),
    opts.extra ? h('div', { style: { display: 'flex', alignItems: 'center' } }, opts.extra) : null,
  );
}

// statsObj: { hp, atk, def, spd, ... } shown as pills
export function unitCard(fid, ui, stage = 1, statsObj = {}, opts = {}) {
  const name = unitName(fid, ui, stage);
  return h('div', { class: 'card unit-card tap ' + (opts.sel ? 'sel' : ''), onClick: opts.onClick },
    unitIcon(fid, ui, stage, 3),
    h('div', { style: { fontWeight: 700 } }, name),
    stage === 2 ? h('span', { class: 'tag gold' }, 'Evolved') : null,
    isRanged(fid, ui) ? h('span', { class: 'tag blue' }, 'Ranged') : null,
    Object.keys(statsObj).length ? h('div', { class: 'kv', style: { width: '100%' } },
      Object.entries(statsObj).map(([k, v]) => h('div', { class: 'stat-pill' }, h('b', {}, typeof v === 'number' ? (Math.round(v * 10) / 10) : v), h('span', {}, k.toUpperCase())))) : null);
}

export function orderLabel(state, o) {
  if (!o) return '';
  const t = o.target != null && state.territories[o.target] ? state.territories[o.target].name : '';
  return ({ attack: '⚔ ' + t, move: '→ ' + t, rest: 'Rest & recruit', drill: 'Drill', recruit: 'Recruit', spy: 'Spy ' + t, lend: 'Lent', plunder: 'Plunder', protect: 'Protect hamlet', explore: 'Explore site', court: 'Courting' })[o.type] || o.type;
}

export function factionBadge(fid, scale = 1) {
  const r = FACTIONS[fid].town(2);
  return sprite(r[0], r[1], r[2], r[3], r[4], scale * (64 / r[3]) * 0.6);
}

export { RANKS, FORMATIONS };
