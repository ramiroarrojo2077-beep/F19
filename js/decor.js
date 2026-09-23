// Escenografía: árboles, palmeras, casas, ciudad, reflectores y barcos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let k = 0; k < arr.length; k += 3) { arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function pineGeo() {
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
  trunk.translate(0, 1.5, 0);
  const parts = [colorize(trunk, 0x5a3d26)];
  for (let k = 0; k < 3; k++) {
    const cg = new THREE.ConeGeometry(2.6 - k * 0.6, 4 - k * 0.5, 8);
    cg.translate(0, 3.6 + k * 2.1, 0);
    parts.push(colorize(cg, [0x1f4d2b, 0x245a31, 0x2b6838][k]));
  }
  return mergeGeometries(parts);
}

function roundTreeGeo() {
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
  trunk.translate(0, 1.5, 0);
  const blob = new THREE.IcosahedronGeometry(2.8, 1);
  blob.scale(1, 1.1, 1);
  blob.translate(0, 5.2, 0);
  const blob2 = new THREE.IcosahedronGeometry(2.0, 1);
  blob2.translate(1.3, 6.6, 0.4);
  return mergeGeometries([colorize(trunk, 0x5a3d26), colorize(blob, 0x3d7a2a), colorize(blob2, 0x4a8a31)]);
}

function palmGeo() {
  const H = 9;
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, H * 0.55, 0), new THREE.Vector3(0.5, H, 0));
  const trunk = new THREE.TubeGeometry(curve, 10, 0.2, 6, false);
  const parts = [colorize(trunk, 0x7a5a3a)];
  const top = new THREE.Vector3(0.5, H, 0);
  const pos = [];
  const cols = [];
  const green = new THREE.Color(0x3f7f2c), green2 = new THREE.Color(0x2e6421);
  const F = 9, SEG = 7, L = 4.6;
  for (let f = 0; f < F; f++) {
    const a = (f / F) * Math.PI * 2 + (f % 2) * 0.2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz, sz = dx;
    const lift = 0.8 + (f % 3) * 0.25;
    const pts = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.05;
      const cx = top.x + dx * t * L, cz = top.z + dz * t * L;
      const cy = top.y + Math.sin(t * Math.PI * 0.8) * lift - t * t * 2.6;
      pts.push([[cx + sx * w, cy - w * 0.25, cz + sz * w], [cx, cy, cz], [cx - sx * w, cy - w * 0.25, cz - sz * w]]);
    }
    for (let k = 0; k < SEG; k++) {
      const [a0, b0, c0] = pts[k], [a1, b1, c1] = pts[k + 1];
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1, ...b0, ...c0, ...b1, ...b1, ...c0, ...c1);
      const col = k % 2 ? green : green2;
      for (let v = 0; v < 12; v++) cols.push(col.r, col.g, col.b);
    }
  }
  const fr = new THREE.BufferGeometry();
  fr.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fr.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  fr.computeVertexNormals();
  parts.push(fr);
  const nut = new THREE.IcosahedronGeometry(0.28, 0);
  nut.translate(top.x, top.y - 0.35, top.z);
  parts.push(colorize(nut, 0x5a4020));
  return mergeGeometries(parts.map((p) => {
    const n = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  }));
}

function shrubGeo() {
  const a = new THREE.IcosahedronGeometry(1.2, 0);
  a.scale(1.4, 0.7, 1.2);
  a.translate(0, 0.5, 0);
  return colorize(a, 0x7d7a45);
}

function houseGeo(wall, roof) {
  const body = new THREE.BoxGeometry(1, 1, 1);
  body.translate(0, 0.5, 0);
  const r = new THREE.ConeGeometry(0.78, 0.45, 4, 1);
  r.rotateY(Math.PI / 4);
  r.translate(0, 1.22, 0);
  return mergeGeometries([colorize(body, wall), colorize(r, roof)]);
}

