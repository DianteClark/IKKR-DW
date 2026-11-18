// Peer-to-peer link (PeerJS). The host is authoritative: it runs AI, turn resolution and battle simulation.
// The client sends its actions and battle commands; the host sends back state and battle snapshots.
const PREFIX = 'ikkr-dw-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

// PeerJS errors in words a player can act on
function netError(e) {
  const type = e && e.type;
  const msg = {
    'peer-unavailable': 'No room with that code is open. Check the code, and ask the host to keep the game on screen.',
    'unavailable-id': 'That room code is already in use. Try again.',
    network: 'Could not reach the matchmaking server. Check your connection and try again.',
    'server-error': 'The matchmaking server is not answering. Try again in a minute.',
    'socket-error': 'Could not reach the matchmaking server. Check your connection and try again.',
    'socket-closed': 'The connection to the matchmaking server closed. Try again.',
    'browser-incompatible': 'This browser cannot play online. Try an up-to-date Chrome or Safari.',
    disconnected: 'Lost the matchmaking server. Try again.',
  }[type];
  return new Error(msg || (e && e.message) || String(e || 'Connection problem'));
}

export const net = {
  role: 'single', // 'single' | 'host' | 'client'
  peer: null, conn: null, code: null,
  handlers: {}, onState: null, onClose: null,
  hostReady: false, peerReady: false, waitingFor: null,
  pending: new Map(), reqId: 1,
  stateGetter: null,
  token: null, // client: random per-session id, so the host can tell "player 2 is back" from a stranger
  peerToken: null, // host: player 2's token
  epoch: 0, // bumped by close(): a host/join still in flight from before then is stale

  on(t, fn) { this.handlers[t] = fn; },
  off(t) { delete this.handlers[t]; },

  send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) { console.warn('send failed', e); } } },

  broadcastState() {
    if (this.role !== 'host' || !this.stateGetter) return;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.send({ t: 'state', s: this.stateGetter() }), 60);
  },

  // host: greet(fn) runs fn when player 2 says hello, or after 2 s if an older client never does
  greet(fn) {
    let said = false;
    this.on('hello', () => { said = true; fn(); });
    return () => { said = false; setTimeout(() => { if (!said) fn(); }, 2000); };
  },

  // request/response to the other peer
  ask(msg) {
    if (!this.conn || !this.conn.open) return Promise.resolve('auto'); // nobody to ask: the generals decide
    const id = this.reqId++;
    this.send({ ...msg, rid: id });
    return new Promise((res) => this.pending.set(id, res));
  },
  reply(rid, value) { this.send({ t: 'reply', rid, v: value }); },

  _wire(conn) {
    this.conn = conn;
    conn.on('data', (m) => {
      if (this.conn !== conn || !m || !m.t) return; // a replaced (stale) link says nothing
      if (m.t === 'busy') { // the host already has a second player
        this.conn = null; try { conn.close(); } catch {}
        if (this.handlers.busy) this.handlers.busy(); else this._dropped();
        return;
      }
      if (m.t === 'reply') { const r = this.pending.get(m.rid); if (r) { this.pending.delete(m.rid); r(m.v); } return; }
      if (m.t === 'state' && this.onState) this.onState(m.s);
      const h = this.handlers[m.t];
      if (h) { try { h(m); } catch (e) { console.error('net handler', m.t, e); } }
    });
    conn.on('close', () => { if (this.conn !== conn) return; this.conn = null; this._dropped(); });
    conn.on('iceStateChanged', (st) => { if ((st === 'disconnected' || st === 'failed') && this.conn === conn) { this.conn = null; try { conn.close(); } catch {} this._dropped(); } });
    conn.on('error', (e) => console.warn('conn error', e));
  },

  host() {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load. Check your connection.'));
      this.role = 'host';
      let tries = 0, opened = false;
      const attempt = () => {
        const code = roomCode();
        const peer = new window.Peer(PREFIX + code, { debug: 1 });
        this.peer = peer; this.code = code;
        const t = setTimeout(() => { if (!opened && this.peer === peer) { try { peer.destroy(); } catch {} reject(netError({ type: 'network' })); } }, 15000);
        peer.on('open', () => { opened = true; clearTimeout(t); resolve(code); });
        peer.on('error', (e) => {
          if (opened) { console.warn('peer error', e); return; }
          if (this.peer !== peer) return;
          clearTimeout(t);
          try { peer.destroy(); } catch {}
          if (e && e.type === 'unavailable-id' && ++tries < 4) attempt(); // someone holds that code: draw another
          else reject(netError(e));
        });
        peer.on('disconnected', () => { try { if (opened && !peer.destroyed && this.peer === peer) peer.reconnect(); } catch {} }); // lost the broker, not the player
        peer.on('connection', (conn) => {
          conn.on('open', () => {
            if (this.peer !== peer) { try { conn.close(); } catch {} return; }
            const tok = conn.metadata && conn.metadata.tok;
            if (this.conn && this.conn.open) {
              // the same player coming back before we noticed they left: their new link replaces the stale one
              if (tok && tok === this.peerToken) { const old = this.conn; this.conn = null; try { old.close(); } catch {} }
              else { // a stranger: say so (once they can hear it), then hang up
                const busy = () => { try { conn.send({ t: 'busy' }); } catch {} };
                conn.on('data', (m) => { if (m && m.t === 'hello') busy(); });
                setTimeout(busy, 1500); setTimeout(() => { try { conn.close(); } catch {} }, 3000);
                return;
              }
            }
            this._wire(conn);
            this.peerToken = tok || null;
            const again = this.everJoined; this.everJoined = true;
            const h = this.handlers[again ? 'peerRejoined' : 'peerJoined'] || this.handlers.peerJoined; if (h) h();
          });
        });
      };
      attempt();
    });
  },

  _connect(conn, resolve, reject, ms) {
    let done = false;
    const end = (err) => { if (done) return; done = true; clearTimeout(t); if (err) { try { conn.close(); } catch {} reject(err); } else resolve(); };
    const t = setTimeout(() => end(netError({ type: 'peer-unavailable' })), ms);
    // once linked, say hello: the host answers it (settings, resume or resync), so nothing the host sends is lost
    // to a link that opened on its side a moment before ours
    conn.on('open', () => { if (done) { try { conn.close(); } catch {} return; } this._wire(conn); end(); this.send({ t: 'hello' }); });
    conn.on('error', (e) => end(netError(e)));
  },

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load. Check your connection.'));
      const peer = new window.Peer({ debug: 1 });
      this.peer = peer; this.role = 'client'; this.code = code.toUpperCase();
      this.token = Math.random().toString(36).slice(2, 12);
      let opened = false;
      const t = setTimeout(() => { if (!opened) reject(netError({ type: 'network' })); }, 15000);
      peer.on('error', (e) => reject(netError(e))); // a settled promise ignores later errors
      peer.on('open', () => {
        opened = true; clearTimeout(t);
        this._connect(peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary', metadata: { tok: this.token } }), resolve, reject, 12000);
      });
    });
  },

  // the other side vanished: tell the game once; it decides whether to wait for a reconnect
  _dropped() {
    for (const [, r] of this.pending) r('auto'); // questions in flight are settled by the AI
    this.pending.clear();
    if (this.onClose) this.onClose();
  },
  // client: find the host again with the same room code (keeps every handler); one attempt at a time
  rejoin() {
    if (this._rejoining) return this._rejoining;
    const p = new Promise((resolve, reject) => {
      if (this.role !== 'client' || !this.code) return reject(new Error('Not a client'));
      const go = () => this._connect(this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary', metadata: { tok: this.token } }), resolve, reject, 8000);
      if (this.peer && !this.peer.destroyed && !this.peer.disconnected) go();
      else {
        try { this.peer && this.peer.destroy(); } catch {}
        const peer = this.peer = new window.Peer({ debug: 1 });
        const t = setTimeout(() => reject(new Error('broker')), 10000);
        peer.on('open', () => { clearTimeout(t); go(); });
        peer.on('error', () => { clearTimeout(t); reject(new Error('broker')); });
      }
    });
    this._rejoining = p;
    const clear = () => { if (this._rejoining === p) this._rejoining = null; };
    p.then(clear, clear);
    return p;
  },

  close() {
    const conn = this.conn; this.conn = null; // no close event for a link we end ourselves
    try { conn && conn.close(); } catch {}
    try { this.peer && this.peer.destroy(); } catch {}
    clearTimeout(this._bt);
    this.peer = null; this.role = 'single'; this.handlers = {}; this.onState = null; this.onClose = null; this.everJoined = false;
    this.hostReady = this.peerReady = false; this.waitingFor = null; this.pending.clear(); this.stateGetter = null;
    this.token = this.peerToken = null; this._rejoining = null; this.epoch++;
  },
  // run host()/join() and ignore the outcome if the player left (close()) while it was in flight
  async attempt(start) {
    const ep = this.epoch;
    try { const v = await start(); return ep === this.epoch ? { ok: true, v } : { stale: true }; }
    catch (e) { return ep === this.epoch ? { ok: false, e } : { stale: true }; }
  },
};
