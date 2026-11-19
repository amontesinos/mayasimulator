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
    // v0: the speed this driver likes to cruise at; v drops below it when someone is in the way
    Object.assign(tc, { s, d, v, v0: v, targetD: d, type, len: LEN[type], passed: false, hitPlayer: false, laneT: 3 + r() * 8, rng: r });
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

  // Is the stretch of lane `target` around this car free to move into? Counts
  // cars already in it and cars heading into it, with extra room for anyone
  // closing in fast. The player's car (when given) gets a wider berth.
  _laneClear(tc, target, player) {
    const room = (o, extra) => {
      const ds = o.s - tc.s, base = (o.len + tc.len) / 2 + extra;
      return ds >= 0 ? ds > base + Math.max(0, tc.v - o.v) * 2 : -ds > base + Math.max(0, o.v - tc.v) * 2.5;
    };
    for (const o of this.active) {
      if (o === tc) continue;
      if ((Math.abs(o.d - target) < 1.9 || Math.abs(o.targetD - target) < 1.9) && !room(o, 8)) return false;
    }
    return !(player && Math.abs(player.d - target) < 2.4 && !room(player, 12));
  }

  // Traffic drives like traffic: each car follows whoever is ahead in its lane
  // (another car or the player), slowing to keep a gap and never passing
  // through, and only changes lanes into a real gap.
  // player: { s, d, v, len } of the player's car, if there is one.
  update(dt, lanes, player = null) {
    const road = this.world.road, act = this.active;
    const overlapLat = (tc, o) =>
      Math.min(Math.abs(o.d - tc.d), Math.abs(o.targetD - tc.d), Math.abs(o.d - tc.targetD)) < 1.9;
    for (const tc of act) {
      tc.laneT -= dt;
      // only start a lane change once settled in a lane
      if (lanes && tc.laneT < 0 && Math.abs(tc.targetD - tc.d) < 0.05) {
        tc.laneT = 5 + tc.rng() * 9;
        const cur = lanes.reduce((a, b) => (Math.abs(b - tc.d) < Math.abs(a - tc.d) ? b : a));
        const opts = lanes.filter((l) => Math.abs(l - cur) > 1 && Math.abs(l - cur) < 4.5);
        const target = opts[Math.floor(tc.rng() * opts.length)];
        if (target !== undefined && this._laneClear(tc, target, player)) tc.targetD = target;
      }
      // follow the nearest car ahead that shares the lane
      let gap = Infinity, leadV = 0;
      for (const o of act) {
        if (o === tc || o.s <= tc.s || !overlapLat(tc, o)) continue;
        const g = o.s - tc.s - (o.len + tc.len) / 2;
        if (g < gap) { gap = g; leadV = o.v; }
      }
      if (player && player.s > tc.s && Math.min(Math.abs(player.d - tc.d), Math.abs(player.d - tc.targetD)) < 2.0) {
        const g = player.s - tc.s - (player.len + tc.len) / 2;
        if (g < gap) { gap = g; leadV = player.v; }
      }
      let want = tc.v0;
      if (gap < 8 + tc.v * 1.2) want = Math.min(want, leadV + (gap - 4) * 0.9);
      tc.v = clamp(tc.v + clamp(Math.max(0, want) - tc.v, -10 * dt, 2.5 * dt), 0, tc.v0 * 1.2);
      tc.s += tc.v * dt;
    }
    // safety net: two cars sharing a lane never overlap; the one behind waits
    for (const a of act) {
      for (const b of act) {
        if (a === b || b.s < a.s || Math.abs(a.d - b.d) >= 1.85) continue;
        const min = (a.len + b.len) / 2 + 0.4;
        if (b.s - a.s < min) {
          a.s = b.s - min;
          a.v = Math.min(a.v, b.v);
        }
      }
    }
    for (const tc of act) {
      const step = clamp(tc.targetD - tc.d, -1.3 * dt, 1.3 * dt);
      tc.d += step;
      const yaw = road.toWorld(tc.s, tc.d, _p);
      tc.group.position.set(_p.x, road.height(tc.s), _p.z);
      tc.group.rotation.y = yaw - (step / Math.max(dt, 1e-3)) * 0.05;
    }
  }
}
