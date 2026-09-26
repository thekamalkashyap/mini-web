/* App — screen router: lobby -> (loading) -> Phaser game + HUD overlay.
   Deep links (?solo=... with demo/flashhold/colliders/bots/zoom) skip the
   lobby, preserving the legacy debugging workflow. */
import React, { useEffect } from "react";
import { useStore } from "./store.js";
import Lobby from "./ui/Lobby.jsx";
import GameMount from "./ui/GameMount.jsx";
import { parseSoloSearch } from "./soloLink.js";

export default function App() {
  const screen = useStore((s) => s.screen);
  const gameOpts = useStore((s) => s.gameOpts);
  const startGame = useStore((s) => s.actions.startGame);

  /* deep links: ?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=N] */
  useEffect(() => {
    const deep = parseSoloSearch(location.search);
    if (deep) startGame(deep);
  }, [startGame]);

  if (screen === "game" || screen === "loading")
    return (
      <GameMount key={(gameOpts && gameOpts.startKey) || 0} opts={gameOpts} />
    );
  return <Lobby />;
}
