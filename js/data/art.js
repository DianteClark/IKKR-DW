// Where everything lives in the sprite sheets, plus small draw helpers.
import { UNIT_SHEETS } from './units.js';
import { img, recolor, eliteTint } from '../engine/assets.js';

const H = 'assets/has2020/';
const TOWNS = H + 'Buildings/Towns/AllTownsSpriteSheet.png';
const DWELL = H + 'Buildings/Dwellings/AllDwellingsSpriteSheet.png';
const ICONS = H + 'Heroes/HeroIconSheet.png';

// Index of each core faction inside the combined HAS2020 sheets.
const CORE = { stronghold: 0, inferno: 1, castle: 2, enclave: 3, tower: 4, necropolis: 5, rampart: 6 };

function corePortraits(i) {
  const out = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 20; c++) out.push([ICONS, c * 16, 48 * i + 16 + r * 16]);
  return out;
}
function rowPortraits(src, rows, cols = [0, 16]) {
  const out = [];
  for (const y of rows) for (const x of cols) out.push([src, x, y]);
  return out;
}
const heroSheet = (n) => H + `Heroes/${n}`;

export const FACTIONS = {
  castle: {
    name: 'Castle', race: 'Humans', biomes: ['grass', 'dirt'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.castle + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.castle + 16, 32, 32],
    heroes: heroSheet('Humans (Castle)/CastleHeroesSpriteSheet.png'), portraits: corePortraits(CORE.castle),
    names: ['Aldric', 'Bertram', 'Cedric', 'Edmund', 'Gareth', 'Isolde', 'Rowena', 'Lionel', 'Matilda', 'Percival', 'Oswin', 'Elaine', 'Godfrey', 'Helena', 'Tristan', 'Gwen', 'Roland', 'Beatrix', 'Alaric', 'Sabine'],
  },
  rampart: {
    name: 'Rampart', race: 'Wood Elves', biomes: ['grass', 'marsh'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.rampart + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.rampart + 16, 32, 32],
    heroes: heroSheet('WoodElves (Rampart)/RampartHeroesSpriteSheet.png'), portraits: corePortraits(CORE.rampart),
    names: ['Aelar', 'Faelwen', 'Thalion', 'Sylvara', 'Elandor', 'Mirelle', 'Caelum', 'Ilyana', 'Lorien', 'Nimue', 'Erevan', 'Seren', 'Galad', 'Liriel', 'Varis', 'Aerin', 'Thranduin', 'Ysolde', 'Fenris', 'Calen'],
  },
  tower: {
    name: 'Tower', race: 'Sages', biomes: ['ice', 'christmas', 'sand'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.tower + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.tower + 16, 32, 32],
    heroes: heroSheet('Sagesy (Tower)/TowerHeroesSpriteSheet.png'), portraits: corePortraits(CORE.tower),
    names: ['Zoltan', 'Azura', 'Malachar', 'Ophira', 'Thessaly', 'Quillon', 'Serafina', 'Ignatius', 'Cassia', 'Belzar', 'Vesper', 'Orrin', 'Nadira', 'Xander', 'Lumen', 'Astra', 'Dorian', 'Celestia', 'Merrick', 'Yara'],
  },
  inferno: {
    name: 'Inferno', race: 'Demons', biomes: ['lava', 'dirt'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.inferno + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.inferno + 16, 32, 32],
    heroes: heroSheet('Demons (Inferno)/InfernoHeroesSpriteSheet.png'), portraits: corePortraits(CORE.inferno),
    names: ['Malgorath', 'Xezbeth', 'Vorlath', 'Ashara', 'Brimmok', 'Kezzrah', 'Infernus', 'Lilitha', 'Draxos', 'Pyrrha', 'Moloch', 'Nyxara', 'Zagan', 'Sythra', 'Baelor', 'Cindra', 'Grishnak', 'Vashti', 'Ignar', 'Ravena'],
  },
  necropolis: {
    name: 'Necropolis', race: 'Undead', biomes: ['deepmarsh', 'cave', 'dungeon'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.necropolis + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.necropolis + 16, 32, 32],
    heroes: heroSheet('Undeads (Necropolis)/NecropolisHeroesSpriteSheet.png'), portraits: corePortraits(CORE.necropolis),
    names: ['Mordrake', 'Severa', 'Vlastor', 'Morwen', 'Kharos', 'Lenore', 'Grimwald', 'Ysabeth', 'Thanatos', 'Ravenna', 'Ossric', 'Mortis', 'Sepulchra', 'Draven', 'Vex', 'Cadavra', 'Malric', 'Ebonne', 'Skarn', 'Wraithe'],
  },
  stronghold: {
    name: 'Stronghold', race: 'Barbarians', biomes: ['dirt', 'sand'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.stronghold + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.stronghold + 16, 32, 32],
    heroes: heroSheet('Barbarians (Stronghold)/StrongholdHeroesSpriteSheet.png'), portraits: corePortraits(CORE.stronghold),
    names: ['Krag', 'Urgra', 'Thokk', 'Brunhild', 'Gorm', 'Hilda', 'Ragnar', 'Sigrun', 'Drog', 'Yrsa', 'Borka', 'Halvar', 'Grenda', 'Skuld', 'Torvald', 'Astrid', 'Bjorn', 'Freydis', 'Ulfar', 'Inga'],
  },
  enclave: {
    name: 'Enclave', race: 'Lizardmen', biomes: ['marsh', 'deepmarsh'],
    town: (stage) => [TOWNS, Math.min(4, stage) * 64, 80 * CORE.enclave + 16, 64, 64],
    dwelling: (i) => [DWELL, i * 32, 48 * CORE.enclave + 16, 32, 32],
    heroes: heroSheet('Lizardmens (Enclave)/EnclaveHeroesSpriteSheet.png'), portraits: corePortraits(CORE.enclave),
    names: ['Ssarith', 'Kaxil', 'Zhessa', 'Tlaloc', 'Ixchel', 'Sskar', 'Quetza', 'Xolot', 'Hissra', 'Tezca', 'Ssyth', 'Kukul', 'Yzhara', 'Chak', 'Zotz', 'Ixtla', 'Sslith', 'Coatl', 'Nahua', 'Tzima'],
  },
  orcs: {
    name: 'Orc Empire', race: 'Orcs', biomes: ['dirt', 'sand', 'lava'],
    town: (stage) => stage >= 4 ? [TOWNS, 4 * 64, 80 * CORE.stronghold + 16, 64, 64] : ['assets/orcs/OrcBuildings.png', 0, 32, 64, 64],
    dwelling: (i) => [['assets/orcs/OrcBuildings.png', 64, 32, 32, 32], ['assets/orcs/OrcBuildings.png', 96, 32, 32, 32], ['assets/orcs/OrcBuildings.png', 64, 64, 32, 32], ['assets/orcs/OrcBuildings.png', 96, 64, 32, 32], ['assets/orcs/OrcBuildings.png', 32, 0, 32, 32], ['assets/orcs/OrcBuildings.png', 96, 0, 32, 32], ['assets/orcs/OrcBuildings.png', 64, 0, 32, 32]][i % 7],
    heroes: heroSheet('Barbarians (Stronghold)/StrongholdHeroesSpriteSheet.png'), heroTint: true,
    portraits: rowPortraits('assets/orcs/OrcSpriteSheet.png', [16, 32, 48, 64, 80, 96, 112]),
    names: ['Grommash', 'Durza', 'Kargath', 'Shagra', 'Morka', 'Gorbag', 'Ugluk', 'Zogra', 'Narzug', 'Bolga', 'Rokhan', 'Grisha', 'Thrakk', 'Murga', 'Azog', 'Lurtz'],
  },
  dwarves: {
    name: 'Dwarven Holds', race: 'Dwarves', biomes: ['ice', 'cave', 'christmas'],
    town: (stage) => ['assets/dwarves/Buildings/DwarvesCastlesSpriteSheet.png', Math.min(3, stage) * 64, 0, 64, 64],
    dwelling: (i) => ['assets/dwarves/Buildings/DwarvesDwellingsSpriteSheet.png', (i % 3) * 32, Math.floor(i / 3) % 3 * 32, 32, 32],
    heroes: 'assets/dwarves/Heroes/DwarvesHeroesSpriteSheet.png',
    portraits: (() => { const o = []; for (let r = 1; r < 3; r++) for (let c = 0; c < 20; c++) o.push(['assets/dwarves/Heroes/DwarvesHeroesIconSheet.png', c * 16, r * 16]); return o; })(),
    names: ['Thorin', 'Brunna', 'Dwalin', 'Helga', 'Gimrek', 'Dagna', 'Balin', 'Thora', 'Durin', 'Kili', 'Orla', 'Bombur', 'Runa', 'Gloin', 'Vigdis', 'Nori', 'Embla', 'Fundin', 'Sigrid', 'Brokk'],
  },
  conflux: {
    name: 'Conflux', race: 'Elementals', biomes: ['cave', 'lava', 'ice'],
    town: (stage) => stage >= 2 ? ['assets/buildings_pack/Towns/ForgeCastle.png', 0, 0, 48, 48] : ['assets/buildings_pack/Towns/OldTower.png', 0, 0, 48, 48],
    dwelling: (i) => [H + 'Buildings/2x2/2x2BuildingsSpriteSheet.png', (i % 7) * 32, 32 * (3 + (i % 3)), 32, 32],
    heroes: heroSheet('Sagesy (Tower)/TowerHeroesSpriteSheet.png'),
    portraits: rowPortraits(H + 'Creatures/Elementals/ElementalSpriteSheet.png', [16, 32, 48, 64, 80, 96, 112, 128, 144, 160]),
    names: ['Aeris', 'Terran', 'Hydra', 'Ignis', 'Zephyra', 'Magmar', 'Glacius', 'Tempest', 'Pyra', 'Boulder', 'Mistral', 'Cinder', 'Tidus', 'Quartz', 'Nimbus', 'Ember'],
  },
};
export const FACTION_IDS = Object.keys(FACTIONS);
for (const id of FACTION_IDS) FACTIONS[id].units = UNIT_SHEETS[id].units;

