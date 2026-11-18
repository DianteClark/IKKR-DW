// Seasons, marriages and heirs. One turn is one month; three months make a season, twelve a year.
// Married heroes of the same realm can have a child. The child is born a year (4 months) after the news,
// joins a parent's squad as a named recruit who starts stronger than ordinary soldiers, trains each month,
// and when they reach Elite they come of age as a hero with a subtle mix of their parents' strengths.
import { hero, makeHero, log, isHumanKingdom, courtFull } from './world.js';
import { EVOLVE_XP, canLead, squadCap } from './rules.js';
// heirs live in a parent's squad, or as a ward at their side when that squad is made of beasts
const kin = (x) => [...(x.troops || []), ...(x.wards || [])];
import { namesFor } from '../data/givennames.js';

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
// one turn is one month: three months to a season, twelve to a year
export const MONTHS_PER_SEASON = 3;
export const seasonOf = (turn) => SEASONS[Math.floor((Math.max(1, turn) - 1) / MONTHS_PER_SEASON) % 4];
export const yearOf = (turn) => Math.floor((Math.max(1, turn) - 1) / (MONTHS_PER_SEASON * 4)) + 1;
export const monthOf = (turn) => ((Math.max(1, turn) - 1) % MONTHS_PER_SEASON); // 0 early, 1 mid, 2 late
export const MONTH_NAMES = ['Early', 'Mid', 'Late'];
export const dateOf = (turn) => `${MONTH_NAMES[monthOf(turn)]} ${seasonOf(turn).toLowerCase()}, year ${yearOf(turn)}`;
export const shortDate = (turn) => `${seasonOf(turn).slice(0, 3)} ${['I', 'II', 'III'][monthOf(turn)]} · Y${yearOf(turn)}`;
// harvests swell in autumn and wither in winter
export const SEASON_FOOD = { Spring: 1, Summer: 1.1, Autumn: 1.3, Winter: 0.7 };
export const MARRY_LEVEL = 3;
const GESTATION = 9; // months
const MAX_CHILDREN = 2;

export function childrenOf(state, h) {
  const kids = [];
  for (const x of state.heroes) {
    if (x.parents && x.parents.includes(h.id) && x.status !== 'dead') kids.push({ name: x.name, hero: x });
    for (const s of kin(x)) if (s.heir && s.heir.parents.includes(h.id)) kids.push({ name: s.name, soldier: s, with: x, ward: !(x.troops || []).includes(s) });
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

// name suggestions for a child of this people and gender, skipping names already in use
export function childNames(state, fid, gender, n = 6, rng = null, kid = null) {
  // avoid names already used in this realm (parents, siblings, comrades); other realms may share names
  const mine = state.heroes.filter((x) => kid == null || x.kingdom === kid);
  const used = new Set(mine.map((x) => x.name.split(' ')[0]));
  for (const x of mine) for (const s of kin(x)) if (s.name) used.add(s.name.split(' ')[0]);
  const pool = namesFor(fid, gender);
  const free = pool.filter((nm) => !used.has(nm));
  const list = (free.length >= n ? free : pool).slice();
  const r = rng || Math.random;
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, n);
}
function childName(state, rng, fid, gender, kid) { return childNames(state, fid, gender, 1, rng, kid)[0]; }

// the player names their own children; this applies the choice (also used to auto-name after a season)
export function nameChild(state, kid, bid, gender, name) {
  const pb = (state.pendingBirths || []).find((b) => b.bid === bid && b.kid === kid);
  if (!pb) return false;
  const clean = String(name || '').replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 18);
  if (!clean || (gender !== 'm' && gender !== 'f')) return false;
  for (const x of state.heroes) for (const s of kin(x)) if (s.heir && s.heir.bid === bid) {
    s.name = clean; s.heir.gender = gender; delete s.heir.pending;
    log(state, `${pb.parents.join(' and ')} named their ${gender === 'f' ? 'daughter' : 'son'} ${clean}.`, kid, 'family');
  }
  state.pendingBirths = state.pendingBirths.filter((b) => b !== pb);
  return true;
}

