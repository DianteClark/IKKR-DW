// Peer-to-peer link (PeerJS). The host is authoritative: it runs AI, turn resolution and battle simulation.
// The client sends its actions and battle commands; the host sends back state and battle snapshots.
const PREFIX = 'ikkr-dw-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const net = {
  role: 'single', // 'single' | 'host' | 'client'
  peer: null, conn: null, code: null,
  handlers: {}, onState: null, onClose: null,
  hostReady: false, peerReady: false, waitingFor: null,
  pending: new Map(), reqId: 1,
  stateGetter: null,

  on(t, fn) { this.handlers[t] = fn; },
  off(t) { delete this.handlers[t]; },

  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); },

  broadcastState() {
    if (this.role !== 'host' || !this.stateGetter) return;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.send({ t: 'state', s: this.stateGetter() }), 60);
  },
  sendStateNow() { if (this.role === 'host' && this.stateGetter) this.send({ t: 'state', s: this.stateGetter() }); },

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
      if (!m || !m.t) return;
      if (m.t === 'reply') { const r = this.pending.get(m.rid); if (r) { this.pending.delete(m.rid); r(m.v); } return; }
      if (m.t === 'state' && this.onState) this.onState(m.s);
      const h = this.handlers[m.t];
      if (h) h(m);
    });
    conn.on('close', () => { if (this.conn !== conn) return; this.conn = null; this._dropped(); });
    conn.on('iceStateChanged', (st) => { if ((st === 'disconnected' || st === 'failed') && this.conn === conn) { try { conn.close(); } catch {} this.conn = null; this._dropped(); } });
    conn.on('error', (e) => console.warn('conn error', e));
  },

  host() {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load. Check your connection.'));
      const code = Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      const peer = new window.Peer(PREFIX + code, { debug: 1 });
      this.peer = peer; this.code = code; this.role = 'host';
      peer.on('open', () => resolve(code));
      peer.on('error', (e) => { if (!this.everJoined) reject(e); else console.warn('peer error', e); });
      peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }); // lost the broker, not the player
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.close(); return; }
        conn.on('open', () => {
          this._wire(conn);
          const again = this.everJoined; this.everJoined = true;
          const h = this.handlers[again ? 'peerRejoined' : 'peerJoined'] || this.handlers.peerJoined; if (h) h();
        });
      });
    });
  },

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load. Check your connection.'));
      const peer = new window.Peer({ debug: 1 });
      this.peer = peer; this.role = 'client'; this.code = code.toUpperCase();
      peer.on('error', (e) => reject(e));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary' });
        conn.on('open', () => { this._wire(conn); resolve(); });
        conn.on('error', reject);
        setTimeout(() => { if (!conn.open) reject(new Error('Could not reach that room.')); }, 12000);
      });
    });
  },

  // the other side vanished: tell the game once; it decides whether to wait for a reconnect
  _dropped() {
    for (const [, r] of this.pending) r('auto'); // questions in flight are settled by the AI
    this.pending.clear();
    if (this.onClose) this.onClose();
  },
  // client: find the host again with the same room code (keeps every handler)
  rejoin() {
    return new Promise((resolve, reject) => {
      if (this.role !== 'client' || !this.code) return reject(new Error('Not a client'));
      const go = () => {
        const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary' });
        const t = setTimeout(() => { if (!conn.open) { try { conn.close(); } catch {} reject(new Error('timeout')); } }, 8000);
        conn.on('open', () => { clearTimeout(t); this._wire(conn); resolve(); });
        conn.on('error', () => { clearTimeout(t); reject(new Error('unreachable')); });
      };
      if (this.peer && !this.peer.destroyed && this.peer.open !== false) go();
      else {
        try { this.peer && this.peer.destroy(); } catch {}
        this.peer = new window.Peer({ debug: 1 });
        this.peer.on('open', go);
        this.peer.on('error', () => reject(new Error('broker')));
      }
    });
  },

  close() {
    try { this.conn && this.conn.close(); } catch {}
    try { this.peer && this.peer.destroy(); } catch {}
    this.peer = null; this.conn = null; this.role = 'single'; this.handlers = {}; this.onState = null; this.onClose = null; this.everJoined = false;
    this.hostReady = this.peerReady = false; this.waitingFor = null; this.pending.clear();
  },
};
