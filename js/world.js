// Ambiente: cielo, sol, niebla, mapa de entorno, clima y reflejos dinámicos.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { lerp } from './utils.js';

export const ENVS = {
  day: {
    elev: 32, azim: 215, sunColor: 0xfff0dc, sunI: 3.2,
    sky: { turbidity: 4.5, rayleigh: 1.3, mie: 0.004, mieG: 0.86, clouds: 0.38, density: 0.55 },
    fog: [0xbfd0de, 500, 5200], exposure: 0.62, hemi: [0xbcd6ff, 0x46503a, 0.45], envI: 0.85,
    grade: { sat: 1.08, con: 1.04, tint: [1, 1, 1] },
  },
  sunset: {
    elev: 6.5, azim: 180, sunColor: 0xffa868, sunI: 2.3,
    sky: { turbidity: 7, rayleigh: 2.4, mie: 0.006, mieG: 0.93, clouds: 0.3, density: 0.45 },
    fog: [0xc99a86, 350, 4300], exposure: 0.48, hemi: [0xffc6a0, 0x3a3040, 0.6], envI: 0.9,
    grade: { sat: 1.03, con: 1.05, tint: [1.02, 0.99, 0.96] },
  },
  night: {
    night: true, elev: 62, azim: 30, sunColor: 0xe6eeff, sunI: 2.2,
    fog: [0x0b1020, 230, 1800], exposure: 0.95, hemi: [0x33456e, 0x141414, 0.6], envI: 0.75,
    grade: { sat: 1.1, con: 1.08, tint: [0.98, 1.0, 1.05] },
  },
};

const NIGHT_SKY = {
  uniforms: { uTop: { value: new THREE.Color(0x02040b) }, uHorizon: { value: new THREE.Color(0x1b2140) }, uGlow: { value: new THREE.Color(0x4a3350) }, uMoon: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() }, uCloud: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `
    uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uMoon; uniform float uCloud;
    varying vec3 vDir;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.2, 1.0);
      vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.45));
      col += uGlow * exp(-max(h, 0.0) * 9.0) * 0.8;
      // estrellas
      vec3 g = floor(d * 380.0);
      float s = hash(g);
      float star = step(0.9975, s) * smoothstep(0.0, 0.15, h) * (1.0 - uCloud);
      col += vec3(star) * (0.6 + 0.4 * hash(g + 3.0)) * 1.4;
      // luna
      float m = dot(d, uMoon);
      col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9996, m) * 3.0 * (1.0 - uCloud * 0.8);
      col += vec3(0.5, 0.55, 0.7) * pow(max(m, 0.0), 400.0) * 0.5 * (1.0 - uCloud);
      if (d.y < 0.0) col = mix(col, uHorizon * 0.5, clamp(-d.y * 6.0, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Cielo cubierto para la lluvia: gradiente gris con nubes en movimiento
const OVERCAST_SKY = {
  uniforms: { uTop: { value: new THREE.Color(0x4b535d) }, uHorizon: { value: new THREE.Color(0x98a1ab) }, uTime: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `
    uniform vec3 uTop; uniform vec3 uHorizon; uniform float uTime;
    varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += noise(p) * a; p *= 2.02; a *= 0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uHorizon, uTop, pow(h, 0.6));
      vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
      float n = fbm(uv);
      col *= 0.78 + n * 0.42;
      if (d.y < 0.0) col = uHorizon * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Lluvia en GPU: segmentos que caen alrededor de la cámara
const RAIN = {
  vertexShader: `
    attribute vec4 seed;
    uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind;
    varying float vA;
    void main(){
      vec3 base = seed.xyz;
      float speed = 0.9 + seed.w * 0.4;
      vec3 p = base * uBox;
      p.y -= uTime * 22.0 * speed;
      p.xz += uWind * uTime * speed;
      p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
      float tail = position.y;
      p.y += tail * 0.9;
      p.xz -= uWind * tail * 0.04;
      vA = 0.35 + seed.w * 0.25;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.76, 0.82, vA); }`,
};

