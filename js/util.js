// Small math + random helpers shared across the game.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const MPH = 2.236936; // m/s -> mph

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach toward a target.
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
export const approach = (cur, target, step) =>
  cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
// table: [[value, weight], ...]
export function weighted(rng, table) {
  let total = 0;
  for (const e of table) total += e[1];
  let r = rng() * total;
  for (const e of table) {
    r -= e[1];
    if (r <= 0) return e[0];
  }
  return table[table.length - 1][0];
}

// Smooth 2D value noise in [-1, 1].
export function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rng() * 2 - 1;
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let u = x - xi, v = y - yi;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const X = xi & 255, Y = yi & 255;
    const a = val[p[X + p[Y]]], b = val[p[X + 1 + p[Y]]];
    const c = val[p[X + p[Y + 1]]], d = val[p[X + 1 + p[Y + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
export function fbm(noise, x, y, octaves = 3) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
