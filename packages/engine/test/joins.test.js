// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, locatePoint } from '../src/index.js';
import { DocBuilder, squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** World position of a sheet-local point (nearest mesh vertex). @param {World} w @param {number} s @param {number[]} p */
function at(w, s, p) {
  let best = -1, bd = Infinity;
  for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.vSheet[v] === s) { const d = Math.hypot(w.mesh.uv[2 * v] - p[0], w.mesh.uv[2 * v + 1] - p[1]); if (d < bd) { bd = d; best = v; } }
  return [w.x[3 * best], w.x[3 * best + 1], w.x[3 * best + 2]];
}

test('string: a sheet falls until its thread is taut, then hangs at the thread length', () => {
  const b = new DocBuilder('hung card');
  b.rect({ id: 'card', width: 40, height: 40, placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'thread', type: 'string', a: { sheet: 'card', at: [20, 20] }, b: { world: [20, 120, -20] }, length: 40 });
  const w = new World(b.build(), { meshEdge: 8, ground: false, contact: false, damping: 6 });
  for (let f = 0; f < 240; f++) w.step();
  const p = at(w, 0, [20, 20]);
  const d = Math.hypot(p[0] - 20, p[1] - 120, p[2] + 20);
  const pass = Math.abs(d - 40) < 0.2 && w.stats().finite;
  proof('string', d, 40, '±0.2 mm', pass, 'unilateral: slack while falling, taut at rest');
  assert.ok(pass);
});

test('pivot: a flap riveted to a held strip swings down about the rivet', () => {
  const b = new DocBuilder('pivot');
  b.rect({ id: 'arm', width: 60, height: 20, placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'flap', width: 60, height: 20, placement: { origin: [50, 100.3, 0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'hold', type: 'pin', a: { sheet: 'arm', along: [[0, 0], [0, 20]] }, world: null });
  b.joins.push({ id: 'hold-2', type: 'pin', a: { sheet: 'arm', at: [15, 5] }, world: null });
  b.joins.push({ id: 'hold-3', type: 'pin', a: { sheet: 'arm', at: [15, 15] }, world: null });
  b.joins.push({ id: 'brad', type: 'pivot', a: { sheet: 'arm', at: [55, 10] }, b: { sheet: 'flap', at: [5, 10] } });
  const w = new World(b.build(), { meshEdge: 6, ground: false, contact: false, damping: 4 });
  for (let f = 0; f < 180; f++) w.step();
  const exact = (/** @type {number} */ sh, /** @type {number[]} */ q) => { const r = /** @type {any} */(locatePoint(w.mesh, sh, q[0], q[1])); return [0, 1, 2].map((c) => r.w[0] * w.x[3 * r.verts[0] + c] + r.w[1] * w.x[3 * r.verts[1] + c] + r.w[2] * w.x[3 * r.verts[2] + c]); };
  const pa = exact(0, [55, 10]), pb = exact(1, [5, 10]), tip = at(w, 1, [60, 10]);
  const sep = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  const pass = sep < 0.6 && 100 - tip[1] > 20 && w.stats().finite;
  proof('pivot', sep, '≈0.3 (layer offset kept)', '<0.6 mm, flap swung down', pass, `flap tip dropped ${(100 - tip[1]).toFixed(1)} mm`);
  assert.ok(pass);
});

test('slider + slide mechanism: a tab is driven along its track', () => {
  const b = new DocBuilder('slider');
  b.rect({ id: 'base', width: 80, height: 20, placement: { origin: [0, 50, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'tab', width: 10, height: 10, placement: { origin: [5, 50.2, -5], rotation: [0, 0, 0, 1] } });
  for (const y of [0, 20]) b.joins.push({ id: `hold-${y}`, type: 'pin', a: { sheet: 'base', along: [[0, y], [80, y]] }, world: null });
  b.joins.push({ id: 'run', type: 'slider', a: { sheet: 'tab', at: [5, 5] }, track: { sheet: 'base', from: [10, 10], to: [70, 10] }, mechanism: 'pull' });
  b.mechanisms.push({ id: 'pull', type: 'slide', control: 'pull', travel: 60 });
  b.control({ id: 'pull', kind: 'distance', min: 0, max: 60, default: 0, unit: 'mm' });
  const w = new World(b.build(), { meshEdge: 5, ground: false, contact: false });
  w.setControl('pull', 30);
  for (let f = 0; f < 120; f++) w.step();
  const p = at(w, 1, [5, 5]);
  const err = Math.hypot(p[0] - 40, p[2] + 10);
  const pass = err < 0.5 && w.stats().finite;
  proof('slider', err, 0, '<0.5 mm from the track point at s = 30', pass);
  assert.ok(pass);
});

test('rotate mechanism: a kinematic disc turns about the pivot normal', () => {
  const b = new DocBuilder('volvelle');
  b.rect({ id: 'base', width: 100, height: 100, placement: { origin: [0, 0, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'disc', width: 60, height: 60, placement: { origin: [20, 0.3, -20], rotation: [0, 0, 0, 1] }, kinematic: { mechanism: 'spin' } });
  b.mechanisms.push({ id: 'spin', type: 'rotate', center: { sheet: 'base', at: [50, 50] }, control: 'spin', sheets_moving: ['disc'] });
  b.control({ id: 'spin', kind: 'angle', min: 0, max: 360, default: 0, unit: 'deg' });
  b.joins.push({ id: 'base-hold', type: 'pin', a: { sheet: 'base', along: [[0, 0], [100, 0]] }, world: null });
  const w = new World(b.build(), { meshEdge: 10, gravity: false, contact: false });
  w.setControl('spin', 90);
  for (let f = 0; f < 60; f++) w.step();
  const p = at(w, 1, [60, 30]); // disc corner: world (80, 0.3, −50) before, 30 mm from the centre along +x
  const ang = Math.atan2(-(p[2] + 50), p[0] - 50) * 180 / Math.PI;
  const r = Math.hypot(p[0] - 50, p[2] + 50);
  const pass = Math.abs(Math.abs(ang) - 90) < 1e-6 && Math.abs(r - 30) < 1e-6;
  proof('rotate', Math.abs(ang), 90, '±1e-6°', pass, `radius ${r.toFixed(6)} mm`);
  assert.ok(pass);
});

test('pick, render and creaseLines buffers', () => {
  const w = new World(squareValley({ size: 100 }).doc, { meshEdge: 8 });
  w.step();
  const hit = w.pick([30, 50, -70], [0, -1, 0]);
  assert.ok(hit && hit.sheet === 0 && Math.abs(hit.point[1]) < 1e-6, 'ray from above hits the sheet');
  const r = w.render();
  assert.equal(r.positions.length, 3 * r.vertexCount);
  assert.equal(r.normals.length, 3 * r.vertexCount);
  assert.equal(r.uvs.length, 2 * r.vertexCount);
  assert.equal(r.sheetIds.length, r.vertexCount);
  assert.equal(r.indices.length, 3 * r.triangleCount);
  for (let i = 0; i < r.vertexCount; i++) assert.ok(Math.abs(Math.hypot(r.normals[3 * i], r.normals[3 * i + 1], r.normals[3 * i + 2]) - 1) < 1e-5);
  const c = w.creaseLines();
  assert.ok(c.count > 0 && c.positions.length === 6 * c.count && c.kinds.every((k) => k === 1));
  assert.equal(w.render(), r, 'render() reuses its buffers');
});
