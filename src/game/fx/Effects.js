/* Effects — transient combat visuals: event-driven fx/sfx, bullet tracers
   (tracked sim bullets in solo, ghost tracers online), grenade visuals,
   explosions and beam rendering. Owns the particle emitters. */
import { clamp, rnd, pick } from "../../../shared/utils/math.js";
import { NADE } from "../../../shared/config/tuning.js";
import { NADES } from "../../../shared/weapons.js";
import { Ev } from "../../../shared/events.js";
import { nadeThrowVelocity, stepGhostNade } from "../../../shared/combat.js";

export class Effects {
  constructor(scene, sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.vbullets = []; // ghost tracers (online)
    this.nades = []; // ghost nades (online)
    this._bulletImgs = new Set(); // pooled imgs bound to sim bullets (solo)
    this._nadeImgs = new Set(); // pooled imgs bound to sim nades (solo)
  }

  build() {
    this.beamGfx = this.scene.add.graphics().setDepth(7);
    this.emitters = {
      blood: this.scene.add
        .particles(0, 0, "fx:blood", {
          speed: { min: 60, max: 260 },
          angle: { min: 200, max: 340 },
          scale: { start: 0.3, end: 0.1 },
          lifespan: 600,
          gravityY: 600,
          emitting: false,
        })
        .setDepth(6),
      spark: this.scene.add
        .particles(0, 0, "fx:spark", {
          speed: { min: 80, max: 220 },
          scale: { start: 0.2, end: 0.05 },
          lifespan: 300,
          emitting: false,
        })
        .setDepth(6),
      smoke: this.scene.add
        .particles(0, 0, "fx:smoke", {
          speedY: { min: 40, max: 120 },
          speedX: { min: -30, max: 30 },
          scale: { start: 0.22, end: 0.4 },
          alpha: { start: 0.8, end: 0 },
          lifespan: 700,
          emitting: false,
        })
        .setDepth(6),
      /* jetpack exhaust licks: small, fast, downward (menu atlas flame art,
         shared with the flamethrower) */
      jet: this.scene.add
        .particles(0, 0, "menu", {
          frame: "flame1.png",
          speedY: { min: 60, max: 180 },
          speedX: { min: -40, max: 40 },
          scale: { start: 0.12, end: 0.03 },
          alpha: { start: 1, end: 0 },
          lifespan: 220,
          emitting: false,
        })
        .setDepth(6),
    };
  }

  /* jetpack exhaust: one smoke puff + one small flame lick. Both jet sites
     (sim SMOKE events, remote-soldier jet flags) funnel through here. */
  jetpuff(x, y) {
    this.emitters.smoke.emitParticleAt(x, y, 1);
    this.emitters.jet.emitParticleAt(x, y, 1);
  }

  /* solo: fire/nade visuals come from sim state (tracked below) — their
     event ghosts are skipped. online: events seed all visuals. */
  applyEvent(e, solo) {
    switch (e.t) {
      case Ev.FIRE:
        if (solo) break;
        if (e.flame) {
          this.spawnBullet(e.x, e.y, e.vx, e.vy, e.life || 0.5, {
            flame: true,
          });
        } else {
          this.spawnBullet(e.x, e.y, e.vx, e.vy, e.life || 0.95, {
            rocket: e.rocket,
            emp: e.emp,
            ghost: true,
          });
          this.sfx.play(e.sfx || "ak47", 0.45, rnd(0.95, 1.05));
        }
        break;
      case Ev.NADE:
        if (!solo) this.spawnGhostNade(e.x, e.y, e.vx, e.vy);
        break;
      case Ev.BOOM:
        this.spawnExplosion(e.x, e.y, e.r);
        this.scene.cameras.main.shake(120, 0.006);
        this.sfx.play("explode", 0.8, rnd(0.9, 1.1));
        break;
      case Ev.HIT:
        this.emitters.blood.emitParticleAt(e.x, e.y, Math.min(12, e.n || 4));
        break;
      case Ev.SPARK:
        this.emitters.spark.emitParticleAt(e.x, e.y, (e.n || 2) * 3);
        break;
      case Ev.SMOKE:
        this.jetpuff(e.x, e.y);
        break;
      case Ev.DEATH:
        this.sfx.play(pick(["death1", "death3", "death5", "death9"]), 0.6);
        break;
      case Ev.PICKUP:
        /* pickup respawn sync comes via schema (online) / sim (solo) */
        break;
      case Ev.SFX:
        this.sfx.play(e.n, e.vol, e.rate);
        break;
      default:
        break;
    }
  }

  /* visual-only nade while the authoritative one comes back via events */
  spawnThrowGhost(pred) {
    if (pred.dead || pred.nades <= 0) return;
    const m = pred.muzzle();
    const { vx, vy } = nadeThrowVelocity(pred.aim, pred.vx);
    this.spawnGhostNade(m.x, m.y, vx, vy);
  }

  spawnGhostNade(x, y, vx, vy) {
    this.nades.push({
      x,
      y,
      vx,
      vy,
      t: 0,
      fuse: NADE.FUSE,
      def: NADES.fragnade,
      ghost: true,
    });
  }

