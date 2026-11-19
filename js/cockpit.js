// Driver's-eye interior of a white Honda crossover, loosely modeled on the
// 2016-18 HR-V: three chrome-ringed dials under a hooded binnacle, a center
// stack angled toward the driver (touchscreen, vents, hazard button, climate
// panel), layered dash trim, and a three-spoke wheel with switchgear.
// Rendered as a separate pass on top of the world so it never clips.
// Coordinates are relative to the driver's eye: x right, y up, -z forward.
// The car centerline is at x = CAR_X.
import * as THREE from '../vendor/three.module.min.js';
import { makeCanvas, canvasTexture, COMIC_FONT } from './textures.js';
import { clamp, damp, lerp, smoothstep, DEG } from './util.js';

export const CAR_X = 0.37;
const UP = new THREE.Vector3(0, 1, 0);
const FONT = 'Arial, Helvetica, sans-serif';
const gaugeRot = (f) => (-(135 + 270 * clamp(f, 0, 1)) - 90) * DEG;

// Dial centers and face radii on the cluster plane (meters): tach, speedo, fuel.
const DIALS = [
  [-0.112, -0.003, 0.0465],
  [0, 0.001, 0.0525],
  [0.112, -0.003, 0.0465],
];
const CLUSTER_W = 0.335;
const CLUSTER_H = 0.112;

// ------------------------------------------------------------ geometry helpers
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _t = new THREE.Vector3();
const xf = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order = 'XYZ') =>
  new THREE.Matrix4().compose(_t.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _one);

function needleGeo(len, w) {
  const s = new THREE.Shape();
  s.moveTo(-w, -len * 0.18);
  s.lineTo(w, -len * 0.18);
  s.lineTo(w * 0.3, len);
  s.lineTo(-w * 0.3, len);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function beamGeo(a, b, r, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), q, _one));
}

function roundRect(w, h, r, path = new THREE.Shape()) {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// Map a flat shape's UVs onto its w x h bounding box (optionally mirrored).
function fitUV(geo, w, h, flipU = false) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w + 0.5;
    uv.setXY(i, flipU ? 1 - u : u, p.getY(i) / h + 0.5);
  }
  return geo;
}

// Extrude a side profile, given as [z, y] points, across the car from x0 to x1.
function extrudeX(pts, x0, x1) {
  const s = new THREE.Shape();
  s.moveTo(-pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(-pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}
const bez2 = (a, b, c, n) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [0, 1].map((k) => u * u * a[k] + 2 * u * t * b[k] + t * t * c[k]);
  });
const bez3 = (a, b, c, d, n) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]);
  });

// Dashboard side profiles, [z, y]. The main one rises from the windshield to a
// rounded lip near the driver, then drops down a tall, upright face (room for
// the HR-V's tall vents and audio unit). Its top stays below the far edge's
// sight line, so it never hides more of the hood. In front of the driver the
// top drops into a pocket so the gauges show over it (under the binnacle hood).
const DASH_HI = [
  [-1.02, -0.305],
  ...bez3([-1.02, -0.305], [-0.92, -0.28], [-0.78, -0.252], [-0.68, -0.246], 10),
  ...bez2([-0.68, -0.246], [-0.6, -0.244], [-0.588, -0.282], 6),
  [-0.575, -0.36], [-0.567, -0.45], [-0.56, -0.62], [-0.75, -0.78], [-1.02, -0.78],
];
const DASH_POCKET = [
  [-1.02, -0.305], [-0.9, -0.29], [-0.835, -0.292], [-0.815, -0.312], [-0.805, -0.354], [-0.72, -0.354],
  ...bez2([-0.72, -0.354], [-0.64, -0.354], [-0.612, -0.39], 5),
  [-0.6, -0.45], [-0.58, -0.62], [-0.75, -0.78], [-1.02, -0.78],
];

// Static parts are collected per material and merged into one mesh each, with
// a little ambient occlusion baked into vertex colors (darker toward the floor).
class Baker {
  constructor() {
    this.parts = new Map();
  }
  // Matrices apply in order: the part's own placement first, then its parents.
  add(geo, mat, ...frames) {
    for (const m of frames) geo.applyMatrix4(m);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(geo);
    return geo;
  }
  build(parent, shade) {
    for (const [mat, list] of this.parts) parent.add(new THREE.Mesh(mergeGeos(list, shade), mat));
    this.parts.clear();
  }
}

