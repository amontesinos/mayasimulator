// Crash explosion: an exterior Honda model (white, then charred), a fireball,
// smoke, sparks, flying debris, and a burning wreck. Particles are instanced
// camera-facing quads (one draw call per system, no point-size limits).
import * as THREE from '../vendor/three.module.min.js';
import { part, merge, mat } from './geo.js';
import { rand } from './util.js';
import { makeCanvas, canvasTexture } from './textures.js';

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Vector3();

// Four-point sparkle with a soft glow, for the "ding!" twinkle.
function makeTwinkleTexture() {
  const [c, g] = makeCanvas(128, 128);
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 44);
  glow.addColorStop(0, 'rgba(255,255,240,1)');
  glow.addColorStop(0.3, 'rgba(255,240,170,0.55)');
  glow.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  const star = (len, w) => {
    g.beginPath();
    g.moveTo(64, 64 - len);
    g.quadraticCurveTo(64 + w, 64 - w, 64 + len, 64);
    g.quadraticCurveTo(64 + w, 64 + w, 64, 64 + len);
    g.quadraticCurveTo(64 - w, 64 + w, 64 - len, 64);
    g.quadraticCurveTo(64 - w, 64 - w, 64, 64 - len);
    g.fill();
  };
  g.fillStyle = '#fffbe6';
  star(62, 6);
  g.globalAlpha = 0.6;
  g.translate(64, 64);
  g.rotate(Math.PI / 4);
  g.translate(-64, -64);
  star(34, 4);
  return canvasTexture(c);
}

const PVS = /* glsl */ `
attribute vec3 iOffset;
attribute float iSize;
attribute float iRot;
attribute vec4 iColor;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = iColor;
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
  float c = cos(iRot), s = sin(iRot);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;
  gl_Position = projectionMatrix * mv;
}`;

const PFS = /* glsl */ `
uniform float lobeAmp;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float lobes = 1.0 - lobeAmp + lobeAmp * sin(atan(q.y, q.x) * 5.0);
  float a = 1.0 - smoothstep(lobes * 0.25, lobes, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <colorspace_fragment>
}`;

// linear-space colors (displayed as sRGB): yellow-orange -> orange -> dark red
const FLAME = [[1.0, 0.6, 0.12], [1.0, 0.2, 0.012], [0.35, 0.03, 0.005]];
const SPARK = [[1.0, 0.85, 0.45], [1.0, 0.38, 0.05], [0.7, 0.1, 0.01]];
const SMOKE = [[0.07, 0.065, 0.06], [0.045, 0.042, 0.04], [0.03, 0.03, 0.03]];

