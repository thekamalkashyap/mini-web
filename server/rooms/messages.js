/* Room message handlers — client -> server vocabulary:
   "inp" (30 Hz packed input), "nade", "reload", plus the e2e-only
   "dbgTeleport" hook (MM_DEBUG=1, never in production). */
import { inputUnpack } from "../../shared/input.js";

export function registerMessages(room) {
  room.onMessage("inp", (client, d) => {
    const p = room.sim.getPlayer(client.sessionId);
    if (p) p.input = inputUnpack(d || {});
  });
  room.onMessage("nade", (client) => {
    const p = room.sim.getPlayer(client.sessionId);
    if (p) p.throwNade();
  });
  room.onMessage("reload", (client) => {
    const p = room.sim.getPlayer(client.sessionId);
    if (p) p.reload();
  });
  /* e2e-only teleport (MM_DEBUG=1): deterministic kill geometry for
     room_test — never enabled in production. */
  if (process.env.MM_DEBUG) {
    room.onMessage("dbgTeleport", (client, d) => {
      const p = room.sim.getPlayer(client.sessionId);
      if (!p || !d) return;
      const x = Number(d.x),
        y = Number(d.y);
      if (!Number.isFinite(x + y)) return;
      p.x = Math.min(Math.max(x, 0), room.sim.map.w - p.w);
      p.y = Math.min(Math.max(y, 0), room.sim.map.h - p.h);
      p.vx = 0;
      p.vy = 0;
      p.ensureBody(true);
    });
  }
}
