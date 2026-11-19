// The outside world: sky, mountains, lighting, and the endless road built in
// chunks (asphalt, terrain, trees, posts, signs) that stream in ahead of the car.
import * as THREE from '../vendor/three.module.min.js';
import { mulberry32, rand, clamp, smoothstep, makeNoise2D, fbm, pick, weighted } from './util.js';
import { part, merge, mat } from './geo.js';
import { makeRoadTexture, makeWarningSign, makeTextSign } from './textures.js';

// scratch objects for posing knocked-over signs and posts
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mf = new THREE.Matrix4();
const _pf = new THREE.Vector3();
const _one3 = new THREE.Vector3(1, 1, 1);

export const ROADS = {
  twoLane: {
    left: -4.8, right: 4.8, length: 12, paved: 3.6,
    asphalt: '#3c3c41', shoulder: '#4e4b47',
    shoulders: [[-4.8, -3.68], [3.68, 4.8]],
    tracks: [-2.6, -1.0, 1.0, 2.6],
    lines: [
      { d: -3.6, w: 0.15, color: '#e9e6dc' },
      { d: 3.6, w: 0.15, color: '#e9e6dc' },
      { d: -0.11, w: 0.11, color: '#e8b923' },
      { d: 0.11, w: 0.11, color: '#e8b923' },
    ],
    lanes: [-1.8, 1.8],
  },
  highway: {
    left: -6.75, right: 7.95, length: 12, paved: 5.55,
    asphalt: '#39393e', shoulder: '#48464b',
    shoulders: [[-6.75, -5.63], [5.63, 7.95]],
    tracks: [-4.5, -2.9, -0.8, 0.8, 2.9, 4.5],
    lines: [
      { d: -5.55, w: 0.15, color: '#e8b923' },
      { d: 5.55, w: 0.15, color: '#e9e6dc' },
      { d: -1.85, w: 0.13, color: '#e9e6dc', dash: [3, 9] },
      { d: 1.85, w: 0.13, color: '#e9e6dc', dash: [3, 9] },
    ],
    lanes: [-3.7, 0, 3.7],
  },
};

const JOKES = ['joke1', 'joke2', 'joke3', 'joke4', 'joke5', 'joke6'];

export const THEMES = {
  // Deer Dodge: golden-hour-into-dusk mountain canyon with fall aspens.
  dusk: {
    road: 'twoLane',
    sky: { zenith: 0x24275a, mid: 0x93608a, horizon: 0xf3a57a, ground: 0x3a2d3c, sunColor: 0xffb26e, sunDir: [-0.6, 0.075, -0.8], sunSize: 0.99935, glow: 1.0, stars: 0.3, clouds: 0.5, cloudColor: 0x7b5279 },
    fog: { color: 0xcf8d7a, near: 45, far: 560 },
    hemi: [0xffd0b0, 0x3a3048, 1.5],
    sun: [0xffbb80, 2.2],
    headlights: 900,
    signGlow: 0.35,
    terrain: { ditch: 0.35, ditchW: 3.2, riseBase: 0.22, riseVar: 0.14, bumps: 3.0, gravel: 0x7a7066, grassNear: 0x7a7a40, grassFar: 0x4c5530, forest: 0x3c4030 },
    trees: { perSide: 95, minX: 6.5, maxX: 105, aspen: 0.36, clearing: -0.45, line: [6.6, 8.6, 7.5], pine: [0x2d4a31, 0x36532f, 0x28412d], aspenCols: [0xe8ae2a, 0xdc8a1f, 0xd2b53a, 0xc1761d] },
    mountains: { far: [0x7d5a86, 0xa8728c], near: [0x47384f, 0x6b4a66], snow: false },
    posts: true,
    signs: [['deer', 4], ['speed55', 2], ['joke', 1.5]],
  },
  // Chill Cruise: sunny afternoon, meadows and snowy peaks.
  day: {
    road: 'twoLane',
    sky: { zenith: 0x3f82d8, mid: 0x93c3ee, horizon: 0xd8ecf7, ground: 0x6d7d5c, sunColor: 0xfff1d0, sunDir: [0.4, 0.7, -0.6], sunSize: 0.9994, glow: 0.45, stars: 0, clouds: 0.85, cloudColor: 0xffffff },
    fog: { color: 0xcde3f1, near: 90, far: 950 },
    hemi: [0xdcefff, 0x60724a, 1.7],
    sun: [0xfff4e2, 2.6],
    headlights: 0,
    signGlow: 0.1,
    terrain: { ditch: 0.3, ditchW: 3.0, riseBase: 0.05, riseVar: 0.1, bumps: 2.5, gravel: 0x958a78, grassNear: 0x86a24a, grassFar: 0x62843a, forest: 0x4d6630 },
    trees: { perSide: 70, minX: 8, maxX: 105, aspen: 0.45, clearing: 0.0, pine: [0x2f5a33, 0x3a6a35, 0x2b4f30], aspenCols: [0xf0c23a, 0xe7a52c, 0xc8c447, 0x8fae3f] },
    mountains: { far: [0x9cb0c8, 0xc4d3e4], near: [0x6f8499, 0x93a6ba], snow: true },
    posts: true,
    signs: [['deer', 3], ['speed45', 2], ['joke', 1.5]],
  },
  // Deer Revenge: twilight interstate.
  twilight: {
    road: 'highway',
    sky: { zenith: 0x0e1236, mid: 0x3b3672, horizon: 0x9a5f88, ground: 0x1d1b2b, sunColor: 0xff8f6c, sunDir: [0.55, -0.01, -0.83], sunSize: 0.9993, glow: 0.8, stars: 1.0, clouds: 0.3, cloudColor: 0x352c5c },
    fog: { color: 0x6c5484, near: 40, far: 540 },
    hemi: [0x9a96d6, 0x24223a, 1.25],
    sun: [0xc4a6ff, 0.7],
    headlights: 1100,
    signGlow: 0.45,
    terrain: { ditch: 0.25, ditchW: 2.6, riseBase: 0.06, riseVar: 0.05, bumps: 2.0, gravel: 0x5e5c62, grassNear: 0x47533a, grassFar: 0x34402e, forest: 0x2a3125 },
    trees: { perSide: 70, minX: 11, maxX: 105, aspen: 0.12, clearing: -0.15, pine: [0x24402a, 0x2c4a2c, 0x203828], aspenCols: [0xc99a2a, 0xb9781f] },
    mountains: { far: [0x4c3f70, 0x6a5288], near: [0x2c2748, 0x40355e], snow: false },
    posts: false,
    barrier: true,
    guardrail: true,
    signs: [['deer', 3], ['speed70', 3], ['joke', 1.5]],
  },
};

