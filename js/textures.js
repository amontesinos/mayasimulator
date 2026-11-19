// Procedurally drawn canvas textures: road surfaces, signs, sprites.
import * as THREE from '../vendor/three.module.min.js';

export const COMIC_FONT = '"Luckiest Guy", "Arial Black", "Helvetica Neue", Arial, sans-serif';
const SIGN_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function canvasTexture(c, { repeatT = false, aniso = 1, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeatT) t.wrapT = THREE.RepeatWrapping;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// spec: { left, right (meters), length (m), asphalt, shoulder, shoulders:[[a,b]], tracks:[d], lines:[{d,w,color,dash}] }
export function makeRoadTexture(spec, aniso) {
  const W = 512, H = 1024;
  const [c, g] = makeCanvas(W, H);
  const width = spec.right - spec.left;
  const X = (d) => ((d - spec.left) / width) * W;
  const pym = H / spec.length;
  g.fillStyle = spec.asphalt;
  g.fillRect(0, 0, W, H);
  g.fillStyle = spec.shoulder;
  for (const [a, b] of spec.shoulders) g.fillRect(X(a), 0, X(b) - X(a), H);
  // darker wheel tracks
  g.fillStyle = 'rgba(0,0,0,0.09)';
  for (const t of spec.tracks) g.fillRect(X(t - 0.35), 0, X(t + 0.35) - X(t - 0.35), H);
  // speckle
  const img = g.getImageData(0, 0, W, H);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    px[i] += n;
    px[i + 1] += n;
    px[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // a few tar-snake cracks
  g.strokeStyle = 'rgba(15,15,18,0.55)';
  g.lineWidth = 2;
  for (let k = 0; k < 7; k++) {
    let x = Math.random() * W, y = Math.random() * H;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (Math.random() - 0.5) * 30;
      y += Math.random() * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // (lane markings are separate geometry, see World._laneLines: painted into
  // this texture they smeared into wide streaks wherever the GPU blurs it)
  void pym;
  const tex = canvasTexture(c, { repeatT: true, aniso });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

// Leaping deer silhouette (like the yellow road sign), centered at cx,cy.
// One continuous outline (body, neck, head, tucked forelegs, hind legs
// stretched back) so it reads as a single smooth shape, plus thin antlers.
// DEER_CX/CY: the drawing's visual center (between its bounding box and the
// centroid of its filled area, measured from a render): the thin antlers pull
// the box up while the body's weight sits lower, so the box alone looks low.
const DEER_CX = -2.2, DEER_CY = -10.2;
export function drawLeapingDeer(g, cx, cy, size, color) {
  g.save();
  g.translate(cx, cy);
  const k = size / 100;
  g.scale(k, k);
  g.translate(-DEER_CX, -DEER_CY);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-36, -11); // top of the rump
  g.quadraticCurveTo(-14, -20, 8, -16); // back
  g.quadraticCurveTo(14, -18, 18, -24); // withers into the neck
  g.lineTo(22, -34); // back of the neck
  g.lineTo(18, -43); // ear
  g.lineTo(26, -37);
  g.quadraticCurveTo(33, -41, 40, -35); // forehead
  g.lineTo(47, -29); // muzzle
  g.quadraticCurveTo(47, -25, 43, -25); // nose
  g.quadraticCurveTo(36, -24, 31, -21); // jaw
  g.quadraticCurveTo(28, -12, 27, -4); // throat down to the chest
  g.lineTo(36, 2); // front foreleg, tucked forward
  g.lineTo(44, 12);
  g.lineTo(41, 15);
  g.lineTo(32, 6);
  g.lineTo(24, 4);
  g.lineTo(26, 12); // other foreleg
  g.lineTo(31, 22);
  g.lineTo(27, 24);
  g.lineTo(19, 12);
  g.lineTo(14, 7);
  g.quadraticCurveTo(-2, 12, -18, 8); // belly
  g.lineTo(-24, 14); // near hind leg, stretched back and down
  g.lineTo(-36, 24);
  g.lineTo(-45, 31);
  g.lineTo(-48, 28);
  g.lineTo(-38, 18);
  g.lineTo(-33, 12);
  g.lineTo(-42, 16); // far hind leg, a little higher
  g.lineTo(-52, 22);
  g.lineTo(-54, 19);
  g.lineTo(-44, 8);
  g.quadraticCurveTo(-45, -2, -41, -6); // up the back of the rump
  g.lineTo(-46, -10); // tail, flicked up
  g.quadraticCurveTo(-43, -14, -36, -11);
  g.closePath();
  g.fill();
  // antlers
  g.lineCap = 'round';
  g.lineWidth = 2.8;
  g.beginPath();
  g.moveTo(27, -38);
  g.quadraticCurveTo(24, -50, 31, -57); // main beam
  g.moveTo(25.5, -46);
  g.lineTo(19, -52); // brow tine
  g.moveTo(26.5, -52);
  g.lineTo(23, -60); // upper tine
  g.stroke();
  g.restore();
}
function drawCurveArrow(g, cx, cy, dir) {
  g.save();
  g.translate(cx, cy);
  g.scale(dir, 1);
  g.strokeStyle = '#111';
  g.fillStyle = '#111';
  g.lineWidth = 17;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(-14, 62);
  g.lineTo(-14, 8);
  g.quadraticCurveTo(-14, -28, 22, -36);
  g.stroke();
  g.beginPath();
  g.moveTo(54, -38);
  g.lineTo(20, -64);
  g.lineTo(20, -10);
  g.closePath();
  g.fill();
  g.restore();
}

function diamond(g, S) {
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(Math.PI / 4);
  roundRect(g, -88, -88, 176, 176, 16);
  g.fillStyle = '#151515';
  g.fill();
  roundRect(g, -83, -83, 166, 166, 12);
  g.fillStyle = '#f6c500';
  g.fill();
  roundRect(g, -76, -76, 152, 152, 9);
  g.lineWidth = 4;
  g.strokeStyle = '#151515';
  g.stroke();
  g.restore();
}

// Draws the yellow deer-crossing diamond into any 2D context (title badge, icons).
export function paintDeerSign(g, S) {
  g.save();
  g.clearRect(0, 0, S, S);
  g.scale(S / 256, S / 256);
  diamond(g, 256);
  drawLeapingDeer(g, 128, 128, 124, '#151515');
  g.restore();
}

// Yellow warning diamonds: 'deer' | 'curveL' | 'curveR'
export function makeWarningSign(kind, aniso) {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  diamond(g, S);
  if (kind === 'deer') drawLeapingDeer(g, S / 2, S / 2, 124, '#151515');
  else drawCurveArrow(g, S / 2, S / 2, kind === 'curveL' ? -1 : 1);
  return canvasTexture(c, { aniso });
}

// White (or yellow) rectangular text sign. lines: [[text, sizePx], ...]
export function makeTextSign(lines, { w = 256, h = 320, bg = '#f4f4f0', fg = '#151515' } = {}, aniso = 1) {
  const [c, g] = makeCanvas(w, h);
  roundRect(g, 2, 2, w - 4, h - 4, 18);
  g.fillStyle = '#151515';
  g.fill();
  roundRect(g, 8, 8, w - 16, h - 16, 13);
  g.fillStyle = bg;
  g.fill();
  roundRect(g, 15, 15, w - 30, h - 30, 9);
  g.lineWidth = 4;
  g.strokeStyle = fg;
  g.stroke();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let total = 0;
  for (const [, size] of lines) total += size * 1.05;
  let y = h / 2 - total / 2;
  for (const [text, size] of lines) {
    g.font = `bold ${size}px ${SIGN_FONT}`;
    const tw = g.measureText(text).width;
    const scale = Math.min(1, (w - 44) / tw);
    g.save();
    g.translate(w / 2, y + (size * 1.05) / 2);
    g.scale(scale, 1);
    g.fillText(text, 0, 0);
    g.restore();
    y += size * 1.05;
  }
  return canvasTexture(c, { aniso });
}

export function makeGlowTexture() {
  const [c, g] = makeCanvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

export function makeShadowTexture() {
  const [c, g] = makeCanvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { srgb: false });
}

export function makeStarTexture() {
  const [c, g] = makeCanvas(64, 64);
  g.translate(32, 32);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 11 : 27;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffd83a';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#b86a00';
  g.stroke();
  return canvasTexture(c);
}

// Comic speech bubble with a tail pointing down. Returns { tex, aspect }.
export function makeBubbleTexture(text) {
  const fontSize = 44;
  const [m, mg] = makeCanvas(8, 8);
  mg.font = `${fontSize}px ${COMIC_FONT}`;
  const tw = Math.min(900, mg.measureText(text).width);
  const w = Math.ceil(tw + 64), h = 120;
  const [c, g] = makeCanvas(w, h);
  roundRect(g, 5, 5, w - 10, 82, 30);
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#111';
  g.stroke();
  g.beginPath();
  g.moveTo(w / 2 - 16, 84);
  g.lineTo(w / 2 + 4, 114);
  g.lineTo(w / 2 + 14, 84);
  g.fillStyle = '#fff';
  g.fill();
  g.beginPath();
  g.moveTo(w / 2 - 16, 87);
  g.lineTo(w / 2 + 4, 114);
  g.lineTo(w / 2 + 14, 87);
  g.stroke();
  g.fillStyle = '#111';
  g.font = `${fontSize}px ${COMIC_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 50, w - 40);
  return { tex: canvasTexture(c), aspect: w / h };
}
