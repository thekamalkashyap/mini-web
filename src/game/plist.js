/* Cocos2d plist atlas (pipeline-converted JSON) -> Phaser atlas JSON.
   Deterministic data conversion, no re-invention of rendering:
     frame       {x,y,w,h}      -> frame
     rot                        -> rotated (90deg CW in-sheet, same convention)
     offX/offY (cocos bottom-up) -> spriteSourceSize {x: offX, y: srcH-h-offY}
     srcW/srcH                  -> sourceSize
   With these fields Phaser's setOrigin() reproduces Atlas.drawA's anchored,
   trim-aware blit, and flipX reproduces the scale(-1,1) mirror. */
export function plistToPhaserAtlas(plistJson) {
  const frames = {};
  for (const [name, fr] of Object.entries(plistJson.frames)) {
    const w = fr.w, h = fr.h, srcW = fr.srcW || w, srcH = fr.srcH || h;
    frames[name] = {
      frame: { x: fr.x, y: fr.y, w, h },
      rotated: !!fr.rot,
      trimmed: srcW !== w || srcH !== h || !!(fr.offX || fr.offY),
      spriteSourceSize: { x: fr.offX || 0, y: srcH - h - (fr.offY || 0), w, h },
      sourceSize: { w: srcW, h: srcH },
    };
  }
  return { frames };
}
