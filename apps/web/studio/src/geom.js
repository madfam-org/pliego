// @ts-check
// 2-D helpers shared by the engine stub and the diagram: polygon area and ear-clipping
// triangulation of simple polygons (sheet faces are simple and CCW by spec §8.3).

/** Signed area (positive = CCW). @param {number[][]} pts */
export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function pointInTri(p, a, b, c, tol = 0) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < -tol || d2 < -tol || d3 < -tol, pos = d1 > tol || d2 > tol || d3 > tol;
  return !(neg && pos);   // inside, or within `tol` of an edge
}

/**
 * Ear clipping. Returns triangles as triples of indices into `pts`, CCW.
 * Fails visibly (throws) on a polygon it cannot clip rather than emitting garbage.
 * @param {number[][]} pts
 * @returns {number[][]}
 */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) throw new Error('triangulate: fewer than 3 points');
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea(pts) < 0) idx.reverse();
  // Area tolerance. Kernel coordinates sit on a 1e-6 mm grid, so points on one crease are collinear
  // only to about 1e-6·L in cross product (L = the face's size). Faces bounded by a crease carry runs
  // of such points (every cut that meets the crease adds one); once the ears between them are
  // clipped they become consecutive and are dropped, and a point lying on a candidate ear's edge
  // must block it. 2e-5·L keeps a 10x margin and is far below any visible feature.
  const box = bbox2(pts);
  const eps = 2e-5 * (Math.hypot(box.w, box.h) || 1);
  if (Math.abs(signedArea(pts)) <= eps * n) throw new Error('triangulate: polygon is not simple (no area)');
  const corner = (ia, ib, ic) => {
    const a = pts[ia], b = pts[ib], c = pts[ic];
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  };
  const same = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 1e-9;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const cross = corner(ia, ib, ic);
      if (Math.abs(cross) <= eps) { idx.splice(i, 1); clipped = true; break; }   // collinear: no area
      if (cross < 0) continue;                                                   // reflex corner
      const a = pts[ia], b = pts[ib], c = pts[ic];
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const q = pts[j];
        if (same(q, a) || same(q, b) || same(q, c)) continue;   // a repeated point (bridge) never blocks
        if (pointInTri(q, a, b, c, eps)) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Whatever is left covers no area (a run of collinear points): the face is fully covered.
      if (Math.abs(signedArea(idx.map((k) => pts[k]))) <= eps * idx.length) return tris;
      throw new Error('triangulate: polygon is not simple');
    }
  }
  if (idx.length === 3 && Math.abs(corner(idx[0], idx[1], idx[2])) > eps) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Bounding box of 2-D points. */
export function bbox2(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
