/* GameMap — collision + object model shared by server room and client.
   Rendering moved to Phaser (Tiled adapter in the client); this file is the
   authoritative collision model (tile gids + optional 2px alpha mask).

   Golden rule (AGENT.md #2): TMX object y is bottom-up (cocos, double flip);
   flip ONCE here: y: this.h - o.y. Tile layer data is NOT flipped. */
import { TRIP } from "./constants.js";

export class GameMap {
  constructor(json, maskData = null) {
    this.def = json;
    this.tw = json.tileW; this.th = json.tileH;
    this.w = json.w * this.tw;
    this.h = json.h * this.th;
    this.cols = json.w; this.rows = json.h;
    this.tilesets = json.tilesets;
    this.layers = json.layers;
    this.solid = json.layers.find(l => l.name === "tile") || json.layers[json.layers.length - 1];
    this.objects = json.objects.map(o => ({
      ...o, y: this.h - o.y,
      kind: (o.name.match(/^[a-z]+/g) || ["misc"])[0],
    }));
    if (maskData) { this.mask = maskData.mask; this.maskStep = maskData.step; this.maskCols = maskData.cols; }
    else this.mask = null;
  }

  /* 2px-resolution solid bitmap traced from the tile art's alpha channel.
     getTilePixels(gid) -> Uint8ClampedArray RGBA (or null) — implemented via
     pngjs on the server and canvas/Phaser textures on the client, so BOTH
     sides see identical collision (the old headless whole-tile fallback
     diverged from the browser; masks are now mandatory for sim hosts). */
  static buildMaskData(json, getTilePixels) {
    const step = 2;
    const w = json.w * json.tileW, h = json.h * json.tileH;
    const cols = Math.ceil(w / step), rows = Math.ceil(h / step);
    const mask = new Uint8Array(cols * rows);
    const tw = json.tileW, th = json.tileH;
    const solid = json.layers.find(l => l.name === "tile") || json.layers[json.layers.length - 1];
    const dataCache = {};
    for (let ty = 0; ty < json.h; ty++) {
      for (let tx = 0; tx < json.w; tx++) {
        const gid = solid.data[ty * json.w + tx] & 0x1fffffff;
        if (!gid) continue;
        let data = dataCache[gid];
        if (data === undefined) { data = getTilePixels(gid, json); dataCache[gid] = data; }
        if (!data) continue;
        for (let py = 0; py < th; py += step)
          for (let px = 0; px < tw; px += step)
            if (data[(py * tw + px) * 4 + 3] > 36)
              mask[(((ty * th + py) / step) | 0) * cols + (((tx * tw + px) / step) | 0)] = 1;
      }
    }
    return { mask, step, cols };
  }

  tilesetFor(gid) {
    let ts = this.tilesets[0];
    for (const t of this.tilesets) if (t.firstgid <= gid) ts = t;
    return ts;
  }

  gidAt(layer, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return 0;
    return layer.data[ty * this.cols + tx] & 0x1fffffff;
  }

  solidAtPixel(x, y) {
    if (this.mask) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return this.mask[((y / this.maskStep) | 0) * this.maskCols + ((x / this.maskStep) | 0)] === 1;
    }
    return this.gidAt(this.solid, Math.floor(x / this.tw), Math.floor(y / this.th)) > 0;
  }

  /* AABB vs collision mask (2px sampling) — matches the art's silhouette */
  rectHitsWorld(x, y, w, h) {
    if (this.mask) {
      const st = this.maskStep;
      const x0 = Math.max(0, x), y0 = Math.max(0, y);
      const x1 = Math.min(this.w - 1, x + w - 1), y1 = Math.min(this.h - 1, y + h - 1);
      if (x1 < x0 || y1 < y0) return false;
      for (let py = y0; ; py += st) {
        if (py > y1) py = y1;
        const rowOff = ((py / st) | 0) * this.maskCols;
        for (let px = x0; ; px += st) {
          if (px > x1) px = x1;
          if (this.mask[rowOff + ((px / st) | 0)]) return true;
          if (px >= x1) break;
        }
        if (py >= y1) break;
      }
      return false;
    }
    const x0 = Math.floor(x / this.tw), x1 = Math.floor((x + w - 1) / this.tw);
    const y0 = Math.floor(y / this.th), y1 = Math.floor((y + h - 1) / this.th);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.gidAt(this.solid, tx, ty) > 0) return true;
    return false;
  }

  /* greedy-merged solid rectangles for the physics engine —
     8px cells over the art silhouette when a mask exists, else whole tiles */
  solidRects() {
    if (this._rects) return this._rects;
    const useMask = !!this.mask;
    const cell = useMask ? 8 : this.tw;
    const cols = Math.ceil(this.w / cell), rows = Math.ceil(this.h / cell);
    const grid = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        if (cx * cell >= this.w) continue;
        if (useMask) {
          const mx = ((cx * cell + cell / 2) / this.maskStep) | 0;
          const my = ((cy * cell + cell / 2) / this.maskStep) | 0;
          grid[cy][cx] = this.mask[my * this.maskCols + mx] === 1 ? 1 : 0;
        } else {
          grid[cy][cx] = this.gidAt(this.solid, cx, cy) > 0 ? 1 : 0;
        }
      }
    const rects = [];
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        if (!grid[cy][cx]) continue;
        let w = 1;
        while (cx + w < cols && grid[cy][cx + w]) w++;
        let h = 1;
        outer: while (cy + h < rows) {
          for (let k = 0; k < w; k++) if (!grid[cy + h][cx + k]) break outer;
          h++;
        }
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) grid[cy + dy][cx + dx] = 0;
        rects.push({ x: cx * cell, y: cy * cell, w: w * cell, h: h * cell });
      }
    TRIP("mesh", rects.length, 20000);
    this._rects = rects;
    return rects;
  }

  /* first solid ground directly below a world point (drop shadows) */
  groundBelow(x, y, maxDist = 420) {
    for (let d = 0; d <= maxDist; d += 6) {
      if (this.solidAtPixel(x, y + d)) return { x, y: y + d };
    }
    return null;
  }
}
