// Equipment generation. Icons come from AllItems.png.
import { ITEM_ICONS } from '../data/itemicons.js';

export const SLOTS = ['weapon', 'armor', 'helm', 'shield', 'gloves', 'boots', 'accessory'];
export const SLOT_NAMES = { weapon: 'Weapon', armor: 'Armor', helm: 'Helm', shield: 'Shield', gloves: 'Gloves', boots: 'Boots', accessory: 'Trinket' };
const NOUN = { weapon: ['Blade', 'Axe', 'Glaive', 'Warhammer', 'Spear', 'Saber', 'Maul'], armor: ['Mail', 'Cuirass', 'Robe', 'Hauberk'], helm: ['Helm', 'Crown', 'Hood', 'Visor'], shield: ['Shield', 'Aegis', 'Buckler'], gloves: ['Gauntlets', 'Bracers', 'Grips'], boots: ['Boots', 'Greaves', 'Striders'], accessory: ['Amulet', 'Ring', 'Talisman', 'Charm', 'Relic'] };
const RARITY = [
  { name: 'Common', adj: ['Iron', 'Sturdy', 'Worn', 'Plain'], pts: 2, color: '#d6d0c4' },
  { name: 'Fine', adj: ['Steel', 'Runed', 'Gilded', 'Fine'], pts: 4, color: '#6bd36b' },
  { name: 'Rare', adj: ['Mithril', 'Enchanted', 'Royal', 'Stormforged'], pts: 7, color: '#6bb6ff' },
  { name: 'Epic', adj: ['Dragon', 'Ancient', 'Mythic', 'Celestial'], pts: 11, color: '#d48bff' },
];
export function rarityColor(r) { return RARITY[r].color; }

// main stat weights per slot
const BIAS = { weapon: ['atk', 'atk', 'int'], armor: ['def', 'def', 'lead'], helm: ['def', 'int', 'morale'], shield: ['def', 'def'], gloves: ['atk', 'def'], boots: ['spd', 'def', 'lead'], accessory: ['int', 'lead', 'morale', 'atk'] };

export function makeItem(rng, id, tier = 0, slot) {
  slot = slot || rng.pick(SLOTS);
  const r = Math.max(0, Math.min(3, tier + (rng.chance(0.25) ? 1 : 0) - (rng.chance(0.2) ? 1 : 0)));
  const R = RARITY[r];
  const it = { id, slot, rarity: r, icon: rng.pick(ITEM_ICONS[slot]), atk: 0, def: 0, lead: 0, int: 0, morale: 0, spd: 0 };
  let pts = R.pts;
  while (pts > 0) {
    const k = rng.pick(BIAS[slot]);
    if (k === 'morale') { it.morale += 5; pts -= 1; }
    else if (k === 'spd') { it.spd += 0.05; pts -= 1; }
    else if (k === 'lead') { if (it.lead < 2) it.lead += 1; pts -= 2; }
    else { it[k] += 1; pts -= 1; }
  }
  it.spd = Math.round(it.spd * 100) / 100;
  it.name = `${rng.pick(R.adj)} ${rng.pick(NOUN[slot])}`;
  return it;
}

export function itemStatText(it) {
  const p = [];
  if (it.atk) p.push(`+${it.atk} ATK`);
  if (it.def) p.push(`+${it.def} DEF`);
  if (it.lead) p.push(`+${it.lead} LEAD`);
  if (it.int) p.push(`+${it.int} INT`);
  if (it.morale) p.push(`+${it.morale} MOR`);
  if (it.spd) p.push(`+${Math.round(it.spd * 100)}% SPD`);
  return p.join(' ');
}
