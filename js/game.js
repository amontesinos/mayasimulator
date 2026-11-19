// Game orchestration: state machine, camera rig, rendering, and glue between
// world, cockpit, car, modes, input, audio and UI.
import * as THREE from '../vendor/three.module.min.js';
import { Road } from './road.js';
import { World, THEMES, ROADS } from './world.js';
import { Cockpit, CAR_X } from './cockpit.js';
import { PlayerCar } from './car.js';
import { DeerManager } from './deer.js';
import { TrafficManager } from './traffic.js';
import { CrashFX } from './fx.js';
import { MODES } from './modes.js';
import { clamp, damp, lerp, smoothstep, MPH, DEG } from './util.js';

// pavedL/R: where off-road slowdown starts. hardL/R: the furthest the car can go
// (a bounce in Chill Cruise; a crash in the modes where crashing ends the run).
const LIMITS = {
  twoLane: { pavedL: -4.25, pavedR: 4.25, hardL: -8.2, hardR: 8.2 },
  twoLaneCrash: { pavedL: -4.25, pavedR: 4.25, hardL: -13.8, hardR: 13.8 },
  // Chill Cruise: guardrails 1 m past each road edge; the car bounces off them
  twoLaneRails: { pavedL: -4.25, pavedR: 4.25, hardL: -4.8, hardR: 4.8 },
  highway: { pavedL: -9, pavedR: 9, hardL: -5.95, hardR: 7.95 },
};
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const CALIB_STEP = 1.0; // seconds per number in the 3-2-1 calibration countdown
const CAR_HALF_L = 2.1; // the car's footprint for roadside obstacle hits (m)
const CAR_HALF_W = 0.86;
// Off-road things the car can't push through: it stops dead against them.
// (Signs and posts give way; guardrails and barriers are glanced off.)
const IMMOVABLE = new Set(['tree', 'forest', 'rock']);
// Roadside things that get knocked over when the car runs into them.
const BREAKABLE = new Set(['post', 'sign']);

export class Game {
  constructor({ canvas, ui, input, audio, store }) {
    this.ui = ui;
    this.input = input;
    this.audio = audio;
    this.store = store;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.world = new World(this.renderer);
    this.cockpit = new Cockpit();
    this.camera = new THREE.PerspectiveCamera(56, 2, 0.25, 2600);
    this.car = new PlayerCar();
    this.deer = new DeerManager(this.world);
    this.traffic = new TrafficManager(this.world);
    this.fx = new CrashFX(this.world);
    this.camMode = 'fp'; // 'fp' = driver's seat, 'chase' = pulled out to watch a crash
    this.camT = 0;
    this.boom = null;
    this.tmpV2 = new THREE.Vector3();
    this.tmpV3 = new THREE.Vector3();
    this.tmpV4 = new THREE.Vector3();
    this.tmpV5 = new THREE.Vector3();
    this.tmpV6 = new THREE.Vector3();
    this.tmpV7 = new THREE.Vector3();
    this.carVel = new THREE.Vector3();
    // crash camera tilts up to follow something in the sky (the launched deer)
    this.skyPos = new THREE.Vector3();
    this.skyT = 0;
    this.skyLook = 0;
    this.rig = new THREE.Object3D();
    this.rig.rotation.order = 'YXZ';
    this.eye = new THREE.Vector3(-CAR_X, 1.2, 0.12);
    this.camPos = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.tmpV = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    // mirror camera: face backward, tilted up a little to show more sky
    this.flipQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(2.5 * DEG, Math.PI, 0, 'YXZ'));
    this.state = 'boot';
    this.time = 0;
    this.frame = 0;
    this.shake = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.hudT = 0;
    this.screenT = 0;
    this.frameMs = 16;
    this.slowT = 0;
    this.portrait = false;
    this.wake = null;
    this.attractNext = null;
    this.runS0 = 0;
    this.last = performance.now();

