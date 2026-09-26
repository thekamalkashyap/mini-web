/* Invite-link parser for ?room=<id>. Pure (no React/Phaser/DOM at import
   time) so the headless node suite covers the exact URL shape. Returns the
   room id string, or null when the URL carries no invite. Unknown ids are
   NOT rejected here — the server answers not-found and the lobby shows
   "room expired". */
export function parsePartySearch(search) {
  const id = new URLSearchParams(search).get("room");
  const clean = (id || "").trim();
  return clean ? clean : null;
}

export function partyInviteUrl(roomId) {
  return `${location.origin}${location.pathname}?room=${roomId}`;
}
