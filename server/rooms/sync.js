/* Room state sync — after each sim step: mirror soldiers + pickups into
   the schema (patched to clients at 20 Hz) and broadcast the tick's
   transient events as one "evs" message. */
import { PlayerState } from "./schema.js";

export function syncState(room) {
  room.state.time = room.sim.time;

  /* sync soldiers */
  for (const p of room.sim.players) {
    let s = room.state.players.get(p.id);
    if (!s) {
      s = new PlayerState();
      s.name = p.name;
      room.state.players.set(p.id, s);
    }
    s.x = p.x;
    s.y = p.y;
    s.aim = p.aim;
    s.hp = p.hp;
    s.dead = p.dead;
    s.wep = p.weaponId;
    s.ammo = p.ammo;
    s.fuel = p.fuel;
    s.facing = p.facing;
    s.nades = p.nades;
    s.kills = p.kills;
    s.walkT = p.walkT;
    s.reloading = p.reloading;
    s.invuln = p.invuln;
    s.shield = p.shieldT;
    s.jet = p.jetOn;
  }

  /* sync pickups */
  for (
    let i = 0;
    i < room.sim.pickups.length && i < room.state.pickups.length;
    i++
  ) {
    room.state.pickups[i].idx = room.sim.pickups[i].idx;
    room.state.pickups[i].respawn = room.sim.pickups[i].respawn;
  }

  /* batch transient events for everyone */
  const evs = room.sim.drainEvents();
  if (evs.length) room.broadcast("evs", evs);
}
