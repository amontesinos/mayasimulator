// Endless procedural road. The centerline is generated from curvature sections
// (straight -> clothoid ramp -> arc -> ramp -> straight) so it always reads as a
// real road, plus gentle hills. Everything else is positioned in road-relative
// coordinates: s = distance along the road, d = lateral offset (positive = right).
//
// World axes follow three.js: x right, y up, -z forward at yaw 0. A yaw of psi
// faces direction (-sin psi, -cos psi); positive yaw / curvature turns left.
import { mulberry32, rand, clamp } from './util.js';

export class Road {
  constructor(opts = {}) {
    this.o = Object.assign(
      {
        seed: 1,
        ds: 2,
        minRadius: 220,
        maxRadius: 700,
        straightMin: 80,
        straightMax: 300,
        turnMin: 0.25,
        turnMax: 1.0,
        maxYaw: 1.1,
        startStraight: 260,
        hillAmp: 7,
        hillWave: 220,
      },
      opts
    );
    this.ds = this.o.ds;
    this.rng = mulberry32(this.o.seed * 7919 + 13);
    this.xs = [0];
    this.zs = [0];
    this.yaws = [0];
    this.ks = [];
    this.queue = [{ len: this.o.startStraight, k0: 0, k1: 0 }];
    this.cur = null;
    this.curPos = 0;
    this.plannedYaw = 0;
    const r = this.rng, A = this.o.hillAmp, W = this.o.hillWave;
    this.hA = [A * rand(r, 0.6, 1.0), A * rand(r, 0.25, 0.5), A * 0.12];
    this.hW = [W * rand(r, 0.9, 1.4), W * rand(r, 0.35, 0.55), W * 0.13];
    this.hP = [rand(r, 0, 6.28), rand(r, 0, 6.28), rand(r, 0, 6.28)];
    this._tmp = { x: 0, z: 0, yaw: 0, k: 0 };
  }

  _plan() {
    const o = this.o, r = this.rng;
    let dir = r() < 0.5 ? -1 : 1;
    // Steer the overall heading back toward the start direction so the road
    // never loops back across itself.
    if (this.plannedYaw > o.maxYaw * 0.45) dir = r() < 0.85 ? -1 : 1;
    else if (this.plannedYaw < -o.maxYaw * 0.45) dir = r() < 0.85 ? 1 : -1;
    const radius = rand(r, o.minRadius, o.maxRadius);
    const room = dir > 0 ? o.maxYaw - this.plannedYaw : o.maxYaw + this.plannedYaw;
    const turn = clamp(rand(r, o.turnMin, o.turnMax), 0.08, Math.max(0.08, room));
    const k = dir / radius;
    const Lt = clamp(radius * 0.22, 30, 110);
    const La = Math.max(0, turn * radius - Lt);
    this.queue.push({ len: Lt, k0: 0, k1: k }, { len: La, k0: k, k1: k }, { len: Lt, k0: k, k1: 0 });
    this.plannedYaw += k * (Lt + La);
    this.queue.push({ len: rand(r, o.straightMin, o.straightMax), k0: 0, k1: 0 });
  }

  _nextK() {
    while (!this.cur || this.curPos >= this.cur.len - 1e-6) {
      if (!this.queue.length) this._plan();
      this.cur = this.queue.shift();
      this.curPos = 0;
    }
    const t = Math.min(1, (this.curPos + this.ds * 0.5) / this.cur.len);
    this.curPos += this.ds;
    return this.cur.k0 + (this.cur.k1 - this.cur.k0) * t;
  }

  ensure(s) {
    const need = Math.ceil(s / this.ds) + 2;
    while (this.xs.length < need) {
      const i = this.xs.length - 1;
      const k = this._nextK();
      const yaw0 = this.yaws[i];
      const mid = yaw0 + k * this.ds * 0.5;
      this.ks.push(k);
      this.yaws.push(yaw0 + k * this.ds);
      this.xs.push(this.xs[i] - Math.sin(mid) * this.ds);
      this.zs.push(this.zs[i] - Math.cos(mid) * this.ds);
    }
  }

  // Centerline sample at distance s. Returns a shared scratch object.
  sample(s, out = this._tmp) {
    if (s < 0) s = 0;
    this.ensure(s + this.ds * 2);
    const f = s / this.ds;
    const i = Math.floor(f);
    const t = f - i;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    out.yaw = this.yaws[i] + (this.yaws[i + 1] - this.yaws[i]) * t;
    out.k = this.ks[i];
    return out;
  }

  curvature(s) {
    if (s < 0) s = 0;
    this.ensure(s + this.ds * 2);
    return this.ks[Math.floor(s / this.ds)];
  }

  height(s) {
    const a = this.hA, w = this.hW, p = this.hP;
    return a[0] * Math.sin(s / w[0] + p[0]) + a[1] * Math.sin(s / w[1] + p[1]) + a[2] * Math.sin(s / w[2] + p[2]);
  }

  slope(s) {
    const a = this.hA, w = this.hW, p = this.hP;
    return (a[0] / w[0]) * Math.cos(s / w[0] + p[0]) + (a[1] / w[1]) * Math.cos(s / w[1] + p[1]) + (a[2] / w[2]) * Math.cos(s / w[2] + p[2]);
  }

  // World x/z of road-relative point (s, d). Writes into out, returns the yaw at s.
  toWorld(s, d, out) {
    const p = this.sample(s);
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    out.x = p.x + d * c;
    out.z = p.z - d * sn;
    return p.yaw;
  }
}