function bear(state, rng, mother, notes) {
  const father = hero(state, mother.spouse);
  mother.expecting = 0;
  if (mother.status !== 'active') return;
  const parents = [mother, father].filter(Boolean);
  const fid = rng.pick(parents).fid;
  const avg = (k) => parents.reduce((a, p) => a + p[k], 0) / parents.length;
  const r = () => 108 + Math.floor(rng() * 18);
  const human = isHumanKingdom(state, mother.kingdom);
  const gender = rng.chance(0.5) ? 'f' : 'm';
  const bid = (state.birthSeq = (state.birthSeq || 0) + 1);
  const s = {
    s: 1, r: 0, xp: 1, g: [r(), r(), r()], name: childName(state, rng, fid, gender, mother.kingdom),
    heir: { bid, parents: parents.map((p) => p.id), gender, fid, born: state.turn, stats: { atk: avg('atk'), def: avg('def'), lead: avg('lead'), int: avg('int') }, trait: rng.pick(parents).trait },
  };
  if (human) {
    s.heir.pending = true;
    (state.pendingBirths = state.pendingBirths || []).push({ bid, kid: mother.kingdom, fid, turn: state.turn, parents: parents.map((p) => p.name) });
  }
  // the child trains under whichever parent is home and has room, else the mother
  const home = parents.find((p) => p.status === 'active' && p.kingdom === mother.kingdom && p.troops.length < 45) || mother;
  if (canLead(home.ufid || home.fid, home.unit) && home.troops.length < squadCap(home, state.kingdoms[home.kingdom])) home.troops.push(s);
  else (home.wards = home.wards || []).push(s); // a child is not raised as a griffin
  const k = state.kingdoms[mother.kingdom];
  const text = human
    ? `${parents.map((p) => p.name).join(' and ')} welcomed a child! Choose a name — they will be raised ${(home.wards || []).includes(s) ? 'at ' + home.name + '\'s side' : 'in ' + home.name + '\'s squad'}.`
    : `${parents.map((p) => p.name).join(' and ')} welcomed ${s.heir.gender === 'f' ? 'a daughter' : 'a son'}, ${s.name}. They will be raised ${(home.wards || []).includes(s) ? 'at ' + home.name + '\'s side' : 'in ' + home.name + '\'s squad'}.`;
  log(state, text, mother.kingdom, 'family');
  if (k && isHumanKingdom(state, k.id)) notes.push({ kid: k.id, kind: 'birth', text });
}

function comeOfAge(state, rng, holder, idx, notes) {
  const list = idx.ward ? holder.wards : holder.troops;
  const s = list[idx.i];
  const heir = s.heir;
  list.splice(idx.i, 1);
  const leads = canLead(holder.ufid || holder.fid, holder.unit);
  const kid = holder.kingdom;
  const nh = makeHero(state, rng, heir.fid, kid, holder.loc, { name: s.name, gender: heir.gender, unit: leads ? holder.unit : 0, ufid: leads ? holder.ufid || holder.fid : heir.fid, troops: 0, level: 2, trait: heir.trait });
  for (const k of ['atk', 'def', 'int']) nh[k] = Math.max(nh[k], Math.round((nh[k] + heir.stats[k]) / 2) + 1);
  nh.lead = Math.min(16, Math.max(nh.lead, Math.round((nh.lead + heir.stats.lead) / 2)));
  nh.loyalty = 95; nh.parents = heir.parents.slice(); nh.born = heir.born;
  if (kid >= 0 && state.kingdoms[kid] && !state.kingdoms[kid].troopRaces.includes(heir.fid)) state.kingdoms[kid].troopRaces.push(heir.fid);
  const text = `${s.name}, child of ${heir.parents.map((p) => (hero(state, p) || { name: 'the fallen' }).name).join(' and ')}, has come of age and now leads a squad!`;
  log(state, text, kid, 'family');
  if (isHumanKingdom(state, kid)) notes.push({ kid, kind: 'heir', text });
}

export function familyTick(state, rng, notes) {
  // births the player never named get the suggested name after a season
  for (const pb of [...(state.pendingBirths || [])]) if (state.turn - pb.turn >= 1) {
    let s0 = null; for (const x of state.heroes) for (const s of kin(x)) if (s.heir && s.heir.bid === pb.bid) s0 = s;
    if (s0) nameChild(state, pb.kid, pb.bid, s0.heir.gender, s0.name); else state.pendingBirths = state.pendingBirths.filter((b) => b !== pb);
  }
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
    if (courtFull(state, h.kingdom)) continue; // no seat at court for another heir
    if (rng() < 0.035) { // about one child every two to three years
      h.expecting = state.turn;
      const text = `${h.name} and ${sp.name} are expecting a child, due in ${seasonOf(state.turn + GESTATION).toLowerCase()} of year ${yearOf(state.turn + GESTATION)}.`;
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
  // heirs train every month and come of age at Elite
  for (const h of state.heroes) {
    for (const ward of [false, true]) {
      const list = ward ? h.wards : h.troops;
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (!s.heir) continue;
        if (s.s < 3 && h.status === 'active' && state.turn % 2 === 0) {
          s.xp += 1;
          const [rx, ex] = EVOLVE_XP[s.s];
          if (!s.r && s.xp >= rx) s.r = 1;
          if (s.xp >= ex) { s.xp = 0; s.r = 0; s.s++; }
        }
        // a grown heir takes a seat at court when one is free; until then they serve as an Elite in the squad
        if (s.s === 3 && h.status === 'active' && h.kingdom >= 0 && !courtFull(state, h.kingdom)) comeOfAge(state, rng, h, { i, ward }, notes);
      }
    }
  }
}
