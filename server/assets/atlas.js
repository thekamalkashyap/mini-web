/* Atlas frame sizes — the menuTexture metrics the sim needs for
   muzzle/shoulder geometry, as a (frameName) -> {w,h} lookup. */
export function frameSizes(menuAtlas) {
  const sizes = {};
  for (const [name, fr] of Object.entries(menuAtlas.frames))
    sizes[name] = { w: fr.w, h: fr.h };
  return sizes;
}

export function frameSizeLookup(menuAtlas) {
  const sizes = frameSizes(menuAtlas);
  return (n) => sizes[n] || { w: 0, h: 0 };
}
