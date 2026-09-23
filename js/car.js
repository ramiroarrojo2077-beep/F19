// Modelo 3D procedural de un F1 moderno y estado del auto.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { damp, clamp } from './utils.js';
import { GEAR_TOP } from './physics.js';
import { resetCarState } from './race.js';

export const WHEEL_R = 0.36;

// Superficie "loft": secciones superelípticas unidas a lo largo de z.
function loft(sections, seg = 28, mirrorX = 1) {
  const secs = [...sections].sort((a, b) => b.z - a.z);
  const S = secs.length;
  const zMax = secs[0].z, zMin = secs[S - 1].z;
  const pos = [], uv = [], idx = [];
  const ring = (sec, k) => {
    const t = (k / seg) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const e = 2 / sec.n;
    return [
      (sec.x || 0) * mirrorX + (sec.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e),
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
  // tapas
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
    // reflejar invierte el sentido de los triángulos
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  g.computeVertexNormals();
  // suavizar la costura (k = 0 y k = seg comparten posición)
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

function rod(p1, p2, r = 0.018) {
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// Elemento de alerón curvado hacia arriba en los extremos
function wingElement(span, chord, thick, x, y, z, tilt, bend) {
  const g = new THREE.BoxGeometry(span, thick, chord, 20, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i);
    const t = Math.abs(vx) / (span / 2);
    p.setY(i, p.getY(i) + t * t * bend);
  }
  g.rotateX(tilt);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return g;
}

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}

function merged(list, mat, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(list.map(prep)), mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const carbonTex = TX.makeCarbon();
  carbonTex.repeat.set(6, 6);
  const rimCanvas = document.createElement('canvas');
  rimCanvas.width = rimCanvas.height = 128;
  const g = rimCanvas.getContext('2d');
  g.fillStyle = '#1c1e22'; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6d737b'; g.lineWidth = 9;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 16, 64 + Math.sin(a) * 16);
    g.lineTo(64 + Math.cos(a + 0.25) * 58, 64 + Math.sin(a + 0.25) * 58); g.stroke();
  }
  g.fillStyle = '#c9ced4'; g.beginPath(); g.arc(64, 64, 14, 0, Math.PI * 2); g.fill();
  const rimTex = new THREE.CanvasTexture(rimCanvas);
  rimTex.colorSpace = THREE.SRGBColorSpace;
  shared = {
    carbon: new THREE.MeshStandardMaterial({ map: carbonTex, color: 0x7a8088, roughness: 0.45, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.85 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.78, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ map: rimTex, metalness: 0.7, roughness: 0.35 }),
    rimBarrel: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.8, roughness: 0.3 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0.9, roughness: 0.05, clearcoat: 1 }),
    light: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 2.5 }),
    shadow: new THREE.MeshBasicMaterial({ map: TX.makeRadialShadow(), transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    sidewalls: {},
  };
  return shared;
}

function sidewallMat(color) {
  const S = sharedAssets();
  if (!S.sidewalls[color]) {
    S.sidewalls[color] = new THREE.MeshStandardMaterial({ map: TX.makeSidewall(color), roughness: 0.7, transparent: false });
  }
  return S.sidewalls[color];
}

