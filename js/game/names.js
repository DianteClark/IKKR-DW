// Place and kingdom name generators (seeded).
const A = ['Ash', 'Bel', 'Cor', 'Dun', 'El', 'Fal', 'Gal', 'Har', 'Ith', 'Kar', 'Lor', 'Mor', 'Nor', 'Ost', 'Pel', 'Rav', 'Sil', 'Tor', 'Ul', 'Val', 'Wyn', 'Yr', 'Zar', 'Brim', 'Cald', 'Drak', 'Fen', 'Gry', 'Hol', 'Kel', 'Myr', 'Quel', 'Thal', 'Vor'];
const B = ['dale', 'mere', 'hold', 'ford', 'wick', 'moor', 'reach', 'fell', 'gard', 'haven', 'stead', 'crag', 'march', 'vale', 'spire', 'watch', 'gate', 'barrow', 'holm', 'deep', 'rock', 'wood', 'fall', 'run', 'shire', 'keep'];
const TITLES = ['Kingdom', 'Dominion', 'Realm', 'Principality', 'Clans', 'Duchy', 'Empire', 'League', 'Throne', 'Free Holds'];

export function placeName(rng, used) {
  for (let i = 0; i < 60; i++) {
    const n = rng.pick(A) + rng.pick(B);
    if (!used.has(n)) { used.add(n); return n; }
  }
  return rng.pick(A) + rng.pick(B) + ' ' + used.size;
}

export function kingdomName(rng, place) { return `${rng.pick(TITLES)} of ${place}`; }

export const KINGDOM_COLORS = ['#e8443a', '#3a7bf0', '#f5c630', '#3fbf5a', '#b04ce0', '#f08a2a', '#2ad1c9', '#f05fae', '#8bd13a', '#6a5cf5', '#c9a37a', '#ffffff', '#7a1f1f', '#1f4f7a', '#d1e85c', '#ff9f8f', '#5c3a1f', '#9aa7b8'];
