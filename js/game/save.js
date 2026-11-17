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
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
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
    } catch { res(null); }
  });
}

function meta(rec) {
  const st = rec.state, p = st.players[rec.seat] || st.players[0];
  const k = p ? st.kingdoms[p.kingdom] : null;
  return { id: rec.id, cid: st.cid, seat: rec.seat, mode: st.mode || 'single', updated: rec.updated, turn: st.turn, size: st.size, realm: k ? k.name : '?', fid: k ? k.fid : 'castle', color: k ? k.color : '#888', alive: k ? k.alive : false, lands: k ? st.territories.filter((t) => t.owner === k.id).length : 0, over: !!st.over, seed: st.seed };
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
export async function listCampaigns() {
  await migrateLegacy();
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  const recs = Array.isArray(all) ? all : [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS_PREFIX)) { const r = JSON.parse(localStorage.getItem(k)); if (!recs.some((x) => x.id === r.id)) recs.push(r); } } } catch {}
  return recs.filter((r) => r && r.state && r.state.v === 2).map(meta).sort((a, b) => b.updated - a.updated);
}
export async function deleteCampaign(id) {
  await tx('readwrite', (s) => s.delete(id));
  try { localStorage.removeItem(LS_PREFIX + id); } catch {}
}
export async function findByCid(cid) {
  const list = await listCampaigns();
  return list.filter((m) => m.cid === cid);
}
export async function hasAnySave() { return (await listCampaigns()).length > 0; }

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
  const t = (text || '').trim();
  if (!t.startsWith('IKKRDW1:')) throw new Error('That is not a campaign backup.');
  const rec = JSON.parse(await ungz(t.slice(8)));
  if (!rec.state || rec.state.v !== 2) throw new Error('That backup is from an incompatible version.');
  rec.updated = Date.now();
  const ok = await tx('readwrite', (s) => s.put(rec));
  if (!ok) localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(rec));
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

// legacy API (kept so older call sites still work)
export function hasSave() { try { return !!localStorage.getItem(LEGACY); } catch { return false; } }
export function clearSave() {}
