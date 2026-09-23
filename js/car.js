// Modelo 3D procedural de un F1 moderno y estado del auto.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import * as TX from './textures.js';
import { damp, clamp } from './utils.js';
import { resetCarState } from './race.js';

export const WHEEL_R = 0.36;

// Superficie "loft": secciones superelípticas unidas a lo largo de z.
// u: desplazamiento hacia adentro de la mitad inferior (undercut de los pontones).
function loft(sections, seg = 28, mirrorX = 1) {
  const secs = [...sections].sort((a, b) => b.z - a.z);
  const S = secs.length;
  const zMax = secs[0].z, zMin = secs[S - 1].z;
  const pos = [], uv = [], idx = [];
  const ring = (sec, k) => {
    const t = (k / seg) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const e = 2 / sec.n;
    let lx = (sec.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e);
    if (sec.u && s < 0) lx -= sec.u * -s * (c > 0 ? 1 : 0.25);
    return [
      mirrorX * ((sec.x || 0) + lx),
      sec.y + (sec.h / 2) * Math.sign(s) * Math.pow(Math.abs(s), e),
      sec.z,
    ];
  };
  for (let s = 0; s < S; s++)
    for (let k = 0; k <= seg; k++) {
      pos.push(...ring(secs[s], k));
      uv.push(k / seg, (zMax - secs[s].z) / (zMax - zMin));
    }
  const R = seg + 1;
  for (let s = 0; s < S - 1; s++)
    for (let k = 0; k < seg; k++) {
      const a = s * R + k, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  for (const [s, front] of [[0, true], [S - 1, false]]) {
    const sec = secs[s];
    const base = pos.length / 3;
    pos.push((sec.x || 0) * mirrorX, sec.y, sec.z);
    uv.push(0.25, front ? 0 : 1);
    for (let k = 0; k <= seg; k++) { pos.push(...ring(sec, k)); uv.push(k / seg, front ? 0 : 1); }
    for (let k = 0; k < seg; k++) {
      if (front) idx.push(base, base + 1 + k, base + 2 + k);
      else idx.push(base, base + 2 + k, base + 1 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (mirrorX < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let s = 0; s < S; s++) {
    const a = s * R, b = s * R + seg;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function rod(p1, p2, r = 0.018, flat = 1) {
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.scale(1, 1, flat);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// Elemento de alerón con perfil curvo y extremos levantados
function wingElement(span, chord, thick, x, y, z, tilt, bend) {
  const g = new THREE.BoxGeometry(span, thick, chord, 24, 1, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vz = p.getZ(i);
    const t = Math.abs(vx) / (span / 2);
    const camber = (1 - (vz / (chord / 2)) ** 2) * thick * 1.2;
    p.setY(i, p.getY(i) + t * t * bend + camber);
  }
  g.rotateX(tilt);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return g;
}

// Placa lateral (endplate) extruida desde un contorno en el plano z-y
function plate(points, thick, x) {
  const sh = new THREE.Shape();
  points.forEach(([z, y], k) => (k ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(-Math.PI / 2);
  g.translate(x + thick / 2, 0, 0);
  return g;
}

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

function mergeAll(list) {
  return mergeGeometries(list.map(prep));
}

// Proyector de calcos a partir de una base (derecha, arriba, normal)
function decal(mesh, pos, right, up, size) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...right).cross(new THREE.Vector3(...up)));
  const e = new THREE.Euler().setFromRotationMatrix(m);
  return new DecalGeometry(mesh, new THREE.Vector3(...pos), e, new THREE.Vector3(...size));
}

function planeDecal(w, h, pos, rotY) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(rotY);
  g.translate(...pos);
  return g;
}

// ---------- Geometría compartida por todos los autos ----------
let GEO = null;
function carGeometry() {
  if (GEO) return GEO;
  const paint = [];
  paint.push(loft([
    { z: 3.05, w: 0.14, h: 0.09, y: 0.21, n: 2.4 },
    { z: 2.9, w: 0.2, h: 0.13, y: 0.23, n: 2.6 },
    { z: 2.6, w: 0.27, h: 0.18, y: 0.28, n: 2.8 },
    { z: 2.2, w: 0.33, h: 0.24, y: 0.34, n: 3 },
    { z: 1.8, w: 0.38, h: 0.3, y: 0.4, n: 3.2 },
    { z: 1.3, w: 0.48, h: 0.4, y: 0.45, n: 3.6 },
    { z: 0.85, w: 0.64, h: 0.47, y: 0.465, n: 4 },
    { z: 0.4, w: 0.8, h: 0.52, y: 0.45, n: 4.2 },
    { z: -0.1, w: 0.86, h: 0.55, y: 0.45, n: 4.2 },
    { z: -0.6, w: 0.8, h: 0.56, y: 0.47, n: 3.8 },
    { z: -1.1, w: 0.62, h: 0.52, y: 0.46, n: 3.4 },
    { z: -1.6, w: 0.44, h: 0.44, y: 0.44, n: 3 },
    { z: -2.05, w: 0.3, h: 0.3, y: 0.4, n: 2.6 },
    { z: -2.45, w: 0.17, h: 0.16, y: 0.37, n: 2.4 },
  ], 32));
  paint.push(loft([
    { z: 0.05, w: 0.22, h: 0.06, y: 0.71, n: 2 },
    { z: -0.18, w: 0.36, h: 0.4, y: 0.84, n: 2.4 },
    { z: -0.45, w: 0.38, h: 0.46, y: 0.84, n: 2.6 },
    { z: -0.9, w: 0.32, h: 0.38, y: 0.8, n: 2.5 },
    { z: -1.45, w: 0.2, h: 0.26, y: 0.72, n: 2.3 },
    { z: -2.0, w: 0.08, h: 0.12, y: 0.6, n: 2.1 },
  ], 28));
  for (const sx of [1, -1]) {
    paint.push(loft([
      { z: 0.64, x: 0.6, w: 0.3, h: 0.3, y: 0.47, n: 4 },
      { z: 0.47, x: 0.62, w: 0.46, h: 0.38, y: 0.45, n: 4, u: 0.08 },
      { z: -0.1, x: 0.6, w: 0.48, h: 0.38, y: 0.43, n: 4, u: 0.15 },
      { z: -0.7, x: 0.52, w: 0.4, h: 0.3, y: 0.37, n: 3.6, u: 0.12 },
      { z: -1.2, x: 0.42, w: 0.26, h: 0.2, y: 0.3, n: 3, u: 0.06 },
      { z: -1.7, x: 0.33, w: 0.1, h: 0.08, y: 0.22, n: 2.5 },
    ], 28, sx));
    // carenado de los espejos
    paint.push(loft([
      { z: 0.66, x: 0.47, w: 0.02, h: 0.02, y: 0.73, n: 2 },
      { z: 0.63, x: 0.47, w: 0.13, h: 0.06, y: 0.73, n: 3 },
      { z: 0.57, x: 0.47, w: 0.13, h: 0.06, y: 0.73, n: 3 },
    ], 12, sx));
  }
  const paintGeo = mergeAll(paint);
  const paintMesh = new THREE.Mesh(paintGeo);

  // Acento de color
  const acc = [];
  const fpl = [[0.34, 0.03], [-0.22, 0.03], [-0.27, 0.13], [-0.16, 0.28], [0.12, 0.29], [0.3, 0.18]];
  for (const sx of [1, -1]) {
    const pl = plate(fpl, 0.018, sx * 0.97);
    pl.translate(0, 0.02, 2.72);
    acc.push(pl);
  }
  const fin = new THREE.Shape();
  fin.moveTo(-0.7, 0.98); fin.lineTo(-2.2, 0.92); fin.lineTo(-2.2, 0.55); fin.lineTo(-1.2, 0.68); fin.lineTo(-0.7, 0.9);
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.018, bevelEnabled: false });
  finG.rotateY(-Math.PI / 2);
  finG.translate(0.009, 0, 0);
  acc.push(finG);
  for (const sx of [1, -1]) acc.push(box(0.022, 0.07, 0.52, sx * 0.515, 0.99, -2.45)); // borde de derivas traseras
  acc.push(box(0.1, 0.045, 0.12, 0, 1.1, -0.42)); // T-cam
  const accentGeo = mergeAll(acc);

  // Fibra de carbono
  const cf = [];
  const floor = new THREE.Shape();
  floor.moveTo(-0.34, 1.35); floor.lineTo(0.34, 1.35); floor.lineTo(0.74, 0.8); floor.lineTo(0.78, -1.1);
  floor.lineTo(0.54, -1.95); floor.lineTo(-0.54, -1.95); floor.lineTo(-0.78, -1.1); floor.lineTo(-0.74, 0.8);
  floor.closePath();
  const floorG = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false });
  floorG.rotateX(Math.PI / 2);
  floorG.translate(0, 0.095, 0);
  cf.push(floorG);
  for (const sx of [1, -1]) {
    cf.push(wingElement(0.08, 1.4, 0.01, sx * 0.78, 0.11, -0.3, 0, 0)); // borde del fondo
    cf.push(box(0.012, 0.07, 1.1, sx * 0.72, 0.13, -0.35, 0, 0, sx * 0.25)); // alerón del borde
  }
  cf.push(box(1.04, 0.02, 0.55, 0, 0.16, -2.2, -0.28));
  for (const sx of [-0.34, -0.12, 0.12, 0.34]) cf.push(box(0.012, 0.17, 0.5, sx, 0.15, -2.2, -0.28));
  // alerón delantero: 4 elementos
  for (let k = 0; k < 4; k++) {
    cf.push(wingElement(1.9 - k * 0.08, 0.22 - k * 0.035, 0.018, 0, 0.08 + k * 0.04, 2.88 - k * 0.12, -0.08 - k * 0.16, 0.03 + k * 0.02));
  }
  cf.push(box(0.04, 0.14, 0.34, 0.1, 0.16, 2.72));
  cf.push(box(0.04, 0.14, 0.34, -0.1, 0.16, 2.72));
  // alerón trasero
  const rpl = [[0.28, 0.46], [-0.3, 0.46], [-0.32, 0.96], [-0.12, 1.02], [0.22, 0.96], [0.3, 0.7]];
  for (const sx of [1, -1]) {
    const pl = plate(rpl, 0.02, sx * 0.505);
    pl.translate(0, 0, -2.45);
    cf.push(pl);
  }
  cf.push(wingElement(1.0, 0.3, 0.028, 0, 0.84, -2.44, 0.2, -0.035));
  cf.push(wingElement(0.9, 0.15, 0.018, 0, 0.44, -2.36, 0.25, 0.0));
  cf.push(wingElement(0.9, 0.12, 0.016, 0, 0.5, -2.46, 0.45, 0.0));
  for (const sx of [0.06, -0.06]) cf.push(rod([sx, 0.42, -2.18], [sx, 0.84, -2.33], 0.012, 4)); // cuello de cisne
  cf.push(box(0.12, 0.12, 0.3, 0, 0.37, -2.42)); // estructura de impacto
  // espejos (soportes)
  for (const sx of [1, -1]) cf.push(rod([sx * 0.3, 0.64, 0.62], [sx * 0.44, 0.72, 0.6], 0.011));
  // suspensión (brazos perfilados)
  for (const sx of [1, -1]) {
    const hf = sx * 0.66, hr = sx * 0.64;
    cf.push(rod([sx * 0.15, 0.3, 2.05], [hf, 0.27, 1.82], 0.02, 0.35), rod([sx * 0.15, 0.3, 1.5], [hf, 0.27, 1.78], 0.02, 0.35));
    cf.push(rod([sx * 0.18, 0.52, 1.95], [hf, 0.47, 1.82], 0.02, 0.35), rod([sx * 0.18, 0.52, 1.6], [hf, 0.47, 1.78], 0.02, 0.35));
    cf.push(rod([sx * 0.2, 0.44, 1.7], [hf, 0.36, 1.8], 0.014));
    cf.push(rod([sx * 0.12, 0.28, -1.55], [hr, 0.27, -1.75], 0.02, 0.35), rod([sx * 0.12, 0.28, -2.0], [hr, 0.27, -1.78], 0.02, 0.35));
    cf.push(rod([sx * 0.14, 0.5, -1.55], [hr, 0.47, -1.72], 0.02, 0.35), rod([sx * 0.14, 0.5, -2.0], [hr, 0.47, -1.78], 0.02, 0.35));
    // tomas de frenos
    cf.push(box(0.05, 0.22, 0.34, sx * 0.6, 0.36, 1.8));
    cf.push(box(0.2, 0.018, 0.3, sx * 0.56, 0.5, -1.72, 0.1));
    cf.push(box(0.2, 0.018, 0.26, sx * 0.56, 0.56, -1.74, 0.2));
  }
  // halo
  const halo = new THREE.TorusGeometry(0.3, 0.034, 8, 28, Math.PI);
  halo.rotateX(Math.PI / 2);
  halo.translate(0, 0.88, 0.22);
  cf.push(halo);
  for (const sx of [1, -1]) cf.push(rod([sx * 0.3, 0.88, 0.22], [sx * 0.31, 0.7, -0.24], 0.034));
  cf.push(rod([0, 0.88, 0.52], [0, 0.66, 0.76], 0.03, 0.6));
  const carbonGeo = mergeAll(cf);

  // DRS
  const flapGeo = prep(wingElement(1.0, 0.2, 0.02, 0, 0, -0.1, 0.45, -0.03));

  // Piezas oscuras
  const dk = [];
  const cockpit = new THREE.CircleGeometry(1, 28);
  cockpit.scale(0.27, 0.46, 1);
  cockpit.rotateX(-Math.PI / 2);
  cockpit.translate(0, 0.712, 0.28);
  dk.push(cockpit);
  const intake = new THREE.CircleGeometry(1, 20);
  intake.scale(0.12, 0.11, 1);
  intake.translate(0, 0.93, -0.175);
  dk.push(intake);
  for (const sx of [1, -1]) {
    const si = new THREE.CircleGeometry(1, 20);
    si.scale(0.13, 0.12, 1);
    si.translate(sx * 0.62, 0.48, 0.645);
    dk.push(si);
  }
  dk.push(box(0.5, 0.12, 0.22, 0, 0.66, 0.02)); // hombros del piloto
  const darkGeo = mergeAll(dk);

  // Metal: escape
  const ex = new THREE.CylinderGeometry(0.055, 0.06, 0.28, 16, 1, true);
  ex.rotateX(Math.PI / 2);
  ex.translate(0, 0.53, -2.38);
  const metalGeo = prep(ex);

  // Calcos (compartidos): números, nombre del equipo y sponsor
  const num = [];
  for (const sx of [1, -1]) {
    num.push(decal(paintMesh, [sx * 0.19, 0.36, 2.2], [0, 0, -sx], [0, 1, 0], [0.3, 0.15, 0.16]));
    num.push(planeDecal(0.28, 0.15, [sx * 0.0115, 0.81, -1.86], sx * Math.PI / 2));
  }
  num.push(decal(paintMesh, [0, 0.45, 1.95], [1, 0, 0], [0, 0, -1], [0.28, 0.2, 0.3]));
  const numberGeo = mergeAll(num);
  const side = [];
  for (const sx of [1, -1]) side.push(decal(paintMesh, [sx * 0.85, 0.49, -0.2], [0, 0, -sx], [0, 1, 0], [0.7, 0.13, 0.24]));
  const teamGeo = mergeAll(side);
  const sp = [];
  for (const sx of [1, -1]) sp.push(planeDecal(0.5, 0.16, [sx * 0.518, 0.8, -2.45], sx * Math.PI / 2));
  const sponsorGeo = mergeAll(sp);

  // Ruedas
  const wheels = {};
  for (const [key, w] of [['front', 0.36], ['rear', 0.44]]) {
    const hw = w / 2;
    const tire = new THREE.LatheGeometry(tireProfile(WHEEL_R, hw), 40);
    tire.rotateZ(Math.PI / 2);
    const rings = [], covers = [], discs = [];
    for (const s of [1, -1]) {
      const ring = new THREE.RingGeometry(0.225, WHEEL_R - 0.02, 40, 1);
      ring.rotateY(s * Math.PI / 2);
      ring.translate(s * (hw + 0.002), 0, 0);
      rings.push(ring);
      const cov = new THREE.CircleGeometry(0.226, 32);
      cov.rotateY(s * Math.PI / 2);
      cov.translate(s * (hw - 0.02), 0, 0);
      covers.push(cov);
    }
    const disc = new THREE.RingGeometry(0.07, 0.17, 24, 1);
    disc.rotateY(Math.PI / 2);
    disc.translate(hw - 0.07, 0, 0);
    const disc2 = disc.clone(); disc2.rotateY(Math.PI);
    discs.push(disc, disc2);
    wheels[key] = { tire: prep(tire), rings: mergeAll(rings), covers: mergeAll(covers), discs: mergeAll(discs), hw };
  }

  // Casco
  const helmetGeo = new THREE.SphereGeometry(0.135, 28, 18);
  const visorGeo = new THREE.SphereGeometry(0.139, 28, 6, Math.PI / 2 - 0.85, 1.7, 1.12, 0.42);

  GEO = {
    paint: paintGeo, accent: accentGeo, carbon: carbonGeo, dark: darkGeo, metal: metalGeo, flap: flapGeo,
    number: numberGeo, team: teamGeo, sponsor: sponsorGeo, wheels, helmet: helmetGeo, visor: visorGeo,
    shadow: new THREE.PlaneGeometry(2.7, 6.6).rotateX(-Math.PI / 2),
    wheelBox: new THREE.BoxGeometry(0.26, 0.13, 0.03),
    light: new THREE.BoxGeometry(0.1, 0.07, 0.03),
  };
  return GEO;
}

function tireProfile(R, hw) {
  const rr = 0.055, rin = 0.225;
  const pts = [new THREE.Vector2(rin, -hw + 0.015)];
  for (let a = 0; a <= 6; a++) {
    const t = (a / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rr + Math.sin(t) * rr, -hw + rr - Math.cos(t) * rr));
  }
  for (let a = 0; a <= 6; a++) {
    const t = (a / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rr + Math.cos(t) * rr, hw - rr + Math.sin(t) * rr));
  }
  pts.push(new THREE.Vector2(rin, hw - 0.015));
  return pts;
}

