// Menús: navegación entre pantallas, opciones, garaje y lobby online.
import { TRACKS, trackById } from './tracks.js';
import { TrackData } from './trackdata.js';
import { TEAMS, DRIVERS } from './teams.js';
import { formatTime } from './utils.js';

const $ = (id) => document.getElementById(id);
const ENV_ICON = { day: '☀️', sunset: '🌅', night: '🌙' };

const previews = new Map();
function preview(def) {
  if (!previews.has(def.id)) {
    const t = new TrackData(def);
    previews.set(def.id, { px: t.px, pz: t.pz, N: t.N, length: t.length, nx: t.nx, nz: t.nz });
  }
  return previews.get(def.id);
}

function drawPreview(canvas, def, color = '#fff') {
  const p = preview(def);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 160, h = canvas.clientHeight || 90;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.N; i++) {
    minX = Math.min(minX, p.px[i]); maxX = Math.max(maxX, p.px[i]);
    minZ = Math.min(minZ, p.pz[i]); maxZ = Math.max(maxZ, p.pz[i]);
  }
  const pad = 10;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2, oz = (h - (maxZ - minZ) * sc) / 2;
  const P = (i) => [ox + (p.px[i] - minX) * sc, oz + (p.pz[i] - minZ) * sc];
  g.lineJoin = g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    for (let i = 0; i <= p.N; i += 3) { const [x, y] = P(i % p.N); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath();
  };
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6; path(); g.stroke();
  g.strokeStyle = color; g.lineWidth = 2.6; path(); g.stroke();
  const [sx, sy] = P(0);
  g.fillStyle = '#e10600';
  g.beginPath(); g.arc(sx, sy, 3.5, 0, Math.PI * 2); g.fill();
}