// ---- biomes (all LandTilesets share one layout) ----
const B = H + 'Biomes/';
export const BIOMES = {
  grass: { name: 'Grassland', src: B + 'GrassBiome/GB-LandTileset.png', tree: [0, 0], mtn: 0, col: '#59c135' },
  dirt: { name: 'Badlands', src: B + 'DirtBiome/DB-LandTileset.png', tree: [416, 0], mtn: 0, col: '#bb7547' },
  sand: { name: 'Desert', src: B + 'SandBiome/SB-LandTileset.png', tree: null, mtn: 208, col: '#c7b08b' },
  ice: { name: 'Tundra', src: B + 'IceBiome/IB-LandTileset.png', tree: [832, 0], mtn: 624, col: '#e3e6ff' },
  christmas: { name: 'Frostvale', src: B + 'ChristmasBiome/CrB-LandTileset.png', tree: [624, 0], mtn: 624, col: '#ffffff' },
  marsh: { name: 'Marsh', src: B + 'MarshBiome/MB-LandTileset.png', tree: [624, 144], mtn: 0, col: '#24523b' },
  deepmarsh: { name: 'Deep Marsh', src: B + 'DeepMarshBiome/DMB-LandTileset.png', tree: [832, 96], mtn: 416, col: '#24523b' },
  lava: { name: 'Ashlands', src: B + 'LavaBiome/LB-LandTileset.png', tree: [624, 288], mtn: 416, col: '#4a5462' },
  cave: { name: 'Caverns', src: B + 'CaveBiome/CB-LandTileset.png', tree: [832, 192], mtn: 416, col: '#f4d29c' },
  dungeon: { name: 'Underdeep', src: B + 'DungeonBiome/DGB-LandTileset.png', tree: [416, 144], mtn: 416, col: '#4a5462' },
};
export const BIOME_IDS = Object.keys(BIOMES);
export const TREES = H + 'Landscape Objects/TreesAndMountainsSpriteSheet.png';
export const OCEAN = B + 'Universal-Ocean-Static.png';
export const OCEAN_ANIM = B + 'Animated/Universal-Ocean-Animated.png';
// fill tiles: [x,y] in every LandTileset
export const TILE = {
  plain: [16, 0], textured: [[16, 16], [0, 240], [0, 256], [16, 224], [16, 240], [16, 256]],
  decor: [[32, 0], [48, 0], [32, 16], [48, 16], [64, 0], [80, 0], [64, 16], [80, 16], [96, 0], [112, 0], [96, 16], [112, 16], [128, 0], [144, 0], [128, 16], [144, 16]],
};

