// DOM overlay: screens, HUD, toasts, the BONK pop, and windshield cracks.
import { mulberry32, fmt } from './util.js';
import { paintDeerSign } from './textures.js';

const $ = (id) => document.getElementById(id);
const clampUnit = (v) => Math.min(1, Math.max(0, v));

class CrackLayer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.cracks = [];
    this.dpr = 1;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.width = Math.round(window.innerWidth * this.dpr);
    this.c.height = Math.round(window.innerHeight * this.dpr);
    this.redraw();
  }

  clear() {
    this.cracks = [];
    this.redraw();
  }

  add(x, y) {
    this.cracks.push({ x, y, seed: (Math.random() * 1e9) | 0, size: 0.17 + Math.random() * 0.06 });
    this.redraw();
  }

  redraw() {
    const g = this.g, W = window.innerWidth, H = window.innerHeight;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.c.width, this.c.height);
    if (!this.cracks.length) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H * 0.6);
    g.clip();
    for (const ck of this.cracks) this._draw(g, ck.x * W, ck.y * H, ck.size * Math.min(W, H * 2), ck.seed);
    g.restore();
  }

  _draw(g, x, y, r, seed) {
    const rnd = mulberry32(seed);
    const n = 10 + Math.floor(rnd() * 5);
    const rays = [];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.45;
      const len = r * (0.45 + rnd() * 0.85);
      const pts = [[x, y]];
      for (let k = 1; k <= 6; k++) {
        const aa = a + (rnd() - 0.5) * 0.32;
        pts.push([x + Math.cos(aa) * len * (k / 6), y + Math.sin(aa) * len * (k / 6)]);
      }
      rays.push(pts);
    }
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)';
      g.lineWidth = pass ? 1.3 : 2.6;
      for (const pts of rays) {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts) g.lineTo(p[0], p[1]);
        g.stroke();
      }
      for (const ring of [1, 2, 4]) {
        g.beginPath();
        rays.forEach((pts, i) => {
          const p = pts[Math.min(ring, pts.length - 1)];
          const jx = (rnd() - 0.5) * 5, jy = (rnd() - 0.5) * 5;
          if (i === 0) g.moveTo(p[0] + jx, p[1] + jy);
          else g.lineTo(p[0] + jx, p[1] + jy);
        });
        g.closePath();
        g.globalAlpha = 0.55;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    const grd = g.createRadialGradient(x, y, 0, x, y, r * 0.14);
    grd.addColorStop(0, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r * 0.14, 0, Math.PI * 2);
    g.fill();
  }
}

export class UI {
  constructor() {
    this.screens = ['s-title', 's-calib', 's-pause', 's-over', 's-modes'];
    this.crack = new CrackLayer($('crack'));
    this.lastMid = '';
    const sign = $('t-sign');
    if (sign) paintDeerSign(sign.getContext('2d'), sign.width);
    $('music-dock').append($('btn-music')); // the game starts on the title screen
  }

