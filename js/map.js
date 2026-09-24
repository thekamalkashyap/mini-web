/* TMX map (pre-converted to JSON by pipeline) + Cocos2d atlas renderer */
class GameMap {
  constructor(json, atlas, tilesetImages, bgImages) {
    this.def = json;
    this.atlas = atlas;                 // Atlas instance
    this.tilesetImages = tilesetImages; // name -> Image (e.g. tile64_new.png)
    this.tw = json.tileW; this.th = json.tileH;
    this.w = json.w * this.tw;          // pixel size
    this.h = json.h * this.th;
    this.cols = json.w; this.rows = json.h;
    this.tilesets = json.tilesets;
    this.layers = json.layers;
    this.solid = json.layers.find(l => l.name === "tile") || json.layers[json.layers.length - 1];
    /* themed parallax background by tileset image name */
    const main = this.tilesets[0] ? this.tilesets[0].image : "tile64_new.png";
    this.bgImage = bgImages[main] || bgImages["tile64_new.png"];
    /* objects: TMX stored y bottom-up (cocos) -> flip to screen y-down */
    this.objects = json.objects.map(o => ({
      ...o, y: this.h - o.y,
      kind: (o.name.match(/^[a-z]+/g) || ["misc"])[0],
    }));
  }

  /* first solid ground directly below a world point (for drop shadows) */
  groundBelow(x, y, maxDist = 420) {
    for (let d = 0; d <= maxDist; d += 6) {
      if (this.solidAtPixel(x, y + d)) return { x, y: y + d };
    }
    return null;
  }

  /* greedy-merged solid rectangles for the physics engine —
     8px cells over the art silhouette when a mask exists, else whole tiles */
  solidRects() {
    if (this._rects) return this._rects;
    const useMask = !!this.mask;
    const cell = useMask ? 8 : this.tw;
    const cols = Math.ceil(this.w / cell), rows = Math.ceil(this.h / cell);
    const grid = Array.from({ length: rows }, (_, cy) => {
      const row = new Uint8Array(cols);
      for (let cx = 0; cx < cols; cx++) {
        if (cx * cell >= this.w) continue;
        if (useMask) {
          const mx = ((cx * cell + cell / 2) / this.maskStep) | 0;
          const my = ((cy * cell + cell / 2) / this.maskStep) | 0;
          row[cx] = this.mask[my * this.maskCols + mx] === 1 ? 1 : 0;
        } else {
          row[cx] = this.gidAt(this.solid, cx, cy) > 0 ? 1 : 0;
        }
      }
      return row;
    });
    const rects = [];
    for (let cy = 0; cy < rows; cy++) {
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
    }
    this._rects = rects;
    return rects;
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

  /* offscreen 2d context of a tileset image (for alpha sampling) */
  sheetCtx(name) {
    if (!this._sheets) this._sheets = {};
    if (!this._sheets[name]) {
      const img = this.tilesetImages[name];
      if (!img || typeof document === "undefined") return null;
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const c = cv.getContext("2d");
      c.drawImage(img, 0, 0);
      this._sheets[name] = c;
    }
    return this._sheets[name];
  }

  /* 2px-resolution solid bitmap traced from the tile art's alpha channel —
     collision that matches what you see (slopes, rocks, bush silhouettes) */
  buildMask() {
    if (this.mask || typeof document === "undefined") return;
    try {
      const step = 2;
      const cols = Math.ceil(this.w / step), rows = Math.ceil(this.h / step);
      const mask = new Uint8Array(cols * rows);
      const dataCache = {};
      for (let ty = 0; ty < this.rows; ty++) {
        for (let tx = 0; tx < this.cols; tx++) {
          const gid = this.gidAt(this.solid, tx, ty);
          if (!gid) continue;
          let data = dataCache[gid];
          if (data === undefined) {
            const t = this.tilesetFor(gid);
            const idx = gid - t.firstgid, col = idx % t.columns, row = Math.floor(idx / t.columns);
            const sx = t.margin + col * (t.tileW + t.spacing), sy = t.margin + row * (t.tileH + t.spacing);
            const sheet = this.sheetCtx(t.image);
            if (!sheet) { dataCache[gid] = null; continue; }
            data = sheet.getImageData(sx, sy, this.tw, this.th).data;
            dataCache[gid] = data;
          }
          if (!data) continue;
          for (let py = 0; py < this.th; py += step)
            for (let px = 0; px < this.tw; px += step)
              if (data[(py * this.tw + px) * 4 + 3] > 36)
                mask[(((ty * this.th + py) / step) | 0) * cols + (((tx * this.tw + px) / step) | 0)] = 1;
        }
      }
      this.mask = mask; this.maskStep = step; this.maskCols = cols;
    } catch (e) {
      this.mask = null;   /* headless/no-canvas: legacy tile collision */
    }
  }

  /* AABB vs tile grid */
  rectHitsWorld(x, y, w, h) {
    const x0 = Math.floor(x / this.tw), x1 = Math.floor((x + w - 1) / this.tw);
    const y0 = Math.floor(y / this.th), y1 = Math.floor((y + h - 1) / this.th);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.gidAt(this.solid, tx, ty) > 0) return true;
    return false;
  }

