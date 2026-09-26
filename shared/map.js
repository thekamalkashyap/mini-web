/* GameMap — collision + object model shared by server room and client.
   Rendering moved to Phaser (Tiled adapter in the client); this file is the
   authoritative collision model (tile gids + optional 2px alpha mask).

   Golden rule (AGENT.md #2): TMX object y is bottom-up (cocos, double flip);
   flip ONCE here: y: this.h - o.y. Tile layer data is NOT flipped.

   Heavy builders live in collision/: mask.js (mask pipeline) and shapes.js
   (traced boundary segments via trace.js + simplify.js). This class owns
   the queries + result caches. */
import { buildMaskData, despikeMask, destairMask } from "./collision/mask.js";
import { buildColliderSegments } from "./collision/shapes.js";

export class GameMap {
  constructor(json, maskData = null) {
    this.def = json;
    this.tw = json.tileW;
    this.th = json.tileH;
    this.w = json.w * this.tw;
    this.h = json.h * this.th;
    this.cols = json.w;
    this.rows = json.h;
    this.tilesets = json.tilesets;
    this.layers = json.layers;
    this.solid =
      json.layers.find((l) => l.name === "tile") ||
      json.layers[json.layers.length - 1];
    this.objects = json.objects.map((o) => ({
      ...o,
      y: this.h - o.y,
      kind: (o.name.match(/^[a-z]+/g) || ["misc"])[0],
    }));
    if (maskData) {
      this.mask = maskData.mask;
      this.maskStep = maskData.step;
      this.maskCols = maskData.cols;
    } else this.mask = null;
  }

  /* mask pipeline entry points (see collision/mask.js) */
  static buildMaskData = buildMaskData;
  static despikeMask = despikeMask;
  static destairMask = destairMask;

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
      return (
        this.mask[
          ((y / this.maskStep) | 0) * this.maskCols + ((x / this.maskStep) | 0)
        ] === 1
      );
    }
    return (
      this.gidAt(this.solid, Math.floor(x / this.tw), Math.floor(y / this.th)) >
      0
    );
  }

  /* AABB vs collision mask (2px sampling) — matches the art's silhouette */
  rectHitsWorld(x, y, w, h) {
    if (this.mask) {
      const st = this.maskStep;
      const x0 = Math.max(0, x),
        y0 = Math.max(0, y);
      const x1 = Math.min(this.w - 1, x + w - 1),
        y1 = Math.min(this.h - 1, y + h - 1);
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
    const x0 = Math.floor(x / this.tw),
      x1 = Math.floor((x + w - 1) / this.tw);
    const y0 = Math.floor(y / this.th),
      y1 = Math.floor((y + h - 1) / this.th);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.gidAt(this.solid, tx, ty) > 0) return true;
    return false;
  }

  /* ---- cached shape builder (see collision/shapes.js) ---- */

  /* traced boundary segments feeding the matter bodies (cached per map) */
  colliderSegments() {
    if (this._segments) return this._segments;
    this._segments = buildColliderSegments(this);
    return this._segments;
  }

  solidShapes() {
    if (this._shapes) return this._shapes;
    this._shapes = { segments: this.colliderSegments() };
    return this._shapes;
  }

  /* first solid ground directly below a world point (drop shadows) */
  groundBelow(x, y, maxDist = 420) {
    for (let d = 0; d <= maxDist; d += 6) {
      if (this.solidAtPixel(x, y + d)) return { x, y: y + d };
    }
    return null;
  }
}