  show(id) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== id);
  }

  // The music button rides along: in the HUD's button row while driving, in
  // the top-right corner dock on every menu screen (pause included).
  placeMusic(inHud) {
    const btn = $('btn-music');
    const home = inHud ? document.querySelector('.hud-btns') : $('music-dock');
    if (btn.parentElement !== home) home.prepend(btn);
  }

  showHud(on, inputMode, modeKey) {
    $('hud').classList.toggle('hidden', !on);
    this.placeMusic(on);
    if (on) {
      $('hud').dataset.input = inputMode;
      $('hud').dataset.mode = modeKey;
      $('btn-radio').classList.toggle('hidden', modeKey !== 'chill');
      this.lastMid = '';
    }
  }

  setHud(h) {
    $('hud-score').textContent = h.score;
    $('hud-sub').textContent = h.sub;
    let html = '';
    if (h.lives != null) {
      for (let i = 0; i < h.maxLives; i++) html += `<span class="heart${i < h.lives ? ' on' : ''}">♥</span>`;
    } else if (h.herd != null) {
      const m = Math.round(h.herd);
      const pct = Math.max(0, Math.min(100, (h.herd / 200) * 100));
      html = `<div class="herd${m < 40 ? ' danger' : ''}"><span class="herd-icon">🦌</span><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div><b>${m} m</b></div>`;
    } else if (h.radio) {
      html = `<div class="radio-label">${h.radio}</div>`;
    }
    if (html !== this.lastMid) {
      $('hud-mid').innerHTML = html;
      this.lastMid = html;
    }
    $('vignette').style.opacity = h.herd != null ? String(Math.max(0, Math.min(0.9, (60 - h.herd) / 60))) : '0';
  }

  setPedals(thr, brk) {
    $('pedal-r').classList.toggle('on', thr > 0);
    $('pedal-l').classList.toggle('on', brk > 0);
    $('pedal-brake2').classList.toggle('on', brk > 0);
  }

  toast(text, cls = '', ms = 2000) {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  pop(text, cls = '') {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.innerHTML = `<div class="burst"></div><span>${text}</span>`;
    $('pop').appendChild(el);
    setTimeout(() => el.remove(), cls === 'boom' ? 1700 : 1100);
  }

  clearToasts() {
    $('toasts').innerHTML = '';
  }

  flash() {
    const el = $('flash');
    el.classList.remove('on');
    void el.offsetWidth; // restart the animation
    el.classList.add('on');
  }

  // Calibration screen. Only the fields passed are updated (and only when they change).
  setCalib({ count, title, sub, progress, level, x, ok }) {
    const c = this.calibState || (this.calibState = {});
    const text = (id, key, v) => {
      if (v != null && c[key] !== v) $(id).textContent = c[key] = v;
    };
    text('c-count', 'count', count);
    text('c-text', 'title', title);
    text('c-sub', 'sub', sub);
    if (progress != null) $('c-bar').style.transform = `scaleX(${clampUnit(progress).toFixed(3)})`;
    if (level != null && c.level !== level) $('c-level').classList.toggle('hidden', !(c.level = level));
    if (ok != null && c.ok !== ok) $('c-level').classList.toggle('ok', (c.ok = ok));
    if (x != null) $('c-bubble').style.transform = `translateX(${(clampUnit(x * 0.5 + 0.5) * 120 - 60).toFixed(1)}px)`;
  }

  setTitle(Mode, data, isTouch) {
    $('t-mode').textContent = `${Mode.icon} ${Mode.title}`;
    $('t-desc').textContent = Mode.desc;
    const best = data.best[Mode.key];
    $('t-best').textContent = best ? `Best: ${fmt(best)}` : '';
    $('btn-modes').classList.toggle('hidden', !data.unlocked);
    $('btn-sound').textContent = data.sound ? '🔊 Sound on' : '🔇 Sound off';
    $('t-howto').innerHTML = isTouch
      ? 'Hold your phone sideways like a steering wheel. <b>Tilt to steer</b><br>Right thumb = gas · left thumb = brake'
      : '<b>Arrow keys / WASD</b> to drive · <b>H</b> to honk · <b>P</b> to pause';
  }

  setSound(on) {
    $('btn-sound').textContent = on ? '🔊 Sound on' : '🔇 Sound off';
    $('p-sound').textContent = on ? 'Sound: On' : 'Sound: Off';
  }

  setSensitivity(i) {
    document.querySelectorAll('#p-sens button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === i));
  }

  showGameOver(r) {
    $('o-title').textContent = r.title;
    $('o-score').textContent = fmt(r.score);
    $('o-best').textContent = r.newBest ? 'NEW BEST!' : `Best: ${fmt(r.best)}`;
    $('o-best').classList.toggle('new', !!r.newBest);
    $('o-stats').innerHTML = r.stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('o-quip').textContent = r.quip;
    $('o-unlock').classList.toggle('hidden', !r.justUnlocked);
    $('btn-o-modes').classList.toggle('hidden', !r.unlocked);
    this.show('s-over');
  }

  buildModes(MODES, data, onPick) {
    const box = $('m-list');
    box.innerHTML = '';
    for (const M of Object.values(MODES)) {
      const b = document.createElement('button');
      b.className = 'mode-card';
      const best = data.best[M.key];
      b.innerHTML = `<div class="m-icon">${M.icon}</div><div class="m-title">${M.title}</div><div class="m-desc">${M.desc}</div><div class="m-best">${best ? `Best: ${fmt(best)}` : M.key === 'chill' ? 'No score. Just vibes.' : 'No score yet'}</div>`;
      b.addEventListener('click', () => onPick(M.key));
      box.appendChild(b);
    }
    this.show('s-modes');
  }

  rotate(on) {
    $('s-rotate').classList.toggle('hidden', !on);
  }

  loading(on, text) {
    $('loading').classList.toggle('hidden', !on);
    if (text) $('loading-text').textContent = text;
  }

  resize() {
    this.crack.resize();
  }
}
