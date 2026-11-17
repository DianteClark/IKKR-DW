// Custom pixel icons (10x10) in the game's palette, replacing emoji everywhere in the interface.
// Each icon is a little grid: '.' empty, letters index the palette below.
const PAL = {
  k: '#1a1420', y: '#f5d860', o: '#d89a2a', b: '#a8742a', w: '#f4ecd8', g: '#c9c2b0', s: '#8a96a8', d: '#5a6478',
  r: '#d63a2f', R: '#8a1c1c', G: '#57b84a', D: '#2f7d32', u: '#3a7bf0', U: '#1d3f8f', c: '#9fd8f0', p: '#c2417f', n: '#7a4a1f', l: '#e8b23a',
};
const ICONS = {
  gold: ['...kkkk...', '..kyyyyk..', '.kyywwyyk.', 'kyywyyyybk', 'kyyyyyyybk', 'kyyyyyyybk', 'kyyyyyybbk', '.kyyybbbk.', '..kbbbbk..', '...kkkk...'],
  food: ['....l.....', '...lol.l..', '..lol.lol.', '..lol.lol.', '...l.lol..', '...nn.l...', '....nnn...', '.....nn...', '.....n....', '.....n....'],
  morale: ['...kkkk...', '..kyyyyk..', '.kyyyyyyk.', 'kyykyykyyk', 'kyyyyyyyyk', 'kykyyyykyk', 'kyykkkkyyk', '.kyyyyyyk.', '..kyyyyk..', '...kkkk...'],
  stability: ['....kk....', '....yy....', 'kkkkyykkkk', '.y..yy..y.', 'yyy.yy.yyy', 'kkk.yy.kkk', '....yy....', '....yy....', '..kyyyyk..', '..kkkkkk..'],
  home: ['....kk....', '...kRRk...', '..kRRRRk..', '.kRRRRRRk.', 'kkwwwwwwkk', '.kwwkkwwk.', '.kwwknwwk.', '.kwwknwwk.', '.kwwknwwk.', '.kkkkkkkk.'],
  menu: ['..........', '.kkkkkkkk.', '.wwwwwwww.', '.kkkkkkkk.', '..........', '.kkkkkkkk.', '.wwwwwwww.', '.kkkkkkkk.', '.wwwwwwww.', '.kkkkkkkk.'],
  chat: ['.kkkkkkkk.', 'kwwwwwwwwk', 'kwkkkkkkwk', 'kwwwwwwwwk', 'kwkkkkwwwk', 'kwwwwwwwwk', '.kkkwkkkk.', '...kwk....', '...kk.....', '..........'],
  swords: ['k.......k.', 'sk.....ks.', '.sk...ks..', '..sk.ks...', '...sks....', '...ksk....', '..ks.sk...', '.nk...kn..', 'nk.....kn.', 'k.......k.'],
  warning: ['....kk....', '...kyyk...', '...kyyk...', '..kyKkyk..', '..kykkyk..', '.kyykkyyk.', '.kyyyyyyk.', 'kyyykkyyyk', 'kyyyyyyyyk', 'kkkkkkkkkk'],
  snow: ['....c.....', '..c.c.c...', '...ccc....', 'ccccwcccc.', '...ccc....', '..c.c.c...', '....c.....', '..........', '..........', '..........'],
  sun: ['....y.....', '.y..y..y..', '..yyyyy...', '..yllly...', 'yyylllyyy.', '..yllly...', '..yyyyy...', '.y..y..y..', '....y.....', '..........'],
  storm: ['..ggg.....', '.gggggg...', 'gggggggg..', 'dddddddd..', '...yy.....', '..yy......', '.yyyy.....', '...yy.....', '..yy......', '..........'],
  cloud: ['..........', '...ggg....', '..gwwwg...', '.gwwwwwgg.', 'gwwwwwwwwg', 'gwwwwwwwwg', '.gggggggg.', '..........', '..........', '..........'],
  leaf: ['......oo..', '....oooo..', '...ooroo..', '..ooroooo.', '.ooroooo..', '.oroooo...', '.rooo.....', 'r.........', '..........', '..........'],
  sprout: ['..........', '..GG..GG..', '.GDGG.GDG.', '..GDG.DG..', '....DD....', '....D.....', '....D.....', '..nnnnnn..', '.nnnnnnnn.', '..........'],
  heart: ['..........', '.rr...rr..', 'rwrr.rrrr.', 'rrrrrrrrr.', 'rrrrrrrrr.', '.rrrrrrr..', '..rrrrr...', '...rrr....', '....r.....', '..........'],
  lock: ['...kkkk...', '..ks..sk..', '..ks..sk..', '..ks..sk..', '.kkkkkkkk.', '.kyyyyyyk.', '.kyykkyyk.', '.kyyykyyk.', '.kyyyyyyk.', '.kkkkkkkk.'],
  dice: ['kkkkkkkkk.', 'kwwwwwwwk.', 'kwkwwwkwk.', 'kwwwwwwwk.', 'kwwwkwwwk.', 'kwwwwwwwk.', 'kwkwwwkwk.', 'kwwwwwwwk.', 'kkkkkkkkk.', '..........'],
  star: ['....y.....', '....y.....', '...yyy....', 'yyyyyyyyy.', '.yyyyyyy..', '..yyyyy...', '..yy.yy...', '.yy...yy..', '.y.....y..', '..........'],
  flag: ['k.........', 'kRRRRRR...', 'kRyRRRRR..', 'kRRRRRRRR.', 'kRRRRRRR..', 'kRRRRRR...', 'k.........', 'k.........', 'k.........', 'k.........'],
  crown: ['..........', 'y..y..y..y', 'yy.yy.yy.y', 'yyyyyyyyyy', 'yyryyuyyry', 'yyyyyyyyyy', 'oooooooooo', '..........', '..........', '..........'],
  cross: ['....k.....', '...kwk....', '.kkkwkkk..', 'kwwwwwwwk.', '.kkkwkkk..', '...kwk....', '...kwk....', '...kwk....', '...kkk....', '..........'],
  letter: ['..........', 'kkkkkkkkkk', 'kwkwwwwkwk', 'kwwkwwkwwk', 'kwwwkkwwwk', 'kwwwwwwwwk', 'kwwwwwwwwk', 'kkkkkkkkkk', '..........', '..........'],
  broken: ['kkk....kkk', 'krrk..krrk', '.krrkkrrk.', '..krrrrk..', '...krrk...', '..krrrrk..', '.krrkkrrk.', 'krrk..krrk', 'kkk....kkk', '..........'],
  points: ['....u.....', '...uuu....', '..uucuu...', '.uucccuu..', 'uucccccuu.', '.uucccuu..', '..uucuu...', '...uuu....', '....u.....', '..........'],
  male: ['....kkkkk.', '.....kuuk.', '....ku.uk.', '..kkku.k..', '.kuuuk....', 'kuk.kuk...', 'kuk.kuk...', '.kuuuk....', '..kkk.....', '..........'],
  female: ['..kkk.....', '.kpppk....', 'kpk.kpk...', 'kpk.kpk...', '.kpppk....', '..kpk.....', '.kkpkk....', '..kpk.....', '..kkk.....', '..........'],
  wave: ['..k.k.....', '.kwkwk.k..', '.kwkwkkwk.', 'kkwwwwwwk.', 'kwwwwwwwk.', 'kwwwwwwk..', '.kwwwwwk..', '..kwwwk...', '...kkk....', '..........'],
};
export const ICON_NAMES = Object.keys(ICONS);
const cache = new Map();
function canvasFor(name) {
  if (cache.has(name)) return cache.get(name);
  const rows = ICONS[name] || ICONS.star;
  const c = document.createElement('canvas'); c.width = 10; c.height = 10;
  const x = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, xx) => { if (ch !== '.' && PAL[ch === 'K' ? 'k' : ch]) { x.fillStyle = PAL[ch === 'K' ? 'k' : ch]; x.fillRect(xx, y, 1, 1); } }));
  cache.set(name, c);
  return c;
}
// an inline <canvas> icon; size in CSS px (default 18)
export function picon(name, size = 18, cls = '') {
  const c = document.createElement('canvas');
  c.width = 20; c.height = 20; c.className = 'picon ' + cls;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(canvasFor(name), 0, 0, 20, 20);
  return c;
}
// draw onto a canvas context (for map/battle text)
export function drawIcon(ctx, name, x, y, size = 10) { ctx.drawImage(canvasFor(name), Math.round(x), Math.round(y), size, size); }
