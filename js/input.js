// Entrada unificada: teclado, gamepad y controles táctiles.
import { clamp } from './utils.js';

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyE: 'drs', ShiftLeft: 'drs', ShiftRight: 'drs', Space: 'drs',
  KeyC: 'camera', KeyP: 'pause', Escape: 'pause',
  KeyR: 'respawn', KeyM: 'mute', KeyL: 'look',
};

export class Input {
  constructor() {
    this.keys = {};
    this.touch = {};
    this.pressed = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.drsHeld = false;
    this.usingPad = false;
    this.lastPadButtons = [];
    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys[a]) this.pressed.add(a);
      this.keys[a] = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys[a] = false;
    });
    addEventListener('blur', () => { this.keys = {}; this.touch = {}; });
  }

  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const a = el.dataset.touch;
      const on = (e) => {
        e.preventDefault();
        if (!this.touch[a]) this.pressed.add(a);
        this.touch[a] = true;
        el.classList.add('on');
      };
      const off = (e) => { e.preventDefault(); this.touch[a] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });
  }

  held(a) { return !!(this.keys[a] || this.touch[a]); }

  consume(a) {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  clearPressed() { this.pressed.clear(); }

  update(dt) {
    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    let padSteer = 0, padThr = 0, padBrk = 0, padDrs = false;
    if (pad) {
      const ax = pad.axes[0] || 0;
      const dz = 0.12;
      padSteer = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) ** 1.5;
      const b = pad.buttons;
      padThr = b[7] ? b[7].value : 0;
      padBrk = b[6] ? b[6].value : 0;
      if (b[0] && b[0].pressed) padThr = Math.max(padThr, 1);
      if (b[1] && b[1].pressed) padBrk = Math.max(padBrk, 1);
      padDrs = !!(b[2] && b[2].pressed) || !!(b[5] && b[5].pressed);
      const edge = (i, a) => {
        const now = !!(b[i] && b[i].pressed);
        if (now && !this.lastPadButtons[i]) this.pressed.add(a);
        this.lastPadButtons[i] = now;
      };
      edge(3, 'camera'); edge(9, 'pause'); edge(8, 'respawn');
      this.padLook = !!(b[4] && b[4].pressed);
      if (Math.abs(padSteer) > 0 || padThr > 0.05 || padBrk > 0.05) this.usingPad = true;
    }

    const left = this.held('left'), right = this.held('right');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.usingPad && (Math.abs(padSteer) > 0 || (!left && !right))) {
      this.steer = padSteer;
    } else {
      // rampa de dirección para teclado
      const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) ? 9 : 3.2;
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
    }
    const kt = this.held('up') ? 1 : 0, kb = this.held('down') ? 1 : 0;
    this.throttle = Math.max(padThr, this.throttle + clamp(kt - this.throttle, -8 * dt, 10 * dt));
    this.brake = Math.max(padBrk, this.brake + clamp(kb - this.brake, -10 * dt, 12 * dt));
    if (padThr > 0 || padBrk > 0) { this.throttle = Math.max(padThr, kt); this.brake = Math.max(padBrk, kb); }
    this.drsHeld = this.held('drs') || padDrs;
    if (padDrs) this.pressed.add('drs');
  }
}
