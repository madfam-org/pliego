// Pure studio logic: share URLs, parameter coercion, catalog normalisation, diagram line kinds,
// step indexing and triangulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShare, buildShare, coerceParams } from '../studio/src/share.js';
import { normalizeCatalog } from '../studio/src/data.js';
import { lineKind } from '../studio/src/diagram.js';
import { stepIndex } from '../studio/src/panels.js';
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
