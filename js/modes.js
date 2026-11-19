// Game modes. Each mode owns spawning, deer/traffic behavior, scoring, HUD
// data, and what the car's center touchscreen shows.
import { mulberry32, rand, pick, weighted, clamp, fmt, MPH, damp } from './util.js';
import { randomKind, Deer } from './deer.js';
import { STATIONS } from './audio.js';
import { COMIC_FONT } from './textures.js';

const CLOSE = ['CLOSE CALL!', 'WHEW!', 'OH DEER!', 'SO CLOSE!', 'NOT TODAY!', 'NICE DODGE!'];
const BONK_QUIPS = ['RUDE.', 'HEY!!', 'Watch it, lady!', 'I was here first!', 'Unbelievable.', 'Ow. Ow. OW.', 'Not cool!', "You'll hear from my lawyer", 'I had the right of way!'];
const BUCK_QUIPS = ['My antlers!', 'Do you know who I am?!'];
const FAWN_QUIPS = ["I'm telling my mom!", 'MOMMM!'];
const BLAST_QUIPS = ["I'M OKAAAY!", 'WHEEEEE!', 'BYEEEEE!'];
const EXCUSE = ['Pardon me!', 'Coming through!', 'Wheee!', "Excuse me, ma'am!", 'Lovely day!', 'Nice Honda!'];
const LEVELS = ['', 'More deer than usual tonight…', 'The deer are getting bolder', 'Rush hour (for deer)', "It's deer o'clock", 'The deer have unionized', 'Absolute deer chaos'];
const DODGE_OVER = [
  'The deer have filed a formal complaint.',
  'Your insurance agent just sighed audibly.',
  'Somewhere, a deer is telling this story at a party.',
  'The deer would like to see your license and registration.',
  'Three bonks. One KABOOM. Zero Hondas.',
  'The Deer Council thanks you for your participation.',
];
const CRASH_TITLES = {
  tree: 'THAT WAS A TREE, NOT A DEER',
  rock: 'THAT WAS A ROCK, NOT A DEER',
  post: 'THE ROADSIDE POST WINS',
  sign: 'YOU HIT THE SIGN',
  forest: 'THE FOREST WINS',
  barrier: "THE DEER DIDN'T EVEN HAVE TO TRY",
  guardrail: "THE DEER DIDN'T EVEN HAVE TO TRY",
};
const CRASH_QUIPS = [
  'The deer saw the whole thing.',
  'Somewhere, a deer is slow-clapping.',
  'Technically, you avoided the deer.',
  "In fairness, it didn't move.",
  'The deer would like it noted that this one was not their fault.',
];
const REVENGE_OVER = [
  'They just wanted to talk. Mostly.',
  'The herd has been avenged. They were very polite about it.',
  "You've been served. By deer.",
  'The deer would like a word. Several words.',
];
const SHOUTS = ['THERE SHE IS!', 'AFTER HER!', 'WE JUST WANNA TALK!', "PULL OVER, MA'AM!", 'NICE HONDA. SHAME IF SOMETHING HAPPENED TO IT', 'WE HAVE QUESTIONS!'];

const tta = (g, deer) => (deer.s - g.car.s - 2.2) / Math.max(g.car.v, 2);
const nearestLane = (d, lanes) => lanes.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));

function screenFrame(g, w, h, title, accent = '#7fd4ff') {
  g.fillStyle = '#070b12';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#121b28';
  g.fillRect(0, 0, w, 46);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = accent;
  g.font = 'bold 25px Arial, sans-serif';
  g.fillText(title, 16, 24);
  const d = new Date();
  g.textAlign = 'right';
  g.fillStyle = '#cfe3ff';
  g.fillText(`${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`, w - 16, 24);
}

