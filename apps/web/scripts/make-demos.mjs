#!/usr/bin/env node
// Generates the studio's demo sheet documents (apps/web/studio/demo/*.fold + catalog.json).
// Derive, don't curate: the files are this script's output; `--check` fails if they drift.
//
//   node apps/web/scripts/make-demos.mjs           # write
//   node apps/web/scripts/make-demos.mjs --check   # verify committed files match
//
// These are hand-authored demos for the web lane, not kernel output. Their stock snapshots follow
// the derive formulas of docs/spec/v1/stock-card.md (D = E·t³ / 12(1−ν²), crease_k = D / L*) and say
// so in `derived_basis`; real documents come from pliego.stock.derive() in the kernel.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'studio', 'demo');
const r6 = (x) => { const v = Math.round(x * 1e6) / 1e6; return Object.is(v, -0) ? 0 : v; };
const DEG = Math.PI / 180;

// ---------- stock snapshots ----------
function stock(name, gsm, caliper, Emd, Ecd, Lstar, extra) {
  const nu = 0.3;
  const k = caliper ** 3 / (12 * (1 - nu * nu));
  const Dmd = Emd * k, Dcd = Ecd * k;
  return {
    name, gsm, caliper_mm: caliper,
    derived: {
      areal_density: r6(gsm * 1e-6), thickness: caliper, E_md: Emd, E_cd: Ecd, nu,
      D_md: Number(Dmd.toPrecision(6)), D_cd: Number(Dcd.toPrecision(6)),
      crease_k: Number((Dmd / Lstar).toPrecision(6)), crease_yield_deg: 35, crease_set_rate: 0.6,
      score_factor: 0.35, perf_factor: 0.2, tear_strain: 0.015, friction: extra.friction,
      collision_thickness: caliper,
    },
    derived_basis: 'hand-written demo snapshot (apps/web/scripts/make-demos.mjs); stock-card.md formulas, not pliego.stock.derive output',
  };
}
const STOCKS = {
  kami: stock({ en: 'Kami 63 g/m²', es: 'Papel kami 63 g/m²', fr: 'Papier kami 63 g/m²', pt: 'Papel kami 63 g/m²' },
    63, 0.08, 5.0e9, 2.5e9, 5, { friction: 0.4 }),
  'cardstock-250': stock({ en: 'Cardstock 250 g/m²', es: 'Cartulina 250 g/m²', fr: 'Bristol 250 g/m²', pt: 'Cartolina 250 g/m²' },
    250, 0.30, 6.0e9, 3.0e9, 5, { friction: 0.45 }),
};

// ---------- small vector helpers ----------
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const area2 = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
/** Newell normal of a 3-D polygon (front normal when the polygon is CCW in layout). */
function newell(pts) {
  const n = [0, 0, 0];
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); });
  return norm(n);
}
/**
 * FOLD signed fold angle (valley +) across edge a→b, where a→b is the edge in the parent face's
 * CCW order: the child is the parent rotated about (a − b) by +θ.
 */
function foldAngle(nParent, nChild, a3, b3) {
  const axis = norm(sub(a3, b3));
  return Math.atan2(dot(cross(nParent, nChild), axis), dot(nParent, nChild)) / DEG;
}

// ---------- document assembly ----------
/**
 * sheets: [{ meta (pliego:sheets entry), verts: [[u,v]...] local, edges: [[i,j,assign,treat,angle]],
 *            faces: [[i...]], world?: [[x,y,z]...] }]
 */
