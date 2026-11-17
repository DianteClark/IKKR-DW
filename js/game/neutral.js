// Neutral lands and wild sites.
// About a third of the world begins unclaimed: free hamlets with their own militia, plus ruins, lairs, bandit camps,
// shrines, mines and groves scattered through the wilds. Heroes travel into neutral land to claim it by force,
// plunder it, protect it until it chooses to join, explore sites, or court a wanderer hiding there.
import { FACTION_IDS, FACTIONS } from '../data/art.js';
import { hero, heroesAt, log, isHumanKingdom, joinKingdom, giveItem, makeHero, gainHeroXp, gainTroopXp, kingdomTerritories } from './world.js';
import { squadPower, newSoldier, squadCap } from './rules.js';
import { canWed, wed } from './family.js';

export const SITES = {
  ruin: { name: 'Ancient Ruin', verb: 'Explore', desc: 'Crumbling halls with old treasure and older guardians.', power: [55, 140] },
  lair: { name: 'Monster Lair', verb: 'Clear', desc: 'Beasts that raid the nearby lands until someone puts an end to them.', power: [70, 170] },
  camp: { name: 'Bandit Camp', verb: 'Raid', desc: 'Cutthroats with stolen gold — and sometimes a captive worth freeing.', power: [45, 120] },
  shrine: { name: 'Shrine', verb: 'Pray', desc: 'A hero who prays here is blessed with lasting strength.', power: [0, 0] },
  mine: { name: 'Mine', verb: 'Claim', desc: 'Held by squatters. Once claimed it pays gold every season.', power: [35, 90] },
  grove: { name: 'Sacred Grove', verb: 'Rest', desc: 'Heals a squad completely and lifts their spirits.', power: [0, 0] },
};
export const SITE_IDS = Object.keys(SITES);
const PROTECT_TURNS = 3;

export const isNeutral = (t) => t.owner < 0;

// ---------- world setup ----------
export function initNeutral(state, T, rng) {
  for (const t of state.territories) {
    t.favor = {};
    if (t.owner < 0) { t.militia = rng.int(3, 7) + t.level * 2; t.level = Math.min(t.level, 1); }
  }
  state.sites = [];
  const spots = (T && T.siteSpots) || [];
  if (spots.length) {
    spots.forEach((sp, i) => { if (SITES[sp.kind]) state.sites.push(newSite(state, rng, i, sp.tid, sp.kind, sp.x, sp.y)); });
  } else {
    // fallback when the map has no hand-placed spots: one site in about half the lands
    for (const t of state.territories) if (rng() < 0.5) state.sites.push(newSite(state, rng, -1, t.id, rng.pick(SITE_IDS), t.cx + rng.int(-4, 4), t.cy + rng.int(2, 4)));
  }
  // some wanderers hide in the wilds, guarding a site or lying low in a hamlet
  const hidden = Math.max(2, Math.round(state.territories.length / 12));
  for (let i = 0; i < hidden; i++) {
    const site = rng.pick(state.sites.filter((s) => s.guard < 0) || []);
    const tid = site ? site.tid : rng.pick(state.territories).id;
    const h = makeHero(state, rng, rng.pick(FACTION_IDS), -1, tid, { status: 'vagabond', level: rng.int(1, 3) });
    h.hidden = true;
    if (site) site.guard = h.id;
  }
}

function newSite(state, rng, spot, tid, kind, x, y) {
  const [lo, hi] = SITES[kind].power;
  return { id: (state.siteSeq = (state.siteSeq || 0) + 1), spot, tid, kind, x, y, status: 'active', power: lo ? rng.int(lo, hi) : 0, guard: -1, owner: -1, since: 0 };
}

export const sitesIn = (state, tid) => (state.sites || []).filter((s) => s.tid === tid);
export const site = (state, id) => (state.sites || []).find((s) => s.id === id);

