// @ts-check
// When the studio runs the real paper engine (@pliego/engine at /engine/), and with which options.
// Pure functions so Node tests can cover them.
//
// The engine's defaults (mesh edge ≈ span/30, 20 substeps) are its accuracy settings. In the browser
// the studio wants interactive rates, which the engine reaches with a coarser mesh and 8 substeps.
// Its equilibria do not depend on the substep count (engine test E12-substeps). The studio sizes the
// mesh from the sheet area so that a typical object stays near STEP_VERTEX_BUDGET simulation
// vertices. A step that still costs more than SLOW_STEP_MS falls back to the preview, unless the
// viewer asked for physics.

/** Target simulation vertices for an interactive step (≈ 16 ms for a 150 mm square on a laptop). */
export const STEP_VERTEX_BUDGET = 450;
/** Steps slower than this (ms, averaged over the probe) are not interactive. */
export const SLOW_STEP_MS = 40;
/** Above this estimated simulation-vertex count the studio starts in the preview (papel picado's cut lace). */
export const VERTEX_LIMIT = 1500;
/** Mesh edge bounds (mm). Below 8 mm the cost explodes, and above 25 mm a sheet stops bending. */
export const MESH_EDGE_MIN = 8;
export const MESH_EDGE_MAX = 25;

/** Total sheet area in layout space (mm²): the sum of |face area| over every face. */
export function sheetArea(json) {
  const V = json && json.vertices_coords, F = json && json.faces_vertices;
  if (!Array.isArray(V) || !Array.isArray(F)) return 0;
  let total = 0;
  for (const f of F) {
    let s = 0;
    for (let k = 0; k < f.length; k++) {
      const p = V[f[k]], q = V[f[(k + 1) % f.length]];
      s += p[0] * q[1] - q[0] * p[1];
    }
    total += Math.abs(s) / 2;
  }
  return total;
}

/**
 * World options for interactive use. A triangle mesh with target edge h holds about one vertex per
 * 0.66·h² of sheet, which gives h = √(A / (0.66 · budget)), clamped to the bounds.
 * @param {any} json sheet document
 * @returns {{seed: number, meshEdge: number, substeps: number}}
 */
export function engineOptions(json) {
  const area = sheetArea(json);
  const h = Math.sqrt(area / (0.66 * STEP_VERTEX_BUDGET));
  const meshEdge = Math.min(MESH_EDGE_MAX, Math.max(MESH_EDGE_MIN, Number.isFinite(h) ? h : MESH_EDGE_MIN));
  return { seed: 1, meshEdge: Math.round(meshEdge * 10) / 10, substeps: 8 };
}

/**
 * Whether a measured step time is too slow to keep physics on by default.
 * @param {number} msPerStep
 */
export function tooSlow(msPerStep) {
  return Number.isFinite(msPerStep) && msPerStep > SLOW_STEP_MS;
}

/** Total length of boundary and cut edges (assignments B and C), in mm. */
export function boundaryLength(json) {
  const V = json && json.vertices_coords, E = json && json.edges_vertices, A = json && json.edges_assignment;
  if (!Array.isArray(V) || !Array.isArray(E) || !Array.isArray(A)) return 0;
  let len = 0;
  E.forEach(([a, b], e) => { if (A[e] === 'B' || A[e] === 'C') len += Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]); });
  return len;
}

/**
 * Simulation vertices the engine's mesher is expected to produce at a mesh edge. The document's own
 * vertices are kept, the interior fills at about 0.66·h² of sheet per vertex, and boundaries and
 * cuts are sampled every h.
 */
export function estimateVertices(json, meshEdge) {
  const h = meshEdge || MESH_EDGE_MIN;
  const docV = Array.isArray(json && json.vertices_coords) ? json.vertices_coords.length : 0;
  return Math.round(docV + sheetArea(json) / (0.66 * h * h) + boundaryLength(json) / h);
}

/** Whether a document is small enough to start in paper physics at the interactive options. */
export function physicsFits(json) {
  return estimateVertices(json, engineOptions(json).meshEdge) <= VERTEX_LIMIT;
}