function flatHouseGeo(wall) {
  const body = new THREE.BoxGeometry(1, 1, 1);
  body.translate(0, 0.5, 0);
  const top = new THREE.BoxGeometry(1.04, 0.06, 1.04);
  top.translate(0, 1.02, 0);
  return mergeGeometries([colorize(body, wall), colorize(top, 0xc9bfae)]);
}

function instanced(geo, mat, list, { shadow = true, colorFn } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  im.count = list.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  list.forEach((it, k) => {
    q.setFromAxisAngle(UP, it.rot);
    s.set(it.sx, it.sy, it.sz);
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    im.setMatrixAt(k, m);
    if (colorFn) im.setColorAt(k, colorFn(it, col));
  });
  im.castShadow = shadow;
  im.receiveShadow = true;
  return im;
}

// Busca un punto libre alrededor del circuito
function spot(track, rnd, eMin, eMax, R, proj) {
  const { cx, cz } = track.bounds;
  const x = cx + (rnd() * 2 - 1) * R;
  const z = cz + (rnd() * 2 - 1) * R;
  track.project(x, z, -1, proj);
  const side = proj.lat >= 0 ? 1 : -1;
  const e = Math.abs(proj.lat) - track.barrierAt(proj.idx, side);
  if (e < eMin || e > eMax) return null;
  // zona de tribunas y boxes
  const sAbs = Math.min(proj.s, track.length - proj.s);
  if (sAbs < 430 && e < 75) return null;
  if (track.isWater && track.isWater(x, z, 4)) return null;
  const h = track.terrainHeight(x, z, proj);
  return { x, z, h, e };
}

export function buildVegetation(track, kind, count, rnd) {
  const group = new THREE.Group();
  const proj = {};
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const matPalm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const lists = { pine: [], round: [], palm: [], shrub: [] };
  let tries = 0;
  let placed = 0;
  while (placed < count && tries < count * 14) {
    tries++;
    const near = rnd() < 0.7;
    const p = spot(track, rnd, 7, near ? 260 : 900, 1500, proj);
    if (!p) continue;
    if (p.h > 120) continue;
    const dens = p.e < 250 ? 0.9 : p.e < 700 ? 0.35 : 0.12;
    if (rnd() > dens) continue;
    const r = rnd();
    const it = { x: p.x, y: p.h - 0.2, z: p.z, rot: rnd() * Math.PI * 2, r };
    let type;
    if (kind === 'forest') type = r < 0.55 ? 'pine' : 'round';
    else if (kind === 'palm') type = r < 0.55 ? 'palm' : r < 0.8 ? 'round' : 'shrub';
    else type = r < 0.35 ? 'palm' : 'shrub';
    const sc = type === 'shrub' ? 0.6 + rnd() * 0.9 : 0.7 + rnd() * 0.7;
    it.sx = it.sz = sc;
    it.sy = sc * (0.85 + rnd() * 0.35);
    lists[type].push(it);
    placed++;
  }
  // Palmeras alineadas junto a la pista (paseo)
  if (kind === 'palm' || kind === 'desert') {
    const bar = track.barrierL;
    for (let i = 0; i < track.N; i += kind === 'palm' ? 14 : 30) {
      for (const side of [1, -1]) {
        if (kind === 'desert' && rnd() < 0.5) continue;
        const b = side > 0 ? bar[i] : track.barrierR[i];
        const off = side * (b + 5 + rnd() * 3);
        const x = track.px[i] + track.nx[i] * off, z = track.pz[i] + track.nz[i] * off;
        const sAbs = Math.min(i * track.ds, track.length - i * track.ds);
        if (sAbs < 430) continue;
        if (track.isWater && track.isWater(x, z, 3)) continue;
        const h = track.terrainHeight(x, z);
        lists.palm.push({ x, y: h - 0.2, z, rot: rnd() * 6.28, sx: 0.9, sy: 0.85 + rnd() * 0.3, sz: 0.9, r: rnd() });
      }
    }
  }
  const tint = (it, col) => col.setRGB(0.8 + it.r * 0.45, 0.85 + it.r * 0.3, 0.75 + (1 - it.r) * 0.3);
  if (lists.pine.length) group.add(instanced(pineGeo(), mat, lists.pine, { colorFn: tint }));
  if (lists.round.length) group.add(instanced(roundTreeGeo(), mat, lists.round, { colorFn: tint }));
  if (lists.palm.length) group.add(instanced(palmGeo(), matPalm, lists.palm, { colorFn: tint }));
  if (lists.shrub.length) group.add(instanced(shrubGeo(), mat, lists.shrub, { colorFn: tint, shadow: false }));
  return group;
}

