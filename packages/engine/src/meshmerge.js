// @ts-check
/**
 * Meshing regions of a sheet document (engine.md §2, step 1).
 *
 * The mesher used to triangulate every document face on its own, so every document edge was a
 * constrained mesh edge, split into segments of at most h. Edges that are plain paper — `F`, `U`
 * or `J` with treatment `none`, or a `halfcut` kiss cut (spec §4: "plain paper") — carry no
 * physics of their own: they are panel hinges like any other line inside a panel. Constraining the
 * mesh to them is what made sliver triangles: a cone drawn as narrow `F` facets (party hat), a
 * kusudama unit's construction lines, the `J` bridges of a papercut and a kiss-cut sticker outline
 * all forced split points a fraction of h apart, and a triangle between two of them is a sliver
 * that a fold program stretches by tens or hundreds of percent.
 *
 * `meshRegions` unions faces across such edges into larger simple polygons, which the mesher then
 * triangulates as one piece. Creases, scores, perforations, cuts and the outline stay exact mesh
 * edges (they are never merged across). An edge is merged only when
 *   - it is interior to one sheet (two faces) and plain paper (above);
 *   - no fold program step targets or releases it, and no join or mechanism point or segment lies
 *     on it (a pin along a clamp line, a glue region's border, a pivot at its end: those need the
 *     line's mesh vertices);
 *   - it has no set rest angle (spec §5.14) and is flat in the document's `initial` frame within MERGE_BEND_DEG (a triangle spanning a bent
 *     line starts with its chord shortened by about θ²/8: 0.4 % at 10°, inside the 0.45 % guard);
 *   - the document has no kinematic fold program: that program poses every mesh vertex with its own
 *     face's rigid transform, and between steps two faces across a `J` line need not share one (a
 *     triangle spanning the line was measured stretching 216 % mid-program);
 *   - the union stays one simple polygon (each document vertex at most once on its boundary).
 * Document vertices left inside a region (every incident edge merged) are kept as fixed interior
 * points when they are at least a quarter of h from everything else, so `docVertex` stays exact.
 * Deterministic: edges in index order, union by smallest face id.
 */

/** Largest initial-frame bend (degrees) across a plain-paper line that is still merged. */
export const MERGE_BEND_DEG = 10;

/**
 * @typedef {object} Region
 * @property {number[]} faces document faces in the region, ascending
 * @property {number[]} loopV boundary: document vertex i (CCW)
 * @property {number[]} loopE boundary: document edge from loopV[i] to loopV[i+1]
 * @property {number[]} loopF boundary: the face of the region that owns edge loopE[i]
 * @property {number[]} inner document vertices strictly inside the region
 */

/**
 * @param {any} doc loaded document
 * @param {(e: number) => boolean} isCut
 * @returns {{regions: Region[], merged: Uint8Array}} merged[e] = 1 for edges inside a region
 */