    this.input.onPause = () => (this.state === 'playing' ? this.pause() : this.state === 'paused' ? this.resume() : null);
    this.input.onRecenter = () => this.recenter();
    this.input.onHorn = () => this.horn();
    this.input.setSensitivity(store.data.sens);
    this.audio.setMuted(!store.data.sound);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 350));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.resize();
  }

  // ---------------------------------------------------------------- modes
  setMode(key) {
    if (this.mode && this.mode.stop) this.mode.stop();
    this.modeKey = key;
    const M = MODES[key];
    const theme = THEMES[M.theme];
    this.deer.clear();
    this.traffic.clear();
    this.cockpit.setHoodDeer(null);
    this.fx.reset();
    this.camMode = 'fp';
    this.boom = null;
    this.skyT = this.skyLook = 0;
    this.cockpit.cracks.clear();
    this.road = new Road({ seed: (Math.random() * 1e6) | 0, ...M.road });
    this.world.reset(theme, this.road);
    this.cockpit.setTheme(theme);
    this.roadSpec = ROADS[theme.road];
    this.limits = theme.road === 'highway' ? LIMITS.highway
      : theme.guardrail === 'both' ? LIMITS.twoLaneRails
      : M.crash ? LIMITS.twoLaneCrash : LIMITS.twoLane;
    this.homeLane = theme.road === 'highway' ? 0 : this.roadSpec.lanes[this.roadSpec.lanes.length - 1];
    this.car.reset(0, this.homeLane, 12);
    this.mode = new M(this);
    this.attractNext = null;
    this._placeCamera(0);
    this.world.update(this.car.s, this.camPos, 0, true);
  }

  showTitle() {
    this.state = 'title';
    this.input.active = false;
    this.ui.showHud(false);
    this.ui.setTitle(MODES[this.modeKey], this.store.data, this.input.isTouch);
    this.ui.show('s-title');
    this.releaseWake();
  }

  // Called from a tap/click. Order matters on iOS: ask for motion permission first.
  startRun(tiltPromise) {
    const p = tiltPromise || (this.input.isTouch ? this.input.requestTilt() : Promise.resolve('unsupported'));
    this.audio.unlock();
    this.requestWake();
    this.state = 'calib';
    this.calibT = 0;
    this.ui.showHud(false);
    this.ui.setCalib({ count: '3', progress: 0, x: 0, ok: false });
    this.ui.show('s-calib');
    // Hold the countdown until the iOS motion prompt has been answered.
    this.permPending = true;
    this.permWaitT = 0;
    p.finally(() => (this.permPending = false));
  }

  selectMode(key) {
    const p = this.input.isTouch ? this.input.requestTilt() : Promise.resolve('unsupported');
    this.audio.unlock();
    this.setMode(key);
    this.startRun(p);
  }

  // "Get ready…": a 3-2-1 countdown fills the bar while a bubble level shows the
  // phone's tilt live. Steering is relative to level, the same reading the
  // bubble shows, so there is nothing to calibrate (see Input.centerOnLevel).
  updateCalib(dt) {
    const inp = this.input;
    if (this.permPending) {
      this.permWaitT += dt;
      if (this.permWaitT > 30) this.permPending = false;
    }
    const waiting = this.portrait || this.permPending;
    this.calibT = waiting ? 0 : this.calibT + dt;
    const tilt = inp.isTouch && inp.tiltPermission !== 'denied' && inp.tiltPermission !== 'unsupported';
    const live = tilt && inp.hasTilt();
    const roll = live ? inp.rollSmooth : 0;
    const n = 3 - Math.floor(this.calibT / CALIB_STEP);
    let sub = 'Arrow keys or WASD to drive';
    if (inp.isTouch) {
      if (this.permPending) sub = 'Tap “Allow” so you can steer by tilting';
      else if (tilt) sub = 'Hold your phone level to go straight. Tilt it to steer.';
      else sub = 'Steer by dragging on the left side of the screen';
    }
    this.ui.setCalib({
      count: n > 0 ? String(n) : 'GO!',
      title: n > 0 ? 'Get ready…' : 'Drive safe!',
      sub,
      progress: this.calibT / (3 * CALIB_STEP),
      level: tilt,
      x: clamp(-roll / (12 * DEG), -1, 1),
      ok: live && Math.abs(roll) < 3 * DEG,
    });
    if (this.calibT >= 3 * CALIB_STEP + 0.4) this.finishCalib();
  }

  finishCalib() {
    const tilt = this.input.isTouch && this.input.tiltPermission === 'granted' && this.input.hasTilt();
    this.input.mode = tilt ? 'tilt' : this.input.isTouch ? 'touch' : 'keys';
    const heldTilted = tilt && this.input.centerOnLevel();
    this.state = 'playing';
    this.input.active = true;
    this.input.clearTouches();
    this.ui.show(null);
    this.ui.showHud(true, this.input.mode, this.modeKey);
    this.cockpit.cracks.clear();
    this.cockpit.setHoodDeer(null);
    this.fx.reset();
    this.camMode = 'fp';
    this.boom = null;
    this.runS0 = this.car.s;
    this.mode.start();
    this.ui.setHud(this.mode.hud());
    if (heldTilted) {
      this.toast('Steering centered on how you’re holding the phone', 'tip', 3200);
    } else if (this.input.isTouch && !tilt) {
      const why = this.input.tiltPermission === 'denied' ? 'Motion access was blocked' : 'Tilt steering is unavailable';
      this.toast(`${why}, so steer by dragging on the left side.`, 'tip', 4500);
    } else if (!this.input.isTouch) {
      this.toast('Arrow keys or WASD to drive · H to honk', 'tip', 3500);
    }
  }

  // reason: 'bonk' (last heart lost to a deer), 'crash' (hit something off the
  // road), or 'caught' (Deer Revenge herd). The first two blow up the car.
  // ob: the roadside obstacle that was hit, if it was one.
  endRun(reason, kind = null, ob = null) {
    if (this.state !== 'playing') return;
    this.state = 'ending';
    this.endT = 0;
    this.endReason = reason;
    this.crashKind = kind;
    this.input.active = false;
    this.input.clearTouches();
    this.skyT = this.skyLook = 0;
    if (reason === 'bonk' || reason === 'crash') {
      // pinned: stopped dead against something immovable
      const pinned = reason === 'crash' && IMMOVABLE.has(kind);
      this.boom = { exploded: false, stopT: null, pinned };
      this.audio.crunch();
      if (pinned) {
        // Trees and rocks don't give: the car stops right there, its crumpled
        // bumper against the trunk, and blows up where it stands.
        if (ob) this._backOff(ob);
        this.car.v = 0;
        this.audio.thud();
        this.shake = 1.3;
      } else {
        // Otherwise the car keeps its momentum: it rolls on, explodes, and slides
        // to a halt (glancing off a sign, post, guardrail or barrier back toward the road).
        if (reason === 'crash') {
          this.car.v *= 0.55;
          this.car.rel = (Math.sign(this.car.d) || 1) * 0.3;
        } else this.car.v *= 0.85;
        this.shake = 0.9;
      }
      this.cockpit.cracks.clear();
      this.fx.placeWreck(this.rig);
      // pull the camera out of the driver's seat to watch the car
      this.camMode = 'chase';
      this.camT = 0;
    } else this.audio.snort();
  }

  // Called each frame by a mode while something worth watching flies away.
  skyFollow(pos) {
    this.skyPos.copy(pos);
    this.skyT = 0.9; // keep looking a moment after the last call
  }

  // Off-road impact: all hearts gone at once.
  crash(kind, ob = null) {
    if (this.state !== 'playing') return;
    if (this.mode.lives != null) this.mode.lives = 0;
    this.ui.setHud(this.mode.hud());
    this.endRun('crash', kind, ob);
  }

  // A sign or marker post the car ran into falls over, away from the car.
  // (In the crash modes it still counts as a crash; this is the visible part.)
  knockOver(ob) {
    const f = this.tmpV.set(0, 0, -1).applyQuaternion(this.rig.quaternion);
    const len = Math.hypot(f.x, f.z) || 1;
    this.world.knockDown(ob, f.x / len, f.z / len, this.car.v);
    this.audio.knock(ob.kind, Math.min(1, this.car.v / 20));
    if (this.state === 'playing') this.car.v *= ob.kind === 'sign' ? 0.92 : 0.97; // Chill Cruise: a little bump
  }

  // Back the car out of an obstacle it ran into (the hit is caught a frame
  // late), leaving the front a little crumpled into it.
  _backOff(ob) {
    const car = this.car;
    const ps = CAR_HALF_L + ob.r - Math.abs(ob.s - car.s); // overlap along the road
    const pd = CAR_HALF_W + ob.r - Math.abs(ob.d - car.d); // overlap across it
    if (ps < pd) car.s -= Math.sign(ob.s - car.s) * Math.max(0, ps - 0.25);
    else car.d -= Math.sign(ob.d - car.d) * Math.max(0, pd - 0.1);
  }

  showGameOver() {
    this.state = 'over';
    const res = this.mode.results();
    const d = this.store.data;
    const prev = d.best[this.modeKey] || 0;
    const newBest = res.score > prev && res.score > 0;
    if (newBest) d.best[this.modeKey] = res.score;
    const justUnlocked = !d.unlocked;
    d.unlocked = true;
    this.store.save();
    this.ui.showHud(false);
    this.ui.showGameOver({ ...res, best: Math.max(prev, res.score), newBest, justUnlocked, unlocked: d.unlocked });
    if (justUnlocked) setTimeout(() => this.audio.fanfare(), 300);
    this.releaseWake();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.active = false;
    this.input.clearTouches();
    this.ui.setSensitivity(this.store.data.sens);
    this.ui.setSound(this.store.data.sound);
    this.ui.show('s-pause');
    this.ui.placeMusic(false); // in the corner, above the pause menu
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused' || this.portrait) return;
    this.audio.unlock();
    this.state = 'playing';
    this.input.active = true;
    this.input.clearTouches();
    this.ui.show(null);
    this.ui.placeMusic(true);
    this.requestWake();
  }

  recenter() {
    if (this.input.mode === 'tilt') {
      this.input.calibrate();
      this.toast('Steering centered', 'tip', 1200);
    }
  }

  quitToMenu() {
    this.audio.unlock();
    this.setMode(this.modeKey);
    this.showTitle();
  }

  horn() {
    if (this.state === 'playing') this.mode.onHorn();
    else this.audio.honk();
  }

  radio() {
    if (this.state === 'playing' && this.mode.nextStation) {
      this.mode.nextStation();
      this.ui.setHud(this.mode.hud());
    }
  }

  // Your own music started: the car radio (Chill Cruise) goes quiet.
  radioOff() {
    if (this.mode && this.mode.radioOff && this.state !== 'title') {
      this.mode.radioOff();
      if (this.state === 'playing') this.ui.setHud(this.mode.hud());
    }
  }

  toast(text, cls, ms) {
    this.ui.toast(text, cls, ms);
  }

  // Feedback for knocking over a sign or post that cost a heart (the clang or
  // thwack itself plays when it falls). A sign panel can catch the windshield.
  roadsideFx(kind) {
    this.ui.pop(kind === 'sign' ? 'CLANG!' : 'WHACK!');
    this.shake = 0.8;
    if (kind === 'sign') this.cockpit.cracks.add(0.7 + Math.random() * 0.1, 0.2 + Math.random() * 0.12);
  }

  bonkFx(pos, crack) {
    this.audio.bonk();
    this.ui.pop('BONK!');
    this.shake = 1;
    if (crack) {
      const v = this.tmpV.copy(pos);
      v.y += 0.8;
      v.project(this.camera);
      this.cockpit.cracks.add(clamp(v.x * 0.5 + 0.5, 0.18, 0.82), clamp(-v.y * 0.5 + 0.5, 0.14, 0.42));
    }
  }

  // Deer watching from the roadside behind the menus.
  attract() {
    const car = this.car;
    if (this.attractNext == null || this.attractNext < car.s) this.attractNext = car.s + 70;
    if (car.s + 170 > this.attractNext) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const deer = this.deer.spawn(Math.random() < 0.55 ? 'doe' : 'buck', this.attractNext, side * (6.6 + Math.random() * 4), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      deer.setState('watch');
      this.attractNext += 150 + Math.random() * 130;
    }
    for (const deer of [...this.deer.active]) {
      const ahead = deer.s - car.s;
      deer.look = ahead < 150;
      deer.headPitchT = deer.look ? -0.1 : 0.9;
      if (ahead < -40) this.deer.release(deer);
    }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const st = this.state;
    if (st === 'paused' || st === 'boot') return;
    const car = this.car, M = this.mode;
    const wrecked = this.camMode === 'chase'; // crashed: the car coasts, then slides to a halt
    let input, params;
    if (st === 'playing') {
      input = this.input;
      params = M.carParams();
    } else if (wrecked) {
      input = { steer: 0, throttle: 0, brake: 0 };
      params = { cruise: 0, vmax: 50, coast: this.boom && this.boom.exploded ? [4, 0.25] : [2.5, 0.15] };
    } else if (st === 'ending' || st === 'over') {
      input = { steer: car.autopilot(this.road, car.d, 0).steer, throttle: 0, brake: st === 'over' ? 1 : 0.7 };
      params = { cruise: 0, vmax: 50 };
    } else {
      input = car.autopilot(this.road, this.homeLane, 12);
      params = { cruise: 12, vmax: 50 };
    }
    car.update(dt, this.road, { ...params, input, limits: this.limits });

    if (st === 'playing') {
      M.update(dt);
      // In Deer Dodge and Deer Revenge, hitting anything off the road ends the run.
      if (this.state === 'playing' && M.constructor.crash) {
        let kind = null, ob = null;
        if (car.scrape) kind = this.roadSpec.lanes.length === 3 ? (car.d < 0 ? 'barrier' : 'guardrail') : 'forest';
        else {
          ob = this.world.hitObstacle(car.s, car.d, CAR_HALF_L, CAR_HALF_W);
          if (ob) kind = ob.kind;
        }
        if (kind) {
          // Signs and marker posts cost a heart where there are hearts (Deer Dodge);
          // anything else off the road is a crash.
          if (BREAKABLE.has(kind) && M.hitRoadside) M.hitRoadside(ob);
          else this.crash(kind, ob);
        }
      }
    }
    // Signs and marker posts the car runs into get knocked over, in every mode
    // (in Chill Cruise the car just drives on; a wreck still sliding knocks them too).
    if ((st === 'playing' || st === 'ending') && car.v > 1.5) {
      const ob = this.world.hitObstacle(car.s, car.d, CAR_HALF_L, CAR_HALF_W, BREAKABLE);
      if (ob) this.knockOver(ob);
    }
    if (st === 'playing') {
      if (car.scrape && !this.scraping) {
        // guardrails ring out with a metallic clang; anything else just scrapes
        const rail = this.world.theme.guardrail;
        if (rail === 'both' || (rail && car.d > 0)) this.audio.knock('sign', Math.min(1, car.v / 20));
        this.audio.scrape();
        this.shake = Math.max(this.shake, 0.35);
      }
      this.scraping = car.scrape > 0;
    } else if (st === 'ending') {
      this.endT += dt;
      if (this.boom && !this.boom.exploded && this.endT > (this.boom.pinned ? 0.4 : 0.55)) this.detonate();
      if (M.ending) M.ending(dt, this.endT);
      let endAt = 3.6;
      if (this.boom) {
        // game over once the wreck has slid to a stop...
        if (this.boom.exploded && this.boom.stopT == null && car.v < 0.25) this.boom.stopT = this.endT;
        endAt = this.boom.stopT != null ? Math.max(4.2, this.boom.stopT + 1.3) : 7.5;
      }
      // ...and the launched deer has flown off and twinkled (capped, just in case)
      if (M.endHold) endAt = Math.max(endAt, M.endHold());
      if (this.endT > Math.min(endAt, 7.5)) this.showGameOver();
    } else if (st === 'calib') this.updateCalib(dt);
    // re-check: the countdown may have just started the run this frame
    const s2 = this.state;
    if (s2 === 'title' || s2 === 'modes' || s2 === 'calib') this.attract();

    this._placeCamera(dt);
    this.deer.update(dt, this.camPos, this.camFwd);
    this.traffic.update(dt, this.roadSpec.lanes, { s: car.s, d: car.d, v: car.v, len: CAR_HALF_L * 2 });
    this.world.update(car.s, this.camPos, dt);
    this.fx.update(dt);

    const live = st === 'playing' || st === 'ending' || st === 'over';
    if (this.camMode === 'fp') {
      this.cockpit.update(dt, {
        steer: car.steer,
        mph: car.v * MPH,
        rpm: car.rpm,
        throttle: input.throttle || 0,
        fuel: clamp(0.8 - ((car.s - this.runS0) / 1609.34) * 0.015, 0.12, 0.8),
        warn: st === 'playing' && M.warn,
        time: this.time,
      });
      this.cockpit.orientSun(this.tmpQ.copy(this.rig.quaternion).invert());
    }

    this.hudT -= dt;
    if (this.hudT <= 0 && (st === 'playing' || st === 'ending')) {
      this.hudT = 0.1;
      this.ui.setHud(M.hud());
    }
    this.ui.setPedals(this.input.throttle, this.input.brake);
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.15;
      this.cockpit.drawScreen((g, w, h) => (live ? M.drawScreen(g, w, h) : this.drawIdleScreen(g, w, h)));
    }
    const engineOn = !(this.boom && this.boom.exploded);
    this.audio.setDrive({ rpm: car.rpm, throttle: input.throttle || 0, speed: car.v, offroad: car.offroad > 0 ? 1 : 0, on: engineOn });
    // Tire screech while braking at speed: a sharp bite when the brake goes on,
    // easing off as it's held, fading out as the car slows to a stop.
    const brake = params.coast ? 0 : input.brake || 0;
    this.brakeT = brake > 0 && car.v > 3 ? (this.brakeT || 0) + dt : 0;
    let screech = 0;
    if (this.brakeT > 0) {
      const bite = this.brakeT < 0.35 ? 1 : Math.max(0.55, 1 - (this.brakeT - 0.35) * 0.5);
      screech = bite * brake * smoothstep(3, 13, car.v) * (car.offroad > 0 ? 0.3 : 1);
    }
    this.audio.setScreech(screech, car.v);
  }

  // KABOOM: fireball, debris, charred wreck.
  detonate() {
    this.boom.exploded = true;
    const vel = this.carVel.set(0, 0, -1).applyQuaternion(this.rig.quaternion).multiplyScalar(this.car.v);
    this.fx.explode(vel, this.boom.pinned);
    this.audio.explosion();
    this.ui.clearToasts();
    this.ui.flash();
    this.ui.pop('KABOOM!', 'boom');
    this.ui.showHud(false);
    this.shake = 1.3;
    this.world.headlight.intensity = 0;
  }

  // Camera that rises out of the car and backs away to watch it blow up,
  // following the wreck as it slides to a halt.
  _chaseCam(dt) {
    this.camT += dt;
    const k = easeOut(this.camT / 0.6);
    const drift = Math.max(0, this.camT - 0.6);
    const car = this.car;
    const sC = car.s - 7.5 - drift * 0.35;
    const dC = car.d * 0.35 + Math.sin(drift * 0.4) * 1.5;
    if (!this._tmpP) this._tmpP = { x: 0, z: 0 };
    this.road.toWorld(sC, dC, this._tmpP);
    const gy = Math.max(this.world.heightAt(sC, dC), this.rig.position.y);
    const chase = this.tmpV2.set(this._tmpP.x, gy + 3.4 + drift * 0.15, this._tmpP.z);
    // the pull-out starts from the driver's eye, which is still moving with the car
    const eye = this.tmpV4.copy(this.eye).applyMatrix4(this.rig.matrixWorld);
    const lookFrom = this.tmpV5.set(0, 0, -1).applyQuaternion(this.rig.quaternion).multiplyScalar(12).add(eye);
    const pos = this.tmpV.copy(eye).lerp(chase, k);
    pos.y += Math.sin(Math.PI * k) * 1.2;
    this.shake = Math.max(0, this.shake - dt * 1.1);
    const sh = this.shake * this.shake, t = this.time;
    pos.x += Math.sin(t * 41.3) * sh * 0.3;
    pos.y += Math.sin(t * 37.1) * sh * 0.25;
    pos.z += Math.sin(t * 33.7) * sh * 0.3;
    const target = this.tmpV3.copy(this.fx.wreck.position);
    target.y += 1.1; // aim a little above the wreck
    target.lerp(lookFrom, 1 - k);
    // While the launched deer is in the air, tilt up to follow it into the sky
    // (keeping the burning wreck in the bottom of the frame), then settle back.
    this.skyT = Math.max(0, this.skyT - dt);
    this.skyLook = damp(this.skyLook, this.skyT > 0 ? 1 : 0, 2.2, dt);
    if (this.skyLook > 0.002) {
      const toWreck = this.tmpV6.copy(target).sub(pos).normalize();
      const toSky = this.tmpV7.copy(this.skyPos).sub(pos).normalize();
      target.copy(pos).add(toWreck.lerp(toSky, 0.4 * this.skyLook).normalize());
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    this.camPos.copy(pos);
    this.camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  drawIdleScreen(g, w, h) {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#0b1424');
    grd.addColorStop(1, '#1b2a44');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 96px Arial, sans-serif';
    g.fillText('HONDA', w / 2, h / 2 - 20);
    g.fillStyle = '#7fd4ff';
    g.font = 'bold 26px Arial, sans-serif';
    const d = new Date();
    g.fillText(`${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} · Ready to drive`, w / 2, h / 2 + 62);
  }

  _placeCamera(dt) {
    const car = this.car, road = this.road;
    const p = road.sample(car.s);
    const px = p.x, pz = p.z, yaw = p.yaw;
    const x = px + car.d * Math.cos(yaw), z = pz - car.d * Math.sin(yaw);
    const y = this.world.heightAt(car.s, car.d);
    const pitch = Math.atan(road.slope(car.s));
    this.bodyRoll = damp(this.bodyRoll, clamp(-car.latAcc * 0.004, -0.035, 0.035), 6, dt);
    this.bodyPitch = damp(this.bodyPitch, clamp(car.longAcc * 0.004, -0.03, 0.02), 5, dt);
    this.rig.position.set(x, y, z);
    this.rig.rotation.set(pitch + this.bodyPitch, yaw + car.rel, this.bodyRoll);
    this.rig.updateMatrixWorld();
    if (this.camMode === 'chase') {
      this.fx.syncWreck(this.rig);
      this._chaseCam(dt);
      return;
    }

    const t = this.time;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    const rough = 0.0018 * Math.min(1, car.v / 25) + (car.offroad > 0 ? 0.012 : 0) + (car.scrape ? 0.012 : 0);
    const bx = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.5 * (rough * 0.6 + sh * 0.03);
    const by = (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 17.9) * 0.4) * (rough + sh * 0.04);
    const cc = this.cockpit.camera;
    cc.position.set(bx, by, 0);
    cc.rotation.set(-7.5 * DEG + by * 0.6 + Math.sin(t * 29.3) * sh * 0.035, bx * 0.4 + Math.sin(t * 31.7) * sh * 0.035, Math.sin(t * 27.1) * sh * 0.045);
    cc.updateMatrixWorld();

    this.tmpV.set(this.eye.x + bx, this.eye.y + by, this.eye.z).applyMatrix4(this.rig.matrixWorld);
    this.camera.position.copy(this.tmpV);
    this.camera.quaternion.copy(this.rig.quaternion).multiply(cc.quaternion);
    this.camera.updateMatrixWorld();
    this.camPos.copy(this.camera.position);
    this.camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(this.rig.quaternion);
    const hl = new THREE.Vector3(0, 0.75, -2.3).applyMatrix4(this.rig.matrixWorld);
    this.world.setHeadlight(hl, fwd);

    const mc = this.cockpit.mirrorCam;
    mc.position.set(0, 1.32, -0.3).applyMatrix4(this.rig.matrixWorld);
    mc.quaternion.copy(this.rig.quaternion).multiply(this.flipQ);
    mc.updateMatrixWorld();
  }

  render() {
    const r = this.renderer;
    const fp = this.camMode === 'fp';
    if (fp && this.frame % 2 === 0) {
      r.setRenderTarget(this.cockpit.mirrorRT);
      r.clear();
      r.render(this.world.scene, this.cockpit.mirrorCam);
      r.setRenderTarget(null);
    }
    r.clear();
    r.render(this.world.scene, this.camera);
    if (fp) {
      r.clearDepth();
      r.render(this.cockpit.scene, this.cockpit.camera);
    }
  }

  loop = (now) => {
    requestAnimationFrame(this.loop);
    const raw = now - this.last;
    this.last = now;
    const dt = Math.min(0.05, Math.max(0.001, raw / 1000));
    this.time += dt;
    this.frame++;
    this.input.update(dt);
    this.update(dt);
    this.render();
    this._adapt(raw, dt);
  };

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  _adapt(rawMs, dt) {
    if (this.state !== 'playing' || rawMs > 250) return;
    this.frameMs = lerp(this.frameMs, rawMs, 0.05);
    if (this.frameMs > 24 && this.pixelRatio > 1) {
      this.slowT += dt;
      if (this.slowT > 2) {
        this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
        this.resize();
        this.slowT = 0;
        this.frameMs = 16;
      }
    } else this.slowT = 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    let fov = 56;
    if (aspect < 1.6) fov = Math.min(74, (2 * Math.atan(Math.tan(44 * DEG) / aspect)) / DEG);
    const hf = (2 * Math.atan(Math.tan((fov * DEG) / 2) * aspect)) / DEG;
    if (hf > 106) fov = (2 * Math.atan(Math.tan(53 * DEG) / aspect)) / DEG;
    for (const cam of [this.camera, this.cockpit.camera]) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    this.ui.resize();
    const portrait = this.input.isTouch && h > w;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.ui.rotate(portrait);
      if (portrait && this.state === 'playing') this.pause();
    }
  }

  onVisibility() {
    if (document.hidden) {
      if (this.state === 'playing') this.pause();
      this.audio.suspend();
    } else {
      if (this.state !== 'paused') this.audio.resume();
      if (this.state === 'playing' || this.state === 'calib') this.requestWake();
    }
  }

  async requestWake() {
    try {
      if ('wakeLock' in navigator && !this.wake) {
        this.wake = await navigator.wakeLock.request('screen');
        this.wake.addEventListener('release', () => (this.wake = null));
      }
    } catch (_) {
      this.wake = null;
    }
  }

  releaseWake() {
    try {
      if (this.wake) this.wake.release();
    } catch (_) {
      /* ignore */
    }
    this.wake = null;
  }
}