export function buildCarModel(team, compound = '#e10600') {
  const S = sharedAssets();
  const root = new THREE.Group();
  const body = new THREE.Group(); // recibe cabeceo y balanceo
  root.add(body);

  const livery = TX.makeLivery(team);
  const paint = new THREE.MeshPhysicalMaterial({
    map: livery, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const accent = new THREE.MeshPhysicalMaterial({
    color: team.secondary, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1,
  });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: team.helmet || team.secondary, roughness: 0.25, clearcoat: 1 });

  // --- Carrocería pintada ---
  const paintGeos = [];
  paintGeos.push(loft([
    { z: 3.0, w: 0.16, h: 0.1, y: 0.22, n: 2.5 },
    { z: 2.75, w: 0.24, h: 0.16, y: 0.26, n: 2.8 },
    { z: 2.3, w: 0.32, h: 0.24, y: 0.33, n: 3 },
    { z: 1.8, w: 0.4, h: 0.32, y: 0.4, n: 3.2 },
    { z: 1.2, w: 0.52, h: 0.42, y: 0.45, n: 3.5 },
    { z: 0.7, w: 0.7, h: 0.48, y: 0.46, n: 4 },
    { z: 0.2, w: 0.84, h: 0.52, y: 0.44, n: 4 },
    { z: -0.3, w: 0.86, h: 0.56, y: 0.45, n: 4 },
    { z: -0.9, w: 0.7, h: 0.56, y: 0.47, n: 3.5 },
    { z: -1.5, w: 0.46, h: 0.46, y: 0.45, n: 3 },
    { z: -2.0, w: 0.3, h: 0.32, y: 0.4, n: 2.6 },
    { z: -2.45, w: 0.18, h: 0.18, y: 0.36, n: 2.4 },
  ]));
  // cubierta del motor / toma de aire
  paintGeos.push(loft([
    { z: 0.02, w: 0.24, h: 0.08, y: 0.7, n: 2.2 },
    { z: -0.22, w: 0.34, h: 0.36, y: 0.82, n: 2.6 },
    { z: -0.5, w: 0.36, h: 0.42, y: 0.82, n: 2.8 },
    { z: -0.9, w: 0.3, h: 0.34, y: 0.78, n: 2.6 },
    { z: -1.4, w: 0.18, h: 0.22, y: 0.7, n: 2.4 },
    { z: -1.95, w: 0.06, h: 0.1, y: 0.58, n: 2.2 },
  ]));
  // pontones
  for (const sx of [1, -1]) {
    paintGeos.push(loft([
      { z: 0.58, x: 0.64, w: 0.3, h: 0.34, y: 0.4, n: 4 },
      { z: 0.4, x: 0.64, w: 0.44, h: 0.4, y: 0.4, n: 4 },
      { z: -0.2, x: 0.6, w: 0.46, h: 0.38, y: 0.38, n: 4 },
      { z: -0.8, x: 0.52, w: 0.38, h: 0.28, y: 0.32, n: 3.5 },
      { z: -1.3, x: 0.42, w: 0.24, h: 0.18, y: 0.26, n: 3 },
      { z: -1.72, x: 0.34, w: 0.1, h: 0.08, y: 0.22, n: 2.5 },
    ], 24, sx));
  }
  body.add(merged(paintGeos, paint));

  // --- Piezas de acento ---
  const acc = [];
  for (const sx of [1, -1]) {
    acc.push(box(0.02, 0.17, 0.46, sx * 0.96, 0.15, 2.74)); // derivas alerón delantero
    acc.push(box(0.02, 0.18, 0.5, sx * 0.51, 0.93, -2.45)); // parte alta derivas traseras
    acc.push(box(0.46, 0.012, 0.3, sx * 0.64, 0.6, 0.35, 0, 0, sx * -0.12)); // deflector ponton
  }
  // aleta de tiburón
  const fin = new THREE.Shape();
  fin.moveTo(-0.7, 0.96); fin.lineTo(-2.2, 0.9); fin.lineTo(-2.2, 0.55); fin.lineTo(-1.2, 0.68); fin.lineTo(-0.7, 0.9);
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.018, bevelEnabled: false });
  finG.rotateY(-Math.PI / 2);
  finG.translate(0.009, 0, 0);
  acc.push(finG);
  body.add(merged(acc, accent));

  // --- Fibra de carbono ---
  const cf = [];
  const floor = new THREE.Shape();
  floor.moveTo(-0.34, 1.35); floor.lineTo(0.34, 1.35); floor.lineTo(0.74, 0.8); floor.lineTo(0.76, -1.1);
  floor.lineTo(0.52, -1.95); floor.lineTo(-0.52, -1.95); floor.lineTo(-0.76, -1.1); floor.lineTo(-0.74, 0.8);
  floor.closePath();
  const floorG = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false });
  floorG.rotateX(Math.PI / 2);
  floorG.translate(0, 0.095, 0);
  cf.push(floorG);
  // difusor
  cf.push(box(1.02, 0.02, 0.55, 0, 0.16, -2.2, -0.28));
  for (const sx of [-0.3, 0, 0.3]) cf.push(box(0.012, 0.16, 0.5, sx, 0.15, -2.2, -0.28));
  // alerón delantero (3 elementos)
  for (let k = 0; k < 3; k++) cf.push(wingElement(1.9 - k * 0.1, 0.22 - k * 0.03, 0.022, 0, 0.085 + k * 0.045, 2.86 - k * 0.14, -0.12 - k * 0.14, 0.05 + k * 0.03));
  cf.push(box(0.05, 0.12, 0.3, 0.12, 0.16, 2.72)); // pilones
  cf.push(box(0.05, 0.12, 0.3, -0.12, 0.16, 2.72));
  // alerón trasero: plano principal y viga
  cf.push(wingElement(1.0, 0.3, 0.03, 0, 0.84, -2.44, 0.18, 0.0));
  cf.push(wingElement(0.9, 0.16, 0.02, 0, 0.44, -2.34, 0.25, 0.0));
  cf.push(box(0.05, 0.36, 0.12, 0, 0.64, -2.36)); // pilón central
  for (const sx of [1, -1]) cf.push(box(0.02, 0.5, 0.5, sx * 0.51, 0.59, -2.45));
  // espejos
  for (const sx of [1, -1]) {
    cf.push(box(0.11, 0.05, 0.04, sx * 0.46, 0.72, 0.6));
    cf.push(rod([sx * 0.3, 0.62, 0.62], [sx * 0.44, 0.71, 0.6], 0.012));
  }
  // suspensión
  for (const sx of [1, -1]) {
    const hf = [sx * 0.66, 0.36, 1.8], hr = [sx * 0.64, 0.36, -1.75];
    cf.push(rod([sx * 0.15, 0.3, 2.05], [hf[0], 0.27, 1.82]), rod([sx * 0.15, 0.3, 1.5], [hf[0], 0.27, 1.78]));
    cf.push(rod([sx * 0.18, 0.52, 1.95], [hf[0], 0.47, 1.82]), rod([sx * 0.18, 0.52, 1.6], [hf[0], 0.47, 1.78]));
    cf.push(rod([sx * 0.2, 0.44, 1.7], [hf[0], 0.36, 1.8], 0.014));
    cf.push(rod([sx * 0.12, 0.28, -1.55], [hr[0], 0.27, -1.75]), rod([sx * 0.12, 0.28, -2.0], [hr[0], 0.27, -1.78]));
    cf.push(rod([sx * 0.14, 0.5, -1.55], [hr[0], 0.47, -1.72]), rod([sx * 0.14, 0.5, -2.0], [hr[0], 0.47, -1.78]));
  }
  // halo
  const halo = new THREE.TorusGeometry(0.3, 0.032, 8, 24, Math.PI);
  halo.rotateX(Math.PI / 2);
  halo.translate(0, 0.88, 0.22);
  cf.push(halo);
  for (const sx of [1, -1]) cf.push(rod([sx * 0.3, 0.88, 0.22], [sx * 0.3, 0.7, -0.22], 0.032));
  cf.push(rod([0, 0.88, 0.52], [0, 0.66, 0.74], 0.03));
  body.add(merged(cf, S.carbon));

  // --- Piezas oscuras: cockpit y tomas ---
  const dk = [];
  const cockpit = new THREE.CircleGeometry(1, 24);
  cockpit.scale(0.27, 0.46, 1);
  cockpit.rotateX(-Math.PI / 2);
  cockpit.translate(0, 0.712, 0.28);
  dk.push(cockpit);
  const intake = new THREE.CircleGeometry(1, 16);
  intake.scale(0.1, 0.09, 1);
  intake.translate(0, 0.9, -0.215);
  dk.push(intake);
  for (const sx of [1, -1]) {
    const si = new THREE.CircleGeometry(1, 16);
    si.scale(0.13, 0.15, 1);
    si.translate(sx * 0.64, 0.4, 0.585);
    dk.push(si);
  }
  body.add(merged(dk, S.dark, false));

  // Casco del piloto
  const helmet = new THREE.Group();
  const hg = new THREE.SphereGeometry(0.135, 24, 16);
  const hm = new THREE.Mesh(hg, helmetMat);
  hm.castShadow = true;
  helmet.add(hm);
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.138, 24, 6, Math.PI / 2 - 0.85, 1.7, 1.12, 0.42), S.visor);
  helmet.add(vis);
  helmet.position.set(0, 0.8, 0.08);
  body.add(helmet);

  // Volante
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(0, 0.66, 0.46);
  wheelGroup.rotation.x = -0.5;
  const sw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.03), S.dark);
  wheelGroup.add(sw);
  const swScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x3cff6a }));
  swScreen.position.set(0, 0.01, 0.016);
  wheelGroup.add(swScreen);
  body.add(wheelGroup);

  // Flap del DRS
  const drs = new THREE.Group();
  drs.position.set(0, 0.97, -2.32);
  const flap = new THREE.Mesh(prep(wingElement(1.0, 0.2, 0.02, 0, 0, -0.1, 0.45, 0)), S.carbon);
  flap.castShadow = true;
  drs.add(flap);
  body.add(drs);

  // Luz trasera
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.03), S.light);
  light.position.set(0, 0.36, -2.47);
  body.add(light);

  // Ruedas
  const wheels = [];
  const specs = [
    { x: 0.66, z: 1.8, w: 0.36, front: true }, { x: -0.66, z: 1.8, w: 0.36, front: true },
    { x: 0.64, z: -1.75, w: 0.44, front: false }, { x: -0.64, z: -1.75, w: 0.44, front: false },
  ];
  const swMat = sidewallMat(compound);
  for (const sp of specs) {
    const steer = new THREE.Group();
    steer.position.set(sp.x + Math.sign(sp.x) * sp.w / 2 - Math.sign(sp.x) * 0.02, WHEEL_R, sp.z);
    const spin = new THREE.Group();
    steer.add(spin);
    const hw = sp.w / 2;
    const tireG = new THREE.LatheGeometry(tireProfile(WHEEL_R, hw), 36);
    tireG.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tireG, S.tire);
    tire.castShadow = true;
    spin.add(tire);
    for (const side of [1, -1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.225, WHEEL_R - 0.02, 36, 1), swMat);
      ring.rotation.y = side * Math.PI / 2;
      ring.position.x = side * (hw + 0.002);
      spin.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.226, 28), S.rim);
      disc.rotation.y = side * Math.PI / 2;
      disc.position.x = side * (hw - 0.02);
      spin.add(disc);
    }
    root.add(steer);
    wheels.push({ steer, spin, front: sp.front });
  }

  // Sombra de contacto
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 6.6), S.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, body, wheels, drs, helmet, wheelGroup, paint, accent, livery };
}

// Perfil de la sección del neumático (radio, eje) con hombros redondeados.
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

// Estado completo de un auto (físico + carrera)
export class Car {
  constructor({ id, team, driver, isPlayer = false, skill = 1 }) {
    this.id = id;
    this.team = team;
    this.driver = driver;
    this.isPlayer = isPlayer;
    this.skill = skill;
    this.model = buildCarModel(team);
    this.reset();
  }

  reset() {
    resetCarState(this);
    this.wheelSpin = 0;
    this.bump = 0;
    this.visPitch = 0; this.visRoll = 0;
  }

  syncModel(dt) {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.heading;
    // cabeceo y balanceo suaves
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
  }
}

export { GEAR_TOP };
