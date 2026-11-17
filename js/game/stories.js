// Hero stories and nemeses.
// Heroes pick up personal quests from what happens to them: avenge fallen kin, reclaim a homeland, beat a nemesis,
// recover a relic from a ruin, or shield a free hamlet until it joins. Finishing one earns a title, a lasting stat and loyalty.
// A hero beaten, captured or killed by an enemy hero gains a nemesis; they trade words when they meet and fight harder.
import { hero, log, isHumanKingdom, rngFor } from './world.js';

const TITLES = {
  avenge: ['the Avenger', 'Bloodoath', 'the Unforgiving'],
  homeland: ['the Returned', 'Homebringer', 'of the Old Hearth'],
  rival: ['Nemesis-bane', 'the Victor', 'Grudgebreaker'],
  relic: ['Relicfinder', 'the Seeker', 'Tombwalker'],
  protect: ['the Warden', 'Shield of the Free', 'the Steadfast'],
};
const STAT = { avenge: 'atk', homeland: 'lead', rival: 'atk', relic: 'int', protect: 'def' };
const news = (state, kid, kind, text) => { if (isHumanKingdom(state, kid)) (state.newsQueue = state.newsQueue || []).push({ kid, kind, text }); };

export function questText(state, h) {
  const q = h.quest; if (!q) return null;
  const T = (id) => (state.territories[id] || {}).name || 'a lost land';
  switch (q.kind) {
    case 'avenge': return `Avenge ${q.who}: win a battle against ${(state.kingdoms[q.realm] || {}).name || 'their killers'}.`;
    case 'homeland': return `Reclaim the homeland: bring ${T(q.tid)} into your realm.`;
    case 'rival': { const n = hero(state, q.foe); return `Defeat your nemesis ${n ? n.name : ''}: beat them in battle.`; }
    case 'relic': return `Recover the relic: explore the ruin near ${T(q.tid)}.`;
    case 'protect': return `Shield the free folk: protect ${T(q.tid)} until it joins you.`;
    default: return null;
  }
}

function finish(state, h, rng) {
  const q = h.quest; h.quest = null;
  const title = rng.pick(TITLES[q.kind] || ['the Bold']);
  h.name = h.name.replace(/ (the \w+|[A-Z][a-z]+(bane|hand|born|keeper|breaker|oath|finder|walker))$/, '') + ' ' + title;
  h[STAT[q.kind]] = (h[STAT[q.kind]] || 0) + (STAT[q.kind] === 'lead' ? 1 : 2);
  h.loyalty = Math.min(100, h.loyalty + 15); h.morale = Math.min(100, (h.morale || 60) + 15);
  h.deeds = (h.deeds || 0) + 1;
  log(state, `${h.name} fulfilled a personal vow.`, h.kingdom, 'story');
  news(state, h.kingdom, 'heir', `${h.name} fulfilled their vow and earned a title! (+${STAT[q.kind] === 'lead' ? 1 : 2} ${STAT[q.kind].toUpperCase()}, loyalty up)`);
}

