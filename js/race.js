// Simulación de carrera independiente del render: física, límites, vueltas y posiciones.
import { stepCar, SURFACE, CAR_HALF_WIDTH, gearFor, rpmFor } from './physics.js';
import { KERB_W } from './trackdata.js';
import { clamp, damp, wrapAngle } from './utils.js';

export const CP = 25; // metros entre puntos de cronometraje

export function resetCarState(c) {
  c.x = 0; c.y = 0; c.z = 0; c.heading = 0; c.grade = 0;
  c.vx = 0; c.vz = 0; c.speed = 0;
  c.yawRate = 0; c.steerAngle = 0;
  c.surface = 0; c.slip = 0; c.understeer = 0;
  c.longAccel = 0; c.latAccel = 0;
  c.gear = 1; c.rpm = 4200;
  c.drsOpen = false; c.drsAllowed = false; c.inDrsZone = false;
  c.idx = 0; c.lat = 0; c.s = 0;
  c.lap = 0; c.raceDist = 0;
  c.finished = false; c.finishTime = null; c.position = 0;
  c.lapStart = 0; c.lastLap = null; c.bestLap = null; c.lapTimes = [];
  c.cp = []; c.cpk = -1;
  c.input = { throttle: 0, brake: 0, steer: 0 };
  c.stuckTime = 0; c.wrongWay = 0; c.offTime = 0;
  c.hitCooldown = 0;
  c.gripMul = 1; c.powerMul = 1;
  c.remote = false; c.netBuf = []; c.netRaw = null; c.netTs = null;
  return c;
}

export class RaceSim {
  constructor(track, cars, { laps = 3, mode = 'race' } = {}) {
    this.track = track;
    this.cars = cars;
    this.laps = laps;
    this.mode = mode;
    this.time = 0;
    this.started = false;
    this.events = [];
    this.proj = {};
    this._findDrsZones();
  }

  _findDrsZones() {
    const T = this.track, N = T.N;
    const straight = new Uint8Array(N);
    for (let i = 0; i < N; i++) straight[i] = Math.abs(T.kappa[i]) < 1 / 900 ? 1 : 0;
    // arrancar en una muestra curva para no partir una recta
    let start = 0;
    while (straight[start] && start < N) start++;
    const zones = [];
    let run = -1;
    for (let k = 0; k <= N; k++) {
      const i = (start + k) % N;
      if (straight[i] && k < N) { if (run < 0) run = k; }
      else if (run >= 0) {
        const len = (k - run) * T.ds;
        if (len > 330) {
          const s0 = ((start + run) % N) * T.ds + 40;
          zones.push({ start: s0, end: s0 + len - 120, detect: s0 - 90 });
        }
        run = -1;
      }
    }
    zones.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    this.drsZones = zones.slice(0, 2);
  }

  inZone(z, s) {
    const L = this.track.length;
    const d = ((s - z.start) % L + L) % L;
    return d < z.end - z.start;
  }

  gridSlot(k) {
    return { s: this.track.length - (12 + 8 * k) - 1.8, lat: k % 2 === 0 ? 3.2 : -3.2 };
  }

  placeGrid(order) {
    order.forEach((c, k) => {
      const g = this.gridSlot(k);
      this.placeCar(c, g.s, g.lat);
      c.lap = 0;
      c.raceDist = c.s;
    });
  }

  placeCar(c, s, lat, speed = 0) {
    const T = this.track;
    const p = T.pointAt(s, lat);
    c.x = p.x; c.z = p.z; c.heading = p.heading;
    c.vx = Math.sin(p.heading) * speed; c.vz = Math.cos(p.heading) * speed;
    c.speed = speed; c.yawRate = 0; c.steerAngle = 0;
    T.project(c.x, c.z, p.idx, this.proj);
    c.idx = this.proj.idx; c.lat = this.proj.lat; c.s = this.proj.s;
    c.y = T.heightAt(c.idx, this.proj.along);
  }

  // Reubica el auto en la pista (tecla R o auto atascado)
  respawn(c) {
    const T = this.track;
    const s = c.s;
    const lat = T.lineAt(s);
    this.placeCar(c, s, lat, 0);
    c.raceDist = c.lap * T.length + c.s;
    c.stuckTime = 0; c.offTime = 0; c.wrongWay = 0;
    this.events.push({ type: 'respawn', car: c });
  }

  start() {
    this.started = true;
    this.time = 0;
    for (const c of this.cars) c.lapStart = 0;
  }

