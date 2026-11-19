// Controls: tilt steering (DeviceOrientation), touch pedals, a touch-drag
// steering fallback, and keyboard for desktop.
//
// Tilt math: convert the browser's beta/gamma into the gravity "up" vector in
// device coordinates, rotate it into screen coordinates, then steer by how far
// the screen's left-right axis is tilted from horizontal. This is stable however
// the phone is held (upright like a wheel, tilted back, or nearly flat) and has
// none of the angle jumps raw beta/gamma show when the phone is upright.
import { clamp, approach, DEG } from './util.js';

const SENS = [34, 26, 19]; // degrees of tilt for full lock: low / medium / high
// Straight is the phone held level (true level, from gravity, like the bubble
// level on the start screen). Only if a run starts with the phone tilted more
// than this (say, playing lying down) does the current hold become straight.
const LEVEL_FALLBACK = 20 * DEG;

// The browser's own report of the screen rotation, or null if it has none.
function apiScreenAngle() {
  let a = null;
  if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
  else if (typeof window.orientation === 'number') a = window.orientation;
  return a == null ? null : ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}
const isLandscape = () => window.innerWidth > window.innerHeight;

// How far the screen is turned like a wheel, from gravity's direction within
// the screen's own plane (sx, sy). Measured as an angle in that plane it reads
// the same however far the device is tipped back (an iPad held low and leaning
// back used to steer only weakly). null when the device lies too flat to tell.
function screenRoll(sx, sy) {
  if (Math.hypot(sx, sy) < 0.12) return null;
  return clamp(Math.atan2(-sx, Math.max(sy, 0.05)), -1.2, 1.2);
}

function toScreen(ux, uy, ang) {
  switch (ang) {
    case 90: return [-uy, ux];
    case 180: return [-ux, -uy];
    case 270: return [uy, -ux];
    default: return [ux, uy];
  }
}

