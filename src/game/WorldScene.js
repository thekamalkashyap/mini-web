/* WorldScene — Phaser scene running the game.
   Solo mode: a local WorldSim (me + optional bots) stepped here.
   Online mode: the Colyseus room is authoritative; this scene runs client-side
   prediction for the OWN soldier only (cosmetic fire, state-driven respawn —
   the legacy guest recipe), renders remotes from interpolated schema state,
   and turns "evs" events into fx/sfx exactly like the legacy guests did. */
import Phaser from "phaser";
import Matter from "matter-js";
import { WorldSim } from "../../shared/sim.js";
import { WEAPONS, NADES } from "../../shared/weapons.js";
import { GameMap } from "../../shared/map.js";
import {
  clamp,
  lerp,
  rnd,
  pick,
  TAU,
  SPR,
  skinFor,
  MAPS,
  resolveMapId,
  SOLDIER_W,
  SOLDIER_H,
} from "../../shared/constants.js";
import { SoldierView } from "./SoldierView.js";
import { Sfx } from "./Sfx.js";
import { ClientNet } from "../net/ClientNet.js";
import { useStore } from "../store.js";

export class WorldScene extends Phaser.Scene {
  constructor() {
    super("world");
  }

  init(opts) {
    this.opts = Object.assign(
      {
        mode: "solo",
        map: "1outpost",
        bots: 0,
        demo: false,
        flashHold: false,
        colliders: false,
        zoom: 0,
      },
      opts,
    );
    this.opts.map = resolveMapId(this.opts.map);
  }

  create() {
    try {
      this.createInner();
    } catch (e) {
      window.__bootErr =
        (window.__bootErr || "") + "|world:" + ((e && e.stack) || e);
      console.error("world create failed", e);
    }
  }

  createInner() {
    const o = this.opts;
    this.mapLabel = (MAPS.find((m) => m[0] === o.map) || [null, o.map])[1];

    /* ---------- world model ---------- */
    const raw = this.registry.get("mapJson");
    this.map = new GameMap(raw, this.registry.get("maskData"));
    this.frameSizeCache = (n) => {
      const t = this.textures.getFrame("menu", n);
      return t ? { w: t.cutWidth, h: t.cutHeight } : { w: 0, h: 0 };
    };
    this.sfx = new Sfx(this.sound);
    this.showColliders = !!o.colliders;
    this.zoomOverride = o.zoom ? clamp(o.zoom, 1, 3) : 0;
    this.views =
      new Map(); /* id -> SoldierView (local/predicted + solo bots) */
    this.remoteViews =
      new Map(); /* sessionId -> {view, x, y, aim, tx, ty, taim} */
    this.pickupViews = [];
    this.vbullets = [];
    this.nades = [];
    this._bulletImgs = new Set();
    this._nadeImgs = new Set();

    /* ---------- sim ---------- */
    this.sim = new WorldSim({
      mapJson: raw,
      maskData: this.registry.get("maskData"),
      frameSize: this.frameSizeCache,
      mode: o.mode === "online" ? "predict" : "solo",
      flashHold: o.flashHold,
    });
    this.remoteViews = new Map(); /* sessionId -> {view, tx, ty, taim, ...} */
    this.pickupViews = [];
    if (o.mode === "solo") {
      this.sim.me = this.sim.addPlayer({ id: "me", name: "YOU" });
      if (o.bots)
        for (const b of [
          ["bot0", "BOT Diesel"],
          ["bot1", "BOT Chowdhury"],
        ])
          this.sim.addPlayer({ id: b[0], name: b[1], isBot: true });
    } else {
      this.net = o.net || new ClientNet();
      this.room = this.net.room;
      this.pred = this.sim.addPlayer({
        id: "me",
        name: "YOU",
        cosmeticFire: true,
        authoritativeRespawn: true,
      });
      this.pred.invuln = 0;
      this.sim.me = this.pred;
      this.wireRoom();
      this._inpAcc = 0;
    }

    /* ---------- render layers ---------- */
    this.buildBackground();
    this.buildTilemap();
    this.buildObjects();
    this.buildPickups();
    this.buildFx();

    /* ---------- camera ---------- */
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.w, this.map.h);
    cam.setBackgroundColor("#8ecbf0");
    this.camZoom = 1;