export const DUNGEON_TILES = 'assets/weekly/Dungeon-Tileset.png';
export const DUNGEON_OVERWORLD = 'assets/dungeon/Overworld Dungeon/HAS-Dungeon.png';
export const STRUCT = H + 'Landscape Objects/StructuresSpriteSheet.png';
export const BUILD2 = H + 'Buildings/2x2/2x2BuildingsSpriteSheet.png';
export const ITEMS = H + 'Items/AllItems.png';
export const SPELL_ICONS = H + 'Magic Spells/MagicSpellsIcons.png';
export const WALLS = 'assets/weekly/WallsSpriteSheet.png';
export const DESTROYED = 'assets/weekly/DestroyedTowns.png';

// ---- drawing ----
export function unitImage(fid, stage) {
  const sh = UNIT_SHEETS[fid];
  return img(sh.src);
}

// draw a creature frame. anchor = feet center.
export function drawUnit(ctx, fid, ui, stage, anim, t, x, y, flip, alpha = 1) {
  const sh = UNIT_SHEETS[fid];
  const u = sh.units[ui];
  let im = img(sh.src);
  if (!im) return;
  if (stage === 2 && u.tint2) im = recolor(sh.src, 'elite', eliteTint) || im;
  const a = sh.anims[anim] || sh.anims.idle;
  const f = anim === 'death' ? Math.min(a[1] - 1, Math.floor(t)) : Math.floor(t) % a[1];
  const sx = a[0] + f * 16, sy = u.y[stage === 2 ? 1 : 0];
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (flip) {
    ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1);
    ctx.drawImage(im, sx, sy, 16, 16, -8, Math.round(y) - 14, 16, 16);
    ctx.restore();
  } else ctx.drawImage(im, sx, sy, 16, 16, Math.round(x) - 8, Math.round(y) - 14, 16, 16);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

