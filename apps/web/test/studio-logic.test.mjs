// Pure studio logic: share URLs, parameter coercion, catalog normalisation, diagram line kinds,
// step indexing and triangulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShare, buildShare, coerceParams, paramsForMode, paramStrings } from '../studio/src/share.js';
import { normalizeCatalog, normalizeModes, renderBody } from '../studio/src/data.js';
import { lineKind } from '../studio/src/diagram.js';
import { stepIndex, paramText } from '../studio/src/panels.js';
import { triangulate, signedArea } from '../studio/src/geom.js';
import { rendererOverride } from '../studio/src/render/index.js';

test('share URL round-trips slug, params and view; keeps test overrides', () => {
  const url = buildShare('https://pliego-app.madfam.io/studio/', { slug: 'page-turn', params: { width: 180, curl: true }, view: '2d', keep: new URLSearchParams('renderer=canvas2d&junk=1') });
  const u = new URL(url);
  assert.equal(u.searchParams.get('slug'), 'page-turn');
  assert.equal(u.searchParams.get('renderer'), 'canvas2d');
  assert.equal(u.searchParams.get('junk'), null);
  const s = parseShare(u.search, u.hash);
  assert.deepEqual(s.params, { width: '180', curl: 'true' });
  assert.equal(s.view, '2d');
  assert.equal(s.renderer, 'canvas2d');
  assert.equal(parseShare('', '').view, '3d');
});

test('share URL carries the mode in the query only when given', () => {
  const url = buildShare('https://pliego-app.madfam.io/studio/', { slug: 'inside-reverse-fold', mode: 'hand', params: { angle: 40 } });
  const s = parseShare(new URL(url).search, new URL(url).hash);
  assert.equal(s.slug, 'inside-reverse-fold');
  assert.equal(s.mode, 'hand');
  assert.deepEqual(s.params, { angle: '40' });
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
