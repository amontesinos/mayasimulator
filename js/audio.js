// All sound is synthesized with Web Audio (no audio files): engine, road and
// wind noise, horn, cartoon BONK, close-call whoosh, and two procedural radio
// stations for Chill Cruise.
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const STATIONS = [
  {
    name: 'KDEER 101.5', sub: 'Smooth Grazing', freq: '101.5', bpm: 78, style: 'lofi',
    songs: ['Salt Lick Sunday', 'Velvet Antlers', 'Meadow at 5pm', 'Headlights (Acoustic)'],
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
  },
  {
    name: 'ANTLER FM 88.3', sub: 'Synthwave Forest', freq: '88.3', bpm: 100, style: 'synth',
    songs: ['Neon Hooves', 'Night Drive 1987', 'Forest Run 2000', 'Taillights'],
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.station = -1;
    this.timer = null;
  }

  // Call inside a user gesture (iOS needs this to start audio).
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this._session();
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (_) {
        this.ctx = new AC();
      }
      this._build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
    } catch (_) {
      /* ignore */
    }
  }

  // iOS: 'playback' lets game audio play even with the ringer switch on silent.
  _session() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = this.muted ? 'ambient' : 'playback';
    } catch (_) {
      /* ignore */
    }
  }

  setMuted(m) {
    this.muted = m;
    this._session();
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = 0.4;
    this.music.connect(this.master);
    this.white = this._noiseBuf(false);
    this.brown = this._noiseBuf(true);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(1.8, 2.6);
    this.revSend = c.createGain();
    this.revSend.gain.value = 0.3;
    this.revSend.connect(this.reverb);
    this.reverb.connect(this.music);
    this._buildEngine();
    this._buildScreech();
  }

  _noiseBuf(brown) {
    const c = this.ctx, len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  _impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  _filter(type, f, q, dest) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  }

  _loop(buf, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(dest);
    s.start(0, Math.random() * 1.5);
    return s;
  }

  _buildEngine() {
    const c = this.ctx;
    this.engOut = this._gain(0, this.sfx);
    this.engFilt = this._filter('lowpass', 400, 2.2, this.engOut);
    const mk = (type, g) => {
      const o = c.createOscillator();
      o.type = type;
      o.connect(this._gain(g, this.engFilt));
      o.start();
      return o;
    };
    this.o1 = mk('sawtooth', 0.5);
    this.o2 = mk('square', 0.3);
    this.o3 = mk('sawtooth', 0.12);
    this.whineG = this._gain(0, this.engOut);
    this.whine = c.createOscillator();
    this.whine.type = 'sine';
    this.whine.connect(this.whineG);
    this.whine.start();
    this.roadG = this._gain(0, this.sfx);
    this._loop(this.brown, this._filter('lowpass', 420, 0.7, this.roadG));
    this.gravelG = this._gain(0, this.sfx);
    this._loop(this.white, this._filter('bandpass', 1400, 0.7, this.gravelG));
    this.windG = this._gain(0, this.sfx);
    this._loop(this.white, this._filter('bandpass', 600, 0.4, this.windG));
  }

  // Tire squeal: a wavering ~1 kHz tone with a rubbery undertone and some
  // grit. Always running at zero volume; setScreech() fades it in and out.
  _buildScreech() {
    const c = this.ctx;
    this.scrOut = this._gain(0, this.sfx);
    this.scrLevel = 0;
    const chatter = this._gain(1, this.scrOut); // stick-slip roughness (amplitude wobble)
    const tone = this._filter('lowpass', 4500, 0.7, chatter);
    const body = this._filter('highpass', 500, 0.7, tone);
    const band = this._filter('bandpass', 1300, 1.6, body);
    this.scrOsc = [];
    for (const [type, mult, g] of [['sawtooth', 1, 0.45], ['sawtooth', 1.007, 0.35], ['square', 0.5, 0.12]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = 1000 * mult;
      o.connect(this._gain(g, band));
      o.start();
      this.scrOsc.push([o, mult]);
    }
    // pitch waver (in cents): two slow LFOs plus filtered noise for irregular jitter
    const wobble = (src, cents) => {
      const g = this._gain(cents);
      src.connect(g);
      for (const [o] of this.scrOsc) g.connect(o.detune);
    };
    for (const [f, cents] of [[5.5, 30], [13, 12]]) {
      const lfo = c.createOscillator();
      lfo.frequency.value = f;
      lfo.start();
      wobble(lfo, cents);
    }
    const jitter = this._filter('lowpass', 20, 0.7);
    this._loop(this.brown, jitter);
    wobble(jitter, 60);
    const am = c.createOscillator();
    am.frequency.value = 28;
    am.connect(this._gain(0.25, chatter.gain));
    am.start();
    // tire hiss
    this._loop(this.white, this._filter('bandpass', 3000, 0.9, this._gain(0.15, this.scrOut)));
  }

  // level 0..1 (0 = silent); the squeal drops in pitch as the car slows.
  setScreech(level, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrOut.gain.setTargetAtTime(level * 0.22, t, level > this.scrLevel ? 0.02 : 0.07);
    this.scrLevel = level;
    if (level > 0) {
      const f = 880 + 300 * Math.min(1, speed / 25);
      for (const [o, mult] of this.scrOsc) o.frequency.setTargetAtTime(f * mult, t, 0.08);
    }
  }

  setDrive({ rpm, throttle, speed, offroad, on }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = (rpm / 60) * 2;
    this.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.o3.frequency.setTargetAtTime(f * 2.01, t, 0.04);
    this.engFilt.frequency.setTargetAtTime(220 + throttle * 700 + rpm * 0.16, t, 0.06);
    this.engOut.gain.setTargetAtTime(on ? 0.15 + throttle * 0.1 + (Math.min(rpm, 6000) / 6000) * 0.08 : 0, t, 0.12);
    this.whine.frequency.setTargetAtTime(f * 9, t, 0.05);
    this.whineG.gain.setTargetAtTime(on ? 0.005 + throttle * 0.01 : 0, t, 0.1);
    this.roadG.gain.setTargetAtTime(on ? Math.min(0.32, (speed / 32) * 0.2) : 0, t, 0.1);
    this.gravelG.gain.setTargetAtTime(on ? Math.min(0.3, offroad * (speed / 25) * 0.3) : 0, t, 0.05);
    const w = speed / 40;
    this.windG.gain.setTargetAtTime(on ? Math.min(0.16, w * w * 0.09) : 0, t, 0.15);
  }

  // --- one-shot helpers
  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _tone(type, f, t, dur, peak, dest, fEnd, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  _noise(t, dur, peak, type, f, q, dest, fEnd, attack = 0.003) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.white;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (fEnd) flt.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    flt.Q.value = q;
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    s.connect(flt);
    flt.connect(g);
    g.connect(dest || this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + dur + 0.05);
  }

  bonk() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this._tone('sine', 150, t, 0.35, 0.9, null, 45);
    this._noise(t, 0.12, 0.35, 'highpass', 2500, 0.5);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(340, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.8);
    const lfo = c.createOscillator();
    lfo.frequency.value = 14;
    const lg = this._gain(40);
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = c.createGain();
    this._env(g, t + 0.04, 0.01, 0.38, 0.75);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.95);
    lfo.stop(t + 0.95);
  }

  closeCall() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.4, 0.4, 'bandpass', 350, 1.2, null, 2600, 0.05);
    this._tone('triangle', 1318.5, t + 0.08, 0.25, 0.18);
    this._tone('triangle', 1975.5, t + 0.17, 0.35, 0.16);
  }

  honk(dur = 0.38, pitch = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const flt = this._filter('lowpass', 2400, 0.8, this.sfx);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.setValueAtTime(0.22, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    g.connect(flt);
    for (const f of [415, 500]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f * pitch;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  // Cartoon "ding" for the deer twinkling out in the sky.
  twinkle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 2093, t, 0.25, 0.14);
    this._tone('sine', 3136, t + 0.07, 0.35, 0.1);
    this._tone('triangle', 4186, t + 0.12, 0.3, 0.05);
  }

  // Metal-and-glass impact right before the explosion.
  crunch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.32, 0.75, 'bandpass', 1100, 1.4);
    this._tone('square', 95, t, 0.22, 0.25, null, 55);
    for (let i = 0; i < 6; i++) this._tone('triangle', 2400 + Math.random() * 2400, t + 0.05 + i * 0.04, 0.12, 0.05);
  }

  // Knocking over a roadside marker post (plastic thwack) or a sign (metal clang).
  knock(kind, k = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'sign') {
      for (const [f, dur, peak] of [[410, 0.9, 0.12], [1130, 0.6, 0.08], [1790, 0.45, 0.05], [2640, 0.3, 0.035]]) {
        this._tone('sine', f, t, dur, peak * (0.5 + k * 0.5));
      }
      this._noise(t, 0.12, 0.1 + 0.3 * k, 'bandpass', 2200, 0.9);
      this._tone('triangle', 140, t, 0.18, 0.3 * k, null, 70);
    } else {
      this._noise(t, 0.09, 0.3 + 0.3 * k, 'bandpass', 900, 1.1);
      this._tone('triangle', 220, t, 0.12, 0.08 + 0.25 * k, null, 110);
    }
  }

  // Heavy impact against something that doesn't give (a tree, a rock).
  thud() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 74, t, 0.45, 1.0, null, 30);
    this._noise(t, 0.25, 0.6, 'lowpass', 700, 0.8, null, 120);
  }

  explosion() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this._noise(t, 1.8, 1.3, 'lowpass', 3200, 0.7, null, 140, 0.005);
    this._tone('sine', 85, t, 1.4, 1.0, null, 26);
    this._tone('triangle', 55, t + 0.02, 1.0, 0.5, null, 22);
    const g = this._gain(0, this.sfx);
    const src = c.createBufferSource();
    src.buffer = this.brown;
    src.connect(this._filter('lowpass', 260, 0.6, g));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.start(t);
    src.stop(t + 3.3);
    // fire crackle
    for (let i = 0; i < 40; i++) {
      this._noise(t + 0.2 + Math.random() * 3.5, 0.02 + Math.random() * 0.04, 0.08 + Math.random() * 0.18, 'highpass', 1500 + Math.random() * 3000, 0.7);
    }
  }

  snort() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._noise(t + i * 0.13, 0.09, 0.35 - i * 0.07, 'bandpass', 750 + i * 60, 1.6);
  }

  beep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone('square', 1900, t, 0.07, 0.07);
    this._tone('square', 1900, t + 0.13, 0.07, 0.07);
  }

  scrape() {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.18, 0.25, 'highpass', 3000, 0.6);
  }

  levelUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((m, i) => this._tone('triangle', midi(m), t + i * 0.08, 0.22, 0.14));
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [67, 72, 76, 79, 84, 88].forEach((m, i) => this._tone('square', midi(m), t + i * 0.09, 0.3, 0.07));
  }

  click() {
    if (!this.ctx) return;
    this._tone('sine', 880, this.ctx.currentTime, 0.05, 0.08);
  }

  // --- procedural radio
  startRadio(i) {
    if (!this.ctx) return;
    this.stopRadio();
    this.station = i;
    if (i < 0) return;
    this.st = STATIONS[i];
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.3;
    this._noise(this.ctx.currentTime, 0.28, 0.12, 'bandpass', 2200, 0.4, this.music);
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stopRadio() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.station = -1;
  }

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const spb = 60 / this.st.bpm / 4;
    if (this.nextT < this.ctx.currentTime - 0.2) this.nextT = this.ctx.currentTime + 0.05;
    while (this.nextT < this.ctx.currentTime + 0.15) {
      const swing = this.st.style === 'lofi' && this.step % 2 === 1 ? spb * 0.18 : 0;
      this._step(this.step, this.nextT + swing, spb);
      this.nextT += spb;
      this.step++;
    }
  }

  _kick(t, peak = 0.7) {
    this._tone('sine', 120, t, 0.25, peak, this.music, 42);
  }

  _snare(t, peak = 0.25) {
    this._noise(t, 0.16, peak, 'bandpass', 1800, 0.8, this.music);
    this._noise(t, 0.2, peak * 0.4, 'bandpass', 1800, 0.8, this.revSend);
    this._tone('triangle', 190, t, 0.08, peak * 0.5, this.music);
  }

  _hat(t, peak = 0.06) {
    this._noise(t, 0.035, peak, 'highpass', 7500, 0.5, this.music);
  }

  _note(type, m, t, dur, peak, attack = 0.01, cutoff = 2200) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = midi(m);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.revSend);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  _step(step, t, spb) {
    const st = this.st;
    const bar = Math.floor(step / 16), s = step % 16;
    const chord = st.chords[bar % st.chords.length];
    if (st.style === 'lofi') {
      if (s === 0 || s === 7 || s === 10) this._kick(t, 0.6);
      if (s === 4 || s === 12) this._snare(t, 0.16);
      if (s % 2 === 0) this._hat(t, s % 4 === 0 ? 0.05 : 0.03);
      if (s === 0 || s === 6 || s === 11) for (const m of chord) {
        this._note('triangle', m, t, spb * 9, 0.045, 0.02, 1500);
        this._note('sine', m + 12, t, spb * 6, 0.02, 0.02, 1500);
      }
      if (s === 0 || s === 10) this._note('sine', chord[0] - 12, t, spb * 5, 0.22, 0.01, 600);
      const mel = [0, 3, 5, 8, 9, 14];
      if (mel.includes(s) && ((bar * 7 + s * 3) % 5) < 2) this._note('triangle', chord[(bar + s) % chord.length] + 12, t, spb * 3, 0.05, 0.01, 2500);
      if (Math.random() < 0.08) this._noise(t, 0.01, 0.03, 'highpass', 3000, 0.5, this.music);
    } else {
      if (s % 4 === 0) this._kick(t, 0.7);
      if (s === 4 || s === 12) this._snare(t, 0.24);
      if (s % 4 === 2) this._hat(t, 0.06);
      if (s === 0) for (const m of chord) {
        this._note('sawtooth', m, t, spb * 15, 0.03, 0.25, 1300);
        this._note('sawtooth', m + 0.08, t, spb * 15, 0.025, 0.25, 1300);
      }
      const arp = [0, 1, 2, 1];
      this._note('square', chord[arp[s % 4]] + 12 + (s >= 8 ? 12 : 0), t, spb * 0.9, 0.035, 0.005, 2600);
      if (s % 2 === 0) this._note('sawtooth', chord[0] - 24 + (s % 4 === 2 ? 12 : 0), t, spb * 1.6, 0.12, 0.005, 520);
    }
  }
}
