// @ts-check
// Engine stub — the studio's test double for @pliego/engine (docs/strategy/engine.md §5).
//
// Same public surface as the real engine (loadDocument, World with setControl/step/render/grab/
// moveGrab/release/pick/stats/snapshot/restore) but NO physics: a rigid face-tree pose driven by
// the fold program and by hinge / leaf / rotate mechanisms; excess pieces a step removes (spec §5.8)
// lift away and disappear. A sheet's presentation (spec §5.16) picks the face held still and an
// end transform; a ground clamp keeps the posed paper above the table (y = 0). The studio uses it only when
// /engine/index.js is absent or has no World, and says so in the status bar. Node tests use it as
// the WebGL-less contract double.

import { triangulate, bbox2 } from './geom.js';
import { keyedOutput, glueLocks, lockedAt } from './stub-joins.js';

export { keyedOutput };

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
  checkPieces(json, sheets, F, p);
  if (p.length) throw new DocumentError(p);
  return { source: json, counts: { sheets: sheets.length, vertices: V, edges: E, faces: F } };
}

/** Spec §5.8 references: pieces on existing sheets and faces, no shared face, removals of excess pieces once. */
function checkPieces(json, sheets, F, p) {
  const pieces = json['pliego:pieces'];
  const steps = (json['pliego:sequence'] || {}).steps || [];
  const sheetIndex = new Map(sheets.map((s, i) => [s.id, i]));
  const byId = new Map(), owner = new Map();
  if (pieces !== undefined && !Array.isArray(pieces)) { p.push('pliego:pieces is not an array'); return; }
  for (const pc of pieces || []) {
    if (!pc || typeof pc.id !== 'string' || byId.has(pc.id)) { p.push(`piece ${pc && pc.id} id missing or duplicate`); continue; }
    byId.set(pc.id, pc);
    const s = sheetIndex.get(pc.sheet);
    if (s === undefined) { p.push(`piece ${pc.id} sheet "${pc.sheet}" unresolved`); continue; }
    if (pc.role !== 'keep' && pc.role !== 'excess') p.push(`piece ${pc.id} role "${pc.role}" is not keep/excess`);
    if (!Array.isArray(pc.faces) || !pc.faces.length) { p.push(`piece ${pc.id} has no faces`); continue; }
    for (const f of pc.faces) {
      if (!(Number.isInteger(f) && f >= 0 && f < F)) p.push(`piece ${pc.id} face ${f} out of range`);
      else if (json['pliego:faces_sheet'][f] !== s) p.push(`piece ${pc.id} face ${f} is not on sheet "${pc.sheet}"`);
      else if (owner.has(f)) p.push(`face ${f} is in pieces ${owner.get(f)} and ${pc.id}`);
      else owner.set(f, pc.id);
    }
  }
  const removed = new Set();
  for (const st of steps) {
    for (const id of st.remove || []) {
      const pc = byId.get(id);
      if (!pc) p.push(`step ${st.id} removes unknown piece "${id}"`);
      else if (pc.role !== 'excess') p.push(`step ${st.id} removes "${id}", a ${pc.role} piece`);
      else if (removed.has(id)) p.push(`step ${st.id} removes "${id}" twice`);
      else removed.add(id);
    }
  }
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
/** Rotation `q` (unit quaternion [x, y, z, w]) scaled to fraction `w` of its angle. */
function slerpFromIdentity(q, w) {
  let [x, y, z, s] = q;
  if (s < 0) { x = -x; y = -y; z = -z; s = -s; }
  const half = Math.acos(Math.min(1, s)), sh = Math.sin(half);
  if (sh < 1e-12) return [0, 0, 0, 1];
  const k = Math.sin(w * half) / sh;
  return [x * k, y * k, z * k, Math.cos(w * half)];
}
/** Spec §5.16: the face a sheet's preview holds still (presentation.root_face, else its first face). */
function rootFace(j, s) {
  const pr = j['pliego:sheets'][s].presentation, fs = j['pliego:faces_sheet'];
  const f = pr && pr.root_face;
  return Number.isInteger(f) && f >= 0 && f < fs.length && fs[f] === s ? f : fs.indexOf(s);
}
const ease = (x) => x * x * (3 - 2 * x);
// A removed piece lifts through the first LIFT_END of its step, then disappears.
const LIFT_END = 0.75;
// Fully folded layers are drawn this far from flat (a 75 mm flap opens ~0.7 mm): coplanar layers
// would z-fight, and real paper has thickness anyway.
const FLAT_MAX = 179.5;

export class World {
  /** @param {{source: any}} doc @param {Record<string, any>} [opts] */
  constructor(doc, opts = {}) {
    const j = doc.source;
    this.opts = { substeps: 20, ...opts };
    this.capabilities = { physics: false, grab: false, pieces: true, kind: ENGINE_KIND };
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
    this._root = sheets.map((_, s) => rootFace(j, s));
    for (let s = 0; s < sheets.length; s++) {
      const root = this._root[s];
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
    this._glueLocks = glueLocks(j, this._parent);
    // Root poses and initial fold angles.
    this._rootPose = sheets.map((sh) => ({ r: quatToR(sh.placement.rotation), t: [...sh.placement.origin] }));
    const restAngle = j['pliego:edges_restAngle'] || [];
    this._theta0 = j.edges_vertices.map((_, e) => restAngle[e] || 0);
    if (this._initial) {
      const I = this._initial;
      const nI = j.faces_vertices.map((f) => newell(f.map((v) => I[v])));
      for (let s = 0; s < sheets.length; s++) {
        const root = this._root[s];
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
        const th = Math.atan2(dot(cross(np, nc), axis), dot(np, nc)) / DEG;
        // a crease folded flat in the initial frame (faces stacked, normals opposite) has no
        // side of its own there: it takes its design assignment's (valley +, mountain −)
        const design = j.edges_foldAngle[par.edge];
        this._theta0[par.edge] = Math.abs(Math.abs(th) - 180) < 1e-3 && design ? 180 * Math.sign(design) : th;
      });
    }
    // Controls and sequence.
    this._controls = new Map();
    for (const c of j['pliego:controls'] || []) this._controls.set(c.id, typeof c.default === 'boolean' ? (c.default ? 1 : 0) : Number(c.default) || 0);
    this._controlKind = new Map((j['pliego:controls'] || []).map((c) => [c.id, c.kind]));
    this._yield = sheets.map((sh) => (j['pliego:stocks'][sh.stock].derived.crease_yield_deg ?? 35));
    // Render mesh: per-face vertices (flat shading), triangulated in layout space.
    const sheetBox = sheets.map((_, s) => bbox2(j.vertices_coords.filter((__, v) => vsheet[v] === s)));
    this._removal(j, sheetBox);
    let nr = 0, nt = 0;
    const faceTris = j.faces_vertices.map((f) => { const t = triangulate(f.map((v) => j.vertices_coords[v])); nr += f.length; nt += t.length; return t; });
    this._buf = {
      positions: new Float32Array(nr * 3), normals: new Float32Array(nr * 3), uvs: new Float32Array(nr * 2),
      sheetIds: new Float32Array(nr), indices: new Uint32Array(nt * 3),
    };
    this._renderSim = new Int32Array(nr);
    this._faceBase = new Int32Array(F);
    let rv = 0;
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
      rv += f.length;
    });
    // Triangles of faces that stay come first, then faces removed by the last step … the first, so
    // the visible triangles are always a prefix of the index buffer.
    let ti = 0;
    const nS = this._nRemoveSteps, groupEnd = new Int32Array(nS + 1).fill(-1);   // groupEnd[nS]: faces that stay
    for (const fi of this._faceOrder) {
      const base = this._faceBase[fi];
      for (const t of faceTris[fi]) { this._buf.indices[ti++] = base + t[0]; this._buf.indices[ti++] = base + t[1]; this._buf.indices[ti++] = base + t[2]; }
      const k = this._faceStep[fi];
      groupEnd[k < 0 ? nS : k] = ti;
    }
    // visibleEnd[h]: end of the visible prefix once the first h steps' pieces are gone.
    this._visibleEnd = new Int32Array(nS + 1);
    this._visibleEnd[nS] = Math.max(0, groupEnd[nS]);
    for (let k = nS - 1; k >= 0; k--) this._visibleEnd[k] = groupEnd[k] >= 0 ? groupEnd[k] : this._visibleEnd[k + 1];
    this._allIndices = this._buf.indices;
    this._hiddenSteps = 0;
    this.hiddenEdges = new Uint8Array(j.edges_vertices.length);
    this.positions = new Float64Array(V * 3);
    this._faceT = new Array(F);
    this._pose();
  }

  /** Removal schedule (spec §5.8): the sequence step that takes each face's piece away, or −1. */
  _removal(j, sheetBox) {
    const F = j.faces_vertices.length;
    const seq = j['pliego:sequence'];
    const steps = seq ? seq.steps : [];
    const stepOf = new Map();
    steps.forEach((st, k) => { for (const id of st.remove || []) stepOf.set(id, k); });
    this._faceStep = new Int32Array(F).fill(-1);
    this._facePull = new Array(F).fill(null);
    for (const pc of j['pliego:pieces'] || []) {
      const k = stepOf.get(pc.id);
      if (k === undefined) continue;
      for (const f of pc.faces) { this._faceStep[f] = k; this._facePull[f] = pc.pull ? unit(pc.pull) : null; }
    }
    this._nRemoveSteps = steps.length;
    const removes = this._faceStep.some((k) => k >= 0);
    const order = [...Array(F).keys()];
    const rank = (f) => (this._faceStep[f] < 0 ? Infinity : this._faceStep[f]);
    if (removes) order.sort((a, b) => (rank(a) === rank(b) ? a - b : rank(a) > rank(b) ? -1 : 1));
    this._faceOrder = order;
    this._lift = Math.max(10, 0.25 * Math.max(...sheetBox.map((b) => Math.hypot(b.w, b.h))));
    // An overlay edge disappears once every face along it is gone.
    const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    const edgeOf = new Map();
    j.edges_vertices.forEach(([a, b], e) => edgeOf.set(key(a, b), e));
    this._edgeStep = new Float64Array(j.edges_vertices.length).fill(-2);   // −2: no face yet; ∞: a face stays
    j.faces_vertices.forEach((f, fi) => f.forEach((a, k) => {
      const e = edgeOf.get(key(a, f[(k + 1) % f.length]));
      if (e === undefined) return;
      const s = this._faceStep[fi] < 0 ? Infinity : this._faceStep[fi], cur = this._edgeStep[e];
      this._edgeStep[e] = cur === -2 ? s : Math.max(cur, s);
    }));
  }

  /** Sequence position (0…N steps) or 0 when the document has no program. */
  _seqValue() {
    const seqId = [...this._controlKind].find(([, k]) => k === 'sequence');
    return seqId ? (this._controls.get(seqId[0]) || 0) : 0;
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

  /**
   * Fold angle per edge (degrees) from the sequence control. Plasticity is approximated without
   * rates: a crease driven further than its stock's yield angle from its rest angle drags the rest
   * angle along, and a released crease (physical mode) returns to that rest angle — fold, open and
   * let go leaves the crease memory of spec §5.6. Kinematic mode leaves a released crease where it
   * is. Display angles stop just short of flat (FLAT_MAX) so stacked layers never share a plane.
   */
  _angles() {
    const j = this._j;
    const theta = [...this._theta0];
    const seq = j['pliego:sequence'];
    const seqId = [...this._controlKind].find(([, k]) => k === 'sequence');
    if (seq && seqId) {
      const s = Math.max(0, Math.min(seq.steps.length, this._controls.get(seqId[0]) || 0));
      const esheet = j['pliego:edges_sheet'];
      const rest = [...this._theta0];
      const physical = seq.mode !== 'kinematic';
      for (let k = 0; k < seq.steps.length && k < s; k++) {
        const step = seq.steps[k];
        const t = ease(Math.min(1, s - k));
        for (const [e, target] of step.targets) {
          theta[e] = theta[e] + (target - theta[e]) * t;
          const y = this._yield[esheet[e]], d = theta[e] - rest[e];
          if (Math.abs(d) > y) rest[e] = theta[e] - Math.sign(d) * y;
        }
        if (physical) for (const e of step.release || []) if (!lockedAt(this._glueLocks, e, k)) theta[e] = theta[e] + (rest[e] - theta[e]) * t;
      }
    }
    return theta.map((x) => Math.max(-FLAT_MAX, Math.min(FLAT_MAX, x)));
  }

  /**
   * Whole-sheet mechanism transforms (world space, applied after the face-tree pose). Keys map a
   * control value to the mechanism's output and `ride` composes with the ridden mechanism (spec
   * §5.18, mirrored from the engine's keyed.js).
   */
  _mechanisms(treeRoot) {
    const j = this._j;
    const sheets = j['pliego:sheets'];
    const idx = new Map(sheets.map((s, i) => [s.id, i]));
    const M = sheets.map(() => IDENT());
    const mechs = j['pliego:mechanisms'] || [];
    const byId = new Map(mechs.map((m) => [m.id, m]));
    const memo = new Map();
    const tf = (m, depth = 0) => {
      if (memo.has(m.id)) return memo.get(m.id);
      let T = IDENT();
      if (m.type === 'hinge') {
        const v = keyedOutput(m, this._controls.get(m.angle_control) ?? m.rest);
        T = axisRot(m.axis.origin, unit(m.axis.direction), (v - m.rest) * DEG);
      } else if (m.type === 'rotate') {
        const cs = idx.get(m.center.sheet);
        const o = apply(treeRoot[cs], [m.center.at[0], 0, -m.center.at[1]]);
        const n = unit(rotOnly(treeRoot[cs], [0, 1, 0]));
        T = axisRot(o, n, keyedOutput(m, this._controls.get(m.control) || 0) * DEG);
      } else if (m.type === 'translate') {
        const ctl = (j['pliego:controls'] || []).find((c) => c.id === m.control);
        const max = ctl && ctl.max ? ctl.max : 1;
        const v = this._controls.get(m.control) || 0;
        const d = unit(m.direction), k = m.keys ? keyedOutput(m, v) : (v / max) * m.travel;
        T = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [d[0] * k, d[1] * k, d[2] * k] };
      }
      const r = m.ride !== undefined ? byId.get(m.ride) : null;
      if (r && depth < mechs.length) T = compose(tf(r, depth + 1), T);
      memo.set(m.id, T);
      return T;
    };
    for (const m of mechs) {
      if (m.type === 'hinge' || m.type === 'rotate' || m.type === 'translate') {
        const T = tf(m);
        for (const id of m.sheets_moving || []) M[idx.get(id)] = compose(T, M[idx.get(id)]);
      } else if (m.type === 'leaf') {
        const s = idx.get(m.sheet), off = sheets[s].offset;
        const v = keyedOutput(m, this._controls.get(m.control) || 0);
        const p0 = apply(treeRoot[s], [m.spine[0][0], 0, -m.spine[0][1]]), p1 = apply(treeRoot[s], [m.spine[1][0], 0, -m.spine[1][1]]);
        const pts = j.vertices_coords.filter((_, i) => j['pliego:vertices_sheet'][i] === s);
        const c = pts.reduce((a, p) => [a[0] + (p[0] - off[0]) / pts.length, a[1] + (p[1] - off[1]) / pts.length], [0, 0]);
        const d = [m.spine[1][0] - m.spine[0][0], m.spine[1][1] - m.spine[0][1]];
        const side = d[0] * (c[1] - m.spine[0][1]) - d[1] * (c[0] - m.spine[0][0]);   // > 0: leaf on the left
        M[s] = compose(axisRot(p0, unit(sub(p1, p0)), (side > 0 ? 1 : -1) * v * DEG), M[s]);
      }
      // `slide` and driven pins need the physics engine (joins); the stub leaves them static.
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
    const Pr = this._presentation();
    const { positions: P, normals: N } = this._buf;
    const written = new Uint8Array(U.length);
    const sv = this._seqValue();
    const hidden = this._nRemoveSteps ? Math.max(0, Math.min(this._nRemoveSteps, Math.floor(sv - LIFT_END) + 1)) : 0;
    if (hidden !== this._hiddenSteps || this._buf.indices.length !== this._visibleEnd[hidden]) {
      this._hiddenSteps = hidden;
      this._buf.indices = this._allIndices.subarray(0, this._visibleEnd[hidden]);
      for (let e = 0; e < this.hiddenEdges.length; e++) this.hiddenEdges[e] = this._edgeStep[e] >= 0 && this._edgeStep[e] < hidden ? 1 : 0;
    }
    for (const fi of this._faceOrder) {
      const f = j.faces_vertices[fi];
      let T = compose(Pr[fsheet[fi]], compose(M[fsheet[fi]], this._faceT[fi] || this._rootPose[fsheet[fi]]));
      const k = this._faceStep[fi];
      if (k >= 0 && sv > k && sv - k < LIFT_END) {   // hidden pieces keep their rest pose (stable bounds)
        const lift = this._lift * ease(Math.min(1, (sv - k) / LIFT_END));
        const d = this._facePull[fi] || unit(rotOnly(this._rootPose[fsheet[fi]], [0, 1, 0]));
        T = compose({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [d[0] * lift, d[1] * lift, d[2] * lift] }, T);
      }
      const n = rotOnly(T, [0, 1, 0]);
      const base = this._faceBase[fi];
      f.forEach((v, k) => {
        const w = apply(T, U[v]);
        const r = (base + k) * 3;
        P[r] = w[0]; P[r + 1] = w[1]; P[r + 2] = w[2];
        N[r] = n[0]; N[r + 1] = n[1]; N[r + 2] = n[2];
        if (!written[v]) { written[v] = 1; this.positions[v * 3] = w[0]; this.positions[v * 3 + 1] = w[1]; this.positions[v * 3 + 2] = w[2]; }
      });
    }
    this._groundClamp();
    this._dirty = false;
  }

  /**
   * Spec §5.16 presentation: per sheet, the `end` transform blended in over the program
   * (identity at step 0, `end` at the last step), rotating about the root face's t = 0 centroid.
   * Preview only.
   */
  _presentation() {
    const j = this._j;
    const sheets = j['pliego:sheets'];
    const seq = j['pliego:sequence'];
    const n = seq && seq.steps ? seq.steps.length : 0;
    const w = n ? Math.max(0, Math.min(1, this._seqValue() / n)) : 0;
    return sheets.map((sh, s) => {
      const end = sh.presentation && sh.presentation.end;
      if (!end || !w || this._root[s] < 0) return IDENT();
      const f = j.faces_vertices[this._root[s]];
      const c = f.map((v) => apply(this._rootPose[s], this._unplaced[v])).reduce((a, p) => [a[0] + p[0] / f.length, a[1] + p[1] / f.length, a[2] + p[2] / f.length], [0, 0, 0]);
      const r = quatToR(slerpFromIdentity(end.rotation, w));
      const rc = apply({ r, t: [0, 0, 0] }, c);
      return { r, t: [c[0] + w * end.origin[0] - rc[0], c[1] + w * end.origin[1] - rc[1], c[2] + w * end.origin[2] - rc[2]] };
    });
  }

  /**
   * The table (spec §1: the ground is y = 0). A rigid face-tree preview can swing paper through
   * the table (a mountain fold on a flat sheet, an end transform); when any visible point would
   * pass below y = 0 the whole scene is lifted until its lowest point rests on it. Physics would
   * push the paper up by contact instead; `opts.ground === false` turns the clamp off.
   */
  _groundClamp() {
    if (this.opts.ground === false) return;
    const { positions: P, indices: I } = this._buf;
    let min = Infinity;
    // every visible render corner (a torn preview poses one vertex differently per face) and the
    // float64 vertex positions (the float32 render buffer rounds)
    for (let t = 0; t < I.length; t++) min = Math.min(min, P[I[t] * 3 + 1], this.positions[this._renderSim[I[t]] * 3 + 1]);
    if (!(min < 0)) { this.groundLift = 0; return; }
    const lift = -min;
    for (let i = 1; i < P.length; i += 3) P[i] += lift;
    for (let i = 1; i < this.positions.length; i += 3) this.positions[i] += lift;
    this.groundLift = lift;
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