function assemble({ title, sheets, joins, mechanisms, controls, sequence, meta, needsInitial }) {
  const doc = {
    file_spec: 1.2, file_creator: 'pliego-web demo generator 0.1.0', file_title: title,
    file_classes: [sheets.length > 1 ? 'multiModel' : 'singleModel'],
    frame_classes: ['creasePattern'], frame_attributes: [], frame_unit: 'mm',
    vertices_coords: [], edges_vertices: [], edges_assignment: [], edges_foldAngle: [], faces_vertices: [],
    'pliego:version': 1, 'pliego:vertices_sheet': [], 'pliego:edges_sheet': [], 'pliego:faces_sheet': [],
    'pliego:edges_treatment': [], 'pliego:sheets': [], 'pliego:stocks': {},
  };
  const frame3 = [];
  sheets.forEach((sh, si) => {
    const base = doc.vertices_coords.length;
    const off = sh.meta.offset;
    sh.verts.forEach((p, i) => {
      doc.vertices_coords.push([r6(p[0] + off[0]), r6(p[1] + off[1])]);
      doc['pliego:vertices_sheet'].push(si);
      const w = sh.world ? sh.world[i] : placeFlat(sh.meta, p);
      frame3.push(w.map(r6));
    });
    for (const [i, j, as, tr, ang] of sh.edges) {
      doc.edges_vertices.push([base + i, base + j]); doc.edges_assignment.push(as);
      doc.edges_foldAngle.push(r6(ang || 0)); doc['pliego:edges_treatment'].push(tr);
      doc['pliego:edges_sheet'].push(si);
    }
    for (const f of sh.faces) {
      if (area2(f.map((i) => sh.verts[i])) <= 0) throw new Error(`${title}: face ${f} of ${sh.meta.id} is not CCW`);
      doc.faces_vertices.push(f.map((i) => base + i)); doc['pliego:faces_sheet'].push(si);
    }
    doc['pliego:sheets'].push(sh.meta);
    doc['pliego:stocks'][sh.meta.stock] = STOCKS[sh.meta.stock];
  });
  const hasCuts = doc.edges_assignment.includes('C');
  doc.frame_attributes = ['2D', hasCuts ? 'cuts' : 'noCuts', 'noJoins'];
  if (needsInitial) {
    doc.file_frames = [{ frame_title: 'initial', frame_classes: ['foldedForm'], frame_attributes: ['3D'],
      frame_parent: 0, frame_inherit: true, vertices_coords: frame3 }];
  }
  if (joins) doc['pliego:joins'] = joins;
  if (mechanisms) doc['pliego:mechanisms'] = mechanisms;
  doc['pliego:controls'] = controls;
  if (sequence) doc['pliego:sequence'] = sequence;
  doc['pliego:meta'] = { ...meta, kernel: 'none (hand-authored demo, apps/web)', digest: null };
  return doc;
}

/** Quaternion [x,y,z,w] rotate. */
function qrot(q, v) {
  const [x, y, z, w] = q; const u = [x, y, z];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, w)), cross(u, t));
}
function placeFlat(meta, [u, v]) {
  return add(qrot(meta.placement.rotation, [u, 0, -v]), meta.placement.origin);
}

const sheetMeta = (id, label, stockId, offset, origin, color, kinematic = null, back = color) => ({
  id, label, stock: stockId, grain_deg: 90, offset, placement: { origin, rotation: [0, 0, 0, 1] },
  front: { color, art: null }, back: { color: back, art: null }, kinematic,
});
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const boundary = (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n, 'B', 'none', 0]);

// ---------- demo 1: the pliego (a sheet folded in the middle) ----------
function pliego() {
  const W = 200, H = 140;
  const verts = [[0, 0], [W / 2, 0], [W, 0], [W, H], [W / 2, H], [0, H]];
  const edges = [...boundary(6), [1, 4, 'V', 'crease', 180]];
  return assemble({
    title: 'Pliego — a sheet folded in the middle',
    sheets: [{ meta: sheetMeta('sheet', { en: 'Sheet', es: 'Pliego', fr: 'Feuille', pt: 'Folha' }, 'kami', [0, 0], [-W / 2, 0, H / 2], '#f4efe6', null, '#d9c9a8'),
      verts, edges, faces: [[0, 1, 4, 5], [1, 2, 3, 4]] }],
    controls: [{ id: 'fold', kind: 'sequence', label: { en: 'Fold program', es: 'Secuencia de plegado', fr: 'Séquence de pliage', pt: 'Sequência de dobra' }, min: 0, max: 2, default: 0 }],
    sequence: { mode: 'physical', steps: [
      { id: 'lift-half', label: { en: 'Lift the right half over the crease', es: 'Levanta la mitad derecha sobre el doblez', fr: 'Relevez la moitié droite au-dessus du pli', pt: 'Levante a metade direita sobre o vinco' },
        duration_ms: 1500, targets: [[6, 90]], release: [], note: null },
      { id: 'fold-flat', label: { en: 'Bring the edges together and press the fold flat', es: 'Junta los bordes y asienta el doblez', fr: 'Joignez les bords et marquez le pli à plat', pt: 'Junte as bordas e assente a dobra' },
        duration_ms: 1500, targets: [[6, 180]], release: [], note: { en: 'This is a pliego: one fold, four pages.', es: 'Esto es un pliego: un doblez, cuatro páginas.', fr: 'Voici un pliego : un pli, quatre pages.', pt: 'Isto é um pliego: uma dobra, quatro páginas.' } },
    ] },
    meta: { cartridge: 'pliego-half-fold', mode: 'default', params: { width: W, height: H } },
    needsInitial: false,
  });
}

