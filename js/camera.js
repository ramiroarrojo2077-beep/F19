// Cámaras: persecución, lejana, T-cam, cockpit, televisión y cinemática.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './utils.js';

export const CAM_MODES = ['chase', 'far', 'tcam', 'cockpit'];
export const CAM_NAMES = { chase: 'Persecución', far: 'Persecución lejana', tcam: 'T-Cam', cockpit: 'Cockpit' };

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.h = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fov = 62;
    this.tv = null;
    this.cine = { t: 0, shot: 0 };
    this.lookBack = false;
    this._v = new THREE.Vector3();
  }

  snap(car) {
    this.h = car.heading;
    this._chase(car, 1, true);
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  update(dt, car, track, mode = this.mode) {
    const cam = this.cam;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    let near = 0.25;
    if (mode === 'chase' || mode === 'far') this._chase(car, dt, false, mode === 'far');
    else if (mode === 'tcam' || mode === 'cockpit') {
      near = mode === 'cockpit' ? 0.05 : 0.1;
      this._onboard(car, mode, dt);
    } else if (mode === 'tv') this._tv(car, track, dt);
    else if (mode === 'cine') this._cine(car, track, dt);

    // vibración por pianos, pasto y golpes
    const rough = (car.surface === 1 ? 0.35 : car.surface === 2 || car.surface === 3 ? 0.6 : 0) * clamp(Math.abs(car.speed) / 40, 0, 1);
    const sh = (this.shake + rough) * (mode === 'cockpit' || mode === 'tcam' ? 0.035 : 0.06);
    if (sh > 0) {
      this.cam.position.x += (Math.random() - 0.5) * sh;
      this.cam.position.y += (Math.random() - 0.5) * sh;
    }
    if (Math.abs(cam.near - near) > 1e-4 || Math.abs(cam.fov - this.fov) > 0.01) {
      cam.near = near;
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  _chase(car, dt, instant, far = false) {
    const v = Math.abs(car.speed);
    // seguir la dirección de la velocidad para que se note el derrape
    let target = car.heading;
    if (v > 8) {
      const vh = Math.atan2(car.vx, car.vz);
      if (Math.abs(wrapAngle(vh - car.heading)) < 1.2 && car.speed > 0) target = car.heading + wrapAngle(vh - car.heading) * 0.5;
    }
    if (this.lookBack) target += Math.PI;
    this.h = instant ? target : this.h + wrapAngle(target - this.h) * (1 - Math.exp(-7 * dt));
    // la distancia "respira" con la aceleración longitudinal
    this.pull = instant ? 0 : damp(this.pull || 0, clamp(car.longAccel * 0.03, -1.2, 0.6), 3, dt);
    const dist = (far ? 10.5 : 7.0) + v * 0.01 + this.pull;
    const height = far ? 3.3 : 2.2;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const px = car.x - fx * dist, pz = car.z - fz * dist;
    const cy = car.y || 0;
    // altura relativa suavizada (evita saltos en cambios de pendiente)
    this.relY = instant ? height : damp(this.relY ?? height, height, 6, dt);
    this.baseY = instant ? cy : damp(this.baseY ?? cy, cy, 10, dt);
    this.pos.set(px, this.baseY + this.relY, pz);
    this.cam.position.copy(this.pos);
    this.look.set(car.x + fx * 6, this.baseY + (far ? 1.0 : 0.9), car.z + fz * 6);
    this.cam.lookAt(this.look);
    this.fov = damp(this.fov, 60 + clamp(v / 95, 0, 1) * 14, 4, instant ? 1 : dt);
  }

  _onboard(car, mode, dt) {
    const body = car.model.body;
    body.updateWorldMatrix(true, false);
    const local = mode === 'cockpit' ? new THREE.Vector3(0, 0.81, 0.02) : new THREE.Vector3(0, 1.22, -0.35);
    const ahead = mode === 'cockpit' ? new THREE.Vector3(0, 0.62, 12) : new THREE.Vector3(0, 0.7, 14);
    if (this.lookBack) ahead.z = -12;
    local.applyMatrix4(body.matrixWorld);
    ahead.applyMatrix4(body.matrixWorld);
    this.cam.position.copy(local);
    this.cam.lookAt(ahead);
    const v = Math.abs(car.speed);
    this.fov = damp(this.fov, (mode === 'cockpit' ? 70 : 64) + clamp(v / 95, 0, 1) * 8, 4, dt);
    this.pos.copy(local);
    this.h = car.heading;
  }

  _tv(car, track, dt) {
    const cams = track.tvCams;
    const L = track.length;
    // elegir la cámara más cercana por delante (o apenas pasada)
    if (!this.tv || this._rel(this.tv.s, car.s, L) < -45 || this._rel(this.tv.s, car.s, L) > 260) {
      let best = null, bd = Infinity;
      for (const c of cams) {
        const d = this._rel(c.s, car.s, L);
        if (d > -10 && d < bd) { bd = d; best = c; }
      }
      this.tv = best || cams[0];
    }
    const p = this.tv.pos;
    this.cam.position.copy(p);
    this._v.set(car.x, (car.y || 0) + 0.8, car.z);
    this.look.x = damp(this.look.x, this._v.x, 10, dt);
    this.look.y = this._v.y;
    this.look.z = damp(this.look.z, this._v.z, 10, dt);
    if (this.look.distanceTo(this._v) > 30) this.look.copy(this._v);
    this.cam.lookAt(this.look);
    const d = p.distanceTo(this._v);
    this.fov = clamp((2 * Math.atan(7 / d) * 180) / Math.PI, 5, 55);
  }

  _rel(a, b, L) {
    let d = a - b;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  // Secuencia cinemática para el menú
  _cine(car, track, dt) {
    const c = this.cine;
    c.t += dt;
    const shots = [7, 9, 6, 8];
    if (c.t > shots[c.shot % shots.length]) { c.t = 0; c.shot++; this.tv = null; }
    const kind = c.shot % 4;
    if (kind === 0) {
      // órbita alrededor del auto
      const a = car.heading + 0.9 + c.t * 0.18;
      const r = 7.5;
      const cy = car.y || 0;
      this.cam.position.set(car.x + Math.sin(a) * r, cy + 1.6 + Math.sin(c.t * 0.3) * 0.4, car.z + Math.cos(a) * r);
      this.look.set(car.x, cy + 0.6, car.z);
      this.cam.lookAt(this.look);
      this.fov = 42;
    } else if (kind === 1) {
      this._tv(car, track, dt);
    } else if (kind === 2) {
      // cámara baja lateral
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const sx = fz, sz = -fx;
      const cy = car.y || 0;
      this.cam.position.set(car.x + sx * 3.2 - fx * (2 - c.t * 0.25), cy + 0.45, car.z + sz * 3.2 - fz * (2 - c.t * 0.25));
      this.look.set(car.x + fx * 1.5, cy + 0.5, car.z + fz * 1.5);
      this.cam.lookAt(this.look);
      this.fov = 55;
    } else {
      // helicóptero
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const cy = car.y || 0;
      this.cam.position.set(car.x - fx * 30 + fz * 12, cy + 22, car.z - fz * 30 - fx * 12);
      this.look.set(car.x + fx * 10, cy, car.z + fz * 10);
      this.cam.lookAt(this.look);
      this.fov = 50;
    }
  }
}
