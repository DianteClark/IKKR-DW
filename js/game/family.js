// Seasons, marriages and heirs. One turn is one season; four seasons make a year.
// Married heroes of the same realm can have a child. The child is born a year (4 seasons) after the news,
// joins a parent's squad as a named recruit who starts stronger than ordinary soldiers, trains each season,
// and when they reach Elite they come of age as a hero with a subtle mix of their parents' strengths.
import { FACTIONS } from '../data/art.js';
import { hero, makeHero, log, isHumanKingdom } from './world.js';
import { EVOLVE_XP } from './rules.js';

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_ICON = { Spring: '🌱', Summer: '☀', Autumn: '🍂', Winter: '❄' };
export const seasonOf = (turn) => SEASONS[(Math.max(1, turn) - 1) % 4];
export const yearOf = (turn) => Math.floor((Math.max(1, turn) - 1) / 4) + 1;
// harvests swell in autumn and wither in winter
export const SEASON_FOOD = { Spring: 1, Summer: 1.1, Autumn: 1.3, Winter: 0.7 };
export const MARRY_LEVEL = 3;
const GESTATION = 4;
const MAX_CHILDREN = 3;

export function childrenOf(state, h) {
  const kids = [];
  for (const x of state.heroes) {
    if (x.parents && x.parents.includes(h.id) && x.status !== 'dead') kids.push({ name: x.name, hero: x });
    for (const s of x.troops || []) if (s.heir && s.heir.parents.includes(h.id)) kids.push({ name: s.name, soldier: s, with: x });
  }
  return kids;
}

export function canWed(state, a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.status !== 'active' || b.status !== 'active') return false;
  if (a.kingdom !== b.kingdom || a.kingdom < 0) return false;
  if (a.gender === b.gender) return false;
  if (a.spouse > 0 || b.spouse > 0) return false;
  if (a.level < MARRY_LEVEL || b.level < MARRY_LEVEL) return false;
  if ((a.parents && a.parents.includes(b.id)) || (b.parents && b.parents.includes(a.id))) return false;
  if (a.parents && b.parents && a.parents.some((p) => b.parents.includes(p))) return false;
  return true;
}
export function wedOptions(state, a) {
  return state.heroes.filter((b) => canWed(state, a, b));
}
export function wed(state, a, b) {
  if (!canWed(state, a, b)) return false;
  a.spouse = b.id; b.spouse = a.id;
  a.loyalty = Math.min(100, a.loyalty + 8); b.loyalty = Math.min(100, b.loyalty + 8);
  a.morale = Math.min(100, a.morale + 10); b.morale = Math.min(100, b.morale + 10);
  log(state, `${a.name} and ${b.name} were wed in ${seasonOf(state.turn).toLowerCase()}.`, a.kingdom, 'family');
  return true;
}

function childName(state, rng, fid) {
  const F = FACTIONS[fid];
  const used = new Set(state.heroes.map((x) => x.name.split(' ')[0]));
  for (const x of state.heroes) for (const s of x.troops || []) if (s.name) used.add(s.name.split(' ')[0]);
  const free = F.names.filter((n) => !used.has(n));
  return free.length ? rng.pick(free) : rng.pick(F.names) + ' the Younger';
}

function bear(state, rng, mother, notes) {
  const father = hero(state, mother.spouse);
  mother.expecting = 0;
  if (mother.status !== 'active') return;
  const parents = [mother, father].filter(Boolean);
  const fid = rng.pick(parents).fid;
  const avg = (k) => parents.reduce((a, p) => a + p[k], 0) / parents.length;
  const r = () => 108 + Math.floor(rng() * 18);
  const s = {
    s: 1, r: 0, xp: 1, g: [r(), r(), r()], name: childName(state, rng, fid),
    heir: { parents: parents.map((p) => p.id), gender: rng.chance(0.5) ? 'f' : 'm', fid, born: state.turn, stats: { atk: avg('atk'), def: avg('def'), lead: avg('lead'), int: avg('int') }, trait: rng.pick(parents).trait },
  };
  // the child trains under whichever parent is home and has room, else the mother
  const home = parents.find((p) => p.status === 'active' && p.kingdom === mother.kingdom && p.troops.length < 45) || mother;
  home.troops.push(s);
  const k = state.kingdoms[mother.kingdom];
  const text = `${parents.map((p) => p.name).join(' and ')} welcomed ${s.heir.gender === 'f' ? 'a daughter' : 'a son'}, ${s.name}. They will train in ${home.name}'s squad.`;
  log(state, text, mother.kingdom, 'family');
  if (k && isHumanKingdom(state, k.id)) notes.push({ kid: k.id, kind: 'birth', text });
}