// ---------- demo 2: a page leaf turning on its spine ----------
function pageLeaf() {
  const SW = 280, SH = 200, LW = 138, LH = 196;
  const spread = sheetMeta('spread', { en: 'Spread', es: 'Doble página', fr: 'Double page', pt: 'Página dupla' }, 'cardstock-250', [0, 0], [-SW / 2, 0, SH / 2], '#efe6d2');
  const leaf = sheetMeta('leaf', { en: 'Leaf', es: 'Hoja', fr: 'Feuillet', pt: 'Folha' }, 'kami', [SW + 20, 0], [0, 0.4, LH / 2], '#fbf8f1', null, '#f1ead9');
  return assemble({
    title: 'Page turn — one leaf on a spine',
    sheets: [
      { meta: spread, verts: rect(SW, SH), edges: boundary(4), faces: [[0, 1, 2, 3]] },
      { meta: leaf, verts: rect(LW, LH), edges: boundary(4), faces: [[0, 1, 2, 3]] },
    ],
    joins: [
      { id: 'spread-spine', type: 'pin', a: { sheet: 'spread', along: [[SW / 2, 0], [SW / 2, SH]] }, world: null },
      { id: 'leaf-spine', type: 'pin', a: { sheet: 'leaf', along: [[0, 0], [0, LH]] }, world: null },
    ],
    mechanisms: [{ id: 'page-turn', type: 'leaf', sheet: 'leaf', spine: [[0, 0], [0, LH]], control: 'turn' }],
    controls: [{ id: 'turn', kind: 'angle', label: { en: 'Turn the page', es: 'Pasar la hoja', fr: 'Tourner la page', pt: 'Virar a página' }, min: 0, max: 180, default: 0, unit: 'deg' }],
    meta: { cartridge: 'page-turn', mode: 'default', params: { leaf_width: LW, leaf_height: LH } },
    needsInitial: true,
  });
}

