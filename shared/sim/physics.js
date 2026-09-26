/* Sim physics setup — matter world with static terrain bodies (one inward-
   extruded quad per traced boundary segment), boundary walls, and the nade
   bounce clatter hook. Game code owns gravity; matter only resolves
   collisions (AGENT.md #5). */
import Matter from "matter-js";
import { WORLD } from "../config/tuning.js";
import { Ev } from "../events.js";

export function initPhysicsFor(sim) {
  sim.engine = Matter.Engine.create({ enableSleeping: false });
  sim.engine.gravity.x = 0;
  sim.engine.gravity.y = 0; /* game code owns gravity */
  const opts = { isStatic: true, friction: 0, frictionStatic: 0, restitution: 0 };
  const shapes = sim.map.solidShapes();
  /* one convex quad per traced segment: air-side face IS the segment (the
     smooth surface), extruded inward into the solid for anti-tunnel bulk.
     Convex quads need no decomp; static-static overlap is free. */
  const bodies = [];
  for (const s of shapes.segments) {
    const quad = [
      { x: s.ax, y: s.ay },
      { x: s.bx, y: s.by },
      { x: s.bx + s.nx * s.depth, y: s.by + s.ny * s.depth },
      { x: s.ax + s.nx * s.depth, y: s.ay + s.ny * s.depth },
    ];
    const b = Matter.Bodies.fromVertices(
      (s.ax + s.bx) / 2 + (s.nx * s.depth) / 2,
      (s.ay + s.by) / 2 + (s.ny * s.depth) / 2,
      quad,
      opts,
    );
    if (b) bodies.push(b);
  }
  for (const b of bodies) b._terrain = true;
  const T = WORLD.BOUNDARY_T; /* boundary walls (bottom left open — void death line catches fallers) */
  bodies.push(
    Matter.Bodies.rectangle(sim.map.w / 2, -T / 2, sim.map.w + T * 4, T, opts),
  );
  bodies.push(
    Matter.Bodies.rectangle(-T / 2, sim.map.h / 2, T, sim.map.h * 3, opts),
  );
  bodies.push(
    Matter.Bodies.rectangle(
      sim.map.w + T / 2,
      sim.map.h / 2,
      T,
      sim.map.h * 3,
      opts,
    ),
  );
  for (let i = bodies.length - 3; i < bodies.length; i++)
    bodies[i]._wall = true;
  Matter.Composite.add(sim.engine.world, bodies);
  /* nade bounce clatter (velocity is px per 1/60s step) */
  Matter.Events.on(sim.engine, "collisionStart", (ev) => {
    for (const pair of ev.pairs) {
      const nade =
        (pair.bodyA._nade && pair.bodyA) || (pair.bodyB._nade && pair.bodyB);
      if (nade) {
        const v = Math.hypot(nade.velocity.x, nade.velocity.y);
        if (v > 2.5)
          sim.ev(Ev.SFX, {
            n: "clank",
            vol: Math.min(0.3, 0.08 + v / 40),
          });
      }
    }
  });
}
