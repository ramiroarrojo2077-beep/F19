// Piloto automático: sigue la trazada ideal, respeta el perfil de velocidad y adelanta.
import { steerLimit, WHEELBASE } from './physics.js';
import { clamp, damp, wrapAngle } from './utils.js';

export class AIDriver {
  constructor(car, track, { skill = 0.95, rnd = Math.random } = {}) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.bias = (rnd() - 0.5) * 1.2;
    this.phase = rnd() * 100;
    this.avoid = 0;
    this.reaction = 0.12 + rnd() * 0.35;
    this.launched = false;
  }

  update(dt, cars, t, started) {
    const c = this.car, T = this.track;
    const inp = c.input;
    if (!started) {
      inp.throttle = 0; inp.brake = 1; inp.steer = 0;
      this.launchAt = null;
      return;
    }
    if (this.launchAt == null) this.launchAt = t + this.reaction;
    const v = Math.max(c.speed, 0);
    const L = T.length;

    // Tráfico: buscar autos cercanos por delante
    let avoidTarget = 0;
    let speedCap = Infinity;
    const baseLat = T.lineAt(c.s + 10);
    for (const o of cars) {
      if (o === c) continue;
      let gap = o.s - c.s;
      if (gap > L / 2) gap -= L;
      if (gap < -L / 2) gap += L;
      const dl = o.lat - c.lat;
      if (gap > 0 && gap < 32) {
        const closing = v - o.speed;
        if (Math.abs(dl) < 2.7 && (closing > 0.5 || gap < 9)) {
          const roomL = T.hw - o.lat, roomR = o.lat + T.hw;
          const side = roomL > roomR ? 1 : -1;
          const want = clamp(o.lat + side * 3.1, -T.hw + 1.4, T.hw - 1.4);
          avoidTarget = want - baseLat;
          if (gap < 11 && Math.abs(dl) < 2.1 && closing > 0) speedCap = Math.min(speedCap, o.speed - 0.3 + gap * 0.25);
        }
      } else if (gap <= 0 && gap > -5 && Math.abs(dl) < 2.5) {
        // lado a lado: mantener distancia lateral
        avoidTarget += (dl > 0 ? -1 : 1) * (2.6 - Math.abs(dl));
      }
    }
    this.avoid = damp(this.avoid, avoidTarget, 2.2, dt);

    // Dirección por persecución pura
    const la = 7 + v * 0.42;
    const sT = c.s + la;
    const latT = clamp(T.lineAt(sT) + this.bias * 0.4 + this.avoid, -T.hw + 1.3, T.hw - 1.3);
    const p = T.pointAt(sT, latT);
    const dx = p.x - c.x, dz = p.z - c.z;
    const alpha = wrapAngle(Math.atan2(dx, dz) - c.heading);
    const ld = Math.max(Math.hypot(dx, dz), 1);
    let delta = Math.atan2(2 * WHEELBASE * Math.sin(alpha), ld);
    if (c.speed < -0.5) delta = -delta;
    inp.steer = clamp(-delta / steerLimit(v), -1, 1);

    // Velocidad objetivo según el perfil
    const wobble = 1 + 0.012 * Math.sin(t * 0.37 + this.phase);
    let vT = T.vmaxAt(c.s + v * 0.12) * this.skill * wobble;
    vT = Math.min(vT, speedCap);
    const off = Math.abs(c.lat) > T.hw + 0.5;
    if (off) vT = Math.min(vT, 45);
    const err = vT - v;
    if (t < this.launchAt) {
      inp.throttle = 0; inp.brake = 1;
    } else if (err > 0) {
      inp.throttle = clamp(0.35 + err * 0.5, 0, 1); inp.brake = 0;
    } else if (err < -0.8) {
      inp.throttle = 0; inp.brake = clamp(-err * 0.3, 0, 1);
    } else {
      inp.throttle = 0.25; inp.brake = 0;
    }
    // Si está mirando al revés, girar
    const tIdx = c.idx;
    const hd = wrapAngle(T.heading[tIdx] - c.heading);
    if (Math.abs(hd) > 1.9 && v < 8) {
      inp.steer = hd > 0 ? -1 : 1;
      inp.throttle = 0.6; inp.brake = 0;
    }
  }
}
