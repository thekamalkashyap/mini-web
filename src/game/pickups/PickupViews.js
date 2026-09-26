/* PickupViews — floating item icons over settled pads. Positions come from
   the local sim (identical settle code runs everywhere); visibility + the
   cycled sprite come from `src` (sim pickups in solo, schema in online). */
import { WEAPONS, NADES } from "../../../shared/weapons.js";

const SCALE_ITEM = 0.5;
const SCALE_GUN = 0.42;

function iconScale(id) {
  const w = WEAPONS[id] || NADES[id];
  return w && (w.item || NADES[id]) ? SCALE_ITEM : SCALE_GUN;
}

export class PickupViews {
  constructor(scene) {
    this.scene = scene;
    this.views = [];
  }

  build(pickups) {
    for (const k of pickups) {
      const id = k.list[k.idx % k.list.length];
      const w = WEAPONS[id] || NADES[id];
      const sprite = w ? w.sprite : "m61.png";
      const img = this.scene.add.image(k.x, k.y, "menu", sprite).setDepth(1);
      this.layout(img, k, sprite, iconScale(id));
      this.views.push(img);
    }
  }

  /* icons rest ON the settled ground point (bottom-anchored per sprite),
     with a small hover bob — re-run on sprite swaps (pads cycle items) */
  layout(img, k, sprite, scale) {
    const halfH = ((this.scene.frameSizeCache(sprite).h || 40) * scale) / 2;
    const baseY = k.y - halfH + 3;
    img.setPosition(k.x, baseY).setScale(scale);
    this.scene.tweens.killTweensOf(img);
    this.scene.tweens.add({
      targets: img,
      y: baseY - 4,
      duration: 1000 + (k.x % 500),
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  refresh(src, positions) {
    for (let i = 0; i < this.views.length; i++) {
      const k = src[i];
      if (!k) continue;
      this.views[i].setVisible(!(k.respawn > 0));
      const id = k.list ? k.list[k.idx % k.list.length] : null;
      if (id) {
        const w = WEAPONS[id] || NADES[id];
        const pos = positions[i];
        if (w && pos && this.views[i].frame.name !== w.sprite) {
          this.views[i].setTexture("menu", w.sprite);
          this.layout(this.views[i], pos, w.sprite, iconScale(id));
        }
      }
    }
  }
}
