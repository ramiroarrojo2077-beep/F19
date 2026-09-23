// Sesión online: sala, lobby, sincronización de autos y flujo de carrera.
import { Net, randomCode, normalizeCode, describeError } from './net.js';
import { TEAMS, codeFor } from './teams.js';
import { wrapAngle, clamp } from './utils.js';

export const NET_VERSION = 2;
const SEND_DT = 0.05;
const INTERP = 0.11;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function packCar(c) {
  const flags = (c.drsOpen ? 1 : 0) | (c.finished ? 2 : 0) | (c.input.throttle > 0.4 ? 4 : 0) | (c.input.brake > 0.3 ? 8 : 0);
  return [c.id, r2(c.x), r2(c.z), r3(c.heading), r2(c.speed), r3(c.steerAngle), Math.round(c.rpm), c.gear, flags,
    c.lap, Math.round(c.raceDist * 10) / 10, c.finishTime != null ? r3(c.finishTime) : -1,
    c.bestLap != null ? r3(c.bestLap) : -1, c.lastLap != null ? r3(c.lastLap) : -1, c.surface];
}

function unpack(a, t) {
  return {
    t, x: a[1], z: a[2], h: a[3], v: a[4], st: a[5], rpm: a[6], gear: a[7], f: a[8],
    lap: a[9], rd: a[10], ft: a[11], bl: a[12], ll: a[13], surf: a[14],
  };
}

function sanitizeName(n) {
  return String(n || 'Piloto').replace(/[<>&"'`]/g, '').trim().slice(0, 14) || 'Piloto';
}

// Aplica al auto remoto el estado interpolado ~110 ms en el pasado
export function interpolateRemote(c, now) {
  const buf = c.netBuf;
  if (!buf || !buf.length) return;
  const rt = now - INTERP;
  let a = buf[0], b = null, t = 0;
  if (rt <= buf[0].t) a = buf[0];
  else {
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) {
        a = buf[i];
        b = buf[i + 1] || null;
        if (b) t = (rt - a.t) / Math.max(1e-3, b.t - a.t);
        break;
      }
    }
  }
  let x, z, h, v;
  if (b) {
    x = a.x + (b.x - a.x) * t;
    z = a.z + (b.z - a.z) * t;
    h = a.h + wrapAngle(b.h - a.h) * t;
    v = a.v + (b.v - a.v) * t;
  } else {
    // extrapolación corta
    const dt = clamp(rt - a.t, 0, 0.25);
    x = a.x + Math.sin(a.h) * a.v * dt;
    z = a.z + Math.cos(a.h) * a.v * dt;
    h = a.h; v = a.v;
  }
  const last = buf[buf.length - 1];
  c.x = x; c.z = z; c.heading = h; c.speed = v;
  c.vx = Math.sin(h) * v; c.vz = Math.cos(h) * v;
  c.steerAngle = (b || a).st;
  c.rpm = last.rpm; c.gear = last.gear;
  c.drsOpen = !!(last.f & 1);
  c.input.throttle = last.f & 4 ? 1 : 0;
  c.input.brake = last.f & 8 ? 1 : 0;
  c.lap = last.lap;
  c.raceDist = last.rd;
  c.surface = last.surf;
  if (last.f & 2 && !c.finished) { c.finished = true; c.finishTime = last.ft; }
  c.bestLap = last.bl >= 0 ? last.bl : null;
  c.lastLap = last.ll >= 0 ? last.ll : null;
  while (buf.length > 3 && buf[1].t < rt) buf.shift();
}

export class Online {
  constructor(game) {
    this.game = game;
    this.net = null;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.players = [];
    this.code = null;
    this.myId = null;
    this.settings = { track: 'valle', laps: 3, weather: 'sol', ai: true, difficulty: 'normal' };
    this.readySet = new Set();
    this.sendT = 0;
    this.grid = null;
  }

  get active() { return !!this.net; }
  get isHost() { return !!(this.net && this.net.isHost); }
  get racing() { return this.state === 'racing' || this.state === 'loading'; }
  me() { return this.players.find((p) => p.id === this.myId); }

  _net() {
    const net = new Net();
    net.on('message', (m, from) => this._onMessage(m, from));
    net.on('state', (m, from) => this._onState(m, from));
    net.on('join', () => {});
    net.on('leave', (id) => this._onLeave(id));
    net.on('hostlost', () => this._hostLost());
    net.on('error', () => {});
    return net;
  }

  async create() {
    const s = this.game.settings;
    this.leave(true);
    this.net = this._net();
    let code = null;
    for (let k = 0; k < 3; k++) {
      const c = randomCode();
      try { await this.net.host(c); code = c; break; } catch (e) {
        if (!e || e.type !== 'unavailable-id' || k === 2) { this.net.close(); this.net = null; throw new Error(describeError(e)); }
      }
    }
    this.code = code;
    this.myId = 'host';
    this.state = 'lobby';
    this.settings = { track: s.track, laps: s.laps, weather: s.weather, ai: true, difficulty: s.difficulty };
    this.players = [{ id: 'host', name: sanitizeName(s.name), code: codeFor(s.name), team: s.team, car: -1, host: true }];
    this.players[0].car = this._assign(s.team, 'host');
    this._lobbyChanged();
    return code;
  }

