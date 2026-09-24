/* ============================================================
   Mini Militia Classic — web port
   Real maps/sprites/sounds extracted from the APK.
   Solo vs bots · LAN/online multiplayer (host authoritative).
   Educational project — do not redistribute.
   ============================================================ */
"use strict";

const GRAV = 1500;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const TRIP = (name, i, limit = 200000, ctxd) => { if (i > limit) { console.error("TRIPWIRE:", name, i, JSON.stringify(ctxd)); process.exit(99); } };
const SPR = 0.34;   /* soldier part scale: 84px leg art -> ~29px on screen */

const MAPS = [
  ["1outpost", "Outpost"], ["2highTower", "High Tower"], ["3subdivision", "Subdivision"],
  ["4bottleNeck", "Bottle Neck"], ["5noEscape", "No Escape"], ["6solong", "So Long"],
  ["7lunarcy", "Lunarcy"], ["8icebox", "Icebox"], ["9snowblind", "Snowblind"],
  ["10pyramid", "Pyramid"], ["11catacombs", "Catacombs"], ["12overseer", "Overseer"],
  ["13suspension", "Suspension"], ["14cliffhanger", "Cliffhanger"], ["15crossfire", "Crossfire"],
  ["16undermine", "Undermine"], ["17crucible", "Crucible"], ["18stronghold", "Stronghold"],
  ["19losttomb", "Lost Tomb"], ["20deadlock", "Deadlock"], ["0hunger", "Hunger"],
  ["kingofthehill", "King of the Hill"], ["survival", "Survival"], ["training", "Training"],
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

/* ---------------------------------------------------------- global state */
const G = {
  ready: false, W: 0, H: 0, dpr: 1,
  time: 0, kills: 0, deaths: 0, mapName: "1outpost", mapLabel: "Outpost",
  camera: { x: 0, y: 0, vw: 0, vh: 0, shake: 0, zoom: 1, zoomT: 1 },
  map: null, menu: null, parts: null, imgs: {},
  players: [],            // all Soldiers (me + bots or me + remotes)
  remotes: new Map(),     // guest side: id -> remote Soldier (render stubs)
  bullets: [], nades: [], pickups: [], particles: [], fx: [], beams: [],
  net: null,              // Net instance when online
  isHost: false, isGuest: false,
  netEvents: [],
  me: null,
  showColliders: false,   /* debug: draw matter.js bodies (` or ?colliders) */
};

/* ------------------------------------------------ matter.js physics world */
/* Collision resolution only: gravity/accel/jet feel is integrated by game code
   (exact legacy constants) and handed to Matter as per-step velocities. */
function initPhysics() {
  if (!window.Matter) { console.error("matter.js missing — expected js/vendor/matter.min.js"); return; }
  const M = window.Matter;
  G.engine = M.Engine.create({ enableSleeping: false });
  G.engine.gravity.x = 0; G.engine.gravity.y = 0;   /* game code owns gravity */
  const opts = { isStatic: true, friction: 0, frictionStatic: 0, restitution: 0 };
  const bodies = G.map.solidRects().map(r =>
    M.Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, opts));
  for (const b of bodies) b._terrain = true;   /* collider-overlay tags */
  const T = 96;   /* boundary walls (bottom left open — the void death line catches fallers) */
  bodies.push(M.Bodies.rectangle(G.map.w / 2, -T / 2, G.map.w + T * 4, T, opts));
  bodies.push(M.Bodies.rectangle(-T / 2, G.map.h / 2, T, G.map.h * 3, opts));
  bodies.push(M.Bodies.rectangle(G.map.w + T / 2, G.map.h / 2, T, G.map.h * 3, opts));
  for (let i = bodies.length - 3; i < bodies.length; i++) bodies[i]._wall = true;
  M.Composite.add(G.engine.world, bodies);
  /* nade bounce clatter (velocity is px per 1/60s step) */
  M.Events.on(G.engine, "collisionStart", ev => {
    for (const pair of ev.pairs) {
      const nade = (pair.bodyA._nade && pair.bodyA) || (pair.bodyB._nade && pair.bodyB);
      if (nade) {
        const v = Math.hypot(nade.velocity.x, nade.velocity.y);
        if (v > 2.5) Sfx.play("clank", Math.min(0.3, 0.08 + v / 40));
      }
    }
  });
}

/* ---------------------------------------------------------- boot */
async function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function loadJSON(url) { return (await fetch(url)).json(); }

const SND_NAMES = ["ak47","awol","back","base","basics","bolt","boots","bringit","center","checkpoint","clank","cmonboy","control","coverme","dead","deagle","death1","death2","death3","death4","death5","death6","death7","death8","death9","destroy","disassemble","dryfire","energy","explode","explosives","flame","future","gas","getsome","good","goodgame","gotit","gotme","green","grenade1","grenade2","grenades","hoorah","impact","impact2","impact3","impale","jet","jump","jumps","laser","live","lock","look","m14","m16","m61","m93ba","made","magnum","malfunction","mecha","melee","moveout","mp5","niceshot","no","nuts","over","perfect","pickup","piece","proxy","pull","readyup","reload","rg6","ricochet","rocket","saw","shotgun","silencer","snatch","soar","standdown","switch","targets","tavor","tec9","thanks","think","throw","thrust","time","ugly","uzi","welcome","well","weps","will","xm8","yeah","zoom"].map(n => n + ".wav");

async function boot() {
  const status = t => document.getElementById("status").textContent = t;
  const fill = p => document.getElementById("fill").style.width = (p * 100).toFixed(0) + "%";
  /* browsers keep AudioContext suspended until a gesture — resume on any tap */
  const resume = () => { if (Sfx.ctx && Sfx.ctx.state === "suspended") Sfx.ctx.resume(); };
  window.addEventListener("pointerdown", resume); window.addEventListener("keydown", resume);
  try {
    status("decoding atlases…"); fill(0.05);
    const [menuJson, partsJson] = await Promise.all([
      loadJSON("data/atlas/menuTexture.json"), loadJSON("data/atlas/partsTexture.json")]);
    status("loading textures…"); fill(0.15);
    const [menuImg, partsImg, bullet, blood, smoke, spark, bg, bgD, bgM, bgS,
      tsMain, tsDesert, tsMoon, tsSnow, boom] = await Promise.all([
      loadImage("img/menuTexture.png"), loadImage("img/partsTexture.png"),
      loadImage("img/bullet_new.png"), loadImage("img/blood_new.png"),
      loadImage("img/smoke_new.png"), loadImage("img/spark_new.png"),
      loadImage("img/bg_new.png"), loadImage("img/bgDesert_new.png"),
      loadImage("img/bgMoon_new.png"), loadImage("img/bgSnow_new.png"),
      loadImage("img/tile64_new.png"), loadImage("img/tile64Desert_new.png"),
      loadImage("img/tile64Moon_new.png"), loadImage("img/tile64Snow_new.png"),
      loadImage("img/blast_new.png")]);
    fill(0.3);

    G.menu = new Atlas(menuJson, menuImg);
    G.parts = new Atlas(partsJson, partsImg);
    G.imgs = {
      bullet, blood, smoke, spark, boom,
      bg: { "tile64_new.png": bg, "tile64Desert_new.png": bgD, "tile64Moon_new.png": bgM, "tile64Snow_new.png": bgS },
      tilesets: { "tile64_new.png": tsMain, "tile64Desert_new.png": tsDesert, "tile64Moon_new.png": tsMoon, "tile64Snow_new.png": tsSnow },
    };
    resize(); window.addEventListener("resize", resize);

    /* deep link: ?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=2] — skips the lobby */
    const qp = new URLSearchParams(location.search);
    if (qp.has("solo")) {
      status("starting…"); fill(0.5);
      try { await Sfx.init(); } catch (e) {}
      await Sfx.loadAll(SND_NAMES, (i, n) => { status(`decoding sounds ${i}/${n}`); fill(0.5 + 0.5 * i / n); });
      const load = document.getElementById("load");
      load.style.opacity = 0; setTimeout(() => load.remove(), 450);
      startGame({ mode: "solo", map: qp.get("solo") || "1outpost",
        demo: qp.has("demo"), flashHold: qp.has("flashhold"), colliders: qp.has("colliders"),
        bots: qp.has("bots"), zoom: parseFloat(qp.get("zoom")) || 0 });
      return;
    }

    status("click / tap to arm audio"); fill(0.35);
    const arm = async () => {
      window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm);
      await Sfx.init();
      await Sfx.loadAll(SND_NAMES, (i, n) => { status(`decoding sounds ${i}/${n}`); fill(0.35 + 0.65 * i / n); });
      showLobby();
    };
    window.addEventListener("pointerdown", arm); window.addEventListener("keydown", arm);
  } catch (e) {
    console.error(e); status("load failed: " + e.message);
  }
}

