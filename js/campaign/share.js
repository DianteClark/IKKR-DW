// "Share my realm": a polished postcard of your lands — the map around your realm, your banner, name, year and stats.
import { renderRegion, drawTowns, drawSites, drawGuards, drawAnimated, TS } from './mapview.js';
import { kingdomHeroes, kingdomTerritories, totalTroops } from '../game/world.js';
import { TIERS, tierIndex } from '../game/rules.js';
import { FACTIONS } from '../data/art.js';
import { yearOf, dateOf } from '../game/family.js';
import { bannerCanvas, BANNER_W, BANNER_H } from '../engine/banner.js';
import { h, modal, toast } from '../engine/ui.js';
import { sfx } from '../engine/audio.js';

const OUT_W = 1280, OUT_H = 720, MAP_SCALE = 2;

function renderRealmCard(state, T, kid) {
  const k = state.kingdoms[kid];
  const lands = kingdomTerritories(state, kid);
  const heroes = kingdomHeroes(state, kid, true);
  // frame the map on the realm: bounding box of its lands (or the warband), padded, at most one screenful
  const pts = lands.length ? lands : heroes.map((x) => state.territories[x.loc]);
  let x0 = Math.min(...pts.map((t) => t.cx)), x1 = Math.max(...pts.map((t) => t.cx)), y0 = Math.min(...pts.map((t) => t.cy)), y1 = Math.max(...pts.map((t) => t.cy));
  const cw = Math.round(OUT_W / MAP_SCALE / TS), ch = Math.round(OUT_H / MAP_SCALE / TS);
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
  const sx = Math.max(0, Math.min(T.W - cw, cx - (cw >> 1))), sy = Math.max(0, Math.min(T.H - ch, cy - (ch >> 1) + 2));
  const mapC = renderRegion(T, sx, sy, Math.min(cw, T.W), Math.min(ch, T.H));
  const m = mapC.getContext('2d');
  m.save(); m.translate(-sx * TS, -sy * TS);
  const view = { x: sx * TS, y: sy * TS, w: cw * TS, h: ch * TS };
  try { drawAnimated(m, T, 0.4, view); drawSites(m, state, T, 0.4, view); drawGuards(m, T, state, 0.4, view); drawTowns(m, state, 0.4, view); } catch (e) { console.warn(e); }
  m.restore();

  const c = document.createElement('canvas'); c.width = OUT_W; c.height = OUT_H;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#14101c'; x.fillRect(0, 0, OUT_W, OUT_H);
  x.drawImage(mapC, 0, 0, mapC.width * MAP_SCALE, mapC.height * MAP_SCALE);
  // vignette + left panel for the title
  let g = x.createLinearGradient(0, 0, OUT_W * 0.55, 0);
  g.addColorStop(0, 'rgba(12,9,18,.92)'); g.addColorStop(0.7, 'rgba(12,9,18,.55)'); g.addColorStop(1, 'rgba(12,9,18,0)');
  x.fillStyle = g; x.fillRect(0, 0, OUT_W, OUT_H);
  g = x.createLinearGradient(0, OUT_H - 140, 0, OUT_H); g.addColorStop(0, 'rgba(12,9,18,0)'); g.addColorStop(1, 'rgba(12,9,18,.85)');
  x.fillStyle = g; x.fillRect(0, OUT_H - 140, OUT_W, 140);
  // banner
  const bs = 7;
  x.drawImage(bannerCanvas(k.banner, 1), 54, 70, BANNER_W * bs, BANNER_H * bs);
  // title text
  const tx = 54 + BANNER_W * bs + 34;
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#c9a25a'; x.font = '800 22px Nunito, sans-serif';
  x.fillText(dateOf(state.turn).toUpperCase(), tx, 118);
  x.font = '800 54px Nunito, sans-serif';
  const name = k.landless ? `The Warband` : k.name;
  const words = name.split(' '); let line = '', ly = 182; const lines = [];
  for (const w of words) { const t2 = line ? line + ' ' + w : w; if (x.measureText(t2).width > 470 && line) { lines.push(line); line = w; } else line = t2; }
  lines.push(line);
  for (const l of lines.slice(0, 3)) { x.fillStyle = '#0a0710'; x.fillText(l, tx + 3, ly + 3); x.fillStyle = '#ffd86b'; x.fillText(l, tx, ly); ly += 60; }
  x.fillStyle = '#e8dfc8'; x.font = '700 24px Nunito, sans-serif';
  x.fillText(`${k.landless ? 'Landless' : TIERS[tierIndex(k)].name} of ${FACTIONS[k.fid].race}`, tx, ly + 6);
  // stats row
  const stats = [[lands.length, lands.length === 1 ? 'land' : 'lands'], [heroes.length, heroes.length === 1 ? 'hero' : 'heroes'], [totalTroops(state, kid), 'soldiers'], [k.gold, 'gold']];
  let px = 54;
  for (const [v, l] of stats) {
    x.fillStyle = 'rgba(20,14,30,.8)'; x.fillRect(px, OUT_H - 120, 150, 70);
    x.strokeStyle = '#b8894a'; x.lineWidth = 3; x.strokeRect(px + 1.5, OUT_H - 118.5, 147, 67);
    x.fillStyle = '#ffd86b'; x.font = '800 32px Nunito, sans-serif'; x.fillText(String(v), px + 14, OUT_H - 80);
    x.fillStyle = '#c9c0ae'; x.font = '700 18px Nunito, sans-serif'; x.fillText(l, px + 14, OUT_H - 58);
    px += 166;
  }
  // ruler + footer flourish
  const ruler = state.heroes.find((x2) => x2.id === k.ruler);
  if (ruler) { x.fillStyle = '#e8dfc8'; x.font = '700 20px Nunito, sans-serif'; x.fillText(`Ruled by ${ruler.name}`, tx, ly + 40); }
  x.fillStyle = 'rgba(255,216,107,.85)'; x.font = '800 18px Nunito, sans-serif';
  x.textAlign = 'right'; x.fillText('DYNASTY WARS', OUT_W - 34, OUT_H - 30); x.textAlign = 'left';
  x.strokeStyle = '#b8894a'; x.lineWidth = 6; x.strokeRect(3, 3, OUT_W - 6, OUT_H - 6);
  x.strokeStyle = '#1a1420'; x.lineWidth = 2; x.strokeRect(9, 9, OUT_W - 18, OUT_H - 18);
  return c;
}

export function shareRealm(state, T, kid) {
  let c;
  try { c = renderRealmCard(state, T, kid); } catch (e) { console.warn(e); toast('Could not draw your realm', 'bad'); return; }
  sfx('open');
  const img = h('img', { src: c.toDataURL('image/png'), style: { width: '100%', maxHeight: '58vh', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '3px' } });
  const fname = `${(state.kingdoms[kid].name || 'realm').replace(/[^a-z0-9]+/gi, '-')}-Y${yearOf(state.turn)}.png`;
  const download = () => { const a = document.createElement('a'); a.href = img.src; a.download = fname; a.click(); };
  const share = () => c.toBlob(async (blob) => {
    try {
      const file = new File([blob], fname, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: state.kingdoms[kid].name });
      else download();
    } catch { /* cancelled */ }
  }, 'image/png');
  modal('Your realm', h('div', { class: 'col' }, img), [['Close'], ['Save image', () => { download(); return false; }], ['Share', () => { share(); return false; }, 'primary']], { width: '760px', dismiss: true });
}
