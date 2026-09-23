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

// Librea del chasis: u = alrededor de la sección, v = a lo largo del auto (v=0 nariz, abajo en el canvas).
export function makeLivery(team) {
  const W = 1024, H = 1024;
  const [c, g] = canvas(W, H);
  const base = new THREE.Color(team.primary);
  const dark = base.clone().multiplyScalar(0.55);
  // base con degradé hacia la parte trasera (arriba del canvas)
  const grd = g.createLinearGradient(0, H, 0, 0);
  grd.addColorStop(0, team.primary);
  grd.addColorStop(0.55, team.primary);
  grd.addColorStop(1, '#' + dark.getHexString());
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // mitad inferior en fibra de carbono
  const grdB = g.createLinearGradient(0.52 * W, 0, 0.98 * W, 0);
  grdB.addColorStop(0, 'rgba(21,23,26,0)');
  grdB.addColorStop(0.08, '#15171a');
  grdB.addColorStop(0.92, '#15171a');
  grdB.addColorStop(1, 'rgba(21,23,26,0)');
  g.fillStyle = grdB;
  g.fillRect(0.52 * W, 0, 0.46 * W, H);
  g.fillStyle = '#15171a';
  g.fillRect(0, 0, 0.012 * W, H);
  // franja superior central
  g.fillStyle = team.secondary;
  g.fillRect(0.222 * W, 0, 0.056 * W, H);
  g.fillStyle = team.tertiary || '#111';
  g.fillRect(0.213 * W, 0, 0.006 * W, H);
  g.fillRect(0.281 * W, 0, 0.006 * W, H);
  // barrido lateral que nace en la nariz y se afina hacia atrás
  for (const [u0, dir] of [[0.03, 1], [0.47, -1]]) {
    g.fillStyle = team.secondary;
    g.beginPath();
    g.moveTo(u0 * W, H);
    g.lineTo((u0 + 0.075 * dir) * W, H);
    g.bezierCurveTo((u0 + 0.075 * dir) * W, H * 0.6, (u0 + 0.02 * dir) * W, H * 0.45, u0 * W, H * 0.25);
    g.closePath();
    g.fill();
    g.strokeStyle = team.tertiary || '#111';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo((u0 + 0.09 * dir) * W, H);
    g.bezierCurveTo((u0 + 0.09 * dir) * W, H * 0.58, (u0 + 0.03 * dir) * W, H * 0.4, u0 * W, H * 0.18);
    g.stroke();
  }
  // punta de la nariz
  g.fillStyle = team.tertiary || team.secondary;
  g.fillRect(0, H * 0.95, W, H * 0.05);
  const t = tex(c, { repeat: false });
  return t;
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

// Normal map tileable para el agua
export function makeWaterNormal() {
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) h[y * S + x] = tileFbm(x / 32, y / 32, 8, 4) + 0.5 * tileFbm(x / 11, y / 11, 23.27, 2);
  return normalFromHeight(h, S, 3.2);
}

// Pared de neumáticos apilados con bandas de color
export function makeTireWall() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#0d0d0f';
  g.fillRect(0, 0, 256, 128);
  const belts = ['#e10600', '#f4f4f4', '#1b3a8c', '#f4f4f4'];
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4; k++) {
      const cx = 32 + k * 64 + (row % 2) * 0, cy = 22 + row * 42;
      const grd = g.createRadialGradient(cx, cy, 4, cx, cy, 30);
      grd.addColorStop(0, '#050505');
      grd.addColorStop(0.35, '#1a1a1c');
      grd.addColorStop(0.8, '#2a2a2e');
      grd.addColorStop(1, '#101012');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(cx, cy, 30, 20, 0, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = belts[0];
  g.fillRect(0, 56, 256, 14);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 0, 256, 6);
  return tex(c);
}

// Franjas pintadas de las escapatorias asfaltadas
export function makeRunoffStripes(a = '#1b4fd6', b = '#f2f2f2') {
  const [c, g] = canvas(64, 256);
  g.fillStyle = a; g.fillRect(0, 0, 64, 256);
  g.fillStyle = b;
  for (let k = 0; k < 4; k++) g.fillRect(0, k * 64, 64, 22);
  return tex(c);
}

