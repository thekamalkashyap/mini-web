/* Guest-side child process for the e2e multiplayer test */
const loadGame = require("./harness_lib");

(async () => {
  const lib = loadGame();
  const { G, keys, mouse } = lib;
  try {
    await lib.arm();
    await window.__startGuestOnline("ws://127.0.0.1:8091", "1outpost", "GUESTBOT");
    if (!G.ready) throw new Error("guest not ready");

    /* move right + jet + fire continuously for ~4s of wall time */
    keys.KeyD = true; keys.KeyW = true;
    mouse.x = 1200; mouse.y = 100; mouse.down = true;
    let sawBullets = 0;
    for (let k = 0; k < 240; k++) {
      lib.frames(10);
      sawBullets = Math.max(sawBullets, G.bullets.length);
      await lib.sleep(16);
    }
    mouse.down = false; keys.KeyW = false; keys.KeyD = false;
    /* linger connected, keep processing host events (snaps, pk, death) */
    let stubOffX = 0, stubOffY = 0;
    for (let k = 0; k < 240; k++) {
      lib.frames(1);
      for (const r of G.remotes.values()) {
        if (r.tx !== undefined) {
          stubOffX = Math.max(stubOffX, Math.abs(r.x - r.tx));
          stubOffY = Math.max(stubOffY, Math.abs(r.y - r.ty));
        }
      }
      await lib.sleep(16);
    }
    console.log(JSON.stringify({
      ok: true, remotes: G.remotes.size, sawBullets,
      snaps: G._snapCount || 0, x: Math.round(G.me.x), y: Math.round(G.me.y),
      hp: Math.round(G.me.hp), fuel: Math.round(G.me.fuel), ammo: G.me.ammo,
      pkIdx: G.pickups[0] ? G.pickups[0].idx : null,
      stubOffX: +stubOffX.toFixed(1), stubOffY: +stubOffY.toFixed(1),
    }));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: e.message }));
    process.exit(1);
  }
})();