/* ---------------------------------------------------------- lobby */
function showLobby() {
  const load = document.getElementById("load");
  load.style.opacity = 0;
  setTimeout(() => load.remove(), 500);
  const lobby = document.getElementById("lobby");
  lobby.style.display = "flex";
  const sel = document.getElementById("mapsel");
  for (const [f, n] of MAPS) {
    const o = document.createElement("option"); o.value = f; o.textContent = n.toUpperCase();
    sel.appendChild(o);
  }
  sel.value = "1outpost";
  document.getElementById("pname").value = "Soldier" + Math.floor(rnd(10, 99));
  const urlbox = document.getElementById("url");
  urlbox.value = "ws://" + location.hostname + ":8090";
  const stat = t => document.getElementById("netstat").textContent = t;
  const busy = b => { for (const id of ["btnSolo", "btnHost", "btnJoin"]) document.getElementById(id).disabled = b; };

  document.getElementById("btnSolo").onclick = () => startGame({ mode: "solo" });
  document.getElementById("btnHost").onclick = async () => {
    busy(true); stat("connecting…");
    try {
      const net = new Net();
      await net.connect(urlbox.value, sel.value, document.getElementById("pname").value);
      startGame({ mode: "host", net });
    } catch (e) { stat("host failed: " + e.message); busy(false); }
  };
  document.getElementById("btnJoin").onclick = async () => {
    busy(true); stat("connecting…");
    try {
      const net = new Net();
      const w = await net.connect(urlbox.value, sel.value, document.getElementById("pname").value);
      if (!net.isHost) startGame({ mode: "guest", net });
      else { stat("room empty — you became host"); startGame({ mode: "host", net }); }
    } catch (e) { stat("join failed: " + e.message); busy(false); }
  };
}

/* direct programmatic entry (also used by the test harness) */
window.__startSolo = (map, bots) => startGame({ mode: "solo", map, bots: !!bots });
window.__startHost = map => startGame({ mode: "host", map });
window.__startHostOnline = async (url, map, name) => {
  const net = new Net();
  await net.connect(url, map, name);
  await startGame({ mode: "host", net, map });
};
window.__startHostExistingNet = (net, map) => startGame({ mode: "host", net, map }); /* lets tests open the net BEFORE the game */
window.__startGuestOnline = async (url, map, name) => {
  const net = new Net();
  await net.connect(url, map, name);
  await startGame({ mode: net.isHost ? "host" : "guest", net, map });
};

/* ---------------------------------------------------------- game start */
async function startGame(opts) {
  const mode = opts.mode || "solo";
  G.net = opts.net || null;
  G.isHost = mode === "host";
  G.isGuest = mode === "guest";
  G._flashHold = !!opts.flashHold;
  G._zoomOverride = opts.zoom ? clamp(opts.zoom, 1, 3) : 0;
  G.showColliders = !!opts.colliders || G.showColliders;
  const mapName = opts.map || (document.getElementById("mapsel") || {}).value || "1outpost";
  G.mapName = mapName;
  G.mapLabel = (MAPS.find(m => m[0] === mapName) || [null, mapName])[1];

  const mapJson = await loadJSON(`data/maps/${mapName}.json`);
  G.map = new GameMap(mapJson, G.menu, G.imgs.tilesets, G.imgs.bg);
  G.map.buildMask();
  initPhysics();
  initPickups();
  G.bullets = []; G.nades = []; G.particles = []; G.fx = []; G.beams = []; G.netEvents = [];

  document.getElementById("lobby").style.display = "none";

  if (mode === "solo") {
    G.me = new Soldier({ id: 1, name: "YOU" });
    G.players = [G.me];
    if (opts.bots) for (const b of [[-2, "BOT Diesel"], [-3, "BOT Chowdhury"]])
      G.players.push(new Soldier({ id: b[0], name: b[1], isBot: true }));
  } else if (G.isHost) {
    G.me = new Soldier({ id: G.net.id, name: document.getElementById("pname").value || "HOST" });
    G.players = [G.me];
    setupHostNet();
  } else {
    G.me = new Soldier({ id: G.net.id, name: document.getElementById("pname").value || "GUEST" });
    G.players = [G.me];
    setupGuestNet();
  }
  G.ready = true;
  if (opts.demo) { mouse.down = true; mouse.x = G.W * 0.72; mouse.y = G.H * 0.35; }
  Sfx.play("welcome", 0.5);
}

/* ---------------------------------------------------------- net: host */
function setupHostNet() {
  const net = G.net;
  net.onPeerJoin = m => {
    if (!G.players.find(p => p.id === m.id))
      G.players.push(new Soldier({ id: m.id, name: m.name, remote: true, skin: skinFor(m.id) }));
    Sfx.play("gotit", 0.4);
    /* sync current pickup state to the new guest */
    net.send({ t: "pkinit", pk: G.pickups.map((k, i) => [i, k.idx, Math.round(k.respawn * 10) / 10]) }, m.id);
  };
  net.onPeerLeave = m => {
    const p = G.players.find(x => x.id === m.id);
    if (p) p.detachBody();
    G.players = G.players.filter(x => x.id !== m.id);
    if (m.promoted) { /* we lost host — for PoC just keep hosting our view */ }
  };
  net.onC2C = (from, d) => {
    let p = G.players.find(x => x.id === from);
    if (!p && (d.t === "inp" || d.t === "hello")) {
      /* pjoin was lost while we were still loading the map — self-heal the player in */
      p = new Soldier({ id: from, name: d.name || "P" + from, remote: true, skin: skinFor(from) });
      G.players.push(p);
      Sfx.play("gotit", 0.4);
    }
    if (!p) return;
    if (d.t === "inp") { G._inpCount = (G._inpCount || 0) + 1; p.remoteInput = inputUnpack(d); }
    else if (d.t === "hello") net.send({ t: "pkinit", pk: G.pickups.map((k, i) => [i, k.idx, Math.round(k.respawn * 10) / 10]) }, from);
  };
}

/* host: emit world event to guests */
function netEvent(d) { if (G.isHost) G.netEvents.push(d); }

function hostTick(dt) {
  if (!G.isHost) return;
  hostTick._s -= dt; hostTick._ev -= dt;
  if (hostTick._ev <= 0) {
    for (const e of G.netEvents) G.net.send(e);
    G.netEvents.length = 0;
    hostTick._ev = 0.016;
  }
  if (hostTick._s <= 0) {
    G.net.send({ t: "snap", ps: snapPack(G.players) });
    hostTick._s = 0.05; /* 20 Hz */
  }
}
hostTick._s = 0; hostTick._ev = 0;

/* ---------------------------------------------------------- net: guest */
function setupGuestNet() {
  const net = G.net;
  net.onPeerJoin = m => {
    if (m.id === net.id) return;
    if (!G.remotes.has(m.id)) {
      const s = new Soldier({ id: m.id, name: m.name, skin: skinFor(m.id) });
      s.ghost = true;
      G.remotes.set(m.id, s);
    }
  };
  net.onPeerLeave = m => { G.remotes.delete(m.id); };
  net.onC2C = (from, d) => {
    if (d.t === "snap") applySnapshot(d.ps);
    else if (d.t === "fire") spawnVisualBullet(d);
    else if (d.t === "nade") G.nades.push({ x: d.x, y: d.y, vx: d.vx, vy: d.vy, t: 0, fuse: d.fuse || 2, def: NADES.fragnade, owner: null, ghost: true });
    else if (d.t === "boom") { G.fx.push({ x: d.x, y: d.y, t: 0, dur: 0.3, r: d.r }); G.camera.shake = Math.min(14, G.camera.shake + 8); Sfx.play("explode", 0.7, rnd(0.9, 1.1)); }
    else if (d.t === "sfx") Sfx.play(d.n, 0.5);
    else if (d.t === "death") guestDeath(d);
    else if (d.t === "pk") { const k = G.pickups[d.i]; if (k) { k.idx = d.idx; k.respawn = d.rsp; } }
    else if (d.t === "pkinit") { G._pkInit = true; for (const [i, idx, rsp] of d.pk) { const k = G.pickups[i]; if (k) { k.idx = idx; k.respawn = rsp; } } }
  };
  guestTick._acc = 0;
  guestTick._hello = 0.3;
}
function guestTick(dt) {
  if (!G.isGuest) return;
  guestTick._acc -= dt;
  if (guestTick._acc <= 0) {
    G.net.send(inputPack(humanInput()));
    guestTick._acc = 0.033; /* 30 Hz */
  }
  /* retry hello until the host acks with pkinit (pjoin/pkinit can be lost
     while the host side is still loading) */
  if (!G._pkInit) {
    guestTick._hello -= dt;
    if (guestTick._hello <= 0) { G.net.send({ t: "hello", name: G.me.name }); guestTick._hello = 1.0; }
  }
}