export function meshRegions(doc, isCut) {
  const { nE, faces, faceEdges, edgeFaces, assignment, treatment } = doc;
  const nF = faces.length;
  const merged = new Uint8Array(nE);
  const stepEdges = new Set();
  for (const st of doc.sequence?.steps ?? []) {
    for (const t of st.targets ?? []) stepEdges.add(t[0]);
    for (const e of st.release ?? []) stepEdges.add(e);
  }
  const kinematic = doc.sequence?.mode === 'kinematic';
  const touched = joinTouched(doc);
  const normals = doc.initial ? faceNormals(doc) : null;
  const cosBend = Math.cos((MERGE_BEND_DEG * Math.PI) / 180);
  const plain = (/** @type {number} */ e) => {
    const f0 = edgeFaces[2 * e], f1 = edgeFaces[2 * e + 1];
    if (f0 < 0 || f1 < 0 || f0 === f1 || isCut(e) || stepEdges.has(e) || touched[e] || doc.restAngle[e] !== 0) return false;
    if (doc.fSheet[f0] !== doc.fSheet[f1]) return false;
    const a = assignment[e], t = treatment[e];
    if (!((t === 'none' && (a === 'F' || a === 'U' || a === 'J')) || (t === 'halfcut' && a === 'F'))) return false;
    if (kinematic) return false;
    if (normals) {
      const c = normals[3 * f0] * normals[3 * f1] + normals[3 * f0 + 1] * normals[3 * f1 + 1] + normals[3 * f0 + 2] * normals[3 * f1 + 2];
      if (!(c >= cosBend)) return false;
    }
    return true;
  };
  // boundary half-edges of each group: [from, to, edge, face]; a group starts as its face
  const parent = new Int32Array(nF);
  /** @type {number[][][]} */
  const bnd = [];
  for (let f = 0; f < nF; f++) {
    parent[f] = f;
    const fv = faces[f], hs = [];
    for (let i = 0; i < fv.length; i++) hs.push([fv[i], fv[(i + 1) % fv.length], faceEdges[f][i], f]);
    bnd.push(hs);
  }
  const find = (/** @type {number} */ f) => { while (parent[f] !== f) { parent[f] = parent[parent[f]]; f = parent[f]; } return f; };
  for (let e = 0; e < nE; e++) {
    if (!plain(e)) continue;
    const ra = find(edgeFaces[2 * e]), rb = find(edgeFaces[2 * e + 1]);
    if (ra === rb) continue;
    // every edge the two groups share goes inside when it is plain paper; a shared crease would
    // leave a slit (a vertex twice on the boundary) and the merge is refused below
    const inA = new Set(bnd[ra].map((h) => h[2]));
    const shared = new Set(bnd[rb].filter((h) => inA.has(h[2]) && plain(h[2])).map((h) => h[2]));
    const cand = bnd[ra].concat(bnd[rb]).filter((h) => !shared.has(h[2]));
    if (!simpleLoop(cand, doc.coords)) continue;
    const r = Math.min(ra, rb), o = Math.max(ra, rb);
    parent[o] = r;
    bnd[r] = cand; bnd[o] = [];
  }
  /** @type {Region[]} */
  const regions = [];
  const onLoop = new Uint8Array(doc.nV);
  for (let f = 0; f < nF; f++) {
    if (find(f) !== f) continue;
    const hs = bnd[f];
    const next = new Map(hs.map((h) => [h[0], h]));
    const loopV = [], loopE = [], loopF = [];
    // start at the face's own first vertex when it is on the boundary (keeps single faces unchanged)
    let start = faces[f][0];
    if (!next.has(start)) start = hs[0][0];
    let v = start;
    do {
      const h = /** @type {number[]} */ (next.get(v));
      loopV.push(h[0]); loopE.push(h[2]); loopF.push(h[3]); onLoop[h[0]] = 1;
      v = h[1];
    } while (v !== start);
    regions.push({ faces: [], loopV, loopE, loopF, inner: [] });
  }
  const regionOf = new Int32Array(nF);
  let k = 0;
  for (let f = 0; f < nF; f++) if (find(f) === f) regionOf[f] = k++;
  for (let f = 0; f < nF; f++) regions[regionOf[find(f)]].faces.push(f);
  // merged: both faces in one region and not on its boundary
  const onLoopE = new Uint8Array(nE);
  for (const R of regions) for (const e of R.loopE) onLoopE[e] = 1;
  for (let e = 0; e < nE; e++) {
    const f0 = edgeFaces[2 * e], f1 = edgeFaces[2 * e + 1];
    merged[e] = f0 >= 0 && f1 >= 0 && !onLoopE[e] && find(f0) === find(f1) ? 1 : 0;
  }
  const seen = new Uint8Array(doc.nV);
  for (const R of regions) {
    if (R.faces.length < 2) continue;
    for (const f of R.faces) for (const v of faces[f]) {
      if (onLoop[v] || seen[v]) continue;
      seen[v] = 1;
      R.inner.push(v);
    }
    R.inner.sort((a, b) => a - b);
  }
  return { regions, merged };
}

