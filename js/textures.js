// Texturas procedurales generadas en canvas (sin assets externos).
import * as THREE from 'three';
import { tileFbm, mulberry32, clamp } from './utils.js';

let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Convierte un campo de alturas en un normal map.
function normalFromHeight(h, size, strength) {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

export function makeAsphalt() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  const rnd = mulberry32(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileFbm(x / 32, y / 32, 16, 4);
      const grain = rnd();
      const stone = grain > 0.93 ? 0.18 : grain < 0.05 ? -0.12 : 0;
      const v = clamp(0.30 + (n - 0.5) * 0.10 + (grain - 0.5) * 0.08 + stone, 0, 1);
      h[y * S + x] = grain * 0.7 + n * 0.3;
      const i = (y * S + x) * 4;
      img.data[i] = v * 255 * 0.98;
      img.data[i + 1] = v * 255 * 0.99;
      img.data[i + 2] = v * 255 * 1.03;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: tex(c), normal: normalFromHeight(h, S, 2.2) };
}

export function makeGrass() {
  // Textura neutra: el color lo aportan los vertex colors del terreno.
  const S = 512;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const rnd = mulberry32(11);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileFbm(x / 64, y / 64, 8, 5);
      const blade = rnd();
      const v = clamp(0.78 + (n - 0.5) * 0.45 + (blade - 0.5) * 0.2, 0, 1);
      const i = (y * S + x) * 4;
      img.data[i] = 235 * v;
      img.data[i + 1] = 245 * v;
      img.data[i + 2] = 225 * v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

export function makeGravel() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const rnd = mulberry32(21);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileFbm(x / 16, y / 16, 16, 3);
      const r = rnd();
      const v = 0.8 + (n - 0.5) * 0.35 + (r - 0.5) * 0.35;
      const i = (y * S + x) * 4;
      img.data[i] = clamp(196 * v, 0, 255);
      img.data[i + 1] = clamp(178 * v, 0, 255);
      img.data[i + 2] = clamp(142 * v, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

export function makeKerb() {
  const [c, g] = canvas(64, 256);
  for (let i = 0; i < 2; i++) {
    g.fillStyle = i === 0 ? '#d4131b' : '#f2f2f2';
    g.fillRect(0, i * 128, 64, 128);
  }
  // Borde interior pintado y ligera suciedad
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 6, 256);
  const t = tex(c);
  return t;
}

export function makeChecker(cols = 16, rows = 2) {
  const [c, g] = canvas(cols * 16, rows * 16);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = tex(c, { repeat: false });
  t.magFilter = THREE.NearestFilter;
  return t;
}

export const SPONSORS = [
  { name: 'VELOX', bg: '#e10600', fg: '#ffffff' },
  { name: 'APEX TYRES', bg: '#ffd400', fg: '#111111' },
  { name: 'NITRO FUEL', bg: '#0a0a0a', fg: '#00e5ff' },
  { name: 'QUANTUM', bg: '#1b3a8c', fg: '#ffffff' },
  { name: 'SKYLINE AIR', bg: '#f4f4f4', fg: '#1b3a8c' },
  { name: 'TURBO COLA', bg: '#b0001e', fg: '#ffe600' },
  { name: 'HELIX BANK', bg: '#00864a', fg: '#ffffff' },
  { name: 'F19', bg: '#111111', fg: '#e10600' },
];

export function makeAdBoards() {
  const W = 2048, H = 128;
  const [c, g] = canvas(W, H);
  const seg = W / SPONSORS.length;
  SPONSORS.forEach((s, i) => {
    g.fillStyle = s.bg;
    g.fillRect(i * seg, 0, seg, H);
    g.fillStyle = s.fg;
    let fs = 70;
    g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(s.name).width > seg * 0.86 && fs > 20) {
      fs -= 2;
      g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.name, i * seg + seg / 2, H / 2 + 4);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(i * seg, 0, seg, H * 0.35);
  });
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeBanner(text, bg = '#e10600', fg = '#fff') {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg;
  let fs = 78;
  g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
  while (g.measureText(text).width > 960 && fs > 20) { fs -= 2; g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  return tex(c, { repeat: false });
}

export function makeFence() {
  const S = 64;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(200,205,210,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(S, S);
  g.moveTo(S, 0); g.lineTo(0, S);
  g.stroke();
  const t = tex(c);
  return t;
}

export function makeConcrete() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const rnd = mulberry32(5);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = tileFbm(x / 32, y / 32, 8, 4);
      const v = 0.78 + (n - 0.5) * 0.25 + (rnd() - 0.5) * 0.06;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v * 230, 0, 255);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c);
}

export function makeCarbon() {
  const S = 64;
  const [c, g] = canvas(S, S);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const odd = (x + y) % 2;
      const grd = odd
        ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0)
        : g.createLinearGradient(0, y * 8, 0, y * 8 + 8);
      grd.addColorStop(0, '#16181b');
      grd.addColorStop(0.5, '#2c3036');
      grd.addColorStop(1, '#16181b');
      g.fillStyle = grd;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  return tex(c);
}

// Librea del chasis: u = alrededor de la sección, v = a lo largo del auto.
export function makeLivery(team) {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  // u: 0 = lateral izquierdo(+x), 0.25 = arriba, 0.5 = lateral opuesto, 0.75 = abajo
  g.fillStyle = team.primary;
  g.fillRect(0, 0, W, H);
  // mitad inferior en fibra de carbono
  const grdB = g.createLinearGradient(0.52 * W, 0, 0.98 * W, 0);
  grdB.addColorStop(0, team.primary);
  grdB.addColorStop(0.1, '#15171a');
  grdB.addColorStop(0.9, '#15171a');
  grdB.addColorStop(1, team.primary);
  g.fillStyle = grdB;
  g.fillRect(0.52 * W, 0, 0.46 * W, H);
  // franja superior central con filetes
  g.fillStyle = team.secondary;
  g.fillRect(0.225 * W, 0, 0.05 * W, H);
  // banda lateral de acento
  g.fillStyle = team.secondary;
  g.fillRect(0.035 * W, 0, 0.035 * W, H);
  g.fillRect(0.43 * W, 0, 0.035 * W, H);
  // punta de la nariz (v cercano a 0 → parte baja del canvas)
  g.fillStyle = team.tertiary || team.secondary;
  g.fillRect(0, H * 0.94, W, H * 0.06);
  return tex(c, { repeat: false });
}

export function makeSidewall(stripe = '#e10600') {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#1b1b1d';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = stripe;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.37, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#d9d9d9';
  g.font = 'bold 15px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 0; k < 2; k++) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(k * Math.PI);
    g.fillText('F19 RACING', 0, -S * 0.455);
    g.restore();
  }
  return tex(c, { repeat: false });
}

export function makeRadialShadow() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false, srgb: false });
}

export function makeSoftDot() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}

export function makeWindows() {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#1d2a36';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 16; i++) {
    const grd = g.createLinearGradient(i * 32, 0, i * 32 + 32, 128);
    grd.addColorStop(0, '#6f8fa8');
    grd.addColorStop(0.5, '#2b4256');
    grd.addColorStop(1, '#8fb2cc');
    g.fillStyle = grd;
    g.fillRect(i * 32 + 2, 4, 28, 120);
  }
  return tex(c);
}

export function makeBoard(text) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111'; g.fillRect(6, 6, 116, 116);
  g.fillStyle = '#f4f4f4';
  g.font = '900 64px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  return tex(c, { repeat: false });
}