  drawLayer(ctx, layer, cam, tint) {
    const tw = this.tw, th = this.th;
    const x0 = Math.max(0, Math.floor(cam.x / tw)), x1 = Math.min(this.cols - 1, Math.ceil((cam.x + cam.vw) / tw));
    const y0 = Math.max(0, Math.floor(cam.y / th)), y1 = Math.min(this.rows - 1, Math.ceil((cam.y + cam.vh) / th));
    if (tint) { ctx.save(); ctx.globalAlpha = tint; }
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const gid = this.gidAt(layer, tx, ty);
        if (!gid) continue;
        const t = this.tilesetFor(gid);
        const idx = gid - t.firstgid;
        const col = idx % t.columns, row = Math.floor(idx / t.columns);
        const sx = t.margin + col * (t.tileW + t.spacing);
        const sy = t.margin + row * (t.tileH + t.spacing);
        const img = this.tilesetImages[t.image];
        if (img) ctx.drawImage(img, sx, sy, t.tileW, t.tileH, tx * tw, ty * th, tw, th);
      }
    }
    if (tint) ctx.restore();
  }
}

/* Cocos2d-x .plist atlas (converted to JSON) */
class Atlas {
  constructor(json, img) {
    this.img = img;
    this.frames = json.frames;
  }
  f(name) { return this.frames[name] || null; }

  /* draw frame with fractional anchor (0,0 = top-left .. 1,1 = bottom-right of the
     FULL source box incl. trim padding), optional rotation around that anchor and
     horizontal flip (body-part art faces left; guns face right). */
  drawA(ctx, name, dx, dy, scale = 1, rot = 0, alpha = 1, ax = 0.5, ay = 0.5, flip = false) {
    const fr = this.frames[name];
    if (!fr) return;
    const bw = (fr.srcW || fr.w) * scale, bh = (fr.srcH || fr.h) * scale;
    /* trimmed piece position inside the full box (offY is cocos bottom-up) */
    const px = (fr.offX || 0) * scale, py = ((fr.srcH || fr.h) - fr.h - (fr.offY || 0)) * scale;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(dx, dy);
    if (rot) ctx.rotate(rot);
    if (flip) ctx.scale(-1, 1);
    const ox = -bw * ax + px, oy = -bh * ay + py;
    if (fr.rot) {
      ctx.rotate(-Math.PI / 2);
      const dw = fr.h * scale, dh = fr.w * scale;
      ctx.drawImage(this.img, fr.x, fr.y, fr.h, fr.w, ox + (bw - dw) / 2, oy + (bh - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(this.img, fr.x, fr.y, fr.w, fr.h, ox, oy, fr.w * scale, fr.h * scale);
    }
    ctx.restore();
  }

  /* legacy center-anchor draw, now trim-box centered */
  draw(ctx, name, dx, dy, scale = 1, rot = 0, alpha = 1) {
    this.drawA(ctx, name, dx, dy, scale, rot, alpha);
  }

  frameSize(name) {
    const fr = this.frames[name];
    return fr ? { w: fr.w, h: fr.h } : { w: 0, h: 0 };
  }
}
