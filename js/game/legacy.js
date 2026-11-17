// Legacy across campaigns: a Hall of Fame of finished campaigns and achievements kept on this device.
// Some achievements unlock extra banner emblems. A new campaign may start with the heir of a famous hero.
import { FACTIONS } from '../data/art.js';
import { setEarnedSource } from '../engine/banner.js';

const FAME = 'ikkr-dw-fame', ACH = 'ikkr-dw-ach';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function hallOfFame() { return load(FAME, []); }
export function recordCampaign(state, kid, result) {
  if (state.fameRecorded && state.fameRecorded[kid]) return;
  state.fameRecorded = { ...(state.fameRecorded || {}), [kid]: true };
  const k = state.kingdoms[kid];
  const heroes = state.heroes.filter((h) => h.kingdom === kid || (h.origin === kid && h.status === 'dead')).sort((a, b) => (b.deeds || 0) * 3 + b.level - ((a.deeds || 0) * 3 + a.level)).slice(0, 3)
    .map((h) => ({ name: h.name, fid: h.fid, gender: h.gender, portrait: h.portrait, level: h.level, deeds: h.deeds || 0, atk: h.atk, def: h.def, lead: h.lead, int: h.int }));
  const ruler = state.heroes.find((h) => h.id === k.ruler);
  const list = hallOfFame();
  list.unshift({ when: Date.now(), cid: state.cid, realm: k.name, fid: k.fid, banner: k.banner, ruler: ruler ? ruler.name : '?', years: Math.floor((state.turn - 1) / 4) + 1, lands: state.territories.filter((t) => t.owner === kid).length, result, size: state.size, heroes });
  save(FAME, list.slice(0, 30));
}
// heroes worth descending from, for the new-campaign option
export function famousHeroes() {
  const out = [];
  for (const e of hallOfFame()) for (const h of e.heroes || []) if (h.level >= 5 || h.deeds) out.push({ ...h, realm: e.realm });
  return out.slice(0, 12);
}

// ---- achievements ----
export const ACHIEVEMENTS = [
  { id: 'conquest', name: 'First Blood', desc: 'Conquer a land.', test: (s, k) => s.territories.filter((t) => t.owner === k.id).length >= 2 },
  { id: 'kingdom', name: 'Crowned', desc: 'Grow your village into a kingdom.', test: (s, k) => k.tier !== 'village' },
  { id: 'empire', name: 'Emperor', desc: 'Become an empire.', test: (s, k) => k.tier === 'empire', unlock: 'royal' },
  { id: 'ten', name: 'Ten Lands', desc: 'Hold ten lands at once.', test: (s, k) => s.territories.filter((t) => t.owner === k.id).length >= 10 },
  { id: 'wed', name: 'Wedding Bells', desc: 'Two of your heroes marry.', test: (s, k) => s.heroes.some((h) => h.kingdom === k.id && h.spouse > 0) },
  { id: 'heir', name: 'Bloodline', desc: 'An heir comes of age.', test: (s, k) => s.heroes.some((h) => h.kingdom === k.id && h.parents && h.status === 'active'), unlock: 'heartshield' },
  { id: 'vow', name: 'Oathkeeper', desc: 'A hero fulfils a vow.', test: (s, k) => s.heroes.some((h) => h.kingdom === k.id && h.deeds) },
  { id: 'nemesis', name: 'Score Settled', desc: 'Defeat a nemesis.', test: (s, k) => s.log.some((l) => l.kind === 'story' && /settled the score/.test(l.text) && s.heroes.some((h) => h.kingdom === k.id && l.text.startsWith(h.name))) },
  { id: 'sites', name: 'Explorer', desc: 'Clear five wild sites.', test: (s, k) => (s.sites || []).filter((x) => x.owner === k.id && x.status !== 'active').length >= 5, unlock: 'orb' },
  { id: 'hamlet', name: 'Protector', desc: 'A free hamlet joins you peacefully.', test: (s, k) => s.log.some((l) => l.kid === k.id && /asked to join/.test(l.text)) },
  { id: 'warband', name: 'Wanderer', desc: 'Lose all land and rise again.', test: (s, k) => k.wasLandless && !k.landless },
  { id: 'vassals', name: 'Overlord', desc: 'Hold three vassals.', test: (s, k) => s.treaties.filter((t) => t.type === 'vassal' && t.a === k.id).length >= 3, unlock: 'tree' },
  { id: 'allies', name: 'Diplomat', desc: 'Have two allies at once.', test: (s, k) => s.treaties.filter((t) => t.type === 'alliance' && (t.a === k.id || t.b === k.id)).length >= 2 },
  { id: 'trade', name: 'Merchant Prince', desc: 'Earn 60g a month from trade.', test: (s, k, x) => (x.trade || 0) >= 60 },
  { id: 'siege', name: 'Patience', desc: 'Take a town by siege.', test: (s, k) => s.log.some((l) => /surrendered to/.test(l.text) && l.text.includes(k.name)) },
  { id: 'rich', name: 'Treasury', desc: 'Hoard 3000 gold.', test: (s, k) => k.gold >= 3000, unlock: 'coins' },
  { id: 'army', name: 'Host', desc: 'Command 150 soldiers.', test: (s, k) => s.heroes.filter((h) => h.kingdom === k.id && h.status === 'active').reduce((n, h) => n + h.troops.length, 0) >= 150 },
  { id: 'elite', name: 'Veterans', desc: 'Have ten named Elites.', test: (s, k) => s.heroes.filter((h) => h.kingdom === k.id).reduce((n, h) => n + h.troops.filter((t) => t.s === 3).length, 0) >= 10 },
  { id: 'year10', name: 'A Decade of Rule', desc: 'Reach year 10.', test: (s) => s.turn >= 37 },
  { id: 'victory', name: 'Dynasty', desc: 'Win a campaign.', test: (s, k) => s.over && (s.over.winner === k.id || (s.over.winners || []).includes(k.id)), unlock: 'crossshield' },
  ...Object.keys(FACTIONS).map((fid) => ({ id: 'win_' + fid, name: `Champion of the ${FACTIONS[fid].race}`, desc: `Win as ${FACTIONS[fid].name}.`, test: (s, k) => k.fid === fid && s.over && (s.over.winner === k.id || (s.over.winners || []).includes(k.id)) })),
];
export function unlockedAchievements() { return load(ACH, {}); }
// returns the achievements newly unlocked by this state
export function checkAchievements(state, kid, extra = {}) {
  const k = state.kingdoms[kid]; if (!k) return [];
  if (k.landless) k.wasLandless = true;
  const got = unlockedAchievements(), fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (got[a.id]) continue;
    let ok = false; try { ok = a.test(state, k, extra); } catch {}
    if (ok) { got[a.id] = Date.now(); fresh.push(a); }
  }
  if (fresh.length) save(ACH, got);
  return fresh;
}
// banner emblems earned by achievements
export function unlockedEmblems() {
  const got = unlockedAchievements();
  return ACHIEVEMENTS.filter((a) => a.unlock && got[a.id]).map((a) => a.unlock);
}

setEarnedSource(unlockedEmblems);
