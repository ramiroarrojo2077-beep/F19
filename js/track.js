// Construcción visual del circuito y su entorno.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TrackData, HALF_WIDTH, KERB_W } from './trackdata.js';
import { clamp, lerp, smoothstep, fbm, mulberry32 } from './utils.js';
import * as TX from './textures.js';

const GROUND_UV = 1 / 10;
const GROUND_COLORS = {
  grass: new THREE.Color(0x4f8a2e),
  dry: new THREE.Color(0x8d9a45),
  rock: new THREE.Color(0x7d766b),
  snow: new THREE.Color(0xf4f6fa),
};

export class Track extends TrackData {
  constructor() {
    super();
    this.group = new THREE.Group();
    this.lights = [];
    this.tvCams = [];
  }

  build(scene, quality) {
    this.quality = quality;
    const g = this.group;
    this._textures();
    this._road();
    this._kerbs();
    this._verge();
    this._barriers();
    this._markings();
    this._terrain();
    this._gantry();
    this._grandstands();
    this._pits();
    this._bridge();
    this._boards();
    this._trees();
    this._tvCameras();
    scene.add(g);
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
    };
    this.mats = {
      road: new THREE.MeshStandardMaterial({
        map: this.tex.asphalt.map, normalMap: this.tex.asphalt.normal,
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88, metalness: 0.0, vertexColors: true,
      }),
      grass: new THREE.MeshStandardMaterial({ map: this.tex.grass, roughness: 1, vertexColors: true }),
      gravel: new THREE.MeshStandardMaterial({
        map: this.tex.gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
      kerb: new THREE.MeshStandardMaterial({ map: this.tex.kerb, roughness: 0.55 }),
      line: new THREE.MeshStandardMaterial({
        color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
      wall: new THREE.MeshStandardMaterial({ map: this.tex.ads, roughness: 0.55, side: THREE.DoubleSide }),
      concrete: new THREE.MeshStandardMaterial({ map: this.tex.concrete, roughness: 0.9 }),
      fence: new THREE.MeshStandardMaterial({
        map: this.tex.fence, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45,
      }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.35 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 }),
    };
    this.tex.concrete.repeat.set(4, 1);
  }

  // Tira genérica a lo largo de la pista. cols: [{off(i), y(i)}], uv: función.
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
        const y = typeof cols[c].y === 'function' ? cols[c].y(i) : cols[c].y;
        const k = (r * C + c);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const [u, v] = uv(x, z, off, dist, c, y);
        uvs[k * 2] = u; uvs[k * 2 + 1] = v;
        if (colors) {
          const col = color(i, off, x, z);
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
    const mesh = new THREE.Mesh(geo, this.mats.road);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _kerbs() {
    const { N, hw } = this;
    const geos = [];
    // segmentos contiguos con piano
    let i = 0;
    const visited = new Uint8Array(N);
    while (i < N) {
      if (this.kerb[i] && !visited[i]) {
        let start = i;
        while (this.kerb[(start - 1 + N) % N] && start > i - N) start--;
        let end = i;
        while (this.kerb[(end + 1) % N] && end - start < N) end++;
        for (let k = start; k <= end; k++) visited[(k + N) % N] = 1;
        const s0 = (start + N) % N;
        const len = end - start;
        for (const side of [1, -1]) {
          const offs = [hw, hw + 0.25, hw + KERB_W - 0.25, hw + KERB_W].map((o) => o * side);
          const ys = [0.005, 0.07, 0.07, 0.0];
          const cols = offs.map((o, c) => ({ off: () => o, y: ys[c] }));
          geos.push(this._strip({
            cols, range: [s0, s0 + len], closed: false, flip: side < 0,
            uv: (x, z, off, dist, c) => [c / 3, dist / 3.2],
          }));
        }
        i = end + 1;
      } else i++;
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), this.mats.kerb);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  groundColor(x, z, h = 0) {
    const n = fbm(x / 180, z / 180, 3);
    const n2 = fbm(x / 40 + 31, z / 40 - 7, 2);
    const dry = smoothstep(0.52, 0.8, n);
    const v = 0.85 + n2 * 0.3;
    const C = GROUND_COLORS;
    let r = lerp(C.grass.r, C.dry.r, dry) * v;
    let g = lerp(C.grass.g, C.dry.g, dry) * v;
    let b = lerp(C.grass.b, C.dry.b, dry) * v;
    const rock = smoothstep(30, 110, h);
    r = lerp(r, C.rock.r, rock); g = lerp(g, C.rock.g, rock); b = lerp(b, C.rock.b, rock);
    const snow = smoothstep(170, 240, h);
    return [lerp(r, C.snow.r, snow), lerp(g, C.snow.g, snow), lerp(b, C.snow.b, snow)];
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
      const geo = this._strip({
        cols,
        uv: (x, z) => [x * GROUND_UV, z * GROUND_UV],
        color: (i, off, x, z) => this.groundColor(x, z),
        flip: side < 0,
      });
      const mesh = new THREE.Mesh(geo, this.mats.grass);
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Grava en el exterior de curvas rápidas
      const gv = side > 0 ? this.gravelL : this.gravelR;
      const inner = hw + KERB_W + 1.2;
      const gcols = [
        { off: () => side * inner, y: 0.0 },
        { off: (i) => side * (inner + Math.max(0, bar[i] - 1.5 - inner) * gv[i]), y: 0.0 },
      ];
      const ggeo = this._strip({ cols: gcols, uv: (x, z) => [x / 6, z / 6], flip: side < 0 });
      const gm = new THREE.Mesh(ggeo, this.mats.gravel);
      gm.receiveShadow = true;
      this.group.add(gm);
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
      const wm = new THREE.Mesh(wall, this.mats.wall);
      wm.castShadow = true; wm.receiveShadow = true;
      this.group.add(wm);
      const cap = this._strip({
        cols: [{ off: (i) => side * bar[i], y: 1.05 }, { off: (i) => side * (bar[i] + 0.45), y: 1.05 },
               { off: (i) => side * (bar[i] + 0.45), y: -0.3 }],
        uv: (x, z, off, dist, c) => [dist / 8, c * 0.3],
        flip: side < 0,
      });
      const cm = new THREE.Mesh(cap, this.mats.concrete);
      cm.receiveShadow = true;
      this.group.add(cm);
      if (this.quality.fences) {
        const fence = this._strip({
          cols: [{ off: (i) => side * (bar[i] + 0.3), y: 1.05 }, { off: (i) => side * (bar[i] + 0.3), y: 3.6 }],
          uv: (x, z, off, dist, c) => [dist / 1.6, c ? 2.55 / 1.6 : 0],
        });
        this.group.add(new THREE.Mesh(fence, this.mats.fence));
        for (let i = 0; i < this.N; i += 4) {
          const o = side * (bar[i] + 0.35);
          posts.push([this.px[i] + this.nx[i] * o, this.pz[i] + this.nz[i] * o]);
        }
      }
    }
    if (posts.length) {
      const pg = new THREE.BoxGeometry(0.09, 2.7, 0.09);
      pg.translate(0, 2.3, 0);
      const im = new THREE.InstancedMesh(pg, this.mats.metal, posts.length);
      const m = new THREE.Matrix4();
      posts.forEach(([x, z], k) => { m.makeTranslation(x, 0, z); im.setMatrixAt(k, m); });
      im.castShadow = false;
      this.group.add(im);
    }
  }

  _markings() {
    const { hw } = this;
    // Líneas blancas de borde
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
      bar.translate(p.x, 0, p.z);
      geos.push(bar);
      for (const e of [-1.15, 1.15]) {
        const q = this.pointAt(s + 0.2, lat + e);
        const side = new THREE.PlaneGeometry(0.18, 2.0);
        side.rotateX(-Math.PI / 2);
        side.rotateY(q.heading);
        side.translate(q.x, 0, q.z);
        geos.push(side);
      }
    }
    const lines = new THREE.Mesh(mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g).map((g) => {
      g.deleteAttribute('uv'); if (g.attributes.color) g.deleteAttribute('color'); return g;
    })), this.mats.line);
    lines.receiveShadow = true;
    this.group.add(lines);

