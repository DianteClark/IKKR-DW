// World events, bandits, monster outbreaks, civil uprisings, overthrows and wandering heroes.
import { FACTIONS, FACTION_IDS } from '../data/art.js';
import {
  makeHero, newKingdom, heroesAt, kingdomHeroes, kingdomTerritories, log, clamp, joinKingdom, hero, isHumanKingdom, pickLoadout,
} from './world.js';
import { squadPower, garrisonPower, squadCap } from './rules.js';

const BANDIT_NAMES = ['Black Fang', 'Red Hand', 'Grey Wolves', 'Iron Teeth', 'Night Ravens', 'Bone Crows', 'Dust Vipers', 'Mad Dogs', 'Rust Blades', 'Hollow Men'];
const BLIGHTS = { necropolis: 'Undead Blight', conflux: 'Elemental Storm', inferno: 'Demon Rift', enclave: 'Swamp Horror', stronghold: 'Beast Horde' };

export const EVENT_INFO = {
  quake: { name: 'Earthquake', icon: 'quake' }, wildfire: { name: 'Wildfire', icon: 'fire' }, plague: { name: 'Plague', icon: 'plague' },
  harvest: { name: 'Bountiful Harvest', icon: 'harvest' }, flood: { name: 'Floods', icon: 'flood' }, goldrush: { name: 'Gold Strike', icon: 'gold' },
  bandits: { name: 'Bandits', icon: 'bandits' }, outbreak: { name: 'Creature Outbreak', icon: 'outbreak' }, revolt: { name: 'Civil Uprising', icon: 'revolt' },
  overthrow: { name: 'Overthrown!', icon: 'revolt' }, famine: { name: 'Famine', icon: 'famine' }, festival: { name: 'Feast Day', icon: 'harvest' },
};

function mark(t, kind, turns = 3) { t.fx = (t.fx || []).filter((f) => f.kind !== kind); t.fx.push({ kind, turns }); }
function ev(state, list, kind, tid, text, kid = -1) { list.push({ kind, tid, text, kid }); log(state, text, kid, kind); }

export function decayMarks(state) {
  for (const t of state.territories) {
    t.fx = (t.fx || []).filter((f) => --f.turns > 0);
    if (t.blight > 0) t.blight--;
  }
}

export function worldEvents(state, rng) {
  const list = [];
  const T = state.territories;
  // turns are months now: world events are rarer per turn so a year holds about as many as before
  const n = (rng() < 0.25 ? 1 : 0) + (rng() < T.length / 360 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const t = rng.pick(T);
    const k = t.owner >= 0 ? state.kingdoms[t.owner] : null;
    const roll = rng();
    const here = heroesAt(state, t.id, t.owner);
    if (roll < 0.12) {
      t.level = Math.max(0, t.level - 1); t.ruined = Math.max(t.ruined, 1); mark(t, 'quake');
      for (const h of here) h.troops.splice(0, Math.floor(h.troops.length * 0.2));
      if (k) k.morale = clamp(k.morale - 6);
      ev(state, list, 'quake', t.id, `An earthquake shook ${t.name}. Walls fell and soldiers were lost.`, t.owner);
    } else if (roll < 0.24 && ['grass', 'dirt', 'marsh', 'sand', 'lava'].includes(t.biome)) {
      t.blight = 3; mark(t, 'wildfire');
      for (const h of here) h.hp = Math.max(30, h.hp - 25);
      if (k) k.morale = clamp(k.morale - 5);
      ev(state, list, 'wildfire', t.id, `Wildfire sweeps through ${t.name}. Crops burn.`, t.owner);
    } else if (roll < 0.33) {
      mark(t, 'plague', 4);
      for (const nb of [t.id, ...t.nb]) for (const h of heroesAt(state, nb)) h.troops.splice(0, Math.floor(h.troops.length * 0.15));
      if (k) k.morale = clamp(k.morale - 8);
      ev(state, list, 'plague', t.id, `Plague spreads from ${t.name}. Armies nearby sicken.`, t.owner);
    } else if (roll < 0.47) {
      mark(t, 'harvest');
      if (k) { k.food += 80; k.morale = clamp(k.morale + 6); }
      ev(state, list, 'harvest', t.id, `A bountiful harvest in ${t.name} fills the granaries.`, t.owner);
    } else if (roll < 0.55 && ['marsh', 'deepmarsh', 'grass'].includes(t.biome)) {
      t.blight = 2; mark(t, 'flood');
      if (k) k.gold = Math.max(0, k.gold - 60);
      ev(state, list, 'flood', t.id, `Rivers burst their banks in ${t.name}.`, t.owner);
    } else if (roll < 0.63) {
      mark(t, 'goldrush');
      if (k) k.gold += 180;
      ev(state, list, 'goldrush', t.id, `Prospectors struck gold in ${t.name}!`, t.owner);
    } else if (roll < 0.78 && state.turn > 3 && raiders(state) < Math.ceil(T.length / 18)) {
      spawnRaiders(state, rng, t, 'bandit', list);
    } else if (roll < 0.86 && state.turn > 6 && raiders(state) < Math.ceil(T.length / 18)) {
      spawnRaiders(state, rng, t, 'monster', list);
    }
  }
  // unrest: realms with low Order may lose land to revolt, or be overthrown outright
  for (const k of state.kingdoms) {
    if (!k.alive || k.landless || k.kind !== 'realm') continue;
    if (k.morale < 12 && rng() < 0.05) { overthrow(state, k, rng, list); continue; }
    if (k.morale < 24 && rng() < (24 - k.morale) / 330) {
      const lands = kingdomTerritories(state, k.id).filter((t) => t.id !== k.capital && !heroesAt(state, t.id, k.id).length);
      if (lands.length) revolt(state, rng, rng.pick(lands), list);
    }
  }
  return list;
}

