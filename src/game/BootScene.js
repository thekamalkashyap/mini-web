/* BootScene — loads the extracted assets, converts formats for Phaser
   (cocos plist -> atlas JSON, pipeline map -> Tiled JSON), builds the 2px
   alpha collision mask (same pixels the server traces via pngjs), then hands
   over to WorldScene. Shows a loading bar. */
import Phaser from "phaser";
import { queueBootAssets } from "./boot/assets.js";
import { registerAtlases, registerTilemap, buildClientMask } from "./boot/setup.js";
import { resolveMapId } from "../../shared/constants.js";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }
  init(opts) {
    /* Phaser passes {} when a config-array scene auto-starts — fall back to
       the boot opts stashed on the game registry by createGame() */
    this.opts =
      opts && opts.map ? opts : this.registry.get("bootOpts") || {};
    /* coerce before preload queues the fetch: an unknown id 404s the map JSON
       (dev server answers index.html), which used to kill JSON.parse below
       and hang on a blank page */
    this.opts.map = resolveMapId(this.opts.map);
  }

  preload() {
    const { map } = this.opts;
    this.showProgress();
    queueBootAssets(this, map);
  }

  showProgress() {
    const W = this.scale.width,
      H = this.scale.height;
    const bar = this.add
      .rectangle(W / 2 - 150, H / 2, 300, 8, 0x222e3d)
      .setOrigin(0, 0.5);
    const fill = this.add
      .rectangle(W / 2 - 150, H / 2, 0, 8, 0x6fdc7a)
      .setOrigin(0, 0.5);
    const label = this.add
      .text(W / 2, H / 2 - 24, "loading…", {
        fontFamily: "Trebuchet MS",
        fontSize: "14px",
        color: "#cfe2f3",
      })
      .setOrigin(0.5);
    this.load.on("progress", (p) => {
      fill.width = 300 * p;
      label.setText(`loading ${Math.round(p * 100)}%`);
    });
    void bar;
  }

  create() {
    try {
      this.createInner();
    } catch (e) {
      window.__bootErr =
        (window.__bootErr || "") + "|boot:" + ((e && e.stack) || e);
      console.error("boot create failed", e);
      this.showError(e);
    }
  }

  /* never strand the user on a blank page — say what failed */
  showError(e) {
    try {
      const W = this.scale.width,
        H = this.scale.height;
      this.add
        .text(
          W / 2,
          H / 2 - 10,
          'failed to load map "' + (this.opts && this.opts.map) + '"',
          {
            fontFamily: "Trebuchet MS",
            fontSize: "16px",
            color: "#e74c3c",
            align: "center",
          },
        )
        .setOrigin(0.5);
      this.add
        .text(W / 2, H / 2 + 18, String((e && e.message) || e).slice(0, 160), {
          fontFamily: "Trebuchet MS",
          fontSize: "12px",
          color: "#9fb4c8",
          align: "center",
        })
        .setOrigin(0.5);
    } catch (_) {
      /* last resort: error is already in console + __bootErr */
    }
  }

  createInner() {
    registerAtlases(this);
    const raw = registerTilemap(this, this.opts.map);

    /* alpha collision mask — identical rule to the server's pngjs tracer */
    const maskData = buildClientMask(this, raw);
    this.registry.set("mapJson", raw);
    this.registry.set("maskData", maskData);

    this.scene.start("world", this.opts);
  }
}
