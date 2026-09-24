/* SoldierView — faithful port of the legacy Soldier.draw() to Phaser.
   A mirrored Container (scaleX = facing) holds pooled part Images whose
   origins reproduce Atlas.drawA's anchored, trim-aware blit; a nested gun
   container pivots at the shoulder exactly like the canvas save/rotate stack.
   Part orientation golden rule: ALL art faces RIGHT naturally — only the
   outer container mirror turns the soldier (never per-part flips). */
import Phaser from "phaser";
import { clamp, TAU, rnd, SPR, partOrigin, SOLDIER_W, SOLDIER_H, LEG_LIFT } from "../../shared/constants.js";
import { WEAPONS } from "../../shared/weapons.js";

const ATLAS = "menu";

export class SoldierView {
  constructor(scene) {
    this.scene = scene;
    const img = (name, depth = 0) => {
      const i = scene.add.image(0, 0, ATLAS, name);
      i.setDepth(depth);
      return i;
    };
    this.shadow = scene.add.ellipse(0, 0, 48, 12, 0x000000, 0.25).setDepth(4.9);

    this.root = scene.add.container(0, 0).setDepth(5);
    this.legL = img("leg1.png", 1); this.legR = img("leg1.png", 1);
    this.body = img("body1.png", 2); this.head = img("head1.png", 3);
    this.root.add([this.legL, this.legR, this.body, this.head]);

    /* gun assembly pivoting at the shoulder */
    this.gun = scene.add.container(0, 0);
    this.gun.setDepth(4);
    this.armRear = img("arm1.png", 1);
    this.gunImg = img("m61.png", 2);
    this.magImg = img("m61Mag.png", 3).setVisible(false);
    this.flashImg = img("flare.png", 4).setVisible(false);
    this.flashImg.setBlendMode(Phaser.BlendModes.ADD);
    this.armFront = img("arm1.png", 5);
    this.gun.add([this.armRear, this.gunImg, this.magImg, this.flashImg, this.armFront]);
    this.root.add(this.gun);

    /* screen-space extras (never mirrored) */
    this.nameText = scene.add.text(0, 0, "", {
      fontFamily: "Trebuchet MS", fontSize: "11px", color: "#ffb04a",
    }).setOrigin(0.5).setDepth(9);
    this.hpBg = scene.add.rectangle(0, 0, 52, 5, 0x000000, 0.65).setDepth(9);
    this.hpBar = scene.add.rectangle(0, 0, 50, 3, 0xe74c3c).setOrigin(0, 0.5).setDepth(9);
    this.shieldRing = scene.add.circle(0, 0, 70).setStrokeStyle(2, 0x78c8ff, 0.5).setVisible(false).setDepth(9);

    this.flashT = 0;
  }

  flash() { this.flashT = 0.05; }

  setSkin(skin) {
    this.legL.setTexture(ATLAS, skin.leg); this.legR.setTexture(ATLAS, skin.leg);
    this.body.setTexture(ATLAS, skin.body); this.head.setTexture(ATLAS, skin.head);
    this.armRear.setTexture(ATLAS, skin.arm); this.armFront.setTexture(ATLAS, skin.arm);
  }

