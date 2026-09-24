/* Phaser game factory — one game instance mounted into the React container. */
import Phaser from "phaser";
import { BootScene } from "./BootScene.js";
import { WorldScene } from "./WorldScene.js";

export function createGame(parent, opts) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0d1420",
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { pixelArt: false, antialias: true, roundPixels: false },
    scene: [BootScene, WorldScene],
  });
  /* config-array scenes auto-start with NO data — hand opts over via registry
     (set synchronously before the async scene boot runs init) */
  game.registry.set("bootOpts", opts);
  if (typeof window !== "undefined") window.__game = game;   /* debug handle */
  return game;
}

export const GAME_OPTS_KEY = "mm:game:opts";