    // Línea de meta a cuadros
    const checker = TX.makeChecker(28, 2);
    const fin = new THREE.Mesh(
      new THREE.PlaneGeometry(this.hw * 2, 1.0),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    );
    const p0 = this.pointAt(0, 0);
    fin.position.set(p0.x, 0, p0.z);
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
    if (d < b + 0.8) return -0.35;
    const e = d - b;
    const hills = (fbm(x / 420 + 5, z / 420 - 3, 4) - 0.35) * 55 * smoothstep(40, 420, e);
    const mount = smoothstep(450, 1300, e) * (70 + fbm(x / 600 - 9, z / 600 + 2, 5) * 260);
    return Math.max(hills, -2) + mount;
  }

  _terrain() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    const pad = 1700;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
    this.bounds = { minX, maxX, minZ, maxZ, cx, cz };
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
    const mesh = new THREE.Mesh(geo, this.mats.grass);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // Pórtico de salida con semáforo
  _gantry() {
    const p = this.pointAt(1.5, 0);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
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
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 1.4), new THREE.MeshStandardMaterial({ map: TX.makeBanner('F19 GRAND PRIX'), roughness: 0.5 }));
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
    return { x: p.x, z: p.z, nx: this.nx[i] * side, nz: this.nz[i] * side, tx: this.tx[i], tz: this.tz[i], heading: p.heading, idx: i };
  }

  _grandstands() {
    const out = -this.insideSign;
    const crowdColors = [0xe10600, 0xffffff, 0xffd400, 0x1b3a8c, 0xff7a00, 0x00a19c, 0x333333, 0xc8102e, 0x6ec1ff];
    const standGeo = [];
    const crowd = [];
    const rnd = mulberry32(99);
    const standS = [-150, -60, 30, 120];
    for (const s of standS) {
      const f = this._sideFrame(s, out);
      const bar = this.barrierAt(f.idx, out);
      const len = 80, rows = 14;
      const g = new THREE.Group();
      const d0 = bar + 5;
      g.position.set(f.x + f.nx * d0, 0, f.z + f.nz * d0);
      // eje local x hacia afuera de la pista
      g.rotation.y = Math.atan2(f.nx, f.nz) - Math.PI / 2;
      g.updateMatrixWorld();
      for (let r = 0; r < rows; r++) {
        const box = new THREE.BoxGeometry(1.4, 0.75 * (r + 1), len);
        box.translate(r * 1.4 + 0.7, (0.75 * (r + 1)) / 2, 0);
        box.applyMatrix4(g.matrixWorld);
        standGeo.push(box);
        for (let k = 0; k < len / 0.62; k++) {
          if (rnd() < 0.12) continue;
          const lp = new THREE.Vector3(r * 1.4 + 0.55, 0.75 * (r + 1) + 0.42, -len / 2 + 0.4 + k * 0.62);
          lp.applyMatrix4(g.matrixWorld);
          crowd.push([lp, crowdColors[Math.floor(rnd() * crowdColors.length)], rnd()]);
        }
      }
      // techo y columnas
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
    // saltos del público animados en GPU
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
    this.crowd = im;
    this.group.add(im);
  }

  animateCrowd(t) {
    if (this.crowdTime) this.crowdTime.value = t;
  }

  _pits() {
    const ins = this.insideSign;
    const f = this._sideFrame(40, ins);
    const bar = this.barrierAt(f.idx, ins);
    const g = new THREE.Group();
    const d0 = bar + 14;
    g.position.set(f.x + f.nx * d0, 0, f.z + f.nz * d0);
    g.rotation.y = Math.atan2(f.nx, f.nz) - Math.PI / 2;
    const len = 300;
    // calle de boxes
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(14, len + 60),
      new THREE.MeshStandardMaterial({ map: this.tex.asphalt.map, roughness: 0.9, color: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    lane.material.map = this.tex.asphalt.map.clone();
    lane.material.map.repeat.set(2, 50);
    lane.material.map.needsUpdate = true;
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(-7, 0.02, 0);
    lane.receiveShadow = true;
    g.add(lane);
    const bld = new THREE.Mesh(new THREE.BoxGeometry(16, 7, len), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.7, map: this.tex.concrete }));
    bld.position.set(8, 3.5, 0);
    bld.castShadow = true; bld.receiveShadow = true;
    g.add(bld);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(14, 4, len - 6), new THREE.MeshStandardMaterial({ map: this.tex.windows, metalness: 0.7, roughness: 0.15 }));
    this.tex.windows.repeat.set(len / 20, 1);
    glass.position.set(9, 9, 0);
    glass.castShadow = true;
    g.add(glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, len + 4), this.mats.darkMetal);
    roof.position.set(7, 11.2, 0);
    roof.castShadow = true;
    g.add(roof);
    // puertas de garaje con colores de equipos
    const teamCols = [0xc8102e, 0xb9c2c9, 0xff7a00, 0x0b6e4f, 0x1a2b8f];
    const doorGeo = new THREE.PlaneGeometry(10, 5);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.9 });
    for (let k = 0; k < 10; k++) {
      const z = -len / 2 + 20 + k * ((len - 40) / 9);
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.rotation.y = -Math.PI / 2;
      door.position.set(-0.02, 2.5, z);
      g.add(door);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.2), new THREE.MeshStandardMaterial({ color: teamCols[Math.floor(k / 2)], roughness: 0.4, emissive: teamCols[Math.floor(k / 2)], emissiveIntensity: 0.15 }));
      sign.rotation.y = -Math.PI / 2;
      sign.position.set(-0.03, 5.9, z);
      g.add(sign);
    }
    this.group.add(g);
  }

  _bridge() {
    // Busca la recta más larga fuera de la principal
    const { N } = this;
    let best = -1, bestV = 0;
    for (let i = Math.floor(N * 0.3); i < N * 0.85; i += 5) {
      let m = Infinity;
      for (let k = -25; k <= 25; k++) m = Math.min(m, this.vmax[(i + k + N) % N]);
      if (m > bestV) { bestV = m; best = i; }
    }
    const s = best * this.ds;
    const p = this.pointAt(s, 0);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.heading;
    const bl = this.barrierL[best] + 2, br = this.barrierR[best] + 2;
    const w = bl + br;
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8eaed, roughness: 0.6 });
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
    const banTex = TX.makeBanner('APEX TYRES · F19', '#ffd400', '#111');
    for (const z of [-1.8, 1.8]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.6), new THREE.MeshStandardMaterial({ map: banTex, roughness: 0.5 }));
      ban.position.set((bl - br) / 2, 8, z);
      ban.rotation.y = z < 0 ? Math.PI : 0;
      g.add(ban);
    }
    this.group.add(g);
  }

  _boards() {
    // Carteles 3-2-1 antes de las frenadas fuertes
    const { N } = this;
    const texs = ['3', '2', '1'].map((t) => TX.makeBoard(t));
    const mats = texs.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.5 }));
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
        board.position.set(p.x, 1.4, p.z);
        board.rotation.y = p.heading + Math.PI;
        this.group.add(board);
        const post = new THREE.Mesh(postGeo, this.mats.metal);
        post.position.set(p.x, 0.45, p.z);
        this.group.add(post);
      });
    }
  }

  _trees() {
    const rnd = mulberry32(1234);
    const { cx, cz } = this.bounds;
    const R = 1500;
    const pine = [], round = [];
    const proj = {};
    const count = this.quality.trees;
    let tries = 0;
    const standOut = -this.insideSign;
    while (pine.length + round.length < count && tries < count * 12) {
      tries++;
      const x = cx + (rnd() * 2 - 1) * R;
      const z = cz + (rnd() * 2 - 1) * R;
      this.project(x, z, -1, proj);
      const side = proj.lat >= 0 ? 1 : -1;
      const e = Math.abs(proj.lat) - this.barrierAt(proj.idx, side);
      if (e < 7) continue;
      // Densidad mayor cerca de la pista
      const dens = e < 250 ? 0.9 : e < 700 ? 0.35 : 0.12;
      if (rnd() > dens) continue;
      // Evitar la zona de tribunas y boxes
      const sAbs = Math.min(proj.s, this.length - proj.s);
      if (sAbs < 420 && e < 70) continue;
      const h = this.terrainHeight(x, z, proj);
      if (h > 120) continue;
      const sc = 0.7 + rnd() * 0.8;
      (rnd() < 0.55 ? pine : round).push([x, h, z, sc, rnd()]);
    }
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
    trunk.translate(0, 1.5, 0);
    const colorize = (geo, hex) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const c = new THREE.Color(hex);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < arr.length; k += 3) { arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const cones = [];
    for (let k = 0; k < 3; k++) {
      const cg = new THREE.ConeGeometry(2.6 - k * 0.6, 4 - k * 0.5, 8);
      cg.translate(0, 3.6 + k * 2.1, 0);
      cones.push(colorize(cg, [0x1f4d2b, 0x245a31, 0x2b6838][k]));
    }
    const pineGeo = mergeGeometries([colorize(trunk.clone(), 0x5a3d26), ...cones]);
    const blob = new THREE.IcosahedronGeometry(2.8, 1);
    blob.scale(1, 1.1, 1);
    blob.translate(0, 5.2, 0);
    const blob2 = new THREE.IcosahedronGeometry(2.0, 1);
    blob2.translate(1.3, 6.6, 0.4);
    const roundGeo = mergeGeometries([colorize(trunk.clone(), 0x5a3d26), colorize(blob, 0x3d7a2a), colorize(blob2, 0x4a8a31)]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const col = new THREE.Color();
    for (const [list, geo] of [[pine, pineGeo], [round, roundGeo]]) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      list.forEach(([x, y, z, sc, r], k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * Math.PI * 2);
        s.set(sc, sc * (0.85 + r * 0.4), sc);
        p.set(x, y - 0.2, z);
        m.compose(p, q, s);
        im.setMatrixAt(k, m);
        im.setColorAt(k, col.setRGB(0.8 + r * 0.45, 0.85 + r * 0.3, 0.75 + (1 - r) * 0.3));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    }
  }

  _tvCameras() {
    // Cámaras de televisión junto a la pista
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
        pos: new THREE.Vector3(this.px[i] + this.nx[i] * off, 4 + (n % 3) * 2.5, this.pz[i] + this.nz[i] * off),
      });
    }
  }
}
