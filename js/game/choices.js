import { seasonOf, monthOf } from './family.js';
// Events with choices: every few months a player's realm faces a decision with real consequences.
// The choice waits in state.choices (host-authoritative in two-player games) and is settled by the 'choose' action.
import { kingdomHeroes, kingdomTerritories, makeHero, log, clamp, giveItem, hero, rngFor, gainHeroXp } from './world.js';
import { newSoldier, squadCap } from './rules.js';
import { FACTION_IDS } from '../data/art.js';

const lands = (s, k) => kingdomTerritories(s, k.id);
const heroes = (s, k) => kingdomHeroes(s, k.id);
// a choice can be answered a month or two after it was asked: by then the coffers may be bare or the hero gone
const pay = (k, g) => { if (k.gold < g) return false; k.gold -= g; return true; };
const POOR = 'The treasury could not cover it.';
const mine = (s, k, id) => { const h = hero(s, id); return h && h.status === 'active' && h.kingdom === k.id && h.lentTo < 0 ? h : null; };
const fill = (s, k, n, rng) => { let added = 0; for (const h of heroes(s, k)) { while (added < n && h.troops.length < squadCap(h, k)) { h.troops.push(newSoldier(rng)); added++; } } return added; };

// each: id, title, text(s,k), when(s,k), options: [{ label, hint, run(s,k,rng) -> string }]
export const EVENTS = [
  { id: 'refugees', title: 'Refugees at the gate', when: (s, k) => lands(s, k).length > 0,
    text: () => 'Families fleeing a burned village beg to settle in your lands.',
    options: [
      { label: 'Take them in', hint: '−30 food, +Order', run: (s, k) => { k.food -= 30; k.morale = clamp(k.morale + 9); return 'The refugees bless your name.'; } },
      { label: 'Conscript the men', hint: 'Recruits for your squads, −Order', run: (s, k, rng) => { const n = fill(s, k, 6, rng); k.morale = clamp(k.morale - 6); return `${n} conscripts joined your squads.`; } },
      { label: 'Turn them away', hint: '−Order', run: (s, k) => { k.morale = clamp(k.morale - 5); return 'The gates stay shut.'; } },
    ] },
  { id: 'doctor', title: 'A plague doctor', when: (s, k) => k.gold >= 80,
    text: () => 'A masked physician offers to tend your wounded, for a price.',
    options: [
      { label: 'Pay 80g', hint: 'All heroes fully healed', run: (s, k) => { if (!pay(k, 80)) return POOR; for (const h of heroes(s, k)) h.hp = 100; return 'Your heroes are on their feet again.'; } },
      { label: 'Send him off', hint: 'Nothing happens', run: () => 'The doctor wanders on.' },
    ] },
  { id: 'deserters', title: 'Deserters caught', when: (s, k) => heroes(s, k).length > 0,
    text: () => 'Soldiers were caught slipping away from camp at night.',
    options: [
      { label: 'Hang them', hint: '+Order, heroes −loyalty', run: (s, k) => { k.morale = clamp(k.morale + 2); for (const h of heroes(s, k)) h.loyalty = Math.max(0, h.loyalty - 3); return 'Nobody else will try that.'; } },
      { label: 'Pardon them', hint: 'Heroes +loyalty', run: (s, k) => { k.morale = clamp(k.morale + 3); for (const h of heroes(s, k)) h.loyalty = Math.min(100, h.loyalty + 3); return 'The men cheer your mercy.'; } },
      { label: 'Double their pay', hint: '−60g, +Order', run: (s, k) => { if (!pay(k, 60)) return POOR; k.morale = clamp(k.morale + 10); return 'Loyalty, bought and paid for.'; } },
    ] },
  { id: 'duel', title: 'A challenge', when: (s, k) => heroes(s, k).length > 0,
    text: (s, k, c) => `A wandering champion challenges ${(hero(s, c.hero) || {}).name || 'your best hero'} to single combat.`,
    prep: (s, k, rng) => ({ hero: (heroes(s, k).sort((a, b) => b.atk - a.atk)[0] || {}).id }),
    options: [
      { label: 'Accept', hint: 'Win: XP and fame. Lose: wounds', run: (s, k, rng, c) => { const h = mine(s, k, c.hero); if (!h) return 'The champion left.'; if (rng() < 0.45 + h.atk * 0.04) { gainHeroXp(h, 20, rng); k.morale = clamp(k.morale + 8); return `${h.name} won the duel to roaring cheers!`; } h.hp = Math.max(15, h.hp - 50); return `${h.name} was beaten and badly hurt.`; } },
      { label: 'Decline', hint: '−Order', run: (s, k) => { k.morale = clamp(k.morale - 4); return 'Whispers of cowardice spread.'; } },
    ] },
  { id: 'merchant', title: 'A travelling merchant', when: (s, k) => k.gold >= 150,
    text: () => 'A merchant with a heavy cart offers rare goods from distant lands.',
    options: [
      { label: 'Buy a treasure (150g)', hint: 'A good item', run: (s, k, rng) => { if (!pay(k, 150)) return POOR; const it = giveItem(s, rng, k.id, 2); return `You bought ${it.name}.`; } },
      { label: 'Buy grain (60g)', hint: '+70 food', run: (s, k) => { if (!pay(k, 60)) return POOR; k.food += 70; return 'The granaries fill up.'; } },
      { label: 'No thanks', hint: '', run: () => 'The merchant rolls on.' },
    ] },
  { id: 'prophecy', title: 'A prophecy', when: () => true,
    text: () => 'A seer foretells a great victory — if the realm makes an offering.',
    options: [
      { label: 'Make an offering (50g)', hint: '+Order for the war ahead', run: (s, k) => { if (!pay(k, 50)) return POOR; k.morale = clamp(k.morale + 12); return 'The omens are good.'; } },
      { label: 'Ignore the seer', hint: '', run: () => 'The seer shrugs and leaves.' },
    ] },
  { id: 'tribute', title: 'Bandits demand tribute', when: (s, k) => lands(s, k).length > 0 && k.gold >= 60,
    text: () => 'A bandit chief sends word: pay, or your villages burn.',
    options: [
      { label: 'Pay 60g', hint: 'Safe', run: (s, k, rng, c) => (pay(k, 60) ? 'The bandits ride off with your coin.' : EVENTS.find((e) => e.id === 'tribute').options[1].run(s, k, rng, c)) },
      { label: 'Refuse', hint: 'Risk a raid', run: (s, k, rng) => { if (lands(s, k).length && rng() < 0.5) { const t = rng.pick(lands(s, k)); t.ruined = Math.max(t.ruined, 1); k.food = Math.max(-20, k.food - 30); return `Bandits torched ${t.name}!`; } k.morale = clamp(k.morale + 5); return 'The bandits never came. Your people take heart.'; } },
    ] },
  { id: 'wedding', title: 'A noble wedding', when: (s, k) => heroes(s, k).some((h) => !(h.spouse > 0)),
    text: (s, k, c) => `A noble house offers a match for ${(hero(s, c.hero) || {}).name || 'one of your heroes'}.`,
    prep: (s, k, rng) => ({ hero: (rng.pick(heroes(s, k).filter((h) => !(h.spouse > 0))) || {}).id }),
    options: [
      { label: 'Accept the match', hint: 'A new hero joins as their spouse', run: (s, k, rng, c) => { const h = mine(s, k, c.hero); if (!h || h.spouse > 0) return 'The match fell through.'; const nh = makeHero(s, rng, k.fid, k.id, h.loc, { gender: h.gender === 'f' ? 'm' : 'f', level: Math.max(1, h.level - 1), troops: 3 }); nh.spouse = h.id; h.spouse = nh.id; nh.loyalty = 85; return `${h.name} wed ${nh.name}, who joins your realm!`; } },
      { label: 'Decline politely', hint: '', run: () => 'The house takes no offence.' },
    ] },
  { id: 'harvestfeast', title: 'Harvest festival', when: (s) => seasonOf(s.turn) === 'Autumn' && monthOf(s.turn) === 2,
    text: () => 'The harvest is in. The people ask for a feast.',
    options: [
      { label: 'Hold a feast (−40 food)', hint: '+Order', run: (s, k) => { k.food -= 40; k.morale = clamp(k.morale + 12); return 'The feast is remembered for years.'; } },
      { label: 'Store the grain', hint: '', run: () => 'The granaries stay full.' },
    ] },
  { id: 'mine', title: 'A new vein', when: (s, k) => lands(s, k).length > 1,
    text: () => 'Miners found a vein, but digging it out will cost workers and coin.',
    options: [
      { label: 'Dig (100g)', hint: '60% chance of 250g', run: (s, k, rng) => { if (!pay(k, 100)) return POOR; if (rng() < 0.6) { k.gold += 250; return 'Gold! The vein was rich.'; } return 'The vein ran dry.'; } },
      { label: 'Leave it', hint: '', run: () => 'The vein stays buried.' },
    ] },
  { id: 'wanderer', title: 'A stranger at court', when: () => true,
    text: () => 'A scarred wanderer asks to swear their sword to you.',
    options: [
      { label: 'Accept (120g)', hint: 'A new hero', run: (s, k, rng) => { const loc = (lands(s, k)[0] || {}).id ?? (heroes(s, k)[0] || {}).loc; if (loc == null) return 'No one was left to take their oath.'; if (!pay(k, 120)) return 'You could not pay them.'; const nh = makeHero(s, rng, rng.pick(FACTION_IDS), k.id, loc, { level: 2, troops: 4 }); nh.loyalty = 60; if (!k.troopRaces.includes(nh.fid)) k.troopRaces.push(nh.fid); return `${nh.name} joins your realm.`; } },
      { label: 'Send them away', hint: '', run: () => 'The stranger walks into the rain.' },
    ] },
  { id: 'storm', title: 'Storm damage', when: (s, k) => lands(s, k).length > 0,
    text: () => 'A great storm battered your towns. Rebuilding will cost you.',
    options: [
      { label: 'Rebuild at once (90g)', hint: '+Order', run: (s, k) => { if (!pay(k, 90)) return POOR; k.morale = clamp(k.morale + 3); return 'The walls stand again.'; } },
      { label: 'Let the people manage', hint: '−Order', run: (s, k) => { k.morale = clamp(k.morale - 8); return 'The people grumble as they rebuild.'; } },
    ] },
  { id: 'relic', title: 'A holy relic', when: (s, k) => k.gold >= 100,
    text: () => 'Pilgrims carry a relic through your lands. Its keepers would sell it.',
    options: [
      { label: 'Buy it (100g)', hint: '+loyalty for every hero', run: (s, k) => { if (!pay(k, 100)) return POOR; for (const h of heroes(s, k)) h.loyalty = clamp(h.loyalty + 8); return 'Your heroes take heart in the relic.'; } },
      { label: 'Let them pass', hint: '', run: () => 'The pilgrims move on.' },
    ] },
  { id: 'spyc', title: 'A captured spy', when: () => true,
    text: () => 'Guards caught a spy in your camp.',
    options: [
      { label: 'Interrogate', hint: 'Reveal a neighbour', run: (s, k, rng) => { const nb = [...new Set(lands(s, k).flatMap((t) => t.nb))].filter((n) => s.territories[n].owner !== k.id); if (!nb.length) return 'They knew nothing.'; const t = rng.pick(nb); k.intel[t] = { turn: s.turn + 2 }; return `The spy gave up the defences of ${s.territories[t].name}.`; } },
      { label: 'Turn them (50g)', hint: '+1 scout next month', run: (s, k) => { if (!pay(k, 50)) return POOR; k.scoutBonus = s.turn + 1; return 'The spy now works for you.'; } },
      { label: 'Execute', hint: '+Order', run: (s, k) => { k.morale = clamp(k.morale + 3); return 'Justice is swift.'; } },
    ] },
  { id: 'youths', title: 'Eager youths', when: (s, k) => heroes(s, k).length > 0,
    text: () => 'Young farmhands want to join your army instead of working the fields.',
    options: [
      { label: 'Let them enlist', hint: 'Recruits, −food next month', run: (s, k, rng) => { const n = fill(s, k, 5, rng); k.food -= 20; return `${n} youths joined your squads.`; } },
      { label: 'Send them home', hint: '+food', run: (s, k) => { k.food += 25; return 'The fields are well tended this year.'; } },
    ] },
];

