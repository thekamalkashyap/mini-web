/* Shared combat kinematics — the math the sim and the client's visual layer
   must agree on: barrel reach (muzzle placement + debug overlay), grenade
   throw velocity (authoritative throw + prediction ghost), and ghost-nade
   integration (prediction sim + online visuals). */
import { SPR, NADE } from "./config/tuning.js";

/* Grip-anchored barrel tip distance from the shoulder pivot, matching the
   drawn gun assembly (gun origin + flash placement in the view). */
export function barrelReach(frameSize, weapon) {
  return (frameSize(weapon.sprite).w || 60) * SPR * 0.72 + 6;
}

/* Initial velocity of a thrown grenade from aim + thrower momentum. */
export function nadeThrowVelocity(aim, pvx = 0) {
  return {
    vx: Math.cos(aim) * NADE.THROW_SPEED + pvx * NADE.MOMENTUM,
    vy: Math.sin(aim) * NADE.THROW_SPEED - NADE.THROW_UP,
  };
}

/* Legacy ghost-nade integration: gravity + axis-separated bounce off solid
   pixels. solidAt(x, y) -> bool (GameMap.solidAtPixel on both sides). */
export function stepGhostNade(n, dt, solidAt) {
  n.vy += NADE.GRAVITY * dt;
  const steps = Math.max(1, Math.ceil((Math.hypot(n.vx, n.vy) * dt) / 16));
  for (let s = 0; s < steps; s++) {
    const nx = n.x + (n.vx * dt) / steps,
      ny = n.y + (n.vy * dt) / steps;
    if (solidAt(nx, n.y)) n.vx *= -NADE.BOUNCE;
    else n.x = nx;
    if (solidAt(n.x, ny)) n.vy *= -NADE.BOUNCE;
    else n.y = ny;
  }
}
