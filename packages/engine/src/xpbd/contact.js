// @ts-check
/**
 * Layer contact (engine.md §3.4): vertex–triangle, inter-sheet and self, with memorised sidedness
 * and position-level Coulomb friction; plus the ground plane y = 0.
 *
 * Broad phase every substep: uniform integer spatial hash (cell = max mesh edge, enlarged to 2 × reach when needed) of triangle
 * boxes inflated by the query radius (contact distance + the largest displacement possible this substep).
 * Narrow phase each substep over the candidate pairs. Pairs skip triangles that contain the vertex,
 * one of its mesh neighbours, a copy of it (cut duplicates), or a tab welded to its sheet.
 * Only projections that fall inside the triangle are handled (edge–edge contact is out of scope
 * for v0.1, engine.md §8).
 */

export class Contact {
  /** @param {any} w World */
  constructor(w) {
    const mesh = w.mesh;
    this.mesh = mesh;
    // vertex adjacency (CSR)
    const deg = new Int32Array(mesh.nV + 1);
    for (let e = 0; e < mesh.nE; e++) { deg[mesh.edges[2 * e] + 1]++; deg[mesh.edges[2 * e + 1] + 1]++; }
    for (let v = 0; v < mesh.nV; v++) deg[v + 1] += deg[v];
    const adj = new Int32Array(deg[mesh.nV]);
    const fill = deg.slice(0, mesh.nV);
    for (let e = 0; e < mesh.nE; e++) { const a = mesh.edges[2 * e], b = mesh.edges[2 * e + 1]; adj[fill[a]++] = b; adj[fill[b]++] = a; }
    this.adjStart = deg; this.adj = adj;
    let maxE = 0;
    for (let e = 0; e < mesh.nE; e++) maxE = Math.max(maxE, mesh.edgeLen[e]);
    this.cell = maxE;
    this.tc = new Float64Array(mesh.nV);
    this.mu = new Float64Array(mesh.nV);
    for (let v = 0; v < mesh.nV; v++) {
      const d = w.doc.sheets[mesh.vSheet[v]].derived;
      this.tc[v] = Math.max(d.collision_thickness, 0.05);
      this.mu[v] = d.friction;
    }
    /** candidate pairs */
    this.pv = new Int32Array(0); this.pt = new Int32Array(0); this.nPairs = 0;
    /** @type {Map<number, number>} memorised sidedness, key v·nT + t */
    this.side = new Map();
    this.active = 0;
    this.weldSheet = new Int32Array(mesh.nV);
    this.setWeldExclusion(w.weldSheet);
    this.mark = new Int32Array(mesh.nV).fill(-1);
    // faceOrders [f, g, s] (FOLD: f lies on side s of g's normal; partial in v1 — a missing pair is
    // "unknown"): seeds the sidedness of a vertex of face f against a triangle of face g
    /** @type {Map<number, number>} */
    this.faceSide = new Map();
    this.nF = w.doc.nF;
    for (const fo of w.doc.faceOrders ?? []) if (Array.isArray(fo) && fo.length === 3 && fo[2] !== 0) this.faceSide.set(fo[0] * this.nF + fo[1], fo[2] > 0 ? 1 : -1);
  }

  /**
   * Contact exclusion around welds: a vertex within two mesh rings of a vertex glued to sheet b
   * does not collide with b (the hinge at a glue line lies on b; its side is undetermined there).
   * Step-gated glue (spec §5.21) calls this again when it switches.
   * @param {Int32Array} weldSheet per vertex: the sheet it is welded to, or −1
   */
  setWeldExclusion(weldSheet) {
    const n = this.mesh.nV, deg = this.adjStart, adj = this.adj;
    const near = Int32Array.from(weldSheet);
    for (let ring = 0; ring < 2; ring++) {
      const prev = Int32Array.from(near);
      for (let v = 0; v < n; v++) {
        if (prev[v] >= 0) continue;
        for (let q = deg[v]; q < deg[v + 1]; q++) { const u = adj[q]; if (prev[u] >= 0) { near[v] = prev[u]; break; } }
      }
    }
    this.weldSheet = near;
  }

