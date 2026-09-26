/* Boot asset manifest — every load queued before the world starts:
   atlas PNGs, tileset + background themes, fx sprites, map JSON, atlas
   JSON, and the carved wav bank. */
import { SND_NAMES } from "../Sfx.js";

export const TILESETS = [
  "tile64_new.png",
  "tile64Desert_new.png",
  "tile64Moon_new.png",
  "tile64Snow_new.png",
];

export const BACKGROUNDS = [
  "bg_new.png",
  "bgDesert_new.png",
  "bgMoon_new.png",
  "bgSnow_new.png",
];

export const FX_IMAGES = {
  "fx:bullet": "img/bullet_new.png",
  "fx:blood": "img/blood_new.png",
  "fx:smoke": "img/smoke_new.png",
  "fx:spark": "img/spark_new.png",
};

export function queueBootAssets(scene, map) {
  scene.load.image("menuPNG", "img/menuTexture.png");
  scene.load.image("partsPNG", "img/partsTexture.png");
  for (const ts of TILESETS) scene.load.image("ts:" + ts, "img/" + ts);
  for (const bg of BACKGROUNDS) scene.load.image("bg:" + bg, "img/" + bg);
  for (const [key, file] of Object.entries(FX_IMAGES))
    scene.load.image(key, file);
  scene.load.text("mapJson:" + map, `data/maps/${map}.json`);
  scene.load.json("plist:menu", "data/atlas/menuTexture.json");
  scene.load.json("plist:parts", "data/atlas/partsTexture.json");
  for (const n of SND_NAMES) scene.load.audio(n.replace(/\.wav$/, ""), "audio/" + n);
}