function raiders(state) { return state.kingdoms.filter((k) => k.alive && (k.kind === 'bandit' || k.kind === 'monster')).length; }
function raiderPower(state, t) {
  return heroesAt(state, t.id, t.owner).reduce((s, h) => s + squadPower(h, state.items), 0) + garrisonPower(t);
}

export function spawnRaiders(state, rng, t, kind, list) {
  // raiders seize lightly held land
  if (heroesAt(state, t.id, t.owner).length > 1 || (t.owner >= 0 && t.id === state.kingdoms[t.owner].capital && t.level >= 2)) return null;
  const fid = kind === 'bandit' ? rng.pick(['orcs', 'stronghold']) : rng.pick(Object.keys(BLIGHTS));
  const name = kind === 'bandit' ? `${rng.pick(BANDIT_NAMES)} Bandits` : `${BLIGHTS[fid]} of ${t.name}`;
  const oldK = t.owner >= 0 ? state.kingdoms[t.owner] : null;
  // defenders get a fight: weak garrisons fall, strong ones beat the raiders off
  const raidPow = 60 + state.turn * 6;
  if (raiderPower(state, t) > raidPow * (0.8 + rng() * 0.6)) {
    ev(state, list, kind === 'bandit' ? 'bandits' : 'outbreak', t.id, `${name} attacked ${t.name} but were driven off.`, t.owner);
    return null;
  }
  for (const h of heroesAt(state, t.id, t.owner)) { const own = kingdomTerritories(state, h.kingdom).filter((x) => x.id !== t.id); if (own.length) h.loc = own[0].id; }
  const k = newKingdom(state, rng, { fid, cap: t.id, name, kind, tier: 'kingdom' });
  k.gold = 150; k.morale = 70;
  mark(t, kind === 'bandit' ? 'bandits' : 'outbreak', 4);
  const n = 1 + (state.turn > 12 ? 1 : 0) + (rng() < 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const h = makeHero(state, rng, fid, k.id, t.id, { level: Math.floor(state.turn / 6), maxUnit: 3, ruler: i === 0, trait: kind === 'bandit' ? 'greedy' : 'fierce' });
    if (i === 0) k.ruler = h.id;
  }
  k.loadout = pickLoadout(k, rng);
  ev(state, list, kind === 'bandit' ? 'bandits' : 'outbreak', t.id, kind === 'bandit' ? `${name} overran ${t.name}${oldK ? ' from ' + oldK.name : ''}!` : `A ${name.toLowerCase()} erupted, swallowing ${t.name}!`, oldK ? oldK.id : -1);
  return k;
}

export function revolt(state, rng, t, list) {
  const oldK = state.kingdoms[t.owner];
  // a wandering ambitious hero may lead it, otherwise the people raise their own
  const lead = state.heroes.find((h) => h.status === 'vagabond' && h.loc === t.id && h.ambition > 50);
  const fid = lead ? lead.fid : t.race || oldK.fid;
  const k = newKingdom(state, rng, { fid, cap: t.id, name: `Free Folk of ${t.name}`, kind: 'rebel', tier: 'village' });
  k.morale = 62; k.gold = 120;
  if (lead) { joinKingdom(state, lead, k.id, 100); lead.loc = t.id; k.ruler = lead.id; }
  else { const h = makeHero(state, rng, fid, k.id, t.id, { ruler: true, maxUnit: 2 }); k.ruler = h.id; }
  t.ruined = 1; mark(t, 'revolt', 3);
  oldK.morale = clamp(oldK.morale + 6); // the hotheads left
  ev(state, list, 'revolt', t.id, `The people of ${t.name} rose against ${oldK.name}${lead ? ', led by ' + lead.name : ''}!`, oldK.id);
  return k;
}

