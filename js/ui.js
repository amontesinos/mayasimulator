// DOM overlay: screens, HUD, toasts and the BONK pop.
import { fmt } from './util.js';
import { paintDeerSign } from './textures.js';

const $ = (id) => document.getElementById(id);
const clampUnit = (v) => Math.min(1, Math.max(0, v));

export class UI {
  constructor() {
    this.screens = ['s-title', 's-calib', 's-pause', 's-over', 's-modes'];
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

  resize() {}
}