export function choiceTick(state, rng) {
  state.choices = state.choices || [];
  for (const p of state.players) {
    const k = state.kingdoms[p.kingdom];
    if (!k || !k.alive) continue;
    const pending = state.choices.find((c) => c.kid === k.id);
    if (pending) { if (state.turn - pending.turn >= 2) resolveChoice(state, k.id, pending.opts.length - 1); continue; } // unanswered: the last (cautious) option
    if (state.turn < 3 || rng() > 0.25) continue;
    const pool = EVENTS.filter((e) => e.when(state, k) && !(k.recentEvents || []).includes(e.id));
    if (!pool.length) continue;
    const e = rng.pick(pool);
    const extra = e.prep ? e.prep(state, k, rng) : {};
    const c = { id: (state.choiceSeq = (state.choiceSeq || 0) + 1), kid: k.id, ev: e.id, turn: state.turn, ...extra };
    c.title = e.title; c.text = e.text(state, k, c); c.opts = e.options.map((o) => ({ label: o.label, hint: o.hint }));
    state.choices.push(c);
    k.recentEvents = [...(k.recentEvents || []), e.id].slice(-5);
  }
}

export function resolveChoice(state, kid, optIdx) {
  const c = (state.choices || []).find((x) => x.kid === kid);
  if (!c) return null;
  const e = EVENTS.find((x) => x.id === c.ev), k = state.kingdoms[kid];
  const o = e && e.options[optIdx];
  state.choices = state.choices.filter((x) => x !== c);
  if (!o || !k) return null;
  const result = o.run(state, k, rngFor(state, c.id * 31 + kid), c);
  log(state, `${c.title}: ${result}`, kid, 'choice');
  return result;
}
export const pendingChoice = (state, kid) => (state.choices || []).find((c) => c.kid === kid) || null;
