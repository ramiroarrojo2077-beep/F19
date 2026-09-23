// Sonido sintetizado con Web Audio (motor, viento, neumáticos, golpes y semáforo).
import { clamp } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
    this.lastGear = 1;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Buffer de ruido blanco reutilizable
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;

    this.engine = this._engineVoice(0.0);
    this.ai = [this._engineVoice(0, true), this._engineVoice(0, true)];

    const noise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = nb; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.wind = noise('lowpass', 600, 0.5);
    this.screech = noise('bandpass', 1800, 6);
    this.rumble = noise('lowpass', 140, 1);
    this.crowd = noise('bandpass', 900, 0.7);
  }

  _engineVoice(gain, simple = false) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = gain;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2000; filter.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    const oscs = [];
    const defs = simple
      ? [['sawtooth', 1, 0.6], ['square', 0.5, 0.35]]
      : [['sawtooth', 1, 0.55], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.18], ['triangle', 3, 0.12]];
    for (const [type, mult, g] of defs) {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(mix);
      o.start();
      oscs.push({ o, mult });
    }
    // vibrato leve para dar textura
    const lfo = ctx.createOscillator(); lfo.frequency.value = 27;
    const lfoG = ctx.createGain(); lfoG.gain.value = 4;
    lfo.connect(lfoG);
    for (const { o } of oscs) lfoG.connect(o.frequency);
    lfo.start();
    mix.connect(shaper).connect(filter).connect(out).connect(this.master);
    return { out, filter, oscs };
  }

  _setVoice(v, freq, gain, cutoff, t) {
    for (const { o, mult } of v.oscs) o.frequency.setTargetAtTime(freq * mult, t, 0.02);
    v.out.gain.setTargetAtTime(gain, t, 0.04);
    v.filter.frequency.setTargetAtTime(cutoff, t, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // player: auto de referencia; others: autos cercanos {car, dist, radial}
  update(player, others, { inCockpit = false, active = true, crowdLevel = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!active) {
      this.engine.out.gain.setTargetAtTime(0, t, 0.1);
      for (const v of this.ai) v.out.gain.setTargetAtTime(0, t, 0.1);
      for (const n of [this.wind, this.screech, this.rumble]) n.g.gain.setTargetAtTime(0, t, 0.1);
      this.crowd.g.gain.setTargetAtTime(crowdLevel * 0.05, t, 0.3);
      return;
    }
    if (player) {
      const thr = player.input.throttle;
      const freq = (player.rpm / 60) * 3 * 0.5;
      let gain = 0.16 + thr * 0.16;
      if (player.gear !== this.lastGear) {
        // corte breve en el cambio de marcha
        this.engine.out.gain.cancelScheduledValues(t);
        this.engine.out.gain.setValueAtTime(gain * 0.35, t);
        this.lastGear = player.gear;
      }
      this._setVoice(this.engine, freq, gain * (inCockpit ? 1.15 : 1), 900 + thr * 3200 + player.rpm * 0.12, t);
      const v = Math.abs(player.speed);
      this.wind.g.gain.setTargetAtTime(clamp(v / 95, 0, 1) ** 2 * 0.22, t, 0.1);
      this.wind.f.frequency.setTargetAtTime(400 + v * 12, t, 0.1);
      const sq = clamp(player.slip * 0.12 + Math.max(0, player.understeer - 0.5) * 0.45 + (player.input.brake > 0.9 && v > 25 ? 0.2 : 0), 0, 1);
      this.screech.g.gain.setTargetAtTime((player.surface <= 1 || player.surface === 4) && v > 5 ? sq * 0.16 : 0, t, 0.05);
      this.screech.f.frequency.setTargetAtTime(1500 + v * 6, t, 0.1);
      const rough = player.surface === 1 ? 0.5 : player.surface === 2 || player.surface === 3 ? 0.7 : player.surface === 4 ? 0.12 : 0;
      this.rumble.g.gain.setTargetAtTime(rough * clamp(v / 30, 0, 1) * 0.6, t, 0.05);
    }
    this.crowd.g.gain.setTargetAtTime(crowdLevel * 0.05, t, 0.3);
    for (let k = 0; k < this.ai.length; k++) {
      const o = others[k];
      const voice = this.ai[k];
      if (!o) { voice.out.gain.setTargetAtTime(0, t, 0.1); continue; }
      const doppler = 343 / (343 + clamp(o.radial, -120, 120));
      const freq = (o.car.rpm / 60) * 3 * 0.5 * doppler;
      const g = 0.35 / (1 + (o.dist / 14) ** 2) * (0.5 + o.car.input.throttle * 0.5);
      this._setVoice(voice, freq, g, 1400 + o.car.rpm * 0.15, t);
    }
  }

  beep(freq = 440, dur = 0.25, gain = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.3);
  }

  crash(strength = 5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500 + strength * 60;
    const g = this.ctx.createGain();
    const a = clamp(strength / 15, 0.15, 1) * 0.8;
    g.gain.setValueAtTime(a, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.4);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(a * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }
}
