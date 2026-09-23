// F19 Grand Prix — orquestador: render, carga de circuitos, estados de carrera y online.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Track } from './track.js';
import { Car, setCarEnvMap } from './car.js';
import { RaceSim } from './race.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { CameraRig, CAM_MODES, CAM_NAMES } from './camera.js';
import { HUD } from './hud.js';
import { Particles } from './particles.js';
import { setMaxAnisotropy } from './textures.js';
import { TEAMS, DRIVERS, codeFor } from './teams.js';
import { trackById } from './tracks.js';
import { World, Reflections } from './world.js';
import { Showroom } from './showroom.js';
import { Menu, bestKey, loadBest } from './menu.js';
import { Online } from './online.js';
import { clamp, mulberry32, formatTime } from './utils.js';

const STEP = 1 / 120;
const $ = (id) => document.getElementById(id);

export const QUALITY = {
  ultra: { pixelRatio: 2, maxPixels: 5.5e6, shadow: 4096, post: true, smaa: true, trees: 2600, terrainRes: 260, fences: true, animCrowd: true, crowd: 0.95, reflections: 2 },
  alta: { pixelRatio: 2, maxPixels: 3.7e6, shadow: 2048, post: true, smaa: true, trees: 1800, terrainRes: 220, fences: true, animCrowd: true, crowd: 0.88, reflections: 5 },
  media: { pixelRatio: 1.5, maxPixels: 2.2e6, shadow: 1024, post: true, smaa: false, trees: 1000, terrainRes: 160, fences: true, animCrowd: true, crowd: 0.6, reflections: 0 },
  baja: { pixelRatio: 1, maxPixels: 1.3e6, shadow: 0, post: false, smaa: false, trees: 450, terrainRes: 110, fences: false, animCrowd: false, crowd: 0.35, reflections: 0 },
};

const DIFFICULTY = {
  facil: { skill: [0.85, 0.9], grid: 9 },
  normal: { skill: [0.915, 0.95], grid: 7 },
  dificil: { skill: [0.96, 0.99], grid: 5 },
};

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Pase final: gradación de color, destello solar, viñeta y desenfoque radial por velocidad
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uSpeed: { value: 0 }, uSat: { value: 1 }, uCon: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSun: { value: new THREE.Vector2(-1, -1) }, uSunVis: { value: 0 }, uSunColor: { value: new THREE.Color(1, 0.9, 0.75) }, uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed; uniform float uSat; uniform float uCon; uniform vec3 uTint;
    uniform vec2 uSun; uniform float uSunVis; uniform vec3 uSunColor; uniform float uAspect;
    varying vec2 vUv;
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float occl(vec2 p){ return smoothstep(0.6, 0.93, luma(texture2D(tDiffuse, clamp(p, 0.001, 0.999)).rgb)); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      float k = smoothstep(0.18, 0.7, r) * uSpeed;
      vec3 c = vec3(0.0);
      for (int i = 0; i < 6; i++) c += texture2D(tDiffuse, vUv - d * (float(i) * 0.012 * k)).rgb;
      c /= 6.0;
      vec2 off = d * 0.003 * (0.4 + uSpeed);
      c.r = mix(c.r, texture2D(tDiffuse, vUv + off).r, 0.5);
      c.b = mix(c.b, texture2D(tDiffuse, vUv - off).b, 0.5);
      if (uSunVis > 0.0) {
        float o = (occl(uSun) + occl(uSun + vec2(0.008, 0.0)) + occl(uSun - vec2(0.008, 0.0)) + occl(uSun + vec2(0.0, 0.012)) + occl(uSun - vec2(0.0, 0.012))) / 5.0;
        float edge = smoothstep(-0.12, 0.04, uSun.x) * smoothstep(1.12, 0.96, uSun.x) * smoothstep(-0.12, 0.04, uSun.y) * smoothstep(1.12, 0.96, uSun.y);
        float vis = uSunVis * o * edge;
        vec2 q = vUv - uSun; q.x *= uAspect;
        float lq = length(q);
        float glow = exp(-lq * 7.0) * 0.12 + exp(-lq * 30.0) * 0.22;
        float streak = exp(-abs(q.y) * 140.0) * exp(-abs(q.x) * 3.0) * 0.1;
        // halo tenue en el lado opuesto de la pantalla
        vec2 gq = vUv - (vec2(1.0) - uSun); gq.x *= uAspect;
        float ghost = smoothstep(0.09, 0.02, abs(length(gq) - 0.07)) * 0.025;
        c += (uSunColor * (glow + streak) + vec3(0.6, 0.8, 1.0) * ghost) * vis;
      }
      float l = luma(c);
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uCon + 0.5;
      c *= uTint;
      c *= 1.0 - r * r * 0.7;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

function loadSettings() {
  const def = {
    mode: 'race', track: 'valle', weather: 'sol', team: 0, laps: 3, difficulty: 'normal',
    quality: isTouch ? 'media' : 'alta', assist: true, camera: 'chase', name: '', volume: 70,
  };
  try { return { ...def, ...JSON.parse(localStorage.getItem('f19-settings') || '{}') }; } catch { return def; }
}

function makeTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,16,0.78)';
  g.beginPath(); g.roundRect(0, 8, 256, 48, 10); g.fill();
  g.fillStyle = color; g.fillRect(0, 8, 10, 48);
  g.fillStyle = '#fff';
  g.font = '700 30px "Titillium Web", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 133, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.6, 0.65, 1);
  s.position.y = 1.75;
  s.renderOrder = 10;
  return s;
}

