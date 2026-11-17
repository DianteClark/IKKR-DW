import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, toast, segmented, stepDots } from '../engine/ui.js';
import { FACTIONS, FACTION_IDS } from '../data/art.js';
import { createWorld, confirmPicks, hero } from '../game/world.js';
import { factionBadge, unitIcon, heroCard } from '../campaign/widgets.js';
import { clearSave } from '../game/save.js';
import { sfx, music } from '../engine/audio.js';

const FLAVOR = {
  castle: ['Knights, griffins and holy paladins.', ['Balanced', 'Strong defense']],
  rampart: ['Elves, dwarves and the ancient treants.', ['Ranged', 'Nature']],
  tower: ['Mages, golems and titans of the north.', ['Magic', 'Elite late game']],
  inferno: ['Imps, hellhounds and fire-wreathed devils.', ['Aggressive', 'Fire']],
  necropolis: ['Skeletons, vampires and liches.', ['Attrition', 'Fearsome']],
  stronghold: ['Goblins, wolf riders and cyclops.', ['Fast', 'Brute force']],
  enclave: ['Lizardmen, serpents and basilisks.', ['Swamp masters', 'Ambush']],
  orcs: ['Orc warbands of the wasteland.', ['Tough start', 'No upgrades']],
  dwarves: ['Bear cavalry, runes and yetis.', ['Sturdy', 'Cold lands']],
  conflux: ['Elementals of air, earth, water, fire.', ['Magic', 'Exotic']],
};

const SIZES = [
  { value: 'small', label: 'Small', lands: '~24 lands', time: '~1 hour', desc: 'A quick war. Great for learning and 2-player games.' },
  { value: 'medium', label: 'Medium', lands: '~44 lands', time: '2–3 hours', desc: 'The classic campaign across every biome.' },
  { value: 'large', label: 'Large', lands: '~70 lands', time: 'Long', desc: 'Some 25 realms, more bandits and world events.' },
  { value: 'huge', label: 'Huge archipelago', lands: '~100 lands', time: 'Epic', desc: 'Island kingdoms linked by sea lanes — ships carry your armies.' },
];

function header(title, step, total, onBack, right) {
  return h('div', { class: 'row', style: { marginBottom: '6px' } },
    onBack ? btn('‹ Back', () => { sfx('close'); onBack(); }, 'small') : null,
    h('h2', { class: 'grow', style: { margin: 0 } }, title),
    step != null ? stepDots(total, step) : null,
    right || null);
}

// Map size + difficulty. onDone({ size, difficulty })
export function newGameOptions(onDone, onBack, opts = {}) {
  let size = opts.size || 'medium', difficulty = opts.difficulty || 'normal';
  const cards = h('div', { class: 'grid stagger', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))' } });
  const draw = () => {
    cards.innerHTML = '';
    for (const s of SIZES) cards.appendChild(h('div', { class: 'card option-card tap' + (s.value === size ? ' sel' : ''), onClick: () => { size = s.value; sfx('click'); draw(); } },
      h('div', { class: 'oname' }, s.label),
      h('div', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'tag gold' }, s.lands), h('span', { class: 'tag' }, s.time)),
      h('div', { class: 'odesc' }, s.desc)));
  };
  draw();
  return h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      header(opts.title || 'New campaign', 0, 3, onBack, btn('Next ›', () => { sfx('open'); onDone({ size, difficulty }); }, 'primary')),
      h('div', { class: 'scroll grow col', style: { minHeight: 0 } },
        h('h3', {}, 'World size'), cards,
        h('h3', {}, 'Rival difficulty'),
        h('div', { class: 'row wrap' }, segmented([{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }], difficulty, (v) => (difficulty = v)),
          h('span', { class: 'muted small-text' }, 'Affects how bold and well-funded rival realms are.')))));
}

export function factionPicker(title, onPick, onBack) {
  let sel = null;
  const next = btn('Next ›', () => { if (sel) { sfx('open'); onPick(sel); } }, 'primary');
  next.disabled = true;
  const cards = FACTION_IDS.map((fid) => {
    const F = FACTIONS[fid];
    const [flavor, tags] = FLAVOR[fid] || ['', []];
    const n = F.units.length;
    const c = h('div', { class: 'card faction-card tap', onClick: () => { sel = fid; sfx('click'); cards.forEach((x) => x.classList.toggle('sel', x === c)); next.disabled = false; } },
      h('div', { class: 'town' }, factionBadge(fid, 1.15)),
      h('div', { class: 'fname' }, F.name),
      h('div', { class: 'race' }, F.race),
      h('div', { class: 'lineup' }, [0, 2, 4, n - 1].map((u) => unitIcon(fid, Math.min(u, n - 1), 1, 1.75))),
      h('div', { class: 'flavor' }, flavor),
      h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'tag gold' }, t))));
    return c;
  });
  return h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      header(title, 1, 3, onBack, next),
      h('div', { class: 'scroll grow', style: { minHeight: 0 } }, h('div', { class: 'grid stagger', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } }, cards))));
}

export function heroPicker(state, playerIdx, onConfirm, opts = {}) {
  const p = state.players[playerIdx];
  const k = state.kingdoms[p.kingdom];
  const picks = [];
  const cont = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' } });
  const go2 = btn('Begin ›', () => { sfx('horn'); onConfirm(picks.slice()); }, 'primary');
  const info = h('span', { class: 'chip' });
  const refresh = () => {
    cont.innerHTML = '';
    for (const id of p.candidates) {
      const hh = hero(state, id);
      const i = picks.indexOf(id);
      cont.appendChild(heroCard(state, hh, {
        stats: true, sel: i >= 0, order: false,
        badges: i === 0 ? ['Ruler'] : i > 0 ? ['Chosen'] : [],
        onClick: () => { if (i >= 0) picks.splice(i, 1); else if (picks.length < 3) { picks.push(id); sfx('recruit'); } else toast('Pick up to 3 heroes', 'gold'); refresh(); },
      }));
    }
    go2.disabled = picks.length < 3;
    info.textContent = `${picks.length}/3 chosen`;
  };
  refresh();
  const t = state.territories[k.capital];
  return h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      header(opts.title || 'Choose 3 heroes', 3, 3, opts.back, h('div', { class: 'row' }, info, go2)),
      h('div', { class: 'muted small-text' }, `${FACTIONS[k.fid].name} · your village at ${t.name}. The first hero you pick becomes your ruler. Gather 5 heroes and the village becomes a kingdom.`),
      h('div', { class: 'scroll grow', style: { minHeight: 0, marginTop: '6px' } }, cont)));
}

registerScene('setup', {
  enter() {
    music.start('title');
    let options = { size: 'medium', difficulty: 'normal' };
    const pickOptions = () => {
      clearUI();
      mount(newGameOptions((o) => { options = o; pickFaction(); }, () => go('title'), options));
    };
    const pickFaction = () => {
      clearUI();
      mount(factionPicker('Choose your people', (fid) => {
        const seed = (Math.random() * 2 ** 31) >>> 0;
        const state = createWorld(seed, [{ fid }], { size: options.size, difficulty: options.difficulty });
        clearUI();
        mount(heroPicker(state, 0, (ids) => {
          confirmPicks(state, 0, ids);
          clearSave();
          go('campaign', { state, localPlayer: 0 });
        }, { back: pickFaction }));
      }, pickOptions));
    };
    pickOptions();
  },
});
