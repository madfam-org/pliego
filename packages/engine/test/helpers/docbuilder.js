// @ts-check
/**
 * Programmatic builder of VALID sheet documents for engine tests (the kernel lane builds the
 * authoring side in Python in parallel). Low-level API (vertices, edges, faces per sheet) plus
 * ready-made fixtures. All geometry here is authored for the tests (no third-party crease patterns).
 */
import { deriveEstimate, BUILTIN_STOCKS } from '../../src/material.js';
import { quatRotate } from '../../src/geom.js';

const L4 = (/** @type {string} */ en, /** @type {string} */ es, /** @type {string} */ fr, /** @type {string} */ pt) => ({ en, es, fr, pt });

/** Stock snapshots used by the fixtures (rsE §b estimates; the kernel's derive() is authoritative). */
export const STOCKS = {
  'copy-80': { name: L4('Copy paper 80 g/m²', 'Papel bond 80 g/m²', 'Papier ramette 80 g/m²', 'Papel sulfite 80 g/m²'), gsm: 80, caliper_mm: 0.1,
    derived: deriveEstimate({ gsm: 80, t: 0.1, Emd: 5.5e9, Ecd: 2.5e9, nu: 0.293, yieldDeg: 35, friction: 0.4, tear: 0.02, lstar: 20 }), derived_basis: 'test fixture (rsE §b)' },
  kami: BUILTIN_STOCKS.kami,
  'tissue-17': { name: L4('Tissue 17 g/m²', 'Papel de china 17 g/m²', 'Papier de soie 17 g/m²', 'Papel de seda 17 g/m²'), gsm: 17, caliper_mm: 0.04,
    derived: deriveEstimate({ gsm: 17, t: 0.04, Emd: 2.0e9, Ecd: 0.9e9, nu: 0.293, yieldDeg: 35, friction: 0.35, tear: 0.01 }), derived_basis: 'test fixture (rsE §b)' },
  'cardstock-250': { name: L4('Cardstock 250 g/m²', 'Cartulina 250 g/m²', 'Bristol 250 g/m²', 'Cartolina 250 g/m²'), gsm: 250, caliper_mm: 0.3,
    derived: deriveEstimate({ gsm: 250, t: 0.3, Emd: 4.5e9, Ecd: 2.0e9, nu: 0.293, yieldDeg: 25, friction: 0.45, tear: 0.015, lstar: 60 }), derived_basis: 'test fixture (rsE §b)' },
};

export class DocBuilder {
  constructor(title = 'test document') {
    this.title = title;
    /** @type {any[]} */ this.sheets = [];
    /** @type {number[][]} */ this.V = [];
    /** @type {number[]} */ this.vSheet = [];
    /** @type {any[]} */ this.E = [];
    /** @type {any[]} */ this.F = [];
    /** @type {any[]} */ this.joins = [];
    /** @type {any[]} */ this.mechanisms = [];
    /** @type {any[]} */ this.controls = [];
    /** @type {any} */ this.sequence = undefined;
    /** @type {((b: DocBuilder) => number[][])|null} */ this.initialFn = null;
    this.nextX = 0;
    /** @type {Set<string>} */ this.usedStocks = new Set();
  }

  /**
   * @param {{id:string, stock?:string, grain?:number, width:number, height:number, placement?:{origin:number[], rotation:number[]}, kinematic?:{mechanism:string}|null, color?:string}} o
   * @returns {number} sheet index
   */
  sheet(o) {
    const stock = o.stock ?? 'copy-80';
    this.usedStocks.add(stock);
    const offset = [this.nextX, 0];
    this.nextX += o.width + 20;
    this.sheets.push({
      id: o.id, label: L4(o.id, o.id, o.id, o.id), stock, grain_deg: o.grain ?? 90, offset,
      placement: o.placement ?? { origin: [0, 0, 0], rotation: [0, 0, 0, 1] },
      front: { color: o.color ?? '#f4efe6', art: null }, back: { color: o.color ?? '#f4efe6', art: null },
      kinematic: o.kinematic ?? null,
    });
    return this.sheets.length - 1;
  }

  /** Add a vertex in sheet-local coordinates. @param {number} s @param {number} u @param {number} v */
  vertex(s, u, v) {
    const o = this.sheets[s].offset;
    this.V.push([u + o[0], v + o[1]]);
    this.vSheet.push(s);
    return this.V.length - 1;
  }

