/* Zustand store — the bridge between the Phaser world and the React HUD. */
import { create } from "zustand";

export const useStore = create((set, get) => ({
  screen: "lobby",          /* lobby | loading | game */
  gameOpts: null,           /* options passed to the Phaser boot */
  connStatus: "",
  hud: null,                /* filled by WorldScene at 10 Hz */
  toastMsg: "",

  actions: {
    startGame: opts => set({ screen: "loading", gameOpts: opts, connStatus: "" }),
    gameReady: () => set({ screen: "game" }),
    exitGame: () => set({ screen: "lobby", gameOpts: null, hud: null, connStatus: "" }),
    setConn: s => set({ connStatus: s }),
    setHud: hud => set({ hud }),
    toast: msg => { set({ toastMsg: msg }); clearTimeout(get()._toastT); set({ _toastT: setTimeout(() => set({ toastMsg: "" }), 2600) }); },
  },
}));
