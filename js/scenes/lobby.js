import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, modal, toast } from '../engine/ui.js';
import { net } from '../net/net.js';
import { createWorld, confirmPicks } from '../game/world.js';
import { factionPicker, heroPicker, newGameOptions } from './setup.js';
import { campaignSession } from './campaign.js';

let L = {};

function screen(...children) {
  clearUI();
  mount(h('div', { class: 'screen center' }, h('div', { class: 'panel col', style: { minWidth: '300px', maxWidth: '520px' } }, ...children)));
}

function fail(e) {
  net.close();
  screen(h('h2', {}, 'Connection problem'), h('div', { class: 'bad' }, String(e && e.message || e)), btn('Back', () => go('lobby'), 'primary'));
}

registerScene('lobby', {
  enter() {
    net.close();
    L = { hostFid: null, peerFid: null, state: null, hostPicked: null, peerPicked: null };
    screen(
      h('h2', {}, 'Two-player campaign'),
      h('div', { class: 'muted' }, 'Each player starts in their own random territory with 2–3 heroes. Turns are played together; battles between you are fought live.'),
      btn('Host a game', hostFlow, 'primary'),
      h('div', { class: 'row' }, h('input', { class: 'text grow', id: 'code', maxlength: '5', placeholder: 'CODE', autocomplete: 'off', autocapitalize: 'characters' }), btn('Join', () => joinFlow(document.getElementById('code').value.trim()), 'good')),
      btn('Back', () => go('title'), 'small'));
  },
});

// ---------- host ----------
async function hostFlow() {
  screen(h('h2', {}, 'Creating room…'));
  let code;
  try { code = await net.host(); } catch (e) { return fail(e); }
  net.onClose = () => lost();
  screen(h('h2', {}, 'Room code'), h('div', { class: 'title', style: { letterSpacing: '8px' } }, code),
    h('div', { class: 'muted' }, 'Tell the other player to tap Multiplayer → enter this code → Join.'),
    h('div', {}, 'Waiting for player 2…'), btn('Cancel', () => { net.close(); go('lobby'); }, 'small'));
  net.on('peerJoined', () => {
    toast('Player 2 joined!', 'good');
    net.on('fid', (m) => { L.peerFid = m.fid; maybeCreate(); });
    net.on('picks', (m) => { L.peerPicked = m.ids; maybeBegin(); });
    clearUI();
    const pickFid = () => { clearUI(); mount(factionPicker('Choose your people (you are player 1)', (fid) => { L.hostFid = fid; screen(h('h2', {}, 'Waiting for player 2 to choose…')); maybeCreate(); })); };
    const opts = newGameOptions((o) => { L.opts = o; pickFid(); }, null, { title: 'Map & difficulty', size: 'small' });
    if (opts instanceof Node) mount(opts); else pickFid();
  });
}

function maybeCreate() {
  if (!L.hostFid || !L.peerFid || L.state) return;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  L.state = createWorld(seed, [{ fid: L.hostFid }, { fid: L.peerFid }], L.opts || { size: 'small' });
  net.send({ t: 'world', s: L.state });
  clearUI();
  mount(heroPicker(L.state, 0, (ids) => { L.hostPicked = ids; screen(h('h2', {}, 'Waiting for player 2 to choose heroes…')); maybeBegin(); }));
}

function maybeBegin() {
  if (!L.hostPicked || !L.peerPicked) return;
  confirmPicks(L.state, 0, L.hostPicked);
  confirmPicks(L.state, 1, L.peerPicked);
  net.stateGetter = () => campaignSession.state;
  net.send({ t: 'begin', s: L.state });
  go('campaign', { state: L.state, localPlayer: 0 });
}

// ---------- client ----------
async function joinFlow(code) {
  if (!code || code.length < 4) return toast('Enter the 5-letter room code');
  screen(h('h2', {}, 'Joining ' + code.toUpperCase() + '…'));
  try { await net.join(code); } catch (e) { return fail(e); }
  net.onClose = () => lost();
  net.on('world', (m) => {
    clearUI();
    mount(heroPicker(m.s, 1, (ids) => { net.send({ t: 'picks', ids }); screen(h('h2', {}, 'Waiting for player 1…')); }));
  });
  net.on('begin', (m) => go('campaign', { state: m.s, localPlayer: 1 }));
  clearUI();
  mount(factionPicker('Choose your people (you are player 2)', (fid) => { net.send({ t: 'fid', fid }); screen(h('h2', {}, 'Waiting for player 1…')); }));
}

export function lost() {
  if (net.role === 'single') return;
  net.close();
  modal('Connection lost', h('div', {}, 'The other player disconnected.'), [['Title screen', () => go('title'), 'primary']]);
}