export function buildBuildings(track, kind, rnd, night) {
  const group = new THREE.Group();
  const proj = {};
  if (kind === 'village' || kind === 'coast') {
    const list = [];
    const clusters = kind === 'coast' ? 7 : 5;
    for (let c = 0; c < clusters; c++) {
      let center = null;
      for (let t = 0; t < 60 && !center; t++) center = spot(track, rnd, 90, 500, 1300, proj);
      if (!center) continue;
      const n = 10 + Math.floor(rnd() * 14);
      for (let k = 0; k < n; k++) {
        const x = center.x + (rnd() - 0.5) * 140, z = center.z + (rnd() - 0.5) * 140;
        track.project(x, z, -1, proj);
        const side = proj.lat >= 0 ? 1 : -1;
        const e = Math.abs(proj.lat) - track.barrierAt(proj.idx, side);
        if (e < 40) continue;
        if (track.isWater && track.isWater(x, z, 6)) continue;
        const h = track.terrainHeight(x, z, proj);
        const w = 7 + rnd() * 8;
        list.push({ x, y: h - 0.5, z, rot: Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.3, sx: w, sy: 5 + rnd() * 5, sz: w * (0.7 + rnd() * 0.5), r: rnd() });
      }
    }
    const geo = kind === 'coast' ? flatHouseGeo(0xf1ece2) : houseGeo(0xe8dcc4, 0x8a3b2a);
    const geo2 = kind === 'coast' ? houseGeo(0xf5f0e6, 0xc0633a) : houseGeo(0xdcd4c4, 0x4a4f57);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const a = list.filter((_, k) => k % 2 === 0), b = list.filter((_, k) => k % 2 === 1);
    const tint = (it, col) => col.setRGB(0.92 + it.r * 0.1, 0.9 + it.r * 0.1, 0.88 + it.r * 0.12);
    if (a.length) group.add(instanced(geo, mat, a, { colorFn: tint }));
    if (b.length) group.add(instanced(geo2, mat, b, { colorFn: tint }));
  }
  if (kind === 'city' || kind === 'coast') {
    // Rascacielos / hoteles fusionados en una sola malla
    const geos = [];
    const N = kind === 'city' ? 46 : 10;
    const { cx, cz } = track.bounds;
    const baseAng = rnd() * Math.PI * 2;
    for (let k = 0; k < N; k++) {
      const ang = baseAng + (rnd() - 0.5) * (kind === 'city' ? 1.6 : 0.8);
      const dist = (kind === 'city' ? 1100 : 700) + rnd() * 450;
      const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      if (track.isWater && track.isWater(x, z, 20)) continue;
      const h0 = track.terrainHeight(x, z);
      const w = 22 + rnd() * 26, d = 22 + rnd() * 26;
      const H = kind === 'city' ? 50 + rnd() * 170 : 25 + rnd() * 30;
      const g = new THREE.BoxGeometry(w, H, d);
      const uv = g.attributes.uv;
      const nrm = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const vertical = Math.abs(nrm.getY(i)) < 0.5;
        const facW = Math.abs(nrm.getX(i)) > 0.5 ? d : w;
        if (vertical) uv.setXY(i, uv.getX(i) * facW / 16, uv.getY(i) * H / 32);
        else uv.setXY(i, 0.02, 0.02);
      }
      g.translate(x, h0 + H / 2 - 2, z);
      geos.push(g);
    }
    if (geos.length) {
      const map = night ? TX.makeCityWindows(7, 0.5) : TX.makeFacade(3);
      const mat = night
        ? new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.6, metalness: 0.4, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1.6, fog: false })
        : new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.2 });
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      if (night) {
        // luces rojas de balizamiento en las azoteas
        const pts = [];
        for (const g of geos) {
          g.computeBoundingBox();
          const bb = g.boundingBox;
          pts.push((bb.min.x + bb.max.x) / 2, bb.max.y + 1, (bb.min.z + bb.max.z) / 2);
        }
        group.add(glowPoints(pts, 0xff3020, 18));
      }
    }
  }
  return group;
}