function heart(g, x, y, s, fill) {
  g.save();
  g.translate(x, y);
  g.scale(s / 32, s / 32);
  g.beginPath();
  g.moveTo(16, 29);
  g.bezierCurveTo(-6, 14, 2, -2, 16, 8);
  g.bezierCurveTo(30, -2, 38, 14, 16, 29);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

// Shared crossing step: walk/trot/bound toward data.targetD.
function crossStep(deer) {
  const D = deer.data;
  const dir = Math.sign(D.targetD - deer.d) || 1;
  deer.faceSide(dir);
  deer.speed = D.speed;
  deer.gait = D.gait;
  deer.tailUp = D.gait === 'bound';
  deer.look = false;
  deer.headPitchT = -0.1;
  if (D.stopAt != null && !D.stopped && (dir > 0 ? deer.d >= D.stopAt : deer.d <= D.stopAt)) {
    D.stopped = true;
    deer.setState('pause');
    deer.speed = 0;
    deer.gait = 'stand';
    deer.look = true;
    return;
  }
  if ((dir > 0 && deer.d >= D.targetD) || (dir < 0 && deer.d <= D.targetD)) deer.setState('leave');
}

function fleeDeer(deer, rng, speed = 7.5) {
  const side = Math.sign(deer.d) || (rng() < 0.5 ? -1 : 1);
  deer.data.targetD = side * 40;
  deer.data.speed = speed;
  deer.data.gait = 'bound';
  deer.faceSide(side);
  deer.speed = speed;
  deer.gait = 'bound';
  deer.tailUp = true;
  deer.look = false;
  deer.headPitchT = -0.1;
  deer.setState('leave');
}

// ---------------------------------------------------------------------------
export class DodgeMode {
  static key = 'dodge';
  static theme = 'dusk';
  static title = 'Deer Dodge';
  static icon = '🦌';
  static desc = "Dodge the deer. Don't bonk. Beat your high score.";
  static road = { minRadius: 230, maxRadius: 650, turnMin: 0.25, turnMax: 1.0, hillAmp: 7 };
  static crash = true; // hitting anything off the road blows up the car

  constructor(g) {
    this.g = g;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.warn = false;
  }

  start() {
    const g = this.g;
    g.deer.clear();
    this.lives = 3;
    this.score = 0;
    this.s0 = g.car.s;
    this.level = 0;
    this.closeCalls = 0;
    this.dodged = 0;
    this.combo = 0;
    this.comboT = 0;
    this.nextS = g.car.s + 170;
    this.invuln = 0;
    this.hornCD = 0;
    this.warnCD = 0;
    this.events = 0;
    this.groupTip = false;
    this.firstTip = false;
    this.offTip = false;
    this.blasted = null;
    this.twinkled = false;
    this.cruise = 20;
  }

  carParams() {
    return { cruise: this.cruise, vmax: 42 };
  }

  quip(deer) {
    const r = this.rng;
    if (deer.kind === 'fawn' && r() < 0.7) return pick(r, FAWN_QUIPS);
    if (deer.kind === 'buck' && r() < 0.35) return pick(r, BUCK_QUIPS);
    return pick(r, BONK_QUIPS);
  }

  mkCrosser(s, side, o = {}) {
    const g = this.g, r = this.rng;
    const startD = o.start != null ? o.start : side * rand(r, 7.0, 9.5);
    const deer = g.deer.spawn(o.kind || randomKind(r), s, startD, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const speed = o.speed != null ? o.speed : rand(r, 3.8, 5.0);
    const jit = o.jitter || [-0.25, 0.35];
    deer.setState('wait');
    deer.data = {
      threat: false, speed, gait: o.gait || (speed > 5.6 ? 'bound' : 'trot'),
      targetD: -side * rand(r, 7.5, 10), startD,
      stopAt: o.stopAt != null ? o.stopAt : null, stopTime: o.stopTime || 0, turnBack: !!o.turnBack,
      jitter: rand(r, jit[0], jit[1]), started: false, crossClock: 0,
    };
    deer.headPitchT = 0.9;
    return deer;
  }

  mkFollower(lead, s, side, delay) {
    const r = this.rng;
    const deer = this.mkCrosser(s, side, { speed: lead.data.speed * rand(r, 0.9, 1.1), gait: lead.data.gait, kind: pick(r, ['doe', 'fawn', 'doe', 'buck']) });
    deer.setState('follow');
    deer.data.leader = lead;
    deer.data.delay = delay;
    deer.d = deer.data.startD = side * rand(r, 7.5, 10.5);
    return deer;
  }

  spawnEvent(sE) {
    const g = this.g, r = this.rng, L = this.level;
    const lanes = g.roadSpec.lanes;
    this.events++;
    const type = this.events === 1
      ? 'stander'
      : weighted(r, [['watch', L < 2 ? 22 : 12], ['stander', L < 1 ? 28 : 14], ['cross', 38], ['group', L >= 1 ? 18 : 0], ['fake', L >= 2 ? 13 : 0], ['leap', L >= 2 ? 12 : 0], ['herd', L >= 4 ? 9 : 0]]);
    const side = r() < 0.5 ? -1 : 1;
    const crossSpeed = () => (L < 2 ? rand(r, 3.6, 4.6) : rand(r, 4.2, 6.5));
    switch (type) {
      case 'watch': {
        const n = r() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const deer = g.deer.spawn(randomKind(r), sE + i * 3, side * rand(r, 6.8, 11), side > 0 ? Math.PI / 2 : -Math.PI / 2);
          deer.setState('watch');
          deer.data = { threat: false };
        }
        break;
      }
      case 'stander': {
        const d = (this.events === 1 || r() < 0.6 ? nearestLane(g.car.d, lanes) : pick(r, lanes)) + rand(r, -0.4, 0.4);
        const deer = g.deer.spawn(randomKind(r), sE, d, Math.PI + rand(r, -0.7, 0.7));
        deer.setState('stare');
        deer.look = true;
        deer.data = { threat: true, bolt: this.events > 1 && r() < 0.5, boltTTA: rand(r, 0.9, 1.5) };
        break;
      }
      case 'cross':
        this.mkCrosser(sE, side, { speed: crossSpeed() });
        break;
      case 'group': {
        const lead = this.mkCrosser(sE, side, { speed: crossSpeed() });
        const n = 1 + (r() < 0.5 ? 1 : 0) + (L >= 3 && r() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) this.mkFollower(lead, sE + rand(r, -5, 5), side, 0.8 + i * rand(r, 0.6, 1.0));
        if (!this.groupTip) {
          this.groupTip = true;
          this.pendingGroupTip = lead;
        }
        break;
      }
      case 'fake':
        this.mkCrosser(sE, side, { speed: crossSpeed(), stopAt: nearestLane(g.car.d, lanes) + rand(r, -0.3, 0.3), stopTime: rand(r, 0.6, 1.1), turnBack: r() < 0.4 });
        break;
      case 'leap':
        this.mkCrosser(sE, side, { speed: rand(r, 8, 9.5), gait: 'bound', start: side * rand(r, 5.8, 6.8), jitter: [-0.1, 0.2] });
        break;
      case 'herd': {
        const lead = this.mkCrosser(sE, side, { speed: 5.6, gait: 'bound' });
        const n = 2 + Math.floor(r() * 3);
        for (let i = 1; i <= n; i++) this.mkFollower(lead, sE + rand(r, -7, 7), side, i * rand(r, 0.45, 0.7));
        break;
      }
    }
  }

  think(deer, dt) {
    const g = this.g, car = g.car, D = deer.data, r = this.rng;
    const t = tta(g, deer), ahead = deer.s - car.s;
    if (Math.abs(deer.d) < 4.8) D.threat = true;
    if (D.started) D.crossClock += dt;
    if (D.scareT != null) {
      D.scareT -= dt;
      if (D.scareT <= 0) {
        D.scareT = null;
        if (!deer.hit) fleeDeer(deer, r);
      }
    }
    switch (deer.state) {
      case 'watch':
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = ahead < 170;
        deer.headPitchT = deer.look ? -0.1 : 0.9;
        break;
      case 'stare':
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = true;
        deer.headPitchT = -0.12;
        if (D.bolt && t < D.boltTTA) {
          D.targetD = (Math.sign(deer.d) || 1) * 9;
          D.speed = 7;
          D.gait = 'bound';
          D.started = true;
          deer.setState('cross');
        }
        break;
      case 'wait': {
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = ahead < 140;
        deer.headPitchT = deer.look ? -0.1 : 0.9;
        const tReach = Math.abs(deer.d - car.d) / D.speed;
        if (ahead > 0 && t <= Math.max(1.05, tReach + D.jitter)) {
          D.started = true;
          deer.setState('cross');
        }
        break;
      }
      case 'follow': {
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = ahead < 140;
        deer.headPitchT = deer.look ? -0.1 : 0.9;
        const L = D.leader;
        if (!L || (L.data.started && L.data.crossClock >= D.delay)) {
          D.started = true;
          deer.setState('cross');
        }
        break;
      }
      case 'cross':
        crossStep(deer);
        break;
      case 'pause':
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = true;
        if (deer.t > D.stopTime) {
          if (D.turnBack) {
            const tmp = D.targetD;
            D.targetD = D.startD;
            D.startD = tmp;
          }
          D.stopAt = null;
          deer.setState('cross');
        }
        break;
      case 'leave':
        deer.faceSide(Math.sign(deer.d) || 1);
        deer.speed = Math.max(D.speed || 4, 3.5);
        deer.gait = D.gait === 'bound' ? 'bound' : 'trot';
        deer.tailUp = true;
        break;
      case 'dazed':
        deer.speed = 0;
        deer.gait = 'stand';
        if (deer.t > 2.0) {
          D.speed = 3.6;
          D.gait = 'trot';
          deer.setState('leave');
        }
        break;
      default:
        break;
    }
  }

  bonk(deer) {
    const g = this.g, car = g.car, r = this.rng;
    deer.hit = true;
    const away = Math.sign(deer.d - car.d) || (r() < 0.5 ? -1 : 1);
    deer.setState('bonked');
    deer.speed = 0;
    deer.gait = 'stand';
    deer.look = false;
    deer.data.scareT = null;
    if (this.invuln > 0) {
      deer.vd = away * 7;
      deer.vs = car.v + 2;
      deer.jump(5);
      deer.onLand = () => fleeDeer(deer, r);
      return;
    }
    this.lives--;
    this.combo = 0;
    if (this.lives <= 0) {
      // Last heart: the deer is launched off into the sky (it's fine!) and the
      // car keeps rolling and blows up. No BONK pop; the KABOOM is coming.
      deer.blastOff(g.road, car.v);
      deer.say(pick(r, BLAST_QUIPS), 3.1);
      this.blasted = deer;
      g.audio.bonk();
      g.endRun('bonk');
      return;
    }
    this.invuln = 2.2;
    car.v *= 0.35;
    deer.vs = car.v + 3.5;
    deer.vd = away * rand(r, 5.5, 8);
    deer.jump(rand(r, 5, 6.5));
    deer.spin = rand(r, 4, 8) * (r() < 0.5 ? -1 : 1);
    deer.roll = away * 1.1;
    deer.onLand = () => {
      deer.setState('dazed');
      deer.dizzy(2.1);
      deer.say(this.quip(deer), 2.6);
      g.audio.snort();
    };
    g.bonkFx(deer.group.position, true);
    if (!g.store.data.tips.honk) {
      g.store.data.tips.honk = true;
      g.store.save();
      setTimeout(() => g.toast('Tip: tap HONK to scare deer off the road', 'tip', 3800), 1600);
    }
  }

  // During the crash: the launched deer climbs on past the KABOOM, and once it
  // is a speck high in the sky it twinkles out.
  ending(dt, endT) {
    const d = this.blasted;
    if (!d || this.twinkled) return;
    this.g.skyFollow(d.group.position); // the crash camera tilts up to watch it go
    if (d.flyT > 3.3 || d.camDist > 160) {
      this.twinkled = true;
      this.twinkleAt = endT;
      this.g.fx.twinkle(d.group.position, this.g.camPos);
      this.g.audio.twinkle();
      this.g.deer.release(d);
    }
  }

  // Knocking over a sign or marker post costs one heart; losing the last one
  // that way blows the car up like any other crash. A short grace period
  // after a hit keeps two posts in a row from costing two hearts.
  hitRoadside(ob) {
    const g = this.g;
    if (this.invuln > 0) return;
    this.lives--;
    this.combo = 0;
    if (this.lives <= 0) {
      g.crash(ob.kind, ob);
      return;
    }
    this.invuln = 1.5;
    g.car.v *= 0.7;
    g.ui.setHud(this.hud());
    g.roadsideFx(ob.kind);
  }

  // Earliest time the game-over card may appear: after the twinkle has played.
  endHold() {
    if (!this.blasted) return 0;
    return this.twinkled ? this.twinkleAt + 1.0 : Infinity;
  }

  onHorn() {
    const g = this.g, r = this.rng;
    g.audio.honk();
    if (this.hornCD > 0) return;
    this.hornCD = 3.5;
    for (const deer of g.deer.active) {
      if (deer.hit) continue;
      const ahead = deer.s - g.car.s;
      if (ahead > 22 && ahead < 95 && Math.abs(deer.d) < 11 && deer.state !== 'leave') deer.data.scareT = rand(r, 0.2, 0.55);
      else if (ahead > 0 && ahead <= 22 && deer.state === 'cross') {
        // too close: deer-in-the-headlights freeze
        deer.data.stopAt = deer.d;
        deer.data.stopped = false;
        deer.data.stopTime = 0.6;
        deer.data.turnBack = false;
      }
    }
  }

  update(dt) {
    const g = this.g, car = g.car, r = this.rng;
    const dist = car.s - this.s0;
    const lvl = Math.floor(dist / 700);
    if (lvl > this.level) {
      this.level = lvl;
      g.toast(`LEVEL ${lvl + 1}: ${LEVELS[Math.min(lvl, LEVELS.length - 1)]}`, 'level', 3000);
      g.audio.levelUp();
    }
    this.cruise = Math.min(33, 20 + this.level * 1.7);
    if (!this.offTip && car.offroad > 0.3) {
      this.offTip = true;
      g.toast('Careful! Trees and rocks off the road mean KABOOM 💥', 'warn', 2800);
    }
    while (car.s + 230 > this.nextS) {
      this.spawnEvent(this.nextS);
      this.nextS += Math.max(110, 255 - 24 * this.level) + rand(r, 0, 70);
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hornCD -= dt;
    this.warnCD -= dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;

    let warn = false;
    for (const deer of [...g.deer.active]) {
      this.think(deer, dt);
      const D = deer.data;
      const ds = deer.s - car.s, dd = deer.d - car.d;
      const k = deer.K.scale;
      const c = Math.abs(Math.cos(deer.rYaw)), sn = Math.abs(Math.sin(deer.rYaw));
      const es = (c * 0.75 + sn * 0.22) * k, ed = (sn * 0.75 + c * 0.22) * k;
      if (!deer.hit && deer.y < 0.9 && Math.abs(ds) < 2.2 + es && Math.abs(dd) < 0.9 + ed) {
        this.bonk(deer);
        if (g.state !== 'playing') return;
      }
      if (!deer.hit && ds > 2 && ds < Math.max(30, car.v * 2.0) && Math.abs(deer.d) < 5.2 && Math.abs(dd) < 2.6) warn = true;
      if (!this.firstTip && ds < 110 && ds > 0 && D.threat) {
        this.firstTip = true;
        g.toast(g.input.mode === 'tilt' ? 'Tilt to steer around the deer!' : 'Steer around the deer!', 'tip', 2800);
      }
      if (this.pendingGroupTip === deer && D.started && ds < 90) {
        this.pendingGroupTip = null;
        g.toast("Where there's one deer, there's usually more!", 'tip', 3200);
      }
      if (!deer.passed && ds < -3.2) {
        deer.passed = true;
        if (!deer.hit && D.threat) {
          this.dodged++;
          this.score += 50;
          const gap = Math.abs(dd) - (0.9 + ed);
          if (gap < 1.3) {
            this.combo++;
            this.comboT = 6;
            this.closeCalls++;
            const pts = 150 * this.combo;
            this.score += pts;
            g.toast(`${pick(r, CLOSE)} +${pts}${this.combo > 1 ? `  x${this.combo}` : ''}`, 'good', 1600);
            g.audio.closeCall();
          }
        }
      }
      if (ds < -60 || Math.abs(deer.d) > 26) g.deer.release(deer);
    }
    if (warn && !this.warn && this.warnCD <= 0) {
      g.audio.beep();
      this.warnCD = 1.6;
    }
    this.warn = warn;
    this.score += car.v * dt * Math.max(1, car.v / 22) * 0.5;
  }

  hud() {
    const car = this.g.car;
    return {
      score: fmt(this.score),
      sub: `${((car.s - this.s0) / 1609.34).toFixed(2)} mi · ${Math.round(car.v * MPH)} mph`,
      lives: this.lives,
      maxLives: 3,
    };
  }

  drawScreen(g, w, h) {
    const G = this.g;
    screenFrame(g, w, h, 'DEER RADAR', '#ffb347');
    const x0 = 18, y0 = 56, rw = 236, rh = 222;
    g.fillStyle = '#0b1712';
    g.fillRect(x0, y0, rw, rh);
    const X = (d) => x0 + rw / 2 + d * (rw / 22);
    const Y = (ds) => y0 + rh - 22 - ds * ((rh - 34) / 140);
    g.fillStyle = '#2a3832';
    g.fillRect(X(-4.8), y0 + 4, X(4.8) - X(-4.8), rh - 8);
    g.fillStyle = '#d8b02a';
    g.fillRect(X(0) - 1.5, y0 + 4, 3, rh - 8);
    g.strokeStyle = 'rgba(127,212,255,0.25)';
    g.lineWidth = 2;
    for (const ring of [40, 80, 120]) {
      g.beginPath();
      g.moveTo(x0 + 4, Y(ring));
      g.lineTo(x0 + rw - 4, Y(ring));
      g.stroke();
    }
    for (const deer of G.deer.active) {
      const ds = deer.s - G.car.s;
      if (ds < -6 || ds > 140 || Math.abs(deer.d) > 11) continue;
      g.fillStyle = deer.hit ? '#777' : Math.abs(deer.d) < 4.8 ? '#ff6b1a' : '#ffd36a';
      g.beginPath();
      g.arc(X(deer.d), Y(ds), 8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(X(G.car.d) - 7, Y(0) - 11, 14, 22);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 24px Arial, sans-serif';
    g.fillText('DODGED', 278, 92);
    g.fillStyle = '#ffffff';
    g.font = `66px ${COMIC_FONT}`;
    g.fillText(String(this.dodged), 278, 156);
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 24px Arial, sans-serif';
    g.fillText('LIVES', 278, 206);
    for (let i = 0; i < 3; i++) heart(g, 278 + i * 46, 220, 40, i < this.lives ? '#ff4d6d' : '#3a3f47');
  }

  results() {
    const g = this.g, car = g.car;
    const crashed = g.endReason === 'crash';
    return {
      title: crashed ? CRASH_TITLES[g.crashKind] || 'KABOOM.' : 'THE DEER WIN THIS ROUND',
      score: Math.round(this.score),
      stats: [
        ['Distance', `${((car.s - this.s0) / 1609.34).toFixed(2)} mi`],
        ['Deer dodged', String(this.dodged)],
        ['Close calls', String(this.closeCalls)],
        ['Level', String(this.level + 1)],
      ],
      quip: pick(this.rng, crashed ? CRASH_QUIPS : DODGE_OVER),
    };
  }
}

// ---------------------------------------------------------------------------
export class ChillMode {
  static key = 'chill';
  static theme = 'day';
  static title = 'Chill Cruise';
  static icon = '🌲';
  static desc = 'No score, no way to lose. Just you, the Honda, and the radio.';
  static road = { minRadius: 260, maxRadius: 800, turnMin: 0.25, turnMax: 0.9, hillAmp: 9 };
  static crash = false; // no way to lose: the car just bumps off things

  constructor(g) {
    this.g = g;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.warn = false;
    this.station = 0;
  }

  start() {
    const g = this.g;
    g.deer.clear();
    this.s0 = g.car.s;
    this.spotted = 0;
    this.nextS = g.car.s + 110;
    this.songIdx = Math.floor(this.rng() * 4);
    this.songT = 0;
    g.audio.startRadio(this.station < STATIONS.length ? this.station : -1);
  }

  stop() {
    this.g.audio.stopRadio();
  }

  carParams() {
    return { cruise: 17, vmax: 38 };
  }

  nextStation() {
    this.station = (this.station + 1) % (STATIONS.length + 1);
    this.songIdx = Math.floor(this.rng() * 4);
    this.songT = 0;
    this.g.audio.startRadio(this.station < STATIONS.length ? this.station : -1);
  }

  spawn(s) {
    const g = this.g, r = this.rng, side = r() < 0.5 ? -1 : 1;
    if (r() < 0.3) {
      const deer = g.deer.spawn(randomKind(r), s, side * rand(r, 8, 10), side > 0 ? Math.PI / 2 : -Math.PI / 2);
      deer.setState('ccross');
      deer.data = { targetD: -side * rand(r, 10, 14), speed: rand(r, 3.0, 4.2), gait: 'walk' };
      deer.data.gait = deer.data.speed > 3.6 ? 'trot' : 'walk';
      deer.headPitchT = 0.9;
    } else {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const deer = g.deer.spawn(i === 2 ? 'fawn' : randomKind(r), s + rand(r, -6, 6), side * rand(r, 9, 22), rand(r, -3.1, 3.1));
        deer.setState('graze');
        deer.headPitchT = 0.95;
        deer.data = { lookT: rand(r, 1, 4) };
      }
    }
  }

  think(deer, dt) {
    const g = this.g, car = g.car, D = deer.data, r = this.rng;
    const ahead = deer.s - car.s, dd = deer.d - car.d;
    // Deer in Chill Cruise always get out of the way, by leaping over the car if they have to.
    if (!deer.airborne && deer.state !== 'evade' && ahead > -1.5 && ahead < car.v * 0.9 + 5 && Math.abs(dd) < 2.4) {
      const away = Math.sign(dd) || (r() < 0.5 ? -1 : 1);
      if (ahead < car.v * 0.45 + 3.5) {
        deer.jump(8.6);
        deer.say(pick(r, EXCUSE), 2.2);
      }
      D.speed = 8;
      D.gait = 'bound';
      deer.faceSide(away);
      deer.speed = 8;
      deer.gait = 'bound';
      deer.tailUp = true;
      deer.setState('evade');
      return;
    }
    switch (deer.state) {
      case 'graze':
        deer.speed = 0;
        deer.gait = 'stand';
        D.lookT -= dt;
        if (D.lookT < 0) {
          deer.headPitchT = deer.headPitchT > 0.5 ? -0.05 : 0.95;
          D.lookT = rand(r, 1.5, 4);
        }
        if (ahead < 70 && ahead > -10) deer.setState('alert');
        break;
      case 'alert':
        deer.headPitchT = -0.1;
        deer.look = true;
        deer.speed = 0;
        deer.gait = 'stand';
        if (ahead < 28 && Math.abs(deer.d) < 15 && !D.decided) {
          D.decided = true;
          if (r() < 0.5) fleeDeer(deer, r, 7);
        }
        break;
      case 'ccross':
        deer.speed = 0;
        deer.gait = 'stand';
        deer.look = ahead < 150;
        deer.headPitchT = deer.look ? -0.1 : 0.9;
        if (ahead > 0 && tta(g, deer) < 6.5) deer.setState('cross');
        break;
      case 'cross':
        crossStep(deer);
        break;
      case 'leave':
      case 'evade':
        deer.faceSide(Math.sign(deer.d - (deer.state === 'evade' ? car.d : 0)) || 1);
        deer.speed = D.speed || 5;
        deer.gait = D.gait === 'walk' ? 'walk' : D.gait || 'bound';
        deer.tailUp = deer.gait !== 'walk';
        break;
      default:
        break;
    }
  }

  onHorn() {
    const g = this.g, r = this.rng;
    g.audio.honk();
    for (const deer of g.deer.active) {
      const ahead = deer.s - g.car.s;
      if (ahead > 0 && ahead < 90 && Math.abs(deer.d) < 25 && deer.state !== 'evade' && deer.state !== 'leave') fleeDeer(deer, r, 7);
    }
  }

  update(dt) {
    const g = this.g, car = g.car, r = this.rng;
    while (car.s + 260 > this.nextS) {
      this.spawn(this.nextS);
      this.nextS += rand(r, 140, 320);
    }
    this.songT += dt;
    if (this.songT > 75) {
      this.songT = 0;
      this.songIdx++;
    }
    for (const deer of [...g.deer.active]) {
      this.think(deer, dt);
      const ds = deer.s - car.s;
      if (!deer.counted && ds < -2 && Math.abs(deer.d) < 40) {
        deer.counted = true;
        this.spotted++;
      }
      if (ds < -60 || Math.abs(deer.d) > 45) g.deer.release(deer);
    }
  }

  hud() {
    const car = this.g.car;
    const st = STATIONS[this.station];
    return {
      score: `${((car.s - this.s0) / 1609.34).toFixed(1)} mi`,
      sub: `${Math.round(car.v * MPH)} mph · deer spotted: ${this.spotted}`,
      radio: st ? `📻 ${st.name}` : '📻 Radio off',
    };
  }

  drawScreen(g, w, h) {
    const st = STATIONS[this.station];
    screenFrame(g, w, h, 'AUDIO', '#7fd4ff');
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    if (!st) {
      g.fillStyle = '#5f7187';
      g.font = `56px ${COMIC_FONT}`;
      g.fillText('RADIO OFF', 26, 170);
      g.font = 'bold 22px Arial, sans-serif';
      g.fillText('Tap 📻 to turn it on', 28, 214);
      return;
    }
    g.fillStyle = '#ffffff';
    g.font = `72px ${COMIC_FONT}`;
    g.fillText(st.freq, 24, 128);
    g.fillStyle = '#7fd4ff';
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText(st.name.replace(/ [\d.]+$/, ''), 196, 98);
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 20px Arial, sans-serif';
    g.fillText(st.sub, 196, 126);
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px Arial, sans-serif';
    g.fillText(`♪ ${st.songs[this.songIdx % st.songs.length]}`, 24, 182);
    const t = performance.now() / 1000;
    for (let i = 0; i < 22; i++) {
      const v = 0.3 + 0.7 * Math.abs(Math.sin(t * (2 + (i % 5)) + i * 1.7));
      g.fillStyle = i % 2 ? '#2f8cff' : '#48d1ff';
      g.fillRect(24 + i * 21, 270 - v * 60, 15, v * 60);
    }
  }
}

// ---------------------------------------------------------------------------
export class RevengeMode {
  static key = 'revenge';
  static theme = 'twilight';
  static title = 'Deer Revenge';
  static icon = '😤';
  static desc = "The deer want a word with you. Weave through traffic and don't let the herd catch up.";
  static road = { minRadius: 700, maxRadius: 1600, turnMin: 0.15, turnMax: 0.5, hillAmp: 4, straightMin: 150, straightMax: 500 };
  static crash = true; // the median barrier and guardrail end the run

  constructor(g) {
    this.g = g;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.warn = false;
  }

  start() {
    const g = this.g, car = g.car, r = this.rng;
    g.deer.clear();
    g.traffic.clear();
    this.s0 = car.s;
    this.elapsed = 0;
    this.score = 0;
    this.passes = 0;
    this.bumps = 0;
    this.herdS = car.s - 150;
    this.herdV = 24.5;
    this.gap = 150;
    this.nextTraffic = car.s + 120;
    this.invuln = 0;
    this.shoutCD = 2;
    this.warnedClose = false;
    this.hood = null;
    this.herd = [];
    const formation = [[0, -3], [-2.5, 2.6], [-4, 0], [-5.5, -5], [-7, 4.6], [-8.5, -1.6], [-10, 1.8], [-12, -3.6]];
    for (const [os, d] of formation) {
      const deer = g.deer.spawn('angry', this.herdS + os, d, 0);
      deer.locked = true;
      deer.gait = 'bound';
      deer.tailUp = true;
      deer.hopH = 0.75;
      deer.setState('herd');
      deer.data = { os, d0: d, ph: rand(r, 0, 6.28) };
      this.herd.push(deer);
    }
    g.audio.snort();
    g.toast('The herd is coming. Floor it!', 'warn', 2600);
  }

  carParams() {
    return { cruise: 29, vmax: 47 };
  }

  spawnTraffic(s) {
    const g = this.g, r = this.rng, lanes = g.roadSpec.lanes;
    const near = g.traffic.active.filter((t) => Math.abs(t.s - s) < 20);
    const free = lanes.filter((l) => !near.some((t) => Math.abs(t.d - l) < 1.6));
    if (free.length <= 1 && near.length >= 2) return;
    const lane = pick(r, free.length ? free : lanes);
    g.traffic.spawn(s, lane, rand(r, 18, 25.5), r);
  }

  crash(tc) {
    const g = this.g, car = g.car, r = this.rng;
    this.invuln = 1.2;
    this.bumps++;
    car.v *= 0.5;
    const push = Math.sign(car.d - tc.d) || 1;
    car.d += push * 0.35;
    car.rel = -push * 0.06;
    tc.v *= 0.85;
    tc.hitPlayer = true;
    g.bonkFx(tc.group.position, false);
    setTimeout(() => g.audio.honk(0.55, 0.8), 250);
    g.toast(pick(r, ['Sorry!', 'Oops!', 'My bad!', 'Insurance will cover it!']), 'warn', 1300);
  }

  // Cars never sit inside each other: shove the traffic car clear of the
  // player along whichever way it overlaps least. A side swipe pushes it
  // over (toward the next lane away from you); a nose-to-tail bump pushes it
  // ahead or behind and matches speeds.
  separate(tc, ds, dd, overS, overD) {
    const car = this.g.car, lanes = this.g.roadSpec.lanes;
    if (overD < overS) {
      const side = Math.sign(dd) || 1;
      const lo = lanes[0] - 0.6, hi = lanes[lanes.length - 1] + 0.6;
      tc.d = clamp(tc.d + side * (overD + 0.05), lo, hi);
      const away = lanes.filter((l) => Math.sign(l - car.d) === side);
      tc.targetD = away.length
        ? away.reduce((a, b) => (Math.abs(b - tc.d) < Math.abs(a - tc.d) ? b : a))
        : clamp(tc.d, lo, hi);
    } else if (ds >= 0) {
      tc.s += overS + 0.05;
      tc.v = Math.max(tc.v, car.v);
    } else {
      tc.s -= overS + 0.05;
      tc.v = Math.min(tc.v, car.v);
    }
  }

  onHorn() {
    this.g.audio.honk();
  }

  update(dt) {
    const g = this.g, car = g.car, r = this.rng;
    this.elapsed += dt;
    this.herdV = Math.min(43, 24.5 + this.elapsed * 0.045);
    this.herdS += this.herdV * dt;
    this.gap = car.s - 2.2 - this.herdS;
    if (this.gap > 230) this.herdS += (this.gap - 230) * dt * 0.6;
    for (const deer of this.herd) {
      deer.s = this.herdS + deer.data.os;
      deer.d = deer.data.d0 + Math.sin(this.elapsed * 0.7 + deer.data.ph) * 1.2;
      deer.speed = this.herdV;
      deer.rYaw = deer.targetYaw = 0;
      if (!deer.airborne) {
        for (const tc of g.traffic.active) {
          const ds = tc.s - deer.s;
          if (ds > 0 && ds < 7 && Math.abs(tc.d - deer.d) < 1.6) {
            deer.jump(7);
            break;
          }
        }
      }
    }
    while (car.s + 300 > this.nextTraffic) {
      this.spawnTraffic(this.nextTraffic);
      this.nextTraffic += Math.max(36, 105 - this.elapsed * 0.35) + rand(r, 0, 40);
    }
    this.invuln -= dt;
    for (const tc of [...g.traffic.active]) {
      const ds = tc.s - car.s, dd = tc.d - car.d;
      const half = tc.len / 2 + 2.2;
      const overS = half - 0.2 - Math.abs(ds), overD = 1.82 - Math.abs(dd);
      if (overS > 0 && overD > 0) {
        if (this.invuln <= 0) this.crash(tc);
        this.separate(tc, ds, dd, overS, overD);
      }
      if (!tc.passed && ds < -half) {
        tc.passed = true;
        if (!tc.hitPlayer && Math.abs(dd) < 1.85 + 1.0) {
          this.passes++;
          this.score += 100;
          g.toast(`CLOSE PASS! +100`, 'good', 1200);
          g.audio.closeCall();
        }
      }
      if (ds < -150 || ds > 520) g.traffic.release(tc);
    }
    this.shoutCD -= dt;
    if (this.gap < 70 && !this.warnedClose) {
      this.warnedClose = true;
      g.toast('THE HERD IS GAINING!', 'warn', 2000);
      g.audio.snort();
    }
    if (this.gap > 110) this.warnedClose = false;
    if (this.gap < 45 && this.shoutCD <= 0) {
      this.shoutCD = rand(r, 2.5, 4.5);
      g.toast(`🦌 "${pick(r, SHOUTS)}"`, 'warn', 2000);
      g.audio.snort();
    }
    this.warn = this.gap < 30;
    this.score += car.v * dt * 0.5;
    if (this.gap <= 0) g.endRun('caught');
  }

  // Cutscene after being caught: the herd surrounds the car and one hops on the hood.
  ending(dt, t) {
    const g = this.g, car = g.car;
    const spots = [[-4.5, -2.7], [-2, 2.7], [0.5, -2.8], [2.5, 2.8], [4.2, -2.6], [-6.5, 1.0], [-7, -1.2], [5.5, 1.5]];
    this.herd.forEach((deer, i) => {
      const [os, od] = spots[i % spots.length];
      deer.s = damp(deer.s, car.s + os, 3, dt);
      deer.d = damp(deer.d, car.d + od, 3, dt);
      deer.speed = Math.max(0, deer.speed - dt * 25);
      if (deer.speed < 4) {
        deer.gait = 'stand';
        deer.look = true;
        deer.headPitchT = 0.1;
        deer.rYaw = deer.targetYaw = Math.atan2(-(car.d - deer.d), car.s - deer.s);
      }
    });
    if (g.endReason === 'caught' && t > 0.9 && !this.hood) {
      // One deer hops onto the hood and lowers its head to stare in at you.
      this.hood = new Deer('angry');
      this.hood.model.scale.setScalar(0.85);
      this.hood.headPitchT = 1.25;
      this.hood.camDist = 2;
      this.hood.bubbleX = 0.95;
      this.hood.bubbleY = 0.8;
      g.cockpit.setHoodDeer(this.hood);
      g.audio.bonk();
      g.shake = 0.8;
      this.hood.say('HELLO.', 3);
    }
    if (this.hood) {
      this.hood.animate(dt);
      this.hood.updateFx(dt);
      this.hood.eyeMat.opacity = 1;
      for (const e of this.hood.eyes) e.scale.setScalar(0.08);
    }
  }

  hud() {
    const car = this.g.car;
    return {
      score: fmt(this.score),
      sub: `${((car.s - this.s0) / 1609.34).toFixed(2)} mi · ${Math.round(car.v * MPH)} mph`,
      herd: Math.max(0, this.gap),
    };
  }

  drawScreen(g, w, h) {
    screenFrame(g, w, h, 'REAR RADAR', '#ff6b6b');
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 24px Arial, sans-serif';
    g.fillText('HERD DISTANCE', 24, 92);
    const gap = Math.max(0, this.gap);
    g.fillStyle = gap < 40 ? '#ff4d4d' : gap < 90 ? '#ffb347' : '#ffffff';
    g.font = `78px ${COMIC_FONT}`;
    g.fillText(`${Math.round(gap)} m`, 24, 172);
    const bx = 24, by = 204, bw = w - 48, bh = 48;
    g.fillStyle = '#1b2433';
    g.fillRect(bx, by, bw, bh);
    const f = clamp(gap / 200, 0, 1);
    g.fillStyle = gap < 40 ? '#ff4d4d' : '#ffb347';
    g.fillRect(bx, by, bw * f, bh);
    g.font = '34px Arial, sans-serif';
    g.fillText('🦌', bx + 6, by + 38);
    g.fillStyle = '#ffffff';
    g.fillRect(bx + bw - 30, by + 10, 22, 28);
  }

  results() {
    const g = this.g, car = g.car;
    const crashed = g.endReason === 'crash';
    return {
      title: crashed ? CRASH_TITLES[g.crashKind] || 'KABOOM.' : 'THE DEER GOT THEIR REVENGE',
      score: Math.round(this.score),
      stats: [
        ['Distance', `${((car.s - this.s0) / 1609.34).toFixed(2)} mi`],
        ['Close passes', String(this.passes)],
        ['Fender benders', String(this.bumps)],
        ['Survived', `${Math.round(this.elapsed)} s`],
      ],
      quip: pick(this.rng, crashed ? ['The herd sends their regards.', "They'll take it.", 'The deer are calling it a win.'] : REVENGE_OVER),
    };
  }
}

export const MODES = { dodge: DodgeMode, chill: ChillMode, revenge: RevengeMode };
