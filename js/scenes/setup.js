import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, toast } from '../engine/ui.js';
import { FACTIONS, FACTION_IDS } from '../data/art.js';
import { createWorld, confirmPicks, hero } from '../game/world.js';
import { factionBadge, unitIcon, heroCard } from '../campaign/widgets.js';
import { clearSave } from '../game/save.js';

export function factionPicker(title, onPick, onBack) {
  let sel = null;
  const cards = FACTION_IDS.map((fid) => {
    const F = FACTIONS[fid];
    const c = h('div', { class: 'card col', style: { alignItems: 'center', gap: '4px', cursor: 'pointer' }, onClick: () => { sel = fid; cards.forEach((x) => x.classList.toggle('sel', x === c)); next.disabled = false; } },
      factionBadge(fid, 1),
      h('div', {}, F.name),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, F.race),
      h('div', { class: 'row' }, [0, Math.floor(F.units.length / 2), F.units.length - 1].map((u) => unitIcon(fid, u, 1, 1.5))));
    return c;
  });
  const next = btn('Next', () => sel && onPick(sel), 'primary');
  next.disabled = true;
  return h('div', { class: 'screen' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, title), onBack ? btn('Back', onBack, 'small') : null, next),
      h('div', { class: 'scroll grow' }, h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' } }, cards))));
}

export function heroPicker(state, playerIdx, onConfirm, opts = {}) {
  const p = state.players[playerIdx];
  const k = state.kingdoms[p.kingdom];
  const picks = [];
  const cont = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } });
  const go2 = btn('Begin', () => onConfirm(picks.slice()), 'primary');
  const info = h('span', { class: 'muted' });
  const refresh = () => {
    cont.innerHTML = '';
    for (const id of p.candidates) {
      const hh = hero(state, id);
      const i = picks.indexOf(id);
      cont.appendChild(heroCard(state, hh, {
        stats: true, sel: i >= 0, order: false,
        extra: i >= 0 ? h('span', { class: 'gold' }, i === 0 ? 'Ruler' : '#' + (i + 1)) : null,
        onClick: () => { if (i >= 0) picks.splice(i, 1); else if (picks.length < 3) picks.push(id); else toast('Pick up to 3 heroes'); refresh(); },
      }));
    }
    go2.disabled = picks.length < 2;
    info.textContent = `${picks.length}/3 chosen — the first is your ruler`;
  };
  refresh();
  const t = state.territories[k.capital];
  return h('div', { class: 'screen' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row wrap' }, h('h2', { class: 'grow' }, `${opts.title || 'Choose your heroes'} · ${FACTIONS[k.fid].name} at ${t.name}`), info, opts.back ? btn('Back', opts.back, 'small') : null, go2),
      h('div', { class: 'scroll grow' }, cont)));
}

registerScene('setup', {
  enter() {
    const pickFaction = () => {
      clearUI();
      mount(factionPicker('Choose your people', (fid) => {
        const seed = (Math.random() * 2 ** 31) >>> 0;
        const state = createWorld(seed, [{ fid }]);
        clearUI();
        mount(heroPicker(state, 0, (ids) => {
          confirmPicks(state, 0, ids);
          clearSave();
          go('campaign', { state, localPlayer: 0 });
        }, { back: pickFaction }));
      }, () => go('title')));
    };
    pickFaction();
  },
});
