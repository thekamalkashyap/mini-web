/* Hud — React overlay: health/fuel/ammo, kill strip, death screen, colliders
   legend. State flows from WorldScene via the zustand store at ~10 Hz. */
import React from "react";
import { useStore } from "../store.js";
import { partyInviteUrl } from "../partyLink.js";
import { FONT } from "./styles.js";
import HealthBars from "./hud/HealthBars.jsx";
import WeaponPanel from "./hud/WeaponPanel.jsx";
import TopStrip from "./hud/TopStrip.jsx";
import {
  PickupPrompt,
  ColliderLegend,
  Toast,
  DeathScreen,
  HelpLine,
} from "./hud/Overlays.jsx";

export default function Hud() {
  const hud = useStore((s) => s.hud);
  const toastMsg = useStore((s) => s.toastMsg);
  const exitGame = useStore((s) => s.actions.exitGame);
  const toast = useStore((s) => s.actions.toast);
  if (!hud) return null;
  const copyInvite = () => {
    if (!hud.roomId) return;
    const url = partyInviteUrl(hud.roomId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast("invite link copied"),
        () => prompt("copy your invite link:", url),
      );
    } else {
      prompt("copy your invite link:", url);
    }
  };
  const {
    hp,
    fuel,
    emp,
    ammo,
    mag,
    reloading,
    weaponName,
    nades,
    kills,
    dead,
    deadT,
    mapLabel,
    mode,
    players,
    showColliders,
    muted,
    connected,
    pickupName,
    roomId,
  } = hud;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        fontFamily: FONT,
        userSelect: "none",
      }}
    >
      <HealthBars hp={hp} fuel={fuel} emp={emp} />
      <WeaponPanel
        weaponName={weaponName}
        ammo={ammo}
        mag={mag}
        reloading={reloading}
        nades={nades}
      />
      <TopStrip
        kills={kills}
        mapLabel={mapLabel}
        mode={mode}
        players={players}
        connected={connected}
        roomId={roomId}
        onCopyInvite={copyInvite}
      />
      <HelpLine muted={muted} />
      <PickupPrompt pickupName={pickupName} dead={dead} />
      <ColliderLegend show={showColliders} />
      <Toast msg={toastMsg} />
      <DeathScreen dead={dead} deadT={deadT} onExit={exitGame} />
    </div>
  );
}