function applySnapshot(rows) {
  G._snapCount = (G._snapCount || 0) + 1;
  const seen = new Set();
  for (const s of snapUnpack(rows)) {
    seen.add(s.id);
    if (s.id === G.me.id) {
      /* authoritative hp/dead/weapon + gentle position correction */
      if (s.hp < G.me.hp - 0.5) { bloodBurst(G.me.cx(), G.me.cy(), 4); Sfx.play(pick(["impact", "impact2", "impact3"]), 0.35); }
      G.me.hp = s.hp;
      if (s.dead && !G.me.dead) G.me.die(null);
      if (!s.dead && G.me.dead) { G.me.dead = false; G.me.deadT = 0; G.me.invuln = 2.0; G.me.ensureBody(true); }
      const dx = s.x - G.me.x, dy = s.y - G.me.y;
      if (Math.hypot(dx, dy) > 220) { G.me.x = s.x; G.me.y = s.y; }
      else { G.me.x += dx * 0.18; G.me.y += dy * 0.18; }
      if (G.me.body) window.Matter.Body.setPosition(G.me.body, { x: G.me.x + G.me.w / 2, y: G.me.y + G.me.h / 2 });
      G.me.fuel = s.fuel;
      const w = WEAPONS[s.wep] || WEAPONS.m61;
      if (w !== G.me.weapon) { G.me.weapon = w; Sfx.play("switch", 0.4); }
      G.me.ammo = s.ammo;
    } else {
      let r = G.remotes.get(s.id);
      /* init stub AT the snapshot position — it's already top-left; spawning at 0,0 lerps in from the corner */
      if (!r) { r = new Soldier({ id: s.id, name: "P" + s.id, skin: skinFor(s.id) }); r.ghost = true; r.x = s.x; r.y = s.y; r.aim = s.aim; G.remotes.set(s.id, r); }
      r.tx = s.x; r.ty = s.y; r.taim = s.aim; r.hp = s.hp; r.dead = s.dead;
      const w = WEAPONS[s.wep] || WEAPONS.m61; if (w !== r.weapon) r.weapon = w;
      if (s.ammo === 0 && !r._rl) { r._rl = true; } /* reload hint */
    }
  }
  for (const [id] of G.remotes) if (!seen.has(id)) G.remotes.delete(id);
}

function spawnVisualBullet(d) {
  if (d.flame) {
    G.bullets.push({ x: d.x, y: d.y, vx: d.vx, vy: d.vy, life: d.life || 0.5, owner: null, flame: true, ghost: true, r: rnd(14, 22) });
    return;
  }
  G.bullets.push({
    x: d.x, y: d.y, vx: d.vx, vy: d.vy, dmg: 0, life: d.life || 0.95,
    owner: null, rocket: d.rocket, ghost: true, tracer: !d.rocket,
  });
  Sfx.play(d.sfx || "ak47", 0.45, rnd(0.95, 1.05));
}

function guestDeath(d) {
  if (d.who === G.me.id) return; /* own death comes via snapshot/die() */
  const r = G.remotes.get(d.who);
  if (r) { r.dead = true; bloodBurst(r.x + r.w / 2, r.y + r.h / 2, 14); }
  Sfx.play(pick(["death1", "death3", "death5", "death9"]), 0.6);
  if (d.by === G.me.id) { G.kills++; if (Math.random() < 0.5) Sfx.play(pick(["gotit", "niceshot", "yeah"]), 0.6); }
}

/* deterministic skin per player id */
function skinFor(id) {
  const h = 1 + (id * 7) % 17, b = 1 + (id * 5) % 18, a = 1 + (id * 3) % 18, l = 1 + (id * 11) % 17;
  return { head: `head${h}.png`, body: `body${b}.png`, arm: `arm${a}.png`, leg: `leg${l}.png` };
}

/* ---------------------------------------------------------- input */
const keys = {};
const mouse = { x: 0, y: 0, down: false, rdown: false };
const touchCtl = { move: null, aim: null };