class Particles {
  constructor(max, additive, renderOrder, lobeAmp = 0.12) {
    this.max = max;
    this.list = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aOff = attr(3);
    this.aSize = attr(1);
    this.aRot = attr(1);
    this.aCol = attr(4);
    geo.setAttribute('iOffset', this.aOff);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iRot', this.aRot);
    geo.setAttribute('iColor', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const material = new THREE.ShaderMaterial({
      uniforms: { lobeAmp: { value: lobeAmp } },
      vertexShader: PVS,
      fragmentShader: PFS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  add(p) {
    if (this.list.length < this.max) this.list.push(p);
  }

  clear() {
    this.list.length = 0;
    this.geo.instanceCount = 0;
  }

  update(dt) {
    const off = this.aOff.array, size = this.aSize.array, rot = this.aRot.array, col = this.aCol.array;
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      const t = p.age / p.life;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.g * dt;
      p.vz *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.vr * dt;
      off[n * 3] = p.x;
      off[n * 3 + 1] = p.y;
      off[n * 3 + 2] = p.z;
      size[n] = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      rot[n] = p.rot;
      const c = p.colors;
      const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const a = t < 0.5 ? c[0] : c[1], b = t < 0.5 ? c[1] : c[2];
      col[n * 4] = a[0] + (b[0] - a[0]) * k;
      col[n * 4 + 1] = a[1] + (b[1] - a[1]) * k;
      col[n * 4 + 2] = a[2] + (b[2] - a[2]) * k;
      col[n * 4 + 3] = p.a0 * Math.pow(1 - t, p.fade);
      n++;
    }
    this.geo.instanceCount = n;
    this.aOff.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = this.aCol.needsUpdate = true;
  }
}

// --- exterior Honda (crossover silhouette), car-local: forward = -z, ground = y 0
function sideProfile(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

function extrudeAcross(points, width, bevel) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(sideProfile(points), {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateY(Math.PI / 2); // profile x (front = +) becomes -z; extrusion becomes x
  g.translate(-depth / 2, 0, 0);
  return g;
}

function buildCar() {
  const WHITE = 0xf5f5f2, GLASS = 0x1b222c, BLACK = 0x1a1a1c, SILVER = 0xb8bec6;
  const paint = merge([
    part(extrudeAcross([[2.15, 0.36], [2.19, 0.62], [2.12, 0.82], [1.92, 0.9], [0.95, 1.02], [0.8, 1.05], [-1.75, 1.13], [-2.12, 1.06], [-2.18, 0.72], [-2.12, 0.36]], 1.74, 0.05), WHITE),
    part(new THREE.BoxGeometry(1.36, 0.05, 1.22), WHITE, mat(0, 1.565, 0.36, 0.04, 0, 0)),
    part(new THREE.BoxGeometry(0.12, 0.08, 0.17), WHITE, mat(-0.95, 1.08, -0.75)),
    part(new THREE.BoxGeometry(0.12, 0.08, 0.17), WHITE, mat(0.95, 1.08, -0.75)),
  ]);
  const glass = merge([
    part(extrudeAcross([[0.93, 1.0], [0.22, 1.5], [-0.95, 1.55], [-1.86, 1.2], [-1.78, 1.08], [0.8, 1.0]], 1.5, 0.03), GLASS),
  ]);
  const black = [
    part(new THREE.BoxGeometry(1.77, 0.2, 4.12), BLACK, mat(0, 0.46, 0)),
    part(new THREE.BoxGeometry(0.9, 0.16, 0.05), BLACK, mat(0, 0.72, -2.19)),
  ];
  const silver = [];
  for (const x of [-0.8, 0.8]) {
    for (const z of [-1.33, 1.33]) {
      black.push(part(new THREE.CylinderGeometry(0.35, 0.35, 0.26, 16), BLACK, mat(x, 0.35, z, 0, 0, Math.PI / 2)));
      silver.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 12), SILVER, mat(x, 0.35, z, 0, 0, Math.PI / 2)));
    }
  }
  const lights = merge([
    part(new THREE.BoxGeometry(0.42, 0.09, 0.06), 0xfff4d6, mat(-0.58, 0.86, -2.12)),
    part(new THREE.BoxGeometry(0.42, 0.09, 0.06), 0xfff4d6, mat(0.58, 0.86, -2.12)),
    part(new THREE.BoxGeometry(0.38, 0.1, 0.06), 0xff2020, mat(-0.6, 0.98, 2.14)),
    part(new THREE.BoxGeometry(0.38, 0.1, 0.06), 0xff2020, mat(0.6, 0.98, 2.14)),
  ]);
  return { paint, glass, black: merge(black), silver: merge(silver), lights };
}

export class CrashFX {
  constructor(world) {
    this.world = world;
    // Flames use normal blending so they stay orange against a bright sky;
    // sparks are additive for the glow.
    this.smoke = new Particles(200, false, 11, 0.18);
    this.fire = new Particles(320, false, 12, 0.1);
    this.sparks = new Particles(160, true, 13, 0);
    world.scene.add(this.smoke.mesh, this.fire.mesh, this.sparks.mesh);
    const G = buildCar();
    this.paintMat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xbbbbbb, shininess: 80 });
    this.charMat = new THREE.MeshLambertMaterial({ color: 0x2b2724 });
    this.vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.deadLightMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    // wreck = group at the car's center; the model hangs 0.8 m below so it rolls about its middle
    this.wreck = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.y = -0.8;
    this.wreck.add(inner);
    this.wreckBody = new THREE.Mesh(G.paint, this.paintMat);
    this.wreckLights = new THREE.Mesh(G.lights, this.lightMat);
    inner.add(this.wreckBody, new THREE.Mesh(G.glass, this.vcMat), new THREE.Mesh(G.black, this.vcMat), new THREE.Mesh(G.silver, this.vcMat), this.wreckLights);
    this.wreck.visible = false;
    world.scene.add(this.wreck);
    this.qYaw = new THREE.Quaternion();
    this.qRoll = new THREE.Quaternion();
    this.twinkleT = -1;
    this.twinkleSprite = null;
    this.debris = [];
    this.debrisGeos = {
      panel: new THREE.BoxGeometry(1, 0.045, 1),
      tire: new THREE.CylinderGeometry(0.35, 0.35, 0.25, 14),
      door: new THREE.BoxGeometry(1.0, 0.72, 0.06),
      chunk: new THREE.BoxGeometry(1, 1, 1),
    };
    this.tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
    this.whiteMat = new THREE.MeshPhongMaterial({ color: 0xf2f2ee, specular: 0x999999, shininess: 60 });
    this.burning = false;
    this.tmp = new THREE.Vector3();
  }

