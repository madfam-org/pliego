// Pure studio logic: share URLs, parameter coercion, catalog normalisation, diagram line kinds,
// step indexing and triangulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShare, buildShare, coerceParams, paramsForMode, paramStrings, hasParams } from '../studio/src/share.js';
import { normalizeCatalog, normalizeModes, renderBody } from '../studio/src/data.js';
import { lineKind } from '../studio/src/diagram.js';
import { stepIndex, paramText } from '../studio/src/panels.js';
import { triangulate, signedArea } from '../studio/src/geom.js';
import { rendererOverride } from '../studio/src/render/index.js';
import { sheetArea, engineOptions, tooSlow, MESH_EDGE_MIN, MESH_EDGE_MAX, estimateVertices, physicsFits, boundaryLength, VERTEX_LIMIT } from '../studio/src/physics.js';

test('share URL round-trips slug, params and view; keeps test overrides', () => {
  const url = buildShare('https://pliego-app.madfam.io/studio/', { slug: 'page-turn', params: { width: 180, curl: true }, view: '2d', keep: new URLSearchParams('renderer=canvas2d&junk=1') });
  const u = new URL(url);
  assert.equal(u.searchParams.get('slug'), 'page-turn');
  assert.equal(u.searchParams.get('renderer'), 'canvas2d');
  assert.equal(u.searchParams.get('junk'), null);
  const s = parseShare(u.search, u.hash);
  assert.deepEqual(Object.fromEntries(s.params), { width: '180', curl: 'true' });
  assert.equal(s.view, '2d');
  assert.equal(s.renderer, 'canvas2d');
  assert.equal(parseShare('', '').view, '3d');
});

test('share URL carries the mode in the query only when given', () => {
  const url = buildShare('https://pliego-app.madfam.io/studio/', { slug: 'inside-reverse-fold', mode: 'hand', params: { angle: 40 } });
  const s = parseShare(new URL(url).search, new URL(url).hash);
  assert.equal(s.slug, 'inside-reverse-fold');
  assert.equal(s.mode, 'hand');
  assert.deepEqual(Object.fromEntries(s.params), { angle: '40' });
  assert.equal(new URL(buildShare('https://x/studio/', { slug: 'valley-fold' })).searchParams.has('mode'), false);
  assert.equal(parseShare('?slug=a', '').mode, null);
});

test('mode-restricted parameters apply only to their modes; typed values round-trip', () => {
  const params = [
    { id: 'width', type: 'slider', min: 10, max: 90, default: 50 },
    { id: 'tear', type: 'checkbox', default: false, modes: ['hand'] },
  ];
  assert.deepEqual(paramsForMode(params, 'rigid').map((p) => p.id), ['width']);
  assert.deepEqual(paramsForMode(params, 'hand').map((p) => p.id), ['width', 'tear']);
  assert.deepEqual(paramsForMode(params, null).map((p) => p.id), ['width']);
  // switching modes drops what no longer applies and keeps typed values intact (true stays true)
  const typed = { width: 70, tear: true };
  assert.deepEqual(coerceParams(paramsForMode(params, 'hand'), paramStrings(typed)), { width: 70, tear: true });
  assert.deepEqual(coerceParams(paramsForMode(params, 'rigid'), paramStrings(typed)), { width: 70 });
});

test('modes normalise from ids and manifest entries; the request body names the mode', () => {
  assert.deepEqual(normalizeModes(['rigid', 'hand']), [{ id: 'rigid', label: null }, { id: 'hand', label: null }]);
  assert.deepEqual(normalizeModes([{ id: 'hand', label: { en: 'By hand' }, script_file: 'main.py' }, { nope: 1 }, 7]), [{ id: 'hand', label: { en: 'By hand' } }]);
  assert.deepEqual(normalizeModes(undefined), []);
  const items = normalizeCatalog({ projects: [{ slug: 'r', modes: ['rigid', 'hand'] }] }, 'http://x/api/v1/');
  assert.deepEqual(items[0].modes.map((m) => m.id), ['rigid', 'hand']);
  assert.deepEqual(JSON.parse(renderBody('r', { a: 1 }, 'hand')), { slug: 'r', mode: 'hand', params: { a: 1 } });
  assert.deepEqual(JSON.parse(renderBody('r', {}, null, { format: 'svg' })), { slug: 'r', params: {}, format: 'svg' });
});