// ---------- what a hero can do where they stand ----------
export function neutralActions(state, h) {
  const t = state.territories[h.loc];
  const out = [];
  if (!h || h.status !== 'active') return out;
  if (t.owner < 0) {
    out.push({ type: 'plunder', label: 'Plunder', desc: `Take ~${plunderYield(t).gold}g and ${plunderYield(t).food} food. The free folk will hate you.` });
    out.push({ type: 'protect', label: 'Protect', desc: `Stand guard ${PROTECT_TURNS} seasons; the hamlet joins your realm peacefully.` });
  }
  for (const s of sitesIn(state, t.id)) {
    if (s.status !== 'active' && !(s.kind === 'shrine' || s.kind === 'grove')) continue;
    if (s.kind === 'mine' && s.owner === h.kingdom) continue;
    out.push({ type: 'explore', site: s.id, label: `${SITES[s.kind].verb}: ${SITES[s.kind].name}`, desc: SITES[s.kind].desc, risk: siteOdds(state, h, s) });
  }
  for (const v of state.heroes) {
    if (v.status !== 'vagabond' || v.loc !== t.id) continue;
    if (canCourt(state, h, v)) out.push({ type: 'court', target: v.id, label: `Court ${v.name}`, desc: `${v.name} may join your realm and marry ${h.name}.` });
  }
  return out;
}
export function plunderYield(t) { return { gold: 90 + t.level * 50, food: 40 + t.level * 15 }; }

export function siteOdds(state, h, s) {
  if (!s.power) return 1;
  const k = state.kingdoms[h.kingdom];
  const friends = heroesAt(state, h.loc, h.kingdom).filter((x) => x.order && x.order.type === 'explore' && x.order.site === s.id);
  const group = friends.length ? friends : [h];
  const ours = Math.max(1, group.reduce((a, x) => a + squadPower(x, state.items, k.morale), 0));
  const guard = s.guard >= 0 ? hero(state, s.guard) : null;
  const theirs = s.power + (guard && guard.status === 'vagabond' ? squadPower(guard, state.items, 60) : 0);
  const p = 1 / (1 + Math.exp(-7 * (ours / (ours + theirs) - 0.5)));
  return Math.max(0.05, Math.min(0.97, p));
}

export function canCourt(state, h, v) {
  if (!v || v.status !== 'vagabond' || v.loc !== h.loc) return false;
  return h.gender !== v.gender && !(h.spouse > 0) && !(v.spouse > 0);
}

export function validNeutralOrder(state, h, o) {
  const acts = neutralActions(state, h);
  return acts.some((a) => a.type === o.type && (a.site == null || a.site === o.site) && (a.target == null || a.target === o.target));
}

// ---------- resolution (end of turn, after moves) ----------
export function applyNeutralOrders(state, rng, results) {
  const note = (kid, text) => { results.push({ kid, text }); log(state, text, kid, 'wild'); };
  for (const h of state.heroes) {
    if (h.status !== 'active' || !h.order) continue;
    const o = h.order, t = state.territories[h.loc], k = state.kingdoms[h.kingdom];
    if (!['plunder', 'protect', 'explore', 'court'].includes(o.type)) continue;
    if (!validNeutralOrder(state, h, o)) { h.order = null; continue; }
    if (o.type === 'plunder') {
      const y = plunderYield(t);
      k.gold += y.gold; k.food += y.food;
      t.level = Math.max(0, t.level - 1); t.ruined = 2; t.militia = Math.max(1, (t.militia || 0) - 3);
      k.stability = Math.max(0, k.stability - 3); k.morale = Math.min(100, k.morale + 2);
      for (const x of state.territories) if (x.owner < 0) x.favor[k.id] = (x.favor[k.id] || 0) - (x.id === t.id ? 40 : 12);
      note(k.id, `${h.name} plundered ${t.name}: +${y.gold}g, +${y.food} food. The free hamlets will remember.`);
    } else if (o.type === 'protect') {
      if (!t.protect || t.protect.kid !== k.id) t.protect = { kid: k.id, turns: 0 };
      t.protect.turns++;
      t.favor[k.id] = (t.favor[k.id] || 0) + 12;
      gainHeroXp(h, 1, rng);
      if (t.protect.turns >= PROTECT_TURNS) {
        claimLand(state, t, k.id);
        const militia = Math.min(squadCap(h, k) - h.troops.length, t.militia || 3);
        for (let i = 0; i < militia; i++) h.troops.push(newSoldier(rng));
        note(k.id, `${t.name} asked to join ${k.name} after ${h.name} kept it safe. ${militia > 0 ? militia + ' militia joined the squad.' : ''}`);
      } else note(k.id, `${h.name} stands guard over ${t.name} (${t.protect.turns}/${PROTECT_TURNS}).`);
      continue; // order persists
    } else if (o.type === 'court') {
      const v = hero(state, o.target);
      if (canCourt(state, h, v) && rng() < 0.55 + (t.favor[k.id] || 0) / 200 + h.loyalty / 400) {
        v.hidden = false; joinKingdom(state, v, k.id, 75); v.loc = h.loc;
        v.level = Math.max(v.level, 3); h.level = Math.max(h.level, 3);
        wed(state, h, v);
        note(k.id, `${h.name} won the heart of ${v.name}, who joins ${k.name} as ${h.gender === 'm' ? 'his' : 'her'} spouse!`);
      } else note(k.id, `${v ? v.name : 'The wanderer'} turned ${h.name} away — for now.`);
    } else if (o.type === 'explore') resolveSite(state, rng, h, site(state, o.site), note);
    h.order = null;
  }
}

