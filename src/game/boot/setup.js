/* Boot setup — convert loaded assets into Phaser-ready form: cocos plist
   atlases -> JSON-hash atlases, pipeline map -> Tiled JSON, and the 2px
   alpha collision mask traced from the same tile pixels the server sees. */
import Phaser from "phaser";
import { mapToTiled } from "../tiled.js";
import { plistToPhaserAtlas } from "../plist.js";
import { GameMap } from "../../../shared/map.js";

export function registerAtlases(scene) {
  /* plist -> Phaser atlas (JSON-hash shape: frames keyed by name), sourced
     from the loaded PNG textures */
  for (const [key, pngKey] of [
    ["menu", "menuPNG"],
    ["parts", "partsPNG"],
  ]) {
    const plist = scene.cache.json.get("plist:" + key);
    const src = scene.textures.get(pngKey).getSourceImage();
    scene.textures.addAtlasJSONHash(key, src, plistToPhaserAtlas(plist));
  }
}

export function registerTilemap(scene, mapId) {
  /* map JSON -> Tiled format, registered for make.tilemap — the cache entry
     must mirror what the loader stores: { format: TILED_JSON, data } */
  const raw = JSON.parse(scene.cache.text.get("mapJson:" + mapId));
  if (scene.cache.tilemap.has("map")) scene.cache.tilemap.remove("map");
  scene.cache.tilemap.add("map", {
    format: Phaser.Tilemaps.Formats.TILED_JSON,
    data: mapToTiled(raw),
  });
  return raw;
}

export function buildClientMask(scene, raw) {
  const ctxCache = {};
  const getCtx = (imgKey) => {
    if (ctxCache[imgKey]) return ctxCache[imgKey];
    const img = scene.textures.get(imgKey).getSourceImage();
    const cv = scene.textures.createCanvas(
      "maskctx:" + imgKey,
      img.width,
      img.height,
    );
    const c = cv.getContext();
    c.drawImage(img, 0, 0);
    ctxCache[imgKey] = c;
    return c;
  };
  return GameMap.buildMaskData(raw, (gid, json) => {
    const ts = json.tilesets.find((t) => t.firstgid <= gid) || json.tilesets[0];
    const c = getCtx("ts:" + ts.image);
    const idx = gid - ts.firstgid;
    const col = idx % ts.columns,
      row = Math.floor(idx / ts.columns);
    const sx = ts.margin + col * (ts.tileW + ts.spacing),
      sy = ts.margin + row * (ts.tileH + ts.spacing);
    return c.getImageData(sx, sy, ts.tileW, ts.tileH).data;
  });
}
