/* Shared headless harness: browser-API stubs + loads the real game scripts */
const fs = require("fs"), vm = require("vm"), path = require("path");

module.exports = function loadGame() {
  const listeners = {};
  global.window = global;
  global.location = { search: "", href: "http://localhost/" };
  global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
  global.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  global.removeEventListener = () => {};

  const canvasStub = {
    style: {}, width: 0, height: 0, listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener() {},
    fire(ev, arg) { (this.listeners[ev] || []).forEach(f => f(arg)); },
    getContext: () => new Proxy({}, {
      get: (t, k) => (k === "canvas" ? canvasStub : (typeof k === "string" ? () => undefined : undefined)),
      set: () => true,
    }),
  };

  class FakeImage {
    constructor() { this.width = 256; this.height = 256; }
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
  }
  global.Image = FakeImage;

  const base = path.join(__dirname, "..");
  global.fetch = async url => {
    const f = path.join(base, url);
    if (fs.existsSync(f)) {
      const buf = fs.readFileSync(f);
      return { json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    return { json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) };
  };

  global.AudioContext = class {
    constructor() { this.state = "running"; }
    createGain() { return { gain: { value: 1 }, connect: () => {} }; }
    createBufferSource() { return { buffer: null, loop: false, playbackRate: { value: 1 }, connect: () => {}, start: () => {}, stop: () => {} }; }
    decodeAudioData(ab, ok) { ok({ duration: 0.1 }); }
  };

  global.document = {
    getElementById(id) {
      if (id === "game") return canvasStub;
      return { style: {}, textContent: "", value: "", remove() {}, appendChild() {}, disabled: false, onclick: null };
    },
    createElement: () => ({ value: "", textContent: "" }),
  };

  let rafQ = [];
  global.requestAnimationFrame = cb => { rafQ.push(cb); };

  /* matter's UMD checks `typeof exports` — inside runInThisContext it can see
     this module's exports and would take the CommonJS branch, never defining
     the global. Shadow the identifiers to force the browser branch. */
  vm.runInThisContext(
    "(function(){var exports,module,define;" + fs.readFileSync(path.join(base, "js/vendor/matter.min.js"), "utf8") + "})();",
    { filename: "matter.min.js" });
  if (typeof Matter === "undefined") { console.error("HARNESS: matter.min.js failed to define global Matter"); process.exit(97); }
  if (typeof Matter === "undefined") { console.error("HARNESS: matter.min.js failed to define global Matter"); process.exit(97); }
  const rest = ["js/audio.js", "js/weapons.js", "js/net.js", "js/map.js", "js/main.js"].map(f => fs.readFileSync(path.join(base, f), "utf8")).join("\n;\n");
  vm.runInThisContext(rest, { filename: "bundle.js" });

  /* lobby UI not needed headless */
  global.showLobby = () => {};

  const lib = {
    G, keys, mouse, canvasStub,
    arm: async () => { (listeners.pointerdown || []).forEach(f => f({})); await new Promise(r => setTimeout(r, 150)); },
    _clock: 0,
    frames: (n, step = 16.7) => {
      lib._clock = Math.max(Date.now(), (lib._clock || 0));
      for (let i = 0; i < n; i++) { lib._clock += step; const t = lib._clock; const q = rafQ; rafQ = []; q.forEach(cb => cb(t)); }
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
  };
  return lib;
};
