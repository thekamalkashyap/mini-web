/* End-to-end multiplayer test:
   real relay server + HOST game in-process + GUEST game in a child process,
   real client code over real WebSockets. Also unit-probes guest-side snapshot
   handling offline, and joins the guest BEFORE the host game is set up to
   prove the lost-pjoin self-heal. Verifies joins, inputs, snapshots, bullets,
   pickups, kills — in both directions. */
const { spawn } = require("child_process");
const path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const root = path.join(__dirname, "..");
  const srv = spawn("node", ["server/server.js", "8091"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  srv.stdout.on("data", d => process.stdout.write("[srv] " + d));
  srv.stderr.on("data", d => process.stderr.write("[srv!] " + d));
  await sleep(600);

  const failures = [];
  const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures.push(name); };

  let guestOut = "";
  let guest2 = null;
  try {
    /* ---------- phase 0: offline unit probes (no server traffic) ---------- */
    const loadGame = require("./harness_lib");
    const lib = loadGame();
    const { G, keys, mouse } = lib;
    await lib.arm();
    await window.__startSolo("1outpost");

    /* remote stubs must treat snapshot coords as top-left (no anchor double-shift) */
    G.isGuest = true; G.net = { send: () => {} };
    applySnapshot([[4242, 500, 300, 0, 100, 0, "m61", 30, 100, 1]]);
    lib.frames(60);
    const stub = G.remotes.get(4242);
    check("guest stub tracks snapshot position", !!stub && Math.abs(stub.x - 500) < 2 && Math.abs(stub.y - 300) < 2);
    G.remotes.delete(4242);

    /* guest-me death is snapshot-driven: no local respawn flap, snapshot resurrects */
    G.me.invuln = 999; G.me.hp = 100;   /* keep bot fire from muddying the probe */
    const deadRow = [[1, 400, 200, 0, 0, 1, "m61", 30, 100, 1]];
    const aliveRow = [[1, 400, 200, 0, 100, 0, "m61", 30, 100, 1]];
    applySnapshot(deadRow);
    let flapped = false;
    for (let k = 0; k < 24; k++) {          /* ~6s of dead snapshots — passes the old 2.6s local timer */
      lib.frames(15);
      applySnapshot(deadRow);
      if (!G.me.dead && k > 8) flapped = true; /* resurrected while host still says dead */
    }
    check("guest-me stays dead while snapshots say dead", !flapped && G.me.dead === true);
    applySnapshot(aliveRow);
    check("guest-me resurrects on alive snapshot", G.me.dead === false && G.me.hp === 100);
    G.isGuest = false; G.net = null;

    /* ---------- phase R: guest joins BEFORE the host game is set up ---------- */
    const net = new Net();
    await net.connect("ws://127.0.0.1:8091", "1outpost", "HOSTBOT");
    guest2 = spawn("node", ["test/guest_child.js"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    guest2.stdout.on("data", d => { guestOut += d.toString(); });
    await sleep(1200);   /* guest's pjoin arrives while we have no handlers installed yet */
    await window.__startHostExistingNet(net, "1outpost");
    check("host ready", G.ready && G.isHost);

    /* host plays while guest connects/plays: strafe + fire */
    keys.KeyA = true; mouse.x = 100; mouse.y = 400; mouse.down = true;
    let maxPlayers = 0, guestRef = null, guestMaxVx = 0, guestBullets = 0, relocated = false;
    for (let k = 0; k < 160; k++) {
      lib.frames(10);
      maxPlayers = Math.max(maxPlayers, G.players.length);
      if (!guestRef) guestRef = G.players.find(p => p.remote) || null;
      if (guestRef && !relocated) {
        /* remote spawn geometry is random — relocate into open air above the host
           so input-driven motion/fire is observable regardless of spawn luck */
        relocated = true;
        let ty = G.me.y - 200;
        while (ty > 40 && G.map.rectHitsWorld(G.me.x, ty, guestRef.w, guestRef.h)) ty -= 40;
        guestRef.x = G.me.x; guestRef.y = ty; guestRef.vx = 0; guestRef.vy = 0; guestRef.fuel = 100;
        if (guestRef.body) window.Matter.Body.setPosition(guestRef.body, { x: guestRef.x + guestRef.w / 2, y: guestRef.y + guestRef.h / 2 });
      }
      if (guestRef) {
        guestMaxVx = Math.max(guestMaxVx, Math.abs(guestRef.vx));
        guestBullets = Math.max(guestBullets, G.bullets.filter(b => b.owner === guestRef).length);
      }
      await sleep(16);
    }
    mouse.down = false; keys.KeyA = false;

    check("host self-healed lost pjoin (sees guest player)", maxPlayers === 2 && !!guestRef);
    check("host received guest inputs", (G._inpCount || 0) > 20);
    check("host simulated guest bullets", guestBullets > 0);
    check("guest moved under host authority", guestMaxVx > 5);

    /* host grabs a pickup (guest must receive pk event). Pixel collision may
       eject a body teleported into terrain, so hold the player at the pad for
       a few frames — this tests the overlap->grab mechanic itself. */
    /* pixel collision ejects bodies placed inside terrain — hold the player at
       the nearest FREE spot inside the pad's grab box, like a real player.
       Some Outpost pads sit in alpha-art that only the browser's canvas-built
       collision mask resolves as air; headless falls back to whole-tile gids,
       where those pads are fully embedded (no free spot) — matter would eject
       the player off the pad every frame. Pick a pad that has a reachable free
       spot in BOTH collision models, so this check exercises the overlap->grab
       mechanic identically in CI and the browser. */
    let pk = null, hold = null;
    for (const cand of G.pickups) {
      if (cand.respawn > 0) continue;
      outer2: for (let dy = -45; dy <= 45; dy += 15) {
        for (let dx = -40; dx <= 40; dx += 10) {
          const cx = cand.x + dx, cy = cand.y + dy;
          if (!G.map.rectHitsWorld(cx - 22, cy - 52, 44, 104)) { pk = cand; hold = [cx, cy]; break outer2; }
        }
      }
      if (pk) break;
    }
    if (!pk) { pk = G.pickups.find(p => p.respawn <= 0) || G.pickups[0]; hold = [pk.x, pk.y]; }
    for (let f = 0; f < 24 && pk.respawn <= 0; f++) {
      G.me.x = hold[0] - G.me.w / 2; G.me.y = hold[1] - G.me.h / 2;
      G.me.vx = 0; G.me.vy = 0;
      if (G.me.body) {
        window.Matter.Body.setPosition(G.me.body, { x: G.me.x + G.me.w / 2, y: G.me.y + G.me.h / 2 });
        window.Matter.Body.setVelocity(G.me.body, { x: 0, y: 0 });
      }
      const before = G.me.body ? [ +G.me.body.position.x.toFixed(1), +G.me.body.position.y.toFixed(1), +G.me.body.velocity.x.toFixed(2) ] : null;
      lib.frames(1);
      if (f < 3) console.log("IT", f, "pre", JSON.stringify(before), "post", JSON.stringify([+G.me.body.position.x.toFixed(1), +G.me.body.velocity.x.toFixed(2)]), "vx", +G.me.vx.toFixed(1), "keysL", keys.KeyA);
    }
    check("host pickup consumed", pk.respawn > 0);
    console.log("DBG2:", JSON.stringify({ hold, meAfter: [Math.round(G.me.x), Math.round(G.me.y)], dist: [Math.round(Math.abs(G.me.cx() - pk.x)), Math.round(Math.abs(G.me.cy() - pk.y))], body: !!G.me.body, mask: !!G.map.mask, meWeapon: G.me.weapon.name }));
    console.log("DBG pickup:", JSON.stringify({ respawn: +pk.respawn.toFixed(2), pad: [pk.x, pk.y], me: [Math.round(G.me.x), Math.round(G.me.y)], dead: G.me.dead, isGuest: G.isGuest, isHost: G.isHost, players: G.players.length, ready: G.ready, cy: Math.round(G.me.cy()) }));

    /* host kills the guest while connected */
    if (guestRef) { guestRef.invuln = 0; guestRef.damage(500, G.me); }
    lib.frames(30);
    check("host kill counted", G.kills >= 1);

    /* wait for guest's report (it lingers ~4s after its own loop) */
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !guestOut.includes("{")) await sleep(200);
    if (guest2.exitCode === null) guest2.kill();
    await new Promise(r => (guest2.exitCode !== null ? r() : guest2.on("exit", r)));

    let rep = {};
    try { rep = JSON.parse(guestOut.trim().split("\n").pop()); } catch (e) {}
    console.log("guest report:", JSON.stringify(rep));
    check("guest ran ok", rep.ok === true);
    check("guest saw host", rep.remotes === 1);
    check("guest got snapshots", (rep.snaps || 0) > 30);
    check("guest saw bullets", (rep.sawBullets || 0) > 0);
    check("guest stub pinned to host position", (rep.stubOffX ?? 99) < 8 && (rep.stubOffY ?? 99) < 8);
    check("guest pickup state synced via hello retry", typeof rep.pkIdx === "number" && rep.pkIdx === G.pickups[0].idx);

    srv.kill();
    console.log(failures.length === 0 ? "\nE2E TEST PASSED" : "\nE2E TEST FAILED: " + failures.join(", "));
    process.exit(failures.length === 0 ? 0 : 1);
  } catch (e) {
    console.error("E2E ERROR:", e.stack);
    if (guest2 && guest2.exitCode === null) guest2.kill();
    srv.kill(); process.exit(1);
  }
})();
