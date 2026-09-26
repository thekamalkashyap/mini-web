/* Party-room E2E: boots the REAL server as a child process and asserts the
   friend-invite flow: create("party") -> share roomId -> joinById ->
   same room, server-published mapName, isolation from "mm" quick-play,
   and a clean error for dead/expired ids. */
import { spawn } from "node:child_process";
import { Client } from "colyseus.js";

const PORT = 2578;
const URL = `ws://127.0.0.1:${PORT}`;
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
srv.stdout.on("data", d => process.stdout.write("[srv] " + d));
srv.stderr.on("data", d => process.stderr.write("[srv!] " + d));

try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await sleep(200);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/matchmake/party`); up = r.status < 500; } catch (e) {}
  }
  if (!up) throw new Error("server never came up");

  const clientA = new Client(URL);
  const roomA = await clientA.create("party", { map: "1outpost", name: "HOST" });
  if (!roomA.roomId) fail("party create returned no roomId");
  else pass(`party created (id ${roomA.roomId})`);
  await sleep(600);

  /* server publishes the authoritative map; joiners boot from it */
  if (roomA.state.mapName !== "1outpost") fail("state.mapName missing/wrong: " + roomA.state.mapName);
  else pass("server publishes authoritative mapName");

  /* friend joins by id with a DIFFERENT local map pick — same room */
  const clientB = new Client(URL);
  const roomB = await clientB.joinById(roomA.roomId, { map: "7lunarcy", name: "GUEST" });
  if (roomB.roomId !== roomA.roomId) fail("joinById landed in a different room");
  else pass("joinById reaches the party room");
  await sleep(600);
  if (roomB.state.mapName !== "1outpost") fail("guest sees wrong mapName: " + roomB.state.mapName);
  else pass("guest sees host mapName despite own pick");
  if ([...roomA.state.players.keys()].length !== 2) fail("player count != 2");
  else pass("two players in party room");

  /* quick-play must never match into a party room */
  const clientC = new Client(URL);
  const roomC = await clientC.joinOrCreate("mm", { map: "1outpost", name: "RANDO" });
  if (roomC.roomId === roomA.roomId) fail("quick-play matched into party room!");
  else pass("quick-play isolated from party rooms");

  /* dead/expired id -> clean rejection (lobby shows "room expired") */
  try {
    await new Client(URL).joinById("dead-room-id", { name: "X" });
    fail("joinById(dead id) unexpectedly succeeded");
  } catch (e) {
    if (/not found/i.test(e.message)) pass("dead id rejected with not-found");
    else fail("dead id error unrecognized: " + e.message);
  }

  await roomA.leave(true);
  await roomB.leave(true);
  await roomC.leave(true);
  await sleep(200);
} catch (e) {
  fail("unexpected: " + (e && e.stack || e));
} finally {
  srv.kill("SIGKILL");
  await sleep(200);
}

console.log(errors ? `\nPARTY TEST FAILED (${errors})` : "\nPARTY TEST PASSED");
process.exit(errors ? 1 : 0);