  /* ------------------------------------------------------------ bullets */
  spawnBullet(x, y, vx, vy, life, o = {}) {
    if (o.tracked) {
      /* pooled image bound to a sim bullet */
      if (!o.tracked._img) {
        o.tracked._img = this.scene.add.image(x, y, "fx:bullet").setDepth(6);
        this._bulletImgs.add(o.tracked._img);
      }
      const img = o.tracked._img;
      img.setPosition(x, y);
      img.setRotation(Math.atan2(vy, vx));
      if (o.flame) {
        img
          .setTexture("menu", "flame1.png")
          .setScale((o.tracked.r || 18) / 40)
          .setAlpha(clamp(life * 3, 0, 1));
      } else if (o.emp) img.setTexture("menu", "empBubble.png").setScale(0.12);
      else if (o.rocket) img.setTexture("menu", "rocket.png").setScale(0.4);
      else img.setTexture("fx:bullet").setScale(1).setAlpha(1);
      return;
    }
    this.vbullets.push({
      x,
      y,
      vx,
      vy,
      life: life || 0.95,
      flame: o.flame,
      emp: o.emp,
      rocket: o.rocket,
      img: null,
    });
  }

  /* solo: every sim bullet gets/keeps its pooled image */
  syncTrackedBullets(simBullets) {
    for (const b of simBullets)
      this.spawnBullet(b.x, b.y, b.vx, b.vy, b.life, {
        flame: b.flame,
        emp: b.emp,
        rocket: b.rocket,
        tracked: b,
      });
  }

  stepVisualBullets(dt, simBullets) {
    /* tracked sim-bullet images: mark live, destroy the ones whose bullet died */
    const live = new Set();
    for (const b of simBullets)
      if (b._img) {
        b._img.setVisible(true);
        live.add(b._img);
      }
    for (const img of this._bulletImgs)
      if (!live.has(img)) {
        img.destroy();
        this._bulletImgs.delete(img);
      }
    /* ghost bullets (net events): integrate + draw */
    for (let i = this.vbullets.length - 1; i >= 0; i--) {
      const b = this.vbullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        if (b.img) b.img.destroy();
        this.vbullets.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!b.img) {
        b.img = b.flame
          ? this.scene.add.image(b.x, b.y, "menu", "flame1.png")
          : b.emp
            ? this.scene.add.image(b.x, b.y, "menu", "empBubble.png")
            : this.scene.add.image(b.x, b.y, "fx:bullet").setDepth(6);
        b.img.setDepth(6);
      }
      b.img.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx));
      if (b.flame)
        b.img.setScale(rnd(14, 22) / 40).setAlpha(clamp(b.life * 3, 0, 1));
      else if (b.emp) b.img.setScale(0.12);
      else if (b.rocket) {
        b.img.setTexture("menu", "rocket.png").setScale(0.4);
      }
    }
  }

  /* ------------------------------------------------------------ nades */
  /* solo: one image per sim nade (attached to the nade object, like bullets) */
  syncSoloNades(simNades, t) {
    const live = new Set();
    for (const n of simNades) {
      if (!n._img) {
        n._img = this.scene.add
          .image(n.x, n.y, "menu", n.def.sprite)
          .setDepth(6)
          .setScale(0.4);
        this._nadeImgs.add(n._img);
      }
      n._img.setPosition(n.x, n.y).setRotation(t * 6);
      live.add(n._img);
    }
    for (const img of this._nadeImgs)
      if (!live.has(img)) {
        img.destroy();
        this._nadeImgs.delete(img);
      }
  }

  /* online: integrate ghost nades with the shared legacy kinematics */
  stepGhostNades(dt, t, map) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += dt;
      stepGhostNade(n, dt, (x, y) => map.solidAtPixel(x, y));
      if (n.t >= (n.fuse || NADE.FUSE)) {
        if (n.img) n.img.destroy();
        this.nades.splice(i, 1);
        continue;
      }
      if (!n.img)
        n.img = this.scene.add
          .image(n.x, n.y, "menu", n.def.sprite)
          .setDepth(6)
          .setScale(0.4);
      n.img.setPosition(n.x, n.y).setRotation(t * 6);
    }
  }

  /* ------------------------------------------------------------ boom/beams */
  spawnExplosion(x, y) {
    const img = this.scene.add
      .image(x, y, "menu", "explosion.png")
      .setDepth(7)
      .setScale(0.25)
      .setAlpha(1);
    this.scene.tweens.add({
      targets: img,
      scale: 1.45,
      alpha: 0,
      duration: 300,
      ease: "Quart.easeOut",
      onComplete: () => {
        img.destroy();
      },
    });
  }

  stepBeams(beams) {
    this.beamGfx.clear();
    if (beams)
      for (const bm of beams) {
        this.beamGfx.lineStyle(3, 0xff3c3c, clamp(bm.t * 12, 0, 1));
        this.beamGfx.lineBetween(bm.x0, bm.y0, bm.x1, bm.y1);
      }
  }
}
