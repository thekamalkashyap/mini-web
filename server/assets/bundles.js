/* Map bundles for the Colyseus room (and tests): map JSON +
   alpha-traced collision mask (pngjs) + atlas frame sizes. The mask is built
   from the SAME tile art pixels the browser sees, so server collision ==
   client collision. Everything is cached per map name. */
import fs from "node:fs";
import path from "node:path";
import { GameMap } from "../../shared/map.js";
import { tilePixelProvider } from "./png.js";
import { frameSizeLookup } from "./atlas.js";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

const mapCache = new Map();

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
}

export function loadMapBundle(mapName) {
  if (mapCache.has(mapName)) return mapCache.get(mapName);
  const json = readJson(`data/maps/${mapName}.json`);
  const maskData = GameMap.buildMaskData(json, tilePixelProvider(ROOT));
  const menu = readJson("data/atlas/menuTexture.json");
  const bundle = {
    mapJson: json,
    maskData,
    frameSize: frameSizeLookup(menu),
    menuAtlas: menu,
  };
  mapCache.set(mapName, bundle);
  return bundle;
}
