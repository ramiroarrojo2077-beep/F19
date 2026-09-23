// Datos geométricos del circuito: muestreo, curvatura, trazada ideal y consultas.
// No depende de three.js para poder probarse en Node.
import { clamp, smoothstep, wrapAngle } from './utils.js';
import { cornerSpeed, brakeDecel, engineAccel, dragDecel, CAR_HALF_WIDTH } from './physics.js';

// Puntos de control (x, z) en metros. El índice 0 es la línea de meta.
export const CONTROL = [
  [-300, 0], [0, 0], [300, 0], [480, 0],
  [580, 40], [610, 130], [560, 220], [450, 250],
  [340, 225], [250, 280], [150, 250], [60, 310],
  [-10, 410], [10, 530], [90, 610], [60, 700],
  [-40, 720], [-180, 690], [-400, 640], [-620, 600],
  [-760, 530], [-820, 400], [-790, 280], [-840, 200],
  [-800, 110], [-700, 40], [-560, 0],
];

export const HALF_WIDTH = 7;
export const KERB_W = 1.6;
export const SAMPLE_DS = 2;

// Catmull-Rom centrípeta cerrada, muestreada densamente.
function sampleCatmull(ctrl, perSeg = 160) {
  const n = ctrl.length;
  const out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg;
      const pt = [0, 0];
      for (let d = 0; d < 2; d++) {
        const A1 = ((t1 - t) / (t1 - t0)) * p0[d] + ((t - t0) / (t1 - t0)) * p1[d];
        const A2 = ((t2 - t) / (t2 - t1)) * p1[d] + ((t - t1) / (t2 - t1)) * p2[d];
        const A3 = ((t3 - t) / (t3 - t2)) * p2[d] + ((t - t2) / (t3 - t2)) * p3[d];
        const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
        const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
        pt[d] = ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
      }
      out.push(pt);
    }
  }
  return out;
}

function smoothCyclic(arr, radius, passes = 1) {
  const N = arr.length;
  let a = Float32Array.from(arr);
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(N);
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += a[(k + N) % N];
    for (let i = 0; i < N; i++) {
      b[i] = s / (2 * radius + 1);
      s += a[(i + radius + 1) % N] - a[(i - radius + N) % N];
    }
    a = b;
  }
  return a;
}

export class TrackData {
  constructor(ctrl = CONTROL) {
    this.hw = HALF_WIDTH;
    this._sample(ctrl);
    this._geometry();
    this._edges();
    this._racingLine();
    this._speedProfile();
  }

  _sample(ctrl) {
    const dense = sampleCatmull(ctrl);
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const L = cum[cum.length - 1];
    const N = Math.round(L / SAMPLE_DS);
    this.length = L;
    this.N = N;
    this.ds = L / N;
    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      while (cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
      const a = dense[j], b = dense[(j + 1) % dense.length];
      this.px[i] = a[0] + (b[0] - a[0]) * t;
      this.pz[i] = a[1] + (b[1] - a[1]) * t;
    }
  }

