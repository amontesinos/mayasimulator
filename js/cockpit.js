// Driver's-eye interior of a white Honda crossover (stylized). Rendered as a separate
// pass on top of the world so it never clips. Coordinates are relative to the
// driver's eye: x right, y up, -z forward. The car centerline is at x = CAR_X.
import * as THREE from '../vendor/three.module.min.js';
import { makeCanvas, canvasTexture, COMIC_FONT } from './textures.js';
import { clamp, damp, lerp, DEG } from './util.js';

export const CAR_X = 0.37;
const UP = new THREE.Vector3(0, 1, 0);
const gaugeRot = (f) => (-(135 + 270 * clamp(f, 0, 1)) - 90) * DEG;

function needleGeo(len, w) {
  const s = new THREE.Shape();
  s.moveTo(-w, -len * 0.18);
  s.lineTo(w, -len * 0.18);
  s.lineTo(w * 0.3, len);
  s.lineTo(-w * 0.3, len);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function beamBetween(a, b, r, material, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const m = new THREE.Mesh(g, material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
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
    const M = (this.M = {
      dash: new THREE.MeshLambertMaterial({ color: 0x2e2f35 }),
      dashDark: new THREE.MeshLambertMaterial({ color: 0x1c1d21 }),
      slat: new THREE.MeshLambertMaterial({ color: 0x34353a }),
      piano: new THREE.MeshPhongMaterial({ color: 0x0b0b0d, specular: 0x666666, shininess: 90 }),
      silver: new THREE.MeshPhongMaterial({ color: 0xaab0b8, specular: 0x999999, shininess: 60 }),
      leather: new THREE.MeshPhongMaterial({ color: 0x1c1c1f, specular: 0x2a2a2a, shininess: 25 }),
      pillar: new THREE.MeshLambertMaterial({ color: 0x3d3e44 }),
      headliner: new THREE.MeshLambertMaterial({ color: 0x9c9993 }),
      frit: new THREE.MeshBasicMaterial({ color: 0x0c0c0e }),
      paint: new THREE.MeshPhongMaterial({ color: 0xf5f5f2, specular: 0xbbbbbb, shininess: 90 }),
      black: new THREE.MeshBasicMaterial({ color: 0x050506 }),
      sideGlass: new THREE.MeshBasicMaterial({ color: 0x7d8da3 }),
    });

    // --- dashboard: side profile extruded across the car
    const prof = new THREE.Shape();
    prof.moveTo(1.02, -0.305);
    prof.bezierCurveTo(0.9, -0.275, 0.75, -0.262, 0.66, -0.268);
    prof.quadraticCurveTo(0.6, -0.272, 0.585, -0.31);
    prof.lineTo(0.567, -0.45);
    prof.lineTo(0.56, -0.62);
    prof.lineTo(0.75, -0.78);
    prof.lineTo(1.02, -0.78);
    prof.closePath();
    const dashGeo = new THREE.ExtrudeGeometry(prof, { depth: 2.35, bevelEnabled: false, curveSegments: 12 });
    dashGeo.rotateY(Math.PI / 2);
    dashGeo.translate(-0.82, 0, 0);
    R.add(new THREE.Mesh(dashGeo, M.dash));

    // passenger-side trim band (a long horizontal accent)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.014, 0.012), M.silver);
    trim.position.set(1.03, -0.322, -0.585);
    R.add(trim);
    const softPanel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.02), M.dashDark);
    softPanel.position.set(1.03, -0.37, -0.575);
    R.add(softPanel);

    // --- instrument binnacle hood
    const arch = new THREE.Shape();
    arch.absarc(0, -0.36, 0.235, 0.3, Math.PI - 0.3, false);
    arch.absarc(0, -0.36, 0.212, Math.PI - 0.3, 0.3, true);
    arch.closePath();
    const archGeo = new THREE.ExtrudeGeometry(arch, { depth: 0.21, bevelEnabled: false, curveSegments: 18 });
    archGeo.translate(0, 0, -0.81);
    R.add(new THREE.Mesh(archGeo, M.dash));

    // --- gauge cluster (three rings: tach, speedo, fuel)
    const cl = new THREE.Group();
    cl.position.set(0, -0.272, -0.775);
    cl.rotation.x = -0.33;
    R.add(cl);
    this.clusterTex = this._clusterTexture();
    cl.add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.113), new THREE.MeshBasicMaterial({ map: this.clusterTex })));
    const needleMat = new THREE.MeshBasicMaterial({ color: 0xff5424 });
    const capMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1e });
    const mkNeedle = (x, y, len) => {
      const n = new THREE.Mesh(needleGeo(len, 0.0028), needleMat);
      n.position.set(x, y, 0.0015);
      cl.add(n);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 16), capMat);
      cap.position.set(x, y, 0.0022);
      cl.add(cap);
      return n;
    };
    this.nTach = mkNeedle(-0.107, -0.0016, 0.038);
    this.nSpeed = mkNeedle(0, 0, 0.044);
    this.nFuel = mkNeedle(0.107, -0.0016, 0.034);
    this.ecoMat = new THREE.MeshBasicMaterial({ color: 0x40ff90 });
    const eco = new THREE.Mesh(new THREE.RingGeometry(0.0548, 0.0588, 56), this.ecoMat);
    eco.position.z = 0.0008;
    cl.add(eco);
    const [dc, dg] = makeCanvas(128, 64);
    this.digiCanvas = dc;
    this.digiCtx = dg;
    this.digiTex = canvasTexture(dc);
    const digi = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.018), new THREE.MeshBasicMaterial({ map: this.digiTex, transparent: true }));
    digi.position.set(0, -0.026, 0.0018);
    cl.add(digi);
    const [wc, wg] = makeCanvas(256, 80);
    wg.fillStyle = '#ff9a1a';
    wg.font = `64px ${COMIC_FONT}`;
    wg.textAlign = 'center';
    wg.textBaseline = 'middle';
    wg.fillText('DEER!', 128, 44);
    this.warnMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.0156), new THREE.MeshBasicMaterial({ map: canvasTexture(wc), transparent: true }));
    this.warnMesh.position.set(0, 0.02, 0.0024);
    this.warnMesh.visible = false;
    cl.add(this.warnMesh);

    // --- center stack: piano-black bezel, touchscreen, flanking vents
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.03), M.piano);
    bezel.position.set(CAR_X, -0.338, -0.592);
    bezel.rotation.x = -0.25;
    R.add(bezel);
    const [sc, sg] = makeCanvas(512, 288);
    this.screenCanvas = sc;
    this.screenCtx = sg;
    this.screenTex = canvasTexture(sc);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.0956), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(CAR_X + 0.012, -0.336, -0.575);
    screen.rotation.x = -0.25;
    R.add(screen);
    // capacitive button strip left of the screen
    const btns = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.09), new THREE.MeshBasicMaterial({ map: this._buttonStripTexture(), transparent: true }));
    btns.position.set(CAR_X - 0.088, -0.336, -0.575);
    btns.rotation.x = -0.25;
    R.add(btns);
    const vent = (x, y, z, w, h, ry = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.set(-0.2, ry, 0);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), M.silver));
      const inner = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, h * 0.74, 0.022), M.black);
      inner.position.z = 0.002;
      g.add(inner);
      for (let i = 1; i < 4; i++) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, 0.0045, 0.024), M.slat);
        sl.position.set(0, -h * 0.37 + i * h * 0.185, 0.004);
        g.add(sl);
      }
      R.add(g);
    };
    vent(CAR_X - 0.16, -0.345, -0.585, 0.06, 0.07);
    vent(CAR_X + 0.18, -0.345, -0.585, 0.06, 0.07);
    vent(-0.47, -0.325, -0.6, 0.12, 0.065, 0.35);
    vent(1.33, -0.33, -0.6, 0.13, 0.065, -0.3);

    // steering column
    R.add(beamBetween(new THREE.Vector3(0, -0.37, -0.56), new THREE.Vector3(0, -0.47, -0.78), 0.05, M.dashDark, 10));

    // --- steering wheel
    const wb = new THREE.Group();
    wb.position.set(0, -0.315, -0.52);
    wb.rotation.x = -0.5;
    R.add(wb);
    this.wheelBase = wb;
    const spin = new THREE.Group();
    wb.add(spin);
    this.wheelSpin = spin;
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 10, 44), M.leather));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.05, 24), M.dashDark);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, -0.012, -0.02);
    spin.add(hub);
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.067, 0.02, 24), M.leather);
    cover.rotation.x = Math.PI / 2;
    cover.position.set(0, -0.012, 0.012);
    spin.add(cover);
    // emblem: a simple silver "H"
    for (const [x, rz] of [[-0.0105, -0.1], [0.0105, 0.1]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.0075, 0.03, 0.005), M.silver);
      bar.position.set(x, -0.01, 0.024);
      bar.rotation.z = rz;
      spin.add(bar);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0055, 0.005), M.silver);
    cross.position.set(0, -0.012, 0.024);
    spin.add(cross);
    for (const sx of [-1, 1]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.036, 0.022), M.leather);
      spoke.position.set(sx * 0.123, -0.014, 0);
      spin.add(spoke);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.024), M.silver);
      accent.position.set(sx * 0.126, 0.006, 0.002);
      spin.add(accent);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.006), M.slat);
        b.position.set(sx * (0.095 + i * 0.024), -0.016, 0.012);
        spin.add(b);
      }
    }
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.02), M.leather);
    lower.position.set(0, -0.125, 0);
    spin.add(lower);

    // --- pillars, headliner, frit band
    R.add(beamBetween(new THREE.Vector3(-0.44, -0.31, -1.0), new THREE.Vector3(-0.68, 0.21, -0.45), 0.05, M.pillar));
    R.add(beamBetween(new THREE.Vector3(CAR_X + 0.81, -0.31, -1.0), new THREE.Vector3(CAR_X + 1.05, 0.21, -0.45), 0.05, M.pillar));
    const headliner = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.03, 1.0), M.headliner);
    headliner.position.set(CAR_X, 0.215, 0.04);
    R.add(headliner);
    const frit = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.04), M.frit);
    frit.position.set(CAR_X, 0.19, -0.47);
    frit.rotation.x = 0.845;
    R.add(frit);

    // --- rear-view mirror (shows a live render of the road behind)
    const mg = new THREE.Group();
    mg.position.set(CAR_X, 0.11, -0.6);
    mg.rotation.set(0.08, -0.45, 0, 'YXZ');
    R.add(mg);
    R.add(beamBetween(new THREE.Vector3(CAR_X, 0.2, -0.56), new THREE.Vector3(CAR_X, 0.125, -0.6), 0.008, M.dashDark));
    mg.add(new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.068, 0.03), M.dashDark));
    const mGeo = new THREE.PlaneGeometry(0.22, 0.055);
    const uv = mGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const glass = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture }));
    glass.position.z = 0.016;
    mg.add(glass);

    // --- left side mirror: rounded-rectangle housing with matching glass
    const roundRect = (w, h, r) => {
      const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y);
      s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r);
      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r);
      s.quadraticCurveTo(x, y, x + r, y);
      return s;
    };
    const sm = new THREE.Group();
    sm.position.set(-1.0, -0.25, -0.98);
    sm.rotation.y = 0.75;
    R.add(sm);
    const hGeo = new THREE.ExtrudeGeometry(roundRect(0.2, 0.115, 0.04), {
      depth: 0.06, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 3, curveSegments: 8,
    });
    hGeo.translate(0, 0, -0.06); // front (driver-facing) face ends at z = +0.018
    sm.add(new THREE.Mesh(hGeo, M.paint));
    const gGeo = new THREE.ShapeGeometry(roundRect(0.178, 0.094, 0.03), 8);
    const gp = gGeo.attributes.position, guv = gGeo.attributes.uv;
    for (let i = 0; i < gp.count; i++) guv.setXY(i, (gp.getX(i) + 0.089) / 0.178, (gp.getY(i) + 0.047) / 0.094);
    const sg2 = new THREE.Mesh(gGeo, M.sideGlass);
    sg2.position.z = 0.0195;
    sm.add(sg2);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.04), M.dashDark);
    stalk.position.set(0.12, -0.025, -0.04);
    sm.add(stalk);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.4), M.dash);
    sill.position.set(-0.8, -0.33, -0.35);
    R.add(sill);

    // --- white hood
    R.add(new THREE.Mesh(this._hoodGeo(), M.paint));
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
    const W = 1024, H = 340;
    const [c, g] = makeCanvas(W, H);
    g.fillStyle = '#050506';
    g.fillRect(0, 0, W, H);
    const dial = (cx, cy, r, max, major, minor, label, red, unit) => {
      const grd = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      grd.addColorStop(0, '#191a1e');
      grd.addColorStop(1, '#09090b');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#8f959d';
      g.beginPath();
      g.arc(cx, cy, r + 9, 0, Math.PI * 2);
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const steps = Math.round(max / minor);
      for (let k = 0; k <= steps; k++) {
        const v = k * minor;
        const a = (135 + (270 * v) / max) * DEG;
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const r0 = r - (isMajor ? 26 : 14);
        g.strokeStyle = red != null && v >= red ? '#ff3b30' : '#f3f3f3';
        g.lineWidth = isMajor ? 5 : 2.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
        g.stroke();
        if (isMajor && label) {
          const txt = label(v);
          if (txt) {
            g.fillStyle = '#f3f3f3';
            g.font = `bold ${Math.round(r * 0.17)}px Arial, sans-serif`;
            const rl = r - 50;
            g.fillText(txt, cx + Math.cos(a) * rl, cy + Math.sin(a) * rl);
          }
        }
      }
      if (unit) {
        g.fillStyle = '#9aa0a8';
        g.font = `bold ${Math.round(r * 0.12)}px Arial, sans-serif`;
        g.fillText(unit, cx, cy + r * 0.62);
      }
    };
    dial(190, 175, 140, 8, 1, 0.5, (v) => String(v), 6.5, 'x1000rpm');
    dial(512, 170, 158, 140, 20, 10, (v) => String(v), null, null);
    dial(834, 175, 140, 1, 0.5, 0.125, (v) => (v === 0 ? 'E' : v === 1 ? 'F' : ''), null, 'FUEL');
    g.fillStyle = '#7fd4ff';
    g.font = 'bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('ECO', 512, 60);
    return canvasTexture(c);
  }

  _buttonStripTexture() {
    const [c, g] = makeCanvas(32, 160);
    g.strokeStyle = 'rgba(210,225,255,0.75)';
    g.fillStyle = 'rgba(210,225,255,0.75)';
    g.lineWidth = 3;
    // power, home, menu, back glyphs
    g.beginPath();
    g.arc(16, 22, 8, -1.1, 4.2);
    g.moveTo(16, 10);
    g.lineTo(16, 20);
    g.stroke();
    g.beginPath();
    g.moveTo(7, 64);
    g.lineTo(16, 55);
    g.lineTo(25, 64);
    g.moveTo(10, 62);
    g.lineTo(10, 72);
    g.lineTo(22, 72);
    g.lineTo(22, 62);
    g.stroke();
    for (let i = 0; i < 3; i++) g.fillRect(8, 96 + i * 7, 16, 3);
    g.beginPath();
    g.moveTo(24, 140);
    g.lineTo(10, 140);
    g.moveTo(15, 134);
    g.lineTo(9, 140);
    g.lineTo(15, 146);
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
      g.font = 'bold 44px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(mph), 64, 34);
      this.digiTex.needsUpdate = true;
    }
    this.warnMesh.visible = !!st.warn && Math.floor(st.time * 7) % 2 === 0;
  }
}
