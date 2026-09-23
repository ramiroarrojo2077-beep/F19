// F19 Grand Prix — punto de entrada: render, bucle de juego y menús.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { RaceSim, resetCarState } from './race.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { CameraRig, CAM_MODES, CAM_NAMES } from './camera.js';
import { HUD } from './hud.js';
import { Particles } from './particles.js';
import { setMaxAnisotropy } from './textures.js';
import { TEAMS, DRIVERS, PLAYER_DRIVER } from './teams.js';
import { clamp, mulberry32, formatTime } from './utils.js';

const STEP = 1 / 120;

const QUALITY = {
  alta: { pixelRatio: 2, maxPixels: 3.7e6, shadow: 2048, post: true, smaa: true, trees: 1800, terrainRes: 220, fences: true, animCrowd: true },
  media: { pixelRatio: 1.5, maxPixels: 2.2e6, shadow: 1024, post: true, smaa: false, trees: 1000, terrainRes: 160, fences: true, animCrowd: true },
  baja: { pixelRatio: 1, maxPixels: 1.3e6, shadow: 0, post: false, smaa: false, trees: 450, terrainRes: 110, fences: false, animCrowd: false },
};

const DIFFICULTY = {
  facil: { skill: [0.85, 0.9], grid: 9 },
  normal: { skill: [0.915, 0.95], grid: 7 },
  dificil: { skill: [0.96, 0.99], grid: 5 },
};

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function loadSettings() {
  const def = { mode: 'race', team: 0, laps: 3, difficulty: 'normal', quality: isTouch ? 'media' : 'alta', assist: true, camera: 'chase' };
  try {
    const s = JSON.parse(localStorage.getItem('f19-settings') || '{}');
    return { ...def, ...s };
  } catch { return def; }
}
function saveSettings(s) {
  try { localStorage.setItem('f19-settings', JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}
function loadBest() {
  try { return JSON.parse(localStorage.getItem('f19-best') || 'null'); } catch { return null; }
}
function saveBest(t) {
  try { localStorage.setItem('f19-best', JSON.stringify(t)); } catch { /* sin almacenamiento */ }
}

// Pase final: viñeta, aberración cromática y desenfoque radial por velocidad
const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      float k = smoothstep(0.18, 0.7, r) * uSpeed;
      vec3 c = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        vec2 uv = vUv - d * (float(i) * 0.012 * k);
        c += texture2D(tDiffuse, uv).rgb;
      }
      c /= 6.0;
      vec2 off = d * 0.004 * (0.3 + uSpeed);
      c.r = mix(c.r, texture2D(tDiffuse, vUv + off).r, 0.5);
      c.b = mix(c.b, texture2D(tDiffuse, vUv - off).b, 0.5);
      c *= 1.0 - r * r * 0.7;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

class Game {
  constructor() {
    this.settings = loadSettings();
    this.q = QUALITY[this.settings.quality] || QUALITY.alta;
    this.state = 'loading';
    this.acc = 0;
    this.best = loadBest();
    this.timer = new THREE.Timer();
    this.elapsed = 0;
    this.perf = { t: 0, frames: 0, scale: 1 };
  }

  async init() {
    const status = document.getElementById('load-status');
    const tick = (msg) => new Promise((r) => { status.textContent = msg; setTimeout(r, 30); });

    await tick('Preparando motor gráfico…');
    this._renderer();
    await tick('Construyendo circuito…');
    this.track = new Track();
    this.track.build(this.scene, this.q);
    await tick('Preparando autos…');
    this._cars();
    this.particles = new Particles(this.scene);
    this.input = new Input();
    this.input.bindTouch(document.getElementById('touch'));
    this.audio = new AudioEngine();
    this.rig = new CameraRig(this.camera);
    this.hud = new HUD(this.track);
    this._ui();
    await tick('Compilando shaders…');
    this.startAttract();
    this.rig.update(0.016, this.focus, this.track, 'cine');
    try {
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch { /* opcional */ }
    this._resize();
    addEventListener('resize', () => this._resize());
    const loading = document.getElementById('loading');
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 1200);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _renderer() {
    const q = this.q;
    const canvas = document.getElementById('c');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.post, powerPreference: 'high-performance' }));
    r.setPixelRatio(this._pixelRatio());
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = q.shadow > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.25, 9000);

    // Cielo con nubes
    const sky = (this.sky = new Sky());
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.86;
    u.cloudCoverage.value = 0.38;
    u.cloudDensity.value = 0.55;
    u.cloudElevation.value = 0.6;
    const elev = THREE.MathUtils.degToRad(30), azim = THREE.MathUtils.degToRad(215);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    // Mapa de entorno a partir del cielo (reflejos en la pintura)
    const pmrem = new THREE.PMREMGenerator(r);
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
    this.envRT = pmrem.fromScene(envScene, 0.02);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    scene.fog = new THREE.Fog(0xbfd0de, 500, 5200);

    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 3.2));
    sun.position.copy(this.sunDir).multiplyScalar(400);
    if (q.shadow) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      const S = 75;
      Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 900 });
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.04;
      this.shadowSpan = S * 2;
    }
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x46503a, 0.45));

    if (q.post) {
      const comp = (this.composer = new EffectComposer(r));
      comp.addPass(new RenderPass(scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.28, 0.35, 2.4);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.speedPass = new ShaderPass(SpeedShader);
      comp.addPass(this.speedPass);
      if (q.smaa) comp.addPass(new SMAAPass());
    }
  }

  _cars() {
    this.cars = [];
    TEAMS.forEach((team, t) => {
      for (let seat = 0; seat < 2; seat++) {
        const car = new Car({ id: t * 2 + seat, team, driver: DRIVERS[t][seat] });
        car.seat = seat;
        car.aiDriver = null;
        this.scene.add(car.model.root);
        this.cars.push(car);
      }
    });
  }

  // ---------- Interfaz ----------
  _ui() {
    const s = this.settings;
    const menu = document.getElementById('menu');
    // equipos
    const teamsEl = document.getElementById('teams');
    TEAMS.forEach((t, k) => {
      const b = document.createElement('button');
      b.className = 'team';
      b.style.setProperty('--c1', t.primary);
      b.style.setProperty('--c2', t.secondary);
      b.innerHTML = `<i></i><span>${t.name}</span><small>${DRIVERS[k][0].code} · TÚ</small>`;
      b.onclick = () => { s.team = k; this._refreshMenu(); this._focusMenuCar(); saveSettings(s); };
      teamsEl.appendChild(b);
    });
    menu.querySelectorAll('[data-opt]').forEach((group) => {
      const key = group.dataset.opt;
      group.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          let v = b.dataset.v;
          if (key === 'laps') v = +v;
          if (key === 'assist') v = v === '1';
          const prevQ = s.quality;
          s[key] = v;
          saveSettings(s);
          this._refreshMenu();
          if (key === 'quality' && v !== prevQ) {
            document.getElementById('quality-note').classList.add('show');
          }
        };
      });
    });
    document.getElementById('btn-start').onclick = () => { this.audio.init(); this.startRace(); };
    document.getElementById('btn-reload').onclick = () => location.reload();
    document.getElementById('btn-resume').onclick = () => this.resume();
    document.getElementById('btn-restart').onclick = () => { this.hideOverlays(); this.startRace(); };
    document.getElementById('btn-menu').onclick = () => this.toMenu();
    document.getElementById('btn-again').onclick = () => { this.hideOverlays(); this.startRace(); };
    document.getElementById('btn-results-menu').onclick = () => this.toMenu();
    document.getElementById('btn-sound').onclick = () => this.toggleMute();
    const fs = document.getElementById('btn-fs');
    if (!document.documentElement.requestFullscreen) fs.classList.add('hidden');
    fs.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    };
    document.getElementById('touch-pause').onclick = () => this.pause();
    document.getElementById('touch-cam').onclick = () => this.cycleCamera();
    addEventListener('pointerdown', () => this.audio.init(), { once: true });
    addEventListener('keydown', () => this.audio.init(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'race' || this.state === 'countdown')) this.pause();
    });
    this._refreshMenu();
  }

  _refreshMenu() {
    const s = this.settings;
    document.querySelectorAll('#teams .team').forEach((b, k) => b.classList.toggle('sel', k === s.team));
    document.querySelectorAll('#menu [data-opt]').forEach((group) => {
      const key = group.dataset.opt;
      group.querySelectorAll('button').forEach((b) => {
        let v = b.dataset.v;
        if (key === 'laps') v = +v;
        if (key === 'assist') v = v === '1';
        b.classList.toggle('sel', s[key] === v);
      });
    });
    document.getElementById('race-opts').classList.toggle('dim', s.mode === 'tt');
    const best = document.getElementById('best-tt');
    best.textContent = this.best ? `Récord contrarreloj: ${formatTime(this.best)}` : 'Sin récord de contrarreloj todavía';
    document.getElementById('btn-sound').textContent = this.audio && this.audio.muted ? '🔇' : '🔊';
  }

  _focusMenuCar() {
    this.focus = this.cars[this.settings.team * 2 + 1];
    this.rig.cine.t = 0;
  }

  hideOverlays() {
    for (const id of ['menu', 'pause', 'results']) document.getElementById(id).classList.add('hidden');
  }

  toggleMute() {
    this.audio.init();
    this.audio.setMuted(!this.audio.muted);
    this.hud.message(this.audio.muted ? 'SONIDO APAGADO' : 'SONIDO ENCENDIDO', '', 1.2, 'small');
    this._refreshMenu();
  }

  cycleCamera() {
    const i = CAM_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.settings.camera = this.rig.mode;
    saveSettings(this.settings);
    this.hud.showCamera(CAM_NAMES[this.rig.mode]);
  }

  // ---------- Estados ----------
  _setupSim(active, mode, laps) {
    for (const c of this.cars) {
      c.model.root.visible = active.includes(c);
      c.model.helmet.visible = true;
    }
    for (const c of active) { c.reset(); }
    this.sim = new RaceSim(this.track, active, { laps, mode });
    this.particles.clear();
  }

  startAttract() {
    this.state = 'menu';
    this.player = null;
    const rnd = mulberry32(7);
    const order = [...this.cars].sort(() => rnd() - 0.5);
    this._setupSim(order, 'menu', 999);
    for (const c of order) {
      c.ai = true; c.isPlayer = false;
      c.aiDriver = new AIDriver(c, this.track, { skill: 0.9 + rnd() * 0.06, rnd });
    }
    this.sim.placeGrid(order);
    this.sim.start();
    this._focusMenuCar();
    this.rig.cine.shot = 0;
    this.hud.show(false);
    document.getElementById('touch').classList.add('hidden');
    this.hideOverlays();
    document.getElementById('menu').classList.remove('hidden');
    this.hud.setLights(0, false);
    this.track.setStartLights(0);
  }

  startRace() {
    const s = this.settings;
    const diff = DIFFICULTY[s.difficulty];
    const rnd = mulberry32((Date.now() & 0xffff) + 1);
    const player = this.cars[s.team * 2 + 1];
    this.player = player;
    let active;
    if (s.mode === 'tt') active = [player];
    else active = [...this.cars];
    this._setupSim(active, s.mode, s.mode === 'tt' ? 999 : s.laps);
    // IA
    const ais = active.filter((c) => c !== player);
    ais.forEach((c, k) => {
      c.ai = true; c.isPlayer = false;
      const t = k / Math.max(1, ais.length - 1);
      const skill = diff.skill[1] - (diff.skill[1] - diff.skill[0]) * t + (rnd() - 0.5) * 0.01;
      c.aiDriver = new AIDriver(c, this.track, { skill, rnd });
    });
    player.ai = false; player.isPlayer = true;
    player.driver = PLAYER_DRIVER;
    player.aiDriver = new AIDriver(player, this.track, { skill: 0.9, rnd });
    // restaurar nombre de los otros pilotos
    this.cars.forEach((c) => { if (c !== player) c.driver = DRIVERS[TEAMS.indexOf(c.team)][c.seat]; });

    if (s.mode === 'tt') {
      this.sim.placeCar(player, this.track.length - 180, this.track.lineAt(-180), 55);
      player.lap = 0;
      player.raceDist = player.s;
      this.sim.start();
      this.state = 'race';
      this.hud.message('CONTRARRELOJ', 'Vuelta lanzada: ¡cruzá la meta!', 2.5);
    } else {
      const grid = [...ais].sort((a, b) => b.aiDriver.skill - a.aiDriver.skill);
      grid.splice(Math.min(diff.grid, grid.length), 0, player);
      this.sim.placeGrid(grid);
      this.state = 'countdown';
      this.countdown = 0;
      this.lightsOut = 5 + 0.5 + rnd() * 1.8;
      this.lightsShown = 0;
      this.hud.message('PREPARADOS', 'Mantené el acelerador para revolucionar', 2.2);
    }
    this.rig.mode = s.camera;
    this.rig.lookBack = false;
    this.rig.snap(player);
    player.model.helmet.visible = s.camera !== 'cockpit';
    this.hideOverlays();
    this.hud.show(true);
    this.hud.el.root.classList.toggle('tt', s.mode === 'tt');
    document.getElementById('touch').classList.toggle('hidden', !isTouch);
    this.hud.setLights(0, s.mode !== 'tt');
    this.track.setStartLights(0);
    this.input.clearPressed();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.resultsShown = false;
    this.finishTimer = null;
    this.hideLightsAt = null;
  }

  pause() {
    if (this.state !== 'race' && this.state !== 'countdown' && this.state !== 'finished') return;
    this.prevState = this.state;
    this.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    document.getElementById('btn-restart').textContent = this.settings.mode === 'tt' ? 'Reiniciar vuelta' : 'Reiniciar carrera';
    if (this.audio.ctx) this.audio.ctx.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    document.getElementById('pause').classList.add('hidden');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (this.audio.ctx) this.audio.ctx.resume();
    this.timer.update();
  }

  toMenu() {
    if (this.audio.ctx) this.audio.ctx.resume();
    this.startAttract();
  }

  showResults() {
    this.resultsShown = true;
    this._renderResults();
    const pos = this.player.position;
    document.getElementById('results-title').textContent =
      pos === 1 ? '¡VICTORIA!' : pos <= 3 ? `¡PODIO! P${pos}` : `TERMINASTE P${pos}`;
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('touch').classList.add('hidden');
  }

  _renderResults() {
    const sim = this.sim;
    const ranking = sim.ranking();
    const leader = ranking[0];
    let fastest = null;
    for (const c of ranking) if (c.bestLap != null && (!fastest || c.bestLap < fastest.bestLap)) fastest = c;
    const rows = ranking.map((c, k) => {
      let time;
      if (k === 0) time = formatTime(c.finishTime);
      else if (c.finished) time = `+${(c.finishTime - leader.finishTime).toFixed(3)}`;
      else {
        const lapsDown = Math.floor((leader.raceDist - c.raceDist) / this.track.length);
        time = lapsDown >= 1 ? `+${lapsDown} vuelta${lapsDown > 1 ? 's' : ''}` : 'En pista';
      }
      return `<tr class="${c === this.player ? 'me' : ''}">
        <td class="p">${k + 1}</td>
        <td><i style="background:${c.team.primary}"></i>${c.driver.name}</td>
        <td class="team-n">${c.team.name}</td>
        <td class="t">${time}</td>
        <td class="t ${c === fastest ? 'fl' : ''}">${formatTime(c.bestLap)}</td></tr>`;
    }).join('');
    document.getElementById('results-body').innerHTML = rows;
  }

  // ---------- Bucle ----------
  _pixelRatio() {
    const q = this.q;
    const dpr = Math.min(devicePixelRatio || 1, q.pixelRatio);
    const cap = Math.sqrt(q.maxPixels / (innerWidth * innerHeight));
    return Math.max(0.5, Math.min(dpr, cap) * this.perf.scale);
  }

  // Resolución adaptativa: baja la resolución si el framerate cae
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
      if (this.state === 'paused') this.resume();
      else if (this.state === 'menu') { /* nada */ } else this.pause();
    }
    if (input.consume('mute')) this.toggleMute();
    if (this.state === 'paused' || this.state === 'loading') { if (render) this._render(); return; }
    if (input.consume('camera') && this.player && this.state !== 'menu') {
      this.cycleCamera();
      this.player.model.helmet.visible = this.rig.mode !== 'cockpit';
    }
    this.rig.lookBack = (input.held('look') || input.padLook) && this.state !== 'menu';
    if (input.consume('respawn') && this.player && this.state === 'race' && !this.player.finished) this.sim.respawn(this.player);

    if (this.state === 'countdown') this._countdown(dt);

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
    if (render) this._render();
  }

  _countdown(dt) {
    const prev = this.countdown;
    this.countdown += dt;
    for (let k = 1; k <= 5; k++) {
      if (prev < k && this.countdown >= k) {
        this.lightsShown = k;
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
    p.input.steer = inp.steer;
    p.input.throttle = inp.throttle;
    p.input.brake = inp.brake;
    if (this.settings.assist && this.sim.started && p.speed > 12) {
      const vT = this.track.vmaxPlayer
        ? this.track.vmaxPlayer[Math.floor(((p.s + p.speed * 0.3) % this.track.length) / this.track.ds) % this.track.N]
        : Infinity;
      if (p.speed > vT + 1.5) {
        p.input.brake = Math.max(p.input.brake, clamp((p.speed - vT) * 0.22, 0, 1));
        p.input.throttle = 0;
      }
    }
    if ((inp.consume('drs') || inp.drsHeld) && p.drsAllowed && p.inDrsZone && !p.drsOpen && inp.brake < 0.1) {
      p.drsOpen = true;
    }
  }

  _fixed(h) {
    const sim = this.sim;
    if (this.player && this.state !== 'menu') this._playerInput();
    for (const c of sim.cars) {
      if (c === this.player && this.state !== 'menu') continue;
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
          this.particles.burst(c.x, c.z, c.vx, c.vz, e.strength);
          const loud = c === p || e.other === p ? 1 : 0.5;
          this.audio.crash(e.strength * loud);
        }
        if (c === p || e.other === p) this.rig.addShake(Math.min(1.2, e.strength / 10));
      }
      if (!p || this.state === 'menu') continue;
      if (e.type === 'laptime' && c === p) {
        const t = e.time;
        let sub = '';
        if (this.settings.mode === 'tt') {
          if (!this.best || t < this.best) {
            this.best = t; saveBest(t);
            sub = 'NUEVO RÉCORD';
          }
        }
        const fastest = sim.cars.every((o) => o === p || o.bestLap == null || o.bestLap >= t);
        if (!sub && fastest && p.bestLap === t && sim.cars.length > 1) sub = 'VUELTA RÁPIDA';
        this.hud.message(formatTime(t), sub, 3, sub ? 'purple' : 'time');
      } else if (e.type === 'lap' && c === p && this.settings.mode === 'race') {
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
    for (const c of sim.cars) {
      const v = Math.abs(c.speed);
      c.bump = c.surface === 1 ? Math.sin(this.elapsed * 60 + c.id) * 0.012 * Math.min(1, v / 20)
        : c.surface >= 2 ? (Math.random() - 0.5) * 0.03 * Math.min(1, v / 15) : 0;
      c.syncModel(dt);
      if (Math.hypot(c.x - camPos.x, c.z - camPos.z) < 220) this.particles.carEffects(c, dt);
    }
    this.particles.update(dt);
    this.track.animateCrowd(this.elapsed);

    // Cámara
    const focus = this.state === 'menu' ? this.focus : this.player;
    const mode = this.state === 'menu' ? 'cine' : this.rig.mode;
    this.rig.update(dt, focus, this.track, mode);
    // ocultar autos pegados a la cámara para que no tapen la vista
    for (const c of sim.cars) {
      if (c === focus) { c.model.root.visible = true; continue; }
      c.model.root.visible = Math.hypot(c.x - camPos.x, c.z - camPos.z) > 3.6;
    }

    // Sombras siguiendo al foco
    if (this.shadowSpan) {
      const texel = this.shadowSpan / this.q.shadow;
      const fx = focus.x + Math.sin(focus.heading) * 20, fz = focus.z + Math.cos(focus.heading) * 20;
      const tx = Math.round(fx / texel) * texel, tz = Math.round(fz / texel) * texel;
      this.sun.target.position.set(tx, 0, tz);
      this.sun.position.set(tx, 0, tz).addScaledVector(this.sunDir, 400);
      this.sun.target.updateMatrixWorld();
    }
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.time.value = this.elapsed;

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
    const nearStand = Math.min(this.player ? this.player.s : focus.s, this.track.length - (this.player ? this.player.s : focus.s)) < 300;
    this.audio.update(this.state === 'menu' ? null : this.player, others, {
      inCockpit: this.rig.mode === 'cockpit',
      active: true,
      crowdLevel: nearStand ? 1 : 0.2,
    });

    // HUD
    if (this.player && this.state !== 'menu') {
      this.hud.update(dt, sim, this.player, { mode: this.settings.mode, laps: sim.laps });
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
    if (this.speedPass) {
      const onboard = this.state !== 'menu' && this.rig.mode !== 'tv';
      const sp = onboard && this.player ? clamp((Math.abs(this.player.speed) - 45) / 50, 0, 1) : 0;
      this.speedPass.uniforms.uSpeed.value = sp;
    }
  }

  _render() {
    const h = this.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y;
    this.particles && this.particles.setScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }
}

const game = new Game();
window.__game = game;
game.init().catch((err) => {
  console.error(err);
  const s = document.getElementById('load-status');
  s.textContent = 'No se pudo iniciar el juego: ' + (err && err.message ? err.message : err) + '. Probá con otro navegador o activá la aceleración por hardware.';
  s.classList.add('error');
});
