/* Bot AI — think step producing Soldier input. Pure-ish: reads sim state,
   writes ai.input + occasional jump velocity. Consumed by Soldier.update. */
import { rnd } from "../utils/math.js";

export function botThink(b, dt) {
  const ai = b.ai;
  ai.t -= dt;
  const sim = b.sim;
  const target =
    sim.me && !sim.me.dead
      ? sim.me
      : sim.players.find((p) => p !== b && !p.isBot) ||
        sim.players.find((p) => p !== b);
  if (ai.t <= 0) {
    ai.t = rnd(0.25, 0.5);
    ai.wantX = target ? target.cx() + ai.side * rnd(0.4, 1.1) : b.cx();
    if (Math.random() < 0.15) ai.side *= -1;
    if (Math.random() < 0.3 && b.grounded) b.vy = -rnd(300, 550);
  }
  const input = {
    left: false,
    right: false,
    jet: false,
    fire: false,
    aimX: null,
    aimY: null,
  };
  const dx = ai.wantX - b.cx();
  if (Math.abs(dx) > 40) {
    if (dx < 0) input.left = true;
    else input.right = true;
  }
  if (target) {
    if (target.cy() < b.cy() - 140 && Math.random() < 0.7) input.jet = true;
    if (b.grounded && Math.abs(b.vx) < 30 && Math.abs(dx) > 60)
      input.jet = true;
    const los = !sim.segHitsSolid(
      b.cx(),
      b.shoulderY(),
      target.cx(),
      target.cy(),
    );
    input.aimX = target.cx() + rnd(-40, 40);
    input.aimY = target.cy() + rnd(-30, 30);
    const dist = Math.hypot(target.cx() - b.cx(), target.cy() - b.cy());
    input.fire = los && dist < 1300 && !target.dead;
  }
  ai.input = input;
}
