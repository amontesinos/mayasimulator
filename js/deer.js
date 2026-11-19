// Low-poly white-tailed deer: procedural model, gait animation, eyeshine,
// cartoon FX (dizzy stars, speech bubbles) and a small pooling manager.
import * as THREE from '../vendor/three.module.min.js';
import { part, merge, mat, ell, cylBetween, V } from './geo.js';
import { makeGlowTexture, makeShadowTexture, makeStarTexture, makeBubbleTexture } from './textures.js';
import { clamp, damp, wrapAngle, smoothstep } from './util.js';

const C = {
  coat: 0x8f6745,
  coatDark: 0x6b4c33,
  belly: 0xf3ede2,
  hoof: 0x1f1c18,
  nose: 0x151210,
  eye: 0x0b0a09,
  antler: 0xdccaa5,
  spot: 0xf6eedd,
  brow: 0x24170f,
};

export const KINDS = {
  doe: { scale: 1.0, antlers: false, spots: false, angry: false },
  buck: { scale: 1.1, antlers: true, spots: false, angry: false },
  fawn: { scale: 0.62, antlers: false, spots: true, angry: false },
  angry: { scale: 1.12, antlers: true, spots: false, angry: true },
};

let SHARED = null;

function buildBody(K) {
  const p = [
    part(ell(0.2, 0.25, 0.6), C.coat, mat(0, 0.98, 0)),
    part(ell(0.19, 0.27, 0.26), C.coat, mat(0, 1.0, 0.36)),
    part(ell(0.2, 0.26, 0.27), C.coat, mat(0, 1.0, -0.38)),
    part(ell(0.15, 0.1, 0.42), C.belly, mat(0, 0.8, 0.02)),
  ];
  if (K.spots) {
    for (let i = 0; i < 14; i++) {
      const side = i < 7 ? -1 : 1;
      const x = side * (0.09 + (i % 2) * 0.05);
      const z = -0.42 + (i % 7) * 0.13 + (i % 2) * 0.05;
      p.push(part(ell(0.036, 0.012, 0.036, 6, 4), C.spot, mat(x, 1.21 - Math.abs(x) * 0.6, z, 0, 0, side * -0.6)));
    }
  }
  return merge(p);
}

function buildHead(K) {
  const p = [
    part(cylBetween(V(0, -0.02, -0.04), V(0, 0.36, 0.18), 0.13, 0.075, 7), C.coat),
    part(ell(0.085, 0.092, 0.15), C.coat, mat(0, 0.43, 0.27, 0.28, 0, 0)),
    part(cylBetween(V(0, 0.4, 0.37), V(0, 0.355, 0.47), 0.056, 0.04, 6), C.coatDark),
    part(ell(0.036, 0.03, 0.03), C.nose, mat(0, 0.352, 0.485)),
    part(ell(0.042, 0.013, 0.03, 6, 4), C.belly, mat(0, 0.388, 0.42)),
    part(ell(0.05, 0.045, 0.04), C.belly, mat(0, 0.31, 0.24)),
    part(ell(0.03, 0.09, 0.05), C.coat, mat(0.09, 0.55, 0.21, 0, 0, -0.65)),
    part(ell(0.03, 0.09, 0.05), C.coat, mat(-0.09, 0.55, 0.21, 0, 0, 0.65)),
    part(ell(0.02, 0.022, 0.02, 6, 4), C.eye, mat(0.072, 0.455, 0.335)),
    part(ell(0.02, 0.022, 0.02, 6, 4), C.eye, mat(-0.072, 0.455, 0.335)),
  ];
  if (K.antlers) {
    for (const sx of [-1, 1]) {
      const pts = [V(0.05 * sx, 0.54, 0.22), V(0.15 * sx, 0.64, 0.19), V(0.21 * sx, 0.73, 0.27), V(0.19 * sx, 0.78, 0.39), V(0.12 * sx, 0.8, 0.47)];
      for (let i = 0; i < pts.length - 1; i++) p.push(part(cylBetween(pts[i], pts[i + 1], 0.019 - i * 0.002, 0.017 - i * 0.002, 5), C.antler));
      p.push(part(cylBetween(V(0.15 * sx, 0.64, 0.19), V(0.16 * sx, 0.8, 0.2), 0.012, 0.007, 5), C.antler));
      p.push(part(cylBetween(V(0.21 * sx, 0.73, 0.27), V(0.23 * sx, 0.9, 0.29), 0.012, 0.007, 5), C.antler));
      p.push(part(cylBetween(V(0.19 * sx, 0.78, 0.39), V(0.18 * sx, 0.9, 0.41), 0.011, 0.006, 5), C.antler));
    }
  }
  if (K.angry) {
    p.push(part(new THREE.BoxGeometry(0.075, 0.018, 0.02), C.brow, mat(0.062, 0.5, 0.35, 0, 0, 0.5)));
    p.push(part(new THREE.BoxGeometry(0.075, 0.018, 0.02), C.brow, mat(-0.062, 0.5, 0.35, 0, 0, -0.5)));
  }
  return merge(p);
}

