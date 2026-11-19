// Music player: shuffles through the .mp3 files in the repo's music/ folder.
//
// GitHub Pages can't list a folder, so the song list comes from the GitHub
// API's listing of the repo's music/ folder (cached per session). If that
// folder holds a playlist.json (a JSON array of file names, for picking the
// songs or their order by hand), that list is used instead.
// So adding songs is just: drop .mp3 files into music/ and push.

// Used when the page isn't served from <owner>.github.io/<repo>/ (a custom domain).
const FALLBACK_REPO = 'amontesinos/mayasimulator';
const CACHE_KEY = 'music-list-v1';
// a moment of silence, played inside the tap so iOS lets this player start
// later on its own (once the song list has loaded)
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function repoName() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const first = location.pathname.split('/').filter(Boolean)[0];
  return m && first ? `${m[1]}/${first}` : FALLBACK_REPO;
}

// "Ella Langley - Choosin' Texas.mp3" -> "Ella Langley - Choosin' Texas" (underscores become spaces)
const pretty = (file) => decodeURIComponent(file).replace(/\.mp3$/i, '').replace(/_+/g, ' ').trim();

export class MusicPlayer {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.files = null; // song file names, once loaded
    this.order = [];
    this.idx = -1;
    this.playing = false;
    this.title = '';
    this.fails = 0;
    this.onChange = null; // (playing, title) => void
    this.onEmpty = null; // no songs found
    this.el.addEventListener('ended', () => {
      if (this.playing && !this.el.src.startsWith('data:')) this._next();
    });
    this.el.addEventListener('error', () => {
      if (!this.playing || this.el.src.startsWith('data:')) return;
      // skip a file that won't play, but give up if none of them do
      if (++this.fails < (this.files ? this.files.length : 1)) this._next();
      else this._stop();
    });
    this.el.addEventListener('playing', () => (this.fails = 0));
    this.loading = this._load();
  }

  async _load() {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) return (this.files = JSON.parse(cached));
    } catch (_) {
      /* ignore */
    }
    let files = [], listed = null;
    try {
      const r = await fetch(`https://api.github.com/repos/${repoName()}/contents/music`);
      if (r.ok) listed = (await r.json()).filter((f) => f.type === 'file').map((f) => f.name);
    } catch (_) {
      /* offline or rate-limited */
    }
    // a playlist.json, when there is one (or when the listing failed), wins
    if (!listed || listed.includes('playlist.json')) {
      try {
        const r = await fetch('music/playlist.json', { cache: 'no-cache' });
        if (r.ok) files = (await r.json()).filter((f) => typeof f === 'string');
      } catch (_) {
        /* no playlist */
      }
    }
    if (!files.length && listed) files = listed.filter((n) => /\.mp3$/i.test(n));
    try {
      if (files.length) sessionStorage.setItem(CACHE_KEY, JSON.stringify(files));
    } catch (_) {
      /* ignore */
    }
    return (this.files = files);
  }

  _shuffle() {
    const a = this.files.map((_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    // don't repeat the song that just played
    if (a.length > 1 && a[0] === this.order[this.idx]) [a[0], a[1]] = [a[1], a[0]];
    this.order = a;
    this.idx = -1;
  }

  _next() {
    if (!this.files || !this.files.length) return this._stop();
    if (this.idx + 1 >= this.order.length) this._shuffle();
    this.idx++;
    const file = this.files[this.order[this.idx]];
    this.title = pretty(file);
    this.el.src = `music/${file.split('/').map(encodeURIComponent).join('/')}`;
    this.el.play().catch(() => {});
    if (this.onChange) this.onChange(true, this.title);
  }

  _stop() {
    this.playing = false;
    this.el.pause();
    if (this.onChange) this.onChange(false, this.title);
  }

  // Call from a tap. Resumes the current song, or starts a shuffled one.
  toggle() {
    if (this.playing) return this.pause();
    this.playing = true;
    if (this.files && this.files.length && this.el.src && !this.el.src.startsWith('data:') && !this.el.ended) {
      this.el.play().catch(() => {});
      if (this.onChange) this.onChange(true, this.title);
      return;
    }
    if (!this.files) {
      // list still loading: unlock playback now, inside the tap
      this.el.src = SILENCE;
      this.el.play().catch(() => {});
    }
    this.loading.then((files) => {
      if (!this.playing) return;
      if (!files.length) {
        this.playing = false;
        if (this.onEmpty) this.onEmpty();
        if (this.onChange) this.onChange(false, '');
        return;
      }
      if (!this.order.length) this._shuffle();
      this._next();
    });
  }

  pause() {
    this.playing = false;
    this.el.pause();
    if (this.onChange) this.onChange(false, this.title);
  }

  setMuted(m) {
    this.el.muted = m;
  }

  // the app went to the background (true) or came back (false)
  background(hidden) {
    if (hidden) {
      this.wasPlaying = this.playing;
      if (this.playing) this.el.pause();
    } else if (this.wasPlaying && this.playing) this.el.play().catch(() => {});
  }
}