export function glowPoints(positions, color, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const m = new THREE.PointsMaterial({
    map: TX.makeGlow('#ffffff'), color, size, sizeAttenuation: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// Torres de iluminación para carreras nocturnas
export function buildFloodlights(track) {
  const group = new THREE.Group();
  const poles = [], heads = [], glow = [];
  let side = 1;
  for (let i = 0; i < track.N; i += 36) {
    side = -side;
    const b = track.barrierAt(i, side);
    const off = side * (b + 4.5);
    const x = track.px[i] + track.nx[i] * off, z = track.pz[i] + track.nz[i] * off;
    const y = track.py[i];
    const rot = Math.atan2(-track.nx[i] * side, -track.nz[i] * side);
    poles.push({ x, y, z, rot, sx: 1, sy: 1, sz: 1 });
    heads.push({ x, y: y + 19, z, rot, sx: 1, sy: 1, sz: 1 });
    const fx = -track.nx[i] * side, fz = -track.nz[i] * side;
    for (const k of [-1.2, 0, 1.2]) glow.push(x + fx * 0.7 + track.tx[i] * k, y + 19.2, z + fz * 0.7 + track.tz[i] * k);
  }
  const pole = new THREE.CylinderGeometry(0.22, 0.35, 19, 8);
  pole.translate(0, 9.5, 0);
  group.add(instanced(pole, new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.7, roughness: 0.5 }), poles, { shadow: false }));
  const head = new THREE.BoxGeometry(4.2, 1.6, 0.6);
  head.rotateX(-0.35);
  head.translate(0, 0, 0.35);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff6e8, emissiveIntensity: 4, fog: false });
  group.add(instanced(head, headMat, heads, { shadow: false }));
  group.add(glowPoints(glow, 0xfff1d6, 7));
  return group;
}

export function buildBoats(track, water, rnd) {
  const hull = new THREE.BoxGeometry(3, 1.2, 10, 1, 1, 4);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    const t = Math.max(0, (z - 1) / 4);
    p.setX(i, p.getX(i) * (1 - t * 0.85) * (y < 0 ? 0.7 : 1));
  }
  hull.computeVertexNormals();
  const cabin = new THREE.BoxGeometry(2, 1.2, 3.5);
  cabin.translate(0, 1.2, -1);
  const mast = new THREE.CylinderGeometry(0.06, 0.08, 11, 5);
  mast.translate(0, 5.5, 0.5);
  const geo = mergeGeometries([colorize(hull, 0xf6f6f6), colorize(cabin, 0xdfe6ec), colorize(mast, 0xc9c9c9)]);
  const list = [];
  for (let k = 0; k < 40; k++) {
    const x = track.bounds.minX - 300 + rnd() * (track.bounds.maxX - track.bounds.minX + 600);
    const z = water.edge - 60 - rnd() * 500;
    if (!track.isWater(x, z, 30)) continue;
    const s = 0.8 + rnd() * 0.8;
    list.push({ x, y: water.level + 0.2, z, rot: rnd() * 6.28, sx: s, sy: s, sz: s, r: rnd() });
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
  return instanced(geo, mat, list, { shadow: false });
}
