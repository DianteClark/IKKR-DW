// Campaign saves. Every campaign has a short campaign code (state.cid); the map itself is rebuilt from the seed,
// so a save is just the game state. Saves live in IndexedDB (room for very long, enormous campaigns), with a
// localStorage fallback. Two-player campaigns are saved on BOTH devices: each device also keeps its own private
// seat key, and the host checks it (against a hash stored in the state) when the other player reconnects.
const DB = 'ikkr-dw', STORE = 'campaigns', LEGACY = 'ikkr-dw-save-v1', LS_PREFIX = 'ikkr-dw-camp:';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode(n = 6) { let s = ''; for (let i = 0; i < n; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }
export function newKey() { return newCode(16); }
// small stable hash (FNV-1a, two lanes) — enough to tell keys apart without shipping them
export function hashKey(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ (c + 31), 2246822519); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
export function prettyCode(cid) { return cid ? cid.slice(0, 3) + '-' + cid.slice(3) : '—'; }

// give a fresh state its identity
export function stampCampaign(state, mode = 'single') {
  if (!state.cid) state.cid = newCode(6);
  state.mode = mode;
  if (!state.seats) state.seats = state.players.map(() => ({ hash: null }));
  state.created = state.created || Date.now();
  return state;
}

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    // some browsers (private modes, old iOS) never answer: fall back to localStorage instead of hanging
    const t = setTimeout(() => res(null), 4000);
    const done = (v) => { clearTimeout(t); res(v); };
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => done(r.result);
      r.onerror = () => done(null);
      r.onblocked = () => done(null);
    } catch { done(null); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    try {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => res(r && 'result' in r ? r.result : true);
      t.onerror = () => res(null);
      t.onabort = () => res(null); // e.g. storage full
    } catch { res(null); }
  });
}

function meta(rec) {
  const st = rec.state, p = (st.players || [])[rec.seat] || (st.players || [])[0];
  const k = p ? st.kingdoms[p.kingdom] : null;
  return { id: rec.id, cid: st.cid, seat: rec.seat, mode: st.mode || 'single', updated: rec.updated || 0, turn: st.turn, size: st.size, realm: k ? k.name : '?', fid: k ? k.fid : 'castle', color: k ? k.color : '#888', alive: k ? k.alive : false, lands: k ? (st.territories || []).filter((t) => t.owner === k.id).length : 0, over: !!st.over, seed: st.seed };
}

// one record per campaign per person (the private seat key tells two players apart, even on one device)
const recId = (state, key) => state.cid + ':' + (key ? hashKey(key).slice(0, 8) : 'solo');

let pending = null, timer = 0;
export function saveCampaign(state, seat = 0, key = null) {
  if (!state || !state.cid) return;
  pending = { state, seat, key };
  clearTimeout(timer);
  timer = setTimeout(flush, 250); // coalesce bursts of saves
}
export async function flush() {
  if (!pending) return;
  const { state, seat, key } = pending; pending = null;
  const id = recId(state, key);
  const old = await getRecord(id);
  const rec = { id, seat, key: key || (old && old.key) || null, updated: Date.now(), state: JSON.parse(JSON.stringify(state)) };
  const ok = await tx('readwrite', (s) => s.put(rec));
  if (!ok) { try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(rec)); } catch {} }
}
export async function getRecord(id) {
  const r = await tx('readonly', (s) => s.get(id));
  if (r && r !== true) return r;
  try { const s = localStorage.getItem(LS_PREFIX + id); return s ? JSON.parse(s) : null; } catch { return null; }
}
// a record the game can open: current save version, with players and kingdoms
const usable = (r) => !!(r && r.id && r.state && r.state.v === 2 && Array.isArray(r.state.players) && Array.isArray(r.state.kingdoms) && Array.isArray(r.state.territories));
// every campaign that can be opened, newest first; listCampaigns.skipped counts saves too old or too damaged to open
export async function listCampaigns() {
  await migrateLegacy();
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  const recs = Array.isArray(all) ? all : [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      let r = null; try { r = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!r || !r.id) { recs.push(null); continue; }
      if (!recs.some((x) => x && x.id === r.id)) recs.push(r);
    }
  } catch {}
  const out = [];
  let skipped = 0;
  for (const r of recs) { try { if (!usable(r)) throw 0; out.push(meta(r)); } catch { skipped++; } }
  listCampaigns.skipped = skipped;
  return out.sort((a, b) => b.updated - a.updated);
}
export async function deleteCampaign(id) {
  await tx('readwrite', (s) => s.delete(id));
  try { localStorage.removeItem(LS_PREFIX + id); } catch {}
}
export async function findByCid(cid) {
  const list = await listCampaigns();
  return list.filter((m) => m.cid === cid);
}