// ---------- demo 3: V-fold pop-up card ----------
function vFold() {
  const BW = 100, BH = 140, T = 0.30;            // board size, cardstock caliper
  const ALPHA = 45 * DEG, BETA = 60 * DEG;       // glue-line angle to the gutter; panel angle in the piece
  const GAMMA = Math.acos(Math.cos(BETA) / Math.cos(ALPHA));   // rise of the centre crease (45°)
  const A = 50, P = 60, TAB = 10, INSET = 4, Z0 = 40;
  // Piece layout (local): O at the bottom of the centre crease.
  const c = A * Math.sin(BETA) + TAB + 2;
  const O = [c, TAB + 2], Pp = [c, TAB + 2 + P];
  const AL = add(O, mul([-Math.sin(BETA), Math.cos(BETA)], A));
  const AR = add(O, mul([Math.sin(BETA), Math.cos(BETA)], A));
  const eL = norm(sub(AL, O)), eR = norm(sub(AR, O));
  const outL = [-eL[1], eL[0]], outR = [eR[1], -eR[0]];   // away from P
  const TL1 = add(add(O, mul(outL, TAB)), mul(eL, INSET)), TL2 = add(add(AL, mul(outL, TAB)), mul(eL, -INSET));
  const TR1 = add(add(O, mul(outR, TAB)), mul(eR, INSET)), TR2 = add(add(AR, mul(outR, TAB)), mul(eR, -INSET));
  // indices: 0 O, 1 P, 2 AL, 3 AR, 4 TL1, 5 TL2, 6 TR1, 7 TR2
  const pv = [O, Pp, AL, AR, TL1, TL2, TR1, TR2];
  // 3-D at open = 180°: boards in y = 0, piece base edges one caliper above (y = T).
  const O3 = [0, T, Z0];
  const dL = [-Math.sin(ALPHA), 0, -Math.cos(ALPHA)], dR = [Math.sin(ALPHA), 0, -Math.cos(ALPHA)];
  const dOP = [0, Math.sin(GAMMA), -Math.cos(GAMMA)];
  const nOutL = [-Math.cos(ALPHA), 0, Math.sin(ALPHA)], nOutR = [Math.cos(ALPHA), 0, Math.sin(ALPHA)];
  const tab3 = (p, e, out, d3, n3) => { const q = sub(p, O); return add(add(O3, mul(d3, dot(q, e))), mul(n3, dot(q, out))); };
  const pw = [O3, add(O3, mul(dOP, P)), add(O3, mul(dL, A)), add(O3, mul(dR, A)),
    tab3(TL1, eL, outL, dL, nOutL), tab3(TL2, eL, outL, dL, nOutL), tab3(TR1, eR, outR, dR, nOutR), tab3(TR2, eR, outR, dR, nOutR)];
  // Faces (CCW in layout).
  const faces = [[0, 3, 1], [0, 1, 2], [0, 2, 5, 4], [0, 6, 7, 3]];   // panel R, panel L, tab L, tab R
  for (const f of faces) if (area2(f.map((i) => pv[i])) < 0) f.reverse();
  const nrm = faces.map((f) => newell(f.map((i) => pw[i])));
  // Fold angles from the 3-D state, parent = the face where the edge runs a→b in CCW order.
  const angleOf = (a, b) => {
    const pi = faces.findIndex((f) => f.some((v, k) => v === a && f[(k + 1) % f.length] === b));
    const ci = faces.findIndex((f) => f.some((v, k) => v === b && f[(k + 1) % f.length] === a));
    return foldAngle(nrm[pi], nrm[ci], pw[a], pw[b]);
  };
  const crease = (a, b) => { const ang = angleOf(a, b); return [a, b, ang >= 0 ? 'V' : 'M', 'crease', ang]; };
  const pedges = [[1, 2, 'B', 'none', 0], [2, 5, 'B', 'none', 0], [5, 4, 'B', 'none', 0], [4, 0, 'B', 'none', 0],
    [0, 6, 'B', 'none', 0], [6, 7, 'B', 'none', 0], [7, 3, 'B', 'none', 0], [3, 1, 'B', 'none', 0],
    crease(0, 1), crease(0, 2), crease(0, 3)];
  // Boards.
  const left = sheetMeta('left-board', { en: 'Left board', es: 'Tapa izquierda', fr: 'Plat gauche', pt: 'Placa esquerda' }, 'cardstock-250', [0, 0], [-BW, 0, BH / 2], '#2f4a6d', null, '#efe6d2');
  const right = sheetMeta('right-board', { en: 'Right board', es: 'Tapa derecha', fr: 'Plat droit', pt: 'Placa direita' }, 'cardstock-250', [BW + 10, 0], [0, 0, BH / 2], '#2f4a6d', { mechanism: 'spread' }, '#efe6d2');
  const piece = sheetMeta('v-piece', { en: 'V-fold piece', es: 'Pieza en V', fr: 'Pièce en V', pt: 'Peça em V' }, 'cardstock-250', [2 * BW + 20, 0], [-c, T, Z0 + O[1]], '#c8553d', null, '#f2d0a4');
  // Glue maps: piece-local (u, v) → board-local; affine fit through three tab points.
  const toBoardLocal = (w, isLeft) => (isLeft ? [w[0] + BW, BH / 2 - w[2]] : [w[0], BH / 2 - w[2]]);
  const fitMap = (ids, isLeft) => {
    const [p0, p1, p2] = ids.map((i) => pv[i]);
    const [q0, q1, q2] = ids.map((i) => toBoardLocal(pw[i], isLeft));
    const d1 = sub(p1, p0), d2 = sub(p2, p0), e1 = sub(q1, q0), e2 = sub(q2, q0);
    const det = d1[0] * d2[1] - d2[0] * d1[1];
    const a = (e1[0] * d2[1] - e2[0] * d1[1]) / det, b = (e2[0] * d1[0] - e1[0] * d2[0]) / det;
    const cc = (e1[1] * d2[1] - e2[1] * d1[1]) / det, d = (e2[1] * d1[0] - e1[1] * d2[0]) / det;
    return [a, b, cc, d, q0[0] - (a * p0[0] + b * p0[1]), q0[1] - (cc * p0[0] + d * p0[1])].map(r6);
  };
  const inset = (ids, by) => { const pts = ids.map((i) => pv[i]); const ctr = mul(pts.reduce(add), 1 / pts.length);
    return pts.map((p) => add(p, mul(norm(sub(ctr, p)), by)).map(r6)); };
  const pieceOff = [2 * BW + 20, 0];
  return assemble({
    title: 'V-fold pop-up card',
    sheets: [
      { meta: left, verts: rect(BW, BH), edges: boundary(4), faces: [[0, 1, 2, 3]] },
      { meta: right, verts: rect(BW, BH), edges: boundary(4), faces: [[0, 1, 2, 3]] },
      { meta: piece, verts: pv, edges: pedges, faces, world: pw },
    ],
    joins: [
      { id: 'left-board-pin', type: 'pin', a: { sheet: 'left-board', along: [[0, 0], [0, BH]] }, world: null },
      { id: 'tab-left', type: 'glue', a: { sheet: 'v-piece', region: inset([0, 2, 5, 4], 1) }, b: { sheet: 'left-board' }, map: fitMap([0, 2, 4], true), side: 'front' },
      { id: 'tab-right', type: 'glue', a: { sheet: 'v-piece', region: inset([0, 6, 7, 3], 1) }, b: { sheet: 'right-board' }, map: fitMap([0, 3, 6], false), side: 'front' },
    ],
    mechanisms: [{ id: 'spread', type: 'hinge', axis: { origin: [0, 0, 0], direction: [0, 0, -1] }, angle_control: 'open', rest: 180, sheets_moving: ['right-board'] }],
    controls: [{ id: 'open', kind: 'angle', label: { en: 'Open the card', es: 'Abrir la tarjeta', fr: 'Ouvrir la carte', pt: 'Abrir o cartão' }, min: 10, max: 180, default: 180, unit: 'deg' }],
    meta: { cartridge: 'v-fold-popup', mode: 'default', params: { alpha_deg: 45, beta_deg: 60, offset: pieceOff[0] } },
    needsInitial: true,
  });
}

