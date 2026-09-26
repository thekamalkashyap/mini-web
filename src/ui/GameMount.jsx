/* GameMount — owns the Phaser game instance lifecycle inside React:
   create on mount, resize with the window, destroy on unmount. */
import React, { useEffect, useRef, useState } from "react";
import Hud from "./Hud.jsx";
import { createGame } from "../game/boot.js";

export default function GameMount({ opts }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const game = createGame(containerRef.current, opts);
    const onReady = () => setReady(true);
    game.events.once("ready", onReady);
    const onResize = () =>
      game.scale.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      game.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        id="game-container"
        style={{ position: "fixed", inset: 0 }}
      />
      {ready && <Hud />}
    </>
  );
}
