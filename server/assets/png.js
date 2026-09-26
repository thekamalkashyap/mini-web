/* Tileset pixel provider — decode each tileset PNG once, crop tiles by gid
   for the shared mask builder. APK-carved PNGs can carry trailing junk after
   IEND — pngjs is strict, so trim the buffer at the IEND chunk marker first. */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

export function readPngTrimmed(file) {
  const buf = fs.readFileSync(file);
  const iend = buf.lastIndexOf(Buffer.from("IEND"));
  return PNG.sync.read(iend > 0 ? buf.subarray(0, iend + 8) : buf); /* +8: type(4)+crc(4) */
}

export function tilePixelProvider(root) {
  const pngs = new Map();
  return (gid, j) => {
    const ts = j.tilesets.find((t) => t.firstgid <= gid) || j.tilesets[0];
    let png = pngs.get(ts.image);
    if (!png) {
      png = readPngTrimmed(path.join(root, "img", ts.image));
      pngs.set(ts.image, png);
    }
    const idx = gid - ts.firstgid,
      tw = ts.tileW,
      th = ts.tileH;
    const cols = Math.floor(
      (png.width - ts.margin * 2 + ts.spacing) / (tw + ts.spacing),
    );
    const col = idx % cols,
      row = Math.floor(idx / cols);
    const sx = ts.margin + col * (tw + ts.spacing),
      sy = ts.margin + row * (ts.tileH + ts.spacing);
    const out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      const src = ((sy + y) * png.width + sx) * 4,
        dst = y * tw * 4;
      out.set(png.data.subarray(src, src + tw * 4), dst);
    }
    return out;
  };
}