const L4 = (en, es, fr, pt) => ({ en, es, fr, pt });
const CATALOG = {
  version: 1,
  source: 'demo',
  items: [
    { slug: 'pliego-half-fold', document: 'demo/pliego-half-fold.fold',
      title: L4('The pliego', 'El pliego', 'Le pliego', 'O pliego'),
      summary: L4('One sheet, one valley fold: the printer’s sheet that becomes a book signature.', 'Una hoja, un doblez en valle: el pliego de imprenta que se convierte en cuadernillo.', 'Une feuille, un pli vallée : la feuille d’imprimeur qui devient un cahier.', 'Uma folha, uma dobra em vale: a folha de impressão que vira caderno.'),
      parameters: [
        { id: 'width', type: 'slider', label: L4('Width', 'Ancho', 'Largeur', 'Largura'), min: 100, max: 300, step: 10, default: 200, unit: 'mm' },
        { id: 'stock', type: 'select', label: L4('Paper', 'Papel', 'Papier', 'Papel'), default: 'kami',
          options: [{ value: 'kami', label: L4('Kami', 'Kami', 'Kami', 'Kami') }, { value: 'cardstock-250', label: L4('Cardstock', 'Cartulina', 'Bristol', 'Cartolina') }] },
      ] },
    { slug: 'page-turn', document: 'demo/page-turn.fold',
      title: L4('Page turn', 'Pasar la página', 'Tourner la page', 'Virar a página'),
      summary: L4('The simplest sheet hyperobject: one leaf turning on a spine.', 'El hiperobjeto de hoja más sencillo: una hoja que gira sobre su lomo.', 'L’hyperobjet de feuille le plus simple : un feuillet qui tourne sur son dos.', 'O hiperobjeto de folha mais simples: uma folha que gira sobre a lombada.'),
      parameters: [{ id: 'curl', type: 'checkbox', label: L4('Let the paper curl', 'Dejar que el papel se curve', 'Laisser le papier se courber', 'Deixar o papel curvar'), default: true }] },
    { slug: 'v-fold-popup', document: 'demo/v-fold-popup.fold',
      title: L4('V-fold pop-up', 'Pop-up en V', 'Pop-up en V', 'Pop-up em V'),
      summary: L4('A card with a V-fold piece glued across the gutter: it rises as the card opens.', 'Una tarjeta con una pieza en V pegada sobre el pliegue central: se levanta al abrirla.', 'Une carte avec une pièce en V collée sur la pliure : elle se dresse à l’ouverture.', 'Um cartão com uma peça em V colada sobre a dobra central: ela se ergue ao abrir.'),
      parameters: [{ id: 'alpha', type: 'slider', label: L4('Glue angle', 'Ángulo de pegado', 'Angle de collage', 'Ângulo de colagem'), min: 30, max: 60, step: 5, default: 45, unit: '°' }] },
  ],
};

const files = {
  'pliego-half-fold.fold': pliego(),
  'page-turn.fold': pageLeaf(),
  'v-fold-popup.fold': vFold(),
  'catalog.json': CATALOG,
};

const check = process.argv.includes('--check');
let drift = 0;
for (const [name, obj] of Object.entries(files)) {
  const text = JSON.stringify(obj, null, 1) + '\n';
  const path = join(OUT, name);
  if (check) {
    const same = existsSync(path) && readFileSync(path, 'utf8') === text;
    if (!same) { drift++; console.error(`drift: ${name}`); }
  } else {
    writeFileSync(path, text);
  }
}
console.log(`make-demos: files=${Object.keys(files).length} ${check ? `drift=${drift}` : 'written'}`);
if (check && drift) process.exit(1);