  /* state: {x,y,aim,facing,dead,invuln,shield,walkT,grounded,reloading,weaponId,flashT,recoilT,swingT,name,hp,showTag} */
  update(s, dt, time) {
    const visible = !s.dead;
    this.root.setVisible(visible);
    this.shadow.setVisible(visible);
    this.nameText.setVisible(visible && !!s.showTag);
    this.hpBg.setVisible(visible && !!s.showTag);
    this.hpBar.setVisible(visible && !!s.showTag);
    if (!visible) { this.shieldRing.setVisible(false); return; }

    /* drop shadow on the ground below (canopy art reads as air otherwise) */
    const sw = s.w || SOLDIER_W, sh = s.h || SOLDIER_H;
    const feetX = s.x + sw / 2, feetY = s.y + sh;
    const ground = this.scene.map.groundBelow(feetX, feetY, 420);
    if (ground) {
      const d = ground.y - feetY;
      this.shadow.setVisible(true);
      this.shadow.setPosition(feetX, ground.y - 3);
      const sx = clamp(24 - d * 0.05, 9, 24), sy = clamp(6 - d * 0.012, 2.5, 6);
      this.shadow.setScale(sx / 24, sy / 6);
      this.shadow.setFillStyle(0x000000, clamp(0.30 - d * 0.0009, 0.06, 0.30));
    } else this.shadow.setVisible(false);

    const m = this.scene.frameSizeCache;
    const skin = this.skin || s.skin || { head: "head1.png", body: "body1.png", arm: "arm1.png", leg: "leg1.png" };
    const legH = (m(skin.leg).h || 84) * SPR;
    const bodyH = (m(skin.body).h || 102) * SPR;
    const hip = legH - 5, neck = legH - 5 + bodyH - 7, shoulder = legH - 5 + bodyH * 0.28;

    const walk = s.walkT ? Math.sin(s.walkT * 10) : 0;
    const bob = s.grounded && s.walkT ? Math.abs(Math.cos(s.walkT * 10)) * 2 : 0;
    this.root.setPosition(s.x + sw / 2, s.y + sh - bob);
    this.root.setScale(s.facing, 1);   /* containers have no setScaleX */
    this.root.setAlpha(s.invuln > 0 && Math.floor(time * 12) % 2 === 0 ? 0.35 : 1);

    const legSwing = s.walkT ? walk * 0.35 : 0;
    /* Legacy drawA anchored parts to the FULL source box (trim included);
       Phaser anchors to the trimmed quad — convert each legacy anchor so
       joints land exactly where the original put them (no seams). */
    const set = (img, name, x, y, ax, ay, rot = 0, alpha = 1) => {
      const b = this.frameBox(name);
      const [ox, oy] = partOrigin(b.tw, b.th, b.sw, b.sh, ax, ay, b.offX, b.offY);
      img.setPosition(x, y).setOrigin(ox, oy).setRotation(rot).setScale(SPR).setAlpha(alpha);
    };
    set(this.legL, skin.leg, -8, -hip - LEG_LIFT, 0.5, 0.08, legSwing);
    set(this.legR, skin.leg, 8, -hip - LEG_LIFT, 0.5, 0.08, -legSwing);
    set(this.body, skin.body, 0, -hip, 0.5, 1);
    set(this.head, skin.head, 1, -neck + 5, 0.5, 0.92);

    /* gun assembly — pivots at the REAR shoulder (the torso edge opposite
       the facing direction), never the chest center: the container mirrors
       with facing, so inside it "forward" is +x and the rear edge is -x */
    const w = WEAPONS[s.weaponId] || WEAPONS.m61;
    const gw = (this.scene.frameSizeCache(w.sprite).w || 60) * SPR;
    const gh = (this.scene.frameSizeCache(w.sprite).h || 40) * SPR;
    const kick = clamp((s.recoilT || 0) / (w.kick || 0.08), 0, 1);
    const swing = w.melee && (s.swingT || 0) > 0 ? Math.sin((0.22 - s.swingT) / 0.22 * Math.PI) * 1.4 - 0.7 : 0;
    const bodyW = (m(skin.body).w || 56) * SPR;
    const shoulderDx = -bodyW * 0.35;
    this.gun.setPosition(shoulderDx, -shoulder);
    this.gun.setRotation((s.facing < 0 ? Math.PI - s.aim : s.aim) + swing - kick * 0.10);
    set(this.armRear, skin.arm, 0, 1, 0.10, 0.5, 0.16 + kick * 0.06);
    const gunName = (s.reloading || 0) > 0 && w.empty ? w.empty : w.sprite;
    this.gunImg.setTexture(ATLAS, gunName);
    set(this.gunImg, gunName, -kick * 9, 2, 0.28, 0.58);

    /* magazine drop/reinsert while reloading */
    if ((s.reloading || 0) > 0 && w.magFrame) {
      const t = 1 - s.reloading / (w.reload || 1);
      let dy = 0, magRot = 0, a = 0;
      if (t < 0.42) { const p = t / 0.42; dy = p * p * 44; magRot = p * 0.9; a = 1 - p * 0.9; }
      else if (t > 0.62) { const p = (1 - t) / 0.38; dy = p * p * 44; magRot = p * 0.9; a = 1 - p * 0.85; }
      this.magImg.setVisible(a > 0.03);
      if (a > 0.03) { this.magImg.setTexture(ATLAS, w.magFrame); set(this.magImg, w.magFrame, gw * 0.36 - kick * 9, 4 + gh * 0.30 + dy, 0.5, 0.12, magRot, a); }
    } else this.magImg.setVisible(false);

    /* muzzle flash */
    this.flashT = Math.max(0, (s.flashT !== undefined ? s.flashT : this.flashT) - dt);
    const showFlash = this.flashT > 0 && !w.melee && !w.flame;
    this.flashImg.setVisible(showFlash);
    if (showFlash) {
      this.flashImg.setTexture(ATLAS, "flare.png");
      set(this.flashImg, "flare.png", gw * 0.72 + 6 - kick * 9, 2, 0.5, 0.5, rnd(0, TAU), clamp(this.flashT * 22, 0, 1));
      this.flashImg.setScale(SPR * (0.55 + Math.random() * 0.35));
    }
    set(this.armFront, skin.arm, gw * 0.08, 2, 0.10, 0.5, -0.05 - kick * 0.04);

    /* tags + shield */
    this.nameText.setText(s.name || "");
    this.nameText.setPosition(s.x + sw / 2, s.y - 26);
    this.hpBg.setPosition(s.x + sw / 2, s.y - 22);
    this.hpBar.setPosition(s.x + sw / 2 - 25, s.y - 22);
    this.hpBar.width = 50 * clamp((s.hp || 0) / 100, 0, 1);
    this.shieldRing.setVisible((s.shield || 0) > 0);
    this.shieldRing.setPosition(s.x + sw / 2, s.y + sh / 2);
  }

  /* Trimmed-frame box for an atlas image: tw/th = drawn quad, sw/sh = the
     full source box the legacy anchors were authored against, offX/offY =
     the quad's cocos trim offsets. Source sizes come from the atlas JSON
     (authoritative, no Phaser-internals guessing). */
  frameBox(name) {
    const f = this.scene.textures.getFrame(ATLAS, name);
    const tw = (f && (f.width || f.cutWidth)) || 0, th = (f && (f.height || f.cutHeight)) || 0;
    if (!this._plistFrames) {
      const p = this.scene.cache.json.get("plist:menu");
      this._plistFrames = (p && p.frames) || {};
    }
    const fr = this._plistFrames[name] || {};
    return {
      tw, th, sw: fr.srcW || tw, sh: fr.srcH || th,
      offX: fr.offX || 0, offY: fr.offY || 0,
    };
  }

  destroy() {
    for (const o of [this.shadow, this.root, this.nameText, this.hpBg, this.hpBar, this.shieldRing]) o.destroy();
  }
}