function buildFrontLeg() {
  return merge([
    part(cylBetween(V(0, 0.04, 0), V(0, -0.42, 0.03), 0.07, 0.042, 6), C.coat),
    part(cylBetween(V(0, -0.42, 0.03), V(0, -0.86, 0.0), 0.036, 0.028, 6), C.coatDark),
    part(cylBetween(V(0, -0.86, 0.0), V(0, -0.93, 0.025), 0.03, 0.036, 6), C.hoof),
  ]);
}

function buildHindLeg() {
  return merge([
    part(cylBetween(V(0, 0.05, 0.02), V(0, -0.36, -0.12), 0.09, 0.052, 6), C.coat),
    part(cylBetween(V(0, -0.36, -0.12), V(0, -0.6, -0.17), 0.045, 0.033, 6), C.coatDark),
    part(cylBetween(V(0, -0.6, -0.17), V(0, -0.92, -0.08), 0.03, 0.026, 6), C.coatDark),
    part(cylBetween(V(0, -0.92, -0.08), V(0, -0.98, -0.055), 0.028, 0.034, 6), C.hoof),
  ]);
}

function buildTail() {
  return merge([
    part(ell(0.065, 0.12, 0.03), C.coat, mat(0, -0.09, -0.012)),
    part(ell(0.058, 0.11, 0.028), C.belly, mat(0, -0.09, 0.014)),
  ]);
}

function shared() {
  if (SHARED) return SHARED;
  const body = {}, head = {};
  for (const k of Object.keys(KINDS)) {
    body[k] = buildBody(KINDS[k]);
    head[k] = buildHead(KINDS[k]);
  }
  const shadowGeo = new THREE.PlaneGeometry(1.0, 1.7);
  shadowGeo.rotateX(-Math.PI / 2);
  SHARED = {
    material: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    // same look, but drawn in the transparent pass after the crash smoke so a
    // launched deer stays visible as it flies off through the plume
    flyMaterial: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true }),
    body,
    head,
    front: buildFrontLeg(),
    hind: buildHindLeg(),
    tail: buildTail(),
    glow: makeGlowTexture(),
    shadowGeo,
    shadowMat: new THREE.MeshBasicMaterial({
      map: makeShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    starMat: new THREE.SpriteMaterial({ map: makeStarTexture(), depthWrite: false, fog: false }),
    bubbles: new Map(),
  };
  return SHARED;
}

const _p = { x: 0, z: 0 };

