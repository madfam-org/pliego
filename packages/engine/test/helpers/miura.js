// @ts-check
/** Miura-ori helpers for E6: rigid fold angles, measured facet angle and in-plane dimensions. */
import { FaceTree } from '../../src/kinematics/facetree.js';

/**
 * Fold angle per document edge for zig-zag parameter Z (rad): rows alternate ±Z, straight creases
 * (−1)^(i+j+1)·v with tan(v/2) = cos γ·tan(Z/2) (degree-4 mode 1 at every vertex).
 * @param {any} doc @param {{zig:number[][], straight:number[][]}} m @param {number} gammaRad @param {number} Z
 */
export function miuraAngles(doc, m, gammaRad, Z) {
  const rho = new Float64Array(doc.nE);
  const v = 2 * Math.atan(Math.cos(gammaRad) * Math.tan(Z / 2));
  m.zig.forEach((row, jj) => { const j = jj + 1; for (const e of row) rho[e] = (j % 2 ? -1 : 1) * Z; });
  m.straight.forEach((col, ii) => { const i = ii + 1; col.forEach((e, j) => { rho[e] = ((i + j + 1) % 2 ? -1 : 1) * v; }); });
  return rho;
}

/**
 * Facet angle to the base plane and the extents along u (zig-zag rows) and v (straight creases),
 * from vertex positions X (3 per document vertex).
 * @param {any} doc @param {number[][]} grid @param {Float64Array} X
 */
export function miuraMeasure(doc, grid, X) {
  const nx = grid.length - 1, ny = grid[0].length - 1;
  const P = (/** @type {number} */ v) => [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
  const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const ju = Math.floor(ny / 2), iv = 2 * Math.floor(nx / 4);
  const Lu = sub(P(grid[nx][ju]), P(grid[0][ju])), Sv = sub(P(grid[iv][ny]), P(grid[iv][0]));
  const n = [Lu[1] * Sv[2] - Lu[2] * Sv[1], Lu[2] * Sv[0] - Lu[0] * Sv[2], Lu[0] * Sv[1] - Lu[1] * Sv[0]];
  const nn = Math.hypot(...n);
  // facet (0,0): normal from two of its edges
  const f0 = sub(P(grid[1][0]), P(grid[0][0])), f1 = sub(P(grid[0][1]), P(grid[0][0]));
  const nf = [f0[1] * f1[2] - f0[2] * f1[1], f0[2] * f1[0] - f0[0] * f1[2], f0[0] * f1[1] - f0[1] * f1[0]];
  const c = Math.abs(nf[0] * n[0] + nf[1] * n[1] + nf[2] * n[2]) / (Math.hypot(...nf) * nn);
  return { theta: Math.acos(Math.min(1, c)), Lu: Math.hypot(...Lu), Sv: Math.hypot(...Sv) };
}

/** Rigid Miura pose for parameter Z. @param {any} doc @param {any} m @param {number} g @param {number} Z */
export function miuraPose(doc, m, g, Z) {
  return new FaceTree(doc, 0).pose(miuraAngles(doc, m, g, Z));
}