function comeOfAge(state, rng, holder, idx, notes) {
  const s = holder.troops[idx];
  const heir = s.heir;
  holder.troops.splice(idx, 1);
  const kid = holder.kingdom;
  const nh = makeHero(state, rng, heir.fid, kid, holder.loc, { name: s.name, unit: holder.unit, ufid: holder.ufid || holder.fid, troops: 0, level: 2, trait: heir.trait });
  nh.gender = heir.gender;
  for (const k of ['atk', 'def', 'int']) nh[k] = Math.max(nh[k], Math.round((nh[k] + heir.stats[k]) / 2) + 1);
  nh.lead = Math.min(16, Math.max(nh.lead, Math.round((nh.lead + heir.stats.lead) / 2)));
  nh.loyalty = 95; nh.parents = heir.parents.slice(); nh.born = heir.born;
  if (kid >= 0 && state.kingdoms[kid] && !state.kingdoms[kid].troopRaces.includes(heir.fid)) state.kingdoms[kid].troopRaces.push(heir.fid);
  const text = `${s.name}, child of ${heir.parents.map((p) => (hero(state, p) || { name: 'the fallen' }).name).join(' and ')}, has come of age and now leads a squad!`;
  log(state, text, kid, 'family');
  if (isHumanKingdom(state, kid)) notes.push({ kid, kind: 'heir', text });
}

export function familyTick(state, rng, notes) {
  // births
  for (const h of state.heroes) if (h.expecting && state.turn - h.expecting >= GESTATION) bear(state, rng, h, notes);
  // couples drift apart only through death or capture: widowing
  for (const h of state.heroes) {
    if (!(h.spouse > 0)) continue;
    const sp = hero(state, h.spouse);
    if (!sp || sp.status === 'dead') { h.spouse = 0; h.widowed = true; }
  }
  // conception: married couples serving the same realm, both free
  for (const h of state.heroes) {
    if (h.gender !== 'f' || !(h.spouse > 0) || h.expecting || h.status !== 'active') continue;
    const sp = hero(state, h.spouse);
    if (!sp || sp.status !== 'active' || sp.kingdom !== h.kingdom) continue;
    if (childrenOf(state, h).length >= MAX_CHILDREN) continue;
    if (rng() < 0.22) {
      h.expecting = state.turn;
      const text = `${h.name} and ${sp.name} are expecting a child next ${seasonOf(state.turn).toLowerCase()}.`;
      log(state, text, h.kingdom, 'family');
      if (isHumanKingdom(state, h.kingdom)) notes.push({ kid: h.kingdom, kind: 'family', text });
    }
  }
  // AI courts marry on their own; player heroes sometimes fall in love too
  for (const k of state.kingdoms) {
    if (!k.alive || k.kind !== 'realm') continue;
    if (rng() > (k.player >= 0 ? 0.05 : 0.12)) continue;
    const pool = state.heroes.filter((x) => x.kingdom === k.id && x.status === 'active' && !(x.spouse > 0) && x.level >= MARRY_LEVEL);
    const a = pool.length ? rng.pick(pool) : null;
    const opts = a ? pool.filter((b) => canWed(state, a, b)) : [];
    if (a && opts.length) {
      const b = rng.pick(opts); wed(state, a, b);
      if (k.player >= 0) notes.push({ kid: k.id, kind: 'family', text: `${a.name} and ${b.name} fell in love and were wed.` });
    }
  }
  // heirs train every season and come of age at Elite
  for (const h of state.heroes) {
    if (!h.troops) continue;
    for (let i = h.troops.length - 1; i >= 0; i--) {
      const s = h.troops[i];
      if (!s.heir) continue;
      if (s.s < 3 && h.status === 'active') {
        s.xp += 1;
        const [rx, ex] = EVOLVE_XP[s.s];
        if (!s.r && s.xp >= rx) s.r = 1;
        if (s.xp >= ex) { s.xp = 0; s.r = 0; s.s++; }
      }
      if (s.s === 3 && h.status === 'active' && h.kingdom >= 0) comeOfAge(state, rng, h, i, notes);
    }
  }
}