test('URL input never names an object property (prototype pollution guard)', () => {
  const s = parseShare('?slug=a', '#__proto__=x&constructor=y&width=5&_view=2d');
  assert.equal(Object.getPrototypeOf({}).x, undefined, 'Object.prototype untouched');
  assert.ok(s.params instanceof URLSearchParams);
  assert.equal(s.params.get('width'), '5');
  assert.equal(s.params.has('_view'), false, 'underscore keys stay studio-only');
  // only manifest ids are read out
  assert.deepEqual(coerceParams([{ id: 'width', type: 'slider', min: 0, max: 10, default: 1 }], s.params), { width: 5 });
  assert.equal(hasParams(s.params), true);
  assert.equal(hasParams(new URLSearchParams()), false);
  assert.equal(hasParams(null), false);
});

test('parameter coercion clamps, validates options and falls back to defaults', () => {
  const params = [
    { id: 'width', type: 'slider', min: 100, max: 300, default: 200 },
    { id: 'stock', type: 'select', default: 'kami', options: [{ value: 'kami' }, { value: 'cardstock-250' }] },
    { id: 'curl', type: 'checkbox', default: true },
  ];
  assert.deepEqual(coerceParams(params, {}), { width: 200, stock: 'kami', curl: true });
  assert.deepEqual(coerceParams(params, { width: '999', stock: 'cardstock-250', curl: 'false' }), { width: 300, stock: 'cardstock-250', curl: false });
  assert.deepEqual(coerceParams(params, { width: 'abc', stock: 'nope' }), { width: 200, stock: 'kami', curl: true });
});

test('catalog normalisation accepts demo and API shapes', () => {
  const base = 'http://x/studio/demo/catalog.json';
  const a = normalizeCatalog({ items: [{ slug: 'a', document: 'a.fold', title: { en: 'A' } }] }, base);
  assert.equal(a[0].document, 'http://x/studio/demo/a.fold');
  assert.deepEqual(a[0].exports, ['svg', 'dxf', 'pdf', 'glb']);
  const b = normalizeCatalog({ projects: [{ slug: 'b', name: { en: 'B' }, export_formats: ['svg'] }, { nope: 1 }] }, base);
  assert.equal(b.length, 1);
  assert.equal(b[0].document, null);
  assert.deepEqual(b[0].exports, ['svg']);
  assert.deepEqual(normalizeCatalog([{ slug: 'c' }], base).map((x) => x.slug), ['c']);
});

test('diagram line kinds follow the fabrication conventions', () => {
  assert.equal(lineKind('B', 'none'), 'outline');
  assert.equal(lineKind('C', 'cut'), 'cut');
  assert.equal(lineKind('M', 'crease'), 'mountain');
  assert.equal(lineKind('V', 'crease'), 'valley');
  assert.equal(lineKind('V', 'score'), 'score');
  assert.equal(lineKind('M', 'perforation'), 'perforation');
  assert.equal(lineKind('J', 'none'), null);
  assert.equal(lineKind('F', 'none'), null);
});