export function bestKey(trackId) { return 'f19-best-' + trackId; }
export function loadBest(trackId) {
  try { return JSON.parse(localStorage.getItem(bestKey(trackId)) || 'null'); } catch { return null; }
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.el = $('menu');
    this.screen = 'home';
    this._bind();
    this._trackCards($('track-cards'), (id) => this._set('track', id), () => this.game.settings.track);
    this._trackCards($('lobby-tracks'), (id) => this.game.online.setSettings({ track: id }), () => this.game.online.settings.track, true);
    this._teams();
    this.refresh();
  }

  toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  show(screen) {
    this.screen = screen;
    this.el.dataset.active = screen;
    this.el.classList.remove('hidden');
    this.game.onMenuScreen(screen);
    if (screen === 'online') this.onLobby(this.game.online);
    if (screen === 'play' || screen === 'online') requestAnimationFrame(() => this._redrawPreviews());
    this.refresh();
  }

  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }

  _set(key, v) {
    const s = this.game.settings;
    const prev = s[key];
    s[key] = v;
    this.game.saveSettings();
    if (key === 'quality' && v !== prev) $('quality-note').classList.add('show');
    if (key === 'team') {
      this.game.online.setPref({ team: v });
      this.game.onTeamChange();
    }
    if (key === 'track' && v !== prev) this.game.previewTrack(v);
    this.refresh();
  }

  _bind() {
    const g = this.game;
    this.el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => this.show(b.dataset.go)));
    this.el.querySelectorAll('[data-opt]').forEach((group) => {
      const key = group.dataset.opt;
      group.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          let v = b.dataset.v;
          if (key === 'laps') v = +v;
          if (key === 'assist') v = v === '1';
          this._set(key, v);
        };
      });
    });
    this.el.querySelectorAll('[data-lopt]').forEach((group) => {
      const key = group.dataset.lopt;
      group.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          let v = b.dataset.v;
          if (key === 'laps') v = +v;
          if (key === 'ai') v = v === '1';
          g.online.setSettings({ [key]: v });
        };
      });
    });
    $('btn-start').onclick = () => { g.audio.init(); g.startRace(); };
    $('btn-reload').onclick = () => location.reload();
    const nameInputs = [$('player-name'), $('online-name')];
    for (const inp of nameInputs) {
      inp.addEventListener('input', () => {
        g.settings.name = inp.value.trim().slice(0, 14);
        g.saveSettings();
        for (const o of nameInputs) if (o !== inp) o.value = inp.value;
        this.refresh();
      });
      inp.addEventListener('change', () => g.online.setPref({ name: g.settings.name }));
    }
    const vol = $('volume');
    vol.oninput = () => { g.settings.volume = +vol.value; g.saveSettings(); g.audio.setVolume(g.settings.volume / 100); };

    // Online
    $('btn-create').onclick = async () => {
      g.audio.init();
      if (!this._checkName()) return;
      this._status('Creando sala…');
      try {
        await g.online.create();
        this._status('');
      } catch (e) { this._status(e.message, true); }
    };
    const doJoin = async () => {
      g.audio.init();
      if (!this._checkName()) return;
      const code = $('join-code').value;
      this._status('Conectando…');
      try {
        await g.online.join(code);
        this._status('');
        this.onLobby(g.online);
      } catch (e) { this._status(e.message, true); }
    };
    $('btn-join').onclick = doJoin;
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('btn-lobby-start').onclick = () => { g.audio.init(); g.online.start(); };
    $('btn-leave').onclick = () => g.online.leave();
    $('btn-copy-link').onclick = async () => {
      const url = `${location.origin}${location.pathname}?sala=${g.online.code}`;
      try { await navigator.clipboard.writeText(url); this.toast('Link copiado: ' + url); } catch { this.toast(url, 6000); }
    };
  }

  _checkName() {
    if (!this.game.settings.name) {
      this._status('Escribí tu nombre primero.', true);
      $('online-name').focus();
      return false;
    }
    return true;
  }

  _status(t, err = false) {
    const s = $('online-status');
    s.textContent = t;
    s.classList.toggle('err', err);
  }

  _trackCards(root, onPick, getSel, small = false) {
    root.innerHTML = '';
    for (const def of TRACKS) {
      const b = document.createElement('button');
      b.className = 'track-card';
      b.dataset.id = def.id;
      b.innerHTML = `<canvas></canvas><div class="tinfo"><b>${ENV_ICON[def.env] || ''} ${def.name}</b><small>${def.place}</small>${small ? '' : `<em>${def.desc}</em>`}<span class="tlen"></span></div>`;
      b.onclick = () => { if (!b.disabled) onPick(def.id); };
      root.appendChild(b);
    }
    root._getSel = getSel;
  }

  _redrawPreviews() {
    for (const root of [$('track-cards'), $('lobby-tracks')]) {
      root.querySelectorAll('.track-card').forEach((b) => {
        const def = trackById(b.dataset.id);
        drawPreview(b.querySelector('canvas'), def, b.classList.contains('sel') ? '#ffffff' : '#c9ced6');
        const p = preview(def);
        const best = loadBest(def.id);
        b.querySelector('.tlen').textContent = `${(p.length / 1000).toFixed(2)} km${best ? ' · récord ' + formatTime(best) : ''}`;
      });
    }
  }

  _teams() {
    const root = $('teams');
    TEAMS.forEach((t, k) => {
      const b = document.createElement('button');
      b.className = 'team';
      b.style.setProperty('--c1', t.primary);
      b.style.setProperty('--c2', t.secondary);
      b.innerHTML = `<i></i><span>${t.name}</span><small>#${t.numbers[1]} · compañero ${DRIVERS[k][0].code}</small>`;
      b.onclick = () => this._set('team', k);
      root.appendChild(b);
    });
  }

  refresh() {
    const g = this.game, s = g.settings;
    document.querySelectorAll('#teams .team').forEach((b, k) => b.classList.toggle('sel', k === s.team));
    this.el.querySelectorAll('[data-opt]').forEach((group) => {
      const key = group.dataset.opt;
      group.querySelectorAll('button').forEach((b) => {
        let v = b.dataset.v;
        if (key === 'laps') v = +v;
        if (key === 'assist') v = v === '1';
        b.classList.toggle('sel', s[key] === v);
      });
    });
    const sel = s.track;
    $('track-cards').querySelectorAll('.track-card').forEach((b) => b.classList.toggle('sel', b.dataset.id === sel));
    $('race-opts-laps').classList.toggle('dim', s.mode === 'tt');
    $('race-opts-diff').classList.toggle('dim', s.mode === 'tt');
    for (const id of ['player-name', 'online-name']) if (document.activeElement !== $(id)) $(id).value = s.name || '';
    $('volume').value = s.volume;
    const team = TEAMS[s.team];
    $('team-info').innerHTML = `<div class="swatch" style="background:linear-gradient(90deg, ${team.primary} 70%, ${team.secondary} 70%)"></div>
      <div><b>${team.name}</b><small>Auto #${team.numbers[1]} · Piloto: ${s.name || 'Tú'}</small></div>`;
    $('home-driver').innerHTML = `<i style="background:${team.primary}"></i>${s.name || 'Piloto'} · ${team.name}`;
    const best = loadBest(s.track);
    $('best-tt').textContent = best ? `Récord en ${trackById(s.track).name}: ${formatTime(best)}` : '';
    $('btn-sound').textContent = g.audio && g.audio.muted ? '🔇' : '🔊';
  }

  // Actualiza la pantalla online según el estado de la sesión
  onLobby(online, error) {
    const connected = online.active && online.state !== 'joining';
    $('online-connect').classList.toggle('hidden', connected);
    $('lobby').classList.toggle('hidden', !connected);
    if (error) this._status(error, true);
    if (!connected) return;
    $('room-code').textContent = online.code || '----';
    const list = $('lobby-players');
    list.innerHTML = '';
    for (const p of online.players) {
      const li = document.createElement('li');
      const team = TEAMS[p.team] || TEAMS[0];
      li.innerHTML = `<i style="background:${team.primary}"></i><b></b><small>${team.name}${p.host ? ' · 👑 anfitrión' : ''}</small>`;
      li.querySelector('b').textContent = p.name + (p.id === online.myId ? ' (vos)' : '');
      list.appendChild(li);
    }
    $('lobby-count').textContent = `${online.players.length}/10`;
    const st = online.settings;
    const host = online.isHost;
    $('lobby-tracks').querySelectorAll('.track-card').forEach((b) => {
      b.classList.toggle('sel', b.dataset.id === st.track);
      b.disabled = !host;
    });
    this.el.querySelectorAll('[data-lopt]').forEach((group) => {
      const key = group.dataset.lopt;
      group.classList.toggle('locked', !host);
      group.querySelectorAll('button').forEach((b) => {
        let v = b.dataset.v;
        if (key === 'laps') v = +v;
        if (key === 'ai') v = v === '1';
        b.classList.toggle('sel', st[key] === v);
        b.disabled = !host;
      });
    });
    const busy = online.state === 'loading' || online.state === 'racing';
    $('btn-lobby-start').classList.toggle('hidden', !host);
    $('btn-lobby-start').disabled = busy;
    $('lobby-wait').classList.toggle('hidden', host);
    $('lobby-wait').textContent = busy ? 'Carrera en curso…' : 'Esperando a que el anfitrión inicie la carrera…';
    if (this.screen === 'online') requestAnimationFrame(() => this._redrawPreviews());
  }
}
