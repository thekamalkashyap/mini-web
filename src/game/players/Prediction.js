/* Prediction correction — reconcile the locally simulated own soldier with
   the authoritative schema state: snap/lerp position, adopt vitals, and let
   respawn be state-driven only (a local timer flapped against the host's). */
import Matter from "matter-js";
import { NET, SPAWN } from "../../../shared/config/tuning.js";
import { weaponById } from "../../../shared/weapons.js";

export function correctPrediction(pred, room, sfx, effects) {
  if (!room) return;
  const s = room.state.players.get(room.sessionId);
  if (!s) return;
  if (s.hp < pred.hp - 0.5)
    effects.emitters.blood.emitParticleAt(pred.cx(), pred.cy(), 4);
  pred.hp = s.hp;
  pred.fuel = s.fuel;
  pred.ammo = s.ammo;
  pred.nades = s.nades;
  if (s.dead && !pred.dead) pred.die(null);
  if (!s.dead && pred.dead) {
    pred.dead = false;
    pred.deadT = 0;
    pred.invuln = SPAWN.INVULN_RESPAWN;
    pred.ensureBody(true);
  }
  const w = weaponById(s.wep);
  if (w !== pred.weapon) {
    pred.weapon = w;
    pred.weaponId = s.wep;
    sfx.play("switch", 0.4);
  }
  const dx = s.x - pred.x,
    dy = s.y - pred.y;
  if (Math.hypot(dx, dy) > NET.SNAP_DIST) {
    pred.x = s.x;
    pred.y = s.y;
  } else {
    pred.x += dx * NET.PREDICT_LERP;
    pred.y += dy * NET.PREDICT_LERP;
  }
  if (pred.body)
    Matter.Body.setPosition(pred.body, {
      x: pred.x + pred.w / 2,
      y: pred.y + pred.h / 2,
    });
}