test('slider values show the step\'s decimals and readable units', () => {
  assert.equal(paramText(0.5, { step: 0.01, unit: 'ratio' }), (0.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  assert.equal(paramText(45, { step: 1, unit: 'deg' }), '45°');
  assert.equal(paramText(200, { step: 5, unit: 'mm' }), '200 mm');
  assert.equal(paramText(3, {}), '3');
});

test('triangulation drops collinear runs along a crease (paper-snowflake delicate, face 3)', () => {
  // A face bounded by a crease that cut notches meet: vertices 8, 9, 12, 13, 15 and 16 lie on one
  // line and become consecutive while clipping. Before the fix this threw "polygon is not simple".
  const face = [[18.246743, 117.948799], [55.129433, 81.066109], [60.316768, 79.769276], [61.613602, 74.58194],
    [65.179895, 71.015647], [66.034521, 71.671425], [67.029754, 72.083664], [61.24644, 93.667286],
    [53.301562, 85.722408], [46.844135, 92.179834], [54.244569, 119.798626], [52.588127, 125.980552],
    [44.231346, 94.792623], [34.562447, 104.461523], [37.563564, 119.677125], [32.86539, 106.158579],
    [23.19649, 115.827479]];
  const tris = triangulate(face);
  const covered = tris.reduce((s, t) => s + Math.abs(signedArea(t.map((k) => face[k]))), 0);
  assert.ok(Math.abs(covered - signedArea(face)) < 1e-6, `triangles cover the face (${covered} vs ${signedArea(face)})`);
  // a polygon that really self-intersects still fails loudly
  assert.throws(() => triangulate([[0, 0], [10, 10], [10, 0], [0, 10]]), /not simple/);
});

test('step index for sequence values', () => {
  assert.equal(stepIndex(0, 2), -1);
  assert.equal(stepIndex(0.01, 2), 0);
  assert.equal(stepIndex(1, 2), 0);
  assert.equal(stepIndex(1.5, 2), 1);
  assert.equal(stepIndex(2, 2), 1);
});

test('ear clipping triangulates convex and concave polygons with full area', () => {
  const L = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
  const tris = triangulate(L);
  assert.equal(tris.length, L.length - 2);
  const area = tris.reduce((s, t) => s + signedArea(t.map((i) => L[i])), 0);
  assert.ok(Math.abs(area - signedArea(L)) < 1e-9);
  for (const t of tris) assert.ok(signedArea(t.map((i) => L[i])) > 0, 'CCW triangles');
  assert.equal(triangulate([[0, 0], [0, 1], [1, 0]]).length, 1);   // CW input is handled
});

test('renderer override accepts only known renderers', () => {
  assert.equal(rendererOverride('canvas2d'), 'canvas2d');
  assert.equal(rendererOverride('webgl2'), 'webgl2');
  assert.equal(rendererOverride('x'), null);
  assert.equal(rendererOverride(null), null);
});

test('paper-engine options size the mesh from the sheet area', () => {
  const square = (a) => ({ vertices_coords: [[0, 0], [a, 0], [a, a], [0, a]], faces_vertices: [[0, 1, 2, 3]] });
  assert.equal(sheetArea(square(150)), 22500);
  assert.deepEqual(engineOptions(square(150)), { seed: 1, meshEdge: 8.7, substeps: 8 });
  assert.equal(engineOptions(square(20)).meshEdge, MESH_EDGE_MIN);
  assert.equal(engineOptions(square(2000)).meshEdge, MESH_EDGE_MAX);
  assert.equal(engineOptions({}).meshEdge, MESH_EDGE_MIN);
  assert.equal(tooSlow(41), true);
  assert.equal(tooSlow(39), false);
  assert.equal(tooSlow(NaN), false);
});

test('documents too large for interactive physics start in the preview', () => {
  const square = { vertices_coords: [[0, 0], [150, 0], [150, 150], [0, 150]], faces_vertices: [[0, 1, 2, 3]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]], edges_assignment: ['B', 'B', 'B', 'B'] };
  assert.equal(boundaryLength(square), 600);
  const est = estimateVertices(square, 8.7);
  assert.ok(est > 300 && est < 600, `150 mm square ≈ the 450-vertex budget (${est})`);
  assert.equal(physicsFits(square), true);
  // lace: a long cut boundary with many document vertices
  const n = 1500;
  const lace = { vertices_coords: Array.from({ length: n }, (_, i) => [Math.cos(i / n * 2 * Math.PI) * 200, Math.sin(i / n * 2 * Math.PI) * 200]),
    faces_vertices: [Array.from({ length: n }, (_, i) => i)], edges_vertices: Array.from({ length: n }, (_, i) => [i, (i + 1) % n]),
    edges_assignment: Array.from({ length: n }, () => 'C') };
  assert.ok(estimateVertices(lace, engineOptions(lace).meshEdge) > VERTEX_LIMIT);
  assert.equal(physicsFits(lace), false);
});
