/* SoldierView — faithful port of the legacy Soldier.draw() to Phaser.
   A mirrored Container (scaleX = facing) holds pooled part Images whose
   origins reproduce Atlas.drawA's anchored, trim-aware blit; a nested gun
   container pivots at the shoulder exactly like the canvas save/rotate stack.
   Part orientation golden rule: ALL art faces RIGHT naturally — only the
   outer container mirror turns the soldier (never per-part flips).

   Layout is split into focused renderers (views/): body, gun, overlays. */
import Phaser from "phaser";
import { SOLDIER_W, SOLDIER_H } from "../../shared/constants.js";
import { FrameCache, ATLAS } from "./views/frames.js";
import { layoutBody, resolveSkin } from "./views/body.js";
import { layoutGun } from "./views/gun.js";
import { layoutShadow, layoutTags } from "./views/overlays.js";

export class SoldierView {
  constructor(scene) {
    this.scene = scene;
    this.frames = new FrameCache(scene);
    const img = (name, depth = 0) => {
      const i = scene.add.image(0, 0, ATLAS, name);
      i.setDepth(depth);
      return i;
    };
    this.shadow = scene.add.ellipse(0, 0, 48, 12, 0x000000, 0.25).setDepth(4.9);

    this.root = scene.add.container(0, 0).setDepth(5);
    this.legL = img("leg1.png", 1);
    this.legR = img("leg1.png", 1);
    this.body = img("body1.png", 2);
    this.head = img("head1.png", 3);
    this.root.add([this.legL, this.legR, this.body, this.head]);

    /* gun assembly pivoting at the shoulder */
    this.gun = scene.add.container(0, 0);
    this.gun.setDepth(4);
    this.gunImg = img("m61.png", 2);
    this.magImg = img("m61Mag.png", 3).setVisible(false);
    this.flashImg = img("flare.png", 4).setVisible(false);
    this.flashImg.setBlendMode(Phaser.BlendModes.ADD);
    this.armFront = img("arm1.png", 5);
    this.gun.add([this.gunImg, this.magImg, this.flashImg, this.armFront]);
    this.root.add(this.gun);

    /* screen-space extras (never mirrored) */
    this.nameText = scene.add
      .text(0, 0, "", {
        fontFamily: "Trebuchet MS",
        fontSize: "11px",
        color: "#ffb04a",
      })
      .setOrigin(0.5)
      .setDepth(9);
    this.hpBg = scene.add.rectangle(0, 0, 52, 5, 0x000000, 0.65).setDepth(9);
    this.hpBar = scene.add
      .rectangle(0, 0, 50, 3, 0xe74c3c)
      .setOrigin(0, 0.5)
      .setDepth(9);
    this.shieldRing = scene.add
      .circle(0, 0, 70)
      .setStrokeStyle(2, 0x78c8ff, 0.5)
      .setVisible(false)
      .setDepth(9);

    this.flashT = 0;
  }

  flash() {
    this.flashT = 0.05;
  }

  setSkin(skin) {
    this.legL.setTexture(ATLAS, skin.leg);
    this.legR.setTexture(ATLAS, skin.leg);
    this.body.setTexture(ATLAS, skin.body);
    this.head.setTexture(ATLAS, skin.head);
    this.armFront.setTexture(ATLAS, skin.arm);
  }

  /* state: {x,y,aim,facing,dead,invuln,shield,walkT,grounded,reloading,weaponId,flashT,recoilT,swingT,name,hp,showTag} */
  update(s, dt, time) {
    const visible = !s.dead;
    this.root.setVisible(visible);
    this.shadow.setVisible(visible);
    this.nameText.setVisible(visible && !!s.showTag);
    this.hpBg.setVisible(visible && !!s.showTag);
    this.hpBar.setVisible(visible && !!s.showTag);
    if (!visible) {
      this.shieldRing.setVisible(false);
      return;
    }

    /* Avatar box is SOLDIER_W/H — dims come from state, never hardcoded */
    const sw = s.w || SOLDIER_W,
      sh = s.h || SOLDIER_H;
    const skin = resolveSkin(this, s);
    layoutShadow(this, s, sw, sh);
    layoutBody(this, s, skin, sw, sh, time);
    layoutGun(this, s, skin, dt);
    layoutTags(this, s, sw, sh);
  }

  frameBox(name) {
    return this.frames.box(name);
  }

  destroy() {
    for (const o of [
      this.shadow,
      this.root,
      this.nameText,
      this.hpBg,
      this.hpBar,
      this.shieldRing,
    ])
      o.destroy();
  }
}