  reset() {
    this.wreck.visible = false;
    this.fire.clear();
    this.smoke.clear();
    this.sparks.clear();
    for (const d of this.debris) this.world.scene.remove(d.mesh);
    this.debris = [];
    this.burning = false;
    this.world.fireLight.intensity = 0;
    this.twinkleT = -1;
    if (this.twinkleSprite) this.twinkleSprite.visible = false;
  }

  // Show the (still white) exterior car where the player crashed. From then on
  // syncWreck() keeps it riding on the (still rolling) car, plus its own hop,
  // barrel roll and spin.
  placeWreck(rig) {
    this.reset();
    this.wreck.visible = true;
    this.wreckBody.material = this.paintMat;
    this.wreckLights.material = this.lightMat;
    this.lift = 0;
    this.vy = 0;
    this.airborne = false;
    this.roll = 0;
    this.rollTarget = 0;
    this.spinRoll = 0;
    this.yawOff = 0;
    this.spinYaw = 0;
    this.syncWreck(rig);
  }

  syncWreck(rig) {
    const w = this.wreck;
    // keep the lowest corner on the ground for the current roll angle
    const rest = 0.87 * Math.abs(Math.sin(this.roll)) + 0.8 * Math.abs(Math.cos(this.roll));
    w.position.copy(rig.position);
    w.position.y += rest + this.lift;
    this.qYaw.setFromAxisAngle(AXIS_Y, this.yawOff);
    this.qRoll.setFromAxisAngle(AXIS_Z, this.roll);
    w.quaternion.copy(rig.quaternion).multiply(this.qYaw).multiply(this.qRoll);
    this.ground = rig.position.y;
  }

