/* App — screen router: lobby -> (loading) -> Phaser game + HUD overlay.
   Deep links (?solo=... with demo/flashhold/colliders/bots/zoom) skip the
   lobby, preserving the legacy debugging workflow. */
import React, { useEffect, useRef, useState } from "react";
import { useStore } from "./store.js";
import Lobby from "./ui/Lobby.jsx";
import Hud from "./ui/Hud.jsx";
import { createGame } from "./game/boot.js";
import { parseSoloSearch } from "./soloLink.js";

function GameMount({ opts }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const game = createGame(containerRef.current, opts);
    const onReady = () => setReady(true);
    game.events.once("ready", onReady);
    const onResize = () => game.scale.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      game.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={containerRef} id="game-container" style={{ position: "fixed", inset: 0 }} />
      {ready && <Hud />}
    </>
  );
}

export default function App() {
  const screen = useStore(s => s.screen);
  const gameOpts = useStore(s => s.gameOpts);
  const startGame = useStore(s => s.actions.startGame);

  /* deep links: ?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=N] */
  useEffect(() => {
    const deep = parseSoloSearch(location.search);
    if (deep) startGame(deep);
  }, [startGame]);

  if (screen === "game" || screen === "loading") return <GameMount key={gameOpts && gameOpts.startKey || 0} opts={gameOpts} />;
  return <Lobby />;
}