  _geometry() {
    const { N, px, pz, ds } = this;
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.nx = new Float32Array(N);
    this.nz = new Float32Array(N);
    this.heading = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      // normal izquierda (misma convención que la guiñada del auto)
      this.nx[i] = dz; this.nz[i] = -dx;
      this.heading[i] = Math.atan2(dx, dz);
    }
    const k = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 3 + N) % N, b = (i + 3) % N;
      k[i] = wrapAngle(this.heading[b] - this.heading[a]) / (6 * ds);
    }
    this.kappa = smoothCyclic(k, 6, 2);

    // Lado interior del circuito (para colocar boxes/tribunas)
    let area = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      area += px[i] * pz[j] - px[j] * pz[i];
    }
    // area > 0: sentido x→z; la normal izquierda (tz,-tx) apunta afuera
    this.insideSign = area > 0 ? -1 : 1;
  }

  _edges() {
    const { N, hw } = this;
    const kap = this.kappa;
    // Pianos donde la curva es cerrada
    const kerbRaw = new Float32Array(N);
    for (let i = 0; i < N; i++) kerbRaw[i] = Math.abs(kap[i]) > 1 / 260 ? 1 : 0;
    const kerb = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!kerbRaw[i]) continue;
      for (let d = -9; d <= 9; d++) kerb[(i + d + N) % N] = 1;
    }
    this.kerb = kerb;

    // Barreras y escapatorias
    const bL = new Float32Array(N), bR = new Float32Array(N);
    const gL = new Float32Array(N), gR = new Float32Array(N);
    const base = hw + 9;
    for (let i = 0; i < N; i++) {
      const k = kap[i];
      const ak = Math.abs(k);
      const run = smoothstep(1 / 500, 1 / 110, ak) * 26;
      const R = ak > 1e-5 ? 1 / ak : 1e5;
      const inner = Math.max(hw + KERB_W + 2.5, Math.min(base, R * 0.5));
      if (k > 0) { // gira a la izquierda: exterior = derecha
        bL[i] = inner; bR[i] = base + run;
        gR[i] = run > 8 ? 1 : 0;
      } else {
        bR[i] = inner; bL[i] = base + run;
        gL[i] = run > 8 ? 1 : 0;
      }
    }
    // Recta principal: muro de boxes más cerca (ambiente de calle de boxes)
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      const d = Math.min(s, this.length - s);
      if (d < 360) {
        const w = 1 - smoothstep(260, 360, d);
        const inSide = this.insideSign > 0 ? bL : bR;
        inSide[i] = inSide[i] * (1 - w) + (hw + 4) * w;
        const out = this.insideSign > 0 ? bR : bL;
        out[i] = out[i] * (1 - w) + (hw + 7) * w;
      }
    }
    this.barrierL = smoothCyclic(bL, 20, 3);
    this.barrierR = smoothCyclic(bR, 20, 3);
    // asegurar que la barrera interior nunca invada la pista
    for (let i = 0; i < N; i++) {
      this.barrierL[i] = Math.max(this.barrierL[i], hw + 3.2);
      this.barrierR[i] = Math.max(this.barrierR[i], hw + 3.2);
    }
    this.gravelL = smoothCyclic(gL, 12, 2);
    this.gravelR = smoothCyclic(gR, 12, 2);
  }

  _racingLine() {
    const { N, px, pz, nx, nz, hw } = this;
    const line = new Float32Array(N);
    const lim = hw - CAR_HALF_WIDTH - 0.5;
    const passes = [[48, 40], [28, 60], [14, 80], [7, 80], [4, 40]];
    for (const [k, iters] of passes) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = (i - k + N) % N, b = (i + k) % N;
          const ax = px[a] + nx[a] * line[a], az = pz[a] + nz[a] * line[a];
          const bx = px[b] + nx[b] * line[b], bz = pz[b] + nz[b] * line[b];
          const mx = (ax + bx) * 0.5 - px[i], mz = (az + bz) * 0.5 - pz[i];
          const target = mx * nx[i] + mz * nz[i];
          line[i] = clamp(line[i] + (target - line[i]) * 0.6, -lim, lim);
        }
      }
    }
    this.line = smoothCyclic(line, 3, 2);
    // curvatura de la trazada (círculo por tres puntos)
    const lx = new Float32Array(N), lz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lx[i] = px[i] + nx[i] * this.line[i];
      lz[i] = pz[i] + nz[i] * this.line[i];
    }
    this.lineX = lx; this.lineZ = lz;
    const kl = new Float32Array(N);
    const s = 5;
    for (let i = 0; i < N; i++) {
      const a = (i - s + N) % N, b = (i + s) % N;
      const ax = lx[a] - lx[i], az = lz[a] - lz[i];
      const bx = lx[b] - lx[i], bz = lz[b] - lz[i];
      const cross = ax * bz - az * bx;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(lx[b] - lx[a], lz[b] - lz[a]);
      kl[i] = (2 * cross) / (la * lb * lc + 1e-9);
    }
    this.lineKappa = smoothCyclic(kl, 3, 2);
  }

  _speedProfile() {
    this.vmax = this.computeProfile(0.97, 0.92);
    this.vmaxPlayer = this.computeProfile(1.0, 0.97);
  }

  computeProfile(gripMul, brakeMul) {
    const { N, ds } = this;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = cornerSpeed(this.lineKappa[i], gripMul);
    for (let r = 0; r < 2; r++) {
      for (let k = 2 * N; k > 0; k--) {
        const i = k % N, j = (i + 1) % N;
        const lim = Math.sqrt(v[j] * v[j] + 2 * brakeDecel(v[j]) * brakeMul * ds);
        if (v[i] > lim) v[i] = lim;
      }
      for (let k = 0; k < 2 * N; k++) {
        const i = (k + 1) % N, j = k % N;
        const acc = engineAccel(v[j]) - dragDecel(v[j], false);
        const lim = Math.sqrt(Math.max(0, v[j] * v[j] + 2 * Math.max(acc, 0.1) * ds));
        if (v[i] > lim) v[i] = lim;
      }
    }
    return v;
  }

  // Proyecta (x,z) sobre el eje de la pista buscando cerca de 'hint'.
  project(x, z, hint = -1, out = {}) {
    const { N, px, pz } = this;
    let best = 0, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (bestD > 60 * 60) {
      for (let i = 0; i < N; i += 3) {
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      for (let k = -3; k <= 3; k++) {
        const i = (best + k + N) % N;
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const dx = x - px[best], dz = z - pz[best];
    out.idx = best;
    out.along = dx * this.tx[best] + dz * this.tz[best];
    out.lat = dx * this.nx[best] + dz * this.nz[best];
    out.s = best * this.ds + out.along;
    return out;
  }

  // Posición interpolada sobre el eje a una distancia s con desplazamiento lateral.
  pointAt(s, lat, out = {}) {
    const { N, ds } = this;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / ds;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const x = this.px[i] + (this.px[j] - this.px[i]) * t;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    out.x = x + nx * lat;
    out.z = z + nz * lat;
    out.heading = this.heading[i] + wrapAngle(this.heading[j] - this.heading[i]) * t;
    out.idx = i;
    return out;
  }

  lineAt(s) {
    const { N, ds } = this;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / ds;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    return this.line[i] + (this.line[j] - this.line[i]) * t;
  }

  vmaxAt(s) {
    const { N, ds } = this;
    s = ((s % this.length) + this.length) % this.length;
    const i = Math.floor(s / ds) % N;
    return this.vmax[i];
  }

  barrierAt(idx, side) {
    return side > 0 ? this.barrierL[idx] : this.barrierR[idx];
  }

  gravelAt(idx, side) {
    return side > 0 ? this.gravelL[idx] : this.gravelR[idx];
  }

  // Distancia mínima (y lado) al eje, búsqueda global gruesa + refinamiento.
  nearest(x, z, out = {}) {
    return this.project(x, z, -1, out);
  }
}
