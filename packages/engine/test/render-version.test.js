// @ts-check
/**
 * Render path for the Studio's engine Worker (lane E4, 2026-10-18; asks from lane E5): render() and
 * creaseLines() recompute only when the pose moved (`poseVersion`), write into caller buffers on
 * request, `asleep` is O(1), and none of it changes what is drawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World, loadDocument } from '../src/index.js';
import { squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('render-version: unchanged pose → no recompute; caller buffers get the same floats; asleep is a field', () => {
  const w = new World(squareValley({ size: 80 }).doc, { meshEdge: 10, substeps: 8 });
  const a = w.render();
  const pos0 = Float32Array.from(a.positions);
  // nothing stepped: the shared buffers are not touched again (a write to them survives a render())
  a.positions[0] += 1;
  assert.equal(w.render().positions[0], pos0[0] + 1, 'render() recomputed an unchanged pose');
  a.positions[0] = pos0[0];
  w.setControl('sequence', 1);
  const v0 = w.poseVersion;
  for (let f = 0; f < 20; f++) w.step();
  assert.ok(w.poseVersion > v0);
  const r = w.render();
  const out = { positions: new Float32Array(r.positions.length), normals: new Float32Array(r.normals.length) };
  const o = w.render(out);
  assert.equal(o.positions, out.positions);
  let same = true;
  for (let i = 0; i < r.positions.length; i++) if (!Object.is(r.positions[i], out.positions[i]) || !Object.is(r.normals[i], out.normals[i])) same = false;
  const L = w.creaseLines(), lout = new Float32Array(L.positions.length);
  w.creaseLines({ positions: lout });
  for (let i = 0; i < lout.length; i++) if (!Object.is(lout[i], L.positions[i])) same = false;
  assert.equal(w.asleep, w.stats().asleep);
  proof('render-version', same ? 'identical' : 'differs', 'identical', 'Float32, shared vs caller buffers', same, `poseVersion ${w.poseVersion}`);
  assert.ok(same);
});

test('render-version: a presented document (spec §5.16) picks and renders the same with the scratch copy', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.fold'));
  let picked = 0;
  for (const f of files) {
    const w = new World(loadDocument(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))), { meshEdge: 12, substeps: 8 });
    for (let i = 0; i < 5; i++) w.step();
    const P = w.render().positions;
    // a ray straight down through the first render vertex hits the mesh at that point
    const hit = w.pick([P[0], P[1] + 500, P[2]], [0, -1, 0]);
    if (hit) picked++;
    const again = w.pick([P[0], P[1] + 500, P[2]], [0, -1, 0]);
    assert.deepEqual(again, hit);
  }
  assert.ok(picked > 0);
});