// Fachada de rascacielos con ventanas encendidas (para mapa emisivo)
export function makeCityWindows(seed = 3, lit = 0.45) {
  const W = 128, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  for (let y = 0; y < H; y += 8)
    for (let x = 0; x < W; x += 8) {
      if (rnd() > lit) continue;
      const warm = rnd();
      g.fillStyle = warm > 0.6 ? '#ffd9a0' : warm > 0.3 ? '#fff4e0' : '#9fd4ff';
      g.globalAlpha = 0.5 + rnd() * 0.5;
      g.fillRect(x + 1, y + 1, 5, 5);
    }
  g.globalAlpha = 1;
  return tex(c);
}

// Fachada diurna (vidrio y bandas)
export function makeFacade(seed = 1) {
  const [c, g] = canvas(128, 256);
  const rnd = mulberry32(seed);
  const base = ['#dfe4ea', '#c9d3dc', '#e8e1d6'][Math.floor(rnd() * 3)];
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let y = 4; y < 256; y += 16) {
    const grd = g.createLinearGradient(0, y, 0, y + 10);
    grd.addColorStop(0, '#6d8ba3'); grd.addColorStop(1, '#2d4458');
    g.fillStyle = grd;
    g.fillRect(4, y, 120, 10);
  }
  return tex(c);
}

// Calco con texto (números, nombres de equipo, sponsors)
export function makeDecal(text, { color = '#ffffff', stroke = null, w = 512, h = 256, font = 'Arial Black', weight = 900, italic = true, bg = null, pad = 0.86 } = {}) {
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  let fs = h * 0.8;
  const setFont = () => (g.font = `${italic ? 'italic ' : ''}${weight} ${fs}px "${font}", Arial, sans-serif`);
  setFont();
  while (g.measureText(text).width > w * pad && fs > 8) { fs -= 2; setFont(); }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (stroke) {
    g.lineWidth = fs * 0.08;
    g.strokeStyle = stroke;
    g.strokeText(text, w / 2, h / 2 + fs * 0.04);
  }
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + fs * 0.04);
  const t = tex(c, { repeat: false });
  return t;
}

// Casco con diseño del equipo (mapeo esférico)
export function makeHelmet(team) {
  const W = 256, H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = team.helmet || team.secondary;
  g.fillRect(0, 0, W, H);
  g.fillStyle = team.primary;
  g.fillRect(0, H * 0.46, W, H * 0.18);
  g.fillStyle = team.tertiary || '#111';
  g.fillRect(0, H * 0.4, W, H * 0.04);
  g.beginPath();
  g.moveTo(W * 0.1, 0); g.lineTo(W * 0.4, 0); g.lineTo(W * 0.3, H * 0.4); g.lineTo(W * 0.15, H * 0.4); g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(W * 0.6, 0); g.lineTo(W * 0.9, 0); g.lineTo(W * 0.85, H * 0.4); g.lineTo(W * 0.7, H * 0.4); g.closePath();
  g.fill();
  return tex(c, { repeat: false });
}

// Normal map de fibra de carbono
export function makeCarbonNormal() {
  const S = 64;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / 8), cy = Math.floor(y / 8);
      const odd = (cx + cy) % 2;
      const t = odd ? (x % 8) / 8 : (y % 8) / 8;
      h[y * S + x] = Math.sin(t * Math.PI);
    }
  return normalFromHeight(h, S, 1.2);
}

// Panel LED (gradiente) para estructuras nocturnas
export function makeLedPanel() {
  const [c, g] = canvas(256, 32);
  const grd = g.createLinearGradient(0, 0, 256, 0);
  const cols = ['#ff2d55', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ff2d55'];
  cols.forEach((col, k) => grd.addColorStop(k / (cols.length - 1), col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 32);
  for (let x = 0; x < 256; x += 4) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 1, 32); }
  return tex(c);
}

// Cielo estrellado nocturno (equirectangular simple)
export function makeGlow(color = '#ffffff') {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, color);
  grd.addColorStop(0.2, color);
  grd.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}

export function makeFlareRing() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); g.stroke();
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}
