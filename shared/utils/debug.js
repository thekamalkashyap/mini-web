/* Tripwire guard for hot loops — a runaway walk must kill the process loudly,
   never hang the room (see AGENT.md golden rule #1). */
export const TRIP = (name, i, limit = 200000, ctxd) => {
  if (i > limit) {
    console.error("TRIPWIRE:", name, i, JSON.stringify(ctxd));
    if (typeof process !== "undefined" && process.exit) process.exit(99);
    else throw new Error("TRIPWIRE: " + name);
  }
};
