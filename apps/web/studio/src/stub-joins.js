// @ts-check
// Preview-stub rules for keyed mechanisms and glue (spec §5.18–§5.20), split out of
// engine-stub.js (file-size gate). Pure functions; the stub owns the face tree they read.

/**
 * Keyed mechanism output (spec §5.18; the engine's keyed.js): linear between [control, output]
 * keys, held outside them, wrapped every `period` when one is given. No keys: the value itself.
 * @param {{keys?: number[][], period?: number}} m @param {number} v
 */
export function keyedOutput(m, v) {
  const K = m.keys;
  if (!Array.isArray(K) || K.length < 2) return v;
  const n = K.length, c0 = K[0][0];
  let u = v;
  if (m.period > 0) {
    u = (v - c0) % m.period;
    if (u < 0) u += m.period;
    u += c0;
    const cl = K[n - 1][0], span = c0 + m.period - cl;
    if (u >= cl) return span > 0 ? K[n - 1][1] + ((u - cl) / span) * (K[0][1] - K[n - 1][1]) : K[n - 1][1];
  } else {
    if (u <= c0) return K[0][1];
    if (u >= K[n - 1][0]) return K[n - 1][1];
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (K[mid][0] <= u) lo = mid; else hi = mid; }
  return K[lo][1] + ((u - K[lo][0]) / (K[hi][0] - K[lo][0])) * (K[hi][1] - K[lo][1]);
}

/** Even–odd point-in-polygon test (2-D). @param {number[][]} poly @param {number} x @param {number} y */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const [xi, yi] = poly[i], [xk, yk] = poly[k];
    if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Glue holds a folded loop shut (spec §5.19, preview rule). For a glue join within one sheet,
 * the creases on the face-tree path between the tab's face and its zone's face close a loop
 * once the glue holds: a `release` of one of them while the glue holds leaves it where it is
 * (the stub has no physics to let the loop spring). A glue holds from the start, or from its
 * `active_from` step, until a step that lists it in `release_joins` (spec §5.20). Glue between
 * two sheets changes nothing in the preview.
 * @param {any} j sheet document @param {({face:number, edge:number}|null)[]} parent face tree
 * @returns {{from:number, until:number, edges:Set<number>}[]}
 */
export function glueLocks(j, parent) {
  const steps = ((j['pliego:sequence'] || {}).steps) || [];
  const sheets = j['pliego:sheets'], V = j.vertices_coords;
  const faceAt = (/** @type {number} */ s, /** @type {number[]} */ p) => {
    const off = sheets[s].offset, x = p[0] + off[0], y = p[1] + off[1];
    return j.faces_vertices.findIndex((/** @type {number[]} */ f, /** @type {number} */ fi) => j['pliego:faces_sheet'][fi] === s && inside(f.map((v) => V[v]), x, y));
  };
  const depth = (/** @type {number} */ f) => { let d = 0; for (let q = f; parent[q]; q = /** @type {any} */ (parent[q]).face) d++; return d; };
  const locks = [];
  for (const jn of j['pliego:joins'] || []) {
    if (jn.type !== 'glue' || !jn.a || !jn.b || jn.a.sheet !== jn.b.sheet) continue;
    const s = sheets.findIndex((/** @type {any} */ sh) => sh.id === jn.a.sheet);
    const reg = jn.a.region || [];
    if (s < 0 || !reg.length || !Array.isArray(jn.map)) continue;
    const c = reg.reduce((/** @type {number[]} */ a, /** @type {number[]} */ p) => [a[0] + p[0] / reg.length, a[1] + p[1] / reg.length], [0, 0]);
    const [ma, mb, mc, md, tx, ty] = jn.map;
    let fa = faceAt(s, c), fb = faceAt(s, [ma * c[0] + mb * c[1] + tx, mc * c[0] + md * c[1] + ty]);
    if (fa < 0 || fb < 0) continue;
    const edges = new Set();
    let da = depth(fa), db = depth(fb);
    while (fa !== fb) {
      const up = da >= db ? fa : fb, link = /** @type {any} */ (parent[up]);
      if (!link) break; // different trees (should not happen within one sheet)
      edges.add(link.edge);
      if (da >= db) { fa = link.face; da--; } else { fb = link.face; db--; }
    }
    if (fa !== fb) continue;
    const from = jn.active_from === undefined ? -1
      : Number.isInteger(jn.active_from) ? jn.active_from : steps.findIndex((/** @type {any} */ st) => st.id === jn.active_from);
    const r = steps.findIndex((/** @type {any} */ st) => (st.release_joins || []).includes(jn.id));
    if (edges.size) locks.push({ from, until: r >= 0 ? r : Infinity, edges });
  }
  return locks;
}

/** Is crease e held by a glue that holds during step k? @param {{from:number, until:number, edges:Set<number>}[]} locks @param {number} e @param {number} k */
export function lockedAt(locks, e, k) {
  return locks.some((L) => k >= L.from && k < L.until && L.edges.has(e));
}
