/* Pipeline map JSON (w,h,tileW,tileH,tilesets,layers,objects) -> Tiled JSON
   so Phaser's native tilemap pipeline renders both tile layers with culling,
   margins/spacing and gid flip flags handled by the engine. Object layers
   stay in the raw format (pickups/spawns/flags are read by shared GameMap). */
export function mapToTiled(json) {
  return {
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: json.w,
    height: json.h,
    tilewidth: json.tileW,
    tileheight: json.tileH,
    infinite: false,
    nextlayerid: json.layers.length + 1,
    nextobjectid: 1,
    type: "map",
    tilesets: json.tilesets.map((t, i) => ({
      firstgid: t.firstgid,
      name: t.image.replace(/\.png$/, ""),
      image: "../img/" + t.image,   /* relative path (unused — texture passed by key) */
      imagewidth: t.imageW,
      imageheight: t.imageH,
      tilewidth: t.tileW,
      tileheight: t.tileH,
      margin: t.margin,
      spacing: t.spacing,
      columns: t.columns,
      tilecount: t.columns * Math.floor(t.imageH / (t.tileH + t.spacing)),
      objectalignment: "bottom-left",
    })),
    layers: json.layers.map((l, i) => ({
      data: l.data,
      height: l.h,
      width: l.w,
      id: i + 1,
      name: l.name,
      opacity: 1,
      type: "tilelayer",
      visible: true,
      x: 0,
      y: 0,
    })),
  };
}
