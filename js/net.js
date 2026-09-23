// Transporte P2P (WebRTC) con PeerJS. El anfitrión es el centro de la red (estrella).
// Canal "ctl": mensajes confiables. Canal "st": estados a 20 Hz, no confiables.

const PREFIX = 'f19gp-v2-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(c) {
  return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/peerjs/peerjs.min.js';
      s.onload = () => resolve(window.Peer);
      s.onerror = () => { loading = null; reject(new Error('No se pudo cargar el módulo de red.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// ?peer=host:puerto/ruta permite usar un servidor PeerJS propio
function peerOptions() {
  const opts = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };
  const q = new URLSearchParams(location.search).get('peer');
  if (q) {
    const [hp, ...rest] = q.split('/');
    const [host, port] = hp.split(':');
    const local = /^(localhost|127\.|10\.|192\.168\.)/.test(host);
    Object.assign(opts, { host, port: +port || (local ? 9000 : 443), path: '/' + rest.join('/'), secure: !local });
  }
  return opts;
}

export function describeError(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return 'No existe una sala con ese código.';
  if (t === 'unavailable-id') return 'Ese código de sala ya está en uso.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
    return 'No se pudo conectar al servidor de salas. Revisá tu conexión; si estás en una vista previa, abrí el juego desde su página publicada (por ejemplo GitHub Pages).';
  }
  if (t === 'browser-incompatible') return 'Este navegador o esta vista no permite conexiones WebRTC. Abrí el juego desde su página publicada.';
  if (e && e.message === 'timeout') return 'La conexión tardó demasiado. Probá de nuevo.';
  return (e && e.message) || 'Error de conexión.';
}

export class Net {
  constructor() {
    this.handlers = {};
    this.peers = new Map(); // id -> { ctl, st }
    this.isHost = false;
    this.peer = null;
    this.hostCtl = null;
    this.hostSt = null;
  }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, ...a) { const h = this.handlers[type]; if (h) h(...a); }

  async host(code) {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, peerOptions());
      let opened = false;
      const to = setTimeout(() => { if (!opened) { peer.destroy(); reject(new Error('timeout')); } }, 15000);
      peer.on('open', () => {
        opened = true;
        clearTimeout(to);
        this.peer = peer;
        this.isHost = true;
        resolve(code);
      });
      peer.on('connection', (conn) => this._accept(conn));
      peer.on('error', (e) => {
        if (!opened) { clearTimeout(to); peer.destroy(); reject(e); } else this.emit('error', e);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch { /* ignorar */ } });
    });
  }

  _accept(conn) {
    const ch = (conn.metadata && conn.metadata.ch) || 'ctl';
    conn.on('open', () => {
      let entry = this.peers.get(conn.peer);
      if (!entry) { entry = {}; this.peers.set(conn.peer, entry); }
      entry[ch] = conn;
      if (ch === 'ctl') this.emit('join', conn.peer);
    });
    conn.on('data', (d) => this.emit(ch === 'st' ? 'state' : 'message', d, conn.peer));
    conn.on('close', () => {
      const entry = this.peers.get(conn.peer);
      if (entry && entry[ch] === conn) delete entry[ch];
      if (ch === 'ctl') { this.peers.delete(conn.peer); this.emit('leave', conn.peer); }
    });
    conn.on('error', () => { /* se maneja en close */ });
  }

  async join(code) {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions());
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(to); peer.destroy(); reject(e); };
      const to = setTimeout(() => fail(new Error('timeout')), 15000);
      peer.on('error', (e) => { if (!done) fail(e); else this.emit('error', e); });
      peer.on('open', () => {
        this.peer = peer;
        const ctl = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: { ch: 'ctl' } });
        const st = peer.connect(PREFIX + code, { reliable: false, serialization: 'json', metadata: { ch: 'st' } });
        ctl.on('data', (d) => this.emit('message', d, 'host'));
        st.on('data', (d) => this.emit('state', d, 'host'));
        ctl.on('close', () => { if (done) this.emit('hostlost'); });
        ctl.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          this.hostCtl = ctl;
          this.hostSt = st;
          resolve();
        });
      });
    });
  }

  // Invitado → anfitrión
  send(msg) { if (this.hostCtl && this.hostCtl.open) this.hostCtl.send(msg); }
  sendState(msg) {
    const c = this.hostSt && this.hostSt.open ? this.hostSt : this.hostCtl;
    if (c && c.open) c.send(msg);
  }

  // Anfitrión → invitados
  sendTo(id, msg) {
    const e = this.peers.get(id);
    if (e && e.ctl && e.ctl.open) e.ctl.send(msg);
  }
  broadcast(msg, except) {
    for (const [id, e] of this.peers) if (id !== except && e.ctl && e.ctl.open) e.ctl.send(msg);
  }
  broadcastState(msg) {
    for (const e of this.peers.values()) {
      const c = e.st && e.st.open ? e.st : e.ctl;
      if (c && c.open) c.send(msg);
    }
  }

  kick(id) {
    const e = this.peers.get(id);
    if (e) { try { e.ctl && e.ctl.close(); e.st && e.st.close(); } catch { /* ignorar */ } }
  }

  close() {
    try { if (this.peer) this.peer.destroy(); } catch { /* ignorar */ }
    this.peer = null;
    this.peers.clear();
    this.hostCtl = this.hostSt = null;
    this.isHost = false;
  }
}