const SIGN_DEFS = {
  deer: { warn: 'deer', w: 1.05, h: 1.05, plaque: true },
  curveL: { warn: 'curveL', w: 1.0, h: 1.0 },
  curveR: { warn: 'curveR', w: 1.0, h: 1.0 },
  speed45: { text: [['SPEED', 52], ['LIMIT', 52], ['45', 138]], w: 0.75, h: 0.94 },
  speed55: { text: [['SPEED', 52], ['LIMIT', 52], ['55', 138]], w: 0.75, h: 0.94 },
  speed70: { text: [['SPEED', 52], ['LIMIT', 52], ['70', 138]], w: 0.75, h: 0.94 },
  joke1: { text: [['DEER', 70], ['PLEASE USE', 50], ['CROSSWALK', 50]], w: 1.3, h: 0.95, tw: 384, th: 280 },
  joke2: { text: [['YIELD', 84], ['TO DEER', 64]], w: 1.2, h: 0.9, tw: 384, th: 280 },
  joke3: { text: [['NO DEER', 62], ['BEYOND', 50], ['THIS POINT', 50]], w: 1.3, h: 0.95, tw: 384, th: 280 },
  joke4: { text: [['THE DEER', 58], ['ARE', 52], ['WATCHING', 58]], w: 1.2, h: 0.95, tw: 384, th: 280 },
  joke5: { text: [['HONK IF', 54], ['YOU LOVE', 54], ['DEER', 66]], w: 1.2, h: 0.95, tw: 384, th: 280 },
  joke6: { text: [['CAUTION', 62], ['DEER ARE', 50], ['UNIONIZED', 50]], w: 1.3, h: 0.95, tw: 384, th: 280, bg: '#f6c500' },
};

