/* Node-side asset loading for the Colyseus room (and tests): map JSON +
 * alpha-traced collision mask (pngjs) + atlas frame sizes. The mask is built
 * from the SAME tile art pixels the browser sees, so server collision ==
 * client collision. Everything is cached per map name. */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { GameMap } from "../shared/map.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const mapCache = new Map();

function readJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }

/* decode tileset PNG once per image; getTilePixels crops a tile by gid.
   APK-carved PNGs can carry trailing junk after IEND — pngjs is strict, so
   trim the buffer at the IEND chunk marker first. */
function readPngTrimmed(file) {
  const buf = fs.readFileSync(file);
  const iend = buf.lastIndexOf(Buffer.from("IEND"));
  return PNG.sync.read(iend > 0 ? buf.subarray(0, iend + 8) : buf);   /* +8: type(4)+crc(4) */
}

function tilePixelProvider(json) {
  const pngs = new Map();
  return (gid, j) => {
    const ts = j.tilesets.find(t => t.firstgid <= gid) || j.tilesets[0];
    let png = pngs.get(ts.image);
    if (!png) {
      png = readPngTrimmed(path.join(ROOT, "img", ts.image));
      pngs.set(ts.image, png);
    }
    const idx = gid - ts.firstgid, tw = ts.tileW, th = ts.tileH;
    const cols = Math.floor((png.width - ts.margin * 2 + ts.spacing) / (tw + ts.spacing));
    const col = idx % cols, row = Math.floor(idx / cols);
    const sx = ts.margin + col * (tw + ts.spacing), sy = ts.margin + row * (th + ts.spacing);
    const out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      const src = ((sy + y) * png.width + sx) * 4, dst = y * tw * 4;
      out.set(png.data.subarray(src, src + tw * 4), dst);
    }
    return out;
  };
}

const atlasCache = new Map();

export function loadMapBundle(mapName) {
  if (mapCache.has(mapName)) return mapCache.get(mapName);
  const json = readJson(`data/maps/${mapName}.json`);
  const maskData = GameMap.buildMaskData(json, tilePixelProvider(json));
  const menu = readJson("data/atlas/menuTexture.json");
  const sizes = {};
  for (const [name, fr] of Object.entries(menu.frames)) sizes[name] = { w: fr.w, h: fr.h };
  const frameSize = n => sizes[n] || { w: 0, h: 0 };
  const bundle = { mapJson: json, maskData, frameSize, menuAtlas: menu };
  mapCache.set(mapName, bundle);
  return bundle;
}

export { ROOT };
