// @ts-check
// Engine stub — the studio's test double for @pliego/engine (docs/strategy/engine.md §5).
//
// Same public surface as the real engine (loadDocument, World with setControl/step/render/grab/
// moveGrab/release/pick/stats/snapshot/restore) but NO physics: a rigid face-tree pose driven by
// the fold program and by hinge / leaf / rotate mechanisms. The studio uses it only when
// /engine/index.js is absent or has no World, and says so in the status bar. Node tests use it as
// the WebGL-less contract double.

import { triangulate, bbox2 } from './geom.js';

export const ENGINE_KIND = 'stub';
const DEG = Math.PI / 180;
const HINGE_ASSIGN = new Set(['M', 'V', 'F', 'U', 'J']);

export class DocumentError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Document rejected (${problems.length} problem${problems.length === 1 ? '' : 's'}): ${problems.slice(0, 5).join('; ')}`);
    this.name = 'DocumentError';
    this.problems = problems;
  }
}

/**
 * Structural checks (spec §8 rules 1, 2, 6, 7-partial). The real engine is stricter.
 * @param {any} json
 */
export function loadDocument(json) {
  const p = [];
  if (!json || typeof json !== 'object') throw new DocumentError(['not an object']);
  const V = Array.isArray(json.vertices_coords) ? json.vertices_coords.length : -1;
  const E = Array.isArray(json.edges_vertices) ? json.edges_vertices.length : -1;
  const F = Array.isArray(json.faces_vertices) ? json.faces_vertices.length : -1;
  if (V < 3) p.push('vertices_coords missing or < 3');
  if (E < 3) p.push('edges_vertices missing or < 3');
  if (F < 1) p.push('faces_vertices missing');
  const sheets = json['pliego:sheets'];
  if (!Array.isArray(sheets) || !sheets.length) p.push('pliego:sheets missing');
  if (p.length) throw new DocumentError(p);
  const lens = { edges_assignment: E, edges_foldAngle: E, 'pliego:edges_sheet': E, 'pliego:edges_treatment': E, 'pliego:vertices_sheet': V, 'pliego:faces_sheet': F };
  for (const [k, n] of Object.entries(lens)) {
    if (!Array.isArray(json[k]) || json[k].length !== n) p.push(`${k} length ≠ ${n}`);
  }
  const vs = json['pliego:vertices_sheet'] || [];
  json.edges_vertices.forEach((e, i) => {
    if (!e || e.length !== 2 || e.some((v) => !(v >= 0 && v < V))) p.push(`edge ${i} index out of range`);
    else if (vs[e[0]] !== json['pliego:edges_sheet'][i] || vs[e[1]] !== json['pliego:edges_sheet'][i]) p.push(`edge ${i} crosses sheets`);
  });
  json.faces_vertices.forEach((f, i) => {
    if (!Array.isArray(f) || f.length < 3 || f.some((v) => !(v >= 0 && v < V))) p.push(`face ${i} index out of range`);
  });
  const stocks = json['pliego:stocks'] || {};
  sheets.forEach((s, i) => { if (!stocks[s.stock]) p.push(`sheet ${i} stock "${s.stock}" unresolved`); });
  const ids = new Set(sheets.map((s) => s.id));
  for (const m of json['pliego:mechanisms'] || []) {
    for (const s of [m.sheet, ...(m.sheets_moving || [])].filter(Boolean)) if (!ids.has(s)) p.push(`mechanism ${m.id} sheet "${s}" unresolved`);
  }
  if (p.length) throw new DocumentError(p);
  return { source: json, counts: { sheets: sheets.length, vertices: V, edges: E, faces: F } };
}

// ---------- rigid transforms: {r: 3×3 row-major (9), t: [3]} ----------
const IDENT = () => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
const apply = (T, p) => [
  T.r[0] * p[0] + T.r[1] * p[1] + T.r[2] * p[2] + T.t[0],
  T.r[3] * p[0] + T.r[4] * p[1] + T.r[5] * p[2] + T.t[1],
  T.r[6] * p[0] + T.r[7] * p[1] + T.r[8] * p[2] + T.t[2],
];
const rotOnly = (T, p) => apply({ r: T.r, t: [0, 0, 0] }, p);
function compose(A, B) {            // A ∘ B
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A.r[i * 3] * B.r[j] + A.r[i * 3 + 1] * B.r[3 + j] + A.r[i * 3 + 2] * B.r[6 + j];
  return { r, t: apply(A, B.t) };
}
/** Rotation by `rad` about the line through `o` with unit direction `d` (right-hand rule). */
function axisRot(o, d, rad) {
  const c = Math.cos(rad), s = Math.sin(rad), k = 1 - c, [x, y, z] = d;
  const r = [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
  const ro = apply({ r, t: [0, 0, 0] }, o);
  return { r, t: [o[0] - ro[0], o[1] - ro[1], o[2] - ro[2]] };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function quatToR([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
/** Orthonormal frame from three non-collinear points (columns e1, e2, e3) and origin. */
function frameOf(a, b, c) {
  const e1 = unit(sub(b, a)), e3 = unit(cross(e1, sub(c, a))), e2 = cross(e3, e1);
  return { r: [e1[0], e2[0], e3[0], e1[1], e2[1], e3[1], e1[2], e2[2], e3[2]], t: a };
}
function invert(T) {
  const r = [T.r[0], T.r[3], T.r[6], T.r[1], T.r[4], T.r[7], T.r[2], T.r[5], T.r[8]];
  const t = apply({ r, t: [0, 0, 0] }, T.t);
  return { r, t: [-t[0], -t[1], -t[2]] };
}
/** Newell normal of a 3-D polygon. */
function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return unit(n);
}
const ease = (x) => x * x * (3 - 2 * x);

export class World {
  /** @param {{source: any}} doc @param {Record<string, any>} [opts] */
  constructor(doc, opts = {}) {
    const j = doc.source;
    this.opts = { substeps: 20, ...opts };
    this.capabilities = { physics: false, grab: false, kind: ENGINE_KIND };
    this._j = j;
    this._substepsRun = 0;
    this._grab = null;
    this._dirty = true;
    const V = j.vertices_coords.length;
    const sheets = j['pliego:sheets'];
    const vsheet = j['pliego:vertices_sheet'], fsheet = j['pliego:faces_sheet'];
    const initial = (j.file_frames || []).find((f) => f.frame_title === 'initial');
    this._initial = initial ? initial.vertices_coords : null;
    // Unplaced sheet-frame point of each vertex: (u, 0, −v) with local = layout − offset.
    this._unplaced = j.vertices_coords.map((p, i) => { const o = sheets[vsheet[i]].offset; return [p[0] - o[0], 0, -(p[1] - o[1])]; });
    // Edge lookup and face adjacency.
    const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    const edgeOf = new Map();
    j.edges_vertices.forEach(([a, b], e) => edgeOf.set(key(a, b), e));
    const edgeFaces = j.edges_vertices.map(() => []);
    j.faces_vertices.forEach((f, fi) => f.forEach((a, k) => {
      const b = f[(k + 1) % f.length]; const e = edgeOf.get(key(a, b));
      if (e !== undefined) edgeFaces[e].push({ face: fi, a, b });
    }));
    this._edgeFaces = edgeFaces;
    // Face tree per sheet through hinge edges.
    const F = j.faces_vertices.length;
    this._parent = new Array(F).fill(null);
    this._order = [];
    const seen = new Array(F).fill(false);
    for (let s = 0; s < sheets.length; s++) {
      const root = fsheet.indexOf(s);
      if (root < 0) continue;
      const queue = [root]; seen[root] = true;
      while (queue.length) {
        const f = queue.shift(); this._order.push(f);
        j.faces_vertices[f].forEach((a, k) => {
          const b = j.faces_vertices[f][(k + 1) % j.faces_vertices[f].length];
          const e = edgeOf.get(key(a, b));
          if (e === undefined || !HINGE_ASSIGN.has(j.edges_assignment[e])) return;
          for (const ef of edgeFaces[e]) {
            if (ef.face !== f && !seen[ef.face]) { seen[ef.face] = true; this._parent[ef.face] = { face: f, edge: e, a, b }; queue.push(ef.face); }
          }
        });
      }
    }
    // Root poses and initial fold angles.
    this._rootPose = sheets.map((sh) => ({ r: quatToR(sh.placement.rotation), t: [...sh.placement.origin] }));
    const restAngle = j['pliego:edges_restAngle'] || [];
    this._theta0 = j.edges_vertices.map((_, e) => restAngle[e] || 0);
    if (this._initial) {
      const I = this._initial;
      const nI = j.faces_vertices.map((f) => newell(f.map((v) => I[v])));
      for (let s = 0; s < sheets.length; s++) {
        const root = fsheet.indexOf(s);
        if (root < 0) continue;
        const f = j.faces_vertices[root];
        const k = this._wellShaped(f);
        const A = frameOf(...k.map((v) => this._unplaced[v])), B = frameOf(...k.map((v) => I[v]));
        this._rootPose[s] = compose(B, invert(A));
      }
      this._order.forEach((f) => {
        const par = this._parent[f]; if (!par) return;
        const axis = unit(sub(I[par.a], I[par.b]));
        const np = nI[par.face], nc = nI[f];
        this._theta0[par.edge] = Math.atan2(dot(cross(np, nc), axis), dot(np, nc)) / DEG;
      });
    }
    // Controls and sequence.
    this._controls = new Map();
    for (const c of j['pliego:controls'] || []) this._controls.set(c.id, typeof c.default === 'boolean' ? (c.default ? 1 : 0) : Number(c.default) || 0);
    this._controlKind = new Map((j['pliego:controls'] || []).map((c) => [c.id, c.kind]));
    this._yield = sheets.map((sh) => (j['pliego:stocks'][sh.stock].derived.crease_yield_deg ?? 35));
    // Render mesh: per-face vertices (flat shading), triangulated in layout space.
    const sheetBox = sheets.map((_, s) => bbox2(j.vertices_coords.filter((__, v) => vsheet[v] === s)));
    let nr = 0, nt = 0;
    const faceTris = j.faces_vertices.map((f) => { const t = triangulate(f.map((v) => j.vertices_coords[v])); nr += f.length; nt += t.length; return t; });
    this._buf = {
      positions: new Float32Array(nr * 3), normals: new Float32Array(nr * 3), uvs: new Float32Array(nr * 2),
      sheetIds: new Float32Array(nr), indices: new Uint32Array(nt * 3),
    };
    this._renderSim = new Int32Array(nr);
    this._faceBase = new Int32Array(F);
    let rv = 0, ti = 0;
    j.faces_vertices.forEach((f, fi) => {
      this._faceBase[fi] = rv;
      const s = fsheet[fi], bb = sheetBox[s];
      f.forEach((v, k) => {
        const p = j.vertices_coords[v];
        this._buf.uvs[(rv + k) * 2] = bb.w ? (p[0] - bb.x0) / bb.w : 0;
        this._buf.uvs[(rv + k) * 2 + 1] = bb.h ? (p[1] - bb.y0) / bb.h : 0;
        this._buf.sheetIds[rv + k] = s;
        this._renderSim[rv + k] = v;
      });
      for (const t of faceTris[fi]) { this._buf.indices[ti++] = rv + t[0]; this._buf.indices[ti++] = rv + t[1]; this._buf.indices[ti++] = rv + t[2]; }
      rv += f.length;
    });
    this.positions = new Float64Array(V * 3);
    this._faceT = new Array(F);
    this._pose();
  }

  _wellShaped(f) {
    // Pick three vertices of the face spanning the largest triangle (robust frame).
    let best = [f[0], f[1], f[2]], area = -1;
    const P = this._unplaced;
    for (let i = 1; i < f.length - 1; i++) {
      const a = cross(sub(P[f[i]], P[f[0]]), sub(P[f[i + 1]], P[f[0]]));
      const ar = Math.hypot(...a);
      if (ar > area) { area = ar; best = [f[0], f[i], f[i + 1]]; }
    }
    return best;
  }

  /** Fold angle per edge (degrees) from the sequence control. */
  _angles() {
    const j = this._j;
    const theta = [...this._theta0];
    const seq = j['pliego:sequence'];
    const seqId = [...this._controlKind].find(([, k]) => k === 'sequence');
    if (!seq || !seqId) return theta;
    const s = Math.max(0, Math.min(seq.steps.length, this._controls.get(seqId[0]) || 0));
    const esheet = j['pliego:edges_sheet'];
    const relaxed = (e, x) => { const y = this._yield[esheet[e]]; return Math.sign(x) * Math.max(0, Math.abs(x) - y); };
    for (let k = 0; k < seq.steps.length && k < s; k++) {
      const step = seq.steps[k];
      const frac = Math.min(1, s - k);
      const t = ease(frac);
      for (const [e, target] of step.targets) theta[e] = theta[e] + (target - theta[e]) * t;
      for (const e of step.release || []) theta[e] = theta[e] + (relaxed(e, theta[e]) - theta[e]) * t;
    }
    return theta;
  }

  /** Whole-sheet mechanism transforms (world space, applied after the face-tree pose). */
  _mechanisms(treeRoot) {
    const j = this._j;
    const sheets = j['pliego:sheets'];
    const idx = new Map(sheets.map((s, i) => [s.id, i]));
    const M = sheets.map(() => IDENT());
    for (const m of j['pliego:mechanisms'] || []) {
      if (m.type === 'hinge') {
        const v = this._controls.get(m.angle_control) ?? m.rest;
        const T = axisRot(m.axis.origin, unit(m.axis.direction), (v - m.rest) * DEG);
        for (const id of m.sheets_moving) M[idx.get(id)] = compose(T, M[idx.get(id)]);
      } else if (m.type === 'leaf') {
        const s = idx.get(m.sheet), off = sheets[s].offset;
        const v = this._controls.get(m.control) || 0;
        const p0 = apply(treeRoot[s], [m.spine[0][0], 0, -m.spine[0][1]]), p1 = apply(treeRoot[s], [m.spine[1][0], 0, -m.spine[1][1]]);
        const pts = j.vertices_coords.filter((_, i) => j['pliego:vertices_sheet'][i] === s);
        const c = pts.reduce((a, p) => [a[0] + (p[0] - off[0]) / pts.length, a[1] + (p[1] - off[1]) / pts.length], [0, 0]);
        const d = [m.spine[1][0] - m.spine[0][0], m.spine[1][1] - m.spine[0][1]];
        const side = d[0] * (c[1] - m.spine[0][1]) - d[1] * (c[0] - m.spine[0][0]);   // > 0: leaf on the left
        M[s] = compose(axisRot(p0, unit(sub(p1, p0)), (side > 0 ? 1 : -1) * v * DEG), M[s]);
      } else if (m.type === 'rotate') {
        const cs = idx.get(m.center.sheet);
        const o = apply(treeRoot[cs], [m.center.at[0], 0, -m.center.at[1]]);
        const n = unit(rotOnly(treeRoot[cs], [0, 1, 0]));
        const T = axisRot(o, n, (this._controls.get(m.control) || 0) * DEG);
        for (const id of m.sheets_moving) M[idx.get(id)] = compose(T, M[idx.get(id)]);
      }
      // `slide` needs the physics engine (slider joins); the stub leaves it static.
    }
    return M;
  }

  _pose() {
    const j = this._j;
    const theta = this._angles();
    const fsheet = j['pliego:faces_sheet'];
    const U = this._unplaced;
    for (const f of this._order) {
      const par = this._parent[f];
      if (!par) { this._faceT[f] = this._rootPose[fsheet[f]]; continue; }
      const o = U[par.a], d = unit(sub(U[par.a], U[par.b]));
      this._faceT[f] = compose(this._faceT[par.face], axisRot(o, d, theta[par.edge] * DEG));
    }
    const M = this._mechanisms(this._rootPose);
    const { positions: P, normals: N } = this._buf;
    const written = new Uint8Array(U.length);
    j.faces_vertices.forEach((f, fi) => {
      const T = compose(M[fsheet[fi]], this._faceT[fi] || this._rootPose[fsheet[fi]]);
      const n = rotOnly(T, [0, 1, 0]);
      const base = this._faceBase[fi];
      f.forEach((v, k) => {
        const w = apply(T, U[v]);
        const r = (base + k) * 3;
        P[r] = w[0]; P[r + 1] = w[1]; P[r + 2] = w[2];
        N[r] = n[0]; N[r + 1] = n[1]; N[r + 2] = n[2];
        if (!written[v]) { written[v] = 1; this.positions[v * 3] = w[0]; this.positions[v * 3 + 1] = w[1]; this.positions[v * 3 + 2] = w[2]; }
      });
    });
    this._dirty = false;
  }

  /** @param {string} id @param {number|boolean} value */
  setControl(id, value) {
    if (!this._controls.has(id)) throw new Error(`unknown control "${id}"`);
    this._controls.set(id, typeof value === 'boolean' ? (value ? 1 : 0) : Number(value));
    this._dirty = true;
  }

  /** Advances whole 60 Hz frames (no physics in the stub; keeps the substep counter honest). */
  step(frameDt = 1 / 60) {
    const frames = Math.max(1, Math.round(frameDt * 60));
    this._substepsRun += frames * this.opts.substeps;
    if (this._dirty) this._pose();
  }

  render() {
    if (this._dirty) this._pose();
    return this._buf;
  }

  grab(vertex, point) { this._grab = { vertex, point }; return false; }
  moveGrab(point) { if (this._grab) this._grab.point = point; }
  release() { this._grab = null; }

  /** Möller–Trumbore against the render mesh. */
  pick(origin, dir) {
    const { positions: P, indices: I, sheetIds: S } = this.render();
    let best = null, bestT = Infinity;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const pv = cross(dir, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tv = [origin[0] - P[a], origin[1] - P[a + 1], origin[2] - P[a + 2]];
      const u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1), v = dot(dir, qv) * inv; if (v < 0 || u + v > 1) continue;
      const dist = dot(e2, qv) * inv;
      if (dist > 1e-6 && dist < bestT) {
        bestT = dist;
        const corner = u > 0.5 ? I[t + 1] : v > 0.5 ? I[t + 2] : I[t];
        best = { vertex: this._renderSim[corner], triangle: t / 3, point: [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist], sheet: S[I[t]] };
      }
    }
    return best;
  }

  stats() {
    return { maxStrain: 0, energy: { stretch: 0, bend: 0, crease: 0 }, contacts: 0, substepsRun: this._substepsRun };
  }

  snapshot() { return { controls: [...this._controls], substepsRun: this._substepsRun }; }
  restore(snap) { this._controls = new Map(snap.controls); this._substepsRun = snap.substepsRun; this._dirty = true; }
}