const TERRAIN_COLS = [0, 0.8, 1.8, 3.2, 5.5, 9, 14, 21, 31, 45, 64, 88, 118];
const BARRIER = [[-0.32, -0.3], [-0.3, 0.08], [-0.12, 0.82], [0.12, 0.82], [0.3, 0.08], [0.32, -0.3]];
const RAIL = [[-0.06, 0.42], [-0.08, 0.6], [-0.06, 0.78], [0.0, 0.8], [0.0, 0.4], [-0.06, 0.42]];

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FS = /* glsl */ `
uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 ground;
uniform vec3 sunColor; uniform vec3 sunDir; uniform float sunSize; uniform float glow;
uniform float stars; uniform float clouds; uniform vec3 cloudColor; uniform float time;
varying vec3 vDir;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0)), c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.2, h));
  col = mix(col, zenith, smoothstep(0.16, 0.8, h));
  if (h < 0.0) col = mix(horizon, ground, smoothstep(0.0, -0.1, h));
  vec3 sd = normalize(sunDir);
  float m = max(dot(d, sd), 0.0);
  col += sunColor * (pow(m, 5.0) * 0.32 + pow(m, 40.0) * 0.55) * glow;
  if (clouds > 0.0 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.1) * 0.9 + vec2(time * 0.006, time * 0.002);
    float n = vnoise(uv) * 0.55 + vnoise(uv * 2.3 + 7.0) * 0.3 + vnoise(uv * 5.2 + 3.0) * 0.15;
    float cm = smoothstep(0.52, 0.78, n) * smoothstep(0.01, 0.14, h) * clouds;
    vec3 cc = cloudColor + sunColor * pow(m, 3.0) * 0.6;
    col = mix(col, cc, cm * 0.85);
  }
  if (stars > 0.0 && h > 0.04) {
    vec3 p = floor(d * 420.0);
    float st = step(0.9978, hash3(p));
    float tw = 0.55 + 0.45 * sin(time * 2.5 + hash3(p + 3.0) * 40.0);
    col += vec3(st * tw * stars * smoothstep(0.06, 0.35, h));
  }
  float disc = smoothstep(sunSize, sunSize + 0.00035, m);
  col = mix(col, sunColor * 1.35 + vec3(0.25), disc);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 50, 500);
    this.chunkLen = 120;
    this.step = 4;
    this.viewAhead = 660;
    this.chunks = new Map();
    this.noise = makeNoise2D(4242);
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.time = 0;
    this.lastSignS = -1e9;
    this.falling = []; // signs and posts currently tipping over
    this.roadTex = {};
    this.signMats = {};
    this.signGeos = {};
    this._initMaterials();
    this._initGeometries();

    this.sky = this._makeSky();
    this.scene.add(this.sky);
    this.mountains = new THREE.Group();
    this.scene.add(this.mountains);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.headlight = new THREE.SpotLight(0xfff0d6, 0, 170, 0.5, 0.6, 1.6);
    this.scene.add(this.headlight, this.headlight.target);
    // Always present (intensity 0 until a crash) so lighting shaders never recompile mid-game.
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 45, 1.4);
    this.scene.add(this.fireLight);
    this.sunDir = new THREE.Vector3(0, 1, 0);
  }

  _initMaterials() {
    this.mats = {
      road: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      foliage: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x5b4633, flatShading: true }),
      bark: new THREE.MeshLambertMaterial({ color: 0xe8e3d8, flatShading: true }),
      rock: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      post: new THREE.MeshLambertMaterial({ color: 0xeeeeea }),
      reflector: new THREE.MeshBasicMaterial({ color: 0xffb52e }),
      metal: new THREE.MeshLambertMaterial({ color: 0xaab0b8, side: THREE.DoubleSide }),
      concrete: new THREE.MeshLambertMaterial({ color: 0xb6b1a6, side: THREE.DoubleSide }),
      signBack: new THREE.MeshLambertMaterial({ color: 0x8b9097 }),
    };
  }

  _initGeometries() {
    const G = {};
    G.pine = merge([
      part(new THREE.ConeGeometry(1.75, 3.6, 7), 0xbdbdbd, mat(0, 2.9, 0)),
      part(new THREE.ConeGeometry(1.35, 3.1, 7), 0xd9d9d9, mat(0, 4.7, 0, 0, 0.4, 0)),
      part(new THREE.ConeGeometry(0.9, 2.7, 7), 0xf2f2f2, mat(0, 6.4, 0, 0, 0.9, 0)),
    ]);
    G.pineTrunk = new THREE.CylinderGeometry(0.14, 0.22, 2.2, 6);
    G.pineTrunk.translate(0, 1.1, 0);
    G.aspen = merge([
      part(new THREE.IcosahedronGeometry(1.35, 0), 0xd4d4d4, mat(0, 5.0, 0)),
      part(new THREE.IcosahedronGeometry(1.1, 0), 0xffffff, mat(0.55, 6.1, 0.25, 0.3, 0.2, 0)),
      part(new THREE.IcosahedronGeometry(0.95, 0), 0xececec, mat(-0.45, 6.5, -0.3, 0.1, 0.7, 0.2)),
    ]);
    G.aspenTrunk = new THREE.CylinderGeometry(0.09, 0.15, 6.0, 6);
    G.aspenTrunk.translate(0, 3.0, 0);
    G.rock = merge([part(new THREE.DodecahedronGeometry(1, 0), 0xffffff, mat(0, 0.3, 0, 0, 0, 0, 1, 0.62, 1))]);
    G.post = new THREE.BoxGeometry(0.09, 1.1, 0.06);
    G.post.translate(0, 0.55, 0);
    G.reflector = new THREE.BoxGeometry(0.075, 0.15, 0.07);
    G.reflector.translate(0, 0.92, 0);
    G.railPost = new THREE.BoxGeometry(0.1, 0.8, 0.1);
    G.railPost.translate(0, 0.4, 0);
    G.signPost = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6);
    G.signPost.translate(0, 1.25, 0);
    this.geos = G;
  }

  _makeSky() {
    const C = () => ({ value: new THREE.Color() });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        zenith: C(), mid: C(), horizon: C(), ground: C(), sunColor: C(), cloudColor: C(),
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunSize: { value: 0.9994 }, glow: { value: 1 }, stars: { value: 0 }, clouds: { value: 0 }, time: { value: 0 },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 20), material);
    m.frustumCulled = false;
    m.renderOrder = -10;
    return m;
  }

  _buildMountains(T) {
    for (const c of [...this.mountains.children]) {
      c.geometry.dispose();
      c.material.dispose();
      this.mountains.remove(c);
    }
    const ring = (radius, minH, maxH, colors, seed, snow) => {
      const N = 180, noise = makeNoise2D(seed);
      const cb = new THREE.Color(colors[0]), ct = new THREE.Color(colors[1]), cs = new THREE.Color(0xf2f5fb);
      const cm = cb.clone().lerp(ct, 0.55);
      const pos = [], col = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        let n = fbm(noise, Math.cos(a) * 2.4 + 10, Math.sin(a) * 2.4 + 10, 4);
        n = Math.max(0, 1 - Math.abs(n * 1.7));
        const h = minH + (maxH - minH) * n;
        const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
        pos.push(x, -90, z, x, h * 0.62, z, x, h, z);
        const top = snow && n > 0.5 ? cs : ct;
        col.push(cb.r, cb.g, cb.b, cm.r, cm.g, cm.b, top.r, top.g, top.b);
        if (i < N) {
          const b = i * 3;
          idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      m.renderOrder = -9;
      return m;
    };
    this.mountains.add(ring(1650, 40, 330, T.mountains.far, 11, T.mountains.snow));
    this.mountains.add(ring(1250, 10, 190, T.mountains.near, 23, false));
  }

  _roadTexture(kind) {
    if (!this.roadTex[kind]) this.roadTex[kind] = makeRoadTexture(ROADS[kind], this.aniso);
    return this.roadTex[kind];
  }

  reset(theme, road) {
    this.theme = theme;
    this.road = road;
    this.roadSpec = ROADS[theme.road];
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    this.falling.length = 0;
    this.lastSignS = -1e9;
    this.seed = road.o.seed;
    const u = this.sky.material.uniforms, S = theme.sky;
    u.zenith.value.set(S.zenith);
    u.mid.value.set(S.mid);
    u.horizon.value.set(S.horizon);
    u.ground.value.set(S.ground);
    u.sunColor.value.set(S.sunColor);
    u.cloudColor.value.set(S.cloudColor);
    u.sunDir.value.set(...S.sunDir).normalize();
    u.sunSize.value = S.sunSize;
    u.glow.value = S.glow;
    u.stars.value = S.stars;
    u.clouds.value = S.clouds;
    this.sunDir.copy(u.sunDir.value);
    this.scene.fog.color.set(theme.fog.color);
    this.scene.fog.near = theme.fog.near;
    this.scene.fog.far = theme.fog.far;
    this.renderer.setClearColor(theme.fog.color);
    this.hemi.color.set(theme.hemi[0]);
    this.hemi.groundColor.set(theme.hemi[1]);
    this.hemi.intensity = theme.hemi[2];
    this.sun.color.set(theme.sun[0]);
    this.sun.intensity = theme.sun[1];
    // keep the light above the horizon even when the visible sun has set
    this.sun.position.set(this.sunDir.x, Math.max(0.12, this.sunDir.y), this.sunDir.z).multiplyScalar(100);
    this.headlight.intensity = theme.headlights;
    this.mats.road.map = this._roadTexture(theme.road);
    this.mats.road.needsUpdate = true;
    for (const m of Object.values(this.signMats)) m.emissiveIntensity = theme.signGlow;
    this._buildMountains(theme);
  }

  // Ground height at road-relative position (s, d): flat road, ditch, then hillsides.
  heightAt(s, d) {
    const base = this.road.height(s);
    const R = this.roadSpec;
    if (d >= R.left && d <= R.right) return base;
    const side = d > R.right ? 1 : -1;
    const x = side > 0 ? d - R.right : R.left - d;
    const T = this.theme.terrain;
    let h = -T.ditch * Math.sin(Math.min(x / T.ditchW, 1) * Math.PI);
    if (x > T.ditchW) {
      const xx = x - T.ditchW;
      const rise = T.riseBase + T.riseVar * this.noise(s * 0.0022 + side * 41.3, 7.7);
      h += xx * rise * smoothstep(0, 10, xx);
      h += T.bumps * fbm(this.noise, s * 0.012, d * 0.025 + side * 13.1, 2) * smoothstep(2, 22, xx);
    }
    return base + h;
  }

  update(sPlayer, camPos, dt, buildAll = false) {
    this.time += dt;
    this.sky.position.copy(camPos);
    this.mountains.position.set(camPos.x, camPos.y - 25, camPos.z);
    this.sky.material.uniforms.time.value = this.time;
    const L = this.chunkLen;
    const c0 = Math.max(0, Math.floor((sPlayer - 70) / L));
    const c1 = Math.floor((sPlayer + this.viewAhead) / L);
    for (const [ci, ch] of this.chunks) {
      if (ci < c0 || ci > c1 + 2) {
        this._disposeChunk(ch);
        this.chunks.delete(ci);
      }
    }
    let budget = buildAll ? 999 : 1;
    for (let ci = c0; ci <= c1 && budget > 0; ci++) {
      if (!this.chunks.has(ci)) {
        this.chunks.set(ci, this._buildChunk(ci));
        budget--;
      }
    }
    if (this.falling.length) this._updateFalling(dt);
  }

  setHeadlight(pos, dir) {
    this.headlight.position.copy(pos);
    this.headlight.target.position.copy(pos).addScaledVector(dir, 30);
    this.headlight.target.position.y -= 1.4;
  }

  // First roadside obstacle overlapping a box centered at (s, d), or null.
  // kinds: optional Set to only look for some kinds. Knocked-over ones don't count.
  hitObstacle(s, d, halfL, halfW, kinds = null) {
    const ci = Math.floor(s / this.chunkLen);
    for (let c = ci - 1; c <= ci + 1; c++) {
      const ch = this.chunks.get(c);
      if (!ch) continue;
      for (const o of ch.obstacles) {
        if (o.down || (kinds && !kinds.has(o.kind))) continue;
        if (Math.abs(o.s - s) < halfL + o.r && Math.abs(o.d - d) < halfW + o.r) return o;
      }
    }
    return null;
  }

  // Knock a sign or marker post over, falling away along (dx, dz), the car's
  // direction of travel. It tips over from its base, bounces once on the
  // ground, and stays down.
  knockDown(o, dx, dz, speed) {
    if (o.down) return;
    o.down = true;
    const sign = o.kind === 'sign';
    const base = sign ? o.holder.position : o.t;
    this.falling.push({
      o, dx, dz,
      a: 0, // tilt from upright (rad)
      w: clamp(speed * (sign ? 0.18 : 0.35), 1.2, sign ? 4 : 8), // tilt rate
      g: sign ? 5.5 : 12, // how hard gravity pulls it over (a tall sign falls slower)
      max: sign ? 1.45 : 1.5, // lying (almost) flat
      slide: speed * (sign ? 0.08 : 0.2), // gets shoved a little way too
      px: base.x, py: base.y, pz: base.z,
      rot: sign ? o.holder.rotation.y : o.t.rot,
      settled: false,
    });
  }

  _updateFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      if (f.o.gone) {
        this.falling.splice(i, 1);
        continue;
      }
      if (!f.settled) {
        f.w += f.g * Math.sin(Math.max(0.08, f.a)) * dt;
        f.a += f.w * dt;
        if (f.a >= f.max) {
          f.a = f.max;
          if (f.w < 1.2) {
            f.settled = true;
            f.w = 0;
          } else f.w = -f.w * 0.3;
        }
      }
      f.slide *= Math.exp(-5 * dt);
      f.px += f.dx * f.slide * dt;
      f.pz += f.dz * f.slide * dt;
      // upright pose (yaw), then tipped about the horizontal axis across the fall direction
      _qa.setFromAxisAngle(_axis.set(f.dz, 0, -f.dx), f.a).multiply(_qb.setFromAxisAngle(_up, f.rot));
      if (f.o.holder) {
        f.o.holder.position.set(f.px, f.py, f.pz);
        f.o.holder.quaternion.copy(_qa);
      } else {
        _mf.compose(_pf.set(f.px, f.py, f.pz), _qa, _one3);
        for (const im of f.o.ims) {
          im.setMatrixAt(f.o.i, _mf);
          im.instanceMatrix.needsUpdate = true;
        }
      }
      if (f.settled && f.slide < 0.05) this.falling.splice(i, 1);
    }
  }

  _disposeChunk(ch) {
    for (const o of ch.obstacles) o.gone = true;
    for (const g of ch.owned) g.dispose();
    for (const im of ch.instanced) im.dispose();
    this.scene.remove(ch.group);
  }

  _buildChunk(ci) {
    const T = this.theme, R = this.roadSpec, road = this.road;
    const L = this.chunkLen, step = this.step, s0 = ci * L, n = Math.round(L / step);
    const group = new THREE.Group();
    const owned = [], instanced = [];
    const obstacles = []; // {s, d, r, kind} for anything the car can crash into
    const reach = 16; // obstacles further than this past the road edge can't be reached
    const tmp = { x: 0, z: 0 };

    // --- asphalt
    {
      const pos = new Float32Array((n + 1) * 6), nor = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4);
      const idx = [];
      const vBase = Math.floor(s0 / 1200) * 1200;
      for (let i = 0; i <= n; i++) {
        const s = s0 + i * step;
        const p = road.sample(s);
        const px = p.x, pz = p.z, c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        const h = road.height(s) + 0.01;
        const sl = road.slope(s);
        const inv = 1 / Math.sqrt(1 + sl * sl);
        for (let k = 0; k < 2; k++) {
          const d = k === 0 ? R.left : R.right;
          const o = i * 2 + k;
          pos[o * 3] = px + d * c;
          pos[o * 3 + 1] = h;
          pos[o * 3 + 2] = pz - d * sn;
          nor[o * 3] = sl * sn * inv;
          nor[o * 3 + 1] = inv;
          nor[o * 3 + 2] = sl * c * inv;
          uv[o * 2] = k;
          uv[o * 2 + 1] = (s - vBase) / R.length;
        }
        if (i < n) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      owned.push(geo);
      group.add(new THREE.Mesh(geo, this.mats.road));
    }

    // --- terrain on both sides
    {
      const cols = TERRAIN_COLS, m = cols.length, rows = n + 1;
      const pos = new Float32Array(rows * m * 2 * 3);
      const nor = new Float32Array(rows * m * 2 * 3);
      const col = new Float32Array(rows * m * 2 * 3);
      const idx = [];
      const TT = T.terrain;
      const cG = new THREE.Color(TT.gravel), cN = new THREE.Color(TT.grassNear), cF = new THREE.Color(TT.grassFar), cW = new THREE.Color(TT.forest);
      const cc = new THREE.Color();
      const H = new Float32Array((rows + 2) * m);
      let vo = 0;
      for (const side of [-1, 1]) {
        for (let i = -1; i <= n + 1; i++) {
          const s = s0 + i * step;
          for (let j = 0; j < m; j++) {
            const d = side > 0 ? R.right + cols[j] : R.left - cols[j];
            H[(i + 1) * m + j] = this.heightAt(s, d);
          }
        }
        const base = vo;
        for (let i = 0; i <= n; i++) {
          const s = s0 + i * step;
          const p = road.sample(s);
          const px = p.x, pz = p.z, c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
          for (let j = 0; j < m; j++) {
            const d = side > 0 ? R.right + cols[j] : R.left - cols[j];
            const o = vo * 3;
            pos[o] = px + d * c;
            pos[o + 1] = H[(i + 1) * m + j];
            pos[o + 2] = pz - d * sn;
            const dhds = (H[(i + 2) * m + j] - H[i * m + j]) / (2 * step);
            const jl = Math.max(0, j - 1), jr = Math.min(m - 1, j + 1);
            const dhdx = (H[(i + 1) * m + jr] - H[(i + 1) * m + jl]) / (cols[jr] - cols[jl]);
            let nx = -dhdx * side * c + dhds * sn;
            let ny = 1;
            let nz = dhdx * side * sn + dhds * c;
            const inv = 1 / Math.hypot(nx, ny, nz);
            nor[o] = nx * inv;
            nor[o + 1] = ny * inv;
            nor[o + 2] = nz * inv;
            const x = cols[j];
            if (x < 0.9) cc.copy(cG);
            else {
              cc.copy(cN).lerp(cF, smoothstep(3, 28, x));
              if (x > 7) cc.lerp(cW, 0.55 * smoothstep(7, 24, x));
            }
            const v = 1 + 0.13 * this.noise(s * 0.045, d * 0.06 + side * 3.1);
            col[o] = cc.r * v;
            col[o + 1] = cc.g * v;
            col[o + 2] = cc.b * v;
            vo++;
          }
        }
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < m - 1; j++) {
            const a = base + i * m + j, b = a + 1, c2 = a + m, e = c2 + 1;
            if (side > 0) idx.push(a, b, c2, b, e, c2);
            else idx.push(a, c2, b, b, c2, e);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      owned.push(geo);
      group.add(new THREE.Mesh(geo, this.mats.terrain));
    }

    // --- trees and rocks
    const rng = mulberry32(ci * 9973 + this.seed * 31 + 7);
    const TR = T.trees;
    const pines = [], aspens = [], rocks = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < TR.perSide; k++) {
        const s = s0 + rng() * L;
        const x = TR.minX + Math.pow(rng(), 1.35) * (TR.maxX - TR.minX);
        const isAspen = rng() < TR.aspen;
        const sc = rand(rng, 0.75, 1.5);
        const rot = rng() * 6.283;
        const pickCol = rng();
        if (x > TR.minX + 2 && this.noise(s * 0.004 + 3.3, side * 5.1 + x * 0.012) < TR.clearing) continue;
        const d = side > 0 ? R.right + x : R.left - x;
        road.toWorld(s, d, tmp);
        const t = { x: tmp.x, y: this.heightAt(s, d) - 0.15, z: tmp.z, sc, sy: rand(rng, 0.9, 1.15), rot, c: pickCol };
        (isAspen ? aspens : pines).push(t);
        if (x < reach) obstacles.push({ s, d, r: (isAspen ? 0.4 : 0.9) * sc, kind: 'tree' });
      }
      // a tree line just past the ditch, so the forest edge is something you can see and hit
      if (TR.line) {
        const [x0, x1, gap] = TR.line;
        for (let s = s0 + rng() * gap; s < s0 + L; s += gap * rand(rng, 0.7, 1.3)) {
          const x = rand(rng, x0, x1);
          const d = side > 0 ? R.right + x : R.left - x;
          road.toWorld(s, d, tmp);
          const sc = rand(rng, 0.85, 1.35);
          const isAspen = rng() < TR.aspen;
          (isAspen ? aspens : pines).push({ x: tmp.x, y: this.heightAt(s, d) - 0.15, z: tmp.z, sc, sy: rand(rng, 0.9, 1.15), rot: rng() * 6.283, c: rng() });
          obstacles.push({ s, d, r: (isAspen ? 0.4 : 0.9) * sc, kind: 'tree' });
        }
      }
      const nRocks = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < nRocks; k++) {
        const s = s0 + rng() * L;
        const x = 3.8 + Math.pow(rng(), 2) * 40;
        const d = side > 0 ? R.right + x : R.left - x;
        road.toWorld(s, d, tmp);
        const sc = rand(rng, 0.35, 1.3);
        rocks.push({ x: tmp.x, y: this.heightAt(s, d) - 0.1, z: tmp.z, sc, sy: 1, rot: rng() * 6.283, c: rng() });
        if (x < reach) obstacles.push({ s, d, r: 0.85 * sc, kind: 'rock' });
      }
    }
    const dummy = new THREE.Object3D();
    const cTmp = new THREE.Color();
    const inst = (geo, material, list, colorFn) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.set(t.sc, t.sc * t.sy, t.sc);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        if (colorFn) im.setColorAt(i, colorFn(t, cTmp));
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      instanced.push(im);
      group.add(im);
      return im;
    };
    const pineCols = TR.pine.map((c) => new THREE.Color(c));
    const aspenCols = TR.aspenCols.map((c) => new THREE.Color(c));
    inst(this.geos.pine, this.mats.foliage, pines, (t, c) => c.copy(pineCols[Math.floor(t.c * pineCols.length)]));
    inst(this.geos.pineTrunk, this.mats.trunk, pines);
    inst(this.geos.aspen, this.mats.foliage, aspens, (t, c) => c.copy(aspenCols[Math.floor(t.c * aspenCols.length)]));
    inst(this.geos.aspenTrunk, this.mats.bark, aspens);
    inst(this.geos.rock, this.mats.rock, rocks, (t, c) => c.setRGB(0.42 + t.c * 0.18, 0.4 + t.c * 0.16, 0.38 + t.c * 0.15));

    // --- roadside delineator posts
    if (T.posts) {
      const posts = [], postObs = [];
      for (let s = Math.ceil(s0 / 40) * 40; s < s0 + L; s += 40) {
        for (const side of [-1, 1]) {
          const d = side > 0 ? R.right + 0.7 : R.left - 0.7;
          const yaw = road.toWorld(s, d, tmp);
          const t = { x: tmp.x, y: this.heightAt(s, d) - 0.05, z: tmp.z, sc: 1, sy: 1, rot: yaw };
          // t and i let a hit knock this post's instance over (see knockDown)
          const o = { s, d, r: 0.12, kind: 'post', t, i: posts.length };
          posts.push(t);
          obstacles.push(o);
          postObs.push(o);
        }
      }
      const ims = [inst(this.geos.post, this.mats.post, posts), inst(this.geos.reflector, this.mats.reflector, posts)];
      for (const o of postObs) o.ims = ims;
    }

    // --- highway barrier and guardrail
    if (T.barrier) {
      const g = this._ribbon(s0, n, step, R.left - 0.45, BARRIER);
      owned.push(g);
      group.add(new THREE.Mesh(g, this.mats.concrete));
    }
    if (T.guardrail) {
      const g = this._ribbon(s0, n, step, R.right + 1.0, RAIL);
      owned.push(g);
      group.add(new THREE.Mesh(g, this.mats.metal));
      const rp = [];
      for (let s = Math.ceil(s0 / 4) * 4; s < s0 + L; s += 4) {
        const d = R.right + 1.06;
        const yaw = road.toWorld(s, d, tmp);
        rp.push({ x: tmp.x, y: this.heightAt(s, d) - 0.05, z: tmp.z, sc: 1, sy: 1, rot: yaw });
      }
      inst(this.geos.railPost, this.mats.metal, rp);
    }

    // --- signs
    for (const sc of [s0 + 25, s0 + 85]) {
      if (sc - this.lastSignS < 150) continue;
      const kAhead = road.curvature(sc + 140), kHere = road.curvature(sc);
      let key = null;
      if (Math.abs(kAhead) > 1 / 450 && Math.abs(kHere) < 1 / 1500) key = kAhead > 0 ? 'curveL' : 'curveR';
      else if (rng() < 0.22) {
        key = weighted(rng, T.signs);
        if (key === 'joke') key = pick(rng, JOKES);
      }
      if (!key) continue;
      this.lastSignS = sc;
      const sd = R.right + (T.guardrail ? 2.1 : 1.6);
      const holder = this._addSign(group, key, sc, sd);
      obstacles.push({ s: sc, d: sd, r: 0.2, kind: 'sign', holder });
    }

    this.scene.add(group);
    return { group, owned, instanced, obstacles };
  }

  _ribbon(s0, n, step, dBase, profile) {
    const road = this.road, P = profile.length;
    const pos = new Float32Array((n + 1) * P * 3);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + i * step;
      const p = road.sample(s);
      const px = p.x, pz = p.z, c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const hb = this.heightAt(s, dBase);
      for (let j = 0; j < P; j++) {
        const d = dBase + profile[j][0];
        const o = (i * P + j) * 3;
        pos[o] = px + d * c;
        pos[o + 1] = hb + profile[j][1];
        pos[o + 2] = pz - d * sn;
      }
      if (i < n) {
        for (let j = 0; j < P - 1; j++) {
          const a = i * P + j, b = a + 1, c2 = a + P, e = c2 + 1;
          idx.push(a, c2, b, b, c2, e);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  _signMaterial(key) {
    if (this.signMats[key]) return this.signMats[key];
    const def = SIGN_DEFS[key];
    const map = def.warn
      ? makeWarningSign(def.warn, this.aniso)
      : makeTextSign(def.text, { w: def.tw || 256, h: def.th || 320, bg: def.bg }, this.aniso);
    const m = new THREE.MeshLambertMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: this.theme ? this.theme.signGlow : 0.3,
      alphaTest: 0.5,
      transparent: false,
    });
    this.signMats[key] = m;
    return m;
  }

  _signGeo(w, h) {
    const k = `${w}x${h}`;
    if (!this.signGeos[k]) this.signGeos[k] = new THREE.PlaneGeometry(w, h);
    return this.signGeos[k];
  }

  _addSign(group, key, s, d) {
    const def = SIGN_DEFS[key];
    const tmp = { x: 0, z: 0 };
    const yaw = this.road.toWorld(s, d, tmp);
    const holder = new THREE.Group();
    holder.position.set(tmp.x, this.heightAt(s, d) - 0.1, tmp.z);
    holder.rotation.y = yaw - 0.12; // angle slightly toward the road
    holder.add(new THREE.Mesh(this.geos.signPost, this.mats.metal));
    const panelW = def.warn ? def.w * 1.414 : def.w, panelH = def.warn ? def.h * 1.414 : def.h;
    const panel = new THREE.Mesh(this._signGeo(panelW, panelH), this._signMaterial(key));
    const top = 2.5;
    panel.position.set(0, top - panelH / 2 + (def.warn ? 0.35 : 0), 0.05);
    holder.add(panel);
    const back = new THREE.Mesh(this._signGeo(panelW, panelH), this.mats.signBack);
    back.rotation.y = Math.PI;
    back.position.copy(panel.position);
    back.position.z = 0.04;
    if (!def.warn) holder.add(back);
    if (def.plaque) {
      const pk = 'plaque';
      if (!SIGN_DEFS[pk]) SIGN_DEFS[pk] = { text: [['NEXT 3 MILES', 60]], w: 0.95, h: 0.32, tw: 384, th: 128, bg: '#f6c500' };
      const plaque = new THREE.Mesh(this._signGeo(0.95, 0.32), this._signMaterial(pk));
      plaque.position.set(0, panel.position.y - panelH * 0.485 - 0.21, 0.05);
      holder.add(plaque);
    }
    group.add(holder);
    return holder;
  }
}
