/* Screen-space overlays — ground drop shadow, name tag, hp bar, shield ring.
   Never mirrored with the facing container. */
import { clamp } from "../../../shared/utils/math.js";

export function layoutShadow(view, s, sw, sh) {
  /* drop shadow on the ground below (canopy art reads as air otherwise) */
  const feetX = s.x + sw + 10,
    feetY = s.y + sh;
  const ground = view.scene.map.groundBelow(feetX, feetY, 420);
  if (ground) {
    const d = ground.y - feetY;
    view.shadow.setVisible(true);
    view.shadow.setPosition(feetX, ground.y - 3);
    const sx = clamp(24 - d * 0.05, 9, 24),
      sy = clamp(6 - d * 0.012, 2.5, 6);
    view.shadow.setScale(sx / 24, sy / 6);
    view.shadow.setFillStyle(0x000000, clamp(0.3 - d * 0.0009, 0.06, 0.3));
  } else view.shadow.setVisible(false);
}

export function layoutTags(view, s, sw, sh) {
  view.nameText.setText(s.name || "");
  view.nameText.setPosition(s.x + sw / 2, s.y - 26);
  view.hpBg.setPosition(s.x + sw / 2, s.y - 22);
  view.hpBar.setPosition(s.x + sw / 2 - 25, s.y - 22);
  view.hpBar.width = 50 * clamp((s.hp || 0) / 100, 0, 1);
  view.shieldRing.setVisible((s.shield || 0) > 0);
  view.shieldRing.setPosition(s.x + sw / 2, s.y + sh / 2);
}
