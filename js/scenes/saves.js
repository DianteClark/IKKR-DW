// Continue: every saved campaign (solo and two-player), with campaign codes, backups and resuming online.
import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, modal, toast, confirm, chip } from '../engine/ui.js';
import { listCampaigns, deleteCampaign, exportCampaign, importCampaign, prettyCode } from '../game/save.js';
import { yearOf, shortDate } from '../game/family.js';
import { FACTIONS } from '../data/art.js';
import { sfx, music } from '../engine/audio.js';
import { hostResume } from './lobby.js';

const SIZE_NAMES = { small: 'Small', medium: 'Medium', large: 'Large', huge: 'Huge', enormous: 'Enormous' };
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

async function render() {
  clearUI();
  const list = await listCampaigns();
  const cards = list.map((m) => {
    const two = m.mode === 'p2p';
    return h('div', { class: 'card col', style: { alignItems: 'stretch', gap: '6px' } },
      h('div', { class: 'row', style: { gap: '8px' } },
        h('span', { style: { width: '12px', height: '12px', background: m.color, borderRadius: '2px', flex: 'none' } }),
        h('b', { class: 'grow ellipsis' }, m.realm),
        chip(two ? 'Two-player' : 'Solo', two ? 'blue' : '')),
      h('div', { class: 'row wrap', style: { gap: '4px' } },
        chip(shortDate(m.turn)),
        chip(SIZE_NAMES[m.size] || m.size),
        chip(`${m.lands} lands`),
        chip(`Code ${prettyCode(m.cid)}`, 'gold'),
        m.over ? chip('Finished', 'bad') : !m.alive ? chip('Wandering', 'bad') : null),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, `${FACTIONS[m.fid] ? FACTIONS[m.fid].name : ''} · saved ${ago(m.updated)}`),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        two
          ? btn('Host & resume', () => { sfx('horn'); hostResume(m.id); }, 'small primary')
          : btn('Continue', () => { sfx('horn'); go('campaign', { load: m.id }); }, 'small primary'),
        btn('Backup', async () => {
          const code = await exportCampaign(m.id);
          if (!code) return toast('Could not export');
          try { await navigator.clipboard.writeText(code); toast('Backup copied — paste it somewhere safe', 'good'); } catch {}
          try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
            a.download = `ikkr-dw-${m.cid}-Y${yearOf(m.turn)}.txt`; a.click();
          } catch {}
        }, 'small'),
        btn('Delete', () => confirm('Delete campaign?', `${m.realm} (${prettyCode(m.cid)}) will be gone from this device.`, 'Delete', 'Keep', 'danger').then(async (ok) => { if (ok) { await deleteCampaign(m.id); render(); } }), 'small danger')));
  });
  mount(h('div', { class: 'screen fade-in' },
    h('div', { class: 'panel col grow', style: { minHeight: 0 } },
      h('div', { class: 'row' }, btn('‹ Back', () => { sfx('close'); go('title'); }, 'small'), h('h2', { class: 'grow', style: { margin: 0 } }, 'Continue'), btn('Import backup', importFlow, 'small')),
      list.length ? null : h('div', { class: 'muted' }, 'No saved campaigns yet. Every campaign saves itself each month.'),
      h('div', { class: 'scroll grow', style: { minHeight: 0 } },
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } }, cards)),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Two-player campaigns are saved on both phones. Either player taps Host & resume; the other opens Multiplayer and joins with the room code. Each phone holds a private seat key, so nobody can take the other\'s realm.'))));
}

function importFlow() {
  const ta = h('textarea', { class: 'text', rows: 4, placeholder: 'Paste a backup (starts with IKKRDW1:)', style: { width: '100%', fontSize: '12px' } });
  const file = h('input', { type: 'file', accept: '.txt,text/plain', onChange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });
  modal('Import a campaign', h('div', { class: 'col' }, ta, file), [['Cancel'], ['Import', async () => {
    try { const m = await importCampaign(ta.value); toast(`Imported ${m.realm}`, 'good'); render(); } catch (e) { toast(e.message || 'Import failed', 'bad'); }
  }, 'primary']], { dismiss: true });
}

registerScene('saves', {
  enter() { music.start('title'); render(); },
});