window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyM") { Sfx._muted = !Sfx._muted; }
  if (e.code === "KeyR" && G.me) G.me.reload();
  if (e.code === "KeyG" && G.me && !G.isGuest) G.me.throwNade();
  if (e.code === "Backquote" && G.me) G.showColliders = !G.showColliders;  /* debug */
});
window.addEventListener("keyup", e => keys[e.code] = false);
/* losing focus must not leave keys/trigger stuck down */
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.down = false; mouse.rdown = false; });
canvas.addEventListener("mousemove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener("mousedown", e => { if (e.button === 0) mouse.down = true; if (e.button === 2) mouse.rdown = true; });
canvas.addEventListener("mouseup", e => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.rdown = false; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("touchstart", e => {
  for (const t of e.changedTouches) {
    const s = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
    if (t.clientX < G.W / 2 && !touchCtl.move) touchCtl.move = s; else if (!touchCtl.aim) touchCtl.aim = s;
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("touchmove", e => {
  for (const t of e.changedTouches) {
    if (touchCtl.move && t.identifier === touchCtl.move.id) { touchCtl.move.x = t.clientX; touchCtl.move.y = t.clientY; }
    if (touchCtl.aim && t.identifier === touchCtl.aim.id) { touchCtl.aim.x = t.clientX; touchCtl.aim.y = t.clientY; }
  }
  e.preventDefault();
}, { passive: false });
const endTouch = e => {
  for (const t of e.changedTouches) {
    if (touchCtl.move && t.identifier === touchCtl.move.id) touchCtl.move = null;
    if (touchCtl.aim && t.identifier === touchCtl.aim.id) touchCtl.aim = null;
  }
};
canvas.addEventListener("touchend", endTouch); canvas.addEventListener("touchcancel", endTouch);

function humanInput() {
  const inp = {
    left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight,
    jet: keys.KeyW || keys.Space || keys.ArrowUp, fire: mouse.down,
    aimX: mouse.x / G.camera.zoom + G.camera.x, aimY: mouse.y / G.camera.zoom + G.camera.y,
  };
  if (touchCtl.move) {
    const dx = touchCtl.move.x - touchCtl.move.ox, dy = touchCtl.move.y - touchCtl.move.oy;
    if (dx < -20) inp.left = true; if (dx > 20) inp.right = true;
    if (dy < -40) inp.jet = true;
  }
  if (touchCtl.aim) {
    const dx = touchCtl.aim.x - touchCtl.aim.ox, dy = touchCtl.aim.y - touchCtl.aim.oy;
    if (Math.hypot(dx, dy) > 24) {
      inp.aimX = G.me.cx() + dx * 6; inp.aimY = G.me.shoulderY() + dy * 6;
      inp.fire = true;
    }
  }
  return inp;
}

/* ---------------------------------------------------------- resize */
function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.W = window.innerWidth; G.H = window.innerHeight;
  canvas.width = G.W * G.dpr; canvas.height = G.H * G.dpr;
  canvas.style.width = G.W + "px"; canvas.style.height = G.H + "px";
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

/* ---------------------------------------------------------- soldier */
class Soldier {
  constructor(opts) {
    Object.assign(this, {
      id: 0, name: "PLAYER", isBot: false, remote: false, ghost: false,
      x: 0, y: 0, vx: 0, vy: 0, w: 44, h: 104,
      hp: 100, fuel: 100, grounded: false, dead: false, deadT: 0, invuln: 1.2,
      aim: 0, facing: 1, walkT: 0, shootT: 0, flashT: 0, swingT: 0, recoilT: 0,
      weapon: WEAPONS.m61, weaponId: "m61", ammo: 30, reloading: 0, nades: 2,
      shieldT: 0, jetLoop: null, flameLoop: null,
      skin: { head: "head1.png", body: "body1.png", arm: "arm1.png", leg: "leg1.png" },
      kills: 0, ai: null, remoteInput: null,
    }, opts);
    this.equip(this.weapon, true);
    if (!this.ghost) this.respawn(true);
  }

  respawn(first) {
    const sp = G.map.objects.filter(o => o.name.startsWith("sp_p") || o.name.startsWith("ctf_sp"));
    const s = pick(sp.length ? sp : G.map.objects);
    this.x = s.x - this.w / 2; this.y = s.y - this.h;
    /* de-embed from floating geometry (cave ceilings etc.) */
    let tries = 0;
    while (G.map.rectHitsWorld(this.x, this.y, this.w, this.h) && tries++ < 64) {
      this.y -= 8;
      if (tries % 16 === 0) this.x = clamp(this.x + rnd(-96, 96), 0, G.map.w - this.w);
    }
    this.vx = 0; this.vy = 0; this.hp = 100; this.fuel = 100; this.dead = false;
    this.invuln = first ? 1.5 : 2.0; this.nades = 2; this.shieldT = 0; this.recoilT = 0;
    this.equip(WEAPONS.m61, true);
    if (this.isBot) this.ai = { t: 0, side: Math.random() < 0.5 ? -260 : 260, wantX: this.x, weapon: pick(["ak47", "m16", "mp5", "uzi", "shotgun", "tavor", "xm8"]) };
    this.ensureBody(true);
  }

  /* matter body: collides with the static world only (soldiers pass through
     each other and nades, like the original) */
  ensureBody(place) {
    if (this.ghost || !G.engine || !window.Matter) return;
    const M = window.Matter;
    if (!this.body) {
      this.body = M.Bodies.rectangle(this.x + this.w / 2, this.y + this.h / 2, this.w, this.h, {
        friction: 0, frictionStatic: 0, frictionAir: 0, restitution: 0,
        inertia: Infinity, slop: 0.02,
        chamfer: { radius: 10 },   /* rounded feet ride slopes & rock steps smoothly */
        collisionFilter: { category: 0x0002, mask: 0x0001 },
      });
      this.body._soldier = true;   /* collider-overlay tag */
      M.Composite.add(G.engine.world, this.body);
    } else if (place) {
      M.Body.setPosition(this.body, { x: this.x + this.w / 2, y: this.y + this.h / 2 });
    }
    M.Body.setVelocity(this.body, { x: 0, y: 0 });
    M.Body.setAngle(this.body, 0);
  }
  detachBody() {
    if (this.body && G.engine && window.Matter) {
      window.Matter.Composite.remove(G.engine.world, this.body);
      this.body = null;
    }
  }

  equip(w, silent) {
    this.weapon = w; this.weaponId = (Object.keys(WEAPONS).find(k => WEAPONS[k] === w) || "m61");
    this.ammo = w.mag || 0; this.reloading = 0;
    if (!silent) Sfx.play("switch", 0.5);
  }

  reload() {
    const w = this.weapon;
    if (w.melee || this.reloading > 0 || this.ammo >= w.mag) return;
    this.reloading = w.reload; Sfx.play("reload", 0.6);
  }

  muzzle() {
    const gw = (G.menu.frameSize(this.weapon.sprite).w || 60) * SPR;
    const reach = gw * 0.72 + 6;   /* grip-anchored barrel tip, matches the drawn gun */
    return { x: this.cx() + Math.cos(this.aim) * reach, y: this.shoulderY() + Math.sin(this.aim) * reach };
  }
  cx() { return this.x + this.w / 2; }
  cy() { return this.y + this.h / 2; }
  /* vertical assembly metrics (positive = up from the feet line) */
  metrics() {
    const m = G.menu;
    const leg = (m.frameSize(this.skin.leg).h || 84) * SPR;
    const body = (m.frameSize(this.skin.body).h || 102) * SPR;
    return { leg, body,
      hip: leg - 5,
      neck: leg - 5 + body - 7,
      shoulder: leg - 5 + body * 0.28 };
  }
  shoulderY() { const k = this.metrics(); return this.y + this.h - k.shoulder; }

  throwNade() {
    if (this.dead || this.nades <= 0) return;
    this.nades--;
    const m = this.muzzle();
    const n = { x: m.x, y: m.y, vx: Math.cos(this.aim) * 780 + this.vx * 0.4, vy: Math.sin(this.aim) * 780 - 160, t: 0, fuse: 2.0, def: NADES.fragnade, owner: this };
    if (G.engine && window.Matter) {
      const M = window.Matter;
      n.body = M.Bodies.circle(n.x, n.y, 8, {
        restitution: 0.45, friction: 0.02, frictionAir: 0, density: 0.002,
        collisionFilter: { category: 0x0004, mask: 0x0001 },
      });
      n.body._nade = true;
      M.Composite.add(G.engine.world, n.body);
      M.Body.setVelocity(n.body, { x: n.vx / 60, y: n.vy / 60 });
    }
    G.nades.push(n);
    Sfx.play("throw", 0.5);
    netEvent({ t: "nade", x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(Math.cos(this.aim) * 780 + this.vx * 0.4), vy: Math.round(Math.sin(this.aim) * 780 - 160) });
  }

  fire(pressed, dt) {
    const w = this.weapon;
    if (this.dead || this.reloading > 0) return;
    const trigger = w.auto ? pressed : (pressed && !this._trig);
    this._trig = pressed;
    if (w.melee) { if (trigger && this.shootT <= 0) this.meleeSwing(); return; }
    if (!trigger) return;
    if (this.shootT > 0) return;
    if (this.ammo <= 0) { Sfx.play("dryfire", 0.5); this.shootT = 0.3; this.reload(); return; }

    this.shootT = 60 / (w.rpm * (this.isBot ? 0.5 : 1));
    this.flashT = G._flashHold ? 0.5 : 0.05;
    this.recoilT = w.kick || 0.08;

    if (w.flame) {
      this.ammo = Math.max(0, this.ammo - 1);
      const m = this.muzzle();
      for (let i = 0; i < 2; i++) {
        const a = this.aim + rnd(-w.spread, w.spread);
        const vx = Math.cos(a) * w.speed * rnd(0.85, 1.15), vy = Math.sin(a) * w.speed * rnd(0.85, 1.15) - 30;
        G.bullets.push({ x: m.x, y: m.y, vx, vy, dmg: w.dmg * (this.isBot ? 0.6 : 1), life: w.range / w.speed, owner: this, flame: true, r: rnd(14, 22) });
        this._fc = (this._fc || 0) + 1;
        if (this._fc % 3 === 0) netEvent({ t: "fire", flame: 1, x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(vx), vy: Math.round(vy), life: 0.5 });
      }
      if (!this.flameLoop) this.flameLoop = Sfx.loop("flame", 0.25);
      return;
    }

    this.ammo--;
    const m = this.muzzle();
    const dmgMul = this.isBot ? 0.6 : 1;
    const spread = w.spread + (this.isBot ? 0.10 : 0);

    if (w.beam) {
      const a = this.aim + rnd(-spread, spread);
      const hit = raycast(m.x, m.y, a, 2200);
      G.beams.push({ x0: m.x, y0: m.y, x1: hit.x, y1: hit.y, t: 0.08 });
      for (const p of G.players) if (p !== this && !p.dead && segHitsRect(m.x, m.y, hit.x, hit.y, p)) p.damage(w.dmg * dmgMul, this);
      netEvent({ t: "sfx", n: "laser" });
      if (G.map.solidAtPixel(hit.x, hit.y)) sparks(hit.x, hit.y, 3);
    } else {
      for (let i = 0; i < (w.pellets || 1); i++) {
        const a = this.aim + rnd(-spread, spread);
        const vx = Math.cos(a) * w.speed, vy = Math.sin(a) * w.speed;
        G.bullets.push({
          x: m.x, y: m.y, vx, vy,
          dmg: w.dmg * dmgMul, life: w.rocket ? 3.2 : 0.95,
          owner: this, rocket: w.rocket, splash: w.splash, arc: w.arc, tracer: !w.rocket,
        });
        if (i === 0) netEvent({ t: "fire", x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(vx), vy: Math.round(vy), rocket: w.rocket ? 1 : 0, sfx: fireSoundOf(w), life: w.rocket ? 3.2 : 0.95 });
      }
    }
    Sfx.play(fireSoundOf(w), 0.55, rnd(0.95, 1.06));
    if (this.ammo === 0) this.reload();
  }

  meleeSwing() {
    const w = this.weapon;
    this.shootT = 60 / w.rpm; this.swingT = 0.22;
    Sfx.play("melee", 0.4, rnd(0.9, 1.1));
    netEvent({ t: "sfx", n: "melee" });
    for (const p of G.players) {
      if (p === this || p.dead) continue;
      const dx = p.cx() - this.cx(), dy = p.cy() - this.shoulderY();
      const d = Math.hypot(dx, dy);
      if (d < w.range && Math.abs(angDiff(Math.atan2(dy, dx), this.aim)) < 1.0) {
        p.damage(w.dmg * (this.isBot ? 0.6 : 1), this);
        p.vx += Math.sign(dx || 1) * 300; p.vy -= 120;
        Sfx.play("impale", 0.5);
      }
    }
  }

  damage(d, by) {
    if (this.dead || this.invuln > 0) return;
    if (this.weapon.shield) d *= this.weapon.shield;
    if (this.shieldT > 0) d *= 0.5;
    this.hp -= d;
    bloodBurst(this.cx(), this.cy(), Math.min(8, 2 + d / 6));
    Sfx.play(pick(["impact", "impact2", "impact3"]), 0.4);
    if (this.hp <= 0) this.die(by);
  }

  die(by) {
    if (this.dead) return;
    this.dead = true; this.deadT = 2.6;
    this.detachBody();   /* corpses don't block the world */
    bloodBurst(this.cx(), this.cy(), 16);
    Sfx.play(pick(["death1", "death2", "death3", "death4", "death5", "death6", "death7", "death8", "death9"]), 0.8);
    if (this.jetLoop) { this.jetLoop.stop(); this.jetLoop = null; }
    if (this.flameLoop) { this.flameLoop.stop(); this.flameLoop = null; }
    if (by && by !== this) {
      by.kills++;
      netEvent({ t: "death", who: this.id, by: by.id });
      if (by === G.me) { G.kills++; if (Math.random() < 0.5) Sfx.play(pick(["gotit", "niceshot", "yeah"]), 0.6); }
    } else netEvent({ t: "death", who: this.id, by: 0 });
    if (this === G.me) G.deaths++;
  }

  physics(dt, input) {
    if (this.dead) {
      this.deadT -= dt;
      /* guest-me: respawn is snapshot-driven — a local timer would flap against the host's */
      if (G.isGuest && this === G.me) return;
      if (!this.ghost && this.deadT <= 0) this.respawn();
      return;
    }
    const map = G.map;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shootT -= dt; this.flashT -= dt; this.swingT -= dt; this.recoilT = Math.max(0, this.recoilT - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = this.weapon.mag; this.reloading = 0; }
    }
    if (this.flameLoop && !(this.weapon.flame && input && input.fire)) { this.flameLoop.stop(); this.flameLoop = null; }

    const accel = this.grounded ? 2600 : 1500;
    if (input.left) this.vx -= accel * dt;
    if (input.right) this.vx += accel * dt;
    this.vx = clamp(this.vx, -460, 460);
    if (!input.left && !input.right) this.vx *= Math.pow(this.grounded ? 0.0002 : 0.2, dt);

    let thrusting = false;
    if (input.jet && this.fuel > 0) {
      this.vy -= 2600 * dt;
      this.fuel = Math.max(0, this.fuel - 30 * dt);
      thrusting = true;
      if (!this.jetLoop) this.jetLoop = Sfx.loop("jet", 0.22);
      if (Math.random() < 0.6) G.particles.push(smokePuff(this.cx() - this.facing * 10, this.y + this.h * 0.75));
    } else if (this.jetLoop) { this.jetLoop.stop(); this.jetLoop = null; }
    this.vy += GRAV * dt;
    this.vy = clamp(this.vy, -900, 1250);
    if (this.grounded && !thrusting) this.fuel = Math.min(100, this.fuel + 26 * dt);
    for (const o of map.objects) if (o.name.startsWith("fp_b") && Math.abs(o.x - this.cx()) < 70 && Math.abs(o.y - this.y - this.h) < 90) this.fuel = Math.min(100, this.fuel + 55 * dt);

    /* matter resolves the collisions: hand it this frame's velocity (px/step) */
    if (this.body) window.Matter.Body.setVelocity(this.body, { x: this.vx * dt, y: this.vy * dt });

    if (Math.abs(this.vx) > 40 && this.grounded) this.walkT += dt * Math.abs(this.vx) * 0.03; else this.walkT = 0;

    if (input.aimX !== undefined && input.aimX !== null) {
      this.aim = Math.atan2(input.aimY - this.shoulderY(), input.aimX - this.cx());
    }
    this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;
    /* guest: weapon sim is host-side; run a cosmetic flash/recoil so the player
       still sees their own barrel working (real ammo arrives via snapshots) */
    if (G.isGuest && this === G.me) {
      if (input.fire && !this.dead && this.reloading <= 0 && this.shootT <= 0 && this.ammo > 0 && !this.weapon.melee && !this.weapon.flame) {
        this.flashT = G._flashHold ? 0.5 : 0.05; this.recoilT = this.weapon.kick || 0.08; this.shootT = 60 / this.weapon.rpm;
      }
    } else this.fire(input.fire, dt);
  }

  /* after the matter step: read back position, ground contact, void death */
  postPhysics() {
    if (!this.body || this.dead) return;
    const wasGrounded = this.grounded, fallV = this.vy;
    this.x = this.body.position.x - this.w / 2;
    this.y = this.body.position.y - this.h / 2;
    this.x = clamp(this.x, 0, G.map.w - this.w);
    this.grounded = this.vy >= 0 && G.map.rectHitsWorld(this.x + 2, this.y + this.h - 2, this.w - 4, 8);
    if (this.grounded) {
      if (!wasGrounded && fallV > 500) Sfx.play("boots", 0.25);
      this.vy = 0;
    }
    if (!Number.isFinite(this.x + this.y)) this.respawn();
    if (this.y > G.map.h + 300) { this.hp = 0; this.die(null); }
  }

  update(dt) {
    if (this.ghost) return;                 /* remote render stub */
    if (this.isBot) botThink(this, dt);
    let input;
    if (this === G.me) input = humanInput();
    else if (this.isBot) input = (this.ai && this.ai.input) || {}; /* botThink output MUST be consumed */
    else if (this.remoteInput) input = this.remoteInput;
    else input = {};
    this.physics(dt, input);
  }

  draw() {
    if (this.dead) return;
    /* drop shadow projected onto the ground below — flat-green canopy tiles
       would otherwise read as "floating in mid-air" */
    const ground = G.map.groundBelow(this.cx(), this.y + this.h, 420);
    if (ground) {
      const d = ground.y - (this.y + this.h);
      ctx.fillStyle = `rgba(0,0,0,${clamp(0.30 - d * 0.0009, 0.06, 0.30)})`;
      ctx.beginPath();
      ctx.ellipse(this.cx(), ground.y - 3, clamp(24 - d * 0.05, 9, 24), clamp(6 - d * 0.012, 2.5, 6), 0, 0, TAU);
      ctx.fill();
    }
    if (this.invuln > 0 && Math.floor(G.time * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    const m = G.menu, k = this.metrics();
    const px = this.cx(), py = this.y + this.h;
    const walk = this.walkT ? Math.sin(this.walkT * 10) : 0;
    const bob = this.grounded && this.walkT ? Math.abs(Math.cos(this.walkT * 10)) * 2 : 0;

    ctx.save();
    ctx.translate(px, py - bob);
    if (this.facing < 0) ctx.scale(-1, 1);

    /* part orientations (pixel-verified): head, legs, arms and guns all face
       RIGHT naturally — no per-part flips; the outer facing mirror alone turns
       the whole soldier when aiming left. Legs swing from hip pivots. */
    const legSwing = this.walkT ? walk * 0.35 : 0;
    m.drawA(ctx, this.skin.leg, -8, -k.hip, SPR, legSwing, 1, 0.5, 0.08, false);
    m.drawA(ctx, this.skin.leg, 8, -k.hip, SPR, -legSwing, 1, 0.5, 0.08, false);
    m.drawA(ctx, this.skin.body, 0, -k.hip, SPR, 0, 1, 0.5, 1, false);
    m.drawA(ctx, this.skin.head, 1, -k.neck + 9, SPR, 0, 1, 0.5, 0.92, false);   /* pushed down: beard overlaps the collar */

    /* gun assembly pivots at the shoulder; grip-anchored so the stock sits
       behind the shoulder and the barrel leads. Recoil kicks it back/up. */
    const aim = this.facing < 0 ? Math.PI - this.aim : this.aim;
    const kick = clamp(this.recoilT / (this.weapon.kick || 0.08), 0, 1);
    const swing = this.weapon.melee && this.swingT > 0 ? Math.sin((0.22 - this.swingT) / 0.22 * Math.PI) * 1.4 - 0.7 : 0;
    const gw = (m.frameSize(this.weapon.sprite).w || 60) * SPR;
    ctx.save();
    ctx.translate(2, -k.shoulder);
    ctx.rotate(aim + swing - kick * 0.10);
    m.drawA(ctx, this.skin.arm, 0, 1, SPR, 0.16 + kick * 0.06, 1, 0.10, 0.5, false);         /* rear arm -> grip */
    /* gun, grip at pivot; the no-mag art shows while reloading (mag-swap look) */
    const gunName = this.reloading > 0 && this.weapon.empty ? this.weapon.empty : this.weapon.sprite;
    const gh = (m.frameSize(this.weapon.sprite).h || 40) * SPR;
    m.drawA(ctx, gunName, -kick * 9, 2, SPR, 0, 1, 0.28, 0.58, false);
    /* magazine drops out and slides back in over the course of the reload */
    if (this.reloading > 0 && this.weapon.magFrame) {
      const t = 1 - this.reloading / (this.weapon.reload || 1);
      let dy = 0, magRot = 0, a = 0;
      if (t < 0.42) { const p = t / 0.42; dy = p * p * 44; magRot = p * 0.9; a = 1 - p * 0.9; }
      else if (t > 0.62) { const p = (1 - t) / 0.38; dy = p * p * 44; magRot = p * 0.9; a = 1 - p * 0.85; }
      if (a > 0.03) m.drawA(ctx, this.weapon.magFrame, gw * 0.36 - kick * 9, 4 + gh * 0.30 + dy, SPR, magRot, a, 0.5, 0.12, false);
    }
    /* muzzle flash: additive flare burst at the barrel tip */
    if (this.flashT > 0 && !this.weapon.melee && !this.weapon.flame) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      m.drawA(ctx, "flare.png", gw * 0.72 + 6 - kick * 9, 2, SPR * (0.55 + Math.random() * 0.35), rnd(0, TAU), clamp(this.flashT * 22, 0, 1), 0.5, 0.5, false);
      ctx.restore();
    }
    m.drawA(ctx, this.skin.arm, gw * 0.08, 2, SPR, -0.05 - kick * 0.04, 1, 0.10, 0.5, false); /* front arm -> foregrip */
    ctx.restore();

    ctx.restore();
    ctx.globalAlpha = 1;

    if (this !== G.me) {
      ctx.font = "11px Trebuchet MS"; ctx.textAlign = "center";
      ctx.fillStyle = G.isGuest || G.isHost ? "#ffd76e" : "#ffb04a";
      ctx.fillText(this.name, px, this.y - 26);
      ctx.fillStyle = "#000a"; ctx.fillRect(px - 26, this.y - 22, 52, 5);
      ctx.fillStyle = "#e74c3c"; ctx.fillRect(px - 25, this.y - 21, 50 * clamp(this.hp / 100, 0, 1), 3);
    }
    if (this.shieldT > 0) {
      ctx.strokeStyle = "rgba(120,200,255,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, this.y + this.h / 2, 70, 0, TAU); ctx.stroke();
    }
  }
}

/* ---------------------------------------------------------- helpers */
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

function raycast(x, y, ang, maxD) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  for (let d = 0; d < maxD; d += 16) {
    const px = x + dx * d, py = y + dy * d;
    if (G.map.solidAtPixel(px, py) || px < 0 || py < 0 || px > G.map.w || py > G.map.h) return { x: px, y: py };
  }
  return { x: x + dx * maxD, y: y + dy * maxD };
}

function segHitsRect(x0, y0, x1, y1, r) {
  const steps = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 12));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

function bloodBurst(x, y, n) {
  for (let i = 0; i < n; i++) G.particles.push({
    img: G.imgs.blood, x, y, vx: rnd(-260, 260), vy: rnd(-360, 60), rot: rnd(0, TAU), vr: rnd(-8, 8),
    s: rnd(0.15, 0.3), life: rnd(0.4, 0.8), t: 0, grav: 1, fade: true,
  });
}
function sparks(x, y, n) {
  for (let i = 0; i < n; i++) G.particles.push({
    img: G.imgs.spark, x, y, vx: rnd(-200, 200), vy: rnd(-200, 200), rot: 0, vr: rnd(-10, 10),
    s: rnd(0.1, 0.2), life: rnd(0.15, 0.35), t: 0, grav: 0.3, fade: true,
  });
}
function smokePuff(x, y) {
  return { img: G.imgs.smoke, x, y, vx: rnd(-30, 30), vy: rnd(40, 120), rot: rnd(0, TAU), vr: rnd(-2, 2), s: rnd(0.12, 0.22), life: rnd(0.4, 0.8), t: 0, grav: -0.1, fade: true };
}

function explode(x, y, def, owner) {
  G.fx.push({ x, y, t: 0, dur: 0.30, r: def.splash });
  G.camera.shake = Math.min(14, G.camera.shake + 10);
  Sfx.play("explode", 0.8, rnd(0.9, 1.1));
  netEvent({ t: "boom", x: Math.round(x), y: Math.round(y), r: def.splash });
  for (const p of G.players) {
    if (p.dead) continue;
    const d = Math.hypot(p.cx() - x, p.cy() - y);
    if (d < def.splash) {
      let dmg = def.dmg * (1 - d / def.splash);
      if (p === owner) dmg *= 0.45;
      if (dmg > 1) {
        p.damage(dmg, owner);
        const dx = p.cx() - x, dy = p.cy() - y, inv = d > 0.001 ? 1 / d : 0; /* d==0 must not NaN-poison physics */
        p.vx += dx * inv * 420; p.vy += dy * inv * 420 - 120;
      }
    }
  }
  for (let i = 0; i < 10; i++) sparks(x + rnd(-40, 40), y + rnd(-40, 40), 2);
}

/* ---------------------------------------------------------- bot AI */
function botThink(b, dt) {
  const ai = b.ai; ai.t -= dt;
  const target = G.me.dead ? pick(G.players.filter(p => p !== b && !p.isBot)) : G.me;
  if (ai.t <= 0) {
    ai.t = rnd(0.25, 0.5);
    ai.wantX = target ? target.cx() + ai.side * rnd(0.4, 1.1) : b.cx();
    if (Math.random() < 0.15) ai.side *= -1;
    if (Math.random() < 0.3 && b.grounded) b.vy = -rnd(300, 550);
  }
  const input = { left: false, right: false, jet: false, fire: false, aimX: null, aimY: null };
  const dx = ai.wantX - b.cx();
  if (Math.abs(dx) > 40) { if (dx < 0) input.left = true; else input.right = true; }
  if (target) {
    if (target.cy() < b.cy() - 140 && Math.random() < 0.7) input.jet = true;
    if (b.grounded && Math.abs(b.vx) < 30 && Math.abs(dx) > 60) input.jet = true;
    const los = !segHitsSolid(b.cx(), b.shoulderY(), target.cx(), target.cy());
    input.aimX = target.cx() + rnd(-40, 40);
    input.aimY = target.cy() + rnd(-30, 30);
    const dist = Math.hypot(target.cx() - b.cx(), target.cy() - b.cy());
    input.fire = los && dist < 1300 && !target.dead;
  }
  ai.input = input;
}
function segHitsSolid(x0, y0, x1, y1) {
  const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 32);
  for (let i = 1; i <= steps; i++) { const t = i / steps; if (G.map.solidAtPixel(lerp(x0, x1, t), lerp(y0, y1, t))) return true; }
  return false;
}

/* ---------------------------------------------------------- pickups */
function initPickups() {
  G.pickups = [];
  for (const o of G.map.objects) {
    if (o.name.startsWith("wp_p") || o.name.startsWith("ctf_wp")) {
      const list = (o.props.weapon || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!list.length) continue;
      G.pickups.push({ x: o.x, y: o.y, list, idx: Math.floor(Math.random() * list.length), respawn: 0 });
    }
  }
}

function updatePickups(dt) {
  if (G.isGuest) return; /* host authoritative */
  for (const k of G.pickups) {
    if (k.respawn > 0) { k.respawn -= dt; continue; }
    for (const p of G.players) {
      if (p.dead || p.ghost) continue;
      if (Math.abs(p.cx() - k.x) < 46 && Math.abs(p.cy() - k.y) < 56) {
        const id = k.list[k.idx % k.list.length];
        k.idx = (k.idx + 1) % k.list.length;
        const w = WEAPONS[id];
        if (w) {
          if (w.item === "health") { p.hp = 100; if (p === G.me) Sfx.play("pickup", 0.6); }
          else if (w.item === "fuel") { p.fuel = 100; if (p === G.me) Sfx.play("pickup", 0.6); }
          else if (w.item === "shield") { p.shieldT = 10; if (p === G.me) Sfx.play("pickup", 0.6); }
          else { p.equip(w, true); if (p === G.me) Sfx.play("weps", 0.5); } /* silent: equip's switch sfx would play on host for every remote grab */
          k.respawn = w.item ? 12 : 8;
          netEvent({ t: "pk", i: G.pickups.indexOf(k), idx: k.idx, rsp: k.respawn });
          break;
        } else if (NADES[id]) {
          p.nades = Math.min(6, p.nades + 2); if (p === G.me) Sfx.play("grenades", 0.5);
          k.respawn = 10;
          netEvent({ t: "pk", i: G.pickups.indexOf(k), idx: k.idx, rsp: k.respawn });
          break;
        }
      }
    }
  }
}

function drawPickups() {
  for (const k of G.pickups) {
    if (k.respawn > 0) continue;
    const id = k.list[k.idx % k.list.length];
    const w = WEAPONS[id] || NADES[id];
    if (!w) continue;
    const bob = Math.sin(G.time * 3 + k.x) * 6;
    /* shadow lands on the ground below the pad, so pickups read as "above
       the floor you can reach" instead of hanging in the void */
    const ground = G.map.groundBelow(k.x, k.y + 10, 320);
    if (ground) {
      const d = ground.y - k.y;
      ctx.fillStyle = `rgba(0,0,0,${clamp(0.25 - d * 0.0009, 0.05, 0.25)})`;
      ctx.beginPath();
      ctx.ellipse(k.x, ground.y - 2, clamp(30 - d * 0.05, 10, 30), clamp(7 - d * 0.012, 3, 7), 0, 0, TAU);
      ctx.fill();
    }
    G.menu.draw(ctx, w.sprite, k.x, k.y + bob - 22, (w.item || NADES[id]) ? 0.5 : 0.42);
  }
}

/* ---------------------------------------------------------- world update */
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.life -= dt;
    if (b.life <= 0) { G.bullets.splice(i, 1); continue; }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 20));
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      if (b.arc) b.vy += 900 * dt / steps;
      if (G.map.solidAtPixel(b.x, b.y)) {
        if (b.rocket) { if (!b.ghost) explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner); }
        else if (!b.flame) { sparks(b.x, b.y, 2); if (Math.random() < 0.3) Sfx.play("ricochet", 0.15); }
        hit = true; break;
      }
      if (b.ghost) continue; /* visual-only bullets never damage */
      for (const p of G.players) {
        if (p === b.owner || p.dead || p.invuln > 0) continue;
        if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
          if (b.rocket) explode(b.x, b.y, { splash: b.splash, dmg: b.dmg }, b.owner);
          else p.damage(b.dmg, b.owner);
          hit = true; break;
        }
      }
    }
    if (hit) G.bullets.splice(i, 1);
  }
}

