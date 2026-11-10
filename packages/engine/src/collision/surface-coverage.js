// @ts-check
// Conservative, pose-independent admission for EE energy mollification.
// This preserves the existing VT policy; it does not validate that policy or
// prevent triangle collapse. Recheck current fixed/group/weld state each call.
export class SurfaceCoverage {
  /** @param {any} candidates @param {Float64Array} thickness */
  constructor(candidates, thickness) {
    this.candidates = candidates; this.thickness = thickness;
    const m = candidates.mesh, map = new Map();
    /** @type {number[][]} */
    this.incident = Array.from({ length: m.nE }, () => []);
    const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
    for (let e = 0; e < m.nE; e++) {
      const k = key(m.edges[2 * e], m.edges[2 * e + 1]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    for (let t = 0; t < m.nT; t++) for (let i = 0; i < 3; i++) {
      const a = m.tris[3 * t + i], b = m.tris[3 * t + (i + 1) % 3];
      for (const e of map.get(key(a, b)) || []) this.incident[e].push(t);
    }
  }

  /** All four endpoint queries must have a retained opposite-edge triangle.
   * At parallel overlap at least one such query realizes the EE distance.
   * VT offset >= EE offset gives a barrier at least as restrictive there.
   * This sufficient condition deliberately refuses some usable backups.
   * @param {any} w @param {number} e @param {number} f @param {number} offset
   */
  covers(w, e, f, offset) {
    const E = this.candidates.mesh.edges;
    return this.backup(w, E[2 * e], f, offset) && this.backup(w, E[2 * e + 1], f, offset)
      && this.backup(w, E[2 * f], e, offset) && this.backup(w, E[2 * f + 1], e, offset);
  }

  backup(w, v, edge, offset) {
    const C = this.candidates, m = C.mesh, tc = this.thickness, fixed = w.fixed, weld = w.contact.weldSheet;
    for (const t of this.incident[edge]) {
      const a = m.tris[3 * t], b = m.tris[3 * t + 1], c = m.tris[3 * t + 2];
      if (fixed[v] && fixed[a] && fixed[b] && fixed[c]) continue;
      if (C.adjacent(v, a) || C.adjacent(v, b) || C.adjacent(v, c)) continue;
      if (weld[v] === m.triSheet[t] || (weld[a] === m.vSheet[v] && weld[b] === m.vSheet[v] && weld[c] === m.vSheet[v])) continue;
      if (0.5 * (tc[v] + Math.max(tc[a], tc[b], tc[c])) >= offset) return true;
    }
    return false;
  }
}
