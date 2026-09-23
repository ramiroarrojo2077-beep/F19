// Construcción visual del circuito y su entorno (con desniveles y ambientación por mapa).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TrackData, KERB_W } from './trackdata.js';
import { clamp, lerp, smoothstep, fbm, mulberry32 } from './utils.js';
import * as TX from './textures.js';
import { buildVegetation, buildBuildings, buildFloodlights, buildBoats } from './decor.js';

const GROUND_UV = 1 / 10;

const PALETTES = {
  grass: { a: 0x4f8a2e, b: 0x8d9a45, rock: 0x7d766b, snow: 0xf4f6fa, sand: 0xd8c48f },
  coast: { a: 0x4a7a2e, b: 0x7f8c45, rock: 0x7f7a72, snow: 0xf4f6fa, sand: 0xe6d3a3 },
  sand: { a: 0xd6b27a, b: 0xb98d58, rock: 0x8f6c50, snow: 0xd6b27a, sand: 0xe0c08a },
};

function pal(name) {
  const p = PALETTES[name] || PALETTES.grass;
  const o = {};
  for (const k of Object.keys(p)) o[k] = new THREE.Color(p[k]);
  return o;
}

export class Track extends TrackData {
  constructor(def) {
    super(def);
    this.group = new THREE.Group();
    this.lights = [];
    this.tvCams = [];
    this.animated = [];
    this.decor = def.decor || {};
    this.night = def.env === 'night';
    this.water = this.decor.water || null;
    this.runoffTarmac = this.decor.ground === 'sand';
    this.colors = pal(this.decor.ground);
    this._tireWalls();
  }

