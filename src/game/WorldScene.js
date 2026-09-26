/* WorldScene — Phaser scene running the game.
   Solo mode: a local WorldSim (me + optional bots) stepped here.
   Online mode: the Colyseus room is authoritative; this scene runs client-side
   prediction for the OWN soldier only (cosmetic fire, state-driven respawn —
   the legacy guest recipe), renders remotes from interpolated schema state,
   and turns "evs" events into fx/sfx exactly like the legacy guests did.

   The scene is an orchestrator: input, world layers, pickups, effects,
   soldier views, camera, debug overlay and HUD sync each live in their own
   controller module (see the folders next to this file). */
import Phaser from "phaser";
import { WorldSim } from "../../shared/sim.js";
import { GameMap } from "../../shared/map.js";
import { clamp, clampDt } from "../../shared/utils/math.js";
import { NET } from "../../shared/config/tuning.js";
import { mapLabel, resolveMapId } from "../../shared/config/maps.js";
import { Sfx } from "./Sfx.js";
import { ClientNet } from "../net/ClientNet.js";
import { InputController } from "./input/InputController.js";
import { buildWorld } from "./world/WorldBuilder.js";
import { PickupViews } from "./pickups/PickupViews.js";
import { Effects } from "./fx/Effects.js";
import { SoldierPool } from "./players/SoldierPool.js";
import { correctPrediction } from "./players/Prediction.js";
import { CameraController } from "./camera/CameraController.js";
import { ColliderOverlay } from "./debug/ColliderOverlay.js";
import { syncHud, toast, clearHud } from "./hud/HudSync.js";

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
    this.online = o.mode === "online";
    this.mapLabel = mapLabel(o.map);

    /* ---------- world model ---------- */
    const raw = this.registry.get("mapJson");
    this.map = new GameMap(raw, this.registry.get("maskData"));
    this.frameSizeCache = (n) => {
      const t = this.textures.getFrame("menu", n);
      return t ? { w: t.cutWidth, h: t.cutHeight } : { w: 0, h: 0 };
    };
    this.sfx = new Sfx(this.sound);
    this.showColliders = !!o.colliders;

    /* ---------- sim ---------- */
    this.sim = new WorldSim({
      mapJson: raw,
      maskData: this.registry.get("maskData"),
      frameSize: this.frameSizeCache,
      mode: this.online ? "predict" : "solo",
      flashHold: o.flashHold,
    });
    if (!this.online) {
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
      this._inpAcc = 0;
    }

    /* ---------- controllers ---------- */
    buildWorld(this);
    this.pickups = new PickupViews(this);
    this.pickups.build(this.sim.pickups);
    this.effects = new Effects(this, this.sfx);
    this.effects.build();
    this.pool = new SoldierPool(this);
    this.cameraCtl = new CameraController(
      o.zoom ? clamp(o.zoom, 1, 3) : 0,
    );
    this.cameraCtl.setup(this, this.map);
    this.overlay = new ColliderOverlay(this);
    this.inputCtl = new InputController(
      this,
      { demo: o.demo },
      {
        getMe: () => this.sim.me,
        onReload: () => this.meReload(),
        onNade: () => this.meNade(),
        onToggleMute: () => {
          this.sfx.toggleMute();
          toast("sound " + (this.sfx.muted ? "off" : "on"));
        },
        onToggleColliders: () => {
          this.showColliders = !this.showColliders;
        },
      },
    );
    this.inputCtl.attach();

    this.events.on("shutdown", () => this.cleanup());
    this._hudAcc = 0;
    toast("map: " + this.mapLabel + (this.online ? " · online" : " · solo"));
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
    const dt = clampDt(deltaMs / 1000);
    const t = time / 1000;

    const input = this.inputCtl.humanInput();

    if (!this.online) {
      this.sim.me.input = input;
      this.sim.step(dt);
      this.drainLocalEvents();
      this.pool.syncSolo(this.sim.players, dt, t);
      this.effects.syncTrackedBullets(this.sim.bullets);
    } else {
      /* prediction: own soldier locally, corrected by authoritative state */
      this.pred.input = input;
      this.sim.step(dt);
      this.drainLocalEvents();
      this.drainNetEvents();
      correctPrediction(this.pred, this.room, this.sfx, this.effects);
      this.pool.syncOnline(this.room, this.pred, dt, t, this.effects);
      this._inpAcc -= dt;
      if (this._inpAcc <= 0) {
        this.net.sendInput(input);
        this._inpAcc = 1 / NET.INPUT_HZ;
      }
    }

    this.pickups.refresh(
      this.online && this.room ? this.room.state.pickups : this.sim.pickups,
      this.sim.pickups,
    );
    this.effects.stepVisualBullets(dt, this.sim.bullets);
    if (!this.online) this.effects.syncSoloNades(this.sim.nades, t);
    else this.effects.stepGhostNades(dt, t, this.map);
    this.effects.stepBeams(this.sim.beams);
    const me = this.sim.me || this.pred;
    this.cameraCtl.update(
      this,
      me,
      dt,
      this.inputCtl.rmb && me.weapon.zoom,
    );
    if (this.showColliders) this.overlay.draw(this.pool);
    else this.overlay.clear();

    this._hudAcc -= dt;
    if (this._hudAcc <= 0) {
      syncHud(this);
      this._hudAcc = 1 / NET.HUD_HZ;
    }
  }

  meReload() {
    if (!this.online) this.sim.me.reload();
    else {
      this.net.sendReload();
      this.pred.reload();
    }
  }
  meNade() {
    if (!this.online) this.sim.me.throwNade();
    else {
      this.net.sendNade();
      this.effects.spawnThrowGhost(this.pred);
    }
  }

  /* ------------------------------------------------------------ events */
  drainLocalEvents() {
    const solo = !this.online;
    for (const e of this.sim.drainEvents()) this.effects.applyEvent(e, solo);
  }

  drainNetEvents() {
    if (!this.net) return;
    for (const e of this.net.drainEvents()) this.effects.applyEvent(e, false);
  }

  cleanup() {
    if (this.net) {
      this.net.leave();
    }
    clearHud();
  }
}