export class Deer {
  constructor(kind) {
    const S = shared();
    const K = KINDS[kind];
    this.kind = kind;
    this.K = K;
    this.meshes = [];
    const mesh = (g) => {
      const m = new THREE.Mesh(g, S.material);
      this.meshes.push(m);
      return m;
    };
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.model.rotation.y = Math.PI; // model is built facing +z; the group faces -z
    this.model.scale.setScalar(K.scale);
    this.group.add(this.model);
    this.body = new THREE.Group();
    this.model.add(this.body);
    this.body.add(mesh(S.body[kind]));
    this.head = new THREE.Group();
    this.head.position.set(0, 1.08, 0.44);
    this.head.rotation.order = 'YXZ';
    this.head.add(mesh(S.head[kind]));
    this.body.add(this.head);
    this.tail = new THREE.Group();
    this.tail.position.set(0, 1.08, -0.64);
    this.tail.add(mesh(S.tail));
    this.body.add(this.tail);
    this.legs = [];
    for (const [x, y, z, front] of [[0.1, 0.92, 0.38, 1], [-0.1, 0.92, 0.38, 1], [0.1, 0.96, -0.4, 0], [-0.1, 0.96, -0.4, 0]]) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.add(mesh(front ? S.front : S.hind));
      this.body.add(g);
      this.legs.push(g);
    }
    this.eyeMat = new THREE.SpriteMaterial({
      map: S.glow,
      color: K.angry ? 0xff3a22 : 0xe8ff9c,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
      opacity: 0,
    });
    this.eyes = [];
    for (const x of [0.072, -0.072]) {
      const sp = new THREE.Sprite(this.eyeMat);
      sp.position.set(x, 0.455, 0.36);
      sp.scale.setScalar(0.05);
      this.head.add(sp);
      this.eyes.push(sp);
    }
    this.shadow = new THREE.Mesh(S.shadowGeo, S.shadowMat);
    this.shadow.position.y = 0.05;
    this.group.add(this.shadow);
    this.stars = [];
    this.bubble = null;
    this.flyPos = new THREE.Vector3();
    this.flyVel = new THREE.Vector3();
    this.reset(0, 0, 0);
  }

  reset(s, d, rYaw) {
    this.s = s;
    this.d = d;
    this.rYaw = rYaw;
    this.targetYaw = rYaw;
    this.turnRate = 5;
    this.speed = 0;
    this.gait = 'stand';
    this.phase = Math.random();
    this.hopH = 0.6;
    this.y = 0;
    this.vy = 0;
    this.vs = 0;
    this.vd = 0;
    this.spin = 0;
    this.roll = 0;
    this.airborne = false;
    this.onLand = null;
    this.locked = false;
    this.flying = false;
    this.flyT = 0;
    this.setFlyLook(false);
    this.shadow.visible = true;
    this.hit = false;
    this.passed = false;
    this.counted = false;
    this.headPitchT = 0;
    this.headYawT = 0;
    this.look = false;
    this.tailUp = false;
    this.state = 'idle';
    this.t = 0;
    this.data = {};
    this.camDist = 999;
    this.dizzyT = 0;
    this.bubbleT = 0;
    if (this.bubble) this.bubble.visible = false;
    for (const st of this.stars) st.visible = false;
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.model.rotation.z = 0;
    for (const l of this.legs) l.rotation.x = 0;
  }

  setState(state) {
    this.state = state;
    this.t = 0;
  }

  // Face across the road toward side `dir` (+1 = toward +d / right, -1 = toward left).
  faceSide(dir) {
    this.targetYaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  jump(vy) {
    this.airborne = true;
    this.vy = vy;
  }

  setFlyLook(on) {
    const S = shared();
    for (const m of this.meshes) {
      m.material = on ? S.flyMaterial : S.material;
      m.renderOrder = on ? 14 : 0; // after smoke (11), fire (12) and sparks (13)
    }
  }

  // Cartoon launch: up and away down the road, spinning, and curving ever
  // higher (it accelerates upward). It is still climbing, high above the
  // mountains, when the KABOOM clears, then shrinks to a speck in the sky.
  // World coordinates, so the flight doesn't bend with the road.
  blastOff(road, carV) {
    const yaw = road.sample(this.s).yaw;
    const fwd = carV + 26;
    const side = (Math.random() - 0.5) * 5;
    this.flyPos.copy(this.group.position);
    this.flyVel.set(-Math.sin(yaw) * fwd + Math.cos(yaw) * side, 7, -Math.cos(yaw) * fwd - Math.sin(yaw) * side);
    this.setFlyLook(true);
    this.flyYaw = this.group.rotation.y;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 3);
    this.flyRoll = (Math.random() < 0.5 ? -1 : 1) * 9;
    this.flying = true;
    this.flyT = 0;
    this.airborne = false;
    this.onLand = null;
    this.look = false;
    this.gait = 'bound'; // legs flail
    this.shadow.visible = false;
    this.setState('flying');
  }

  integrate(dt) {
    this.t += dt;
    if (this.flying) {
      this.flyT += dt;
      this.flyVel.y += 3.5 * dt; // cartoon lift: the climb gets steeper
      this.flyPos.addScaledVector(this.flyVel, dt);
      this.flyYaw += this.spin * dt;
      this.roll += this.flyRoll * dt;
      return;
    }
    const dy = wrapAngle(this.targetYaw - this.rYaw);
    this.rYaw += clamp(dy, -this.turnRate * dt, this.turnRate * dt);
    if (!this.locked) {
      this.s += (this.speed * Math.cos(this.rYaw) + this.vs) * dt;
      this.d += (-this.speed * Math.sin(this.rYaw) + this.vd) * dt;
    }
    if (this.airborne) {
      this.vy -= 18 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        const f = this.onLand;
        this.onLand = null;
        if (f) f();
      }
    }
    const fr = Math.exp(-2.5 * dt);
    this.vs *= fr;
    this.vd *= fr;
    if (this.spin) {
      this.rYaw += this.spin * dt;
      this.targetYaw = this.rYaw;
      this.spin *= Math.exp(-2.2 * dt);
      if (Math.abs(this.spin) < 0.05) this.spin = 0;
    }
    this.roll = damp(this.roll, 0, this.airborne ? 0.5 : 4, dt);
  }

  animate(dt) {
    const g = this.gait, L = this.legs, b = this.body;
    let rate = 0;
    if (g === 'walk') rate = 1.7;
    else if (g === 'trot') rate = 2.8;
    else if (g === 'bound') rate = 1.7 + this.speed * 0.06;
    this.phase += dt * rate;
    if (g === 'bound') {
      const u = this.phase % 1;
      const air = Math.sin(u * Math.PI);
      b.position.y = air * this.hopH;
      b.rotation.x = -0.28 * Math.cos(u * Math.PI);
      const fr = -0.85 * air + 0.25, hr = 0.95 * air - 0.15;
      L[0].rotation.x = fr;
      L[1].rotation.x = fr + 0.08;
      L[2].rotation.x = hr;
      L[3].rotation.x = hr - 0.08;
    } else if (g === 'stand') {
      b.position.y = damp(b.position.y, 0, 10, dt);
      b.rotation.x = damp(b.rotation.x, 0, 10, dt);
      for (const l of L) l.rotation.x = damp(l.rotation.x, 0, 10, dt);
    } else {
      const amp = g === 'walk' ? 0.32 : 0.55;
      const p = this.phase * Math.PI * 2;
      L[0].rotation.x = L[3].rotation.x = amp * Math.sin(p);
      L[1].rotation.x = L[2].rotation.x = amp * Math.sin(p + Math.PI);
      b.position.y = Math.abs(Math.sin(p)) * (g === 'walk' ? 0.02 : 0.06);
      b.rotation.x = damp(b.rotation.x, 0, 8, dt);
    }
    this.head.rotation.x = damp(this.head.rotation.x, this.headPitchT, 6, dt);
    this.head.rotation.y = damp(this.head.rotation.y, this.look ? this.headYawT : 0, 5, dt);
    const tailT = this.tailUp ? 2.3 : 0.2 + Math.sin(this.phase * 11) * 0.06;
    this.tail.rotation.x = damp(this.tail.rotation.x, tailT, 9, dt);
    this.model.rotation.z = this.roll;
  }

  place(world, camPos) {
    if (this.flying) {
      this.group.position.copy(this.flyPos);
      this.group.rotation.y = this.flyYaw;
      this.camDist = this.flyPos.distanceTo(camPos);
      return;
    }
    const yaw = world.road.toWorld(this.s, this.d, _p);
    const gy = world.heightAt(this.s, this.d);
    this.group.position.set(_p.x, gy + this.y, _p.z);
    this.group.rotation.y = yaw + this.rYaw;
    this.shadow.position.y = -this.y + 0.05;
    const ss = this.K.scale / (1 + this.y * 0.6);
    this.shadow.scale.set(ss, 1, ss);
    const dx = camPos.x - _p.x, dz = camPos.z - _p.z;
    this.camDist = Math.hypot(dx, dz);
    this.headYawT = clamp(wrapAngle(Math.atan2(-dx, -dz) - this.group.rotation.y), -1.25, 1.25);
  }

  updateEyes(camPos, camFwd, lightsOn) {
    if (this.flying || (!lightsOn && !this.K.angry)) {
      this.eyeMat.opacity = 0;
      return;
    }
    const faceYaw = this.group.rotation.y + this.head.rotation.y;
    const fx = -Math.sin(faceYaw), fz = -Math.cos(faceYaw);
    const dx = camPos.x - this.group.position.x, dz = camPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const facing = (fx * dx + fz * dz) / dist;
    const beam = -(camFwd.x * dx + camFwd.z * dz) / dist;
    const lit = this.K.angry ? 1 : smoothstep(0.8, 0.96, beam);
    this.eyeMat.opacity = smoothstep(0.3, 0.85, facing) * lit * smoothstep(260, 140, dist) * smoothstep(2, 7, dist);
    const sc = clamp(dist * 0.0055, 0.06, 1.3) / this.K.scale;
    for (const e of this.eyes) e.scale.setScalar(sc);
  }

  dizzy(seconds) {
    this.dizzyT = seconds;
    if (!this.stars.length) {
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(shared().starMat);
        sp.scale.setScalar(0.24);
        this.group.add(sp);
        this.stars.push(sp);
      }
    }
  }

  say(text, seconds = 2.4) {
    const S = shared();
    let entry = S.bubbles.get(text);
    if (!entry) {
      const { tex, aspect } = makeBubbleTexture(text);
      entry = { mat: new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, fog: false, transparent: true }), aspect };
      S.bubbles.set(text, entry);
    }
    if (!this.bubble) {
      this.bubble = new THREE.Sprite(entry.mat);
      this.bubble.renderOrder = 15; // over crash smoke and a flying deer
      this.group.add(this.bubble);
    }
    this.bubble.material = entry.mat;
    this.bubbleAspect = entry.aspect;
    this.bubbleT = seconds;
    this.bubble.visible = true;
  }

  clearFx() {
    this.dizzyT = 0;
    this.bubbleT = 0;
    if (this.bubble) this.bubble.visible = false;
    for (const st of this.stars) st.visible = false;
    this.eyeMat.opacity = 0;
  }

  updateFx(dt) {
    const k = this.K.scale;
    if (this.dizzyT > 0) {
      this.dizzyT -= dt;
      const t = performance.now() / 1000;
      for (let i = 0; i < this.stars.length; i++) {
        const a = t * 5 + i * 2.094;
        const st = this.stars[i];
        st.visible = this.dizzyT > 0;
        st.position.set(Math.cos(a) * 0.3, 1.78 * k + Math.sin(a * 2) * 0.05 - this.body.position.y * 0, -0.5 * k + Math.sin(a) * 0.3);
      }
    } else {
      for (const st of this.stars) st.visible = false;
    }
    if (this.bubble && this.bubbleT > 0) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) this.bubble.visible = false;
      else {
        // a launched deer's bubble keeps growing so it stays readable far away
        const h = clamp(this.camDist * 0.07, 0.55, this.flying ? 10 : 3.2);
        this.bubble.scale.set(h * this.bubbleAspect, h, 1);
        this.bubble.position.set(this.bubbleX || 0, this.bubbleY != null ? this.bubbleY : 2.0 * k + h * 0.55, -0.3 * k);
        this.bubble.material.opacity = Math.min(1, this.bubbleT * 3);
      }
    }
  }
}

export class DeerManager {
  constructor(world) {
    this.world = world;
    this.pool = { doe: [], buck: [], fawn: [], angry: [] };
    this.active = [];
  }

  spawn(kind, s, d, rYaw = 0) {
    const deer = this.pool[kind].pop() || new Deer(kind);
    deer.reset(s, d, rYaw);
    this.world.dynamic.add(deer.group);
    this.active.push(deer);
    return deer;
  }

  release(deer) {
    const i = this.active.indexOf(deer);
    if (i >= 0) this.active.splice(i, 1);
    this.world.dynamic.remove(deer.group);
    deer.clearFx();
    this.pool[deer.kind].push(deer);
  }

  clear() {
    for (const d of [...this.active]) this.release(d);
  }

  update(dt, camPos, camFwd) {
    const lights = !!this.world.theme.headlights;
    for (const deer of this.active) {
      deer.integrate(dt);
      deer.animate(dt);
      deer.place(this.world, camPos);
      deer.updateEyes(camPos, camFwd, lights);
      deer.updateFx(dt);
    }
  }
}

export function randomKind(rng) {
  const r = rng();
  return r < 0.5 ? 'doe' : r < 0.85 ? 'buck' : 'fawn';
}