/**
 * Is the half-edge set one simple closed loop (every vertex starts exactly one half-edge and ends
 * exactly one, walking from the first reaches all of them, and no two of its vertices share
 * coordinates — the two sides of a split cut would leave a zero-width slit)?
 * @param {number[][]} hs @param {Float64Array|number[]} coords
 */
function simpleLoop(hs, coords) {
  if (hs.length < 3) return false;
  const at = new Set();
  for (const h of hs) {
    const key = `${coords[2 * h[0]]},${coords[2 * h[0] + 1]}`;
    if (at.has(key)) return false;
    at.add(key);
  }
  /** @type {Map<number, number>} */
  const next = new Map();
  /** @type {Set<number>} */
  const ends = new Set();
  for (const h of hs) {
    if (next.has(h[0]) || ends.has(h[1])) return false;
    next.set(h[0], h[1]); ends.add(h[1]);
  }
  const start = hs[0][0];
  let v = start, n = 0;
  do { const w = next.get(v); if (w === undefined) return false; v = w; n++; } while (v !== start && n <= hs.length);
  return v === start && n === hs.length;
}

/** Unit normals of every face in the `initial` frame (Newell). @param {any} doc */
function faceNormals(doc) {
  const X = /** @type {Float64Array} */ (doc.initial);
  const N = new Float64Array(3 * doc.faces.length);
  doc.faces.forEach((/** @type {number[]} */ fv, /** @type {number} */ f) => {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < fv.length; i++) {
      const a = 3 * fv[i], b = 3 * fv[(i + 1) % fv.length];
      nx += (X[a + 1] - X[b + 1]) * (X[a + 2] + X[b + 2]);
      ny += (X[a + 2] - X[b + 2]) * (X[a] + X[b]);
      nz += (X[a] - X[b]) * (X[a + 1] + X[b + 1]);
    }
    const L = Math.hypot(nx, ny, nz) || 1;
    N[3 * f] = nx / L; N[3 * f + 1] = ny / L; N[3 * f + 2] = nz / L;
  });
  return N;
}

/**
 * Split points closer than a quarter of h to a boundary point of another document edge on the
 * same region (a document vertex, or another edge's split point) are dropped: the line keeps its
 * exact geometry (its remaining points are still on it, its segments up to 2h long) and the mesh
 * loses the short edge and the sliver between the two points. Edges are visited in region and loop
 * order and each point is tested against the points still there, so of two close split points the
 * first one visited goes. Split cuts with a twin (spec §5.13) keep every point (their contact
 * groups pair the two sides by index); the two sides of an unsplit cut or a perforation drop
 * the same points. Returns the number of points dropped.
 * @param {any} doc @param {Region[]} regions @param {number[][][]} split per edge, per side: mesh vertices
 * @param {number[]} U sheet-local coordinates of mesh vertices @param {Map<number, number>[]} sectorVertex
 * @param {number} h @param {(e: number) => boolean} isCut
 */
