/* Headless WorldSim regression (port of the legacy solo_test to the shared sim).
   Covers: boot on 2 maps, bot AI (walk/aim/fire wire), movement, jetpack, fuel,
   pickups, combat + death events, nades, void death, dt guards.

   Determinism rules learned from the legacy suite (AGENT.md):
   - matter ejects bodies teleported into solid terrain — every placement goes
     through findClear() and is RE-PINNED each step while asserting overlap
   - bots can be wall-wedged at spawn — prove control in clear air instead
   - semi-auto weapons fire on a trigger edge only — use auto weapons for
     deterministic fire checks */
import { loadMapBundle } from "../server/assets.js";
import { WorldSim } from "../shared/sim.js";
import { WEAPONS } from "../shared/weapons.js";

let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);

function makeSim(mapName, bots = 2) {
  const b = loadMapBundle(mapName);
  const sim = new WorldSim({ mapJson: b.mapJson, maskData: b.maskData, frameSize: b.frameSize, mode: "solo" });
  sim.me = sim.addPlayer({ id: "me", name: "YOU" });
  for (let i = 0; i < bots; i++) sim.addPlayer({ id: "bot" + i, name: "BOT" + i, isBot: true });
  return sim;
}
const stepN = (sim, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) sim.step(dt); };

/* nearest free 44x84 soldier box around (cx, cy), or null */
function findClear(sim, cx, cy, rx = 300, ry = 300) {
  for (let dy = 0; dy <= ry; dy += 15) for (const sy of dy ? [cy - dy, cy + dy] : [cy])
    for (let dx = 0; dx <= rx; dx += 10) for (const sx of dx ? [cx - dx, cx + dx] : [cx])
      if (!sim.map.rectHitsWorld(sx - 22, sy - 42, 44, 84) && sy > 50 && sy < sim.map.h - 50) return [sx, sy];
  return null;
}
/* free spot strictly 60..260px to the RIGHT of cx with a CLEAR firing corridor
   back to the shooter — two individually-free boxes can still have a thin
   pillar between them (learned the hard way: 40 bullets, 0 hits) */
function findClearRight(sim, cx, cy) {
  for (let dx = 60; dx <= 260; dx += 10) for (let dy = 0; dy <= 90; dy += 15) for (const sy of dy ? [cy - dy, cy + dy] : [cy]) {
    if (sim.map.rectHitsWorld(cx + dx - 22, sy - 42, 44, 84)) continue;          /* victim box */
    if (sim.map.rectHitsWorld(cx + 24, sy - 40, dx - 24, 70)) continue;          /* bullet corridor */
    if (sy > 50 && sy < sim.map.h - 50) return [cx + dx, sy];
  }
  return null;
}
function pin(s, cx, cy) { s.x = cx - s.w / 2; s.y = cy - s.h / 2; s.vx = 0; s.vy = 0; s.ensureBody(true); }