  step(dt) {
    const T = this.track;
    if (this.started) this.time += dt;
    const t = this.time;
    for (const c of this.cars) {
      if (c.remote) { this._remote(c, t); continue; }
      if (!this.started) {
        // parrilla: el auto no se mueve pero el motor responde
        c.speed = 0; c.vx = 0; c.vz = 0;
        c.rpm = damp(c.rpm, 4200 + c.input.throttle * 7800, 6, dt);
        c.gear = 1;
        continue;
      }
      this._drs(c);
      stepCar(c, c.input, dt);
      const prevS = c.s;
      T.project(c.x, c.z, c.idx, this.proj);
      c.idx = this.proj.idx; c.lat = this.proj.lat;
      c.y = T.heightAt(c.idx, this.proj.along);
      c.grade = T.grade[c.idx] * Math.cos(T.heading[c.idx] - c.heading);
      let s = this.proj.s;
      if (s < 0) s += T.length;
      if (s >= T.length) s -= T.length;
      c.s = s;
      this._surface(c);
      this._barrier(c);

      // Vueltas: cruce de meta detectado por la distancia recorrida (continua)
      const L = T.length;
      if (prevS > L * 0.75 && c.s < L * 0.25) this._crossLine(c, t);
      else if (prevS < L * 0.25 && c.s > L * 0.75) c.lap--;
      c.raceDist = c.lap * T.length + c.s;
      const k = Math.floor(c.raceDist / CP);
      if (k > c.cpk) {
        for (let j = Math.max(c.cpk + 1, k - 20); j <= k; j++) c.cp[j] = t;
        c.cpk = k;
      }

      // Sentido contrario / atascado
      const hd = wrapAngle(T.heading[c.idx] - c.heading);
      c.wrongWay = Math.abs(hd) > 1.9 && c.speed > 3 ? c.wrongWay + dt : 0;
      if (Math.abs(c.speed) < 1.5) c.stuckTime += dt; else c.stuckTime = 0;
      const off = Math.abs(c.lat) > T.hw + KERB_W + 0.5;
      c.offTime = off ? c.offTime + dt : 0;
      if (c.ai && (c.stuckTime > 2.5 || c.offTime > 6 || c.wrongWay > 2)) this.respawn(c);

      c.gear = gearFor(c.speed);
      c.rpm = damp(c.rpm, rpmFor(c.speed, c.gear) * (0.92 + 0.08 * c.input.throttle), 20, dt);
      if (c.hitCooldown > 0) c.hitCooldown -= dt;
    }
    if (this.started) this._collisions();
  }

  // Auto controlado por otro jugador: solo actualizar datos derivados
  _remote(c, t) {
    const T = this.track;
    T.project(c.x, c.z, c.idx, this.proj);
    c.idx = this.proj.idx; c.lat = this.proj.lat;
    c.y = T.heightAt(c.idx, this.proj.along);
    c.grade = T.grade[c.idx] * Math.cos(T.heading[c.idx] - c.heading);
    let s = this.proj.s;
    if (s < 0) s += T.length;
    if (s >= T.length) s -= T.length;
    c.s = s;
    if (!this.started) return;
    const k = Math.floor(c.raceDist / CP);
    if (k > c.cpk && k - c.cpk < 400) {
      for (let j = Math.max(c.cpk + 1, k - 20); j <= k; j++) c.cp[j] = t;
      c.cpk = k;
    }
  }

  _crossLine(c, t) {
    c.lap++;
    if (this.mode === 'tt' || this.mode === 'menu') {
      if (c.lap >= 2) this._recordLap(c, t);
      c.lapStart = t;
      this.events.push({ type: 'lap', car: c });
      return;
    }
    if (c.lap >= 2) {
      this._recordLap(c, t);
      c.lapStart = t;
    }
    if (c.lap > this.laps && !c.finished) {
      c.finished = true;
      c.finishTime = t;
      this.events.push({ type: 'finish', car: c });
    } else {
      this.events.push({ type: 'lap', car: c });
    }
  }

  _recordLap(c, t) {
    const lt = t - c.lapStart;
    c.lastLap = lt;
    c.lapTimes.push(lt);
    if (c.bestLap == null || lt < c.bestLap) c.bestLap = lt;
    this.events.push({ type: 'laptime', car: c, time: lt });
  }

  _surface(c) {
    const T = this.track;
    const a = Math.abs(c.lat) - 0.35;
    const side = c.lat >= 0 ? 1 : -1;
    if (a <= T.hw) c.surface = SURFACE.ROAD;
    else if (T.kerb[c.idx] && a <= T.hw + KERB_W) c.surface = SURFACE.KERB;
    else if (T.runoffTarmac) c.surface = SURFACE.RUNOFF;
    else if (T.gravelAt(c.idx, side) > 0.5 && a > T.hw + KERB_W + 1.2) c.surface = SURFACE.GRAVEL;
    else c.surface = SURFACE.GRASS;
  }