  /** Rebuild candidate pairs. @param {Float64Array} x @param {Uint8Array} fixed @param {number} reach extra radius (mm) */
  broadPhase(x, fixed, reach) {
    const m = this.mesh, T = m.tris;
    const cell = Math.max(this.cell, reach * 2, 1e-3);
    /** @type {Map<number, number[]>} */
    const grid = new Map();
    // integer spatial hash (collisions only add candidates; the distance test filters them)
    const key = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0);
    let rmax = 0;
    for (let v = 0; v < m.nV; v++) rmax = Math.max(rmax, this.tc[v]);
    const R = rmax + reach;
    for (let t = 0; t < m.nT; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < 3; i++) { const v = 3 * T[3 * t + i]; x0 = Math.min(x0, x[v]); x1 = Math.max(x1, x[v]); y0 = Math.min(y0, x[v + 1]); y1 = Math.max(y1, x[v + 1]); z0 = Math.min(z0, x[v + 2]); z1 = Math.max(z1, x[v + 2]); }
      const i0 = Math.floor((x0 - R) / cell), i1 = Math.floor((x1 + R) / cell);
      const j0 = Math.floor((y0 - R) / cell), j1 = Math.floor((y1 + R) / cell);
      const k0 = Math.floor((z0 - R) / cell), k1 = Math.floor((z1 + R) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const kk = key(i, j, k);
        let l = grid.get(kk);
        if (!l) { l = []; grid.set(kk, l); }
        l.push(t);
      }
    }
    /** @type {number[]} */ const PV = [], PT = [];
    const mark = this.mark;
    for (let v = 0; v < m.nV; v++) {
      const l = grid.get(key(Math.floor(x[3 * v] / cell), Math.floor(x[3 * v + 1] / cell), Math.floor(x[3 * v + 2] / cell)));
      if (!l) continue;
      mark[v] = v;
      for (let q = this.adjStart[v]; q < this.adjStart[v + 1]; q++) mark[this.adj[q]] = v;
      for (const t of l) {
        const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
        if (mark[a] === v || mark[b] === v || mark[c] === v) continue;
        const g = m.vGroup[v];
        if (m.vGroup[a] === g || m.vGroup[b] === g || m.vGroup[c] === g) continue;
        if (fixed[v] && fixed[a] && fixed[b] && fixed[c]) continue;
        const ws = this.weldSheet[v];
        if (ws >= 0 && m.triSheet[t] === ws) continue;
        const sv = m.vSheet[v];
        if (this.weldSheet[a] === sv && this.weldSheet[b] === sv && this.weldSheet[c] === sv) continue;
        if (pointTriDist(x, v, a, b, c) > R) continue;
        PV.push(v); PT.push(t);
      }
    }
    for (let v = 0; v < m.nV; v++) mark[v] = -1;
    this.pv = Int32Array.from(PV); this.pt = Int32Array.from(PT); this.nPairs = PV.length;
    this._tuReady = false;
    // forget sidedness of pairs that are no longer candidates
    const keep = new Map();
    for (let p = 0; p < this.nPairs; p++) { const k = this.pv[p] * m.nT + this.pt[p]; const s = this.side.get(k); if (s !== undefined) keep.set(k, s); }
    this.side = keep;
  }

  /**
   * Project contacts (one Gauss–Seidel pass) with friction. `xs` = positions at substep start.
   * @param {Float64Array} x @param {Float64Array} xs @param {Float64Array} w inverse masses
   */
  project(x, xs, w) {
    const m = this.mesh, T = m.tris;
    if (!this.nPairs) { this.active = 0; return 0; }
    // unit normals of the triangles in play, once per pass (cheap rejection by signed distance)
    const N = this._tn ?? (this._tn = new Float64Array(3 * m.nT));
    const used = this._tu ?? (this._tu = new Uint8Array(m.nT));
    if (!this._tuReady) { used.fill(0); for (let p = 0; p < this.nPairs; p++) used[this.pt[p]] = 1; this._tuReady = true; }
    for (let t = 0; t < m.nT; t++) {
      if (!used[t]) continue;
      const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const il = L > 0 ? 1 / L : 0;
      N[3 * t] = nx * il; N[3 * t + 1] = ny * il; N[3 * t + 2] = nz * il;
    }
    let active = 0;
    for (let p = 0; p < this.nPairs; p++) {
      const v = this.pv[p], t = this.pt[p];
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const tc = Math.max(this.tc[v], this.tc[a]);
      const nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2];
      if (nx === 0 && ny === 0 && nz === 0) continue;
      const ax = x[3 * a], ay = x[3 * a + 1], az = x[3 * a + 2];
      const px = x[3 * v] - ax, py = x[3 * v + 1] - ay, pz = x[3 * v + 2] - az;
      const d = px * nx + py * ny + pz * nz;
      if (Math.abs(d) > 2 * tc) continue;
      const e1x = x[3 * b] - ax, e1y = x[3 * b + 1] - ay, e1z = x[3 * b + 2] - az;
      const e2x = x[3 * c] - ax, e2y = x[3 * c + 1] - ay, e2z = x[3 * c + 2] - az;
      // barycentric of the projection
      const d11 = e1x * e1x + e1y * e1y + e1z * e1z, d12 = e1x * e2x + e1y * e2y + e1z * e2z, d22 = e2x * e2x + e2y * e2y + e2z * e2z;
      const p1 = px * e1x + py * e1y + pz * e1z, p2 = px * e2x + py * e2y + pz * e2z;
      const den = d11 * d22 - d12 * d12;
      if (!(den > 1e-12 * d11 * d22)) continue; // degenerate triangle
      const bb = (d22 * p1 - d12 * p2) / den, bc = (d11 * p2 - d12 * p1) / den, ba = 1 - bb - bc;
      if (!(ba >= -1e-3 && bb >= -1e-3 && bc >= -1e-3)) continue;
      const key = v * m.nT + t;
      let s = this.side.get(key);
      if (s === undefined && this.faceSide.size) {
        const fs = this.faceSide.get(m.vFace[v] * this.nF + m.triFace[t]);
        if (fs !== undefined) { s = fs; this.side.set(key, s); }
      }
      if (s === undefined) {
        // sidedness from the substep start (before this substep's motion)
        const sx = xs[3 * v] - (ba * xs[3 * a] + bb * xs[3 * b] + bc * xs[3 * c]);
        const sy = xs[3 * v + 1] - (ba * xs[3 * a + 1] + bb * xs[3 * b + 1] + bc * xs[3 * c + 1]);
        const sz = xs[3 * v + 2] - (ba * xs[3 * a + 2] + bb * xs[3 * b + 2] + bc * xs[3 * c + 2]);
        const ds = sx * nx + sy * ny + sz * nz;
        s = ds >= 0 ? 1 : -1;
        this.side.set(key, s);
      }
      const C = s * d - tc;
      if (C >= 0) continue;
      active++;
      const wv = w[v], wa = w[a], wb = w[b], wc = w[c];
      const sumw = wv + ba * ba * wa + bb * bb * wb + bc * bc * wc;
      if (sumw === 0) continue;
      const lam = -C / sumw;
      const dnx = s * nx * lam, dny = s * ny * lam, dnz = s * nz * lam;
      x[3 * v] += wv * dnx; x[3 * v + 1] += wv * dny; x[3 * v + 2] += wv * dnz;
      x[3 * a] -= wa * ba * dnx; x[3 * a + 1] -= wa * ba * dny; x[3 * a + 2] -= wa * ba * dnz;
      x[3 * b] -= wb * bb * dnx; x[3 * b + 1] -= wb * bb * dny; x[3 * b + 2] -= wb * bb * dnz;
      x[3 * c] -= wc * bc * dnx; x[3 * c + 1] -= wc * bc * dny; x[3 * c + 2] -= wc * bc * dnz;
      // friction: relative tangential displacement over the substep
      const mu = Math.max(this.mu[v], this.mu[a]);
      let rx = (x[3 * v] - xs[3 * v]) - (ba * (x[3 * a] - xs[3 * a]) + bb * (x[3 * b] - xs[3 * b]) + bc * (x[3 * c] - xs[3 * c]));
      let ry = (x[3 * v + 1] - xs[3 * v + 1]) - (ba * (x[3 * a + 1] - xs[3 * a + 1]) + bb * (x[3 * b + 1] - xs[3 * b + 1]) + bc * (x[3 * c + 1] - xs[3 * c + 1]));
      let rz = (x[3 * v + 2] - xs[3 * v + 2]) - (ba * (x[3 * a + 2] - xs[3 * a + 2]) + bb * (x[3 * b + 2] - xs[3 * b + 2]) + bc * (x[3 * c + 2] - xs[3 * c + 2]));
      const rn = rx * nx + ry * ny + rz * nz;
      rx -= rn * nx; ry -= rn * ny; rz -= rn * nz;
      const rt = Math.hypot(rx, ry, rz);
      if (rt === 0) continue;
      const lim = mu * -C;
      const f = rt <= lim ? 1 : lim / rt;
      const fl = f / sumw;
      x[3 * v] -= wv * rx * fl; x[3 * v + 1] -= wv * ry * fl; x[3 * v + 2] -= wv * rz * fl;
      x[3 * a] += wa * ba * rx * fl; x[3 * a + 1] += wa * ba * ry * fl; x[3 * a + 2] += wa * ba * rz * fl;
      x[3 * b] += wb * bb * rx * fl; x[3 * b + 1] += wb * bb * ry * fl; x[3 * b + 2] += wb * bb * rz * fl;
      x[3 * c] += wc * bc * rx * fl; x[3 * c + 1] += wc * bc * ry * fl; x[3 * c + 2] += wc * bc * rz * fl;
    }
    this.active = active;
    return active;
  }

  /** Ground plane y ≥ 0 with friction. @param {Float64Array} x @param {Float64Array} xs @param {Float64Array} w */
  ground(x, xs, w) {
    let n = 0;
    for (let v = 0; v < this.mesh.nV; v++) {
      if (w[v] === 0) continue;
      const r = 0; // documents lay sheets on the table at y = 0 (mid-surface on the plane)
      const y = x[3 * v + 1];
      if (y >= r) continue;
      n++;
      const pen = r - y;
      x[3 * v + 1] = r;
      const dx = x[3 * v] - xs[3 * v], dz = x[3 * v + 2] - xs[3 * v + 2];
      const dt = Math.hypot(dx, dz);
      if (dt === 0) continue;
      const lim = this.mu[v] * pen;
      const f = dt <= lim ? 1 : lim / dt;
      x[3 * v] -= dx * f; x[3 * v + 2] -= dz * f;
    }
    return n;
  }
}

/** Distance from vertex v to triangle (a, b, c) (clamped to the triangle). */
function pointTriDist(/** @type {Float64Array} */ x, /** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c) {
  const px = x[3 * v], py = x[3 * v + 1], pz = x[3 * v + 2];
  // cheap bound: distance to the triangle's bounding sphere (centroid + max vertex radius)
  const cx = (x[3 * a] + x[3 * b] + x[3 * c]) / 3, cy = (x[3 * a + 1] + x[3 * b + 1] + x[3 * c + 1]) / 3, cz = (x[3 * a + 2] + x[3 * b + 2] + x[3 * c + 2]) / 3;
  let r = 0;
  for (const q of [a, b, c]) r = Math.max(r, Math.hypot(x[3 * q] - cx, x[3 * q + 1] - cy, x[3 * q + 2] - cz));
  return Math.max(0, Math.hypot(px - cx, py - cy, pz - cz) - r);
}
