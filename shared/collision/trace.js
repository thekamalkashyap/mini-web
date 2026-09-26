/* Boundary tracing — converts the solid/air grid into closed boundary loops.
   For every solid cell side facing air, one directed unit edge is emitted;
   edges are then stitched into loops by matching endpoints. Every edge is
   directed with SOLID ON THE RIGHT of travel:

     top side:    (c,r)     -> (c+1,r)     (solid below)
     right side:  (c+1,r)   -> (c+1,r+1)   (solid left)
     bottom side: (c+1,r+1) -> (c,r+1)     (solid above)
     left side:   (c,r+1)   -> (c,r)       (solid right)

   Out-of-bounds counts as air, so solids touching the grid edge are traced.
   At saddle vertices (diagonally-touching solids) the stitcher prefers the
   sharpest right turn, keeping each island's loop separate. Output loops are
   world-px vertices, implicitly closed (last connects back to first). */
export function traceBoundaryLoops(mask, cols, rows, step) {
  const solidAt = (r, c) =>
    r >= 0 && r < rows && c >= 0 && c < cols ? mask[r * cols + c] === 1 : false;
  const W = cols + 1; // grid points per row
  const key = (c, r) => r * W + c;

  const edges = []; // [fromKey, toKey]
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solidAt(r, c)) continue;
      if (!solidAt(r - 1, c)) edges.push([key(c, r), key(c + 1, r)]);
      if (!solidAt(r, c + 1)) edges.push([key(c + 1, r), key(c + 1, r + 1)]);
      if (!solidAt(r + 1, c)) edges.push([key(c + 1, r + 1), key(c, r + 1)]);
      if (!solidAt(r, c - 1)) edges.push([key(c, r + 1), key(c, r)]);
    }
  }

  const outgoing = new Map(); // fromKey -> edge indices
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i][0];
    let list = outgoing.get(a);
    if (!list) {
      list = [];
      outgoing.set(a, list);
    }
    list.push(i);
  }

  const used = new Uint8Array(edges.length);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const start = edges[i][0];
    const loop = [];
    let cur = i;
    let guard = 0;
    for (;;) {
      /* in-degree == out-degree at every vertex, so walks always close;
         the guard is dead defense against corrupted grids */
      if (++guard > edges.length + 4) break;
      used[cur] = 1;
      const [a, b] = edges[cur];
      loop.push(a);
      if (b === start) break;
      const cands = (outgoing.get(b) || []).filter((e) => !used[e]);
      if (!cands.length) break;
      cur = pickNext(a, b, cands, edges, W);
    }
    if (loop.length >= 3) {
      loops.push(
        loop.map((k) => [(k % W) * step, (((k / W) | 0) * step)]),
      );
    }
  }
  return loops;
}

/* Among unused outgoing edges, prefer the sharpest right turn (right >
   straight > left > reverse). Keeps loops tight around their solid island
   at saddle vertices; deterministic by emission order on ties. */
function pickNext(a, b, cands, edges, W) {
  const ax = a % W,
    ay = (a / W) | 0,
    bx = b % W,
    by = (b / W) | 0;
  const ix = Math.sign(bx - ax),
    iy = Math.sign(by - ay);
  let best = cands[0],
    bestScore = -2;
  for (const e of cands) {
    const d = edges[e][1];
    const ox = Math.sign((d % W) - bx),
      oy = Math.sign(((d / W) | 0) - by);
    const cross = ix * oy - iy * ox; // y-down: + = right turn
    const dot = ix * ox + iy * oy;
    const score = cross > 0 ? 2 : dot > 0 ? 1 : cross < 0 ? 0 : -1;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}