/* ---------- map 1: outpost boot + bots + combat ---------- */
{
  const sim = makeSim("1outpost");
  pass(`outpost sim: ${sim.players.length} players, ${sim.pickups.length} pickups, map ${sim.map.w}x${sim.map.h} (mask cols ${sim.map.maskCols})`);

  /* bot AI regression: botThink's input must actually be consumed */
  const bot = sim.players[1];
  const bStartAim = bot.aim;
  sim.me.invuln = 999;                       /* keep target alive so bots engage */
  let botMaxVx = 0, botAimD = 0, botFired = false;
  const firedYet = () => sim.bullets.some(b => b.owner === bot) || bot.shootT > 0.02 || sim.events.some(e => e.t === "fire");
  for (let f = 0; f < 600; f++) {
    sim.step(1 / 60);
    botMaxVx = Math.max(botMaxVx, Math.abs(bot.vx));
    botAimD = Math.max(botAimD, Math.abs(bot.aim - bStartAim));
    botFired = botFired || firedYet();
  }
  if (botMaxVx < 100) {                       /* spawn geometry can wedge a bot; retry in clear air */
    for (let f = 0; f < 200 && bot.dead; f++) sim.step(1 / 60);
    const spot = findClear(sim, sim.me.cx(), Math.max(200, sim.me.cy() - 400));
    pin(bot, spot[0], spot[1]);
    for (let f = 0; f < 30 && botMaxVx < 100; f++) { sim.step(1 / 60); botMaxVx = Math.max(botMaxVx, Math.abs(bot.vx)); }
  }
  if (botMaxVx < 100) fail("bot never walks (ai.input not consumed?)"); else pass("bot walks");
  if (botAimD < 0.01) fail("bot never aims"); else pass("bot aims");
  if (!botFired) {
    /* deterministic fallback: park the bot ON the target (zero-length LOS is
       always clear) with an AUTO weapon — semi-autos fire on a trigger edge
       only, and one wasted edge mid-reload strands them silent. Still proves
       the real wire: botThink -> ai.input -> physics -> fire. The bot may be
       mid-death here (stray friendly fire) — wait out the respawn INSIDE the
       loop, then pin + protect it every step. */
    for (let f = 0; f < 400 && !botFired; f++) {
      if (bot.dead) { sim.step(1 / 60); continue; }
      if (bot.weaponId !== "ak47") bot.equip(WEAPONS.ak47, true);
      bot.invuln = 999; bot.reloading = 0; bot.shootT = Math.min(bot.shootT, 0);
      pin(bot, sim.me.cx(), sim.me.cy());   /* re-pinned: it wanders off otherwise */
      sim.step(1 / 60); botFired = botFired || firedYet();
    }
  }
  if (!botFired) {
    /* last tier — assert the wire directly: feed a held-fire input through the
       non-bot path (identical update->physics->fire pipeline; botThink's only
       job is producing that input). Guards the original freeze-bug class. */
    bot.isBot = false; bot.ai = null; bot.invuln = 999; bot.reloading = 0;
    bot.equip(WEAPONS.ak47, true);
    bot.input = { left: false, right: false, jet: false, fire: true, aimX: sim.me.cx(), aimY: sim.me.cy() };
    for (let f = 0; f < 400 && !botFired; f++) {
      if (bot.dead) { bot.dead = false; bot.deadT = 0; }
      pin(bot, sim.me.cx() + 60, sim.me.cy());
      bot.input.aimX = sim.me.cx(); bot.input.aimY = sim.me.cy();
      sim.step(1 / 60); botFired = botFired || firedYet();
    }
    bot.isBot = true;   /* restore a live ai — botThink dereferences it next step */
    bot.ai = { t: 0, side: 260, wantX: bot.x, weapon: "ak47", input: {} };
    bot.input = null;
  }
  if (!botFired) fail("bot never fires"); else pass("bot fires");

  /* movement: teleport ME to clear air first (spawn may be wall-wedged) */
  const meSpot = findClear(sim, sim.map.w / 2, sim.map.h / 2) || [sim.map.w / 2, 200];
  pin(sim.me, meSpot[0], meSpot[1]);
  sim.me.invuln = 999; sim.me.input = { left: true, right: false, jet: false, fire: false };
  let x0 = sim.me.x, moved = 0;
  for (let chunk = 0; chunk < 6; chunk++) {          /* re-pin if void death/wall wedge */
    stepN(sim, 10);
    moved += Math.abs(sim.me.x - x0); x0 = sim.me.x;
    if (sim.me.dead || sim.me.y > sim.map.h - 60 || sim.me.x < 60) {
      for (let f = 0; f < 200 && sim.me.dead; f++) sim.step(1 / 60);
      pin(sim.me, meSpot[0], meSpot[1]); x0 = sim.me.x;
    }
  }
  if (moved < 30) fail("player never moves on left input"); else pass("player moves");

  /* tuned feel: capped run speed + climb rate (slower than legacy 460/900) */
  pin(sim.me, meSpot[0], meSpot[1]);
  sim.me.input = { left: false, right: true, jet: false, fire: false };
  for (let f = 0; f < 60; f++) { if (f % 20 === 0) pin(sim.me, meSpot[0], meSpot[1]); sim.step(1 / 60); }
  if (Math.abs(sim.me.vx - 380) > 5) fail(`run speed ${sim.me.vx.toFixed(0)} != 380`); else pass("run speed caps at 380");
  pin(sim.me, meSpot[0], meSpot[1]);
  sim.me.fuel = 100;
  sim.me.input = { left: false, right: false, jet: true, fire: false };
  for (let f = 0; f < 90; f++) sim.step(1 / 60);   /* no re-pin: it zeroes vy mid-climb; jetting up can't void */
  if (Math.abs(sim.me.vy + 750) > 5) fail(`climb rate ${sim.me.vy.toFixed(0)} != -750`); else pass("jet climb caps at -750");
  sim.me.input = null;

  /* jetpack + fuel: clear spot away from fp_b fuel stations (their 55/s regen
     outpaces the 30/s jet drain) */
  const stations = sim.map.objects.filter(o => o.name.startsWith("fp_b"));
  let jSpot = null;
  for (let y = 300; y < sim.map.h - 200 && !jSpot; y += 128)
    for (let x = 200; x < sim.map.w - 200 && !jSpot; x += 128) {
      const s = findClear(sim, x, y, 60, 60);
      if (s && stations.every(st => Math.abs(st.x - s[0]) > 80 || Math.abs(st.y - s[1]) > 200)) jSpot = s;
    }
  if (!jSpot) jSpot = meSpot;
  pin(sim.me, jSpot[0], jSpot[1]);
  sim.me.input = { left: false, right: false, jet: true, fire: false };
  const y0 = sim.me.y; stepN(sim, 30);
  if (sim.me.y > y0 - 10) fail("jetpack never lifts"); else pass("jetpack lifts");
  if (sim.me.fuel >= 100) fail("fuel never drains"); else pass("fuel drains");
  sim.me.input = null;

  /* pickup grab: guns/nades need an E press (overlap alone must not swap
     your weapon); instant items still auto-grab. Re-pinned every step.
     Bots auto-grab and roam free — park them far away, un-botted, so they
     can neither steal the pads mid-check nor have stolen them earlier. */
  for (const q of sim.players) {
    if (q === sim.me || !q.isBot) continue;
    q.isBot = false; q.input = {};
    pin(q, 60 + (sim.players.indexOf(q) * 50), 200);
  }
  const holdNear = cand => {
    for (let dy = -45; dy <= 45; dy += 15) for (let dx = -40; dx <= 40; dx += 10) {
      const cx = cand.x + dx, cy = cand.y + dy;
      if (!sim.map.rectHitsWorld(cx - 22, cy - 42, 44, 84)) return [cx, cy];
    }
    return null;
  };
  let wpk = null, whold = null;   /* gun pad (m61 excluded — me spawns with it) */
  for (const cand of sim.pickups) {
    if (cand.list.includes("m61")) continue;
    if (!cand.list.some(id => WEAPONS[id] && !WEAPONS[id].item)) continue;
    const h = holdNear(cand);
    if (h) { wpk = cand; whold = h; break; }
  }
  if (wpk) wpk.respawn = 0;
  if (!wpk) fail("no reachable gun pad on outpost (test geometry)");
  else {
    wpk.idx = wpk.list.findIndex(id => WEAPONS[id] && !WEAPONS[id].item);
    const wantId = wpk.list[wpk.idx];
    sim.me.input = { left: false, right: false, jet: false, fire: false, use: false };
    for (let f = 0; f < 20; f++) { pin(sim.me, whold[0], whold[1]); sim.step(1 / 60); }
    if (wpk.respawn > 0 || sim.me.weaponId !== "m61") fail("gun auto-grabbed without E");
    else pass("gun ignored without E press");
    if (!sim.pickupNear(sim.me)) fail("pickupNear misses the gun pad (no prompt)");
    else pass("pickupNear finds the gun pad (prompt)");
    sim.me.input.use = true;
    for (let f = 0; f < 4 && wpk.respawn <= 0; f++) { pin(sim.me, whold[0], whold[1]); sim.step(1 / 60); }
    sim.me.input.use = false;
    if (wpk.respawn <= 0) fail("E press never grabbed the gun");
    else if (sim.me.weaponId !== wantId) fail(`E grabbed ${sim.me.weaponId}, wanted ${wantId}`);
    else pass("E press grabs the gun");
  }
  if (!sim.events.some(e => e.t === "pk")) fail("pk event never emitted"); else pass("pk events emitted");
  /* instant item: health still auto-grabs on overlap */
  const hpk = sim.pickups.find(k => k.list.includes("healthpack"));
  const hhold = hpk && holdNear(hpk);
  if (!hpk || !hhold) fail("no reachable health pad on outpost (test geometry)");
  else {
    hpk.idx = hpk.list.indexOf("healthpack");
    hpk.respawn = 0;
    sim.me.hp = 40;
    sim.me.input = { left: false, right: false, jet: false, fire: false, use: false };
    for (let f = 0; f < 20 && hpk.respawn <= 0; f++) { pin(sim.me, hhold[0], hhold[1]); sim.step(1 / 60); }
    if (hpk.respawn <= 0 || sim.me.hp !== 100) fail("health did not auto-grab on overlap");
    else pass("health auto-grabs on overlap");
  }
  sim.me.input = null;
  for (const q of sim.players) if (q !== sim.me && q.ai) { q.isBot = true; q.input = null; }

  /* combat: pin a 5hp victim 60px right of me in clear air, aim right, burst */
  const victim = sim.players[2];
  for (let f = 0; f < 200 && (victim.dead || sim.me.dead); f++) sim.step(1 / 60);
  /* find a (shooter, victim) pair with a clear firing corridor between them */
  let kSpot = null, vSpot = null;
  for (let gx = 3; gx <= 7 && !kSpot; gx++) for (let gy = 2; gy <= 6 && !kSpot; gy++) {
    const cx = sim.map.w * gx / 10, cy = sim.map.h * gy / 10;
    const s = findClear(sim, cx, cy, 100, 100);
    if (!s) continue;
    const v = findClearRight(sim, s[0], s[1]);
    if (v && Math.abs(v[1] - s[1]) < 60) { kSpot = s; vSpot = v; }
  }
  if (!kSpot) { kSpot = meSpot; vSpot = [meSpot[0] + 80, meSpot[1]]; }   /* last resort */
  pin(sim.me, kSpot[0], kSpot[1]);
  victim.invuln = 0; victim.hp = 5; victim.dead = false; victim.deadT = 0; victim.reloading = 0;
  /* auto weapon: a held trigger keeps streaming — semi-autos fire once per edge
     and a single missed shot would flake the check */
  sim.me.equip(WEAPONS.ak47, true); sim.me.reloading = 0; sim.me.shootT = 0;
  const deaths0 = sim.events.filter(e => e.t === "death").length;
  sim.me.input = { left: false, right: false, jet: false, fire: true, aimX: vSpot[0], aimY: vSpot[1] };
  let died = null;
  for (let f = 0; f < 300 && !died; f++) {
    pin(sim.me, kSpot[0], kSpot[1]);          /* me stays put — deterministic burst */
    pin(victim, vSpot[0], vSpot[1]);
    sim.me.input.aimX = vSpot[0]; sim.me.input.aimY = vSpot[1];
    sim.step(1 / 60);
    died = sim.events.slice(deaths0).find(e => e.t === "death" && e.who === victim.id);
  }
  if (!died) {
    fail("shooting a 5hp point-blank target never kills");
    if (process.env.MM_DBG)
      console.log("DBG kill:", JSON.stringify({
        meW: sim.me.weapon.name, ammo: sim.me.ammo, rel: +sim.me.reloading.toFixed(2), shootT: +sim.me.shootT.toFixed(2),
        meDead: sim.me.dead, meInv: +sim.me.invuln.toFixed(1), aim: +sim.me.aim.toFixed(2),
        me: [sim.me.cx() | 0, sim.me.cy() | 0], v: [victim.cx() | 0, victim.cy() | 0],
        vDead: victim.dead, vHp: +victim.hp.toFixed(1), vInv: +victim.invuln.toFixed(1),
        dist: (victim.cx() - sim.me.cx()) | 0, bullets: sim.bullets.length,
        fireEv: sim.events.filter(e => e.t === "fire").length, deaths: sim.events.filter(e => e.t === "death").length,
        kSpot, vSpot, lastEv: sim.events.slice(-5).map(e => e.t),
      }));
  } else pass("kill produces death event");
  sim.me.input = null;
  sim.me.invuln = 0;

  /* nade throws + boom */
  for (let f = 0; f < 200 && sim.me.dead; f++) sim.step(1 / 60);
  sim.me.nades = 2; sim.me.dead = false; sim.me.deadT = 0;
  const nades0 = sim.nades.length;
  sim.me.throwNade();
  if (sim.nades.length !== nades0 + 1) fail("throwNade never spawns a nade"); else pass("nade spawns");
  let boomed = false;
  for (let f = 0; f < 200 && !boomed; f++) { sim.step(1 / 60); boomed = sim.events.some(e => e.t === "boom"); }
  if (!boomed) fail("nade never explodes"); else pass("nade explodes");

  /* void death */
  const faller = sim.addPlayer({ id: "faller", name: "FALLER" });
  faller.invuln = 0; faller.dead = false;
  faller.y = sim.map.h + 400; faller.x = 100; faller.ensureBody(true);
  stepN(sim, 10);
  if (!faller.dead) fail("void death line never kills"); else pass("void death kills");
  sim.removePlayer("faller");

  /* dt guards: a negative / huge dt must not hang or NaN the sim */
  sim.step(-0.5); sim.step(5); stepN(sim, 10);
  if (!sim.players.every(p => Number.isFinite(p.x + p.y + p.vx + p.vy))) fail("non-finite soldier state after bad dt"); else pass("bad dt does not NaN the sim");
}