  /** @param {number} a @param {number} b @param {string} [assignment] @param {number} [angle] @param {string} [treatment] @param {number} [rest] */
  edge(a, b, assignment = 'B', angle = 0, treatment, rest = 0) {
    const t = treatment ?? (assignment === 'M' || assignment === 'V' ? 'crease' : assignment === 'C' ? 'cut' : 'none');
    for (let i = 0; i < this.E.length; i++) {
      const e = this.E[i];
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return i;
    }
    this.E.push({ a, b, assignment, angle, treatment: t, rest, sheet: this.vSheet[a] });
    return this.E.length - 1;
  }

  /** CCW face; boundary edges are created as B automatically if missing. @param {number[]} verts */
  face(verts) {
    for (let i = 0; i < verts.length; i++) this.edge(verts[i], verts[(i + 1) % verts.length]);
    this.F.push({ verts: verts.slice(), sheet: this.vSheet[verts[0]] });
    return this.F.length - 1;
  }

  /** Mark the edge between a and b with an assignment (call after faces). */
  assign(/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ assignment, angle = 0, treatment = undefined, rest = 0) {
    const i = this.edge(a, b);
    const e = this.E[i];
    e.assignment = assignment; e.angle = angle; e.rest = rest;
    e.treatment = treatment ?? (assignment === 'M' || assignment === 'V' ? 'crease' : assignment === 'C' ? 'cut' : 'none');
    return i;
  }

  /** Rectangle sheet with one face. Returns {s, v:[4 corners]}. */
  rect(/** @type {any} */ o) {
    const s = this.sheet(o);
    const v = [this.vertex(s, 0, 0), this.vertex(s, o.width, 0), this.vertex(s, o.width, o.height), this.vertex(s, 0, o.height)];
    this.face(v);
    return { s, v };
  }

  control(/** @type {any} */ c) { this.controls.push({ label: L4(c.id, c.id, c.id, c.id), ...c }); return this; }

  build() {
    const stocks = /** @type {Record<string, any>} */ ({});
    for (const s of this.usedStocks) stocks[s] = /** @type {any} */(STOCKS)[s];
    const hasJoins = this.joins.length > 0;
    const doc = /** @type {any} */ ({
      file_spec: 1.2,
      file_creator: 'pliego-engine test docbuilder',
      file_title: this.title,
      file_classes: [this.sheets.length > 1 ? 'multiModel' : 'singleModel'],
      frame_classes: ['creasePattern'],
      frame_attributes: ['2D', this.E.some((e) => e.assignment === 'C') ? 'cuts' : 'noCuts', hasJoins ? 'joins' : 'noJoins'],
      frame_unit: 'mm',
      vertices_coords: this.V.map((p) => [round(p[0]), round(p[1])]),
      edges_vertices: this.E.map((e) => [e.a, e.b]),
      edges_assignment: this.E.map((e) => e.assignment),
      edges_foldAngle: this.E.map((e) => e.angle),
      faces_vertices: this.F.map((f) => f.verts),
      'pliego:version': 1,
      'pliego:vertices_sheet': this.vSheet.slice(),
      'pliego:edges_sheet': this.E.map((e) => e.sheet),
      'pliego:faces_sheet': this.F.map((f) => f.sheet),
      'pliego:edges_treatment': this.E.map((e) => e.treatment),
      'pliego:edges_restAngle': this.E.map((e) => e.rest),
      'pliego:sheets': this.sheets,
      'pliego:stocks': stocks,
      'pliego:meta': { cartridge: 'engine-fixture', mode: 'default', params: {}, kernel: 'pliego-engine test docbuilder', digest: null },
    });
    if (this.joins.length) doc['pliego:joins'] = this.joins;
    if (this.mechanisms.length) doc['pliego:mechanisms'] = this.mechanisms;
    if (this.controls.length) doc['pliego:controls'] = this.controls;
    if (this.sequence) doc['pliego:sequence'] = this.sequence;
    const nonIdentity = this.sheets.some((s) => s.placement.origin.some((/** @type {number} */ x) => x !== 0) || s.placement.rotation[3] !== 1);
    if (this.initialFn || hasJoins || nonIdentity) {
      const X = this.initialFn ? this.initialFn(this) : this.placedCoords();
      doc.file_frames = [{ frame_title: 'initial', frame_classes: ['foldedForm'], frame_attributes: ['3D'], frame_inherit: true, frame_parent: 0, vertices_coords: X.map((p) => p.map(round)) }];
    }
    return doc;
  }

