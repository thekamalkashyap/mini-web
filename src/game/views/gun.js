/* Gun assembly layout — nested container pivoting at the shoulder:
   gun sprite (reload empty-frame swap), dropping/reinserting magazine,
   procedural muzzle flash, and the front arm gripping the barrel. */
import { clamp, rnd, TAU } from "../../../shared/utils/math.js";
import { SPR } from "../../../shared/config/tuning.js";
import { avatarMetrics } from "../../../shared/avatar.js";
import { weaponById } from "../../../shared/weapons.js";

export function layoutGun(view, s, skin, dt) {
  const sizes = view.scene.frameSizeCache;
  const w = weaponById(s.weaponId);
  const gw = (sizes(w.sprite).w || 60) * SPR;
  const gh = (sizes(w.sprite).h || 40) * SPR;
  const kick = clamp((s.recoilT || 0) / (w.kick || 0.08), 0, 1);
  const swing =
    w.melee && (s.swingT || 0) > 0
      ? Math.sin(((0.22 - s.swingT) / 0.22) * Math.PI) * 1.4 - 0.7
      : 0;
  const { shoulder, shoulderDx } = avatarMetrics(sizes, skin);
  const place = view.frames.place.bind(view.frames);

  /* gun assembly — pivots at the REAR shoulder (the torso edge opposite
     the facing direction), never the chest center: the container mirrors
     with facing, so inside it "forward" is +x and the rear edge is -x */
  view.gun.setPosition(shoulderDx, -shoulder - 10);
  view.gun.setRotation(
    (s.facing < 0 ? Math.PI - s.aim : s.aim) + swing - kick * 0.1,
  );
  const gunName = (s.reloading || 0) > 0 && w.empty ? w.empty : w.sprite;
  view.gunImg.setTexture("menu", gunName);
  place(view.gunImg, gunName, -kick * 9, 2, 0.28, 0.7);

  /* magazine drop/reinsert while reloading */
  if ((s.reloading || 0) > 0 && w.magFrame) {
    const t = 1 - s.reloading / (w.reload || 1);
    let dy = 0,
      magRot = 0,
      a = 0;
    if (t < 0.42) {
      const p = t / 0.42;
      dy = p * p * 44;
      magRot = p * 0.9;
      a = 1 - p * 0.9;
    } else if (t > 0.62) {
      const p = (1 - t) / 0.38;
      dy = p * p * 44;
      magRot = p * 0.9;
      a = 1 - p * 0.85;
    }
    view.magImg.setVisible(a > 0.03);
    if (a > 0.03) {
      view.magImg.setTexture("menu", w.magFrame);
      place(
        view.magImg,
        w.magFrame,
        gw * 0.36 - kick * 9,
        4 + gh * 0.3 + dy,
        0.5,
        0.12,
        magRot,
        a,
      );
    }
  } else view.magImg.setVisible(false);

  /* muzzle flash */
  view.flashT = Math.max(
    0,
    (s.flashT !== undefined ? s.flashT : view.flashT) - dt,
  );
  const showFlash = view.flashT > 0 && !w.melee && !w.flame;
  view.flashImg.setVisible(showFlash);
  if (showFlash) {
    view.flashImg.setTexture("menu", "flare.png");
    place(
      view.flashImg,
      "flare.png",
      gw * 0.72 + 6 - kick * 9,
      2,
      0.5,
      0.5,
      rnd(0, TAU),
      clamp(view.flashT * 22, 0, 1),
    );
    view.flashImg.setScale(SPR * (0.55 + Math.random() * 0.35));
  }
  place(view.armFront, skin.arm, gw * 0.08, 2, 0.4, 1, -0.05 - kick * 0.04);
}