export function overthrow(state, k, rng, list) {
  const lands = kingdomTerritories(state, k.id);
  const ruler = hero(state, k.ruler);
  const human = k.player >= 0;
  // the realm shatters into rebel holdings; the ruler is cast out
  const rebels = newKingdom(state, rng, { fid: k.fid, cap: k.capital, name: `Free Folk of ${state.territories[k.capital].name}`, kind: 'rebel', tier: 'kingdom' });
  rebels.morale = 55; rebels.gold = Math.round(k.gold / 2);
  for (const t of lands) { t.owner = rebels.id; mark(t, 'revolt', 3); }
  const heroes = kingdomHeroes(state, k.id, true);
  let followers = 0;
  for (const h of heroes) {
    if (human && (h.id === k.ruler || h.loyalty >= 55)) { followers++; h.lentTo = -1; continue; }
    if (h.loyalty < 40 && rng() < 0.6) { joinKingdom(state, h, rebels.id, 65); if (!hero(state, rebels.ruler)) rebels.ruler = h.id; }
    else { h.status = 'vagabond'; h.kingdom = -1; h.order = null; h.lentTo = -1; if (h.id === k.ruler) h.ambition = 100; }
  }
  if (rebels.ruler < 0 || !hero(state, rebels.ruler) || hero(state, rebels.ruler).kingdom !== rebels.id) {
    const h = makeHero(state, rng, k.fid, rebels.id, k.capital, { ruler: true, maxUnit: 3 }); rebels.ruler = h.id;
  }
  state.treaties = state.treaties.filter((t) => t.a !== k.id && t.b !== k.id);
  k.gold = Math.round(k.gold / 2); k.morale = 40;
  ev(state, list, 'overthrow', k.capital, human
    ? `Revolution! ${k.name} has been overthrown. ${ruler ? ruler.name : 'Your ruler'} flees with ${followers - 1} loyal hero${followers === 2 ? '' : 'es'}.`
    : `${k.name} was overthrown by its own people! ${ruler ? ruler.name + ' is now a vagabond.' : ''}`, k.id);
  return rebels;
}

// vagabonds: wander, stir unrest, serve a lord, or raise an uprising
export function vagabondTick(state, rng, list) {
  for (const h of state.heroes) {
    if (h.status !== 'vagabond') continue;
    const t = state.territories[h.loc];
    if (rng() < 0.5) h.loc = rng.pick(t.nb);
    const here = state.territories[h.loc];
    const owner = here.owner >= 0 ? state.kingdoms[here.owner] : null;
    // ambitious wanderers stir trouble and may rise up
    if (h.ambition > 60 && owner) {
      owner.morale = clamp(owner.morale - 1);
      const guarded = heroesAt(state, here.id, here.owner).length;
      if (!guarded && state.turn > 3 && owner.morale < 35 && rng() < 0.01 + (35 - owner.morale) / 1200) {
        const win = rng() < squadPower(h, state.items) / (squadPower(h, state.items) + garrisonPower(here));
        if (win) revolt(state, rng, here, list);
        else { h.troops = h.troops.slice(0, Math.floor(h.troops.length / 2)); log(state, `An uprising led by ${h.name} at ${here.name} was crushed.`, owner.id, 'revolt'); }
        continue;
      }
    }
    // serve a lord with a good name
    if (owner && owner.player < 0 && owner.kind !== 'monster') {
      const appeal = owner.morale / 100 - h.ambition / 250;
      if (rng() < 0.02 + Math.max(0, appeal) * 0.05) { joinKingdom(state, h, owner.id, 55); log(state, `The vagabond ${h.name} pledged to ${owner.name}.`, owner.id); continue; }
    }
    // wanderers recover and gather a few followers
    h.hp = Math.min(100, h.hp + 15);
    if (h.troops.length < Math.min(5, squadCap(h)) && rng() < 0.3) h.troops.push({ s: 1, r: 0, xp: 0, g: [95, 95, 95] });
  }
}
