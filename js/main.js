// Entry point: build the pieces, wire up buttons, start the loop.
import { UI } from './ui.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { MODES } from './modes.js';
import { MusicPlayer } from './music.js';

const KEY = 'maya-sim-v1';
const $ = (id) => document.getElementById(id);

function loadStore() {
  const data = { unlocked: false, best: {}, sound: true, sens: 1, tips: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      Object.assign(data, p);
      data.best = p.best || {};
      data.tips = p.tips || {};
    }
  } catch (_) {
    /* private mode or blocked storage: play without saving */
  }
  return {
    data,
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (_) {
        /* ignore */
      }
    },
  };
}

function showError(msg) {
  const el = $('err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

window.addEventListener('error', (e) => showError(`Oops: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Oops: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

function boot() {
  const ui = new UI();
  const store = loadStore();
  const input = new Input($('touch'));
  const audio = new AudioEngine();
  let game;
  try {
    game = new Game({ canvas: $('game'), ui, input, audio, store });
  } catch (e) {
    ui.loading(true, "Your browser couldn't start 3D graphics. Try Safari or Chrome.");
    return;
  }
  window.__game = game;
  game.setMode('dodge');
  game.showTitle();
  game.start();
  requestAnimationFrame(() => ui.loading(false));

  const on = (id, fn) =>
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      fn(e);
    });
  const openModes = (from) => {
    game.modesFrom = from;
    game.state = 'modes';
    ui.buildModes(MODES, store.data, (k) => game.selectMode(k));
  };
  // Music: shuffles the mp3s in the repo's music/ folder (see music.js)
  const music = new MusicPlayer();
  game.music = music;
  music.setMuted(!store.data.sound);
  music.onChange = (playing, title) => {
    $('btn-music').classList.toggle('on', playing);
    if (playing && title) game.toast(`🎵 ${title}`, 'tip', 2600);
    if (playing) game.radioOff(); // one thing playing at a time
  };
  music.onEmpty = () => game.toast('No songs yet. Add .mp3 files to the music folder.', 'tip', 3500);

  const toggleSound = () => {
    store.data.sound = !store.data.sound;
    store.save();
    audio.unlock();
    audio.setMuted(!store.data.sound);
    music.setMuted(!store.data.sound);
    ui.setSound(store.data.sound);
  };

  on('btn-start', () => game.startRun());
  on('btn-modes', () => openModes('title'));
  on('btn-m-back', () => (game.modesFrom === 'over' ? game.quitToMenu() : game.showTitle()));
  on('btn-sound', toggleSound);
  on('btn-pause', () => game.pause());
  on('btn-resume', () => game.resume());
  on('btn-recenter', () => {
    game.resume();
    game.recenter();
  });
  on('p-sound', toggleSound);
  on('btn-quit', () => game.quitToMenu());
  on('btn-again', () => game.selectMode(game.modeKey));
  on('btn-o-modes', () => openModes('over'));
  on('btn-o-menu', () => game.quitToMenu());
  on('btn-radio', () => {
    music.pause(); // switching to the car radio stops the music
    game.radio();
  });
  on('btn-music', () => {
    audio.unlock();
    music.toggle();
  });
  document.addEventListener('visibilitychange', () => music.background(document.hidden));
  document.querySelectorAll('#p-sens button').forEach((b) =>
    b.addEventListener('click', () => {
      const v = Number(b.dataset.v);
      store.data.sens = v;
      store.save();
      input.setSensitivity(v);
      ui.setSensitivity(v);
    })
  );
  const horn = $('btn-horn');
  horn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    horn.classList.add('on');
    game.horn();
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) horn.addEventListener(t, () => horn.classList.remove('on'));

  // iOS Safari: no pinch/double-tap zoom while playing
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  if (isIOS && !standalone) $('t-a2hs').classList.remove('hidden');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
