/* WorldBuilder — static render layers: parallax background, tilemap layers,
   TMX decor objects + flag stations. Reads scene.map (GameMap), the loaded
   textures and tweens; attaches scene.bg / scene.layerBg / scene.layerSolid. */
export function buildBackground(scene) {
  const name = scene.map.tilesets[0].image.replace("tile64", "bg");

  const key = scene.textures.exists("bg:" + name)
    ? "bg:" + name
    : "bg:bg_new.png";

  const img = scene.textures.get(key).getSourceImage();

  const vw = scene.scale.width;
  const vh = scene.scale.height;

  // Scale image so it completely covers the viewport
  const scale = Math.max(vw / img.width, vh / img.height);

  scene.bg = scene.add
    .tileSprite(0, 0, vw, vh, key)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(-10);

  scene.bg.setTileScale(scale, scale);
}

export function buildTilemap(scene) {
  const tiled = scene.make.tilemap({ key: "map" });
  const tsDef = scene.map.tilesets[0];
  const tileset = tiled.addTilesetImage(
    tsDef.image.replace(/\.png$/, ""),
    "ts:" + tsDef.image,
  );
  scene.layerBg = tiled
    .createLayer("tilebg", tileset)
    .setDepth(-5)
    .setAlpha(0.9);
  scene.layerSolid = tiled.createLayer("tile", tileset).setDepth(0);
}

export function buildObjects(scene) {
  /* background/foreground sprite objects + flag stations from TMX objects */
  for (const ob of scene.map.objects) {
    /* Tiled disambiguates repeat names (spritefg_2, …) — match by prefix so
       every bush/tree renders. Center-anchored at the flipped point: the
       author sights the whole sprite against the art (verified in-situ). */
    if (ob.name.startsWith("spritebg"))
      scene.add
        .image(ob.x, ob.y, "menu", (ob.props.sprite || "") + ".png")
        .setDepth(-4)
        .setAlpha(0.9);
    else if (ob.name.startsWith("spritefg"))
      scene.add
        .image(ob.x, ob.y, "menu", (ob.props.sprite || "") + ".png")
        .setDepth(8)
        .setAlpha(0.95);
    else if (ob.name.startsWith("fp_b")) {
      const sp = ob.props.sprite || "flagStationBlue";
      scene.add
        .image(ob.x, ob.y + 30, "menu", sp + ".png")
        .setDepth(-3)
        .setScale(0.8);
      /* flag art is authored horizontal (pole+diamond); stand it upright so
         the pole plants into the station with the ball finial on top */
      const flag = scene.add
        .image(
          ob.x,
          ob.y - 40,
          "menu",
          sp.includes("Orange") ? "flagOrange.png" : "flagBlue.png",
        )
        .setDepth(-3)
        .setScale(0.55)
        .setRotation(-Math.PI / 2 - 0.08);
      scene.tweens.add({
        targets: flag,
        x: "+=4",
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      scene.tweens.add({
        targets: flag,
        rotation: -Math.PI / 2 + 0.08,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }
}

export function buildWorld(scene) {
  buildBackground(scene);
  buildTilemap(scene);
  buildObjects(scene);
}
