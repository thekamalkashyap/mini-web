/* E2E room test: boots the REAL Colyseus server as a child process, connects
   two real clients (colyseus.js), and asserts the authoritative loop:
   join -> state sync -> input -> movement -> events (fire/pk/death) -> leave. */
import { spawn } from "node:child_process";
import { Client } from "colyseus.js";
import { loadMapBundle } from "../server/assets.js";
import { GameMap } from "../shared/map.js";

const PORT = 2577;
const URL = `ws://127.0.0.1:${PORT}`;
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(PORT), MM_DEBUG: "1" }, stdio: ["ignore", "pipe", "pipe"] });
srv.stdout.on("data", d => process.stdout.write("[srv] " + d));
srv.stderr.on("data", d => process.stderr.write("[srv!] " + d));

const eventsOf = (room) => { const seen = []; room.onMessage("evs", evs => { for (const e of evs) seen.push(e); }); return seen; };

try {
  /* wait for the server to listen (matchmaking HTTP endpoint answers) */
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(200);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/matchmake/mm`); up = r.status < 500; } catch (e) {}
  }
  if (!up) throw new Error("server never came up");

  const clientA = new Client(URL);
  const roomA = await clientA.joinOrCreate("mm", { map: "1outpost", name: "ALPHA" });
  const evsA = eventsOf(roomA);
  pass("host-ish client joined");

  await sleep(600);   /* let a few ticks + patches flow */
  const meA = roomA.state.players.get(roomA.sessionId);
  if (!meA) fail("own PlayerState missing after join"); else pass("own state synced");
  const homeA = meA ? { x: meA.x, y: meA.y } : null;   /* fresh-spawn grounded spot */

  /* move right for ~1s and expect x to change (input -> sim -> schema) */
  const x0 = meA.x;
  for (let i = 0; i < 10; i++) { roomA.send("inp", { l: 0, r: 1, j: 0, f: 0, x: 0, y: 0 }); await sleep(100); }
  if (Math.abs(meA.x - x0) < 5) fail("input never moved the soldier"); else pass("input moves soldier");

  /* second client joins the same room */
  const clientB = new Client(URL);
  const roomB = await clientB.joinOrCreate("mm", { map: "1outpost", name: "BRAVO" });
  const evsB = eventsOf(roomB);
  await sleep(700);
  pass(`two players in room (${[...roomA.state.players.keys()].length} states)`);

  /* Stop A (inputs latch server-side), re-pin it home, then stack B beside A
     via the e2e teleport hook: spawn geometry is random and often has rock
     between the two, so a fair-fight kill would be luck. The kill asserts
     damage/death sync, not marksmanship. Aim = true center (44x84 box). */
  for (let i = 0; i < 3; i++) { roomA.send("inp", { l: 0, r: 0, j: 0, f: 0, x: 0, y: 0 }); await sleep(100); }
  await sleep(400);
  /* re-pin A to its fresh-spawn spot (the forced walk may have cliff-dived;
     a mid-test respawn elsewhere would strand B shooting rock) */
  if (homeA) { roomA.send("dbgTeleport", homeA); await sleep(400); }
  /* stack B beside A on a CLEAR box with a CLEAR corridor (same mask the
     server simulates): beside, not above — B's muzzle reach (~58px)
     overshoots a vertically-stacked target, rounds spawning past the box */
  const bundle = loadMapBundle("1outpost");
  const tmap = new GameMap(bundle.mapJson, bundle.maskData);
  const segClear = (x0, y0, x1, y1) => {
    const n = Math.max(2, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 12));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if (tmap.solidAtPixel(x, y)) return false;
    }
    return true;
  };
  /* A plaza: flat open ground found on the real mask (1outpost's flattest
     open stretch). A may have spawned in a cave pocket no neighbor can shoot
     into — both bodies move to the plaza so geometry is deterministic. */
  const findPlaza = () => {
    for (let x = 200; x < tmap.w - 200; x += 60) {
      const g = tmap.groundBelow(x, 0, tmap.h);
      if (!g || g.y < 120) continue;
      const gl = tmap.groundBelow(x - 60, g.y - 60, 160);
      const gr = tmap.groundBelow(x + 60, g.y - 60, 160);
      if (!gl || !gr || Math.abs(gl.y - g.y) > 20 || Math.abs(gr.y - g.y) > 20) continue;
      if (tmap.rectHitsWorld(x - 60, g.y - 90, 120, 90)) continue;
      return { x: x - 22, y: g.y - 84 };
    }
    return null;
  };
  const plaza = findPlaza();
  if (!plaza) fail("no flat plaza on 1outpost (test geometry)");
  const stackB = () => {
    const t = roomA.state.players.get(roomA.sessionId);
    for (const dx of [50, -50, 100, -100, 150, -150, 220, -220]) {
      if (tmap.rectHitsWorld(t.x + dx, t.y, 44, 84)) continue;
      if (!segClear(t.x + 22 + dx, t.y + 42, t.x + 22, t.y + 42)) continue;
      roomB.send("dbgTeleport", { x: t.x + dx, y: t.y });
      return true;
    }
    return false;
  };
  /* A may have died cliff-diving during the walk — wait for (auto)respawn so
     the kill below is a real kill, not a corpse observation */
  for (let i = 0; i < 30 && roomA.state.players.get(roomA.sessionId).dead; i++) await sleep(200);
  /* move the LIVE body to the plaza (a corpse would respawn elsewhere), then
     stack B beside it */
  if (plaza) { roomA.send("dbgTeleport", plaza); await sleep(400); }
  stackB();
  await sleep(400);
  /* either body may have slid into the void and died mid-setup (dead bodies
     don't shoot) — wait for both to be live, then re-pin geometry */
  for (let i = 0; i < 40 && (roomA.state.players.get(roomA.sessionId).dead || roomB.state.players.get(roomB.sessionId).dead); i++) await sleep(200);
  if (plaza) { roomA.send("dbgTeleport", plaza); await sleep(200); }
  stackB();
  await sleep(400);
  /* a recent (auto)respawn carries 2s of invuln — incoming rounds would ping
     off it and the guard could expire first. Wait it out (state-synced). */
  for (let i = 0; i < 40 && roomA.state.players.get(roomA.sessionId).invuln > 0.5; i++) await sleep(200);
  const aimB = () => {
    const t = roomA.state.players.get(roomA.sessionId);
    return { l: 0, r: 0, j: 0, f: 1, x: Math.round(t.x + 22), y: Math.round(t.y + 42) };
  };
  for (let i = 0; i < 12; i++) { roomB.send("inp", aimB()); await sleep(100); }
  await sleep(400);
  if (!evsA.some(e => e.t === "fire") && !evsB.some(e => e.t === "fire")) fail("no fire events reached clients"); else pass("fire events broadcast");

  /* damage / death: force a kill via sustained point-blank fire (A stands still).
     Either body can slide off a slope edge mid-burst — re-stack whenever they
     drift apart so geometry can never strand the kill. Generous guard: sim
     time can lag wall time under suite load, and deaths/respawns cost ~3s. */
  let diedA = false, guard = 0;
  while (!diedA && guard++ < 90) {
    roomB.send("inp", aimB());
    await sleep(150);
    const aNow = roomA.state.players.get(roomA.sessionId);
    diedA = aNow.dead || evsA.some(e => e.t === "death");
    if (guard % 10 === 0) {
      const bNow = roomB.state.players.get(roomB.sessionId);
      console.log(`[kill] t=${guard} A(hp=${Math.round(aNow.hp)},${Math.round(aNow.x)},${Math.round(aNow.y)})` +
        (bNow ? ` B(${Math.round(bNow.x)},${Math.round(bNow.y)}${bNow.dead ? ",dead" : ""})` : " B(?)"));
    }
    if (!diedA && !aNow.dead) {
      const bNow = roomB.state.players.get(roomB.sessionId);
      if ((!bNow || bNow.dead || Math.hypot(aNow.x - bNow.x, aNow.y - bNow.y) > 80)) {
        /* B drifted, died, or never landed clear — re-stack beside live A */
        for (let i = 0; i < 20 && roomB.state.players.get(roomB.sessionId).dead; i++) await sleep(200);
        stackB();
      }
    }
  }
  if (!diedA) fail("point-blank fire never killed the target"); else pass("death event flows + dead flag syncs");

  /* pickups sync */
  if (roomA.state.pickups.length < 5) fail("pickup array not synced"); else pass(`pickups synced (${roomA.state.pickups.length})`);

  /* leave cleanup */
  const countBefore = [...roomA.state.players.keys()].length;
  roomB.leave();
  await sleep(700);
  const countAfter = [...roomA.state.players.keys()].length;
  if (!(countAfter < countBefore)) fail("leaving player not removed from state"); else pass("leave removes player");

  await roomA.leave(true);
  await sleep(200);
} catch (e) {
  fail("unexpected: " + (e && e.stack || e));
} finally {
  srv.kill("SIGKILL");
  await sleep(200);
}

console.log(errors ? `\nROOM TEST FAILED (${errors})` : "\nROOM TEST PASSED");
process.exit(errors ? 1 : 0);
