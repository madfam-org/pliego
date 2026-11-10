// @ts-check
// Deterministic swept AABB candidate reference. Triangles/edges are sorted along
// X; full 3-D bounds cover both endpoints and finite thickness. No 50 mm reach
// cap or endpoint-only sphere rejection. Optional refit BVH keeps the same bounds,
// exclusions and pair order; the prefix scan remains the reference implementation.
import { BoundsTree } from './bounds-tree.js';

export class SweptCandidates {
  /** @param {any} mesh @param {Float64Array} thickness @param {'reference'|'bvh'} [mode] */
  constructor(mesh, thickness, mode = 'reference') {
    this.mesh = mesh; this.thickness = thickness;
    if (!['reference', 'bvh'].includes(mode)) throw new RangeError('Swept contact: invalid broad phase');
    this.mode = mode;
    if (thickness.length !== mesh.nV || thickness.some(t => !Number.isFinite(t) || t < 0)) throw new RangeError('Swept contact: invalid thickness');
    this.stationaryFixed = new Uint8Array(mesh.nV);
    this.vertexBoxes = new Float64Array(6 * mesh.nV);
    this.triangleBoxes = new Float64Array(6 * mesh.nT);
    this.edgeBoxes = new Float64Array(6 * mesh.nE);
    this.triangleOrder = Array.from({ length: mesh.nT }, (_, i) => i);
    this.edgeOrder = Array.from({ length: mesh.nE }, (_, i) => i);
    this.triangleInactive = new Uint8Array(mesh.nT); this.edgeInactive = new Uint8Array(mesh.nE);
    this.triangleTree = mode === 'bvh' ? new BoundsTree(mesh.nT) : null;
    this.edgeTree = mode === 'bvh' ? new BoundsTree(mesh.nE) : null;
    this.neighbors = Array.from({ length: mesh.nV }, () => new Set());
    for (let e = 0; e < mesh.nE; e++) {
      const a = mesh.edges[2 * e], b = mesh.edges[2 * e + 1]; this.neighbors[a].add(b); this.neighbors[b].add(a);
    }
    this.vt = new Int32Array(2048); this.ee = new Int32Array(2048);
    this.vertexTriangleCount = 0; this.edgeEdgeCount = 0;
    // Connectivity/counts are immutable, as for the constructor's neighbor graph.
    // Cache only unswept Float64 poses; compare contents, never input identity.
    this.cacheValid = false; this.reusedLastBuild = false;
    this.cachedInputs = /** @type {Array<Float64Array>} */([]);
  }
  adjacent(a, b) { return a === b || this.mesh.vGroup[a] === this.mesh.vGroup[b] || this.neighbors[a].has(b); }

  /** @param {ArrayLike<number>} from @param {ArrayLike<number>} to @param {Uint8Array} fixed @param {Int32Array} weld @param {boolean} [reuse] */
  build(from, to, fixed, weld, reuse = true) {
    const m = this.mesh, V = this.vertexBoxes, T = this.triangleBoxes, E = this.edgeBoxes, tc = this.thickness;
    const inactive = this.stationaryFixed;
    if (from.length !== 3 * m.nV || to.length !== from.length || fixed.length !== m.nV || weld.length !== m.nV) throw new RangeError('Swept contact: invalid buffer size');
    const cacheable = this.mode === 'bvh' && from === to && from instanceof Float64Array;
    const inputs = cacheable ? [from, fixed, weld, tc, m.vGroup, m.vSheet, m.triSheet] : [];
    this.reusedLastBuild = false;
    if (reuse && cacheable && this.cacheValid && inputs.every((a, i) => exactContents(a, this.cachedInputs[i]))) {
      this.reusedLastBuild = true;
      for (const tree of [this.triangleTree, this.edgeTree]) if (tree) { tree.nodeTests = 0; tree.rootContainmentTests = 0; }
      return;
    }
    this.cacheValid = false;
    for (let v = 0; v < m.nV; v++) inactive[v] = fixed[v] && from[3 * v] === to[3 * v] && from[3 * v + 1] === to[3 * v + 1] && from[3 * v + 2] === to[3 * v + 2] ? 1 : 0;
    for (let v = 0; v < m.nV; v++) for (let k = 0; k < 3; k++) {
      const a = from[3 * v + k], b = to[3 * v + k];
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Swept contact: non-finite position');
      const margin = tc[v] / 2 + 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
      V[6 * v + k] = Math.min(a, b) - margin; V[6 * v + 3 + k] = Math.max(a, b) + margin;
    }
    for (let t = 0; t < m.nT; t++) unionBox(T, t, V, tc, m.tris, 3 * t, 3);
    for (let e = 0; e < m.nE; e++) unionBox(E, e, V, tc, m.edges, 2 * e, 2);
    this.triangleOrder.sort((a, b) => T[6 * a] - T[6 * b] || a - b);
    this.edgeOrder.sort((a, b) => E[6 * a] - E[6 * b] || a - b);
    if (this.triangleTree && this.edgeTree) {
      this.indexed(weld);
      if (cacheable) {
        for (let i = 0; i < inputs.length; i++) {
          if (this.cachedInputs[i]?.length !== inputs[i].length) this.cachedInputs[i] = new Float64Array(inputs[i].length);
          this.cachedInputs[i].set(inputs[i]);
        }
        this.cacheValid = true;
      }
      return;
    }
    let nv = 0, ne = 0;
    for (let v = 0; v < m.nV; v++) {
      for (const t of this.triangleOrder) {
        if (T[6 * t] > V[6 * v + 3]) break;
        if (!boxesOverlap(V, v, T, t)) continue;
        const a = m.tris[3 * t], b = m.tris[3 * t + 1], c = m.tris[3 * t + 2];
        if (inactive[v] && inactive[a] && inactive[b] && inactive[c]) continue;
        if (this.adjacent(v, a) || this.adjacent(v, b) || this.adjacent(v, c)) continue;
        if (weld[v] === m.triSheet[t] || (weld[a] === m.vSheet[v] && weld[b] === m.vSheet[v] && weld[c] === m.vSheet[v])) continue;
        if (2 * nv + 2 > this.vt.length) { const next = new Int32Array(this.vt.length * 2); next.set(this.vt); this.vt = next; }
        this.vt[2 * nv] = v; this.vt[2 * nv + 1] = t; nv++;
      }
    }
    for (let i = 0; i < this.edgeOrder.length; i++) {
      const e = this.edgeOrder[i], a = m.edges[2 * e], b = m.edges[2 * e + 1];
      for (let j = i + 1; j < this.edgeOrder.length; j++) {
        const f = this.edgeOrder[j];
        if (E[6 * f] > E[6 * e + 3]) break;
        if (!boxesOverlap(E, e, E, f)) continue;
        const c = m.edges[2 * f], d = m.edges[2 * f + 1];
        if (inactive[a] && inactive[b] && inactive[c] && inactive[d]) continue;
        if (this.adjacent(a, c) || this.adjacent(a, d) || this.adjacent(b, c) || this.adjacent(b, d)) continue;
        if ((weld[a] === m.vSheet[c] && weld[b] === m.vSheet[c]) || (weld[c] === m.vSheet[a] && weld[d] === m.vSheet[a])) continue;
        if (2 * ne + 2 > this.ee.length) { const next = new Int32Array(this.ee.length * 2); next.set(this.ee); this.ee = next; }
        this.ee[2 * ne] = e; this.ee[2 * ne + 1] = f; ne++;
      }
    }
    this.vertexTriangleCount = nv; this.edgeEdgeCount = ne;
  }

