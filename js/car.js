// Player car physics in road-relative coordinates.
// s: distance along road, d: lateral offset (+ right), rel: heading relative to
// the road tangent (+ = turned left), v: speed (m/s).
import { clamp, damp, approach } from './util.js';

export class PlayerCar {
  constructor() {
    this.reset(0, 1.8);
  }

  reset(s, d, v = 0) {
    this.s = s;
    this.d = d;
    this.rel = 0;
    this.v = v;
    this.steer = 0;
    this.rpm = 800;
    this.latAcc = 0;
    this.longAcc = 0;
    this.offroad = 0;
    this.scrape = 0;
    this.wasScraping = false;
  }

  accel(v, vmax) {
    return 4.2 * Math.max(0, 1 - v / vmax) + 0.6;
  }

  // p: { cruise, vmax, input: {steer, throttle, brake}, limits: {pavedL, pavedR, hardL, hardR} }
  update(dt, road, p) {
    const inp = p.input;
    const v0 = this.v;
    let v = this.v;
    // coast: [a, b] = a wreck rolling/sliding to a halt, decelerating by a + b*v
    if (p.coast) v = Math.max(0, v - (p.coast[0] + p.coast[1] * v) * dt);
    else if (inp.brake > 0) v -= 9.5 * inp.brake * dt;
    else if (inp.throttle > 0) v += this.accel(v, p.vmax) * inp.throttle * dt;
    else if (v < p.cruise) v += Math.min(3.0 * dt, p.cruise - v);
    else v -= Math.min((0.6 + v * 0.03) * dt, v - p.cruise);

    const L = p.limits;
    this.offroad = this.d < L.pavedL ? L.pavedL - this.d : this.d > L.pavedR ? this.d - L.pavedR : 0;
    if (this.offroad > 0) v -= (1.5 + v * 0.12) * Math.min(1, this.offroad) * dt;
    v = clamp(v, 0, p.vmax);
    this.v = v;
    this.longAcc = (v - v0) / Math.max(dt, 1e-3);

    // steering: wheel rate-limited, speed-sensitive max curvature
    this.steer = approach(this.steer, clamp(inp.steer, -1, 1), 5.5 * dt);
    const kMax = Math.min(0.12, 7.5 / Math.max(v * v, 1));
    const kCar = -this.steer * kMax;
    const kRoad = road.curvature(this.s);
    const sdot = (v * Math.cos(this.rel)) / (1 + kRoad * this.d);
    const ddot = -v * Math.sin(this.rel);
    let reldot = v * kCar - kRoad * sdot;
    // Stability assist: the car settles back to the road's heading when the wheel
    // is centered, so holding a tilt feels like "slide over" rather than "spin".
    const assist = 0.7 + 1.7 * (1 - Math.min(1, Math.abs(this.steer) * 2.2));
    reldot -= this.rel * assist * Math.min(1, v / 8);
    this.s += sdot * dt;
    this.d += ddot * dt;
    this.rel = clamp(this.rel + reldot * dt, -0.8, 0.8);
    this.latAcc = v * v * kCar;

    // trees / guardrails: bounce back and scrub speed (no damage)
    this.scrape = 0;
    if (this.d < L.hardL || this.d > L.hardR) {
      const left = this.d < L.hardL;
      this.d = left ? L.hardL : L.hardR;
      if ((left && this.rel > 0) || (!left && this.rel < 0)) this.rel *= -0.3;
      if (!this.wasScraping) this.v *= 0.85;
      this.v = Math.max(0, this.v - this.v * 1.2 * dt);
      this.scrape = 1;
    }
    this.wasScraping = this.scrape > 0;

    const targetRpm = 750 + v * 52 + inp.throttle * 1900 + (this.longAcc > 0.5 ? 350 : 0);
    this.rpm = damp(this.rpm, clamp(targetRpm, 700, 6400), 5, dt);
  }

  // Simple lane-keeping autopilot used behind menus and during cutscenes.
  autopilot(road, targetD, cruise) {
    const kMax = Math.min(0.12, 7.5 / Math.max(this.v * this.v, 1));
    const relT = -clamp((targetD - this.d) * 0.12, -0.25, 0.25);
    const ff = -road.curvature(this.s + this.v * 0.3) / kMax;
    return { steer: clamp(ff + (this.rel - relT) * 4, -1, 1), throttle: 0, brake: 0, cruise };
  }
}
