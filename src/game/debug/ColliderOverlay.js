/* ColliderOverlay — debug visualization of the collision model: extruded
   segment mass (faint), contact surfaces (red), soldier boxes (orange),
   nade bodies (yellow) and the live gun pivot + aim ray with the muzzle
   dot (cyan). Toggle with ` (starts on via &colliders). */
import { weaponById } from "../../../shared/weapons.js";
import { barrelReach } from "../../../shared/combat.js";

export class ColliderOverlay {
  constructor(scene) {
    this.scene = scene;
    this.gfx = null;
  }

  ensure() {
    if (!this.gfx) this.gfx = this.scene.add.graphics().setDepth(9);
    return this.gfx;
  }

  clear() {
    if (this.gfx) this.gfx.clear();
  }

  draw(pool) {
    const g = this.ensure();
    g.clear();
    const { map, sim } = this.scene;
    if (!sim) return;
    const segments = map.solidShapes().segments || [];
    /* interior mass reads faint — the eye should follow the surface line */
    g.fillStyle(0x3cdc78, 0.06);
    for (const s of segments) {
      g.fillPoints(
        [
          { x: s.ax, y: s.ay },
          { x: s.bx, y: s.by },
          { x: s.bx + s.nx * s.depth, y: s.by + s.ny * s.depth },
          { x: s.ax + s.nx * s.depth, y: s.ay + s.ny * s.depth },
        ],
        true,
      );
    }
    /* the contact surface itself: every traced segment, riding the art */
    g.lineStyle(3, 0xff3b30, 1);
    for (const s of segments) g.lineBetween(s.ax, s.ay, s.bx, s.by);
    g.lineStyle(3, 0xff8c28, 1);
    for (const p of sim.players)
      if (!p.dead) g.strokeRect(p.x, p.y, p.w, p.h);
    g.lineStyle(3, 0xffd732, 1);
    for (const n of sim.nades) if (n.body) g.strokeCircle(n.x, n.y, 8);
    /* gun rotation axis: live gun-container pivot (crosshair) + aim ray to the
       muzzle dot. Pivot comes from the rendered transform, so it marks where
       the art actually rotates even if the sim/view formulas drift. */
    const guns = [];
    for (const [id, v] of pool.views) {
      const p = sim.players.find((q) => q.id === id);
      if (p && !p.dead)
        guns.push({ view: v, aim: p.aim, weaponId: p.weaponId });
    }
    for (const [, r] of pool.remotes) {
      if (r.view && !(r.state && r.state.dead))
        guns.push({
          view: r.view,
          aim: r.aim || 0,
          weaponId: (r.state && r.state.wep) || "m61",
        });
    }
    g.lineStyle(2, 0x28d8ff, 1);
    for (const { view, aim, weaponId } of guns) {
      const m = view.gun.getWorldTransformMatrix();
      const px = m.tx,
        py = m.ty;
      const reach = barrelReach(
        this.scene.frameSizeCache,
        weaponById(weaponId),
      );
      const dx = Math.cos(aim),
        dy = Math.sin(aim);
      const s = 7;
      g.lineBetween(px - s, py, px + s, py);
      g.lineBetween(px, py - s, px, py + s);
      g.strokeCircle(px, py, 3);
      g.lineBetween(px, py, px + dx * (reach + 26), py + dy * (reach + 26));
      g.fillStyle(0x28d8ff, 1);
      g.fillCircle(px + dx * reach, py + dy * reach, 3);
    }
  }
}