  _barrier(c) {
    const T = this.track;
    const side = c.lat >= 0 ? 1 : -1;
    const lim = (T.wallAt ? T.wallAt(c.idx, side) : T.barrierAt(c.idx, side)) - CAR_HALF_WIDTH * 1.05;
    const a = Math.abs(c.lat);
    if (a <= lim) return;
    const pen = a - lim;
    const nx = T.nx[c.idx] * side, nz = T.nz[c.idx] * side;
    c.x -= nx * pen; c.z -= nz * pen;
    c.lat -= side * pen;
    const vn = c.vx * nx + c.vz * nz;
    if (vn > 0) {
      c.vx -= nx * vn * 1.3; c.vz -= nz * vn * 1.3;
      const loss = clamp(vn / 25, 0.04, 0.55);
      c.vx *= 1 - loss; c.vz *= 1 - loss;
      const th = T.heading[c.idx];
      const fwd = Math.abs(wrapAngle(th - c.heading)) < Math.PI / 2;
      if (fwd) c.heading += wrapAngle(th - c.heading) * clamp(vn / 12, 0.1, 0.5);
      c.yawRate *= 0.3;
      if (c.hitCooldown <= 0 && vn > 1.5) {
        this.events.push({ type: 'hit', car: c, strength: vn });
        c.hitCooldown = 0.25;
      }
    }
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    c.speed = c.vx * fx + c.vz * fz;
  }

  _drs(c) {
    if (!this.drsZones.length) return;
    let inZone = false;
    for (const z of this.drsZones) {
      if (this.inZone(z, c.s)) inZone = true;
      // punto de detección
      const L = this.track.length;
      const dd = ((c.s - z.detect) % L + L) % L;
      if (dd < 3 && c.lastDetect !== z) {
        c.lastDetect = z;
        c.drsAllowed = this.mode !== 'race' || (c.lap >= 2 && this.gapAhead(c) < 1.0);
      }
    }
    if (this.mode !== 'race') c.drsAllowed = true;
    c.inDrsZone = inZone;
    if (!inZone || c.input.brake > 0.15) {
      c.drsOpen = false;
      if (!inZone && c.lastDetect && this.mode === 'race') {
        // se mantiene habilitado solo hasta salir de la zona
        const z = c.lastDetect;
        const L = this.track.length;
        const past = ((c.s - z.end) % L + L) % L;
        if (past < 50) c.drsAllowed = false;
      }
    } else if (c.ai && c.drsAllowed && c.speed > 40) {
      c.drsOpen = true;
    }
  }

  // Diferencia en segundos con el auto inmediatamente delante
  gapAhead(c) {
    let best = null, bd = Infinity;
    for (const o of this.cars) {
      if (o === c) continue;
      const d = o.raceDist - c.raceDist;
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    if (!best) return Infinity;
    const k = Math.floor(c.raceDist / CP);
    const tb = best.cp[k];
    return tb != null ? this.time - tb : Infinity;
  }

  gapTo(c, ref) {
    if (c.finished && ref.finished) return c.finishTime - ref.finishTime;
    const k = Math.min(c.cpk, ref.cpk);
    if (k < 0 || c.cp[k] == null || ref.cp[k] == null) return null;
    return c.cp[k] - ref.cp[k];
  }

  _collisions() {
    const cs = this.cars;
    const L = this.track.length;
    const R = 1.0, OFF = 1.55;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        let ds = Math.abs(a.s - b.s);
        ds = Math.min(ds, L - ds);
        if (ds > 8) continue;
        const afx = Math.sin(a.heading), afz = Math.cos(a.heading);
        const bfx = Math.sin(b.heading), bfz = Math.cos(b.heading);
        for (const oa of [OFF, -OFF]) {
          for (const ob of [OFF, -OFF]) {
            const ax = a.x + afx * oa, az = a.z + afz * oa;
            const bx = b.x + bfx * ob, bz = b.z + bfz * ob;
            let dx = bx - ax, dz = bz - az;
            const d = Math.hypot(dx, dz);
            if (d >= 2 * R || d < 1e-4) continue;
            dx /= d; dz /= d;
            if (a.remote && b.remote) continue;
            // un auto remoto se trata como masa infinita (su posición la manda la red)
            const wa = a.remote ? 0 : b.remote ? 1 : 0.5, wb = 1 - wa;
            const pen = 2 * R - d;
            a.x -= dx * pen * wa; a.z -= dz * pen * wa;
            b.x += dx * pen * wb; b.z += dz * pen * wb;
            const vrel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
            if (vrel < 0) {
              const jImp = -(1 + 0.25) * vrel;
              a.vx -= jImp * dx * wa; a.vz -= jImp * dz * wa;
              b.vx += jImp * dx * wb; b.vz += jImp * dz * wb;
              if (-vrel > 2 && (a.hitCooldown <= 0 || b.hitCooldown <= 0)) {
                this.events.push({ type: 'contact', car: a, other: b, strength: -vrel });
                a.hitCooldown = b.hitCooldown = 0.3;
              }
            }
            a.speed = a.vx * afx + a.vz * afz;
            b.speed = b.vx * bfx + b.vz * bfz;
          }
        }
      }
    }
  }

  ranking() {
    const list = [...this.cars];
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.raceDist - a.raceDist;
    });
    list.forEach((c, k) => (c.position = k + 1));
    return list;
  }
}