function resolveSite(state, rng, h, s, note) {
  const k = state.kingdoms[h.kingdom];
  if (!s) return;
  const S = SITES[s.kind];
  const party = heroesAt(state, h.loc, h.kingdom).filter((x) => x.order && x.order.type === 'explore' && x.order.site === s.id);
  if (party[0] && party[0].id !== h.id) return; // the first hero resolves for the whole party
  if (s.kind === 'shrine') {
    const stat = rng.pick(['atk', 'def', 'int']);
    if (h.blessed) { h.morale = Math.min(100, h.morale + 10); note(k.id, `${h.name} prayed at the shrine and found peace (+morale).`); return; }
    h[stat] += 1; h.blessed = true; h.morale = Math.min(100, h.morale + 15);
    note(k.id, `${h.name} was blessed at the shrine: +1 ${stat.toUpperCase()} for life.`);
    return;
  }
  if (s.kind === 'grove') {
    for (const x of party.length ? party : [h]) { x.hp = 100; x.morale = Math.min(100, x.morale + 15); }
    note(k.id, `${party.length > 1 ? 'The party' : h.name} rested in the sacred grove and is fully healed.`);
    return;
  }
  const p = siteOdds(state, h, s);
  const guard = s.guard >= 0 ? hero(state, s.guard) : null;
  const won = rng() < p;
  for (const x of party.length ? party : [h]) {
    const loss = won ? 0.05 + (1 - p) * 0.25 : 0.35 + (1 - p) * 0.3;
    x.troops = x.troops.filter(() => rng() > loss);
    if (!won) x.hp = Math.max(15, x.hp - 35);
    gainTroopXp(x, won ? 2 : 1, rng); gainHeroXp(x, won ? 3 : 1, rng);
  }
  if (!won) { note(k.id, `${h.name} was driven back from the ${S.name.toLowerCase()} at ${state.territories[s.tid].name}.`); return; }
  s.status = s.kind === 'mine' ? 'claimed' : 'cleared'; s.since = state.turn; s.owner = k.id;
  const bits = [];
  if (s.kind === 'ruin') { const it = giveItem(state, rng, k.id, rng.int(1, 2)); k.gold += 80; bits.push(`found ${it.name}`, '+80g'); }
  if (s.kind === 'lair') { const it = giveItem(state, rng, k.id, rng.int(1, 3)); bits.push(`slew the beasts and took ${it.name}`); for (const t of state.territories) if (t.owner < 0 && state.territories[s.tid].nb.includes(t.id)) t.favor[k.id] = (t.favor[k.id] || 0) + 15; }
  if (s.kind === 'camp') { k.gold += 140; k.food += 40; bits.push('recovered 140g and 40 food'); }
  if (s.kind === 'mine') bits.push('claimed the mine (+35g every season)');
  if (guard && guard.status === 'vagabond') {
    if (rng() < 0.6) { guard.hidden = false; joinKingdom(state, guard, k.id, 60); guard.loc = h.loc; bits.push(`${guard.name}, who was hiding there, joined ${k.name}`); }
    else { guard.hidden = false; bits.push(`${guard.name} fled into the wilds`); }
    s.guard = -1;
  }
  note(k.id, `${h.name} ${s.kind === 'ruin' ? 'explored the ruin' : s.kind === 'mine' ? 'took the mine' : 'won at the ' + S.name.toLowerCase()} — ${bits.join(', ')}.`);
}