function updateNades(dt) {
  const M = window.Matter;
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.t += dt;
    if (n.body) {
      /* physical nade: legacy gravity, matter resolves the bounces */
      n.vy = clamp(n.vy + 1300 * dt, -1800, 1800);
      M.Body.setVelocity(n.body, { x: n.vx * dt, y: n.vy * dt });
      n.x = n.body.position.x; n.y = n.body.position.y;
    } else {
      /* guest ghost (visual only): legacy integration */
      n.vy += 1300 * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(n.vx, n.vy) * dt / 16));
      for (let s = 0; s < steps; s++) {
        const nx = n.x + n.vx * dt / steps, ny = n.y + n.vy * dt / steps;
        if (G.map.solidAtPixel(nx, n.y)) n.vx *= -0.45; else n.x = nx;
        if (G.map.solidAtPixel(n.x, ny)) n.vy *= -0.45; else n.y = ny;
      }
    }
    const prox = !n.ghost && n.def.proxy && n.t > 0.8 && G.players.some(p => p !== n.owner && !p.dead && Math.hypot(p.cx() - n.x, p.cy() - n.y) < n.def.proxy);
    if (n.t >= (n.fuse || 2) || prox) {
      if (!n.ghost) {
        if (n.body && G.engine) M.Composite.remove(G.engine.world, n.body);
        explode(n.x, n.y, { splash: n.def.splash, dmg: n.def.dmg }, n.owner);
      }
      G.nades.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.t += dt; if (p.t >= p.life) { G.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * p.grav * dt; p.rot += p.vr * dt;
  }
  for (let i = G.fx.length - 1; i >= 0; i--) { G.fx[i].t += dt; if (G.fx[i].t > G.fx[i].dur) G.fx.splice(i, 1); }
  for (let i = G.beams.length - 1; i >= 0; i--) { G.beams[i].t -= dt; if (G.beams[i].t <= 0) G.beams.splice(i, 1); }
}

