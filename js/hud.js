// Interfaz en pantalla: posiciones, tiempos, velocímetro, minimapa y mensajes.
import { formatTime, clamp } from './utils.js';
import { MAX_RPM } from './physics.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      root: $('hud'), pos: $('hud-pos'), posTotal: $('hud-pos-total'), lap: $('hud-lap'), lapLabel: $('hud-lap-label'),
      cur: $('hud-cur'), last: $('hud-last'), best: $('hud-best'), delta: $('hud-delta'),
      speed: $('hud-speed'), gear: $('hud-gear'), rpm: $('hud-rpm'), drs: $('hud-drs'),
      tower: $('tower'), msg: $('message'), sub: $('submessage'), lights: $('lights'),
      wrong: $('wrongway'), cam: $('hud-cam'), map: $('minimap'),
    };
    this.leds = [];
    for (let i = 0; i < 15; i++) {
      const s = document.createElement('span');
      s.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
      this.el.rpm.appendChild(s);
      this.leds.push(s);
    }
    this.towerRows = [];
    this.towerT = 0;
    this.msgT = 0;
    this._initMap();
  }

  show(v) { this.el.root.classList.toggle('hidden', !v); }

  _initMap() {
    const c = this.el.map;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const size = 190;
    c.width = c.height = size * dpr;
    c.style.width = c.style.height = size + 'px';
    this.mapCtx = c.getContext('2d');
    this.mapDpr = dpr;
    const T = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < T.N; i++) {
      minX = Math.min(minX, T.px[i]); maxX = Math.max(maxX, T.px[i]);
      minZ = Math.min(minZ, T.pz[i]); maxZ = Math.max(maxZ, T.pz[i]);
    }
    const pad = 14;
    const sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = pad + ((size - pad * 2) - (maxX - minX) * sc) / 2;
    const oz = pad + ((size - pad * 2) - (maxZ - minZ) * sc) / 2;
    this.toMap = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
    const bg = document.createElement('canvas');
    bg.width = bg.height = size * dpr;
    const g = bg.getContext('2d');
    g.scale(dpr, dpr);
    g.lineJoin = g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= T.N; i += 2) {
        const [x, y] = this.toMap(T.px[i % T.N], T.pz[i % T.N]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 9; path(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 4; path(); g.stroke();
    const [sx, sy] = this.toMap(T.px[0], T.pz[0]);
    const [nx, ny] = this.toMap(T.px[0] + T.nx[0] * 30, T.pz[0] + T.nz[0] * 30);
    const dx = (nx - sx), dy = (ny - sy);
    g.strokeStyle = '#e10600'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(sx - dx * 0.4, sy - dy * 0.4); g.lineTo(sx + dx * 0.4, sy + dy * 0.4); g.stroke();
    this.mapBg = bg;
    this.mapSize = size;
  }

  drawMap(cars, player) {
    const g = this.mapCtx;
    const dpr = this.mapDpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.mapSize * dpr, this.mapSize * dpr);
    g.drawImage(this.mapBg, 0, 0);
    g.scale(dpr, dpr);
    for (const c of cars) {
      if (c === player) continue;
      const [x, y] = this.toMap(c.x, c.z);
      g.fillStyle = c.team.primary;
      g.strokeStyle = '#000'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (player) {
      const [x, y] = this.toMap(player.x, player.z);
      g.fillStyle = '#ffe600'; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  message(text, sub = '', dur = 2, cls = '') {
    this.el.msg.textContent = text;
    this.el.msg.className = 'show ' + cls;
    this.el.sub.textContent = sub;
    this.el.sub.className = sub ? 'show' : '';
    this.msgT = dur;
  }

  setLights(n, visible) {
    this.el.lights.classList.toggle('show', visible);
    this.el.lights.querySelectorAll('.light').forEach((l, k) => l.classList.toggle('on', k < n));
  }

  showCamera(name) {
    this.el.cam.textContent = name;
    this.el.cam.classList.add('show');
    clearTimeout(this.camTo);
    this.camTo = setTimeout(() => this.el.cam.classList.remove('show'), 1400);
  }

  update(dt, sim, player, { mode, laps }) {
    const e = this.el;
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) { e.msg.className = ''; e.sub.className = ''; }
    }
    if (!player) return;
    const v = Math.abs(player.speed) * 3.6;
    e.speed.textContent = Math.round(v);
    e.gear.textContent = player.speed < -0.5 ? 'R' : sim.started || v > 1 ? player.gear : 'N';
    const r = clamp((player.rpm - 7000) / (MAX_RPM - 7000), 0, 1);
    const lit = Math.round(r * 15);
    const flash = player.rpm > MAX_RPM * 0.97 && Math.floor(performance.now() / 70) % 2 === 0;
    this.leds.forEach((l, k) => l.classList.toggle('on', flash ? true : k < lit));
    e.rpm.classList.toggle('flash', flash);

    e.drs.className = player.drsOpen ? 'open' : player.drsAllowed && player.inDrsZone ? 'avail' : player.drsAllowed ? 'armed' : '';

    const ranking = sim.ranking();
    if (mode === 'race') {
      e.pos.textContent = player.position;
      e.posTotal.textContent = '/' + sim.cars.length;
      e.lapLabel.textContent = 'VUELTA';
      e.lap.textContent = `${clamp(player.lap, 1, laps)}/${laps}`;
    } else {
      e.pos.textContent = '—';
      e.posTotal.textContent = '';
      e.lapLabel.textContent = 'VUELTA';
      e.lap.textContent = Math.max(1, player.lap);
    }
    const cur = sim.started ? sim.time - player.lapStart : 0;
    e.cur.textContent = mode === 'tt' && player.lap < 1 ? formatTime(0) : formatTime(player.finished ? player.lastLap : cur);
    e.last.textContent = formatTime(player.lastLap);
    e.best.textContent = formatTime(player.bestLap);
    e.wrong.classList.toggle('show', player.wrongWay > 0.8);

    this.towerT -= dt;
    if (this.towerT <= 0 && mode === 'race') {
      this.towerT = 0.25;
      this._tower(ranking, sim, player);
    }
  }

  _tower(ranking, sim, player) {
    const root = this.el.tower;
    while (this.towerRows.length < ranking.length) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = '<span class="tp"></span><span class="tc"></span><span class="tn"></span><span class="tg"></span>';
      root.appendChild(row);
      this.towerRows.push(row);
    }
    const leader = ranking[0];
    ranking.forEach((c, k) => {
      const row = this.towerRows[k];
      row.children[0].textContent = k + 1;
      row.children[1].style.background = c.team.primary;
      row.children[2].textContent = c.driver.code;
      let gap = '';
      if (k === 0) gap = c.finished ? 'META' : 'LÍDER';
      else if (sim.started) {
        const lapsDown = Math.floor((leader.raceDist - c.raceDist) / sim.track.length);
        if (lapsDown >= 1 && !c.finished) gap = `+${lapsDown} V`;
        else {
          const g = sim.gapTo(c, leader);
          gap = g != null ? `+${g.toFixed(1)}` : '';
        }
      }
      row.children[3].textContent = gap;
      row.classList.toggle('me', c === player);
    });
  }
}