export function claimLand(state, t, kid) {
  t.owner = kid; t.protect = null; t.militia = 0;
  log(state, `${t.name} is now part of ${state.kingdoms[kid].name}.`, kid);
}

// ---------- seasonal life of the wilds ----------
export function neutralTick(state, rng, notes) {
  for (const t of state.territories) {
    if (t.owner >= 0) { t.protect = null; continue; }
    if (t.protect) {
      const guard = heroesAt(state, t.id, t.protect.kid).some((x) => x.order && x.order.type === 'protect');
      if (!guard) t.protect = null;
    }
    if (rng() < 0.15) t.militia = Math.min(6 + t.level * 3, (t.militia || 0) + 1);
    if (t.level < 1 && !t.ruined && rng() < 0.04) t.level++;
    for (const kid in t.favor) t.favor[kid] *= 0.97;
  }
  // mines pay their owners
  for (const s of state.sites || []) {
    if (s.kind === 'mine' && s.status === 'claimed' && s.owner >= 0) {
      const k = state.kingdoms[s.owner];
      const t = state.territories[s.tid];
      if (!k || !k.alive || (t.owner >= 0 && t.owner !== s.owner)) { s.status = 'active'; s.owner = -1; continue; }
      k.gold += 35;
    }
    // cleared lairs and camps come back in time
    if ((s.kind === 'lair' || s.kind === 'camp') && s.status === 'cleared' && state.turn - s.since > 16 && rng() < 0.08) { s.status = 'active'; s.power = Math.round(s.power * 1.15); }
    // active lairs and camps raid a neighbouring realm
    if ((s.kind === 'lair' || s.kind === 'camp') && s.status === 'active' && rng() < 0.05) {
      const t = state.territories[s.tid];
      const victims = [t, ...t.nb.map((n) => state.territories[n])].filter((x) => x.owner >= 0);
      if (victims.length) {
        const v = rng.pick(victims), k = state.kingdoms[v.owner];
        k.food = Math.max(-20, k.food - 25); k.stability = Math.max(0, k.stability - 3);
        const text = `${s.kind === 'lair' ? 'Beasts' : 'Bandits'} from the ${SITES[s.kind].name.toLowerCase()} near ${t.name} raided ${v.name} (−25 food). Clear it out!`;
        log(state, text, k.id, 'wild');
        if (isHumanKingdom(state, k.id)) notes.push({ kid: k.id, kind: 'raid', text });
      }
    }
  }
}

// ---------- AI ----------
// returns true if the hero was given a wilds order
export function aiWildsOrder(state, h, rng) {
  const k = state.kingdoms[h.kingdom];
  const acts = neutralActions(state, h);
  if (!acts.length) return false;
  const raider = k.kind === 'bandit' || k.kind === 'monster';
  const court = acts.find((a) => a.type === 'court');
  if (court && rng() < 0.5) { h.order = { type: 'court', target: court.target }; return true; }
  const ex = acts.filter((a) => a.type === 'explore' && (a.risk == null || a.risk > 0.62)).sort((a, b) => b.risk - a.risk)[0];
  if (ex && rng() < 0.7) { h.order = { type: 'explore', site: ex.site }; return true; }
  if (raider && acts.some((a) => a.type === 'plunder')) { h.order = { type: 'plunder' }; return true; }
  const t = state.territories[h.loc];
  if (t.owner < 0 && acts.some((a) => a.type === 'protect') && (t.protect && t.protect.kid === k.id || rng() < 0.35)) { h.order = { type: 'protect' }; return true; }
  return false;
}