/* ---------------------------------------------------------- camera */
function updateCamera(dt) {
  const cam = G.camera;
  cam.zoomT = G._zoomOverride ? G._zoomOverride : ((mouse.rdown && G.me.weapon.zoom) ? 1.8 : 1);
  cam.zoom = lerp(cam.zoom, cam.zoomT, 1 - Math.pow(0.001, dt));
  cam.vw = G.W / cam.zoom; cam.vh = G.H / cam.zoom;
  const p = G.me;
  let tx = p.cx() - cam.vw / 2, ty = p.cy() - cam.vh / 2;
  cam.x = lerp(cam.x, clamp(tx, 0, Math.max(0, G.map.w - cam.vw)), 1 - Math.pow(0.0001, dt));
  cam.y = lerp(cam.y, clamp(ty, 0, Math.max(0, G.map.h - cam.vh)), 1 - Math.pow(0.0001, dt));
  cam.shake = Math.max(0, cam.shake - 40 * dt);
}

/* ---------------------------------------------------------- render */
function drawWorld() {
  const cam = G.camera;
  ctx.fillStyle = "#8ecbf0"; ctx.fillRect(0, 0, G.W, G.H);

  /* parallax background matched to map theme */
  const bgImg = G.map.bgImage;
  const bgS = cam.vh * 1.25;
  const bgy = clamp((cam.vh - bgS) / 2 + cam.y * 0.1, -200, 0);
  ctx.save();
  ctx.translate(-cam.x * 0.3, -cam.y * 0.15 + bgy);
  const bw = bgImg.width * (bgS / bgImg.height);
  const startX = Math.floor(cam.x * 0.3 / bw) * bw;
  for (let x = startX, _g = 0; x < cam.x * 0.3 + cam.vw; x += bw - 1) { ctx.drawImage(bgImg, x, 0, bw, bgS); TRIP("parallax", ++_g, 200); }
  ctx.restore();

  ctx.save();
  const sx = cam.shake ? rnd(-cam.shake, cam.shake) : 0, sy = cam.shake ? rnd(-cam.shake, cam.shake) : 0;
  ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x + sx, -cam.y + sy);

  G.map.drawLayer(ctx, G.map.layers[0], cam, 0.9);
  for (const o of G.map.objects) if (o.name === "spritebg") G.menu.draw(ctx, o.props.sprite + ".png", o.x, o.y, 0.9);
  for (const o of G.map.objects) {
    if (o.name.startsWith("fp_b")) {
      const sp = o.props.sprite || "flagStationBlue";
      G.menu.draw(ctx, sp + ".png", o.x, o.y + 30, 0.8);
      const flag = sp.includes("Orange") ? "flagOrange.png" : "flagBlue.png";
      G.menu.draw(ctx, flag, o.x + Math.sin(G.time * 2 + o.x) * 4, o.y - 40, 0.55, Math.sin(G.time * 2 + o.x) * 0.08);
    }
  }
  G.map.drawLayer(ctx, G.map.solid, cam, 1);
  drawPickups();
  for (const p of G.players) if (p !== G.me) p.draw();
  if (G.isGuest) for (const r of G.remotes.values()) r.draw();
  G.me.draw();

  for (const b of G.bullets) {
    if (b.flame) {
      ctx.globalAlpha = clamp(b.life * 3, 0, 1);
      G.menu.draw(ctx, "flame1.png", b.x, b.y, b.r / 40, rnd(0, TAU));
      ctx.globalAlpha = 1; continue;
    }
    const ang = Math.atan2(b.vy, b.vx);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang);
    if (b.rocket) { G.menu.draw(ctx, "rocket.png", 0, 0, 0.4, 0); G.menu.draw(ctx, "flare.png", -20, 0, 0.3, rnd(0, TAU)); }
    else ctx.drawImage(G.imgs.bullet, -G.imgs.bullet.width * 0.25, -G.imgs.bullet.height * 0.25, G.imgs.bullet.width * 0.5, G.imgs.bullet.height * 0.5);
    ctx.restore();
  }
  for (const n of G.nades) G.menu.draw(ctx, n.def.sprite, n.x, n.y, 0.4, G.time * 6);

  for (const bm of G.beams) {
    ctx.strokeStyle = `rgba(255,60,60,${clamp(bm.t * 12, 0, 1)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bm.x0, bm.y0); ctx.lineTo(bm.x1, bm.y1); ctx.stroke();
  }

  for (const p of G.particles) {
    ctx.globalAlpha = p.fade ? clamp(1 - p.t / p.life, 0, 1) : 1;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    const iw = p.img.width * p.s, ih = p.img.height * p.s;
    ctx.drawImage(p.img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  for (const f of G.fx) {
    const t = f.t / f.dur;
    G.menu.draw(ctx, "explosion.png", f.x, f.y, 0.25 + t * 1.2, rnd(0, TAU), 1 - t);
  }

  for (const o of G.map.objects) if (o.name === "spritefg") G.menu.draw(ctx, o.props.sprite + ".png", o.x, o.y, 0.95);

  drawColliders();
  ctx.restore();
}

/* ------------------------------------------------ collider debug overlay */
/* Draws every matter.js body in world space: terrain rects (green), boundary
   walls (purple), soldier boxes (orange), nade circles (yellow). Toggle with
   ` or start via ?colliders. */
function drawColliders() {
  const M = window.Matter;
  if (!G.showColliders || !G.engine || !M) return;
  const style = b => b._nade ? { f: "rgba(255,215,50,.10)", s: "#ffd732" }
    : b._soldier ? { f: "rgba(255,140,40,.10)", s: "#ff8c28" }
    : b._wall ? { f: "rgba(200,90,230,.10)", s: "#c85ae6" }
    : { f: "rgba(60,220,120,.08)", s: "#3cdc78" };   /* default: terrain */
  ctx.lineWidth = 3;   /* solid opaque borders — visible over any tile art */
  ctx.lineJoin = "miter";
  for (const b of M.Composite.allBodies(G.engine.world)) {
    const c = style(b);
    ctx.beginPath();
    if (b.circleRadius) {
      ctx.moveTo(b.position.x + b.circleRadius, b.position.y);
      ctx.arc(b.position.x, b.position.y, b.circleRadius, 0, TAU);
    } else {
      const v = b.vertices;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
    }
    ctx.fillStyle = c.f; ctx.fill();
    ctx.strokeStyle = c.s; ctx.stroke();
  }
}

/* ---------------------------------------------------------- HUD */
function drawHUD() {
  const p = G.me;
  ctx.save();
  ctx.fillStyle = "#000a"; ctx.fillRect(16, 16, 220, 46);
  ctx.fillStyle = "#222e3d"; ctx.fillRect(20, 20, 180, 12);
  ctx.fillStyle = p.hp > 35 ? "#6fdc7a" : "#e74c3c";
  ctx.fillRect(20, 20, 180 * clamp(p.hp / 100, 0, 1), 12);
  ctx.fillStyle = "#222e3d"; ctx.fillRect(20, 36, 180, 10);
  ctx.fillStyle = "#7ec3f0"; ctx.fillRect(20, 36, 180 * clamp(p.fuel / 100, 0, 1), 10);
  ctx.font = "bold 11px Trebuchet MS"; ctx.fillStyle = "#cfe2f3"; ctx.textAlign = "left";
  ctx.fillText("HEALTH", 206, 30); ctx.fillText("FUEL", 206, 45);
  ctx.fillStyle = "#000a"; ctx.fillRect(16, 68, 220, 40);
  G.menu.draw(ctx, p.weapon.sprite, 40, 88, 0.28);
  ctx.fillStyle = "#e8f0f8"; ctx.font = "bold 13px Trebuchet MS";
  ctx.fillText(p.weapon.name, 70, 82);
  ctx.font = "bold 20px Trebuchet MS"; ctx.fillStyle = p.ammo === 0 ? "#e74c3c" : "#ffd76e";
  ctx.fillText(p.reloading > 0 ? "RELOADING" : (p.weapon.melee ? "∞" : `${p.ammo}/${p.weapon.mag}`), 70, 100);
  ctx.font = "11px Trebuchet MS"; ctx.fillStyle = "#9fb4c8";
  ctx.fillText("✦ " + p.nades, 24, 102);

  const others = G.isGuest ? G.remotes.size
    : G.isHost ? G.players.length - 1
    : G.players.filter(b => b.isBot).reduce((a, b) => a + b.kills, 0);
  const rightLbl = (G.isGuest || G.isHost) ? "PLAYERS" : "FOES";
  ctx.textAlign = "center"; ctx.fillStyle = "#000a"; ctx.fillRect(G.W / 2 - 120, 12, 240, 24);
  ctx.fillStyle = "#ffd76e"; ctx.font = "bold 13px Trebuchet MS";
  const net = G.net ? (G.isHost ? " · HOSTING" : " · ONLINE") : "";
  ctx.fillText(`YOU ${G.kills}   ·   ${G.mapLabel.toUpperCase()}${net}   ·   ${rightLbl} ${others}`, G.W / 2, 29);
  if (G.net && !G.net.connected) {
    ctx.fillStyle = "#e74c3c"; ctx.font = "bold 12px Trebuchet MS";
    ctx.fillText("· CONNECTION LOST ·", G.W / 2, 46);
  }

  ctx.textAlign = "right"; ctx.font = "10px Trebuchet MS"; ctx.fillStyle = "#5f7188";
  ctx.fillText("WASD move · W jetpack · mouse aim · LMB fire · G nade · R reload · RMB scope · M mute", G.W - 14, G.H - 12);

  if (G.showColliders) {   /* collider overlay legend */
    const LEG = [["#3cdc78", "terrain"], ["#c85ae6", "boundary"], ["#ff8c28", "soldier"], ["#ffd732", "nade"]];
    ctx.textAlign = "left"; ctx.font = "10px Trebuchet MS";
    let lx = 16;
    for (const [col, lbl] of LEG) {
      ctx.fillStyle = col; ctx.fillRect(lx, G.H - 22, 8, 8);
      ctx.fillStyle = "#cfe2f3"; ctx.fillText(lbl, lx + 12, G.H - 15);
      lx += 78;
    }
  }

  if (p.dead) {
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(8,10,16,0.55)"; ctx.fillRect(0, 0, G.W, G.H);
    ctx.fillStyle = "#e74c3c"; ctx.font = "bold 34px Trebuchet MS";
    ctx.fillText("YOU DIED", G.W / 2, G.H / 2 - 10);
    ctx.fillStyle = "#cfe2f3"; ctx.font = "14px Trebuchet MS";
    ctx.fillText(`respawning in ${Math.max(0, p.deadT).toFixed(1)}s`, G.W / 2, G.H / 2 + 22);
  }
  ctx.restore();
}

function drawSticks() {
  for (const s of [touchCtl.move, touchCtl.aim]) {
    if (!s) continue;
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, 44, 0, TAU); ctx.stroke();
    const dx = clamp(s.x - s.ox, -44, 44), dy = clamp(s.y - s.oy, -44, 44);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.arc(s.ox + dx, s.oy + dy, 18, 0, TAU); ctx.fill();
  }
}