// ---------- Materiales ----------
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const carbonTex = TX.makeCarbon();
  carbonTex.repeat.set(6, 6);
  const carbonN = TX.makeCarbonNormal();
  carbonN.repeat.set(6, 6);
  SHARED = {
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonTex, normalMap: carbonN, normalScale: new THREE.Vector2(0.4, 0.4), color: 0x80868e, roughness: 0.42, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc6c9ce, roughness: 0.25, metalness: 1, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.82, metalness: 0 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0.9, roughness: 0.05, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6 }),
    shadow: new THREE.MeshBasicMaterial({ map: TX.makeRadialShadow(), transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    wheelScreen: new THREE.MeshBasicMaterial({ color: 0x3cff6a }),
    sidewalls: {},
    covers: {},
  };
  return SHARED;
}

function sidewallMat(color) {
  const S = shared();
  if (!S.sidewalls[color]) S.sidewalls[color] = new THREE.MeshStandardMaterial({ map: TX.makeSidewall(color), roughness: 0.7 });
  return S.sidewalls[color];
}

// Tapa de rueda con ranuras (deja ver el disco de freno) y aro del color del equipo
function coverMat(team) {
  const S = shared();
  if (S.covers[team.id]) return S.covers[team.id];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#16181c'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  g.strokeStyle = team.secondary; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.stroke();
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    g.save(); g.translate(128, 128); g.rotate(a);
    g.beginPath(); g.ellipse(0, -62, 12, 30, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#b8bec6'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = team.primary; g.beginPath(); g.arc(128, 128, 12, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  S.covers[team.id] = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  return S.covers[team.id];
}

function decalMat(map) {
  return new THREE.MeshPhysicalMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

const teamMatCache = new Map();
function teamMaterials(team) {
  if (teamMatCache.has(team.id)) return teamMatCache.get(team.id);
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ map: TX.makeLivery(team), metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }),
    accent: new THREE.MeshPhysicalMaterial({ color: team.secondary, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
    helmet: new THREE.MeshPhysicalMaterial({ map: TX.makeHelmet(team), roughness: 0.25, clearcoat: 1 }),
    team: decalMat(TX.makeDecal(team.short || team.name.toUpperCase(), { color: team.decal || '#ffffff', w: 1024, h: 160, italic: true })),
    sponsor: decalMat(TX.makeDecal(team.sponsor || 'F19', { color: '#ffffff', bg: null, w: 512, h: 128 })),
    cover: coverMat(team),
  };
  teamMatCache.set(team.id, mats);
  return mats;
}

export function setCarEnvMap(tex) {
  for (const m of teamMatCache.values()) {
    for (const k of ['paint', 'accent', 'team', 'sponsor']) { m[k].envMap = tex; m[k].needsUpdate = true; }
  }
}

export function buildCarModel(team, number = 1, compound = '#e10600') {
  const G = carGeometry();
  const S = shared();
  const M = teamMaterials(team);
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  root.add(body);
  const mesh = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    body.add(m);
    return m;
  };
  mesh(G.paint, M.paint);
  mesh(G.accent, M.accent);
  mesh(G.carbon, S.carbon);
  mesh(G.dark, S.dark, false);
  mesh(G.metal, S.metal, false);
  const numMat = decalMat(TX.makeDecal(String(number), { color: team.decal || '#ffffff', stroke: 'rgba(0,0,0,0.35)', w: 256, h: 160, italic: true }));
  mesh(G.number, numMat, false);
  mesh(G.team, M.team, false);
  mesh(G.sponsor, M.sponsor, false);

  const helmet = new THREE.Group();
  const hm = new THREE.Mesh(G.helmet, M.helmet);
  hm.castShadow = true;
  hm.rotation.y = Math.PI / 2;
  helmet.add(hm);
  helmet.add(new THREE.Mesh(G.visor, S.visor));
  helmet.position.set(0, 0.8, 0.08);
  body.add(helmet);

  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(0, 0.66, 0.46);
  wheelGroup.rotation.x = -0.5;
  wheelGroup.add(new THREE.Mesh(G.wheelBox, S.dark));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), S.wheelScreen);
  scr.position.set(0, 0.01, 0.016);
  wheelGroup.add(scr);
  body.add(wheelGroup);

  const drs = new THREE.Group();
  drs.position.set(0, 0.97, -2.32);
  const flap = new THREE.Mesh(G.flap, S.carbon);
  flap.castShadow = true;
  drs.add(flap);
  body.add(drs);

  const lightMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 1.5 });
  const light = new THREE.Mesh(G.light, lightMat);
  light.position.set(0, 0.36, -2.58);
  body.add(light);

  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4, emissive: 0xff4a10, emissiveIntensity: 0 });
  const wheels = [];
  const specs = [
    { x: 0.66, z: 1.8, key: 'front', front: true }, { x: -0.66, z: 1.8, key: 'front', front: true },
    { x: 0.64, z: -1.75, key: 'rear', front: false }, { x: -0.64, z: -1.75, key: 'rear', front: false },
  ];
  const swMat = sidewallMat(compound);
  for (const sp of specs) {
    const W = G.wheels[sp.key];
    const steer = new THREE.Group();
    steer.position.set(sp.x + Math.sign(sp.x) * (W.hw - 0.02), WHEEL_R, sp.z);
    const spin = new THREE.Group();
    steer.add(spin);
    const tire = new THREE.Mesh(W.tire, S.tire);
    tire.castShadow = true;
    spin.add(tire, new THREE.Mesh(W.rings, swMat), new THREE.Mesh(W.covers, M.cover));
    steer.add(new THREE.Mesh(W.discs, brakeMat));
    root.add(steer);
    wheels.push({ steer, spin, front: sp.front });
  }

  const shadow = new THREE.Mesh(G.shadow, S.shadow);
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, body, wheels, drs, helmet, wheelGroup, lightMat, brakeMat, numMat };
}