  // Zonas con muro de neumáticos (exterior de curvas rápidas)
  _tireWalls() {
    const N = this.N;
    this.tireL = new Uint8Array(N);
    this.tireR = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (this.gravelL[i] > 0.55) this.tireL[i] = 1;
      if (this.gravelR[i] > 0.55) this.tireR[i] = 1;
    }
  }

  // Distancia efectiva al muro (considera los neumáticos delante del muro)
  wallAt(idx, side) {
    const t = side > 0 ? this.tireL[idx] : this.tireR[idx];
    return this.barrierAt(idx, side) - (t ? 0.9 : 0);
  }

  isWater(x, z, margin = 0) {
    const w = this.water;
    if (!w) return false;
    return z < w.edge - margin;
  }

  build(quality) {
    this.quality = quality;
    this.rnd = mulberry32(1234);
    this._bounds();
    this._textures();
    this._road();
    this._kerbs();
    this._verge();
    this._barriers();
    this._markings();
    this._terrain();
    if (this.water) this._water();
    this._gantry();
    this._grandstands();
    this._pits();
    this._bridge();
    this._boards();
    this._scenery();
    this._tvCameras();
    // capa de reflejos: superficies grandes (no instancias ni partículas)
    this.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.layers.enable(2); });
    return this.group;
  }

  update(t) {
    if (this.crowdTime) this.crowdTime.value = t;
    for (const fn of this.animated) fn(t);
  }

  dispose() {
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
    });
    this.group.removeFromParent();
  }

  _bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  _textures() {
    this.tex = {
      asphalt: TX.makeAsphalt(),
      grass: TX.makeGrass(),
      gravel: TX.makeGravel(),
      kerb: TX.makeKerb(),
      ads: TX.makeAdBoards(),
      fence: TX.makeFence(),
      concrete: TX.makeConcrete(),
      windows: TX.makeWindows(),
      tires: TX.makeTireWall(),
    };
    const night = this.night;
    this.mats = {
      road: new THREE.MeshStandardMaterial({
        map: this.tex.asphalt.map, normalMap: this.tex.asphalt.normal,
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88, metalness: 0.0, vertexColors: true,
      }),
      grass: new THREE.MeshStandardMaterial({ map: this.tex.grass, roughness: 1, vertexColors: true }),
      gravel: new THREE.MeshStandardMaterial({
        map: this.tex.gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
      runoff: new THREE.MeshStandardMaterial({
        map: this.tex.asphalt.map, roughness: 0.92, color: 0xb9bcc2, vertexColors: false,
      }),
      stripes: new THREE.MeshStandardMaterial({
        map: TX.makeRunoffStripes(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
      kerb: new THREE.MeshStandardMaterial({ map: this.tex.kerb, roughness: 0.55 }),
      line: new THREE.MeshStandardMaterial({
        color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
      wall: new THREE.MeshStandardMaterial({ map: this.tex.ads, roughness: 0.55, side: THREE.DoubleSide,
        emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? this.tex.ads : null, emissiveIntensity: night ? 0.35 : 0 }),
      concrete: new THREE.MeshStandardMaterial({ map: this.tex.concrete, roughness: 0.9 }),
      fence: new THREE.MeshStandardMaterial({
        map: this.tex.fence, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45,
      }),
      tires: new THREE.MeshStandardMaterial({ map: this.tex.tires, roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.35 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 }),
    };
    this.tex.concrete.repeat.set(4, 1);
    this.dryRoad = { roughness: 0.88, color: this.mats.road.color.clone(), normalScale: 0.5 };
  }

  // Pista mojada: asfalto oscuro y brillante que refleja el cielo
  setWet(wet) {
    const r = this.mats.road;
    r.roughness = wet ? 0.28 : this.dryRoad.roughness;
    r.color.copy(this.dryRoad.color).multiplyScalar(wet ? 0.62 : 1);
    r.normalScale.setScalar(wet ? 0.25 : this.dryRoad.normalScale);
    r.envMapIntensity = wet ? 1.6 : 1;
    this.mats.kerb.roughness = wet ? 0.25 : 0.55;
    this.mats.runoff.roughness = wet ? 0.35 : 0.92;
    this.mats.line.roughness = wet ? 0.25 : 0.6;
  }

  // Tira genérica a lo largo de la pista. cols: [{off(i), y}] (y relativo a la altura del asfalto)
  _strip({ cols, uv, color, range, closed = true, flip = false }) {
    const { N } = this;
    const [i0, i1] = range || [0, N];
    const rows = closed && !range ? N + 1 : i1 - i0 + 1;
    const C = cols.length;
    const pos = new Float32Array(rows * C * 3);
    const uvs = new Float32Array(rows * C * 2);
    const colors = color ? new Float32Array(rows * C * 3) : null;
    for (let r = 0; r < rows; r++) {
      const i = (i0 + r) % N;
      const dist = (i0 + r) * this.ds;
      for (let c = 0; c < C; c++) {
        const off = cols[c].off(i);
        const x = this.px[i] + this.nx[i] * off;
        const z = this.pz[i] + this.nz[i] * off;
        const y = this.py[i] + (typeof cols[c].y === 'function' ? cols[c].y(i) : cols[c].y);
        const k = (r * C + c);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const [u, v] = uv(x, z, off, dist, c, y);
        uvs[k * 2] = u; uvs[k * 2 + 1] = v;
        if (colors) {
          const col = color(i, off, x, z, y);
          colors[k * 3] = col[0]; colors[k * 3 + 1] = col[1]; colors[k * 3 + 2] = col[2];
        }
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < C - 1; c++) {
        const a = r * C + c, b = a + 1, cc = a + C, d = cc + 1;
        if (flip) idx.push(a, b, cc, b, d, cc);
        else idx.push(a, cc, b, b, cc, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // Rangos contiguos donde flags[i] es verdadero
  _ranges(flags) {
    const N = this.N;
    const out = [];
    let start = -1;
    let first = 0;
    while (first < N && flags[first]) first++;
    if (first >= N) return [[0, N]];
    for (let k = 1; k <= N; k++) {
      const i = (first + k) % N;
      if (flags[i] && start < 0) start = first + k;
      if ((!flags[i] || k === N) && start >= 0) { out.push([start % N, (start % N) + (first + k - start)]); start = -1; }
    }
    return out;
  }

  _add(geo, mat, { cast = false, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.group.add(m);
    return m;
  }

  _road() {
    const hw = this.hw;
    const cols = [];
    const K = 14;
    for (let c = 0; c <= K; c++) {
      const o = -hw + (2 * hw * c) / K;
      cols.push({ off: () => o, y: 0 });
    }
    const T = 7;
    const rnd = mulberry32(3);
    const noise = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) noise[i] = rnd();
    const geo = this._strip({
      cols,
      uv: (x, z, off, dist) => [off / T, dist / T],
      color: (i, off) => {
        const d = (off - this.line[i]) / 1.7;
        const vPrev = this.vmax[(i + 6) % this.N];
        const braking = clamp((this.vmax[i] - vPrev) / 3, 0, 1);
        let k = 1 - 0.22 * Math.exp(-d * d) * (0.7 + 0.6 * braking) - 0.04 * noise[i];
        const edge = smoothstep(hw - 1.2, hw, Math.abs(off));
        k = k * (1 - 0.08 * edge);
        return [k, k, k];
      },
    });
    this._add(geo, this.mats.road);
  }

  _kerbs() {
    const { hw } = this;
    const geos = [];
    for (const [a, b] of this._ranges(this.kerb)) {
      for (const side of [1, -1]) {
        const offs = [hw, hw + 0.25, hw + KERB_W - 0.25, hw + KERB_W].map((o) => o * side);
        const ys = [0.005, 0.07, 0.07, 0.0];
        const cols = offs.map((o, c) => ({ off: () => o, y: ys[c] }));
        geos.push(this._strip({
          cols, range: [a, b], closed: false, flip: side < 0,
          uv: (x, z, off, dist, c) => [c / 3, dist / 3.2],
        }));
      }
    }
    if (geos.length) this._add(mergeGeometries(geos), this.mats.kerb);
  }

  groundColor(x, z, h = 0) {
    const C = this.colors;
    const n = fbm(x / 180, z / 180, 3);
    const n2 = fbm(x / 40 + 31, z / 40 - 7, 2);
    const dry = smoothstep(0.52, 0.8, n);
    const v = 0.85 + n2 * 0.3;
    let r = lerp(C.a.r, C.b.r, dry) * v;
    let g = lerp(C.a.g, C.b.g, dry) * v;
    let b = lerp(C.a.b, C.b.b, dry) * v;
    const rel = h - this.minY;
    const rock = smoothstep(40, 120, rel);
    r = lerp(r, C.rock.r, rock); g = lerp(g, C.rock.g, rock); b = lerp(b, C.rock.b, rock);
    const snow = smoothstep(180, 250, rel);
    r = lerp(r, C.snow.r, snow); g = lerp(g, C.snow.g, snow); b = lerp(b, C.snow.b, snow);
    if (this.water) {
      const beach = smoothstep(this.water.edge + 45, this.water.edge + 10, z);
      r = lerp(r, C.sand.r, beach); g = lerp(g, C.sand.g, beach); b = lerp(b, C.sand.b, beach);
    }
    return [r, g, b];
  }

  _verge() {
    const { hw } = this;
    for (const side of [1, -1]) {
      const bar = side > 0 ? this.barrierL : this.barrierR;
      const cols = [
        { off: () => side * hw, y: -0.005 },
        { off: (i) => side * (hw + (bar[i] - hw) * 0.35), y: -0.01 },
        { off: (i) => side * (bar[i] + 0.6), y: -0.01 },
      ];
      const gv = side > 0 ? this.gravelL : this.gravelR;
      if (this.runoffTarmac) {
        // Escapatoria asfaltada con franjas pintadas en las curvas
        const geo = this._strip({ cols, uv: (x, z) => [x / 7, z / 7], flip: side < 0 });
        this._add(geo, this.mats.runoff);
        const inner = hw + KERB_W;
        const flags = new Uint8Array(this.N);
        for (let i = 0; i < this.N; i++) flags[i] = this.kerb[i] || gv[i] > 0.3 ? 1 : 0;
        const geos = [];
        for (const [a, b] of this._ranges(flags)) {
          geos.push(this._strip({
            cols: [{ off: () => side * inner, y: 0.0 }, { off: () => side * (inner + 2.6), y: 0.0 }],
            range: [a, b], closed: false, flip: side < 0,
            uv: (x, z, off, dist, c) => [c, dist / 6],
          }));
        }
        if (geos.length) this._add(mergeGeometries(geos), this.mats.stripes);
      } else {
        const geo = this._strip({
          cols,
          uv: (x, z) => [x * GROUND_UV, z * GROUND_UV],
          color: (i, off, x, z, y) => this.groundColor(x, z, y),
          flip: side < 0,
        });
        this._add(geo, this.mats.grass);
        // Grava en el exterior de curvas rápidas
        const inner = hw + KERB_W + 1.2;
        const gcols = [
          { off: () => side * inner, y: 0.0 },
          { off: (i) => side * (inner + Math.max(0, bar[i] - 1.5 - inner) * gv[i]), y: 0.0 },
        ];
        this._add(this._strip({ cols: gcols, uv: (x, z) => [x / 6, z / 6], flip: side < 0 }), this.mats.gravel);
      }
    }
  }

  _barriers() {
    const posts = [];
    for (const side of [1, -1]) {
      const bar = side > 0 ? this.barrierL : this.barrierR;
      const wall = this._strip({
        cols: [{ off: (i) => side * bar[i], y: -0.3 }, { off: (i) => side * bar[i], y: 1.05 }],
        uv: (x, z, off, dist, c) => [(side > 0 ? dist : -dist) / 21, c === 0 ? -0.05 : 0.98],
      });
      this._add(wall, this.mats.wall, { cast: true });
      const cap = this._strip({
        cols: [{ off: (i) => side * bar[i], y: 1.05 }, { off: (i) => side * (bar[i] + 0.45), y: 1.05 },
          { off: (i) => side * (bar[i] + 0.45), y: -0.3 }],
        uv: (x, z, off, dist, c) => [dist / 8, c * 0.3],
        flip: side < 0,
      });
      this._add(cap, this.mats.concrete);
      if (this.quality.fences) {
        const fence = this._strip({
          cols: [{ off: (i) => side * (bar[i] + 0.3), y: 1.05 }, { off: (i) => side * (bar[i] + 0.3), y: 3.6 }],
          uv: (x, z, off, dist, c) => [dist / 1.6, c ? 2.55 / 1.6 : 0],
        });
        this._add(fence, this.mats.fence, { receive: false });
        for (let i = 0; i < this.N; i += 4) {
          const o = side * (bar[i] + 0.35);
          posts.push([this.px[i] + this.nx[i] * o, this.py[i], this.pz[i] + this.nz[i] * o]);
        }
      }
      // Muros de neumáticos delante del muro
      const tflags = side > 0 ? this.tireL : this.tireR;
      const geos = [];
      for (const [a, b] of this._ranges(tflags)) {
        if (b - a < 6) continue;
        geos.push(this._strip({
          cols: [
            { off: (i) => side * (bar[i] - 0.9), y: -0.1 },
            { off: (i) => side * (bar[i] - 0.9), y: 0.95 },
            { off: (i) => side * (bar[i] - 0.05), y: 0.95 },
          ],
          range: [a, b], closed: false, flip: side > 0,
          uv: (x, z, off, dist, c) => [(side > 0 ? dist : -dist) / 2.6, c === 0 ? 0 : c === 1 ? 0.95 : 1],
        }));
      }
      if (geos.length) {
        this.mats.tires.side = THREE.DoubleSide;
        this._add(mergeGeometries(geos), this.mats.tires, { cast: true });
      }
    }
    if (posts.length) {
      const pg = new THREE.BoxGeometry(0.09, 2.7, 0.09);
      pg.translate(0, 2.3, 0);
      const im = new THREE.InstancedMesh(pg, this.mats.metal, posts.length);
      const m = new THREE.Matrix4();
      posts.forEach(([x, y, z], k) => { m.makeTranslation(x, y, z); im.setMatrixAt(k, m); });
      this.group.add(im);
    }
  }

  _markings() {
    const { hw } = this;
    const geos = [];
    for (const side of [1, -1]) {
      const o1 = side * (hw - 0.12), o2 = side * (hw - 0.42);
      geos.push(this._strip({
        cols: [{ off: () => (side > 0 ? o2 : o1), y: 0 }, { off: () => (side > 0 ? o1 : o2), y: 0 }],
        uv: () => [0, 0],
      }));
    }
    // Marcas de parrilla
    for (let k = 0; k < 10; k++) {
      const s = this.length - (12 + 8 * k);
      const lat = k % 2 === 0 ? 3.2 : -3.2;
      const p = this.pointAt(s + 1.2, lat);
      const bar = new THREE.PlaneGeometry(2.4, 0.22);
      bar.rotateX(-Math.PI / 2);
      bar.rotateY(p.heading);
      bar.translate(p.x, p.y, p.z);
      geos.push(bar);
      for (const e of [-1.15, 1.15]) {
        const q = this.pointAt(s + 0.2, lat + e);
        const sd = new THREE.PlaneGeometry(0.18, 2.0);
        sd.rotateX(-Math.PI / 2);
        sd.rotateY(q.heading);
        sd.translate(q.x, q.y, q.z);
        geos.push(sd);
      }
    }
    const lines = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      g.deleteAttribute('uv'); if (g.attributes.color) g.deleteAttribute('color'); return g;
    })), this.mats.line);
    lines.receiveShadow = true;
    this.group.add(lines);

    const fin = new THREE.Mesh(
      new THREE.PlaneGeometry(this.hw * 2, 1.0),
      new THREE.MeshStandardMaterial({ map: TX.makeChecker(28, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    );
    const p0 = this.pointAt(0, 0);
    fin.position.set(p0.x, p0.y, p0.z);
    fin.rotation.set(-Math.PI / 2, this.heading[0], 0, 'YXZ');
    fin.receiveShadow = true;
    this.group.add(fin);
  }

  // Altura del terreno fuera de la pista.
  terrainHeight(x, z, proj) {
    const p = proj || this.project(x, z, -1, {});
    const side = p.lat >= 0 ? 1 : -1;
    const d = Math.abs(p.lat);
    const b = this.barrierAt(p.idx, side);
    const base = this.py[p.idx];
    if (d < b + 0.8) return base - 0.35;
    const e = d - b;
    const ground = this.decor.ground;
    let h;
    if (ground === 'sand') {
      const n = fbm(x / 160 + 3, z / 160 - 8, 4);
      const dunes = (1 - Math.abs(n * 2 - 1)) * 16 * smoothstep(40, 320, e);
      const mount = smoothstep(700, 1500, e) * (50 + fbm(x / 500, z / 500, 4) * 200);
      h = dunes + mount;
    } else {
      const amp = ground === 'coast' ? 75 : 55;
      const hills = (fbm(x / 420 + 5, z / 420 - 3, 4) - 0.35) * amp * smoothstep(40, 420, e);
      const mount = smoothstep(450, 1300, e) * (70 + fbm(x / 600 - 9, z / 600 + 2, 5) * 260);
      h = Math.max(hills, -2) + mount;
    }
    h += base * (1 - smoothstep(60, 520, e));
    if (this.water) {
      const sea = smoothstep(this.water.edge + 25, this.water.edge - 45, z);
      h = lerp(h, this.water.level - 9, sea);
    }
    return h;
  }

  _terrain() {
    const { minX, maxX, minZ, maxZ, cx, cz } = this.bounds;
    const pad = 1700;
    const size = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
    const S = this.quality.terrainRes;
    const geo = new THREE.PlaneGeometry(size, size, S, S);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const uv = geo.attributes.uv;
    const proj = {};
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      this.project(x, z, -1, proj);
      const h = this.terrainHeight(x, z, proj);
      pos.setY(k, h);
      const c = this.groundColor(x, z, h);
      colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2];
      uv.setXY(k, x * GROUND_UV, z * GROUND_UV);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this._add(geo, this.mats.grass);
  }

  _water() {
    const w = this.water;
    const { minX, maxX } = this.bounds;
    const normal = TX.makeWaterNormal();
    normal.repeat.set(60, 30);
    const normal2 = normal.clone();
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0d4a63, roughness: 0.06, metalness: 0.0, normalMap: normal,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3, clearcoat: 0.6, clearcoatRoughness: 0.1,
      clearcoatNormalMap: normal2, clearcoatNormalScale: new THREE.Vector2(0.2, 0.2),
    });
    const geo = new THREE.PlaneGeometry(maxX - minX + 7000, 3500);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((minX + maxX) / 2, w.level, w.edge + 30 - 1750);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.animated.push((t) => {
      normal.offset.set(t * 0.004, t * 0.006);
      normal2.offset.set(-t * 0.003, t * 0.0045);
    });
    const boats = buildBoats(this, w, this.rnd);
    this.group.add(boats);
  }

  // Pórtico de salida con semáforo
  _gantry() {
    const p = this.pointAt(1.5, 0);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    const span = this.hw + 3.2;
    const m = this.mats.darkMetal;
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.2, 0.7), m);
      pil.position.set(s * span, 4.1, 0);
      pil.castShadow = true;
      g.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 0.9, 0.9), m);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = true;
    g.add(beam);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.5 }));
    panel.position.set(0, 6.3, -0.5);
    g.add(panel);
    const signBox = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 1.4, 0.3), m);
    signBox.position.set(0, 8.75, 0);
    g.add(signBox);
    const bannerTex = TX.makeBanner(`${this.def.name.toUpperCase()} GP`);
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.5, emissive: this.night ? 0xffffff : 0, emissiveMap: this.night ? bannerTex : null, emissiveIntensity: 0.6 });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 1.4), bannerMat);
    banner.position.set(0, 8.75, -0.16);
    banner.rotation.y = Math.PI;
    g.add(banner);
    const banner2 = banner.clone();
    banner2.position.z = 0.16; banner2.rotation.y = 0;
    g.add(banner2);
    const lampGeo = new THREE.SphereGeometry(0.28, 16, 12);
    for (let c = 0; c < 5; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a0a, emissiveIntensity: 0, roughness: 0.3 });
      for (const r of [0, 1]) {
        const lamp = new THREE.Mesh(lampGeo, mat);
        lamp.position.set(-2.4 + c * 1.2, 6.75 - r * 0.8, -0.8);
        g.add(lamp);
      }
      this.lights.push(mat);
    }
    this.group.add(g);
  }

  setStartLights(n) {
    this.lights.forEach((m, k) => {
      m.emissiveIntensity = k < n ? 6 : 0;
      m.color.setHex(k < n ? 0xff2200 : 0x220000);
    });
  }

  _sideFrame(s, side) {
    const p = this.pointAt(s, 0);
    const i = p.idx;
    return { x: p.x, y: p.y, z: p.z, nx: this.nx[i] * side, nz: this.nz[i] * side, heading: p.heading, idx: i };
  }

  _grandstands() {
    const out = -this.insideSign;
    const crowdColors = [0xe10600, 0xffffff, 0xffd400, 0x1b3a8c, 0xff7a00, 0x00a19c, 0x333333, 0xc8102e, 0x6ec1ff];
    const standGeo = [];
    const crowd = [];
    const rnd = mulberry32(99);
    const standS = [-150, -60, 30, 120];
    const density = this.quality.crowd ?? 0.88;
    for (const s of standS) {
      const f = this._sideFrame(s, out);
      const bar = this.barrierAt(f.idx, out);
      const len = 80, rows = 14;
      const g = new THREE.Object3D();
      const d0 = bar + 5;
      g.position.set(f.x + f.nx * d0, f.y, f.z + f.nz * d0);
      g.rotation.y = Math.atan2(f.nx, f.nz) - Math.PI / 2;
      g.updateMatrixWorld();
      for (let r = 0; r < rows; r++) {
        const box = new THREE.BoxGeometry(1.4, 0.75 * (r + 1), len);
        box.translate(r * 1.4 + 0.7, (0.75 * (r + 1)) / 2, 0);
        box.applyMatrix4(g.matrixWorld);
        standGeo.push(box);
        for (let k = 0; k < len / 0.62; k++) {
          if (rnd() > density) continue;
          const lp = new THREE.Vector3(r * 1.4 + 0.55, 0.75 * (r + 1) + 0.42, -len / 2 + 0.4 + k * 0.62);
          lp.applyMatrix4(g.matrixWorld);
          crowd.push([lp, crowdColors[Math.floor(rnd() * crowdColors.length)], rnd()]);
        }
      }
      const roof = new THREE.BoxGeometry(rows * 1.4 + 3, 0.35, len + 2);
      roof.translate(rows * 1.4 / 2 + 0.2, 0.75 * rows + 4.8, 0);
      roof.applyMatrix4(g.matrixWorld);
      standGeo.push(roof);
      const back = new THREE.BoxGeometry(0.4, 0.75 * rows + 5, len);
      back.translate(rows * 1.4 + 0.2, (0.75 * rows + 5) / 2, 0);
      back.applyMatrix4(g.matrixWorld);
      standGeo.push(back);
      for (let k = -2; k <= 2; k++) {
        const col = new THREE.BoxGeometry(0.35, 0.75 * rows + 5, 0.35);
        col.translate(0.3, (0.75 * rows + 5) / 2, k * len / 4.2);
        col.applyMatrix4(g.matrixWorld);
        standGeo.push(col);
      }
    }
    const stands = new THREE.Mesh(mergeGeometries(standGeo), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, map: this.tex.concrete, roughness: 0.85 }));
    stands.castShadow = true; stands.receiveShadow = true;
    this.group.add(stands);

    const body = new THREE.BoxGeometry(0.42, 0.75, 0.36);
    const head = new THREE.BoxGeometry(0.22, 0.24, 0.22);
    head.translate(0, 0.52, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.crowdTime = { value: 0 };
    if (this.quality.animCrowd) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.crowdTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float fid = float(gl_InstanceID);
          float fan = step(0.55, fract(fid * 0.6180339));
          transformed.y += max(0.0, sin(uTime * 8.0 + fid * 1.7)) * 0.16 * fan;`);
      };
    }
    const im = new THREE.InstancedMesh(mergeGeometries([body, head]), mat, crowd.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    crowd.forEach(([p, c, r], k) => {
      m.makeRotationY(this.heading[0] + (r - 0.5) * 0.6);
      m.setPosition(p.x, p.y, p.z);
      im.setMatrixAt(k, m);
      im.setColorAt(k, col.setHex(c).multiplyScalar(0.6 + r * 0.5));
    });
    this.group.add(im);
  }

  _pits() {
    const ins = this.insideSign;
    const f = this._sideFrame(40, ins);
    const bar = this.barrierAt(f.idx, ins);
    const g = new THREE.Group();
    const d0 = bar + 14;
    g.position.set(f.x + f.nx * d0, f.y, f.z + f.nz * d0);
    g.rotation.y = Math.atan2(f.nx, f.nz) - Math.PI / 2;
    const len = 300;
    const laneTex = this.tex.asphalt.map.clone();
    laneTex.repeat.set(2, 50);
    laneTex.needsUpdate = true;
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(14, len + 60),
      new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.9, color: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(-7, 0.02, 0);
    lane.receiveShadow = true;
    g.add(lane);
    const bld = new THREE.Mesh(new THREE.BoxGeometry(16, 7, len), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.7, map: this.tex.concrete }));
    bld.position.set(8, 3.5, 0);
    bld.castShadow = true; bld.receiveShadow = true;
    g.add(bld);
    const winTex = this.tex.windows;
    winTex.repeat.set(len / 20, 1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(14, 4, len - 6), new THREE.MeshStandardMaterial({
      map: winTex, metalness: 0.7, roughness: 0.15,
      emissive: this.night ? 0xffe6c0 : 0x000000, emissiveMap: this.night ? winTex : null, emissiveIntensity: this.night ? 0.8 : 0,
    }));
    glass.position.set(9, 9, 0);
    glass.castShadow = true;
    g.add(glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, len + 4), this.mats.darkMetal);
    roof.position.set(7, 11.2, 0);
    roof.castShadow = true;
    g.add(roof);
    const teamCols = [0xc8102e, 0xb9c2c9, 0xff7a00, 0x0b6e4f, 0x1a2b8f];
    const doorGeo = new THREE.PlaneGeometry(10, 5);
    const doorMat = new THREE.MeshStandardMaterial({ color: this.night ? 0x2a2a2a : 0x050607, roughness: 0.9,
      emissive: this.night ? 0xfff0dd : 0, emissiveIntensity: this.night ? 0.25 : 0 });
    for (let k = 0; k < 10; k++) {
      const z = -len / 2 + 20 + k * ((len - 40) / 9);
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.rotation.y = -Math.PI / 2;
      door.position.set(-0.02, 2.5, z);
      g.add(door);
      const tc = teamCols[Math.floor(k / 2)];
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.2), new THREE.MeshStandardMaterial({ color: tc, roughness: 0.4, emissive: tc, emissiveIntensity: this.night ? 0.8 : 0.15 }));
      sign.rotation.y = -Math.PI / 2;
      sign.position.set(-0.03, 5.9, z);
      g.add(sign);
    }
    this.group.add(g);
  }

  _bridge() {
    const { N } = this;
    let best = -1, bestV = 0;
    for (let i = Math.floor(N * 0.3); i < N * 0.85; i += 5) {
      let m = Infinity;
      for (let k = -25; k <= 25; k++) m = Math.min(m, this.vmax[(i + k + N) % N]);
      if (m > bestV) { bestV = m; best = i; }
    }
    const p = this.pointAt(best * this.ds, 0);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    const bl = this.barrierL[best] + 2, br = this.barrierR[best] + 2;
    const w = bl + br;
    const mat = new THREE.MeshStandardMaterial({ color: this.night ? 0x2b2f36 : 0xe8eaed, roughness: 0.6, metalness: this.night ? 0.5 : 0 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 4, 1.2, 3.5), mat);
    deck.position.set((bl - br) / 2, 8, 0);
    deck.castShadow = true;
    g.add(deck);
    for (const x of [bl, -br]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 9.2, 4), mat);
      tower.position.set(x, 4.6, 0);
      tower.castShadow = true;
      g.add(tower);
    }
    let banMat;
    if (this.night) {
      const led = TX.makeLedPanel();
      banMat = new THREE.MeshStandardMaterial({ map: led, emissive: 0xffffff, emissiveMap: led, emissiveIntensity: 2.2, roughness: 0.4 });
      this.animated.push((t) => { led.offset.x = t * 0.08; });
    } else {
      const banTex = TX.makeBanner('APEX TYRES · F19', '#ffd400', '#111');
      banMat = new THREE.MeshStandardMaterial({ map: banTex, roughness: 0.5 });
    }
    for (const z of [-1.8, 1.8]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.6), banMat);
      ban.position.set((bl - br) / 2, 8, z);
      ban.rotation.y = z < 0 ? Math.PI : 0;
      g.add(ban);
    }
    this.group.add(g);
  }

  _boards() {
    const { N } = this;
    const texs = ['3', '2', '1'].map((t) => TX.makeBoard(t));
    const mats = texs.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.5, emissive: this.night ? 0xffffff : 0, emissiveMap: this.night ? map : null, emissiveIntensity: 0.5 }));
    const boardGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const postGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    let last = -1000;
    for (let i = 0; i < N; i++) {
      const a = this.vmax[i];
      if (a < 70 || this.vmax[(i + 1) % N] >= a || this.vmax[(i - 1 + N) % N] > a) continue;
      if (this.vmax[(i + 60) % N] > a - 22 || i - last < 100) continue;
      last = i;
      let k = 0;
      for (let d = 0; d < 90; d++) k += this.kappa[(i + d) % N];
      const side = k > 0 ? -1 : 1;
      [-10, 40, 90].forEach((fwd, n) => {
        const p = this.pointAt(i * this.ds + fwd, side * (this.hw + KERB_W + 2.2));
        const board = new THREE.Mesh(boardGeo, mats[n]);
        board.position.set(p.x, p.y + 1.4, p.z);
        board.rotation.y = p.heading + Math.PI;
        this.group.add(board);
        const post = new THREE.Mesh(postGeo, this.mats.metal);
        post.position.set(p.x, p.y + 0.45, p.z);
        this.group.add(post);
      });
    }
  }

  _scenery() {
    const d = this.decor;
    this.group.add(buildVegetation(this, d.trees || 'forest', this.quality.trees, this.rnd));
    if (d.buildings) this.group.add(buildBuildings(this, d.buildings, this.rnd, this.night));
    if (this.night) this.group.add(buildFloodlights(this));
  }

  _tvCameras() {
    const { N } = this;
    const step = 90;
    for (let i = 0, n = 0; i < N; i += step, n++) {
      let k = 0;
      for (let d = -10; d <= 10; d++) k += this.kappa[(i + d + N) % N];
      const side = k > 0 ? -1 : 1;
      const b = this.barrierAt(i, side);
      const off = side * (b + 1.5);
      this.tvCams.push({
        s: i * this.ds,
        pos: new THREE.Vector3(this.px[i] + this.nx[i] * off, this.py[i] + 4 + (n % 3) * 2.5, this.pz[i] + this.nz[i] * off),
      });
    }
  }
}