/* ---------------------------------------------------------- loop */
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (!G.ready) return;
  const dt = clamp((t - lastT) / 1000 || 0.016, 0.001, 0.033); lastT = t;
  G.time += dt;
  for (const p of G.players) p.update(dt);
  updateNades(dt);                      /* hands matter this frame's nade velocities */
  if (G.engine) {
    window.Matter.Engine.update(G.engine, 1000 / 60);
    for (const p of G.players) p.postPhysics();
    /* capture bounce results (velocity is px per 1/60s step) */
    for (const n of G.nades) if (n.body) {
      n.x = n.body.position.x; n.y = n.body.position.y;
      n.vx = n.body.velocity.x * 60; n.vy = n.body.velocity.y * 60;
    }
  }
  if (G.isGuest) {
    /* interpolate remote stubs toward authoritative targets */
    for (const r of G.remotes.values()) {
      if (r.tx !== undefined) {
        r.x = lerp(r.x, r.tx, 0.25);   /* snapshot x,y are already top-left — never re-shift anchors */
        r.y = lerp(r.y, r.ty, 0.25);
        r.aim = lerp(r.aim, r.taim, 0.3);
        r.facing = Math.cos(r.aim) >= 0 ? 1 : -1;
        r.walkT = 0;
      }
    }
  }
  updateBullets(dt); updateParticles(dt); updatePickups(dt);
  hostTick(dt); guestTick(dt);
  updateCamera(dt);
  drawWorld(); drawHUD();
  if ("ontouchstart" in window) drawSticks();
}

boot();
requestAnimationFrame(frame);