export class World {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.q = quality;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.objects = [];
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.sun.layers.enable(2);
    this.hemi.layers.enable(2);
    if (quality.shadow) {
      const S = 75;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadow, quality.shadow);
      Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 900 });
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.04;
      this.shadowSpan = S * 2;
    }
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.grade = { sat: 1, con: 1, tint: [1, 1, 1] };
  }

  setup(def, weatherId) {
    this.clear();
    const env = ENVS[def.env] || ENVS.day;
    const rain = weatherId === 'lluvia';
    const cloudy = weatherId === 'nublado' || rain;
    this.env = env;
    this.weather = weatherId;
    this.night = !!env.night;
    const scene = this.scene;
    const elev = THREE.MathUtils.degToRad(env.elev), azim = THREE.MathUtils.degToRad(env.azim);
    this.sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, azim);

    // Cielo
    let envScene;
    if (env.night) {
      const mat = new THREE.ShaderMaterial({ ...NIGHT_SKY, uniforms: THREE.UniformsUtils.clone(NIGHT_SKY.uniforms), side: THREE.BackSide, depthWrite: false });
      mat.uniforms.uCloud.value = cloudy ? (rain ? 1 : 0.7) : 0;
      if (cloudy) { mat.uniforms.uHorizon.value.set(0x20242e); mat.uniforms.uTop.value.set(0x07080c); }
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
      this.sky.frustumCulled = false;
      envScene = this._nightEnvScene(mat);
    } else if (rain) {
      const mat = new THREE.ShaderMaterial({ ...OVERCAST_SKY, uniforms: THREE.UniformsUtils.clone(OVERCAST_SKY.uniforms), side: THREE.BackSide, depthWrite: false });
      if (def.env === 'sunset') { mat.uniforms.uHorizon.value.set(0xa39486); mat.uniforms.uTop.value.set(0x4d4a50); }
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
      this.sky.frustumCulled = false;
      envScene = new THREE.Scene();
      const es = new THREE.Mesh(new THREE.SphereGeometry(45, 24, 12), mat.clone());
      envScene.add(es);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0x2c3128 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1;
      envScene.add(ground);
    } else {
      const sky = (this.sky = new Sky());
      sky.scale.setScalar(10000);
      const u = sky.material.uniforms;
      const s = env.sky;
      u.turbidity.value = cloudy ? 8 : s.turbidity;
      u.rayleigh.value = cloudy ? 1.0 : s.rayleigh;
      u.mieCoefficient.value = s.mie;
      u.mieDirectionalG.value = s.mieG;
      u.cloudCoverage.value = cloudy ? 0.72 : s.clouds;
      u.cloudDensity.value = cloudy ? 0.75 : s.density;
      u.cloudElevation.value = 0.6;
      u.sunPosition.value.copy(this.sunDir);
      envScene = this._skyEnvScene(u);
    }
    this.sky.renderOrder = -1;
    this.sky.layers.enable(2);
    scene.add(this.sky);
    this.objects.push(this.sky);

    const envRT = this.pmrem.fromScene(envScene, 0.02);
    envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    if (this.envRT) this.envRT.dispose();
    this.envRT = envRT;
    scene.environment = envRT.texture;
    scene.environmentIntensity = env.envI * (rain && !env.night ? 1.1 : cloudy && !env.night ? 0.8 : 1);

    // Luces
    const sunMul = rain ? 0.22 : cloudy ? 0.38 : 1;
    this.sun.color.set(env.sunColor);
    if (cloudy && !env.night) this.sun.color.lerp(new THREE.Color(0xdfe6ee), 0.6);
    this.sun.intensity = env.sunI * (env.night ? (rain ? 0.8 : 1) : sunMul);
    this.hemi.color.set(env.hemi[0]);
    this.hemi.groundColor.set(env.hemi[1]);
    this.hemi.intensity = env.hemi[2] * (rain && !env.night ? 1.3 : cloudy && !env.night ? 1.7 : 1);

    // Niebla
    const fogCol = new THREE.Color(env.fog[0]);
    let near = env.fog[1], far = env.fog[2];
    if (cloudy) {
      fogCol.lerp(new THREE.Color(env.night ? 0x10141c : 0xa9b3bd), rain ? 0.85 : 0.6);
      near *= rain ? 0.3 : 0.6; far *= rain ? 0.3 : 0.65;
    }
    scene.fog = new THREE.Fog(fogCol, near, far);
    this.renderer.toneMappingExposure = env.exposure * (rain && !env.night ? 1.0 : cloudy && !env.night ? 1.1 : 1);

    const g = env.grade;
    this.grade = {
      sat: g.sat * (rain ? 0.82 : cloudy ? 0.9 : 1),
      con: g.con,
      tint: rain ? [0.97, 1.0, 1.04] : g.tint,
    };
    this.flare = !env.night && !cloudy;
    this.sunColor = new THREE.Color(env.sunColor);

    if (rain) this._rain();
    this.wet = rain;
    this.gripMul = rain ? 0.82 : 1;
  }

  _skyEnvScene(u) {
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(50);
    for (const k of Object.keys(u)) {
      const val = u[k].value;
      envSky.material.uniforms[k].value = val && val.clone ? val.clone() : val;
    }
    envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0x3d4a32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    envScene.add(ground);
    return envScene;
  }

  _nightEnvScene(skyMat) {
    const envScene = new THREE.Scene();
    const s = new THREE.Mesh(new THREE.SphereGeometry(45, 24, 12), skyMat.clone());
    s.material.side = THREE.BackSide;
    envScene.add(s);
    // paneles luminosos que simulan los reflectores del circuito
    const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(6), side: THREE.DoubleSide });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.5), lm);
      p.position.set(Math.cos(a) * 30, 9 + (k % 3) * 2, Math.sin(a) * 30);
      p.lookAt(0, 0, 0);
      envScene.add(p);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0x1a1c20 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    envScene.add(ground);
    return envScene;
  }

  _rain() {
    const N = this.q.shadow >= 2048 ? 7000 : 4000;
    const pos = new Float32Array(N * 2 * 3);
    const seed = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let v = 0; v < 2; v++) {
        pos[(i * 2 + v) * 3 + 1] = v; // 0 = cabeza, 1 = cola
        seed.set(s, (i * 2 + v) * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      ...RAIN,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(70, 40, 70) }, uWind: { value: new THREE.Vector2(2.5, 1.2) } },
      transparent: true, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    this.objects.push(this.rain);
  }

  update(t, camera, focus) {
    if (this.sky) {
      this.sky.position.copy(camera.position);
      const su = this.sky.material.uniforms;
      if (su.time) su.time.value = t;
      if (su.uTime) su.uTime.value = t;
    }
    if (this.shadowSpan && focus) {
      const texel = this.shadowSpan / this.q.shadow;
      const fx = focus.x + Math.sin(focus.heading) * 20, fz = focus.z + Math.cos(focus.heading) * 20;
      const tx = Math.round(fx / texel) * texel, tz = Math.round(fz / texel) * texel;
      const ty = focus.y || 0;
      this.sun.target.position.set(tx, ty, tz);
      this.sun.position.set(tx, ty, tz).addScaledVector(this.sunDir, 400);
      this.sun.target.updateMatrixWorld();
    }
    if (this.rain) {
      const u = this.rain.material.uniforms;
      u.uTime.value = t;
      u.uCam.value.copy(camera.position);
    }
  }

  // Posición del sol en pantalla para el destello (x, y en 0..1; visible)
  sunScreen(camera, out) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.copy(this.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    out.x = v.x * 0.5 + 0.5;
    out.y = v.y * 0.5 + 0.5;
    const front = v.z < 1;
    const inView = out.x > -0.3 && out.x < 1.3 && out.y > -0.3 && out.y < 1.3;
    out.vis = this.flare && front && inView ? 1 : 0;
    return out;
  }

  clear() {
    for (const o of this.objects) {
      o.removeFromParent();
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    this.objects = [];
    this.sky = null;
    this.rain = null;
  }
}

// Reflejos dinámicos: cubemap de baja resolución alrededor del foco
export const REFLECT_LAYER = 2;

export class Reflections {
  constructor(renderer, scene, size = 128) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(1, 1200, this.rt);
    // solo ve la capa 2 (cielo, pista, muros y edificios): mucho más barato
    this.cam.children.forEach((c) => c.layers.set(REFLECT_LAYER));
    this.frame = 0;
  }

  get texture() { return this.rt.texture; }

  update(pos, hide, every = 4) {
    this.frame++;
    if (this.frame > 2 && this.frame % every !== 0) return;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.cam.position.set(pos.x, (pos.y || 0) + 1.2, pos.z);
    this.cam.update(this.renderer, this.scene);
    this.rt.texture.needsPMREMUpdate = true;
    hide.forEach((o, k) => (o.visible = vis[k]));
  }

  dispose() { this.rt.dispose(); }
}

export function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
