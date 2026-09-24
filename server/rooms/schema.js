/* Colyseus schema — authoritative room state synced to clients at 20 Hz
   (patch rate 50ms, matching the legacy 20 Hz snapshot cadence). */
import { Schema, MapSchema, ArraySchema, defineTypes } from "@colyseus/schema";

class PlayerState extends Schema {
  constructor() {
    super();
    this.name = "";
    this.x = 0; this.y = 0; this.aim = 0;
    this.hp = 100; this.dead = false;
    this.wep = "m61"; this.ammo = 30;
    this.fuel = 100; this.facing = 1;
    this.nades = 2; this.kills = 0;
    this.walkT = 0; this.reloading = 0; this.invuln = 0; this.shield = 0;
    this.jet = false;
  }
}
defineTypes(PlayerState, {
  name: "string",
  x: "number", y: "number", aim: "number",
  hp: "number", dead: "boolean",
  wep: "string", ammo: "int16",
  fuel: "number", facing: "int8",
  nades: "int8", kills: "int16",
  walkT: "number", reloading: "number", invuln: "number", shield: "number",
  jet: "boolean",
});

class PickupState extends Schema {
  constructor() { super(); this.idx = 0; this.respawn = 0; }
}
defineTypes(PickupState, { idx: "int8", respawn: "number" });

class GameState extends Schema {
  constructor() {
    super();
    this.mapName = "";
    this.time = 0;
    this.players = new MapSchema();
    this.pickups = new ArraySchema();
  }
}
defineTypes(GameState, {
  mapName: "string",
  time: "number",
  players: { map: PlayerState },
  pickups: [PickupState],
});

export { GameState, PlayerState, PickupState };
