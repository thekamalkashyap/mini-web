/* Pickup pads — settle authored drops onto ground, spread clashing pads,
   and run the per-step grab rules (E-press for inventory, auto for items). */
import { WEAPONS, NADES, isInventoryPickup, pickupDisplayName } from "../weapons.js";
import { PICKUP } from "../config/tuning.js";
import { Ev } from "../events.js";

export function initPickupsFor(sim) {
  sim.pickups = [];
  for (const o of sim.map.objects) {
    if (o.name.startsWith("wp_p") || o.name.startsWith("ctf_wp")) {
      const list = (o.props.weapon || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length) continue;
      /* Authored points float (up to ~260px over the floor) or sit inside
         rock — settle each drop onto nearby ground: lift out of solid,
         rest just above the first surface below, keep the closest
         groundable column. Ungroundable (over void) stays as authored. */
      let bx = o.x,
        by = o.y,
        best = Infinity;
      for (const dx of [
        0, -24, 24, -48, 48, -96, 96, -160, 160, -256, 256, -384, 384, -512,
        512,
      ]) {
        const cx = Math.min(Math.max(o.x + dx, 8), sim.map.w - 8);
        let y = o.y;
        if (sim.map.solidAtPixel(cx, y)) {
          for (let d = 6; d <= 600; d += 6) {
            if (y - d < 0 || !sim.map.solidAtPixel(cx, y - d)) {
              y -= d;
              break;
            }
          }
          if (sim.map.solidAtPixel(cx, y)) continue;
        }
        const g = sim.map.groundBelow(cx, y, 600);
        if (!g) continue;
        const cy = g.y - 8;
        if (sim.map.solidAtPixel(cx, cy)) continue;
        const cost = Math.abs(dx) + Math.abs(cy - o.y) * 0.5;
        if (cost < best) {
          best = cost;
          bx = cx;
          by = cy;
        }
      }
      /* Buried in rock with no groundable neighbor: ungrabbable, would only
         render as an icon on the rock face — skip it (server + solo run the
         same code, so the drop set stays identical everywhere). Air points
         over the void are kept as authored (jetpack-reachable by design). */
      if (best === Infinity && sim.map.solidAtPixel(o.x, o.y)) continue;
      sim.pickups.push({
        x: bx,
        y: by,
        list,
        idx: Math.floor(Math.random() * list.length),
        respawn: 0,
      });
    }
  }
  /* Fixed, well-spaced spawn pads: drops sharing one spot (same ground
     below both authored points, or a floating authored row) render as one
     blob. Grounded clashers shove sideways to the nearest groundable
     column; floating (void) clashers shove sideways in air at their
     authored height — deterministic, so server and solo agree pad-for-pad.
     Still clashing (isolated sliver/ledge, void on every side): fuse the
     later pad into the earlier one — a single pad cycling both lists beats
     an icon blob, and every authored item stays grabbable. */
  const grounded = (k) => {
    const g = sim.map.groundBelow(k.x, k.y, 600);
    return g && g.y - k.y <= 40 ? g : null;
  };
  const clashes = (a, b) =>
    Math.abs(a.x - b.x) < PICKUP.PAD_DX && Math.abs(a.y - b.y) < PICKUP.PAD_DY;
  const free = (cand, i) =>
    !sim.pickups.some((q, j) => j !== i && clashes(cand, q));
  for (let i = 0; i < sim.pickups.length; i++) {
    const k = sim.pickups[i];
    if (!grounded(k)) continue;
    if (free(k, i)) continue;
    for (const dist of [128, 192, 256, 384, 512, 768]) {
      let done = false;
      for (const nx of [k.x + dist, k.x - dist]) {
        const cx = Math.min(Math.max(nx, 8), sim.map.w - 8);
        const g = sim.map.groundBelow(cx, k.y - 40, 640);
        if (!g) continue;
        const cand = { x: cx, y: g.y - 8 };
        if (sim.map.solidAtPixel(cx, cand.y) || !free(cand, i)) continue;
        k.x = cand.x;
        k.y = cand.y;
        done = true;
        break;
      }
      if (done) break;
    }
  }
  for (let i = 0; i < sim.pickups.length; i++) {
    const k = sim.pickups[i];
    if (grounded(k) || free(k, i)) continue;
    for (const dist of [128, 192, 256, 384, 512, 768]) {
      let done = false;
      for (const nx of [k.x + dist, k.x - dist]) {
        const cx = Math.min(Math.max(nx, 8), sim.map.w - 8);
        const cand = { x: cx, y: k.y };
        if (sim.map.solidAtPixel(cx, cand.y) || !free(cand, i)) continue;
        k.x = cand.x;
        done = true;
        break;
      }
      if (done) break;
    }
  }
  for (let i = 0; i < sim.pickups.length; i++) {
    for (let j = sim.pickups.length - 1; j > i; j--) {
      const a = sim.pickups[i],
        c = sim.pickups[j];
      if (!clashes(a, c)) continue;
      a.list = a.list.concat(c.list);
      sim.pickups.splice(j, 1);
    }
  }
}

