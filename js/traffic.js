// Low-poly traffic for the Deer Revenge highway.
import * as THREE from '../vendor/three.module.min.js';
import { part, merge, mat } from './geo.js';
import { clamp } from './util.js';

const COLORS = [0xb83227, 0x2d6cb5, 0xe1b12c, 0x2f8f4e, 0xe6e6e6, 0x2c3e50, 0x7d3c98, 0xd35400, 0x8e9aa6, 0x161616];
const TYPES = ['sedan', 'suv', 'pickup', 'sedan', 'suv'];
const LEN = { sedan: 4.5, suv: 4.7, pickup: 5.4 };
const GLASS = 0x1b222c, TIRE = 0x141414, TRIM = 0x2a2a2e;

function bodyGeo(type, color) {
  const L = LEN[type], h = L / 2;
  const p = [];
  if (type === 'sedan') {
    p.push(part(new THREE.BoxGeometry(1.8, 0.62, L), color, mat(0, 0.66, 0)));
    p.push(part(new THREE.BoxGeometry(1.6, 0.5, 2.3), GLASS, mat(0, 1.2, 0.2)));
    p.push(part(new THREE.BoxGeometry(1.54, 0.07, 1.9), color, mat(0, 1.47, 0.25)));
  } else if (type === 'suv') {
    p.push(part(new THREE.BoxGeometry(1.9, 0.8, L), color, mat(0, 0.78, 0)));
    p.push(part(new THREE.BoxGeometry(1.76, 0.6, 3.0), GLASS, mat(0, 1.48, 0.45)));
    p.push(part(new THREE.BoxGeometry(1.72, 0.08, 2.8), color, mat(0, 1.81, 0.5)));
  } else {
    p.push(part(new THREE.BoxGeometry(1.95, 0.75, L), color, mat(0, 0.8, 0)));
    p.push(part(new THREE.BoxGeometry(1.8, 0.62, 1.7), GLASS, mat(0, 1.48, -0.5)));
    p.push(part(new THREE.BoxGeometry(1.76, 0.08, 1.5), color, mat(0, 1.82, -0.45)));
    p.push(part(new THREE.BoxGeometry(1.8, 0.05, 2.0), 0x222226, mat(0, 1.19, 1.5)));
  }
  p.push(part(new THREE.BoxGeometry(1.84, 0.18, 0.12), TRIM, mat(0, 0.42, h)));
  p.push(part(new THREE.BoxGeometry(1.84, 0.18, 0.12), TRIM, mat(0, 0.42, -h)));
  for (const x of [-0.86, 0.86]) {
    for (const z of [-h * 0.62, h * 0.62]) {
      p.push(part(new THREE.CylinderGeometry(0.35, 0.35, 0.26, 10), TIRE, mat(x, 0.35, z, 0, 0, Math.PI / 2)));
    }
  }
  return merge(p);
}

function lightGeo(type) {
  const h = LEN[type] / 2;
  const y = type === 'sedan' ? 0.78 : 0.95;
  return merge([
    part(new THREE.BoxGeometry(0.42, 0.16, 0.05), 0xff1a1a, mat(-0.62, y, h + 0.02)),
    part(new THREE.BoxGeometry(0.42, 0.16, 0.05), 0xff1a1a, mat(0.62, y, h + 0.02)),
    part(new THREE.BoxGeometry(0.4, 0.14, 0.05), 0xfff4d0, mat(-0.62, y - 0.05, -h - 0.02)),
    part(new THREE.BoxGeometry(0.4, 0.14, 0.05), 0xfff4d0, mat(0.62, y - 0.05, -h - 0.02)),
  ]);
}

const _p = { x: 0, z: 0 };

export class TrafficManager {
  constructor(world) {
    this.world = world;
    this.active = [];
    this.pool = [];
    this.geos = new Map();
    this.lights = {};
    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  }

  _body(type, color) {
    const k = type + color;
    if (!this.geos.has(k)) this.geos.set(k, bodyGeo(type, color));
    return this.geos.get(k);
  }

  spawn(s, d, v, rng) {
    const r = rng || Math.random;
    const type = TYPES[Math.floor(r() * TYPES.length)];
    const color = COLORS[Math.floor(r() * COLORS.length)];
    let tc = this.pool.pop();
    if (!tc) {
      tc = { group: new THREE.Group(), body: new THREE.Mesh(undefined, this.bodyMat), lightMesh: new THREE.Mesh(undefined, this.lightMat) };
      tc.group.add(tc.body, tc.lightMesh);
    }
    tc.body.geometry = this._body(type, color);
    if (!this.lights[type]) this.lights[type] = lightGeo(type);
    tc.lightMesh.geometry = this.lights[type];
    Object.assign(tc, { s, d, v, targetD: d, type, len: LEN[type], passed: false, hitPlayer: false, laneT: 3 + r() * 8, rng: r });
    this.world.dynamic.add(tc.group);
    this.active.push(tc);
    return tc;
  }

  release(tc) {
    const i = this.active.indexOf(tc);
    if (i >= 0) this.active.splice(i, 1);
    this.world.dynamic.remove(tc.group);
    this.pool.push(tc);
  }

  clear() {
    for (const t of [...this.active]) this.release(t);
  }

  update(dt, lanes) {
    const road = this.world.road;
    for (const tc of this.active) {
      tc.s += tc.v * dt;
      tc.laneT -= dt;
      if (lanes && tc.laneT < 0) {
        tc.laneT = 5 + tc.rng() * 9;
        const cur = lanes.reduce((a, b) => (Math.abs(b - tc.d) < Math.abs(a - tc.d) ? b : a));
        const opts = lanes.filter((l) => Math.abs(l - cur) > 1 && Math.abs(l - cur) < 4.5);
        const target = opts[Math.floor(tc.rng() * opts.length)];
        const blocked = this.active.some((o) => o !== tc && Math.abs(o.d - target) < 1.6 && Math.abs(o.s - tc.s) < 14);
        if (target !== undefined && !blocked) tc.targetD = target;
      }
      const step = clamp(tc.targetD - tc.d, -1.3 * dt, 1.3 * dt);
      tc.d += step;
      const yaw = road.toWorld(tc.s, tc.d, _p);
      tc.group.position.set(_p.x, road.height(tc.s), _p.z);
      tc.group.rotation.y = yaw - (step / Math.max(dt, 1e-3)) * 0.05;
    }
  }
}