  async join(code) {
    code = normalizeCode(code);
    if (code.length < 4) throw new Error('El código tiene 4 caracteres.');
    this.leave(true);
    this.net = this._net();
    try {
      await this.net.join(code);
    } catch (e) {
      this.net.close(); this.net = null;
      throw new Error(describeError(e));
    }
    this.code = code;
    this.state = 'joining';
    const s = this.game.settings;
    this.net.send({ t: 'hello', name: sanitizeName(s.name), team: s.team, ver: NET_VERSION });
    return new Promise((resolve, reject) => {
      this._joinWait = { resolve, reject };
      setTimeout(() => { if (this._joinWait) { this._joinWait = null; this.leave(true); reject(new Error('La sala no respondió.')); } }, 10000);
    });
  }

  leave(silent = false) {
    if (this.net) {
      if (this.isHost) this.net.broadcast({ t: 'close' });
      else this.net.send({ t: 'bye' });
      const n = this.net;
      setTimeout(() => n.close(), 150);
    }
    this.net = null;
    this.reset();
    if (!silent) this.game.menu.onLobby(this);
  }

  // ---------- Lobby ----------
  _assign(team, pid) {
    const taken = new Set(this.players.filter((p) => p.id !== pid).map((p) => p.car));
    const prefs = [team * 2 + 1, team * 2];
    for (const c of prefs) if (!taken.has(c)) return c;
    for (let c = 0; c < 10; c++) if (!taken.has(c)) return c;
    return -1;
  }

  _lobbyChanged() {
    if (this.isHost) {
      this.net.broadcast({ t: 'lobby', players: this.players, settings: this.settings, state: this.state, code: this.code });
    }
    this.game.menu.onLobby(this);
  }

  setPref({ team, name }) {
    const s = this.game.settings;
    if (!this.active) return;
    if (this.isHost) {
      const p = this.me();
      if (team != null) { p.team = team; p.car = this._assign(team, p.id); }
      if (name != null) { p.name = sanitizeName(name); p.code = codeFor(name); }
      this._lobbyChanged();
    } else {
      this.net.send({ t: 'pref', team: team ?? s.team, name: name ?? s.name });
    }
  }

  setSettings(patch) {
    if (!this.isHost || this.state !== 'lobby') return;
    Object.assign(this.settings, patch);
    this._lobbyChanged();
  }

  // ---------- Carrera ----------
  async start() {
    if (!this.isHost || this.state !== 'lobby') return;
    const humans = [...this.players].sort(() => Math.random() - 0.5);
    const grid = humans.map((p) => ({ car: p.car, owner: p.id, name: p.name, code: p.code }));
    if (this.settings.ai) {
      const used = new Set(grid.map((g) => g.car));
      for (let c = 0; c < 10; c++) if (!used.has(c)) grid.push({ car: c, owner: null });
    }
    this.grid = grid;
    this.state = 'loading';
    this.readySet = new Set(['host']);
    this.net.broadcast({ t: 'load', settings: this.settings, grid });
    this._lobbyChanged();
    await this.game.startOnlineRace(this.settings, grid, 'host', true);
    this._waitStart = setTimeout(() => this._go(), 25000);
    this._checkReady();
  }

  _checkReady() {
    if (!this.isHost || this.state !== 'loading') return;
    const need = this.players.map((p) => p.id);
    if (need.every((id) => this.readySet.has(id))) this._go();
  }

  _go() {
    if (this.state !== 'loading') return;
    clearTimeout(this._waitStart);
    this.state = 'racing';
    const delay = 5.5 + Math.random() * 1.6;
    this.net.broadcast({ t: 'go', delay });
    this._lobbyChanged();
    this.game.beginCountdown(delay);
  }

  backToLobby() {
    if (!this.isHost) return;
    this.state = 'lobby';
    this.readySet.clear();
    this.net.broadcast({ t: 'lobbyReturn' });
    this._lobbyChanged();
    this.game.returnToLobby();
  }

  // Por frame: interpolar remotos y enviar estados
  update(dt, now) {
    if (!this.active || this.state !== 'racing' && this.state !== 'loading') return;
    const g = this.game;
    if (!g.sim) return;
    for (const c of g.sim.cars) if (c.remote) interpolateRemote(c, now);
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = SEND_DT;
    if (this.isHost) {
      const cars = [];
      for (const c of g.sim.cars) {
        if (c.remote) { if (c.netRaw) cars.push(c.netRaw); } else cars.push(packCar(c));
      }
      this.net.broadcastState({ t: 'snap', ts: now, c: cars });
    } else if (g.player) {
      this.net.sendState({ t: 'st', ts: now, s: packCar(g.player) });
    }
  }

