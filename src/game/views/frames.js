/* FrameCache — trimmed-frame boxes + legacy-anchor placement for atlas parts.
   Legacy drawA anchored parts to the FULL source box (trim included); Phaser
   anchors to the trimmed quad. place() converts each legacy anchor via
   partOrigin so joints land exactly where the original put them (no seams). */
import { SPR } from "../../../shared/config/tuning.js";
import { partOrigin } from "../../../shared/avatar.js";

export const ATLAS = "menu";

export class FrameCache {
  constructor(scene) {
    this.scene = scene;
    this._plistFrames = null;
  }

  /* Trimmed-frame box: tw/th = drawn quad, sw/sh = the full source box the
     legacy anchors were authored against, offX/offY = cocos trim offsets.
     Source sizes come from the atlas JSON (authoritative). */
  box(name) {
    const f = this.scene.textures.getFrame(ATLAS, name);
    const tw = (f && (f.width || f.cutWidth)) || 0,
      th = (f && (f.height || f.cutHeight)) || 0;
    if (!this._plistFrames) {
      const p = this.scene.cache.json.get("plist:menu");
      this._plistFrames = (p && p.frames) || {};
    }
    const fr = this._plistFrames[name] || {};
    return {
      tw,
      th,
      sw: fr.srcW || tw,
      sh: fr.srcH || th,
      offX: fr.offX || 0,
      offY: fr.offY || 0,
    };
  }

  place(img, name, x, y, ax, ay, rot = 0, alpha = 1) {
    const b = this.box(name);
    const [ox, oy] = partOrigin(
      b.tw,
      b.th,
      b.sw,
      b.sh,
      ax,
      ay,
      b.offX,
      b.offY,
    );
    img
      .setPosition(x, y)
      .setOrigin(ox, oy)
      .setRotation(rot)
      .setScale(SPR)
      .setAlpha(alpha);
  }
}
