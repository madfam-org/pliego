// @ts-check
/**
 * Render-side views of a World: the render mesh (vertices split into smoothing groups along fold
 * hinges), crease/cut polylines for overlays, and ray picking. Buffers are allocated once and
 * refreshed in place.
 */

const KIND = /** @type {Record<string, number>} */ ({ score: 2, perforation: 3, cut: 4 });

export class RenderBuffers {
  /** @param {any} w World */
  constructor(w) {
    this.w = w;
    const r = w.mesh.render;
    this.positions = new Float32Array(3 * r.nR);
    this.normals = new Float32Array(3 * r.nR);
    this.uvs = r.uv;
    this.sheetIds = Float32Array.from(r.sheet);
    this.indices = r.indices;
    this.out = { positions: this.positions, normals: this.normals, uvs: this.uvs, sheetIds: this.sheetIds, indices: this.indices, vertexCount: r.nR, triangleCount: w.mesh.nT };
    // crease polylines
    const doc = w.doc;
    /** @type {number[]} */ const seg = [], kinds = [];
    for (let e = 0; e < doc.nE; e++) {
      const t = doc.treatment[e];
      let k;
      if (t === 'crease') k = doc.assignment[e] === 'M' ? 0 : 1;
      else if (KIND[t] !== undefined) k = KIND[t];
      else continue;
      const chain = w.mesh.docEdgeChain[e];
      for (let i = 0; i + 1 < chain.length; i++) { seg.push(chain[i], chain[i + 1]); kinds.push(k); }
    }
    this.segVerts = Int32Array.from(seg);
    this.lines = { positions: new Float32Array(3 * seg.length), kinds: Uint8Array.from(kinds), count: kinds.length };
  }

  update() {
    const x = this.w.x, r = this.w.mesh.render, T = this.w.mesh.tris, P = this.positions, N = this.normals;
    for (let i = 0; i < r.nR; i++) { const v = 3 * r.src[i]; P[3 * i] = x[v]; P[3 * i + 1] = x[v + 1]; P[3 * i + 2] = x[v + 2]; }
    N.fill(0);
    const C = r.triCorner;
    for (let t = 0; t < this.w.mesh.nT; t++) {
      const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
      const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
      const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let i = 0; i < 3; i++) { const q = 3 * C[3 * t + i]; N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    for (let i = 0; i < r.nR; i++) {
      const L = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1;
      N[3 * i] /= L; N[3 * i + 1] /= L; N[3 * i + 2] /= L;
    }
    return this.out;
  }

  creaseLines() {
    const x = this.w.x, S = this.segVerts, P = this.lines.positions;
    for (let i = 0; i < S.length; i++) { const v = 3 * S[i]; P[3 * i] = x[v]; P[3 * i + 1] = x[v + 1]; P[3 * i + 2] = x[v + 2]; }
    return this.lines;
  }

  /** Möller–Trumbore against the simulation triangles. @param {number[]} o @param {number[]} d */
  pick(o, d) {
    const x = this.w.x, m = this.w.mesh, T = m.tris;
    let best = null, bestT = Infinity;
    for (let t = 0; t < m.nT; t++) {
      const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - x[a], ty = o[1] - x[a + 1], tz = o[2] - x[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1e-9 && dist < bestT) {
        bestT = dist;
        const wa = 1 - u - v;
        const corner = wa >= u && wa >= v ? T[3 * t] : u >= v ? T[3 * t + 1] : T[3 * t + 2];
        best = { vertex: corner, triangle: t, point: [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist], sheet: m.triSheet[t] };
      }
    }
    return best;
  }
}