export class Input {
  constructor(layer) {
    this.layer = layer;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.mode = 'touch'; // 'tilt' | 'touch' | 'keys'
    this.tiltPermission = 'unknown';
    this.lastOrientT = 0;
    this.up = [0, 0, 1];
    this.upAvg = [0, 0, 1];
    this.roll = 0;
    this.rollSmooth = 0;
    this.neutral = 0;
    this.angleOverride = null;
    this.sensitivity = 1;
    this.tiltSteer = 0;
    this.keySteer = 0;
    this.keys = new Set();
    this.pointers = new Map();
    this.active = false; // gameplay touches only count while driving
    this.onPause = null;
    this.onRecenter = null;
    this.onHorn = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    window.addEventListener('deviceorientation', (e) => this._onOrient(e));
    window.addEventListener('orientationchange', () => (this.angleOverride = null));
    window.addEventListener('resize', () => (this.angleOverride = null));
    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', () => (this.angleOverride = null));
    }
    const opts = { passive: false };
    layer.addEventListener('pointerdown', (e) => this._down(e), opts);
    layer.addEventListener('pointermove', (e) => this._move(e), opts);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) layer.addEventListener(t, (e) => this._up(e), opts);
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
    });
  }

  // Must be called synchronously inside a tap/click handler (iOS requirement).
  requestTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      this.tiltPermission = 'unsupported';
      return Promise.resolve('unsupported');
    }
    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission()
        .then((r) => (this.tiltPermission = r))
        .catch(() => (this.tiltPermission = 'denied'));
    }
    this.tiltPermission = 'granted';
    return Promise.resolve('granted');
  }

  hasTilt() {
    return performance.now() - this.lastOrientT < 1000;
  }

  _onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    this.lastOrientT = performance.now();
    const b = e.beta * DEG, g = e.gamma * DEG;
    const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b), uz = Math.cos(b) * Math.cos(g);
    this.up[0] = ux;
    this.up[1] = uy;
    this.up[2] = uz;
    for (let i = 0; i < 3; i++) this.upAvg[i] += (this.up[i] - this.upAvg[i]) * 0.15;
    const r = screenRoll(...toScreen(ux, uy, this._screenAngle()));
    // lying (nearly) flat there's no wheel angle to read: ease back to straight
    this.roll = r != null ? r : this.roll + (this.neutral - this.roll) * 0.1;
  }

  // Which way the screen is rotated. The browser's report can't be trusted
  // everywhere: iPadOS Safari in its default "desktop website" mode has no
  // window.orientation (and older iPadOS no screen.orientation), so landscape
  // read as portrait and steering followed the wrong axis. So the report must
  // agree with the window's shape; if it doesn't (or is missing), take the
  // rotation of that shape whose "up" matches gravity.
  _screenAngle() {
    if (this.angleOverride != null) {
      // flipped 180° without the browser saying so: gravity shows the screen upside down
      if (toScreen(this.upAvg[0], this.upAvg[1], this.angleOverride)[1] < -0.35) this.angleOverride = (this.angleOverride + 180) % 360;
      return this.angleOverride;
    }
    const land = isLandscape(), api = apiScreenAngle();
    if (api != null && (api % 180 === 90) === land) return api;
    const [ux, uy] = this.upAvg;
    const [a, b] = land ? [90, 270] : [0, 180];
    const sa = toScreen(ux, uy, a)[1];
    // hold the last pick while gravity is ambiguous (device lying flat)
    if (Math.abs(sa) > 0.15 || this.guess == null || (this.guess % 180 === 90) !== land) this.guess = sa >= 0 ? a : b;
    return this.guess;
  }

  // Start of a run: settle which way the screen is rotated using gravity,
  // considering only rotations that match the window's shape.
  detectScreen() {
    const [ux, uy] = this.upAvg;
    const [a, b] = isLandscape() ? [90, 270] : [0, 180];
    const sa = toScreen(ux, uy, a)[1];
    if (Math.abs(sa) > 0.05) {
      this.angleOverride = sa >= 0 ? a : b;
      const r = screenRoll(...toScreen(ux, uy, this.angleOverride));
      if (r != null) this.roll = r;
    }
    this.rollSmooth = this.roll;
  }

  // Start of a run: straight = level, nothing to calibrate. Returns true if the
  // phone was held far from level, so the current hold was used instead.
  centerOnLevel() {
    this.detectScreen();
    const tilted = Math.abs(this.roll) > LEVEL_FALLBACK;
    this.neutral = tilted ? this.roll : 0;
    return tilted;
  }

  // Pause menu "Recenter steering": make the current hold straight.
  calibrate() {
    this.detectScreen();
    this.neutral = this.roll;
  }

  setSensitivity(i) {
    this.sensitivity = clamp(i, 0, 2);
  }

  _zone(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.mode === 'tilt') return x < w / 2 ? 'brake' : 'gas';
    if (x < w * 0.5) return 'steer';
    return y < h * 0.55 ? 'gas' : 'brake';
  }

  _down(e) {
    e.preventDefault();
    if (!this.active) return;
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    this.pointers.set(e.pointerId, { zone: this._zone(e.clientX, e.clientY), x0: e.clientX, x: e.clientX, y: e.clientY });
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.zone === 'gas' || p.zone === 'brake') p.zone = this._zone(p.x, p.y);
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
  }

  _key(e, down) {
    const map = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
    };
    const k = map[e.code];
    if (k) {
      e.preventDefault();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      if (down && this.mode === 'touch' && !this.isTouch) this.mode = 'keys';
      return;
    }
    if (!down) return;
    if ((e.code === 'KeyP' || e.code === 'Escape') && this.onPause) this.onPause();
    if (e.code === 'KeyC' && this.onRecenter) this.onRecenter();
    if (e.code === 'KeyH' && this.onHorn) this.onHorn();
  }

  clearTouches() {
    this.pointers.clear();
  }

  update(dt) {
    const a = 1 - Math.exp(-dt / 0.045);
    this.rollSmooth += (this.roll - this.rollSmooth) * a;
    let x = (this.rollSmooth - this.neutral) / (SENS[this.sensitivity] * DEG);
    const ax = Math.abs(x), dz = 0.035;
    x = ax < dz ? 0 : Math.sign(x) * Math.min(1, Math.pow((ax - dz) / (1 - dz), 1.2));
    this.tiltSteer = x;

    let steer = 0, thr = 0, brk = 0;
    if (this.mode === 'tilt' && this.hasTilt()) steer = this.tiltSteer;
    for (const p of this.pointers.values()) {
      if (p.zone === 'gas') thr = 1;
      else if (p.zone === 'brake') brk = 1;
      else if (p.zone === 'steer') steer = clamp((p.x - p.x0) / (window.innerWidth * 0.11), -1, 1);
    }
    const kt = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    this.keySteer = approach(this.keySteer, kt, (kt === 0 ? 6 : 2.4) * dt);
    if (Math.abs(this.keySteer) > Math.abs(steer)) steer = this.keySteer;
    if (this.keys.has('gas')) thr = 1;
    if (this.keys.has('brake')) brk = 1;
    if (!this.active) {
      steer = 0;
      thr = 0;
      brk = 0;
    }
    this.steer = steer;
    this.throttle = thr;
    this.brake = brk;
  }
}