// Estado completo de un auto (físico + carrera + visual)
export class Car {
  constructor({ id, team, driver, number = 1 }) {
    this.id = id;
    this.team = team;
    this.driver = driver;
    this.number = number;
    this.model = buildCarModel(team, number);
    this.reset();
  }

  reset() {
    resetCarState(this);
    this.wheelSpin = 0;
    this.bump = 0;
    this.visPitch = 0; this.visRoll = 0;
    this.brakeHeat = 0;
    this.blink = 0;
  }

  syncModel(dt, wet = false) {
    const m = this.model;
    m.root.position.set(this.x, this.y || 0, this.z);
    m.root.rotation.y = this.heading;
    const slope = -Math.atan(this.grade || 0);
    m.root.rotation.x = dt > 0 ? damp(m.root.rotation.x, slope, 10, dt) : slope;
    const pitch = clamp(-this.longAccel * 0.0016, -0.035, 0.03);
    const roll = clamp(this.latAccel * 0.0009, -0.035, 0.035);
    if (dt > 0) {
      this.visPitch = damp(this.visPitch, pitch, 8, dt);
      this.visRoll = damp(this.visRoll, roll, 8, dt);
    }
    m.body.rotation.set(this.visPitch, 0, this.visRoll);
    m.body.position.y = this.bump;
    this.wheelSpin += (this.speed / WHEEL_R) * dt;
    for (const w of m.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.steer.rotation.y = this.steerAngle * 1.6;
    }
    m.wheelGroup.rotation.z = -this.steerAngle * 5;
    m.drs.rotation.x = damp(m.drs.rotation.x, this.drsOpen ? -0.42 : 0, 12, dt || 1);

    // Discos de freno incandescentes
    const v = Math.abs(this.speed);
    const heat = this.input.brake * v * 0.05;
    this.brakeHeat = clamp(this.brakeHeat + (heat - this.brakeHeat * 0.6) * dt, 0, 3);
    m.brakeMat.emissiveIntensity = Math.max(0, this.brakeHeat - 0.3) * 2.2;
    // Luz trasera: parpadea al recuperar energía o con lluvia
    this.blink += dt;
    const harvesting = this.input.throttle < 0.1 && v > 25;
    const on = (harvesting || wet) ? Math.floor(this.blink * 4) % 2 === 0 : false;
    m.lightMat.emissiveIntensity = on ? 7 : 1.2;
  }
}