// hero sheets: header row, then 6 direction rows male, 6 female. col0 = arrow icon (skip if present)
// dir: 0 idle,1 right,2 down-right,3 down,4 up-left,5 up
const HERO_ANIMS = { walk: 0, attack: 4, hit: 8, death: 12 };
export function drawHero(ctx, fid, gender, dir, anim, t, x, y, flip) {
  const F = FACTIONS[fid];
  let im = img(F.heroes);
  if (!im) return;
  if (F.heroTint) im = recolor(F.heroes, 'orc', (r, g, b) => [r * 0.55, Math.min(255, g * 1.1 + 25), b * 0.5]) || im;
  const x0 = im.width === 272 ? 16 : 0;
  const a = HERO_ANIMS[anim] ?? 0;
  const f = anim === 'death' ? Math.min(3, Math.floor(t)) : Math.floor(t) % 4;
  const sx = x0 + (a + f) * 16, sy = 16 + (gender === 'f' ? 6 : 0) * 16 + dir * 16;
  if (flip) {
    ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1);
    ctx.drawImage(im, sx, sy, 16, 16, -8, Math.round(y) - 15, 16, 16);
    ctx.restore();
  } else ctx.drawImage(im, sx, sy, 16, 16, Math.round(x) - 8, Math.round(y) - 15, 16, 16);
}

export function drawSpriteRef(ctx, ref, x, y, w, h) {
  const im = img(ref[0]);
  if (!im) return;
  ctx.drawImage(im, ref[1], ref[2], ref[3], ref[4], Math.round(x), Math.round(y), w ?? ref[3], h ?? ref[4]);
}

export function portraitRef(fid, idx) {
  const p = FACTIONS[fid].portraits;
  const r = p[idx % p.length];
  return [r[0], r[1], r[2], 16, 16];
}

// every sheet the game draws, for preloading
export function allArt() {
  const s = new Set();
  for (const id of FACTION_IDS) {
    const F = FACTIONS[id];
    s.add(UNIT_SHEETS[id].src); s.add(F.heroes);
    for (let st = 0; st < 5; st++) s.add(F.town(st)[0]);
    for (let i = 0; i < 7; i++) s.add(F.dwelling(i)[0]);
    for (const p of F.portraits) s.add(p[0]);
  }
  for (const b of Object.values(BIOMES)) s.add(b.src);
  [TREES, OCEAN, OCEAN_ANIM, DUNGEON_TILES, DUNGEON_OVERWORLD, STRUCT, BUILD2, ITEMS, SPELL_ICONS, WALLS, DESTROYED].forEach((x) => s.add(x));
  return [...s];
}