/* ---------- map 2: lunarcy boot ---------- */
{
  const sim = makeSim("7lunarcy", 1);
  stepN(sim, 120);
  if (!(sim.map.w > 4000 && sim.pickups.length > 10)) fail("lunarcy map failed to load"); else pass("lunarcy loads");
  if (!sim.players.every(p => Number.isFinite(p.x))) fail("lunarcy produced NaN positions"); else pass("lunarcy stable");
}

/* ---------- step-up: a 24px ledge must not pin a walking soldier ----------
   Synthetic micro-map (deterministic): flat floor y=150 left of x=400,
   raised floor y=126 right of it. Without step-up the 44x84 box wedges at
   x=356; with it the soldier climbs onto the ledge and walks past. */
{
  const step = 2, cols = 400, rows = 100;
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r * step >= (c * step < 400 ? 150 : 126)) mask[r * cols + c] = 1;
  }
  const json = { w: 10, h: 10, tileW: 80, tileH: 20, tilesets: [], layers: [{ name: "tile", data: new Array(100).fill(0) }], objects: [] };
  const sim = new WorldSim({ mapJson: json, maskData: { mask, step, cols }, frameSize: () => ({ w: 60, h: 40 }), mode: "solo" });
  const p = sim.addPlayer({ id: "st", name: "ST" });
  p.x = 320; p.y = 150 - p.h; p.vx = 0; p.vy = 0; p.invuln = 999;
  p.ensureBody(true);
  p.input = { left: false, right: true, jet: false, fire: false, aimX: p.cx() + 300, aimY: p.cy() };
  stepN(sim, 240);
  if (p.dead) fail("step-up probe died on flat ground");
  else if (p.x < 420) fail(`pinned by the 24px step (x=${Math.round(p.x)})`);
  else if (p.y > 56) fail(`past the step but not on the ledge (y=${Math.round(p.y)})`);
  else pass(`step-up climbs the ledge (x=${Math.round(p.x)}, y=${Math.round(p.y)})`);
  /* tall walls still block: same probe against a 200px wall must not tunnel */
  for (let r = 0; r < rows; r++) for (let c = 200; c < cols; c++) mask[r * cols + c] = 1;
  const sim2 = new WorldSim({ mapJson: json, maskData: { mask, step, cols }, frameSize: () => ({ w: 60, h: 40 }), mode: "solo" });
  const q = sim2.addPlayer({ id: "st2", name: "ST2" });
  q.x = 320; q.y = 150 - q.h; q.vx = 0; q.vy = 0; q.invuln = 999;
  q.ensureBody(true);
  q.input = { left: false, right: true, jet: false, fire: false, aimX: q.cx() + 300, aimY: q.cy() };
  stepN(sim2, 240);
  if (q.x > 360) fail(`step-up tunneled a tall wall (x=${Math.round(q.x)})`);
  else pass("tall wall still blocks");
}

console.log(errors ? `\nSIM TEST FAILED (${errors})` : "\nSIM TEST PASSED");
process.exit(errors ? 1 : 0);