export function pruneSplits(doc, regions, split, U, sectorVertex, h, isCut) {
  const lim = 0.25 * h, lim2 = lim * lim;
  const twin = /** @type {Int32Array|undefined} */ (doc.edgeTwin);
  let dropped = 0;
  for (const R of regions) {
    /** @type {{e:number, side:number}[]} */
    const lines = [];
    for (let i = 0; i < R.loopE.length; i++) {
      const e = R.loopE[i], fe = R.loopF[i];
      lines.push({ e, side: isCut(e) && doc.edgeFaces[2 * e + 1] === fe ? 1 : 0 });
    }
    const corners = R.loopV.map((v, i) => /** @type {number} */ (sectorVertex[v].get(R.loopF[i])));
    for (let i = 0; i < lines.length; i++) {
      const { e, side } = lines[i];
      const pts = split[e][side];
      if (!pts.length || (twin && twin[e] >= 0)) continue;
      for (let q = 0; q < pts.length; q++) {
        const px = U[2 * pts[q]], py = U[2 * pts[q] + 1];
        const near = (/** @type {number} */ m) => { const dx = U[2 * m] - px, dy = U[2 * m + 1] - py; return dx * dx + dy * dy < lim2; };
        let close = false;
        for (let j = 0; j < corners.length && !close; j++) {
          // the edge's own end points are at least h/2 away (uniform split); skip them anyway
          if (j === i || j === (i + 1) % corners.length) continue;
          close = near(corners[j]);
        }
        for (let j = 0; j < lines.length && !close; j++) {
          if (j === i) continue;
          const other = split[lines[j].e][lines[j].side];
          for (let k = 0; k < other.length && !close; k++) close = near(other[k]);
        }
        if (!close) continue;
        for (const list of split[e]) list.splice(q, 1);
        q--;
        dropped++;
      }
    }
  }
  return dropped;
}

/**
 * Edges that a join or mechanism names geometrically: a point of it (pivot, string, pin, slider,
 * rotate centre) on the edge, or a segment of it (pin `along`, glue region border, slider track,
 * leaf spine) running along the edge. Such edges are never merged.
 * @param {any} doc @returns {Uint8Array}
 */
function joinTouched(doc) {
  /** @type {[number, number[], number[]][]} sheet, p, q (a point is p = q) */
  const segs = [];
  const si = (/** @type {string} */ id) => doc.sheetIndex.get(id);
  const add = (/** @type {any} */ sheet, /** @type {any} */ p, /** @type {any} */ q) => {
    const s = si(sheet);
    if (s === undefined || !Array.isArray(p) || !Array.isArray(q)) return;
    segs.push([s, p, q]);
  };
  for (const j of doc.joins ?? []) {
    for (const side of [j.a, j.b]) {
      if (!side || typeof side !== 'object') continue;
      if (side.at) add(side.sheet, side.at, side.at);
      if (side.along) add(side.sheet, side.along[0], side.along[1]);
      if (Array.isArray(side.region)) side.region.forEach((/** @type {number[]} */ p, /** @type {number} */ i) => add(side.sheet, p, side.region[(i + 1) % side.region.length]));
    }
    if (j.track) add(j.track.sheet, j.track.from, j.track.to);
  }
  for (const m of doc.mechanisms ?? []) {
    if (m.center && m.center.at) add(m.center.sheet, m.center.at, m.center.at);
    if (m.spine) add(m.sheet, m.spine[0], m.spine[1]);
  }
  const out = new Uint8Array(doc.nE);
  if (!segs.length) return out;
  const C = doc.coords;
  for (let e = 0; e < doc.nE; e++) {
    const s = doc.eSheet[e];
    const [ox, oy] = doc.sheets[s].offset;
    const a = doc.edges[2 * e], b = doc.edges[2 * e + 1];
    const ax = C[2 * a] - ox, ay = C[2 * a + 1] - oy, bx = C[2 * b] - ox, by = C[2 * b + 1] - oy;
    const tol = 1e-6 * Math.max(1, Math.hypot(bx - ax, by - ay));
    for (const [ss, p, q] of segs) {
      if (ss !== s) continue;
      // a point of the join on the edge, or the edge's midpoint on the join's segment
      if (segDist(p[0], p[1], ax, ay, bx, by) <= tol || segDist(q[0], q[1], ax, ay, bx, by) <= tol
        || (p !== q && segDist((ax + bx) / 2, (ay + by) / 2, p[0], p[1], q[0], q[1]) <= tol)) { out[e] = 1; break; }
    }
  }
  return out;
}

/** Distance from (x, y) to segment (a, b). @param {number} x @param {number} y @param {number} ax @param {number} ay @param {number} bx @param {number} by */
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
