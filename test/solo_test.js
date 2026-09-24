/* Solo smoke test: boots the real game headless on two different maps,
   simulates combat input, deaths, respawns, touch controls. */
const loadGame = require("./harness_lib");

(async () => {
  const lib = loadGame();
  const { G, keys, mouse, canvasStub } = lib;
  let errors = 0;
  process.on("uncaughtException", e => { errors++; console.error("UNCAUGHT:", e.stack); process.exit(1); });

  await lib.arm();
  await window.__startSolo("1outpost", true);
  if (!G.ready) { console.error("FAIL: not ready"); process.exit(1); }
  console.log("solo started:", G.players.length, "players,", G.pickups.length, "pickups, map", G.map.w + "x" + G.map.h);

  /* bot AI regression: botThink's input must actually be consumed (walk/aim/fire).
     Keep the player invulnerable: a dead target makes bots hold fire. */
  const bot = G.players[1];
  const bStartAim = bot.aim;
  G.me.invuln = 9999;
  let botMaxVx = 0, botAimD = 0, botFired = false;
  for (let f = 0; f < 240; f++) {
    lib.frames(1);
    botMaxVx = Math.max(botMaxVx, Math.abs(bot.vx));
    botAimD = Math.max(botAimD, Math.abs(bot.aim - bStartAim));
    botFired = botFired || G.bullets.some(b => b.owner === bot) || bot.shootT > 0.02;
  }
  if (botMaxVx < 100) {
    /* spawn geometry can wedge a bot against a wall; prove walking in clear air
       (y<0 has no tiles, so nothing blocks horizontal accel while it falls) */
    for (let f = 0; f < 200 && bot.dead; f++) lib.frames(1);
    bot.x = G.me.x; bot.y = -600; bot.vx = 0; bot.vy = 0;
    for (let f = 0; f < 30 && botMaxVx < 100; f++) { lib.frames(1); botMaxVx = Math.max(botMaxVx, Math.abs(bot.vx)); }
  }
  if (botMaxVx < 100) { console.error("FAIL: bot never walks (ai.input not consumed?)"); errors++; }
  if (botAimD < 0.01) { console.error("FAIL: bot never aims"); errors++; }
  if (!botFired) {
    /* deterministic firing solution: respawn the player onto safe ground and
       overlap the bot — zero-length LOS is always clear, so botThink must set
       fire=true and Soldier.fire() must consume it (shootT/ammo prove it —
       bullets alone can spawn-and-die inside a wall within one frame). */
    for (let f = 0; f < 200 && bot.dead; f++) lib.frames(1);   /* wait out any respawn */
    G.me.respawn();   /* safe de-embedded ground, alive, hp/invuln reset */
    const ammoBefore = bot.weapon.mag || 30;
    bot.x = G.me.x; bot.y = G.me.y; bot.vx = 0; bot.vy = 0;
    bot.ammo = ammoBefore; bot.reloading = 0;
    for (let f = 0; f < 120 && !botFired; f++) {
      lib.frames(1);
      botFired = botFired || G.bullets.some(b => b.owner === bot) || bot.shootT > 0.02 || bot.ammo !== ammoBefore;
    }
  }
  if (!botFired) { console.error("FAIL: bot never fires"); errors++; }
  console.log("bot check: vx", Math.round(botMaxVx), "aimD", +botAimD.toFixed(2), "fired", botFired);
  G.me.invuln = 0; G.me.hp = 100;

  /* combat sim */
  keys.KeyD = true; keys.KeyW = true; mouse.down = true; mouse.x = 900; mouse.y = 200;
  for (let f = 0; f <= 600; f++) {
    if (f === 200) { keys.KeyD = false; keys.KeyA = true; mouse.x = 300; mouse.y = 500; }
    if (f === 250) G.me.throwNade();
    if (f === 300) { G.me.equip(WEAPONS.smaw); G.me.ammo = 3; }
    if (f === 400) { G.me.equip(WEAPONS.shotgun); G.me.ammo = 8; }
    if (f === 500) G.me.damage(999, G.players[1]);
    lib.frames(1);
  }
  console.log("after sim: pos", Math.round(G.me.x), Math.round(G.me.y), "hp", Math.round(G.me.hp), "kills", G.kills);

  /* touch path */
  canvasStub.fire("touchstart", { changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }, { identifier: 2, clientX: 900, clientY: 400 }], preventDefault() {} });
  canvasStub.fire("touchmove", { changedTouches: [{ identifier: 1, clientX: 260, clientY: 340 }, { identifier: 2, clientX: 950, clientY: 300 }], preventDefault() {} });
  lib.frames(60);
  canvasStub.fire("touchend", { changedTouches: [{ identifier: 1 }, { identifier: 2 }] });

  /* map switch to Lunarcy (moon tileset + moon bg) */
  await window.__startSolo("7lunarcy", true);
  lib.frames(120);
  if (!G.map.bgImage) { console.error("FAIL: no bg image"); errors++; }
  if (G.map.tilesets[0].image !== "tile64Moon_new.png") { console.error("FAIL: wrong tileset"); errors++; }
  console.log("lunarcy loaded:", G.map.w + "x" + G.map.h, "tileset:", G.map.tilesets[0].image, "pickups:", G.pickups.length);
  lib.frames(240);

  /* point-blank explosion must not NaN-poison physics */
  G.me.dead = false; G.me.hp = 100; G.me.invuln = 0; G.me.vx = 0; G.me.vy = 0;
  explode(G.me.cx(), G.me.cy(), { splash: 150, dmg: 10 }, null);
  lib.frames(30);
  if ([G.me.x, G.me.y, G.me.vx, G.me.vy].some(Number.isNaN)) { console.error("FAIL: NaN after point-blank explosion"); errors++; }

  /* an enemy kill adds exactly one death */
  G.me.dead = false; G.me.deadT = 0; G.me.respawn(); G.me.invuln = 0;
  G.deaths = 0;
  G.me.damage(9999, G.players[1]);
  lib.frames(1);
  if (G.deaths !== 1) { console.error("FAIL: deaths=" + G.deaths + " after exactly one kill"); errors++; }

  console.log(errors === 0 ? "SOLO TEST PASSED" : "SOLO TEST FAILED");
  process.exit(errors === 0 ? 0 : 1);
})();
