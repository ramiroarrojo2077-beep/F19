// Sistema de partículas en GPU (humo de neumáticos, polvo y chispas).
import * as THREE from 'three';
import { makeSoftDot } from './textures.js';

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 pcolor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vAlpha = alpha;
    vColor = pcolor;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float a = texture2D(map, gl_PointCoord).a * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

class Pool {
  constructor(max, blending, map) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 400 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(x, y, z, vx, vy, vz, { r, g, b, size, grow = 0, life, alpha = 1, grav = 0, drag = 0 }) {
    let i = this.count;
    if (i >= this.max) {
      // reemplazar la partícula más vieja aproximada
      i = Math.floor(Math.random() * this.max);
    } else this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.grow[i] = grow;
    this.life[i] = life; this.maxLife[i] = life;
    this.a0[i] = alpha; this.alpha[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this._copy(n, i);
        i--;
        continue;
      }
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02 && this.grav[i] > 0) { this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.3; }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 1.6);
    }
    this.count = n;
    this.points.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }

  _copy(from, to) {
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c];
      this.vel[to * 3 + c] = this.vel[from * 3 + c];
      this.col[to * 3 + c] = this.col[from * 3 + c];
    }
    this.size[to] = this.size[from]; this.grow[to] = this.grow[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.a0[to] = this.a0[from]; this.alpha[to] = this.alpha[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }
}

export class Particles {
  constructor(scene) {
    const dot = makeSoftDot();
    this.smoke = new Pool(800, THREE.NormalBlending, dot);
    this.sparks = new Pool(900, THREE.AdditiveBlending, dot);
    scene.add(this.smoke.points, this.sparks.points);
  }

  setScale(px) {
    this.smoke.material.uniforms.uScale.value = px;
    this.sparks.material.uniforms.uScale.value = px;
  }

  // Efectos por auto (llamado cada frame para autos cercanos a la cámara)
  carEffects(car, dt) {
    const v = Math.abs(car.speed);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const sx = fz, sz = -fx;
    const rearX = car.x - fx * 1.75, rearZ = car.z - fz * 1.75;
    // humo por deslizamiento o bloqueo
    // bloqueo de rueda: frenada a fondo girando fuerte (solo el jugador, para no llenar la pista de humo)
    const lock = car.isPlayer && car.input.brake > 0.95 && v > 30 && Math.abs(car.input.steer) > 0.5 && car.surface === 0 ? 0.5 : 0;
    const smokeAmt = Math.min(1, car.slip * 0.18 + Math.max(0, car.understeer - 0.6) * 0.5 + lock);
    if (smokeAmt > 0.3 && v > 4 && car.surface <= 1) {
      const n = Math.random() < smokeAmt * dt * 60 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        for (const side of [-1, 1]) {
          this.smoke.emit(rearX + sx * side * 0.8, 0.25, rearZ + sz * side * 0.8,
            car.vx * 0.25 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, car.vz * 0.25 + (Math.random() - 0.5),
            { r: 0.82, g: 0.82, b: 0.84, size: 0.8, grow: 2.8, life: 1.2 + Math.random() * 0.8, alpha: 0.28 * smokeAmt, drag: 1.4 });
        }
      }
    }
    // polvo en pasto o grava
    if ((car.surface === 2 || car.surface === 3) && v > 4) {
      const gravel = car.surface === 3;
      const n = Math.min(4, Math.ceil(v / 15));
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.smoke.emit(rearX + sx * side * 0.8, 0.2, rearZ + sz * side * 0.8,
          car.vx * 0.2 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, car.vz * 0.2 + (Math.random() - 0.5) * 3,
          gravel
            ? { r: 0.72, g: 0.64, b: 0.5, size: 0.8, grow: 3, life: 1.4, alpha: 0.5, drag: 1.2 }
            : { r: 0.45, g: 0.42, b: 0.3, size: 0.7, grow: 2.4, life: 1.0, alpha: 0.35, drag: 1.5 });
      }
    }
    // chispas del fondo plano a alta velocidad
    if (v > 72 && car.surface === 0 && Math.random() < (v - 72) * 0.03 * dt * 60) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const side = (Math.random() - 0.5) * 0.9;
        this.sparks.emit(car.x - fx * 1.9 + sx * side, 0.06, car.z - fz * 1.9 + sz * side,
          car.vx * 0.55 + (Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.2, car.vz * 0.55 + (Math.random() - 0.5) * 4,
          { r: 4.0, g: 1.9, b: 0.5, size: 0.045, life: 0.12 + Math.random() * 0.2, grav: 9, drag: 0.8 });
      }
    }
  }

  burst(x, z, vx, vz, strength) {
    const n = Math.min(60, 10 + strength * 3);
    for (let k = 0; k < n; k++) {
      this.sparks.emit(x, 0.4 + Math.random() * 0.4, z,
        vx * 0.4 + (Math.random() - 0.5) * 10, 1 + Math.random() * 4, vz * 0.4 + (Math.random() - 0.5) * 10,
        { r: 4.0, g: 1.9, b: 0.5, size: 0.06, life: 0.25 + Math.random() * 0.35, grav: 9, drag: 1.0 });
    }
    for (let k = 0; k < 6; k++) {
      this.smoke.emit(x, 0.5, z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2,
        { r: 0.6, g: 0.6, b: 0.62, size: 1.2, grow: 3, life: 1.2, alpha: 0.35, drag: 1.2 });
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.smoke.count = 0; this.sparks.count = 0;
  }
}