  // carVel: the car's world velocity at the moment of the blast (pieces keep it).
  // pinned: the car is stopped dead against a tree or rock, so the blast only
  // bucks it up and drops it back in place (no barrel roll, no spinning slide).
  explode(carVel, pinned = false) {
    const c = this.tmp.copy(this.wreck.position);
    const iv = carVel || ZERO;
    this.debrisGround = this.ground;
    const rv = () => {
      const u = rand(Math.random, -1, 1), th = rand(Math.random, 0, Math.PI * 2);
      const r = Math.sqrt(1 - u * u);
      return [r * Math.cos(th), Math.abs(u) * 0.8 + 0.2, r * Math.sin(th)];
    };
    for (let i = 0; i < 80; i++) {
      const [x, y, z] = rv(), sp = rand(Math.random, 3, 11);
      this.fire.add({ x: c.x + x * 0.6, y: c.y + y * 0.4, z: c.z + z * 0.6, vx: x * sp + iv.x * 0.6, vy: y * sp + 2, vz: z * sp + iv.z * 0.6, age: 0, life: rand(Math.random, 0.6, 1.4), s0: rand(Math.random, 1.4, 2.8), s1: rand(Math.random, 3.5, 6.5), rot: rand(Math.random, 0, 6.28), vr: rand(Math.random, -2, 2), drag: 2.6, g: 1.5, colors: FLAME, a0: 0.95, fade: 1.4 });
    }
    for (let i = 0; i < 40; i++) {
      const [x, y, z] = rv(), sp = rand(Math.random, 1.5, 6);
      this.smoke.add({ x: c.x + x, y: c.y + y * 0.6, z: c.z + z, vx: x * sp + iv.x * 0.4, vy: y * sp + 1, vz: z * sp + iv.z * 0.4, age: 0, life: rand(Math.random, 2.2, 3.8), s0: rand(Math.random, 2, 3), s1: rand(Math.random, 6, 10), rot: rand(Math.random, 0, 6.28), vr: rand(Math.random, -0.6, 0.6), drag: 1.4, g: 1.2, colors: SMOKE, a0: 0.6, fade: 1.3 });
    }
    for (let i = 0; i < 70; i++) {
      const [x, y, z] = rv(), sp = rand(Math.random, 9, 20);
      this.sparks.add({ x: c.x, y: c.y, z: c.z, vx: x * sp + iv.x * 0.5, vy: y * sp + 3, vz: z * sp + iv.z * 0.5, age: 0, life: rand(Math.random, 0.8, 1.6), s0: rand(Math.random, 0.25, 0.4), s1: 0.06, rot: 0, vr: 0, drag: 0.4, g: -14, colors: SPARK, a0: 1, fade: 0.6 });
    }
    // flying pieces of the car
    // half = resting height above the ground once the piece settles
    const spawn = (geo, material, sx, sy, sz, half) => {
      const m = new THREE.Mesh(geo, material);
      m.scale.set(sx, sy, sz);
      m.position.copy(c).add(new THREE.Vector3(rand(Math.random, -0.6, 0.6), rand(Math.random, -0.3, 0.5), rand(Math.random, -1.2, 1.2)));
      const [x, y, z] = rv(), sp = rand(Math.random, 5, 13);
      this.world.scene.add(m);
      this.debris.push({ mesh: m, v: new THREE.Vector3(x * sp + iv.x * 0.8, y * sp + rand(Math.random, 3, 7), z * sp + iv.z * 0.8), w: new THREE.Vector3(rand(Math.random, -9, 9), rand(Math.random, -9, 9), rand(Math.random, -9, 9)), half, bounces: 0 });
    };
    for (let i = 0; i < 6; i++) spawn(this.debrisGeos.panel, this.whiteMat, rand(Math.random, 0.5, 1.0), 1, rand(Math.random, 0.4, 0.8), 0.03);
    spawn(this.debrisGeos.door, this.whiteMat, 1, 1, 1, 0.04);
    spawn(this.debrisGeos.tire, this.tireMat, 1, 1, 1, 0.14);
    spawn(this.debrisGeos.tire, this.tireMat, 1, 1, 1, 0.14);
    for (let i = 0; i < 5; i++) {
      const s = rand(Math.random, 0.2, 0.45);
      spawn(this.debrisGeos.chunk, this.charMat, s, s * 0.7, s, s * 0.35);
    }
    // The car is blown into the air and does a barrel roll timed to land squarely
    // on its roof (or all the way around onto its wheels), then spins as it slides.
    this.wreckBody.material = this.charMat;
    this.wreckLights.material = this.deadLightMat;
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.airborne = true;
    if (pinned) {
      this.vy = 3.6;
      this.rollTarget = dir * rand(Math.random, 0.06, 0.14); // lands slightly askew
      this.spinYaw = dir * rand(Math.random, 0.08, 0.16);
    } else {
      this.vy = 7.5;
      this.rollTarget = dir * (Math.random() < 0.7 ? Math.PI : Math.PI * 2);
      this.spinYaw = (Math.random() < 0.5 ? -1 : 1) * rand(Math.random, 1.6, 3.2);
    }
    this.spinRoll = this.rollTarget / ((2 * this.vy) / 18);
    this.burning = true;
    this.burnT = 0;
    this.fireAcc = 0;
    this.smokeAcc = 0;
    const fl = this.world.fireLight;
    fl.position.copy(c);
    fl.intensity = 260;
  }

