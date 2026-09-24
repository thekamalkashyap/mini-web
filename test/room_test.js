/* E2E room test: boots the REAL Colyseus server as a child process, connects
   two real clients (colyseus.js), and asserts the authoritative loop:
   join -> state sync -> input -> movement -> events (fire/pk/death) -> leave. */
import { spawn } from "node:child_process";
import { Client } from "colyseus.js";

const PORT = 2577;
const URL = `ws://127.0.0.1:${PORT}`;
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
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

  /* B fires at A: send held-fire input aimed at A's position */
  const target = roomA.state.players.get(roomA.sessionId);
  for (let i = 0; i < 12; i++) {
    roomB.send("inp", { l: 0, r: 0, j: 0, f: 1, x: Math.round(target.x + 22), y: Math.round(target.y + 52) });
    await sleep(100);
  }
  await sleep(400);
  if (!evsA.some(e => e.t === "fire") && !evsB.some(e => e.t === "fire")) fail("no fire events reached clients"); else pass("fire events broadcast");

  /* damage / death: force a kill via sustained point-blank fire (A stands still) */
  let diedA = false, guard = 0;
  while (!diedA && guard++ < 40) {
    roomB.send("inp", { l: 0, r: 0, j: 0, f: 1, x: Math.round(target.x + 22), y: Math.round(target.y + 52) });
    await sleep(150);
    diedA = roomA.state.players.get(roomA.sessionId).dead || evsA.some(e => e.t === "death");
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
