// @ts-check
// Paper edges from the render mesh topology, computed once per topology (never per frame): the
// outline of every sheet (its boundary and the lips of open cuts), drawn as a thin darkened line so
// a white sheet on a pale table still reads as paper with an edge. Render vertices are split along
// fold hinges (sharp shading at creases), so two render vertices are the same point of the sheet
// when they share the sheet and its flat-layout UV; an edge used by one triangle after that welding
// is an edge of the paper.

/** UV quantisation for welding (UVs span the sheet's bounding box, 0…1). */
const Q = 1 << 20;

/**
 * @param {ArrayLike<number>} uvs 2 per render vertex
 * @param {ArrayLike<number>} sheetIds 1 per render vertex
 * @param {ArrayLike<number>} indices 3 per triangle
 * @returns {Uint32Array} render-vertex pairs, one per boundary edge
 */
export function outlineEdges(uvs, sheetIds, indices) {
  const nv = sheetIds.length;
  const weld = new Int32Array(nv);
  /** @type {Map<string, number>} */
  const ids = new Map();
  for (let i = 0; i < nv; i++) {
    const key = `${sheetIds[i]}:${Math.round(uvs[2 * i] * Q)}:${Math.round(uvs[2 * i + 1] * Q)}`;
    let w = ids.get(key);
    if (w === undefined) { w = ids.size; ids.set(key, w); }
    weld[i] = w;
  }
  const n = ids.size;
  /** @type {Map<number, number>} edge key → count (positive) and the first triangle edge seen */
  const count = new Map();
  /** @type {Map<number, number>} */
  const first = new Map();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const wa = weld[a], wb = weld[b];
      if (wa === wb) continue;   // a degenerate sliver edge
      const key = wa < wb ? wa * n + wb : wb * n + wa;
      const c = count.get(key);
      if (c === undefined) { count.set(key, 1); first.set(key, t + k); } else count.set(key, c + 1);
    }
  }
  const out = [];
  for (const [key, c] of count) {
    if (c !== 1) continue;
    const at = /** @type {number} */ (first.get(key)), t = at - (at % 3), k = at % 3;
    out.push(indices[t + k], indices[t + ((k + 1) % 3)]);
  }
  return Uint32Array.from(out);
}