/* weapon/nade pickup in grab radius (HUD "press E" prompt; null when none).
   skip(i) lets online clients also honor the authoritative respawn timers. */
export function pickupNearFor(sim, p, skip) {
  for (let i = 0; i < sim.pickups.length; i++) {
    const k = sim.pickups[i];
    if (k.respawn > 0 || (skip && skip(i))) continue;
    if (
      Math.abs(p.cx() - k.x) >= PICKUP.RADIUS_X ||
      Math.abs(p.cy() - k.y) >= PICKUP.RADIUS_Y
    )
      continue;
    const id = k.list[k.idx % k.list.length];
    if (isInventoryPickup(id))
      return { i, id, name: pickupDisplayName(id) };
  }
  return null;
}

export function updatePickupsFor(sim, dt) {
  /* E-press edges — computed for every soldier every step (not just near
     pickups) so a held key can't fake a fresh press. Bots have no keyboard:
     they stay on the old auto-grab. */
  for (const p of sim.players) {
    const held = p.isBot ? true : !!(p.input && p.input.use);
    p._usePressed = held && !p._usePrev;
    p._usePrev = held;
  }
  for (const k of sim.pickups) {
    if (k.respawn > 0) {
      k.respawn -= dt;
      continue;
    }
    for (const p of sim.players) {
      if (p.dead || p.ghost) continue;
      if (
        Math.abs(p.cx() - k.x) < PICKUP.RADIUS_X &&
        Math.abs(p.cy() - k.y) < PICKUP.RADIUS_Y
      ) {
        const id = k.list[k.idx % k.list.length];
        /* inventory changes (guns, nades) need an E press — walking over a
           pad must never swap your weapon mid-fight. Instant items (health,
           fuel, shield) still auto-grab: they disrupt nothing. */
        if (isInventoryPickup(id) && !p._usePressed && !p.isBot) continue;
        k.idx = (k.idx + 1) % k.list.length;
        const w = WEAPONS[id];
        if (w) {
          if (w.item === "health") {
            p.hp = 100;
            if (p === sim.me) sim.ev(Ev.SFX, { n: "pickup", vol: 0.6 });
          } else if (w.item === "fuel") {
            p.fuel = 100;
            if (p === sim.me) sim.ev(Ev.SFX, { n: "pickup", vol: 0.6 });
          } else if (w.item === "shield") {
            p.shieldT = 10;
            if (p === sim.me) sim.ev(Ev.SFX, { n: "pickup", vol: 0.6 });
          } else {
            p.equip(w, true);
            if (p === sim.me) sim.ev(Ev.SFX, { n: "weps", vol: 0.5 });
          }
          k.respawn = w.item ? PICKUP.RESPAWN_ITEM : PICKUP.RESPAWN_GUN;
          sim.ev(Ev.PICKUP, {
            i: sim.pickups.indexOf(k),
            idx: k.idx,
            rsp: k.respawn,
          });
          break;
        } else if (NADES[id]) {
          p.nades = Math.min(6, p.nades + 2);
          if (p === sim.me) sim.ev(Ev.SFX, { n: "grenades", vol: 0.5 });
          k.respawn = PICKUP.RESPAWN_NADE;
          sim.ev(Ev.PICKUP, {
            i: sim.pickups.indexOf(k),
            idx: k.idx,
            rsp: k.respawn,
          });
          break;
        }
      }
    }
  }
}
