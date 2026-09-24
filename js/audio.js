/* WebAudio loader for the carved .ckb wav bank */
const Sfx = {
  ctx: null, master: null, buffers: {}, _muted: false,

  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },

  async loadAll(names, onProgress) {
    let done = 0;
    await Promise.all(names.map(async (n) => {
      try {
        const r = await fetch("audio/" + n);
        const ab = await r.arrayBuffer();
        // decodeAudioData promise form (Safari needs callback form)
        this.buffers[n.replace(/\.wav$/, "")] = await new Promise((res, rej) =>
          this.ctx.decodeAudioData(ab, res, rej));
      } catch (e) { /* skip broken clip */ }
      onProgress && onProgress(++done, names.length);
    }));
  },

  play(name, vol = 1, rate = 1) {
    if (!this.ctx || this._muted) return;
    const b = this.buffers[name];
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g); g.connect(this.master);
    s.start();
  },

  /* looping emitter, e.g. jetpack */
  loop(name, vol = 0.5) {
    if (!this.ctx || !this.buffers[name]) return { stop() {} };
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[name];
    s.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g); g.connect(this.master);
    s.start();
    return { stop() { try { s.stop(); } catch (e) {} } };
  },

  rnd(a, b) { return a + Math.random() * (b - a); },
};