// old single-slot saves become a normal campaign entry
async function migrateLegacy() {
  let raw = null; try { raw = localStorage.getItem(LEGACY); } catch {}
  if (!raw) return;
  try {
    const st = JSON.parse(raw);
    if (st && st.v === 2) { stampCampaign(st, st.players.length > 1 ? 'p2p' : 'single'); pending = { state: st, seat: 0, key: null }; await flush(); }
    localStorage.removeItem(LEGACY);
  } catch {}
}

// ---------- export / import (backup a campaign as a file or text) ----------
async function gz(str) {
  if (!window.CompressionStream) return 'J' + btoa(unescape(encodeURIComponent(str)));
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'G' + btoa(bin);
}
async function ungz(s) {
  if (s[0] === 'J') return decodeURIComponent(escape(atob(s.slice(1))));
  if (s[0] !== 'G' || !window.DecompressionStream) throw new Error('unreadable');
  const bin = atob(s.slice(1)); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).text();
}
export async function exportCampaign(id) {
  const rec = await getRecord(id);
  if (!rec) return null;
  return 'IKKRDW1:' + (await gz(JSON.stringify(rec)));
}
export async function importCampaign(text) {
  const t = (text || '').replace(/\s+/g, ''); // pasted codes often pick up line breaks
  if (!t.startsWith('IKKRDW1:')) throw new Error('That is not a campaign backup (it should start with IKKRDW1:).');
  let rec;
  try { rec = JSON.parse(await ungz(t.slice(8))); } catch { throw new Error('That backup is damaged or incomplete. Copy the whole code and try again.'); }
  if (!rec || !rec.state || rec.state.v !== 2) throw new Error('That backup is from an incompatible version.');
  if (!rec.state.cid) throw new Error('That backup is damaged (no campaign code).');
  if (!rec.id) rec.id = recId(rec.state, rec.key);
  if (!usable(rec)) throw new Error('That backup is damaged or incomplete.');
  rec.updated = Date.now();
  const ok = await tx('readwrite', (s) => s.put(rec));
  if (!ok) { try { localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(rec)); } catch { throw new Error('Not enough storage on this device to import it.'); } }
  return meta(rec);
}

// the hosting player always plays seat 0 on the host's side of the code, so swap seats when needed
export function swapSeats(state) {
  if (state.players.length < 2) return state;
  [state.players[0], state.players[1]] = [state.players[1], state.players[0]];
  if (state.seats) [state.seats[0], state.seats[1]] = [state.seats[1], state.seats[0]];
  for (const k of state.kingdoms) if (k.player === 0) k.player = 1; else if (k.player === 1) k.player = 0;
  return state;
}
export function seatOfKey(state, key) {
  if (!state.seats || !key) return -1;
  const hk = hashKey(key);
  return state.seats.findIndex((s) => s && s.hash === hk);
}

// ---------- mid-battle saves (single player) ----------
// A battle in progress is kept as `battle` on the campaign's record: { at, setup, sim, b, ctx, ... } (see scenes/battle.js).
// Any ordinary campaign save rewrites the record without it, so a stale battle can never outlive the campaign moving on.
// On page hide we also mirror it to localStorage synchronously (IndexedDB writes may not finish while the page is dying).
const BATTLE_LS = 'ikkr-dw-battle:';
const recIdOf = (cid, key) => cid + ':' + (key ? hashKey(key).slice(0, 8) : 'solo');
export async function saveBattle(cid, key, data, state = null, { sync = false } = {}) {
  if (!cid || !data) return false;
  const id = recIdOf(cid, key);
  const battle = { ...data, at: Date.now() };
  if (sync) { try { localStorage.setItem(BATTLE_LS + id, JSON.stringify(battle)); } catch {} }
  const old = await getRecord(id);
  if (!old && !state) return false;
  const rec = old ? { ...old } : { id, seat: 0, key: key || null };
  if (state) rec.state = JSON.parse(JSON.stringify(state));
  rec.battle = battle; rec.updated = Date.now();
  const ok = await tx('readwrite', (s) => s.put(rec));
  if (!ok) { try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(rec)); } catch {} }
  return !!ok;
}
// the battle in progress for this campaign (newest of the IndexedDB copy and the page-hide mirror), or null
export async function loadBattle(cid, key = null) {
  if (!cid) return null;
  const id = recIdOf(cid, key);
  const rec = await getRecord(id);
  let ls = null; try { ls = JSON.parse(localStorage.getItem(BATTLE_LS + id) || 'null'); } catch {}
  const a = rec && rec.battle;
  // a mirror older than the record's last ordinary save is stale (the campaign moved on)
  if (ls && rec && !a && rec.updated > ls.at) ls = null;
  if (a && ls) return ls.at > a.at ? ls : a;
  return a || ls || null;
}
export async function clearBattle(cid, key = null) {
  if (!cid) return;
  const id = recIdOf(cid, key);
  try { localStorage.removeItem(BATTLE_LS + id); } catch {}
  const rec = await getRecord(id);
  if (rec && rec.battle) { delete rec.battle; await tx('readwrite', (s) => s.put(rec)); }
}