  /** Refitted index returns EXACT reference rank order before any stencil work. */
  indexed(weld) {
    const m = this.mesh, V = this.vertexBoxes, inactive = this.stationaryFixed;
    const TT = /** @type {BoundsTree} */(this.triangleTree), ET = /** @type {BoundsTree} */(this.edgeTree);
    for (let t = 0; t < m.nT; t++) this.triangleInactive[t] = inactive[m.tris[3 * t]] && inactive[m.tris[3 * t + 1]] && inactive[m.tris[3 * t + 2]] ? 1 : 0;
    for (let e = 0; e < m.nE; e++) this.edgeInactive[e] = inactive[m.edges[2 * e]] && inactive[m.edges[2 * e + 1]] ? 1 : 0;
    TT.refit(this.triangleBoxes, this.triangleOrder, this.triangleInactive);
    ET.refit(this.edgeBoxes, this.edgeOrder, this.edgeInactive);
    let nv = 0, ne = 0;
    for (let v = 0; v < m.nV; v++) {
      const count = TT.query(V, v, inactive[v]);
      for (let q = 0; q < count; q++) {
        const rank = TT.hits[q];
        const t = this.triangleOrder[rank], a = m.tris[3 * t], b = m.tris[3 * t + 1], c = m.tris[3 * t + 2];
        if (this.adjacent(v, a) || this.adjacent(v, b) || this.adjacent(v, c)) continue;
        if (weld[v] === m.triSheet[t] || (weld[a] === m.vSheet[v] && weld[b] === m.vSheet[v] && weld[c] === m.vSheet[v])) continue;
        if (2 * nv + 2 > this.vt.length) { const next = new Int32Array(this.vt.length * 2); next.set(this.vt); this.vt = next; }
        this.vt[2 * nv] = v; this.vt[2 * nv + 1] = t; nv++;
      }
    }
    for (let i = 0; i < this.edgeOrder.length; i++) {
      const e = this.edgeOrder[i], a = m.edges[2 * e], b = m.edges[2 * e + 1];
      const count = ET.query(this.edgeBoxes, e, this.edgeInactive[e], i);
      for (let q = 0; q < count; q++) {
        const rank = ET.hits[q];
        const f = this.edgeOrder[rank], c = m.edges[2 * f], d = m.edges[2 * f + 1];
        if (this.adjacent(a, c) || this.adjacent(a, d) || this.adjacent(b, c) || this.adjacent(b, d)) continue;
        if ((weld[a] === m.vSheet[c] && weld[b] === m.vSheet[c]) || (weld[c] === m.vSheet[a] && weld[d] === m.vSheet[a])) continue;
        if (2 * ne + 2 > this.ee.length) { const next = new Int32Array(this.ee.length * 2); next.set(this.ee); this.ee = next; }
        this.ee[2 * ne] = e; this.ee[2 * ne + 1] = f; ne++;
      }
    }
    this.vertexTriangleCount = nv; this.edgeEdgeCount = ne;
  }
}

function exactContents(a, b) {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function unionBox(out, index, vertices, thickness, ids, offset, count) {
  let maximumThickness = 0;
  for (let i = 0; i < count; i++) maximumThickness = Math.max(maximumThickness, thickness[ids[offset + i]]);
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = ids[offset + i], extra = 0.5 * (maximumThickness - thickness[v]);
      lo = Math.min(lo, vertices[6 * v + k] - extra); hi = Math.max(hi, vertices[6 * v + 3 + k] + extra);
    }
    out[6 * index + k] = lo; out[6 * index + 3 + k] = hi;
  }
}

export function boxesOverlap(a, i, b, j) {
  for (let k = 0; k < 3; k++) if (a[6 * i + k] > b[6 * j + 3 + k] || b[6 * j + k] > a[6 * i + 3 + k]) return false;
  return true;
}
