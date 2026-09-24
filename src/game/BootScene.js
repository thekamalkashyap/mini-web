/* BootScene — loads the extracted assets, converts formats for Phaser
   (cocos plist -> atlas JSON, pipeline map -> Tiled JSON), builds the 2px
   alpha collision mask (same pixels the server traces via pngjs), then hands
   over to WorldScene. Shows a loading bar. */
import Phaser from "phaser";
import { mapToTiled } from "./tiled.js";
import { plistToPhaserAtlas } from "./plist.js";
import { SND_NAMES } from "./Sfx.js";
import { GameMap } from "../../shared/map.js";

export class BootScene extends Phaser.Scene {
  constructor() { super("boot"); }
  init(opts) {
    /* Phaser passes {} when a config-array scene auto-starts — fall back to
       the boot opts stashed on the game registry by createGame() */
    this.opts = (opts && opts.map) ? opts : (this.registry.get("bootOpts") || {});
  }

  preload() {
    const { map } = this.opts;
    const W = this.scale.width, H = this.scale.height;
    const bar = this.add.rectangle(W / 2 - 150, H / 2, 300, 8, 0x222e3d).setOrigin(0, 0.5);
    const fill = this.add.rectangle(W / 2 - 150, H / 2, 0, 8, 0x6fdc7a).setOrigin(0, 0.5);
    const label = this.add.text(W / 2, H / 2 - 24, "loading…", {
      fontFamily: "Trebuchet MS", fontSize: "14px", color: "#cfe2f3",
    }).setOrigin(0.5);
    this.load.on("progress", p => { fill.width = 300 * p; label.setText(`loading ${Math.round(p * 100)}%`); });

    this.load.image("menuPNG", "img/menuTexture.png");
    this.load.image("partsPNG", "img/partsTexture.png");
    for (const ts of ["tile64_new.png", "tile64Desert_new.png", "tile64Moon_new.png", "tile64Snow_new.png"])
      this.load.image("ts:" + ts, "img/" + ts);
    for (const bg of ["bg_new.png", "bgDesert_new.png", "bgMoon_new.png", "bgSnow_new.png"])
      this.load.image("bg:" + bg, "img/" + bg);
    this.load.image("fx:bullet", "img/bullet_new.png");
    this.load.image("fx:blood", "img/blood_new.png");
    this.load.image("fx:smoke", "img/smoke_new.png");
    this.load.image("fx:spark", "img/spark_new.png");
    this.load.text("mapJson:" + map, `data/maps/${map}.json`);
    this.load.json("plist:menu", "data/atlas/menuTexture.json");
    this.load.json("plist:parts", "data/atlas/partsTexture.json");
    for (const n of SND_NAMES) this.load.audio(n.replace(/\.wav$/, ""), "audio/" + n);
  }

  create() {
    try { this.createInner(); } catch (e) { window.__bootErr = (window.__bootErr || "") + "|boot:" + (e && e.stack || e); console.error("boot create failed", e); }
  }

  createInner() {
    /* plist -> Phaser atlas (JSON-hash shape: frames keyed by name), sourced
       from the loaded PNG textures */
    for (const [key, pngKey] of [["menu", "menuPNG"], ["parts", "partsPNG"]]) {
      const plist = this.cache.json.get("plist:" + key);
      const src = this.textures.get(pngKey).getSourceImage();
      this.textures.addAtlasJSONHash(key, src, plistToPhaserAtlas(plist));
    }

    /* map JSON -> Tiled format, registered for make.tilemap — the cache entry
       must mirror what the loader stores: { format: TILED_JSON, data } */
    const raw = JSON.parse(this.cache.text.get("mapJson:" + this.opts.map));
    if (this.cache.tilemap.has("map")) this.cache.tilemap.remove("map");
    this.cache.tilemap.add("map", { format: Phaser.Tilemaps.Formats.TILED_JSON, data: mapToTiled(raw) });

    /* alpha collision mask — identical rule to the server's pngjs tracer */
    const maskData = this.buildMask(raw);
    this.registry.set("mapJson", raw);
    this.registry.set("maskData", maskData);

    this.scene.start("world", this.opts);
  }

  buildMask(raw) {
    const ctxCache = {};
    const getCtx = imgKey => {
      if (ctxCache[imgKey]) return ctxCache[imgKey];
      const img = this.textures.get(imgKey).getSourceImage();
      const cv = this.textures.createCanvas("maskctx:" + imgKey, img.width, img.height);
      const c = cv.getContext();
      c.drawImage(img, 0, 0);
      ctxCache[imgKey] = c;
      return c;
    };
    return GameMap.buildMaskData(raw, (gid, json) => {
      const ts = json.tilesets.find(t => t.firstgid <= gid) || json.tilesets[0];
      const c = getCtx("ts:" + ts.image);
      const idx = gid - ts.firstgid;
      const col = idx % ts.columns, row = Math.floor(idx / ts.columns);
      const sx = ts.margin + col * (ts.tileW + ts.spacing), sy = ts.margin + row * (ts.tileH + ts.spacing);
      return c.getImageData(sx, sy, ts.tileW, ts.tileH).data;
    });
  }
}