  _push(car, arr, now, ts) {
    if (!car || !car.remote) return;
    if (car.netTs != null && ts != null && ts < car.netTs) return;
    car.netTs = ts;
    car.netRaw = arr;
    (car.netBuf || (car.netBuf = [])).push(unpack(arr, now));
    if (car.netBuf.length > 40) car.netBuf.shift();
  }

  _onState(m, from) {
    const g = this.game;
    if (!g.sim || !m) return;
    const now = performance.now() / 1000;
    if (this.isHost && m.t === 'st') {
      const p = this.players.find((q) => q.id === from);
      if (!p || !Array.isArray(m.s) || m.s[0] !== p.car) return;
      this._push(g.carById(p.car), m.s, now, m.ts);
    } else if (!this.isHost && m.t === 'snap' && Array.isArray(m.c)) {
      const mine = this.me() ? this.me().car : -1;
      for (const a of m.c) {
        if (!Array.isArray(a) || a[0] === mine) continue;
        this._push(g.carById(a[0]), a, now, m.ts);
      }
    }
  }

  _onMessage(m, from) {
    if (!m || typeof m.t !== 'string') return;
    if (this.isHost) this._hostMessage(m, from);
    else this._guestMessage(m);
  }

  _hostMessage(m, from) {
    const p = this.players.find((q) => q.id === from);
    switch (m.t) {
      case 'hello': {
        if (m.ver !== NET_VERSION) { this.net.sendTo(from, { t: 'reject', reason: 'Versión del juego distinta. Recargá la página.' }); return; }
        if (this.state !== 'lobby') { this.net.sendTo(from, { t: 'reject', reason: 'La carrera ya empezó. Esperá a que termine.' }); return; }
        if (this.players.length >= 10) { this.net.sendTo(from, { t: 'reject', reason: 'La sala está llena.' }); return; }
        if (p) return;
        const team = clamp(Math.floor(+m.team || 0), 0, TEAMS.length - 1);
        const np = { id: from, name: sanitizeName(m.name), code: codeFor(m.name), team, car: -1 };
        this.players.push(np);
        np.car = this._assign(team, from);
        this.net.sendTo(from, { t: 'welcome', id: from, code: this.code });
        this._lobbyChanged();
        this.game.hud.message(`${np.name} entró a la sala`, '', 2, 'small');
        break;
      }
      case 'pref':
        if (!p || this.state !== 'lobby') return;
        if (m.team != null) { p.team = clamp(Math.floor(+m.team || 0), 0, TEAMS.length - 1); p.car = this._assign(p.team, p.id); }
        if (m.name != null) { p.name = sanitizeName(m.name); p.code = codeFor(m.name); }
        this._lobbyChanged();
        break;
      case 'ready':
        if (!p) return;
        this.readySet.add(from);
        this._checkReady();
        break;
      case 'bye':
        this._onLeave(from);
        this.net.kick(from);
        break;
    }
  }

  _guestMessage(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.state = 'lobby';
        if (this._joinWait) { this._joinWait.resolve(); this._joinWait = null; }
        break;
      case 'reject':
        if (this._joinWait) { this._joinWait.reject(new Error(m.reason)); this._joinWait = null; }
        this.leave(true);
        g.menu.onLobby(this, m.reason);
        break;
      case 'lobby':
        this.players = Array.isArray(m.players) ? m.players : [];
        this.settings = m.settings || this.settings;
        if (this.state !== 'racing' && this.state !== 'loading') this.state = m.state === 'lobby' ? 'lobby' : this.state;
        g.menu.onLobby(this);
        break;
      case 'load':
        this.state = 'loading';
        this.settings = m.settings;
        this.grid = m.grid;
        g.startOnlineRace(m.settings, m.grid, this.myId, false).then(() => this.net && this.net.send({ t: 'ready' }));
        break;
      case 'go':
        this.state = 'racing';
        g.beginCountdown(+m.delay || 6);
        break;
      case 'lobbyReturn':
        this.state = 'lobby';
        g.returnToLobby();
        break;
      case 'close':
        this._hostLost('El anfitrión cerró la sala.');
        break;
    }
  }

  _onLeave(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = this.players[i];
    this.players.splice(i, 1);
    this.readySet.delete(id);
    this.game.hud.message(`${p.name} salió de la sala`, '', 2, 'small');
    // si estaba corriendo, la IA toma el auto
    if (this.state === 'racing' || this.state === 'loading') this.game.convertToAI(p.car);
    this._lobbyChanged();
    this._checkReady();
  }

  _hostLost(reason = 'Se perdió la conexión con el anfitrión.') {
    if (!this.net) return;
    this.net.close();
    this.net = null;
    this.reset();
    this.game.onlineLost(reason);
  }
}