// called every season
export function storyTick(state, rng) {
  for (const h of state.heroes) {
    if (h.status !== 'active' || h.kingdom < 0) continue;
    const k = state.kingdoms[h.kingdom];
    const q = h.quest;
    if (q) {
      if (q.kind === 'homeland' && state.territories[q.tid] && state.territories[q.tid].owner === h.kingdom) q.done = true;
      if (q.kind === 'avenge' && !(state.kingdoms[q.realm] || {}).alive) q.done = true; // their foe fell anyway
      if (q.kind === 'rival') { const n = hero(state, q.foe); if (!n || n.status === 'dead') q.done = true; }
      if (q.kind === 'relic') { const s = (state.sites || []).find((x) => x.id === q.site); if (!s || (s.status !== 'active' && s.by !== h.id)) h.quest = null; }
      if (q.kind === 'protect' && state.territories[q.tid].owner >= 0 && !q.done) h.quest = null;
      if (h.quest && h.quest.done) finish(state, h, rng);
      else if (h.quest && state.turn - q.since > 40) h.quest = null; // vows fade
      continue;
    }
    if (rng() > 0.07) continue;
    // pick a vow that fits this hero's life
    const opts = [];
    if (h.nemesis != null) { const n = hero(state, h.nemesis); if (n && n.status === 'active' && n.kingdom !== h.kingdom) opts.push({ kind: 'rival', foe: n.id }); }
    if (h.homeTid != null && state.territories[h.homeTid] && state.territories[h.homeTid].owner !== h.kingdom && !k.landless) opts.push({ kind: 'homeland', tid: h.homeTid });
    const ruin = (state.sites || []).find((s) => s.kind === 'ruin' && s.status === 'active' && (s.tid === h.loc || state.territories[h.loc].nb.includes(s.tid)));
    if (ruin) opts.push({ kind: 'relic', site: ruin.id, tid: ruin.tid });
    const ham = state.territories[h.loc].nb.map((n) => state.territories[n]).find((t) => t.owner < 0);
    if (ham) opts.push({ kind: 'protect', tid: ham.id });
    if (!opts.length) continue;
    h.quest = { ...rng.pick(opts), since: state.turn };
    news(state, h.kingdom, 'family', `${h.name} swore a vow: ${questText(state, h)}`);
  }
}

// a hero fell or was taken: kin swear vengeance, the victor becomes their nemesis
export function onHeroLost(state, victim, byKid, victors) {
  const best = (victors || []).map((id) => hero(state, id)).filter(Boolean).sort((a, b) => b.level - a.level)[0];
  if (best) {
    victim.nemesis = best.id;
    if (best.nemesis == null) best.nemesis = victim.id;
  }
  if (victim.status !== 'dead' || byKid < 0) return;
  for (const x of state.heroes) {
    if (x.status !== 'active' || x.kingdom < 0 || x.quest) continue;
    const kin = x.spouse === victim.id || (x.parents || []).includes(victim.id) || (victim.parents || []).includes(x.id);
    if (!kin) continue;
    x.quest = { kind: 'avenge', realm: byKid, who: victim.name.split(' ')[0], since: state.turn };
    news(state, x.kingdom, 'war', `${x.name} swore to avenge ${victim.name}.`);
  }
}

// after a battle: settle vows and nemeses for the winners
export function onBattle(state, b, report) {
  const rng = rngFor(state, b.tid * 13 + 3);
  const winners = report.attWon ? b.attackers : b.defenders, loserKid = report.attWon ? b.def : b.att;
  const losers = report.attWon ? b.defenders : b.attackers;
  for (const id of losers) {
    const h = hero(state, id); if (!h) continue;
    if (report.captured.includes(id) || report.died.includes(id) || h._lost) onHeroLost(state, h, report.attWon ? b.att : b.def, winners);
  }
  for (const id of winners) {
    const h = hero(state, id); if (!h || h.status !== 'active') continue;
    const q = h.quest;
    if (q && q.kind === 'avenge' && q.realm === loserKid) q.done = true;
    if (q && q.kind === 'rival' && losers.includes(q.foe)) q.done = true;
    if (h.nemesis != null && losers.includes(h.nemesis)) {
      const n = hero(state, h.nemesis);
      log(state, `${h.name} settled the score with ${n ? n.name : 'an old foe'}.`, -1, 'story');
      if (n && n.nemesis === h.id) n.nemesis = null;
      h.nemesis = null;
    }
    if (h.quest && h.quest.done) finish(state, h, rng);
  }
}

// pairs of nemeses on opposite sides of a battle (for banter and the battle bonus)
export function nemesisPairs(state, b) {
  const out = [];
  for (const a of b.attackers) {
    const h = hero(state, a); if (!h || h.nemesis == null) continue;
    if (b.defenders.includes(h.nemesis)) out.push([a, h.nemesis]);
  }
  for (const d of b.defenders) {
    const h = hero(state, d); if (!h || h.nemesis == null) continue;
    if (b.attackers.includes(h.nemesis) && !out.some(([x, y]) => x === h.nemesis && y === d)) out.push([d, h.nemesis]);
  }
  return out;
}