function mergeGeos(list, shade) {
  const items = list.map((g) => ({ g: g.index ? g.toNonIndexed() : g, flat: !!g.userData.flat }));
  let n = 0;
  for (const it of items) n += it.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  let o = 0;
  for (const { g, flat } of items) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++, o++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z;
      if (N) {
        nor[o * 3] = N.getX(i);
        nor[o * 3 + 1] = N.getY(i);
        nor[o * 3 + 2] = N.getZ(i);
      }
      if (U) {
        uv[o * 2] = U.getX(i);
        uv[o * 2 + 1] = U.getY(i);
      }
      const c = shade && !flat ? shade(x, y, z) : 1;
      col[o * 3] = col[o * 3 + 1] = col[o * 3 + 2] = c;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class Cockpit {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 2, 0.03, 12);
    this.camera.rotation.order = 'YXZ';
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x18161c, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.amb = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.amb);
    this.sunWorld = new THREE.Vector3(0, 1, 0);
    this.mirrorRT = new THREE.WebGLRenderTarget(512, 128);
    // far plane must reach the sky dome (r=1900) and mountain rings, like the main camera
    this.mirrorCam = new THREE.PerspectiveCamera(17, 4, 0.5, 2600);
    this.mirrorCam.rotation.order = 'YXZ';
    this.ecoT = 0;
    this.lastMph = -1;
    this.hoodDeer = null;
    this._build();
  }

  _build() {
    const R = this.root;
    const lam = (color, extra) => new THREE.MeshLambertMaterial({ color, vertexColors: true, ...extra });
    const pho = (color, specular, shininess) => new THREE.MeshPhongMaterial({ color, specular, shininess, vertexColors: true });
    const basic = (color) => new THREE.MeshBasicMaterial({ color, vertexColors: true });
    const M = (this.M = {
      dash: lam(0x2b2c32),
      visor: lam(0x232428),
      soft: lam(0x37383f),
      pod: lam(0x0d0d0f),
      podIn: lam(0x16171a, { side: THREE.BackSide }),
      surround: lam(0x1b1c20), // recessed frames around the vents
      knob: pho(0x1c1c1f, 0x777777, 60),
      slat: lam(0x4b4d54),
      rubber: lam(0x151517),
      gunmetal: pho(0x60666e, 0x9a9a9a, 45),
      chrome: pho(0xc4cad2, 0xffffff, 90),
      piano: pho(0x0a0a0c, 0x8a8a8a, 100),
      leather: pho(0x1b1b1e, 0x303030, 22),
      pillar: lam(0x3d3e44),
      headliner: lam(0xb2aea6), // its glow is set per theme (setTheme)
      frit: new THREE.MeshBasicMaterial({ map: this._fritTexture(), transparent: true, vertexColors: true }),
      paint: pho(0xf5f5f2, 0xbbbbbb, 90),
      black: basic(0x050506),
      sideGlass: basic(0x7d8da3),
    });
    const B = new Baker();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const flat = (g) => ((g.userData.flat = true), g);
    const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);
    // a textured plane; glow = unlit (backlit displays)
    const decal = (parent, w, h, tex, m, opts = {}) => {
      const mat = opts.glow
        ? new THREE.MeshBasicMaterial({ map: tex, transparent: !!opts.transparent })
        : new THREE.MeshLambertMaterial({ map: tex, alphaTest: opts.alphaTest || 0, transparent: !!opts.transparent });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.decompose(mesh.position, mesh.quaternion, mesh.scale);
      parent.add(mesh);
      return mesh;
    };
    const frameOf = (parent, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, rz, order);
      g.updateMatrix();
      parent.add(g);
      return g;
    };

    // --- dashboard body: driver wing (out to the door), gauge pocket, center + passenger side
    B.add(extrudeX(DASH_HI, -0.47, -0.27), M.dash);
    B.add(extrudeX(DASH_POCKET, -0.27, 0.205), M.dash);
    B.add(extrudeX(DASH_HI, 0.205, 1.55), M.dash);

    // --- driver's door: trim panel, padded window ledge, trim line continuing the dash's
    B.add(new THREE.BoxGeometry(0.05, 0.5, 1.15), M.dash, xf(-0.495, -0.545, -0.25));
    B.add(new THREE.BoxGeometry(0.08, 0.026, 1.17), M.soft, xf(-0.49, -0.297, -0.255));
    B.add(new THREE.BoxGeometry(0.006, 0.008, 0.75), M.gunmetal, xf(-0.4675, -0.37, -0.43));

    // --- binnacle hood over the gauges, closed at the back. On the left it
    // sweeps down past the tachometer into a cheek that meets the outboard vent.
    const VC = -0.292, A0 = 0.09, A1 = Math.PI + 0.42, N = 34;
    const arc = (rx, ry, i, a1 = A1) => {
      const a = A0 + ((a1 - A0) * i) / N;
      return [rx * Math.cos(a), VC + ry * Math.sin(a)];
    };
    const vis = new THREE.Shape();
    for (let i = 0; i <= N; i++) {
      const [px, py] = arc(0.27, 0.152, i);
      if (i) vis.lineTo(px, py);
      else vis.moveTo(px, py);
    }
    for (let i = N; i >= 0; i--) vis.lineTo(...arc(0.25, 0.132, i));
    const visGeo = new THREE.ExtrudeGeometry(vis, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2 });
    B.add(visGeo, M.visor, xf(0, 0, -0.85));
    const back = new THREE.Shape();
    back.moveTo(-0.256, -0.335);
    back.lineTo(0.256, -0.335);
    for (let i = 0; i <= N; i++) back.lineTo(...arc(0.256, 0.138, i, Math.PI - A0));
    B.add(new THREE.ShapeGeometry(back), M.pod, xf(0, 0, -0.835));

    // round side-window demister grille on the dash top, by the A-pillar
    decal(R, 0.1, 0.1, this._demisterTexture(), xf(-0.33, -0.2715, -0.886, -Math.PI / 2 + 0.2), { alphaTest: 0.4 });

    // --- gauge cluster: tach, speedo, fuel in chrome-ringed tubes
    const cl = frameOf(R, 0, -0.288, -0.768, -0.33);
    this.clusterTex = this._clusterTexture();
    cl.add(new THREE.Mesh(new THREE.PlaneGeometry(CLUSTER_W, CLUSTER_H), new THREE.MeshBasicMaterial({ map: this.clusterTex, transparent: true })));
    for (const [x, y, r] of DIALS) {
      const tube = new THREE.CylinderGeometry(r + 0.001, r + 0.001, 0.009, 48, 1, true).rotateX(Math.PI / 2);
      B.add(tube, M.podIn, xf(x, y, 0.0045), cl.matrix);
      B.add(new THREE.TorusGeometry(r + 0.0035, 0.0026, 6, 56), M.chrome, xf(x, y, 0.009), cl.matrix);
    }
    const needleMat = new THREE.MeshBasicMaterial({ color: 0xff5424 });
    const capMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1e });
    const mkNeedle = ([x, y], len) => {
      const n = new THREE.Mesh(needleGeo(len, 0.0028), needleMat);
      n.position.set(x, y, 0.0015);
      cl.add(n);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 16), capMat);
      cap.position.set(x, y, 0.0022);
      cl.add(cap);
      return n;
    };
    this.nTach = mkNeedle(DIALS[0], 0.037);
    this.nSpeed = mkNeedle(DIALS[1], 0.044);
    this.nFuel = mkNeedle(DIALS[2], 0.034);
    // ECO Assist ring around the speedometer: green when easy on the gas
    this.ecoMat = new THREE.MeshBasicMaterial({ color: 0x40ff90 });
    const eco = new THREE.Mesh(new THREE.RingGeometry(0.0492, 0.0517, 64), this.ecoMat);
    eco.position.set(DIALS[1][0], DIALS[1][1], 0.0009);
    cl.add(eco);
    const [dc, dg] = makeCanvas(128, 64);
    this.digiCanvas = dc;
    this.digiCtx = dg;
    this.digiTex = canvasTexture(dc);
    const digi = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.017), new THREE.MeshBasicMaterial({ map: this.digiTex, transparent: true }));
    digi.position.set(0, -0.025, 0.0018);
    cl.add(digi);
    const [wc, wg] = makeCanvas(256, 80);
    wg.fillStyle = '#ff9a1a';
    wg.font = `64px ${COMIC_FONT}`;
    wg.textAlign = 'center';
    wg.textBaseline = 'middle';
    wg.fillText('DEER!', 128, 44);
    this.warnMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.0156), new THREE.MeshBasicMaterial({ map: canvasTexture(wc), transparent: true }));
    this.warnMesh.position.set(0, 0.021, 0.0024);
    this.warnMesh.visible = false;
    cl.add(this.warnMesh);

    // --- steering wheel: leather rim, oval airbag pad, switchgear on the spokes
    const wb = frameOf(R, 0, -0.315, -0.52, -0.5);
    this.wheelBase = wb;
    const spin = new THREE.Group();
    wb.add(spin);
    this.wheelSpin = spin;
    const W = new Baker();
    W.add(new THREE.TorusGeometry(0.185, 0.019, 12, 56), M.leather);
    const oval = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 32).rotateX(Math.PI / 2).scale(1.14, 0.94, 1);
    W.add(oval(0.07, 0.075, 0.045), M.rubber, xf(0, -0.012, -0.014));
    W.add(oval(0.064, 0.069, 0.014), M.leather, xf(0, -0.012, 0.0145));
    // side spokes with round, chrome-ringed button pods (audio left, cruise right)
    for (const sx of [-1, 1]) {
      W.add(new THREE.BoxGeometry(0.105, 0.046, 0.024), M.leather, xf(sx * 0.128, -0.018, -0.002));
      W.add(new THREE.BoxGeometry(0.096, 0.0055, 0.027), M.chrome, xf(sx * 0.131, 0.0055, -0.002));
      W.add(new THREE.TorusGeometry(0.0205, 0.0022, 6, 36), M.chrome, xf(sx * 0.112, -0.019, 0.0105));
    }
    // lower spoke: a piano-black V outlined in chrome
    for (const sx of [-1, 1]) {
      W.add(new THREE.BoxGeometry(0.026, 0.121, 0.018), M.piano, xf(sx * 0.032, -0.115, -0.003, 0, 0, -sx * 0.337));
      W.add(new THREE.BoxGeometry(0.004, 0.121, 0.02), M.chrome, xf(sx * 0.0462, -0.12, -0.003, 0, 0, -sx * 0.337));
    }
    W.build(spin, null);
    decal(spin, 0.039, 0.039, this._podTexture('audio'), xf(-0.112, -0.019, 0.0108), { alphaTest: 0.3 });
    decal(spin, 0.039, 0.039, this._podTexture('cruise'), xf(0.112, -0.019, 0.0108), { alphaTest: 0.3 });
    decal(spin, 0.05, 0.04, this._emblemTexture(), xf(0, -0.006, 0.022), { alphaTest: 0.4 });

    // steering column; the light and wiper stalks show through the wheel, under the outer dials
    B.add(beamGeo(V(0, -0.37, -0.56), V(0, -0.47, -0.78), 0.05, 12), M.rubber);
    for (const sx of [-1, 1]) {
      B.add(beamGeo(V(sx * 0.03, -0.333, -0.612), V(sx * 0.12, -0.318, -0.614), 0.0058, 8), M.rubber);
      B.add(beamGeo(V(sx * 0.112, -0.3193, -0.6138), V(sx * 0.128, -0.3167, -0.6142), 0.0088, 10), M.gunmetal); // switch collar
      B.add(beamGeo(V(sx * 0.127, -0.3168, -0.6142), V(sx * 0.15, -0.313, -0.6146), 0.0082, 10), M.rubber);
    }

    // --- driver side, as in the HR-V: a tall outboard vent in a dark surround
    // right beside the wheel, a trim slot under it, then the ECON/VSA/TPMS buttons
    const ov = xf(-0.322, -0.336, -0.574, -0.16, 0.22, 0, 'YXZ');
    this._vent(B, 0.08, 0.104, ov, [0.11, 0.13]);
    B.add(new THREE.BoxGeometry(0.085, 0.006, 0.01), M.gunmetal, mul(ov, xf(0, -0.076, 0)));
    const ec = xf(-0.318, -0.447, -0.564, -0.12, 0.22, 0, 'YXZ');
    B.add(new THREE.BoxGeometry(0.056, 0.052, 0.01), M.piano, ec);
    decal(R, 0.052, 0.048, this._econTexture(), mul(ec, xf(0, 0, 0.0052)));

    // --- center: tall vents either side of the audio unit, hazard button under the left one
    this._vent(B, 0.064, 0.1, xf(0.25, -0.33, -0.574, -0.16, -0.12, 0, 'YXZ'), [0.084, 0.124]);
    this._vent(B, 0.064, 0.1, xf(0.626, -0.33, -0.576, -0.16, -0.05, 0, 'YXZ'), [0.084, 0.124]);
    const hz = xf(0.25, -0.41, -0.571, -0.16, -0.12, 0, 'YXZ');
    B.add(new THREE.BoxGeometry(0.034, 0.017, 0.008), M.piano, hz);
    decal(R, 0.03, 0.015, this._hazardTexture(), mul(hz, xf(0, 0, 0.0042)));

    // audio unit: screen framed by buttons, volume and select knobs, presets below
    const au = frameOf(R, 0.437, -0.336, -0.556, -0.18, -0.08, 0, 'YXZ');
    B.add(
      new THREE.ExtrudeGeometry(roundRect(0.27, 0.16, 0.02), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 }),
      M.dash, xf(0, 0, -0.055), au.matrix,
    );
    B.add(new THREE.ShapeGeometry(roundRect(0.262, 0.152, 0.016), 6), M.piano, xf(0, 0, 0.0012), au.matrix);
    decal(au, 0.262, 0.152, this._faceplateTexture(), xf(0, 0, 0.0018), { alphaTest: 0.3 });
    const [sc, sg] = makeCanvas(512, 288);
    this.screenCanvas = sc;
    this.screenCtx = sg;
    this.screenTex = canvasTexture(sc);
    decal(au, 0.16, 0.09, this.screenTex, xf(0.004, 0.014, 0.0026), { glow: true });
    const knobTex = this._knobTexture();
    const knob = (frame, x, y, r) => {
      B.add(new THREE.TorusGeometry(r + 0.003, 0.0018, 6, 36), M.chrome, xf(x, y, 0.003), frame.matrix);
      B.add(new THREE.CylinderGeometry(r, r + 0.001, 0.012, 32).rotateX(Math.PI / 2), M.knob, xf(x, y, 0.0072), frame.matrix);
      decal(frame, r * 2, r * 2, knobTex, xf(x, y, 0.0134), { alphaTest: 0.3 });
    };
    knob(au, -0.106, -0.045, 0.0108);
    knob(au, 0.108, -0.045, 0.0108);

    // climate controls below: temperature, fan speed and mode knobs, A/C button
    const cp = frameOf(R, 0.437, -0.485, -0.54, -0.1, -0.08, 0, 'YXZ');
    B.add(
      new THREE.ExtrudeGeometry(roundRect(0.3, 0.095, 0.03), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 }),
      M.dash, xf(0, 0, -0.055), cp.matrix,
    );
    B.add(new THREE.ShapeGeometry(roundRect(0.29, 0.085, 0.026), 6), M.piano, xf(0, 0, 0.0012), cp.matrix);
    decal(cp, 0.286, 0.082, this._climatePanelTexture(), xf(0, 0, 0.0018), { transparent: true });
    knob(cp, -0.092, 0.008, 0.019);
    knob(cp, 0, 0.008, 0.015);
    knob(cp, 0.092, 0.008, 0.019);

    // --- passenger side: stitched soft panel, trim strip, tall vent, glovebox
    B.add(new THREE.BoxGeometry(0.555, 0.056, 0.016), M.soft, xf(0.9575, -0.315, -0.575));
    decal(R, 0.555, 0.004, this._stitchTexture(), xf(0.9575, -0.29, -0.5665), { alphaTest: 0.3 });
    B.add(new THREE.BoxGeometry(0.555, 0.01, 0.012), M.gunmetal, xf(0.9575, -0.352, -0.573));
    this._vent(B, 0.08, 0.104, xf(1.3, -0.334, -0.575, -0.16, -0.25, 0, 'YXZ'), [0.11, 0.13]);
    B.add(new THREE.BoxGeometry(0.46, 0.12, 0.008), M.soft, xf(1.0, -0.51, -0.562));
    B.add(new THREE.BoxGeometry(0.07, 0.012, 0.008), M.chrome, xf(1.0, -0.457, -0.557));

    // --- pillars, headliner with sun visors, windshield frit band
    B.add(beamGeo(V(-0.44, -0.31, -1.0), V(-0.68, 0.21, -0.45), 0.05), M.pillar);
    B.add(beamGeo(V(CAR_X + 0.81, -0.31, -1.0), V(CAR_X + 1.05, 0.21, -0.45), 0.05), M.pillar);
    B.add(new THREE.BoxGeometry(2.05, 0.03, 1.0), M.headliner, xf(0.49, 0.215, 0.04));
    for (const x of [-0.165, 0.905]) {
      const visor = new THREE.ExtrudeGeometry(roundRect(0.57, 0.18, 0.035), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
      B.add(visor, M.headliner, xf(x, 0.2, -0.36, Math.PI / 2));
    }
    B.add(flat(new THREE.PlaneGeometry(2.2, 0.06)), M.frit, xf(CAR_X, 0.197, -0.47, 0.845));

    // --- rear-view mirror (shows a live render of the road behind)
    const mg = frameOf(R, CAR_X, 0.11, -0.6, 0.08, -0.45, 0, 'YXZ');
    B.add(beamGeo(V(CAR_X, 0.2, -0.56), V(CAR_X, 0.125, -0.6), 0.008), M.rubber);
    B.add(new THREE.BoxGeometry(0.05, 0.022, 0.03), M.rubber, xf(CAR_X, 0.205, -0.555));
    B.add(
      new THREE.ExtrudeGeometry(roundRect(0.24, 0.072, 0.03), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 }),
      M.rubber, xf(0, 0, -0.012), mg.matrix,
    );
    const glass = new THREE.Mesh(
      fitUV(new THREE.ShapeGeometry(roundRect(0.226, 0.058, 0.024), 6), 0.226, 0.058, true),
      new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture }),
    );
    glass.position.z = 0.0145;
    mg.add(glass);

    // --- left side mirror, mounted where it is on the real car: on the door's
    // front corner. Inside, that corner is a black triangular "sail" panel
    // between the A-pillar base and the window ledge; the mirror's arm runs
    // from behind it out to a rounded white housing whose glass faces the driver.
    const sail = new THREE.Shape();
    sail.moveTo(1.0, -0.312); // shape x = -z: A-pillar base
    sail.lineTo(0.76, -0.3); // back along the window ledge
    sail.lineTo(0.85, -0.17); // up the A-pillar
    sail.closePath();
    const sailGeo = new THREE.ExtrudeGeometry(sail, { depth: 0.045, bevelEnabled: false });
    sailGeo.rotateY(Math.PI / 2);
    B.add(sailGeo, M.rubber, xf(-0.525, 0, 0));
    const sm = frameOf(R, -0.74, -0.23, -0.8, 0, 0.75, 0);
    const hGeo = new THREE.ExtrudeGeometry(roundRect(0.2, 0.115, 0.04), {
      depth: 0.06, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 3, curveSegments: 8,
    });
    B.add(flat(hGeo), M.paint, xf(0, 0, -0.06), sm.matrix); // driver-facing face ends at z = +0.018
    B.add(flat(fitUV(new THREE.ShapeGeometry(roundRect(0.178, 0.094, 0.03), 8), 0.178, 0.094)), M.sideGlass, xf(0, 0, 0.0195), sm.matrix);
    const armStart = new THREE.Vector3(0.09, -0.02, -0.035).applyMatrix4(sm.matrix);
    B.add(flat(beamGeo(armStart, V(-0.515, -0.272, -0.905), 0.017, 10)), M.rubber);

    // --- white hood
    B.add(flat(this._hoodGeo()), M.paint);

    B.build(R, (x, y) => 0.36 + 0.64 * smoothstep(-0.62, -0.27, y));
  }

  // Rounded air vent set in a darker raised surround (sw x sh, with a hole for
  // the vent): chrome bezel, dark throat, angled louvers, adjuster tab.
  _vent(B, w, h, frame, [sw, sh]) {
    const M = this.M;
    const r = Math.min(w, h) * 0.32;
    const sur = roundRect(sw, sh, Math.min(sw, sh) * 0.3);
    sur.holes.push(roundRect(w - 0.004, h - 0.004, r * 0.9, new THREE.Path()));
    B.add(
      new THREE.ExtrudeGeometry(sur, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 }),
      M.surround, xf(0, 0, -0.018), frame,
    );
    const rim = roundRect(w, h, r);
    rim.holes.push(roundRect(w - 0.009, h - 0.009, r * 0.75, new THREE.Path()));
    B.add(new THREE.ExtrudeGeometry(rim, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 5 }), M.chrome, xf(0, 0, 0.001), frame);
    B.add(new THREE.ShapeGeometry(roundRect(w - 0.008, h - 0.008, r * 0.75), 5), M.black, xf(0, 0, -0.012), frame);
    const n = Math.max(3, Math.round(h / 0.017));
    for (let i = 0; i < n; i++) {
      const y = -h / 2 + 0.006 + ((h - 0.012) * (i + 0.5)) / n;
      B.add(new THREE.BoxGeometry(w - 0.012, 0.0035, 0.011), M.slat, xf(0, y, -0.004, -0.4), frame);
    }
    B.add(new THREE.BoxGeometry(0.008, 0.012, 0.012), M.chrome, xf(0, 0, 0.001), frame);
  }

  _hoodGeo() {
    const nx = 14, nz = 8, pos = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      const t = j / nz;
      const z = -1.0 - 1.55 * t;
      for (let i = 0; i <= nx; i++) {
        const u = (i / nx) * 2 - 1;
        const x = CAR_X + u * 1.25; // wide enough to fill the windshield pillar to pillar
        let y = -0.37 - 0.11 * t;
        y += 0.035 * (1 - u * u);
        y += 0.016 * Math.exp(-Math.pow((Math.abs(u) - 0.7) / 0.07, 2));
        y -= 0.07 * Math.pow(Math.max(0, Math.abs(u) - 0.86) / 0.14, 2);
        y -= 0.06 * Math.pow(t, 4);
        pos.push(x, y, z);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _clusterTexture() {
    const W = 1024, H = Math.round((W * CLUSTER_H) / CLUSTER_W), S = W / CLUSTER_W;
    const [c, g] = makeCanvas(W, H);
    const X = (x) => W / 2 + x * S, Y = (y) => H / 2 - y * S;
    g.fillStyle = '#060607';
    rr(g, 4, 4, W - 8, H - 8, 70);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const text = (txt, x, y, px, color) => {
      g.fillStyle = color;
      g.font = `bold ${Math.round(px)}px ${FONT}`;
      g.fillText(txt, x, y);
    };
    const dial = ([x, y, rm], o) => {
      const cx = X(x), cy = Y(y), r = rm * S;
      const grd = g.createRadialGradient(cx, cy - r * 0.25, r * 0.05, cx, cy, r);
      grd.addColorStop(0, '#202127');
      grd.addColorStop(0.7, '#121317');
      grd.addColorStop(1, '#08080a');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      const ro = r * 0.9;
      if (o.red != null) {
        g.strokeStyle = 'rgba(255,59,48,0.9)';
        g.lineWidth = r * 0.06;
        g.beginPath();
        g.arc(cx, cy, ro - r * 0.03, (135 + (270 * o.red) / o.max) * DEG, 405 * DEG);
        g.stroke();
      }
      const steps = Math.round(o.max / o.minor);
      for (let k = 0; k <= steps; k++) {
        const v = k * o.minor;
        const a = (135 + (270 * v) / o.max) * DEG;
        const major = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6;
        const hot = o.red != null && v >= o.red;
        const ri = ro - r * (major ? 0.16 : 0.08);
        g.strokeStyle = hot ? '#ff4136' : '#f2f4f7';
        g.lineWidth = r * (major ? 0.035 : 0.017);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
        g.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro);
        g.stroke();
        const txt = major && o.label ? o.label(v) : '';
        if (txt) {
          const rl = ro - r * 0.31;
          text(txt, cx + Math.cos(a) * rl, cy + Math.sin(a) * rl, r * o.fs, hot ? '#ff5a4f' : '#f2f4f7');
        }
      }
      return [cx, cy, r];
    };
    // tachometer with the gear indicator
    const [tx, ty, tr] = dial(DIALS[0], { max: 8, major: 1, minor: 0.5, red: 6.5, label: String, fs: 0.17 });
    text('x1000r/min', tx, ty + tr * 0.34, tr * 0.095, '#9aa0a8');
    text('D', tx, ty + tr * 0.64, tr * 0.2, '#7dff9a');
    // speedometer (the digital readout sits under the hub)
    const [sx, sy, sr] = dial(DIALS[1], { max: 140, major: 20, minor: 10, label: String, fs: 0.135 });
    text('MPH', sx, sy + sr * 0.74, sr * 0.085, '#9aa0a8');
    // fuel gauge with a pump icon, plus a segmented temperature bar
    const [fx, fy, fr] = dial(DIALS[2], { max: 1, major: 0.5, minor: 0.125, label: (v) => (v === 0 ? 'E' : v === 1 ? 'F' : ''), fs: 0.19 });
    const p = fr * 0.15, px = fx - p * 0.3, py = fy + fr * 0.4;
    g.fillStyle = '#9aa0a8';
    g.fillRect(px - p * 0.5, py - p * 0.7, p, p * 1.4);
    g.fillStyle = '#121317';
    g.fillRect(px - p * 0.3, py - p * 0.5, p * 0.6, p * 0.35);
    g.strokeStyle = '#9aa0a8';
    g.lineWidth = p * 0.18;
    g.beginPath();
    g.moveTo(px + p * 0.5, py - p * 0.4);
    g.lineTo(px + p * 0.9, py - p * 0.1);
    g.lineTo(px + p * 0.9, py + p * 0.5);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i < 3 ? '#e8f6ff' : '#2a2c31';
      g.fillRect(fx - fr * 0.33 + i * fr * 0.115, fy + fr * 0.66, fr * 0.085, fr * 0.075);
    }
    text('C', fx - fr * 0.45, fy + fr * 0.7, fr * 0.11, '#7fb6ff');
    text('H', fx + fr * 0.45, fy + fr * 0.7, fr * 0.11, '#ff6b5e');
    // indicator lamps between the dials: turn arrows (off), ECON (on), cruise (off)
    for (const dir of [-1, 1]) {
      const ax = X(dir * 0.059), ay = Y(0.046), s = 13;
      g.fillStyle = '#17401f';
      g.beginPath();
      g.moveTo(ax + dir * s, ay);
      g.lineTo(ax - dir * s * 0.3, ay - s * 0.8);
      g.lineTo(ax - dir * s * 0.3, ay + s * 0.8);
      g.closePath();
      g.fill();
    }
    text('ECON', X(-0.059), Y(-0.047), 17, '#56f07a');
    text('CRUISE', X(0.059), Y(-0.047), 13, '#2f3a33');
    return canvasTexture(c);
  }

  // Round four-way button pad on a steering-wheel spoke (the chrome ring is 3D).
  _podTexture(kind) {
    const [c, g] = makeCanvas(128, 128);
    const grd = g.createRadialGradient(64, 54, 6, 64, 64, 62);
    grd.addColorStop(0, '#2e2f35');
    grd.addColorStop(1, '#131316');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    for (const a of [45, 135, 225, 315]) {
      const r = a * DEG;
      g.beginPath();
      g.moveTo(64 + Math.cos(r) * 27, 64 + Math.sin(r) * 27);
      g.lineTo(64 + Math.cos(r) * 61, 64 + Math.sin(r) * 61);
      g.stroke();
    }
    g.fillStyle = '#1c1d21';
    g.beginPath();
    g.arc(64, 64, 25, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#eef2f7';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tri = (x, y, dir) => {
      g.beginPath();
      g.moveTo(x + dir * 7, y);
      g.lineTo(x - dir * 5, y - 7);
      g.lineTo(x - dir * 5, y + 7);
      g.closePath();
      g.fill();
    };
    if (kind === 'audio') {
      g.font = `bold 12px ${FONT}`;
      g.fillText('SOURCE', 64, 65);
      g.font = `bold 26px ${FONT}`;
      g.fillText('+', 64, 23);
      g.fillText('–', 64, 104);
      tri(22, 64, -1);
      tri(106, 64, 1);
    } else {
      g.font = `bold 11px ${FONT}`;
      g.fillText('CANCEL', 64, 65);
      g.font = `bold 15px ${FONT}`;
      g.fillText('RES +', 64, 24);
      g.fillText('SET –', 64, 104);
    }
    return canvasTexture(c);
  }

  // Chrome "H" (legs flare out toward the top) in a chrome rounded-square frame.
  _emblemTexture() {
    const [c, g] = makeCanvas(160, 128);
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.48, '#aeb6c0');
    grd.addColorStop(0.52, '#7c8490');
    grd.addColorStop(1, '#e8ecf1');
    g.strokeStyle = grd;
    g.lineWidth = 8;
    rr(g, 6, 6, 148, 116, 30);
    g.stroke();
    g.fillStyle = grd;
    g.beginPath();
    const pts = [[10, 8], [40, 8], [42, 40], [86, 40], [88, 8], [118, 8], [104, 96], [80, 96], [83, 62], [45, 62], [48, 96], [24, 96]];
    pts.forEach(([x, y], i) => {
      const px = 28 + x * 0.81, py = 25 + y * 0.81;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(30,32,36,0.6)';
    g.stroke();
    return canvasTexture(c);
  }

  _hazardTexture() {
    const [c, g] = makeCanvas(96, 48);
    g.fillStyle = '#121215';
    g.fillRect(0, 0, 96, 48);
    g.strokeStyle = '#ff3b2f';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(48, 9);
    g.lineTo(67, 39);
    g.lineTo(29, 39);
    g.closePath();
    g.stroke();
    return canvasTexture(c);
  }

  // Audio unit face (0.262 x 0.152 m): buttons and labels around the screen,
  // which is a separate live texture laid on top; the two knobs are 3D.
  _faceplateTexture() {
    const W = 524, H = 304, S = 2000;
    const [c, g] = makeCanvas(W, H);
    const X = (x) => W / 2 + x * S, Y = (y) => H / 2 - y * S;
    g.fillStyle = '#0b0b0d';
    rr(g, 2, 2, W - 4, H - 4, 26);
    g.fill();
    g.strokeStyle = 'rgba(150,156,166,0.5)';
    g.lineWidth = 3;
    rr(g, 3, 3, W - 6, H - 6, 26);
    g.stroke();
    g.fillStyle = '#000';
    g.fillRect(X(-0.082), Y(0.063), 0.172 * S, 0.098 * S);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const btn = (x, y, w, h, label, px) => {
      g.fillStyle = '#25262b';
      rr(g, X(x) - (w * S) / 2, Y(y) - (h * S) / 2, w * S, h * S, 7);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#e8ecf2';
      g.font = `bold ${px}px ${FONT}`;
      g.fillText(label, X(x), Y(y) + 1);
    };
    btn(-0.106, 0.064, 0.03, 0.012, '•  •', 12);
    btn(0.108, 0.064, 0.03, 0.012, '▲', 11);
    btn(-0.106, 0.042, 0.036, 0.02, 'RADIO', 12);
    btn(-0.106, 0.017, 0.036, 0.02, 'CD/AUX', 11);
    btn(0.108, 0.042, 0.034, 0.02, '☎', 17);
    btn(0.108, 0.017, 0.034, 0.02, '♪', 17);
    btn(-0.106, -0.066, 0.036, 0.012, '◂◂  ▸▸', 11);
    btn(0.108, -0.066, 0.034, 0.012, 'MENU', 11);
    for (let i = 0; i < 6; i++) btn(-0.0685 + i * 0.0274, -0.052, 0.024, 0.016, String(i + 1), 15);
    g.fillStyle = '#9aa3ad';
    g.font = `bold 11px ${FONT}`;
    g.fillText('VOL', X(-0.106), Y(-0.024));
    g.fillText('SELECT', X(0.108), Y(-0.024));
    return canvasTexture(c);
  }

  // Printed around the climate knobs (0.286 x 0.082 m): blue-to-red
  // temperature scale, fan speeds, vent modes, plus the A/C and recirc buttons.
  _climatePanelTexture() {
    const W = 572, H = 164, S = 2000;
    const [c, g] = makeCanvas(W, H);
    const X = (x) => W / 2 + x * S, Y = (y) => H / 2 - y * S;
    const ky = Y(0.008);
    const tx = X(-0.092);
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      g.strokeStyle = `rgb(${Math.round(60 + 195 * t)},${Math.round(120 - 70 * t)},${Math.round(255 - 215 * t)})`;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(tx, ky, 60, (135 + i * 11.25) * DEG, (135 + (i + 1) * 11.25 + 0.5) * DEG);
      g.stroke();
    }
    g.fillStyle = '#e8ecf2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fx = X(0);
    [['OFF', 205], ['1', 238], ['2', 270], ['3', 302], ['4', 335]].forEach(([t, a]) => {
      g.font = `bold ${t === 'OFF' ? 11 : 15}px ${FONT}`;
      g.fillText(t, fx + Math.cos(a * DEG) * 54, ky + Math.sin(a * DEG) * 54);
    });
    const mx = X(0.092);
    g.strokeStyle = '#e8ecf2';
    g.lineWidth = 2.5;
    for (const a of [205, 245, 295, 335]) {
      const px = mx + Math.cos(a * DEG) * 60, py = ky + Math.sin(a * DEG) * 60;
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.stroke();
    }
    for (const [x, label] of [[-0.092, 'A/C'], [0.092, '⟲']]) {
      g.fillStyle = '#25262b';
      rr(g, X(x) - 34, Y(-0.031) - 11, 68, 22, 6);
      g.fill();
      g.fillStyle = '#e8ecf2';
      g.font = `bold 14px ${FONT}`;
      g.fillText(label, X(x), Y(-0.031) + 1);
    }
    g.fillStyle = '#ffb020';
    g.fillRect(X(-0.092) + 20, Y(-0.031) - 3, 7, 6);
    return canvasTexture(c);
  }

  // Top face of a knob: dark, ribbed edge, white pointer.
  _knobTexture() {
    const [c, g] = makeCanvas(64, 64);
    const grd = g.createRadialGradient(28, 26, 2, 32, 32, 31);
    grd.addColorStop(0, '#34353b');
    grd.addColorStop(1, '#101013');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25);
      g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
      g.stroke();
    }
    g.strokeStyle = '#f2f4f7';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(32, 8);
    g.lineTo(32, 22);
    g.stroke();
    return canvasTexture(c);
  }

  // Dark band at the top of the windshield, fading smoothly into the glass.
  // (A real frit fades in a dot pattern, but at screen size the dots read as
  // noise where only the band's edge peeks in at the top of wide screens.)
  _fritTexture() {
    const [c, g] = makeCanvas(4, 128);
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(12,12,14,1)');
    grd.addColorStop(0.45, 'rgba(12,12,14,1)');
    grd.addColorStop(0.7, 'rgba(12,12,14,0.55)');
    grd.addColorStop(1, 'rgba(12,12,14,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 128);
    return canvasTexture(c);
  }

  _stitchTexture() {
    const [c, g] = makeCanvas(64, 8);
    g.fillStyle = '#9a9ca3';
    for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 3, 2, 10, 4);
    const t = canvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(41, 1);
    return t;
  }

  // Driver's switch panel: round ECON button with a green leaf, VSA and TPMS below.
  _econTexture() {
    const [c, g] = makeCanvas(104, 96);
    g.fillStyle = '#0e0e10';
    g.fillRect(0, 0, 104, 96);
    g.fillStyle = '#26272c';
    g.beginPath();
    g.arc(52, 27, 21, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#7b818a';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#4cd964';
    g.beginPath();
    g.ellipse(52, 22, 5, 9, 0.6, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 9px ${FONT}`;
    g.fillText('ECON', 52, 38);
    for (const [x, label] of [[28, 'VSA'], [76, 'TPMS']]) {
      g.fillStyle = '#26272c';
      rr(g, x - 21, 57, 42, 32, 6);
      g.fill();
      g.fillStyle = '#e6eaef';
      g.font = `bold 11px ${FONT}`;
      g.fillText(label, x, 74);
    }
    return canvasTexture(c);
  }

  // Round demister grille: concentric slots in a dark disc.
  _demisterTexture() {
    const [c, g] = makeCanvas(128, 128);
    g.fillStyle = '#1b1c20';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#070708';
    g.lineWidth = 5;
    for (let r = 12; r < 56; r += 9) {
      g.beginPath();
      g.arc(64, 64, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = '#3b3c42';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(64, 64, 59, 0, Math.PI * 2);
    g.stroke();
    return canvasTexture(c);
  }

  setTheme(theme) {
    this.hemi.color.set(theme.hemi[0]);
    this.hemi.intensity = theme.hemi[2] * 0.7;
    this.sun.color.set(theme.sun[0]);
    this.sun.intensity = theme.sun[1] * 0.85;
    this.amb.intensity = theme.headlights ? 0.5 : 0.3;
    const d = theme.sky.sunDir;
    this.sunWorld.set(d[0], Math.max(0.15, d[1]), d[2]).normalize();
    // the headliner faces down, away from the lights: lift it with daylight from the windows
    this.M.headliner.emissive.set(theme.sky.horizon).multiplyScalar(theme.headlights ? 0.08 : 0.22);
    // side mirror "reflection": sky to horizon to road
    if (!this.sideCanvas) {
      [this.sideCanvas, this.sideCtx] = makeCanvas(32, 64);
      this.sideTex = canvasTexture(this.sideCanvas);
      this.M.sideGlass.map = this.sideTex;
      this.M.sideGlass.color.set(0xffffff);
      this.M.sideGlass.needsUpdate = true;
    }
    const hex = (c) => '#' + new THREE.Color(c).getHexString();
    const g = this.sideCtx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, hex(theme.sky.zenith));
    g.addColorStop(0.45, hex(theme.sky.horizon));
    g.addColorStop(0.55, hex(theme.terrain.grassFar));
    g.addColorStop(1, '#2a2a2e');
    this.sideCtx.fillStyle = g;
    this.sideCtx.fillRect(0, 0, 32, 64);
    this.sideTex.needsUpdate = true;
  }

  // Keep the dashboard lighting consistent with where the sun is relative to the car.
  orientSun(carQuatInverse) {
    this.sun.position.copy(this.sunWorld).applyQuaternion(carQuatInverse).multiplyScalar(5);
  }

  drawScreen(fn) {
    fn(this.screenCtx, this.screenCanvas.width, this.screenCanvas.height);
    this.screenTex.needsUpdate = true;
  }

  setHoodDeer(deer) {
    if (this.hoodDeer) this.root.remove(this.hoodDeer.group);
    this.hoodDeer = deer;
    if (deer) {
      deer.group.position.set(CAR_X, -0.43, -2.25);
      deer.group.rotation.set(0, Math.PI, 0);
      this.root.add(deer.group);
    }
  }

  update(dt, st) {
    const ang = clamp(st.steer, -1, 1) * 1.6;
    this.wheelSpin.rotation.z = -ang;
    this.nSpeed.rotation.z = gaugeRot(st.mph / 140);
    this.nTach.rotation.z = gaugeRot(st.rpm / 8000);
    this.nFuel.rotation.z = gaugeRot(st.fuel);
    const hard = st.throttle > 0.5 || st.rpm > 3900;
    this.ecoT = damp(this.ecoT, hard ? 1 : 0, 3, dt);
    this.ecoMat.color.setRGB(lerp(0.15, 0.55, this.ecoT), lerp(1.0, 0.85, this.ecoT), lerp(0.45, 1.0, this.ecoT));
    const mph = Math.round(st.mph);
    if (mph !== this.lastMph) {
      this.lastMph = mph;
      const g = this.digiCtx;
      g.clearRect(0, 0, 128, 64);
      g.fillStyle = '#e8f6ff';
      g.font = `bold 44px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(mph), 64, 34);
      this.digiTex.needsUpdate = true;
    }
    this.warnMesh.visible = !!st.warn && Math.floor(st.time * 7) % 2 === 0;
  }
}