  /** World coordinates from placements: (u, 0, −v) rotated + origin. */
  placedCoords() {
    return this.V.map((p, i) => {
      const s = this.sheets[this.vSheet[i]];
      const r = quatRotate(s.placement.rotation, [p[0] - s.offset[0], 0, -(p[1] - s.offset[1])]);
      return [r[0] + s.placement.origin[0], r[1] + s.placement.origin[1], r[2] + s.placement.origin[2]];
    });
  }

  /** Sheet-local coordinates of vertex i. @param {number} i */
  local(i) { const s = this.sheets[this.vSheet[i]]; return [this.V[i][0] - s.offset[0], this.V[i][1] - s.offset[1]]; }
}

/** @param {number} x */
function round(x) { return Math.round(x * 1e6) / 1e6 + 0; }

// ---------------------------------------------------------------- fixtures

/** Square with one valley diagonal crease and a sequence that folds it to `angle`. */
export function squareValley({ size = 100, stock = 'copy-80', angle = 180, release = true } = {}) {
  const b = new DocBuilder('square with one valley crease');
  const s = b.sheet({ id: 'square', stock, width: size, height: size });
  const v0 = b.vertex(s, 0, 0), v1 = b.vertex(s, size, 0), v2 = b.vertex(s, size, size), v3 = b.vertex(s, 0, size);
  b.face([v0, v1, v2]);
  b.face([v0, v2, v3]);
  const crease = b.assign(v0, v2, 'V', angle);
  b.control({ id: 'sequence', kind: 'sequence', min: 0, max: release ? 2 : 1, default: 0 });
  const steps = [{ id: 'valley-diagonal', label: L4('Valley-fold the diagonal', 'Doblez de valle en la diagonal', 'Pli vallée sur la diagonale', 'Dobra vale na diagonal'), duration_ms: 1500, targets: [[crease, angle]], release: [], note: null }];
  if (release) steps.push({ id: 'release', label: L4('Let go', 'Soltar', 'Lâcher', 'Soltar'), duration_ms: 1000, targets: [], release: [crease], note: null });
  b.sequence = { mode: 'physical', steps };
  return { builder: b, doc: b.build(), crease };
}

/** Straight strip along the sheet's v axis (MD when grain = 90). */
export function strip({ length = 172, width = 25, stock = 'copy-80', grain = 90, alongU = false } = {}) {
  const b = new DocBuilder('strip');
  const w = alongU ? length : width, hgt = alongU ? width : length;
  b.rect({ id: 'strip', stock, grain, width: w, height: hgt });
  return b.build();
}

/** Tissue flag: rectangle pinned along its top edge, with a wind control. */
export function tissueFlag({ width = 120, height = 80 } = {}) {
  const b = new DocBuilder('tissue flag');
  b.rect({ id: 'flag', stock: 'tissue-17', width, height, placement: { origin: [0, 300, 0], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] } });
  // rotation +90° about X maps (u,0,−v) → (u, v, 0): the flag hangs in the XY plane, top edge at v = height
  b.joins.push({ id: 'top-edge', type: 'pin', a: { sheet: 'flag', along: [[0, height], [width, height]] }, world: null });
  b.control({ id: 'wind', kind: 'wind', min: 0, max: 5, default: 0, unit: 'm/s' });
  return b.build();
}

/** A5 page leaf on a spine (left edge), lying flat; `turn` control 0…180. */
export function pageLeaf({ width = 148, height = 210, stock = 'copy-80' } = {}) {
  const b = new DocBuilder('page leaf');
  b.rect({ id: 'leaf', stock, width, height, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  b.mechanisms.push({ id: 'turn', type: 'leaf', sheet: 'leaf', spine: [[0, 0], [0, height]], control: 'turn' });
  b.control({ id: 'turn', kind: 'angle', min: 0, max: 180, default: 0, unit: 'deg' });
  return b.build();
}

/** Two square sheets stacked above the ground (for contact tests). */
export function twoSheetStack({ size = 80, gap = 6, height = 20, stock = 'copy-80' } = {}) {
  const b = new DocBuilder('two-sheet stack');
  b.rect({ id: 'lower', stock, width: size, height: size, placement: { origin: [0, height, size], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'upper', stock, width: size, height: size, placement: { origin: [10, height + gap, size + 10], rotation: [0, 0, 0, 1] } });
  return b.build();
}