    /* ---------- input ---------- */
    this.keys = this.input.keyboard.addKeys({
      left: "A",
      right: "D",
      jet: "W",
      up: "UP",
      leftA: "LEFT",
      rightA: "RIGHT",
      space: "SPACE",
      use: "E",
    });
    this.input.keyboard.on("keydown-R", () => this.meReload());
    this.input.keyboard.on("keydown-G", () => this.meNade());
    this.input.keyboard.on("keydown-M", () => {
      this.sfx.toggleMute();
      this.toast("sound " + (this.sfx.muted ? "off" : "on"));
    });
    this.input.keyboard.on("keydown-BACKTICK", () => {
      this.showColliders = !this.showColliders;
    });
    this.input.mouse && this.input.mouse.disableContextMenu();
    this.input.on("pointerdown", (p) => {
      if (p.leftButtonDown()) this.lmb = true;
      if (p.rightButtonDown()) this.rmb = true;
    });
    this.input.on("pointerup", (p) => {
      if (!p.leftButtonDown()) this.lmb = false;
      if (!p.rightButtonDown()) this.rmb = false;
    });

    if (o.demo) this.demoHold = true;

    this.events.on("shutdown", () => this.cleanup());
    this._hudAcc = 0;
    this.toast(
      "map: " + this.mapLabel + (o.mode === "online" ? " · online" : " · solo"),
    );
  }

  /* ================================================================ room */
  wireRoom() {
    /* schema read directly in update(); events via ClientNet */
  }

  /* ============================================================== build */
  buildBackground() {
    const name = this.map.tilesets[0].image.replace("tile64", "bg");

    const key = this.textures.exists("bg:" + name)
      ? "bg:" + name
      : "bg:bg_new.png";

    const img = this.textures.get(key).getSourceImage();

    const vw = this.scale.width;
    const vh = this.scale.height;

    // Scale image so it completely covers the viewport
    const scale = Math.max(vw / img.width, vh / img.height);

    this.bg = this.add
      .tileSprite(0, 0, vw, vh, key)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-10);

    this.bg.setTileScale(scale, scale);
  }

  buildTilemap() {
    const tiled = this.make.tilemap({ key: "map" });
    const tsDef = this.map.tilesets[0];
    const tileset = tiled.addTilesetImage(
      tsDef.image.replace(/\.png$/, ""),
      "ts:" + tsDef.image,
    );
    this.layerBg = tiled
      .createLayer("tilebg", tileset)
      .setDepth(-5)
      .setAlpha(0.9);
    this.layerSolid = tiled.createLayer("tile", tileset).setDepth(0);
  }

  buildObjects() {
    /* background/foreground sprite objects + flag stations from TMX objects */
    for (const ob of this.map.objects) {
      if (ob.name === "spritebg")
        this.add
          .image(ob.x, ob.y, "menu", (ob.props.sprite || "") + ".png")
          .setDepth(-4)
          .setAlpha(0.9);
      else if (ob.name === "spritefg")
        this.add
          .image(ob.x, ob.y, "menu", (ob.props.sprite || "") + ".png")
          .setDepth(8)
          .setAlpha(0.95);
      else if (ob.name.startsWith("fp_b")) {
        const sp = ob.props.sprite || "flagStationBlue";
        this.add
          .image(ob.x, ob.y + 30, "menu", sp + ".png")
          .setDepth(-3)
          .setScale(0.8);
        /* flag art is authored horizontal (pole+diamond); stand it upright so
           the pole plants into the station with the ball finial on top */
        const flag = this.add
          .image(
            ob.x,
            ob.y - 40,
            "menu",
            sp.includes("Orange") ? "flagOrange.png" : "flagBlue.png",
          )
          .setDepth(-3)
          .setScale(0.55)
          .setRotation(-Math.PI / 2 - 0.08);
        this.tweens.add({
          targets: flag,
          x: "+=4",
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        this.tweens.add({
          targets: flag,
          rotation: -Math.PI / 2 + 0.08,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }
    }
  }

  /* icons rest ON the settled ground point (bottom-anchored per sprite),
     with a small hover bob — re-run on sprite swaps (pads cycle items) */
  layoutPickupView(img, k, sprite, scale) {
    const halfH = ((this.frameSizeCache(sprite).h || 40) * scale) / 2;
    const baseY = k.y - halfH + 3;
    img.setPosition(k.x, baseY).setScale(scale);
    this.tweens.killTweensOf(img);
    this.tweens.add({
      targets: img,
      y: baseY - 4,
      duration: 1000 + (k.x % 500),
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  buildPickups() {
    for (const k of this.sim.pickups) {
      const id = k.list[k.idx % k.list.length];
      const w = WEAPONS[id] || NADES[id];
      const sprite = w ? w.sprite : "m61.png";
      const scale = w && (w.item || NADES[id]) ? 0.5 : 0.42;
      const img = this.add.image(k.x, k.y, "menu", sprite).setDepth(1);
      this.layoutPickupView(img, k, sprite, scale);
      this.pickupViews.push(img);
    }
  }

  refreshPickupViews() {
    const src =
      this.opts.mode === "online" && this.room
        ? this.room.state.pickups
        : this.sim.pickups;
    for (let i = 0; i < this.pickupViews.length; i++) {
      const k = src[i];
      if (!k) continue;
      const respawn = k.respawn,
        idx = k.idx;
      this.pickupViews[i].setVisible(!(respawn > 0));
      const id = k.list ? k.list[idx % k.list.length] : null;
      if (id) {
        const w = WEAPONS[id] || NADES[id];
        const pos = this.sim.pickups[i];
        if (w && pos && this.pickupViews[i].frame.name !== w.sprite) {
          this.pickupViews[i].setTexture("menu", w.sprite);
          this.layoutPickupView(
            this.pickupViews[i],
            pos,
            w.sprite,
            w.item || NADES[id] ? 0.5 : 0.42,
          );
        }
      }
    }
  }

  buildFx() {
    this.bulletPool = [];
    this.nadeImgs = [];
    this.explosions = [];
    this.beamGfx = this.add.graphics().setDepth(7);
    this.emitters = {
      blood: this.add
        .particles(0, 0, "fx:blood", {
          speed: { min: 60, max: 260 },
          angle: { min: 200, max: 340 },
          scale: { start: 0.3, end: 0.1 },
          lifespan: 600,
          gravityY: 600,
          emitting: false,
        })
        .setDepth(6),
      spark: this.add
        .particles(0, 0, "fx:spark", {
          speed: { min: 80, max: 220 },
          scale: { start: 0.2, end: 0.05 },
          lifespan: 300,
          emitting: false,
        })
        .setDepth(6),
      smoke: this.add
        .particles(0, 0, "fx:smoke", {
          speedY: { min: 40, max: 120 },
          speedX: { min: -30, max: 30 },
          scale: { start: 0.22, end: 0.4 },
          alpha: { start: 0.8, end: 0 },
          lifespan: 700,
          emitting: false,
        })
        .setDepth(6),
    };
    this.colliderGfx = this.add.graphics().setDepth(9);
  }

  /* ================================================================ loop */
  update(time, deltaMs) {
    try {
      this.updateInner(time, deltaMs);
    } catch (e) {
      console.error("world update failed", e);
    }
  }

  updateInner(time, deltaMs) {
    /* AGENT.md golden rule #1 — dt must be clamped, never trust raw stamps */
    const dt = clamp(deltaMs / 1000 || 0.016, 0.001, 0.033);
    const t = time / 1000;

    const input = this.humanInput();

    if (this.opts.mode === "solo") {
      this.sim.me.input = input;
      this.sim.step(dt);
      this.drainLocalEvents();
      this.syncSoloViews(t, dt);
    } else {
      /* prediction: own soldier locally, corrected by authoritative state */
      this.pred.input = input;
      this.sim.step(dt);
      this.drainLocalEvents();
      this.drainNetEvents();
      this.correctPrediction();
      this.syncRemoteViews(dt, t);
      this._inpAcc -= dt;
      if (this._inpAcc <= 0) {
        this.net.sendInput(input);
        this._inpAcc = 1 / 30;
      }
    }

    this.refreshPickupViews();
    this.stepVisualBullets(dt);
    this.stepNades(dt, t);
    this.stepFx(dt);
    this.updateCamera(dt, input);
    if (this.showColliders) this.drawColliders();
    else this.colliderGfx.clear();

    this._hudAcc -= dt;
    if (this._hudAcc <= 0) {
      this.syncHud();
      this._hudAcc = 0.1;
    }
  }

  humanInput() {
    const k = this.keys,
      cam = this.cameras.main;
    const ptr = this.input.activePointer;
    const wp = cam.getWorldPoint(ptr.x, ptr.y);
    const inp = {
      left: k.left.isDown || k.leftA.isDown,
      right: k.right.isDown || k.rightA.isDown,
      jet: k.jet.isDown || k.space.isDown || k.up.isDown,
      fire: !!this.lmb || !!this.demoHold,
      use: k.use.isDown,
      aimX: wp.x,
      aimY: wp.y,
    };
    if (this.opts.demo) {
      inp.fire = true;
      inp.aimX = this.sim.me ? this.sim.me.cx() + 400 : wp.x;
      inp.aimY = this.sim.me ? this.sim.me.cy() - 100 : wp.y;
    }
    return inp;
  }

  meReload() {
    if (this.opts.mode === "solo") this.sim.me.reload();
    else {
      this.net.sendReload();
      this.pred.reload();
    }
  }
  meNade() {
    if (this.opts.mode === "solo") this.sim.me.throwNade();
    else {
      this.net.sendNade();
      this.predGhostNade();
    }
  }
  predGhostNade() {
    /* visual-only nade while the authoritative one comes back via events */
    const p = this.pred;
    if (p.dead || p.nades <= 0) return;
    const m = p.muzzle();
    this.nades.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(p.aim) * 780 + p.vx * 0.4,
      vy: Math.sin(p.aim) * 780 - 160,
      t: 0,
      fuse: 2,
      def: NADES.fragnade,
      ghost: true,
    });
  }

  /* ------------------------------------------------------------ events */
  drainLocalEvents() {
    /* solo: sim events drive this client's fx/sfx. fire/nade visuals come from
       the sim state itself (tracked images) — skip their event ghosts. */
    for (const e of this.sim.drainEvents()) this.applyEvent(e);
  }

  drainNetEvents() {
    if (!this.net) return;
    for (const e of this.net.events) this.applyEvent(e);
    this.net.events.length = 0;
  }

  applyEvent(e) {
    const solo = this.opts.mode === "solo";
    switch (e.t) {
      case "fire":
        if (solo) break; /* solo bullets render from sim state (tracked) */
        if (e.flame) {
          this.spawnBullet(e.x, e.y, e.vx, e.vy, e.life || 0.5, {
            flame: true,
          });
        } else {
          this.spawnBullet(e.x, e.y, e.vx, e.vy, e.life || 0.95, {
            rocket: e.rocket,
            ghost: true,
          });
          this.sfx.play(e.sfx || "ak47", 0.45, rnd(0.95, 1.05));
        }
        break;
      case "nade":
        if (!solo)
          this.nades.push({
            x: e.x,
            y: e.y,
            vx: e.vx,
            vy: e.vy,
            t: 0,
            fuse: 2,
            def: NADES.fragnade,
            ghost: true,
          });
        break;
      case "boom":
        this.spawnExplosion(e.x, e.y, e.r);
        this.cameras.main.shake(120, 0.006);
        this.sfx.play("explode", 0.8, rnd(0.9, 1.1));
        break;
      case "hit":
        this.emitters.blood.emitParticleAt(e.x, e.y, Math.min(12, e.n || 4));
        break;
      case "spark":
        this.emitters.spark.emitParticleAt(e.x, e.y, (e.n || 2) * 3);
        break;
      case "smoke":
        this.emitters.smoke.emitParticleAt(e.x, e.y, 1);
        break;
      case "death":
        this.sfx.play(pick(["death1", "death3", "death5", "death9"]), 0.6);
        break;
      case "pk":
        /* pickup respawn sync comes via schema (online) / sim (solo) */ break;
      case "sfx":
        this.sfx.play(e.n, e.vol, e.rate);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------ views */
  soldierStateOf(p, showTag) {
    return {
      x: p.x,
      y: p.y,
      w: p.w || SOLDIER_W,
      h: p.h || SOLDIER_H,
      aim: p.aim,
      facing: p.facing,
      dead: p.dead,
      invuln: p.invuln,
      shield: p.shieldT,
      walkT: p.walkT,
      grounded: p.grounded,
      reloading: p.reloading,
      weaponId: p.weaponId,
      flashT: p.flashT,
      recoilT: p.recoilT,
      swingT: p.swingT,
      name: p.name,
      hp: p.hp,
      showTag,
      skin: p.skin,
    };
  }

  syncSoloViews(t, dt) {
    /* create/destroy views to match sim players */
    const alive = new Set();
    for (const p of this.sim.players) {
      alive.add(p.id);
      let v = this.views && this.views.get(p.id);
      if (!v) {
        v = new SoldierView(this);
        v.setSkin(p.skin);
        (this.views || (this.views = new Map())).set(p.id, v);
      }
      v.update(this.soldierStateOf(p, p.id !== "me"), dt, t);
    }
    if (this.views)
      for (const [id, v] of this.views)
        if (!alive.has(id)) {
          v.destroy();
          this.views.delete(id);
        }

    /* local bullets -> visuals (authoritative in solo) */
    for (const b of this.sim.bullets)
      this.spawnBullet(b.x, b.y, b.vx, b.vy, b.life, {
        flame: b.flame,
        rocket: b.rocket,
        tracked: b,
      });
    /* nades drawn from sim state directly in stepNades when solo */
    if (this.opts.mode === "solo") {
      this.nades = this.sim.nades.map((n) => ({
        x: n.x,
        y: n.y,
        def: n.def,
        ghost: true,
        visual: true,
      }));
    }
  }

  correctPrediction() {
    if (!this.room) return;
    const s = this.room.state.players.get(this.room.sessionId);
    if (!s) return;
    const p = this.pred;
    if (s.hp < p.hp - 0.5)
      this.emitters.blood.emitParticleAt(p.cx(), p.cy(), 4);
    p.hp = s.hp;
    p.fuel = s.fuel;
    p.ammo = s.ammo;
    p.nades = s.nades;
    if (s.dead && !p.dead) p.die(null);
    if (!s.dead && p.dead) {
      p.dead = false;
      p.deadT = 0;
      p.invuln = 2.0;
      p.ensureBody(true);
    }
    const w = WEAPONS[s.wep] || WEAPONS.m61;
    if (w !== p.weapon) {
      p.weapon = w;
      p.weaponId = s.wep;
      this.sfx.play("switch", 0.4);
    }
    const dx = s.x - p.x,
      dy = s.y - p.y;
    if (Math.hypot(dx, dy) > 220) {
      p.x = s.x;
      p.y = s.y;
    } else {
      p.x += dx * 0.18;
      p.y += dy * 0.18;
    }
    if (p.body)
      Matter.Body.setPosition(p.body, { x: p.x + p.w / 2, y: p.y + p.h / 2 });
  }

  syncRemoteViews(dt, t) {
    if (!this.room) return;
    const state = this.room.state;
    const seen = new Set();
    state.players.forEach((s, id) => {
      seen.add(id);
      if (id === this.room.sessionId) {
        /* own view = prediction state */
        let v = this.views && this.views.get(id);
        if (!v) {
          v = new SoldierView(this);
          v.setSkin(this.pred.skin);
          (this.views || (this.views = new Map())).set(id, v);
        }
        v.update(this.soldierStateOf(this.pred, false), dt, t);
        return;
      }
      let r = this.remoteViews.get(id);
      if (!r) {
        r = { view: new SoldierView(this), tx: s.x, ty: s.y, taim: s.aim };
        r.view.setSkin(skinFor(id));
        r.view.nameText.setColor("#ffd76e");
        this.remoteViews.set(id, r);
      }
      r.tx = s.x;
      r.ty = s.y;
      r.taim = s.aim;
      r.state = s;
      r.x = r.x === undefined ? s.x : lerp(r.x, r.tx, 0.25);
      r.y = r.y === undefined ? s.y : lerp(r.y, r.ty, 0.25);
      r.aim = r.aim === undefined ? s.aim : lerp(r.aim, r.taim, 0.3);
      const facing = Math.cos(r.aim) >= 0 ? 1 : -1;
      r.view.update(
        {
          x: r.x,
          y: r.y,
          w: SOLDIER_W,
          h: SOLDIER_H,
          aim: r.aim,
          facing,
          dead: s.dead,
          invuln: s.invuln,
          shield: s.shield,
          walkT: s.walkT,
          grounded: false,
          reloading: s.reloading,
          weaponId: s.wep,
          recoilT: 0,
          swingT: 0,
          name: s.name,
          hp: s.hp,
          showTag: true,
        },
        dt,
        t,
      );
      if (s.jet) this.emitters.smoke.emitParticleAt(r.x + 22, r.y + 80, 1);
    });
    for (const [id, r] of this.remoteViews)
      if (!seen.has(id)) {
        r.view.destroy();
        this.remoteViews.delete(id);
      }
    if (this.views)
      for (const [id, v] of this.views)
        if (!seen.has(id)) {
          v.destroy();
          this.views.delete(id);
        }
  }

  /* ------------------------------------------------------------ bullets/fx */
  spawnBullet(x, y, vx, vy, life, o = {}) {
    if (o.tracked) {
      /* pooled image bound to a sim bullet */
      if (!o.tracked._img) {
        o.tracked._img = this.add.image(x, y, "fx:bullet").setDepth(6);
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
      } else if (o.rocket) img.setTexture("menu", "rocket.png").setScale(0.4);
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
      rocket: o.rocket,
      img: null,
    });
  }

  stepVisualBullets(dt) {
    /* tracked sim-bullet images: mark live, destroy the ones whose bullet died */
    const live = new Set();
    for (const b of this.sim.bullets)
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
          ? this.add.image(b.x, b.y, "menu", "flame1.png")
          : this.add.image(b.x, b.y, "fx:bullet").setDepth(6);
        b.img.setDepth(6);
      }
      b.img.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx));
      if (b.flame)
        b.img.setScale(rnd(14, 22) / 40).setAlpha(clamp(b.life * 3, 0, 1));
      else if (b.rocket) {
        b.img.setTexture("menu", "rocket.png").setScale(0.4);
      }
    }
  }

  stepNades(dt, t) {
    if (this.opts.mode === "solo") {
      /* one image per sim nade (attached to the nade object, like bullets) */
      const live = new Set();
      for (const n of this.sim.nades) {
        if (!n._img) {
          n._img = this.add
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
    } else {
      for (let i = this.nades.length - 1; i >= 0; i--) {
        const n = this.nades[i];
        n.t += dt;
        n.vy += 1300 * dt;
        const steps = Math.max(
          1,
          Math.ceil((Math.hypot(n.vx, n.vy) * dt) / 16),
        );
        for (let s = 0; s < steps; s++) {
          const nx = n.x + (n.vx * dt) / steps,
            ny = n.y + (n.vy * dt) / steps;
          if (this.map.solidAtPixel(nx, n.y)) n.vx *= -0.45;
          else n.x = nx;
          if (this.map.solidAtPixel(n.x, ny)) n.vy *= -0.45;
          else n.y = ny;
        }
        if (n.t >= (n.fuse || 2)) {
          if (n.img) n.img.destroy();
          this.nades.splice(i, 1);
          continue;
        }
        if (!n.img)
          n.img = this.add
            .image(n.x, n.y, "menu", n.def.sprite)
            .setDepth(6)
            .setScale(0.4);
        n.img.setPosition(n.x, n.y).setRotation(t * 6);
      }
    }
  }

  spawnExplosion(x, y, r) {
    const img = this.add
      .image(x, y, "menu", "explosion.png")
      .setDepth(7)
      .setScale(0.25)
      .setAlpha(1);
    this.explosions.push(img);
    this.tweens.add({
      targets: img,
      scale: 1.45,
      alpha: 0,
      duration: 300,
      ease: "Quart.easeOut",
      onComplete: () => {
        img.destroy();
      },
    });
    void r;
  }

  stepFx(dt) {
    void dt;
    this.beamGfx.clear();
    if (this.sim)
      for (const bm of this.sim.beams) {
        this.beamGfx.lineStyle(3, 0xff3c3c, clamp(bm.t * 12, 0, 1));
        this.beamGfx.lineBetween(bm.x0, bm.y0, bm.x1, bm.y1);
      }
  }

  /* ------------------------------------------------------------ camera */
  updateCamera(dt, input) {
    const cam = this.cameras.main;
    const me = this.sim.me || this.pred;
    if (!me) return;
    const zoomT = this.zoomOverride
      ? this.zoomOverride
      : this.rmb && me.weapon.zoom
        ? 1.8
        : 1;
    this.camZoom = lerp(this.camZoom, zoomT, 1 - Math.pow(0.001, dt));
    cam.setZoom(this.camZoom);
    const vw = this.scale.width / this.camZoom,
      vh = this.scale.height / this.camZoom;
    const tx = clamp(me.cx() - vw / 2, 0, Math.max(0, this.map.w - vw));
    const ty = clamp(me.cy() - vh / 2, 0, Math.max(0, this.map.h - vh));
    /* keep the classic eased follow (lerp toward target) */
    cam.scrollX = lerp(cam.scrollX, tx, 1 - Math.pow(0.0001, dt));
    cam.scrollY = lerp(cam.scrollY, ty, 1 - Math.pow(0.0001, dt));
    /* parallax: background drifts slower than the world */

    void input;
  }

  /* ------------------------------------------------------------ colliders */
  drawColliders() {
    const g = this.colliderGfx;
    g.clear();
    if (!this.sim) return;
    /* interior mass reads faint — the eye should follow the surface line */
    g.lineStyle(1, 0x3cdc78, 0.35);
    for (const r of this.map.solidRects()) g.strokeRect(r.x, r.y, r.w, r.h);
    const skins = this.map.solidShapes().skins || [];
    g.fillStyle(0x3cdc78, 0.06);
    for (const s of skins) {
      g.fillPoints(
        [
          { x: s.x0, y: s.y0 },
          { x: s.x1, y: s.y1 },
          { x: s.x1, y: s.y1 + s.depth },
          { x: s.x0, y: s.y0 + s.depth },
        ],
        true,
      );
    }
    /* the walkable surface itself: one diagonal per run, riding the art */
    g.lineStyle(3, 0xff3b30, 1);
    for (const s of skins) g.lineBetween(s.x0, s.y0, s.x1, s.y1);
    g.lineStyle(3, 0xff8c28, 1);
    for (const p of this.sim.players)
      if (!p.dead) g.strokeRect(p.x, p.y, p.w, p.h);
    g.lineStyle(3, 0xffd732, 1);
    for (const n of this.sim.nades) if (n.body) g.strokeCircle(n.x, n.y, 8);
    /* gun rotation axis: live gun-container pivot (crosshair) + aim ray to the
       muzzle dot. Pivot comes from the rendered transform, so it marks where
       the art actually rotates even if the sim/view formulas drift. */
    const guns = [];
    for (const [id, v] of this.views) {
      const p = this.sim.players.find((q) => q.id === id);
      if (p && !p.dead)
        guns.push({ view: v, aim: p.aim, weaponId: p.weaponId });
    }
    for (const [, r] of this.remoteViews) {
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
      const w = WEAPONS[weaponId] || WEAPONS.m61;
      const reach = (this.frameSizeCache(w.sprite).w || 60) * SPR * 0.72 + 6;
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

  /* ------------------------------------------------------------ hud */
  syncHud() {
    const me = this.opts.mode === "online" ? this.pred : this.sim.me;
    if (!me) return;
    /* "press E" prompt: a grabbable gun/nade in radius (online also honors
       the authoritative respawn timers, which the prediction sim can't see) */
    const schema =
      this.opts.mode === "online" && this.room ? this.room.state.pickups : null;
    const near =
      !me.dead &&
      this.sim.pickupNear(
        me,
        schema
          ? (i) => {
              const s = schema[i];
              return !!s && s.respawn > 0;
            }
          : null,
      );
    useStore.getState().actions.setHud({
      hp: me.hp,
      fuel: me.fuel,
      ammo: me.ammo,
      mag: me.weapon.mag,
      reloading: me.reloading,
      weaponName: me.weapon.name,
      nades: me.nades,
      kills: me.kills,
      dead: me.dead,
      deadT: Math.max(0, me.deadT),
      mapLabel: this.mapLabel,
      mode: this.opts.mode,
      players:
        this.opts.mode === "online" && this.room
          ? this.room.state.players.size
          : this.sim.players.length,
      showColliders: this.showColliders,
      muted: this.sfx.muted,
      connected:
        this.opts.mode !== "online" || (this.net && this.net.connected),
      pickupName: near ? near.name : null,
    });
  }

  toast(msg) {
    useStore.getState().actions.toast(msg);
  }

  cleanup() {
    if (this.net) {
      this.net.leave();
    }
    useStore.getState().actions.setHud(null);
  }
}
