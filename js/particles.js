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
    this.floor = new Float32Array(max);
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

  emit(x, y, z, vx, vy, vz, { r, g, b, size, grow = 0, life, alpha = 1, grav = 0, drag = 0, floor = 0 }) {
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
    this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = floor;
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
      const fl = this.floor[i] + 0.02;
      if (this.pos[k + 1] < fl && this.grav[i] > 0) { this.pos[k + 1] = fl; this.vel[k + 1] *= -0.3; }
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
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.floor[to] = this.floor[from];
  }
}

// Marcas de neumáticos sobre el asfalto (anillo de quads instanciados)
class SkidMarks {
  constructor(scene, max = 2400) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.max = max;
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.sc = new THREE.Vector3();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.col = new THREE.Color();
    this.mesh.setColorAt(0, this.col.setRGB(0, 0, 0));
    scene.add(this.mesh);
  }

  add(x0, y0, z0, x1, y1, z1, width, dark) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 4) return;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.min(this.max, Math.max(this.mesh.count, i + 1));
    this.e.set(Math.atan2(y0 - y1, len), Math.atan2(dx, dz), 0);
    this.q.setFromEuler(this.e);
    this.p.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.015, (z0 + z1) / 2);
    this.sc.set(width, 1, len + 0.05);
    this.m.compose(this.p, this.q, this.sc);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.col.setRGB(dark[0], dark[1], dark[2]));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.mesh.count = 0; this.next = 0; }
}

export class Particles {
  constructor(scene) {
    const dot = makeSoftDot();
    this.smoke = new Pool(800, THREE.NormalBlending, dot);
    this.sparks = new Pool(900, THREE.AdditiveBlending, dot);
    scene.add(this.smoke.points, this.sparks.points);
    this.skids = new SkidMarks(scene);
  }

  setScale(px) {
    this.smoke.material.uniforms.uScale.value = px;
    this.sparks.material.uniforms.uScale.value = px;
  }

  // Efectos por auto (llamado cada frame para autos cercanos a la cámara)
  carEffects(car, dt, wet = false) {
    const v = Math.abs(car.speed);
    const y0 = car.y || 0;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const sx = fz, sz = -fx;
    const rearX = car.x - fx * 1.75, rearZ = car.z - fz * 1.75;
    // bloqueo de rueda: frenada a fondo girando fuerte (solo el jugador, para no llenar la pista de humo)
    const lock = car.isPlayer && car.input.brake > 0.95 && v > 30 && Math.abs(car.input.steer) > 0.5 && car.surface === 0 ? 0.5 : 0;
    const smokeAmt = wet ? 0 : Math.min(1, car.slip * 0.18 + Math.max(0, car.understeer - 0.6) * 0.5 + lock);
    const onTarmac = car.surface <= 1 || car.surface === 4;
    if (smokeAmt > 0.3 && v > 4 && onTarmac) {
      const n = Math.random() < smokeAmt * dt * 60 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        for (const side of [-1, 1]) {
          this.smoke.emit(rearX + sx * side * 0.8, y0 + 0.25, rearZ + sz * side * 0.8,
            car.vx * 0.25 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, car.vz * 0.25 + (Math.random() - 0.5),
            { r: 0.82, g: 0.82, b: 0.84, size: 0.8, grow: 2.8, life: 1.2 + Math.random() * 0.8, alpha: 0.28 * smokeAmt, drag: 1.4 });
        }
      }
    }
    // spray de agua en pista mojada
    if (wet && v > 12 && onTarmac) {
      const n = Math.random() < Math.min(1, v / 60) * dt * 30 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.smoke.emit(rearX + sx * side * 0.75, y0 + 0.35, rearZ + sz * side * 0.75,
          car.vx * 0.45 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, car.vz * 0.45 + (Math.random() - 0.5) * 2,
          { r: 0.86, g: 0.88, b: 0.9, size: 0.9, grow: 3.2, life: 0.6 + Math.random() * 0.5, alpha: 0.09 * Math.min(1, v / 60), drag: 2.2 });
      }
    }
    // polvo en pasto o grava
    if ((car.surface === 2 || car.surface === 3) && v > 4) {
      const gravel = car.surface === 3;
      const n = Math.min(4, Math.ceil(v / 15));
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.smoke.emit(rearX + sx * side * 0.8, y0 + 0.2, rearZ + sz * side * 0.8,
          car.vx * 0.2 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, car.vz * 0.2 + (Math.random() - 0.5) * 3,
          gravel
            ? { r: 0.72, g: 0.64, b: 0.5, size: 0.8, grow: 3, life: 1.4, alpha: 0.5, drag: 1.2 }
            : { r: 0.45, g: 0.42, b: 0.3, size: 0.7, grow: 2.4, life: 1.0, alpha: 0.35, drag: 1.5 });
      }
    }
    // chispas del fondo plano a alta velocidad
    if (!wet && v > 72 && car.surface === 0 && Math.random() < (v - 72) * 0.03 * dt * 60) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const side = (Math.random() - 0.5) * 0.9;
        this.sparks.emit(car.x - fx * 1.9 + sx * side, y0 + 0.06, car.z - fz * 1.9 + sz * side,
          car.vx * 0.55 + (Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.2, car.vz * 0.55 + (Math.random() - 0.5) * 4,
          { r: 4.0, g: 1.9, b: 0.5, size: 0.045, life: 0.12 + Math.random() * 0.2, grav: 9, drag: 0.8, floor: y0 });
      }
    }
    // marcas de neumáticos
    const marking = (onTarmac && !wet && (car.slip > 2.2 || lock > 0)) || ((car.surface === 2 || car.surface === 3) && v > 3);
    const prev = car._skid;
    const cur = [rearX + sx * 0.78, y0, rearZ + sz * 0.78, rearX - sx * 0.78, y0, rearZ - sz * 0.78];
    if (marking && prev) {
      const dark = car.surface === 2 ? [0.25, 0.2, 0.12] : car.surface === 3 ? [0.5, 0.42, 0.3] : [0.05, 0.05, 0.05];
      this.skids.add(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2], 0.34, dark);
      this.skids.add(prev[3], prev[4], prev[5], cur[3], cur[4], cur[5], 0.34, dark);
    }
    car._skid = marking ? cur : null;
  }

  burst(x, y, z, vx, vz, strength) {
    const n = Math.min(60, 10 + strength * 3);
    for (let k = 0; k < n; k++) {
      this.sparks.emit(x, y + 0.4 + Math.random() * 0.4, z,
        vx * 0.4 + (Math.random() - 0.5) * 10, 1 + Math.random() * 4, vz * 0.4 + (Math.random() - 0.5) * 10,
        { r: 4.0, g: 1.9, b: 0.5, size: 0.06, life: 0.25 + Math.random() * 0.35, grav: 9, drag: 1.0, floor: y });
    }
    for (let k = 0; k < 6; k++) {
      this.smoke.emit(x, y + 0.5, z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2,
        { r: 0.6, g: 0.6, b: 0.62, size: 1.2, grow: 3, life: 1.2, alpha: 0.35, drag: 1.2 });
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.smoke.count = 0; this.sparks.count = 0;
    this.skids.clear();
  }
}
