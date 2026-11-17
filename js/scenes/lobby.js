import { registerScene, go } from '../main.js';
import { h, btn, mount, clearUI, modal, toast } from '../engine/ui.js';
import { net } from '../net/net.js';
import { createWorld, confirmPicks } from '../game/world.js';
import { factionPicker, heroPicker, newGameOptions } from './setup.js';
import { campaignSession } from './campaign.js';
import { stampCampaign, newKey, hashKey, getRecord, findByCid, swapSeats, seatOfKey, prettyCode } from '../game/save.js';

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
    L = { hostFid: null, peerFid: null, state: null, hostPicked: null, peerPicked: null, key: newKey() };
    screen(
      h('h2', {}, 'Two-player campaign'),
      h('div', { class: 'muted' }, 'Each player starts as a village in their own random land with 3 heroes. Turns are played together; battles between you are fought live. To pick up a saved two-player campaign, one of you opens it from Continue and hosts; the other joins with the room code.'),
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
    net.on('picks', (m) => { L.peerPicked = m.ids; L.peerHash = m.hash || null; maybeBegin(); });
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
  stampCampaign(L.state, 'p2p');
  L.state.seats[0].hash = hashKey(L.key);
  net.send({ t: 'world', s: L.state });
  clearUI();
  mount(heroPicker(L.state, 0, (ids) => { L.hostPicked = ids; screen(h('h2', {}, 'Waiting for player 2 to choose heroes…')); maybeBegin(); }));
}

function maybeBegin() {
  if (!L.hostPicked || !L.peerPicked) return;
  confirmPicks(L.state, 0, L.hostPicked);
  confirmPicks(L.state, 1, L.peerPicked);
  L.state.seats[1].hash = L.peerHash;
  net.stateGetter = () => campaignSession.state;
  net.send({ t: 'begin', s: L.state });
  go('campaign', { state: L.state, localPlayer: 0, key: L.key });
}

// ---------- client ----------
async function joinFlow(code) {
  if (!code || code.length < 4) return toast('Enter the 5-letter room code');
  screen(h('h2', {}, 'Joining ' + code.toUpperCase() + '…'));
  L.resuming = false;
  net.on('world', (m) => {
    clearUI();
    mount(heroPicker(m.s, 1, (ids) => { net.send({ t: 'picks', ids, hash: hashKey(L.key) }); screen(h('h2', {}, 'Waiting for player 1…')); }));
  });
  net.on('begin', (m) => go('campaign', { state: m.s, localPlayer: 1, key: L.key }));
  // the host is resuming a saved campaign: prove which seat is ours
  net.on('resume', async (m) => {
    L.resuming = true;
    screen(h('h2', {}, `Resuming campaign ${prettyCode(m.cid)}…`), h('div', { class: 'muted' }, 'Checking your copy of the campaign…'));
    const metas = await findByCid(m.cid);
    const recs = (await Promise.all(metas.map((x) => getRecord(x.id)))).filter((r) => r && r.key && hashKey(r.key) !== m.hostHash);
    if (!recs.length) {
      net.send({ t: 'resumeKey', key: null });
      return fail(new Error(`Campaign ${prettyCode(m.cid)} isn't saved on this device. Open it on the phone you played it on, or import a backup first.`));
    }
    const rec = recs.sort((a, b) => b.state.turn - a.state.turn)[0];
    L.key = rec.key;
    net.send({ t: 'resumeKey', key: rec.key, turn: rec.state.turn, state: rec.state.turn > m.turn ? rec.state : null });
    screen(h('h2', {}, 'Waiting for the host…'));
  });
  net.on('resumeDenied', (m) => fail(new Error(m.why || 'The host could not match your seat.')));
  try { await net.join(code); } catch (e) { return fail(e); }
  net.onClose = () => lost();
  if (L.resuming) return;
  clearUI();
  mount(factionPicker('Choose your people (you are player 2)', (fid) => { net.send({ t: 'fid', fid }); screen(h('h2', {}, 'Waiting for player 1…')); }));
}

export function lost() {
  if (net.role === 'single') return;
  net.close();
  modal('Connection lost', h('div', {}, 'The other player disconnected.'), [['Title screen', () => go('title'), 'primary']]);
}

// ---------- resume a saved two-player campaign (this device hosts) ----------
export async function hostResume(id) {
  const rec = await getRecord(id);
  if (!rec) return go('title');
  net.close();
  L = { key: rec.key };
  screen(h('h2', {}, 'Creating room…'));
  let code;
  try { code = await net.host(); } catch (e) { return fail(e); }
  net.onClose = () => lost();
  const st0 = rec.state;
  screen(h('h2', {}, `Resume campaign ${prettyCode(st0.cid)}`), h('div', { class: 'title', style: { letterSpacing: '8px' } }, code),
    h('div', { class: 'muted' }, 'Tell the other player: Multiplayer → enter this room code → Join. Their phone checks its own copy of the campaign and its private seat key.'),
    h('div', {}, 'Waiting for the other player…'), btn('Cancel', () => { net.close(); go('title'); }, 'small'));
  net.on('peerJoined', () => setTimeout(() => net.send({ t: 'resume', cid: st0.cid, turn: st0.turn, hostHash: rec.key ? hashKey(rec.key) : null }), 300));
  net.on('resumeKey', (m) => {
    if (!m.key) { net.close(); return fail(new Error('The other player does not have this campaign saved.')); }
    let st = st0;
    if (m.state && m.state.cid === st0.cid && m.state.turn > st0.turn) { st = m.state; toast('Their copy was newer — continuing from it', 'gold'); }
    const legacy = !st.seats || st.seats.every((x) => !x || !x.hash);
    let mine = legacy ? rec.seat || 0 : seatOfKey(st, rec.key);
    let theirs = legacy ? 1 - mine : seatOfKey(st, m.key);
    if (mine < 0 || theirs < 0 || mine === theirs) {
      net.send({ t: 'resumeDenied', why: 'That device does not hold the other seat of this campaign.' });
      return fail(new Error('The joining player does not hold the other seat of this campaign.'));
    }
    if (mine !== 0) swapSeats(st);
    net.stateGetter = () => campaignSession.state;
    net.send({ t: 'begin', s: st });
    go('campaign', { state: st, localPlayer: 0, key: rec.key });
  });
}