  // A little cartoon "ding" star where something disappeared into the distance.
  twinkle(pos, camPos) {
    if (!this.twinkleSprite) {
      this.twinkleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeTwinkleTexture(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false, transparent: true,
      }));
      this.twinkleSprite.renderOrder = 20;
      this.world.scene.add(this.twinkleSprite);
    }
    this.twinkleSprite.position.copy(pos);
    this.twinkleDist = pos.distanceTo(camPos);
    this.twinkleT = 0;
    this.twinkleSprite.visible = true;
  }

  update(dt) {
    const w = this.wreck;
    if (w.visible) {
      if (this.airborne) {
        this.vy -= 18 * dt;
        this.lift += this.vy * dt;
        if (this.spinRoll) this.roll += this.spinRoll * dt;
        if (this.lift <= 0) {
          this.lift = 0;
          if (this.spinRoll) {
            this.roll = this.rollTarget; // land squarely
            this.spinRoll = 0;
          }
          if (this.vy < -3) this.vy = -this.vy * 0.28;
          else {
            this.vy = 0;
            this.airborne = false;
          }
        }
      }
      this.yawOff += this.spinYaw * dt;
      if (!this.airborne) this.spinYaw *= Math.exp(-1.3 * dt);
    }
    if (this.twinkleT >= 0) {
      this.twinkleT += dt;
      const k = this.twinkleT / 0.8;
      if (k >= 1) {
        this.twinkleT = -1;
        this.twinkleSprite.visible = false;
      } else {
        const s = Math.pow(Math.sin(k * Math.PI), 0.8) * this.twinkleDist * 0.085;
        this.twinkleSprite.scale.set(s, s, 1);
        this.twinkleSprite.material.rotation = k * 2.5;
      }
    }
    if (this.burning) {
      this.burnT += dt;
      const rate = this.burnT < 6 ? 55 : 25;
      this.fireAcc += dt * rate;
      this.smokeAcc += dt * 11;
      const p = w.position; // the car's center, which keeps moving while it slides
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        this.fire.add({ x: p.x + rand(Math.random, -0.8, 0.8), y: p.y + rand(Math.random, -0.2, 0.5), z: p.z + rand(Math.random, -1.5, 1.5), vx: rand(Math.random, -0.4, 0.4), vy: rand(Math.random, 1.6, 3.4), vz: rand(Math.random, -0.4, 0.4), age: 0, life: rand(Math.random, 0.55, 1.0), s0: rand(Math.random, 1.3, 2.3), s1: 0.45, rot: rand(Math.random, 0, 6.28), vr: rand(Math.random, -3, 3), drag: 1, g: 2, colors: FLAME, a0: 0.92, fade: 0.9 });
        if (Math.random() < 0.15) this.sparks.add({ x: p.x + rand(Math.random, -0.6, 0.6), y: p.y + 0.4, z: p.z + rand(Math.random, -1, 1), vx: rand(Math.random, -1, 1), vy: rand(Math.random, 3, 6), vz: rand(Math.random, -1, 1), age: 0, life: rand(Math.random, 0.8, 1.5), s0: 0.12, s1: 0.04, rot: 0, vr: 0, drag: 0.8, g: -2, colors: SPARK, a0: 1, fade: 0.7 });
      }
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        this.smoke.add({ x: p.x + rand(Math.random, -0.6, 0.6), y: p.y + 1.6, z: p.z + rand(Math.random, -0.8, 0.8), vx: rand(Math.random, -0.5, 0.5), vy: rand(Math.random, 1.8, 3), vz: rand(Math.random, -0.5, 0.5), age: 0, life: rand(Math.random, 2.5, 4), s0: 1.2, s1: rand(Math.random, 4.5, 7), rot: rand(Math.random, 0, 6.28), vr: rand(Math.random, -0.5, 0.5), drag: 0.6, g: 0.6, colors: SMOKE, a0: 0.45, fade: 1.2 });
      }
      const fl = this.world.fireLight;
      fl.position.set(p.x, p.y + 0.8, p.z);
      fl.intensity = (this.burnT < 0.25 ? 260 : 70) * (0.75 + 0.25 * Math.sin(this.burnT * 23) * Math.sin(this.burnT * 7.3));
    }
    for (const d of this.debris) {
      if (d.bounces > 4) continue;
      d.v.y -= 18 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.w.x * dt;
      d.mesh.rotation.y += d.w.y * dt;
      d.mesh.rotation.z += d.w.z * dt;
      if (d.mesh.position.y < this.debrisGround + d.half) {
        d.mesh.position.y = this.debrisGround + d.half;
        d.v.y = -d.v.y * 0.35;
        d.v.x *= 0.55;
        d.v.z *= 0.55;
        d.w.multiplyScalar(0.5);
        d.bounces++;
        if (Math.abs(d.v.y) < 1) d.bounces = 5;
      }
    }
    this.fire.update(dt);
    this.smoke.update(dt);
    this.sparks.update(dt);
  }
}