export class Game {
  constructor() {
    this.settings = loadSettings();
    this.q = QUALITY[this.settings.quality] || QUALITY.alta;
    this.state = 'loading';
    this.acc = 0;
    this.timer = new THREE.Timer();
    this.elapsed = 0;
    this.perf = { t: 0, frames: 0, scale: 1 };
    this.track = null;
    this.player = null;
    this.sim = null;
    this.screen = 'home';
  }

  saveSettings() {
    try { localStorage.setItem('f19-settings', JSON.stringify(this.settings)); } catch { /* sin almacenamiento */ }
  }

  async init() {
    const tick = (msg) => this._status(msg);
    await tick('Preparando motor gráfico…');
    this._renderer();
    this.world = new World(this.renderer, this.scene, this.q);
    this._cars();
    this.particles = new Particles(this.scene);
    this.input = new Input();
    this.input.bindTouch($('touch'));
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume / 100;
    this.rig = new CameraRig(this.camera);
    this.hud = new HUD(null);
    this.showroom = new Showroom();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.showroom.setEnvironment(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    pm.dispose();
    if (this.q.reflections) this.reflections = new Reflections(this.renderer, this.scene, 128);
    this.online = new Online(this);
    this.menu = new Menu(this);
    this._bindUI();
    await this.loadTrack(this.settings.track, this.settings.weather);
    this.startAttract();
    this._resize();
    addEventListener('resize', () => this._resize());
    const sala = new URLSearchParams(location.search).get('sala');
    if (sala) {
      $('join-code').value = sala.toUpperCase().slice(0, 4);
      this.menu.show('online');
    }
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _status(msg) {
    const el = $('loading');
    el.classList.remove('done');
    $('load-status').textContent = msg;
    return new Promise((r) => setTimeout(r, 30));
  }

  _hideLoading() { $('loading').classList.add('done'); }

  _pixelRatio() {
    const q = this.q;
    const dpr = Math.min(devicePixelRatio || 1, q.pixelRatio);
    const cap = Math.sqrt(q.maxPixels / (innerWidth * innerHeight));
    return Math.max(0.5, Math.min(dpr, cap) * this.perf.scale);
  }

  _renderer() {
    const q = this.q;
    const canvas = $('c');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.post, powerPreference: 'high-performance' }));
    r.setPixelRatio(this._pixelRatio());
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = q.shadow > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.25, 9000);
    if (q.post) {
      const comp = (this.composer = new EffectComposer(r));
      this.renderPass = new RenderPass(this.scene, this.camera);
      comp.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.35, 2.2);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.gradePass = new ShaderPass(GradeShader);
      comp.addPass(this.gradePass);
      if (q.smaa) comp.addPass(new SMAAPass());
    }
  }

  _cars() {
    this.cars = [];
    TEAMS.forEach((team, t) => {
      for (let seat = 0; seat < 2; seat++) {
        const car = new Car({ id: t * 2 + seat, team, driver: DRIVERS[t][seat], number: team.numbers[seat] });
        car.seat = seat;
        this.cars.push(car);
      }
    });
  }

  carById(id) { return this.cars[id]; }

  // ---------- Circuitos y clima ----------
  async loadTrack(id, weather) {
    const def = trackById(id);
    const sameTrack = this.track && this.track.def.id === def.id;
    if (sameTrack && this.weatherId === weather) return;
    if (!sameTrack) {
      await this._status(`Construyendo ${def.name}…`);
      if (this.sim) { for (const c of this.sim.cars) c.model.root.removeFromParent(); this.sim = null; }
      if (this.track) this.track.dispose();
      const t = new Track(def);
      t.build(this.q);
      this.scene.add(t.group);
      this.track = t;
      this.hud.setTrack(t);
      this.particles.clear();
    }
    this.weatherId = weather;
    this.world.setup(def, weather);
    this.track.setWet(this.world.wet);
    this.track.setGrip(this.world.gripMul);
    if (this.bloom) {
      this.bloom.strength = this.world.night ? 0.55 : 0.3;
      this.bloom.threshold = this.world.night ? 1.6 : def.env === 'sunset' ? 3.4 : 2.2;
    }
    if (this.reflections) setCarEnvMap(this.reflections.texture);
    if (!sameTrack) {
      await this._status('Compilando shaders…');
      try {
        if (this.renderer.extensions.has('KHR_parallel_shader_compile')) await this.renderer.compileAsync(this.scene, this.camera);
        else this.renderer.compile(this.scene, this.camera);
      } catch { /* opcional */ }
    }
    this._hideLoading();
  }

  async previewTrack(id) {
    if (this.state !== 'menu') return;
    await this.loadTrack(id, this.settings.weather);
    if (this.state === 'menu') this.startAttract();
  }

  async previewWeather(w) {
    if (this.state !== 'menu' || !this.track) return;
    await this.loadTrack(this.track.def.id, w);
  }

  onMenuScreen(screen) {
    const prev = this.screen;
    this.screen = screen;
    if (screen === 'garage') {
      const s = this.settings;
      this.showroom.setCar(TEAMS[s.team], TEAMS[s.team].numbers[1]);
      setCarEnvMap(null);
    } else if (prev === 'garage' && this.reflections) setCarEnvMap(this.reflections.texture);
  }

  onTeamChange() {
    const s = this.settings;
    if (this.screen === 'garage') this.showroom.setCar(TEAMS[s.team], TEAMS[s.team].numbers[1]);
    if (this.state === 'menu') this.focus = this.cars[s.team * 2 + 1];
  }

  // ---------- UI ----------
  _bindUI() {
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart').onclick = () => { this.hideOverlays(); this.startRace(); };
    $('btn-menu').onclick = () => this.toMenu();
    $('btn-again').onclick = () => {
      if (this.online.active) this.online.backToLobby();
      else { this.hideOverlays(); this.startRace(); }
    };
    $('btn-results-menu').onclick = () => this.toMenu();
    $('btn-sound').onclick = () => this.toggleMute();
    const fs = $('btn-fs');
    if (!document.documentElement.requestFullscreen) fs.classList.add('hidden');
    fs.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    };
    $('touch-pause').onclick = () => this.pause();
    $('touch-cam').onclick = () => this.cycleCamera();
    addEventListener('pointerdown', () => this.audio.init(), { once: true });
    addEventListener('keydown', () => this.audio.init(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.online.active && (this.state === 'race' || this.state === 'countdown')) this.pause();
    });
    // cambio de clima desde el menú
    const menuSet = this.menu._set.bind(this.menu);
    this.menu._set = (k, v) => { menuSet(k, v); if (k === 'weather') this.previewWeather(v); };
  }

  hideOverlays() {
    for (const id of ['pause', 'results']) $(id).classList.add('hidden');
    this.menu.hide();
  }

  toggleMute() {
    this.audio.init();
    this.audio.setMuted(!this.audio.muted);
    this.hud.message(this.audio.muted ? 'SONIDO APAGADO' : 'SONIDO ENCENDIDO', '', 1.2, 'small');
    this.menu.refresh();
  }

  cycleCamera() {
    const i = CAM_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.settings.camera = this.rig.mode;
    this.saveSettings();
    this.hud.showCamera(CAM_NAMES[this.rig.mode]);
    if (this.player) this.player.model.helmet.visible = this.rig.mode !== 'cockpit';
  }

  // ---------- Preparación de carreras ----------
  _setupSim(active, mode, laps) {
    for (const c of this.cars) {
      if (active.includes(c)) { if (!c.model.root.parent) this.scene.add(c.model.root); }
      else c.model.root.removeFromParent();
      c.model.helmet.visible = true;
      if (c.tag) { c.tag.removeFromParent(); c.tag = null; }
      c.human = false;
    }
    for (const c of active) {
      c.reset();
      c.ai = false; c.isPlayer = false; c.remote = false;
      c.gripMul = this.world.gripMul;
      c.driver = DRIVERS[TEAMS.indexOf(c.team)][c.seat];
    }
    this.sim = new RaceSim(this.track, active, { laps, mode });
    this.particles.clear();
  }

  startAttract() {
    if (this.online.active && this.online.racing) return;
    this.state = 'menu';
    this.player = null;
    const rnd = mulberry32(7);
    const order = [...this.cars].sort(() => rnd() - 0.5);
    this._setupSim(order, 'menu', 999);
    for (const c of order) {
      c.ai = true;
      c.aiDriver = new AIDriver(c, this.track, { skill: 0.9 + rnd() * 0.06, rnd });
    }
    this.sim.placeGrid(order);
    this.sim.start();
    this.focus = this.cars[this.settings.team * 2 + 1];
    this.rig.cine.shot = 0; this.rig.cine.t = 0;
    this.hud.show(false);
    $('touch').classList.add('hidden');
    for (const id of ['pause', 'results']) $(id).classList.add('hidden');
    this.menu.show(this.menu.screen || 'home');
    this.hud.setLights(0, false);
    this.track.setStartLights(0);
  }

  _preparePlayer(player, mode) {
    this.player = player;
    this.screen = 'race';
    if (this.reflections) setCarEnvMap(this.reflections.texture);
    player.ai = false; player.isPlayer = true;
    player.driver = { name: this.settings.name || 'Tú', code: this.settings.name ? codeFor(this.settings.name) : 'TÚ' };
    player.aiDriver = new AIDriver(player, this.track, { skill: 0.9 });
    this.rig.mode = this.settings.camera;
    this.rig.lookBack = false;
    this.rig.snap(player);
    player.model.helmet.visible = this.settings.camera !== 'cockpit';
    this.hideOverlays();
    this.hud.show(true);
    this.hud.el.root.classList.toggle('tt', mode === 'tt');
    $('online-badge').classList.toggle('hidden', !this.online.active);
    $('touch').classList.toggle('hidden', !isTouch);
    this.hud.setLights(0, mode !== 'tt');
    this.track.setStartLights(0);
    this.input.clearPressed();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.resultsShown = false;
    this.finishTimer = null;
    this.hideLightsAt = null;
  }

  async startRace() {
    if (this.online.active) return;
    const s = this.settings;
    await this.loadTrack(s.track, s.weather);
    const diff = DIFFICULTY[s.difficulty];
    const rnd = mulberry32((Date.now() & 0xffff) + 1);
    const player = this.cars[s.team * 2 + 1];
    const active = s.mode === 'tt' ? [player] : [...this.cars];
    this._setupSim(active, s.mode, s.mode === 'tt' ? 999 : s.laps);
    const ais = active.filter((c) => c !== player);
    ais.forEach((c, k) => {
      c.ai = true;
      const t = k / Math.max(1, ais.length - 1);
      const skill = diff.skill[1] - (diff.skill[1] - diff.skill[0]) * t + (rnd() - 0.5) * 0.01;
      c.aiDriver = new AIDriver(c, this.track, { skill, rnd });
    });
    this._preparePlayer(player, s.mode);
    if (s.mode === 'tt') {
      this.sim.placeCar(player, this.track.length - 180, this.track.lineAt(-180), 55);
      player.lap = 0;
      player.raceDist = player.s;
      this.sim.start();
      this.state = 'race';
      this.rig.snap(player);
      this.hud.message('CONTRARRELOJ', 'Vuelta lanzada: ¡cruzá la meta!', 2.5);
    } else {
      const grid = [...ais].sort((a, b) => b.aiDriver.skill - a.aiDriver.skill);
      grid.splice(Math.min(diff.grid, grid.length), 0, player);
      this.sim.placeGrid(grid);
      this.rig.snap(player);
      this.beginCountdown(5.5 + rnd() * 1.8);
      this.hud.message('PREPARADOS', 'Mantené el acelerador para revolucionar', 2.2);
    }
  }

  // Online: todos cargan el circuito y arman la parrilla indicada por el anfitrión
  async startOnlineRace(settings, grid, myId, isHost) {
    await this.loadTrack(settings.track, settings.weather);
    const diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    const rnd = mulberry32(99);
    const active = grid.map((g) => this.cars[g.car]);
    this._setupSim(active, 'race', settings.laps);
    let player = null;
    grid.forEach((g, k) => {
      const c = this.cars[g.car];
      if (g.owner && g.owner === myId) { player = c; return; }
      if (g.owner) {
        c.remote = true;
        c.human = true;
        c.driver = { name: g.name, code: g.code };
        c.tag = makeTag(g.name, c.team.primary);
        c.model.root.add(c.tag);
      } else if (isHost) {
        c.ai = true;
        const t = k / Math.max(1, grid.length - 1);
        c.aiDriver = new AIDriver(c, this.track, { skill: diff.skill[1] - (diff.skill[1] - diff.skill[0]) * t, rnd });
      } else {
        c.remote = true;
      }
    });
    this.sim.placeGrid(active);
    if (player) {
      this._preparePlayer(player, 'race');
      const me = grid.find((g) => g.owner === myId);
      player.driver = { name: me.name, code: me.code };
    }
    this.state = 'waiting';
    this.hud.message('ESPERANDO', 'Sincronizando con los demás pilotos…', 30, 'small');
  }

  beginCountdown(delay) {
    this.state = 'countdown';
    this.countdown = 0;
    this.lightsOut = delay;
    this.hud.setLights(0, true);
    this.hud.message('PREPARADOS', this.online.active ? 'Carrera online' : 'Mantené el acelerador para revolucionar', 2.2);
  }

  returnToLobby() {
    this.startAttract();
    this.menu.show('online');
  }

  onlineLost(reason) {
    this.menu.toast(reason, 4000);
    this.startAttract();
    this.menu.show('online');
  }

  convertToAI(carId) {
    const c = this.cars[carId];
    if (!c || !this.sim || !this.sim.cars.includes(c)) return;
    if (this.online.isHost) {
      c.remote = false;
      c.ai = true;
      c.human = false;
      c.vx = Math.sin(c.heading) * c.speed; c.vz = Math.cos(c.heading) * c.speed;
      c.aiDriver = new AIDriver(c, this.track, { skill: 0.92 });
      if (c.tag) { c.tag.removeFromParent(); c.tag = null; }
      c.driver = { ...c.driver, code: c.driver.code + '*' };
    }
  }

  pause() {
    if (!['race', 'countdown', 'finished', 'waiting'].includes(this.state)) return;
    $('pause').classList.remove('hidden');
    $('btn-restart').classList.toggle('hidden', this.online.active);
    $('pause-online').classList.toggle('hidden', !this.online.active);
    $('btn-restart').textContent = this.settings.mode === 'tt' ? 'Reiniciar vuelta' : 'Reiniciar carrera';
    $('btn-menu').textContent = this.online.active ? 'Salir de la sala' : 'Menú principal';
    if (this.online.active) { this.pausedOnline = true; return; }
    this.prevState = this.state;
    this.state = 'paused';
    if (this.audio.ctx) this.audio.ctx.suspend();
  }

  resume() {
    $('pause').classList.add('hidden');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (this.pausedOnline) { this.pausedOnline = false; return; }
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    if (this.audio.ctx) this.audio.ctx.resume();
    this.timer.update();
  }

  toMenu() {
    if (this.audio.ctx) this.audio.ctx.resume();
    this.pausedOnline = false;
    if (this.online.active) { this.online.leave(true); this.menu.screen = 'online'; }
    else this.menu.screen = 'home';
    this.startAttract();
    this.menu.onLobby(this.online);
  }

  showResults() {
    this.resultsShown = true;
    this._renderResults();
    const pos = this.player.position;
    $('results-title').textContent = pos === 1 ? '¡VICTORIA!' : pos <= 3 ? `¡PODIO! P${pos}` : `TERMINASTE P${pos}`;
    const on = this.online.active;
    $('btn-again').textContent = on ? 'Volver a la sala' : 'Revancha';
    $('btn-again').classList.toggle('hidden', on && !this.online.isHost);
    $('btn-results-menu').textContent = on ? 'Salir de la sala' : 'Menú';
    $('results').classList.remove('hidden');
    $('touch').classList.add('hidden');
  }

  _renderResults() {
    const sim = this.sim;
    const ranking = sim.ranking();
    const leader = ranking[0];
    let fastest = null;
    for (const c of ranking) if (c.bestLap != null && (!fastest || c.bestLap < fastest.bestLap)) fastest = c;
    const esc = (t) => String(t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    $('results-body').innerHTML = ranking.map((c, k) => {
      let time;
      if (k === 0) time = c.finished ? formatTime(c.finishTime) : 'En pista';
      else if (c.finished && leader.finished) time = `+${(c.finishTime - leader.finishTime).toFixed(3)}`;
      else {
        const lapsDown = Math.floor((leader.raceDist - c.raceDist) / this.track.length);
        time = lapsDown >= 1 ? `+${lapsDown} vuelta${lapsDown > 1 ? 's' : ''}` : 'En pista';
      }
      const tag = c.human ? ' 🌐' : c === this.player ? ' ★' : '';
      return `<tr class="${c === this.player ? 'me' : ''}">
        <td class="p">${k + 1}</td>
        <td><i style="background:${c.team.primary}"></i>${esc(c.driver.name)}${tag}</td>
        <td class="team-n">${c.team.name}</td>
        <td class="t">${time}</td>
        <td class="t ${c === fastest ? 'fl' : ''}">${formatTime(c.bestLap)}</td></tr>`;
    }).join('');
  }

  // ---------- Bucle ----------
  _adapt(raw) {
    const p = this.perf;
    p.t += raw; p.frames++;
    if (p.t < 2.5) return;
    const fps = p.frames / p.t;
    p.t = 0; p.frames = 0;
    let s = p.scale;
    if (fps < 45 && s > 0.55) s = Math.max(0.55, s - 0.12);
    else if (fps > 58 && s < 1) s = Math.min(1, s + 0.06);
    if (s !== p.scale) { p.scale = s; this._resize(); }
  }

  frame() {
    this.timer.update();
    const raw = this.timer.getDelta();
    if (this.state !== 'paused' && !document.hidden) this._adapt(raw);
    this.tick(Math.min(raw, 0.05), true);
  }

  tick(dt, render = true) {
    this.elapsed += dt;
    const input = this.input;
    input.update(dt);
    if (input.consume('pause')) {
      if (this.state === 'paused' || this.pausedOnline) this.resume();
      else if (this.state !== 'menu') this.pause();
      else if (this.menu.screen !== 'home' && document.activeElement?.tagName !== 'INPUT') this.menu.show('home');
    }
    if (input.consume('mute')) this.toggleMute();
    if (this.state === 'paused' || this.state === 'loading' || !this.sim) { if (render) this._render(dt); return; }
    const garage = this.state === 'menu' && this.screen === 'garage';
    if (garage) { this.showroom.update(dt, innerWidth > 900); if (render) this._render(dt); return; }
    if (input.consume('camera') && this.player && this.state !== 'menu') this.cycleCamera();
    this.rig.lookBack = (input.held('look') || input.padLook) && this.state !== 'menu';
    if (input.consume('respawn') && this.player && this.state === 'race' && !this.player.finished) this.sim.respawn(this.player);

    if (this.state === 'countdown') this._countdown(dt);
    this.online.update(dt, performance.now() / 1000);

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this._fixed(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    this._events();
    this._visuals(dt);
    if (render) this._render(dt);
  }

  _countdown(dt) {
    const prev = this.countdown;
    this.countdown += dt;
    for (let k = 1; k <= 5; k++) {
      if (prev < k && this.countdown >= k) {
        this.hud.setLights(k, true);
        this.track.setStartLights(k);
        this.audio.beep(520, 0.2, 0.2);
      }
    }
    if (prev < this.lightsOut && this.countdown >= this.lightsOut) {
      this.hud.setLights(0, true);
      this.track.setStartLights(0);
      this.audio.beep(1040, 0.5, 0.25);
      this.sim.start();
      this.state = 'race';
      this.hud.message('¡LUCES FUERA!', '', 1.5, 'go');
      this.hideLightsAt = 1.2;
    }
  }

  _playerInput() {
    const p = this.player;
    const inp = this.input;
    if (p.finished || this.state === 'finished') {
      p.aiDriver.update(STEP, this.sim.cars, this.sim.time, this.sim.started);
      p.drsOpen = false;
      return;
    }
    if (this.pausedOnline) { p.input.steer = 0; p.input.throttle = 0; p.input.brake = 0.4; return; }
    p.input.steer = inp.steer;
    p.input.throttle = inp.throttle;
    p.input.brake = inp.brake;
    if (this.settings.assist && this.sim.started && p.speed > 12) {
      const T = this.track;
      const vT = T.vmaxPlayer[Math.floor(((p.s + p.speed * 0.3) % T.length) / T.ds) % T.N];
      if (p.speed > vT + 1.5) {
        p.input.brake = Math.max(p.input.brake, clamp((p.speed - vT) * 0.22, 0, 1));
        p.input.throttle = 0;
      }
    }
    if ((inp.consume('drs') || inp.drsHeld) && p.drsAllowed && p.inDrsZone && !p.drsOpen && inp.brake < 0.1) p.drsOpen = true;
  }

  _fixed(h) {
    const sim = this.sim;
    const racing = this.state !== 'menu';
    if (this.player && racing) this._playerInput();
    for (const c of sim.cars) {
      if ((c === this.player && racing) || c.remote || !c.aiDriver) continue;
      c.aiDriver.update(h, sim.cars, sim.time, sim.started);
    }
    sim.step(h);
  }

  _events() {
    const sim = this.sim;
    const p = this.player;
    const camPos = this.camera.position;
    for (const e of sim.events) {
      const c = e.car;
      const near = Math.hypot(c.x - camPos.x, c.z - camPos.z) < 120;
      if (e.type === 'hit' || e.type === 'contact') {
        if (near) {
          this.particles.burst(c.x, c.y || 0, c.z, c.vx, c.vz, e.strength);
          this.audio.crash(e.strength * (c === p || e.other === p ? 1 : 0.5));
        }
        if (c === p || e.other === p) this.rig.addShake(Math.min(1.2, e.strength / 10));
      }
      if (!p || this.state === 'menu') continue;
      if (e.type === 'laptime' && c === p) {
        const t = e.time;
        let sub = '';
        if (this.settings.mode === 'tt' && !this.online.active) {
          const best = loadBest(this.track.def.id);
          if (!best || t < best) {
            try { localStorage.setItem(bestKey(this.track.def.id), JSON.stringify(t)); } catch { /* sin almacenamiento */ }
            sub = 'NUEVO RÉCORD';
          }
        }
        const fastest = sim.cars.every((o) => o === p || o.bestLap == null || o.bestLap >= t);
        if (!sub && fastest && p.bestLap === t && sim.cars.length > 1) sub = 'VUELTA RÁPIDA';
        this.hud.message(formatTime(t), sub, 3, sub ? 'purple' : 'time');
      } else if (e.type === 'lap' && c === p && sim.mode === 'race') {
        if (p.lap === sim.laps) setTimeout(() => this.hud.message('ÚLTIMA VUELTA', '', 2.2, 'final'), 1500);
        else if (p.lap > 1) setTimeout(() => this.hud.message(`VUELTA ${p.lap}/${sim.laps}`, '', 1.8, 'small'), 1500);
      } else if (e.type === 'finish' && c === p) {
        this.state = 'finished';
        const pos = sim.ranking().indexOf(p) + 1;
        this.hud.message('🏁 BANDERA A CUADROS', `Terminaste P${pos}`, 4, 'final');
        this.finishTimer = 3.5;
        this.rig.mode = 'tv';
        p.model.helmet.visible = true;
      } else if (e.type === 'respawn' && c === p) {
        this.rig.snap(p);
      }
    }
    sim.events.length = 0;
  }

  _visuals(dt) {
    const sim = this.sim;
    const camPos = this.camera.position;
    const wet = this.world.wet;
    for (const c of sim.cars) {
      const v = Math.abs(c.speed);
      c.bump = c.surface === 1 ? Math.sin(this.elapsed * 60 + c.id) * 0.012 * Math.min(1, v / 20)
        : c.surface === 2 || c.surface === 3 ? (Math.random() - 0.5) * 0.03 * Math.min(1, v / 15) : 0;
      c.syncModel(dt, wet);
      if (Math.hypot(c.x - camPos.x, c.z - camPos.z) < 220) this.particles.carEffects(c, dt, wet);
    }
    this.particles.update(dt);
    this.track.update(this.elapsed);

    const focus = this.state === 'menu' ? this.focus : this.player;
    const mode = this.state === 'menu' ? 'cine' : this.rig.mode;
    this.rig.update(dt, focus, this.track, mode);
    for (const c of sim.cars) {
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      c.model.root.visible = c === focus || d > 3.6;
      if (c.tag) {
        c.tag.visible = d < 220 && c !== this.player;
        c.tag.material.opacity = clamp(1.4 - d / 160, 0.25, 1);
      }
    }
    this.world.update(this.elapsed, this.camera, focus);
    if (this.reflections && this.state !== 'loading') {
      const hide = sim.cars.map((c) => c.model.root);
      hide.push(this.particles.smoke.points, this.particles.sparks.points);
      this.reflections.update(focus, hide, this.q.reflections);
    }

    // Audio
    const others = [];
    for (const c of sim.cars) {
      if (c === this.player && this.state !== 'menu') continue;
      const dx = c.x - camPos.x, dz = c.z - camPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 160) continue;
      const radial = dist > 0.1 ? (c.vx * dx + c.vz * dz) / dist : 0;
      others.push({ car: c, dist, radial });
    }
    others.sort((a, b) => a.dist - b.dist);
    const ref = this.player || focus;
    const nearStand = Math.min(ref.s, this.track.length - ref.s) < 300;
    this.audio.update(this.state === 'menu' ? null : this.player, others, {
      inCockpit: this.rig.mode === 'cockpit', active: true, crowdLevel: nearStand ? 1 : 0.2,
    });

    if (this.player && this.state !== 'menu') {
      this.hud.update(dt, sim, this.player, { mode: sim.mode === 'tt' ? 'tt' : 'race', laps: sim.laps });
      this.hud.drawMap(sim.cars, this.player);
    } else this.hud.update(dt, sim, null, {});

    if (this.hideLightsAt != null && sim.started && sim.time > this.hideLightsAt) {
      this.hideLightsAt = null;
      this.hud.setLights(0, false);
    }
    if (this.finishTimer != null) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0 && !this.resultsShown) { this.finishTimer = null; this.showResults(); }
    }
    if (this.resultsShown && this.state === 'finished') {
      this.resultsT = (this.resultsT || 0) - dt;
      if (this.resultsT <= 0) { this.resultsT = 0.5; this._renderResults(); }
    }
    if (this.gradePass) {
      const u = this.gradePass.uniforms;
      const onboard = this.state !== 'menu' && this.rig.mode !== 'tv';
      u.uSpeed.value = onboard && this.player ? clamp((Math.abs(this.player.speed) - 45) / 50, 0, 1) : 0;
      const g = this.world.grade;
      u.uSat.value = g.sat; u.uCon.value = g.con; u.uTint.value.set(...g.tint);
      const sun = this.world.sunScreen(this.camera, this._sun || (this._sun = {}));
      u.uSun.value.set(sun.x, sun.y);
      u.uSunVis.value = sun.vis;
      u.uSunColor.value.copy(this.world.sunColor || u.uSunColor.value);
      u.uAspect.value = innerWidth / innerHeight;
    }
  }

  _render() {
    const garage = this.state === 'menu' && this.screen === 'garage';
    const scene = garage ? this.showroom.scene : this.scene;
    const camera = garage ? this.showroom.camera : this.camera;
    const h = this.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y;
    this.particles.setScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    if (this.composer) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      if (garage) { this.gradePass.uniforms.uSunVis.value = 0; this.gradePass.uniforms.uSpeed.value = 0; }
      this.composer.render();
    } else this.renderer.render(scene, camera);
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.showroom && this.showroom.resize(w, h);
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }
}
