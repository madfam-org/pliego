// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';

function pull(grain, physicalMembrane, force = 10, lineSearch = false, substeps = 8) {
  const b = new DocBuilder('small elastic axial pull');
  b.rect({ id: 'strip', width: 100, height: 10, grain,
    placement: { origin: [0, 100, 0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'root', type: 'pin', a: { sheet: 'strip', along: [[0, 0], [0, 10]] }, world: null });
  const w = new World(b.build(), { meshEdge: 10, substeps, physicalMembrane, lineSearch,
    gravity: false, ground: false, contact: false, plasticity: false });
  const tip = [];
  for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v] - 100) < 1e-9) tip.push(v);
  for (const v of tip) w.setForce(v, [force / tip.length, 0, 0]);
  for (let f = 0; f < 90; f++) w.step();
  const extension = tip.reduce((sum, v) => sum + w.positions[3 * v] - 100, 0) / tip.length;
  assert.ok(w.stats().finite && w.stats().maxStrain < 0.005);
  w.clearForces();
  for (let f = 0; f < 90; f++) w.step();
  const residual = tip.reduce((sum, v) => sum + w.positions[3 * v] - 100, 0) / tip.length;
  return { extension, residual, stats: w.stats() };
}

test('physical membrane experiment restores stock grain response in a reversible small axial pull', () => {
  const capped = pull(0, false), md = pull(0, true), cd = pull(90, true);
  assert.ok(md.extension > 0 && cd.extension > 1.3 * md.extension, 'CD must be more compliant than MD');
  assert.ok(capped.extension > 10 * md.extension, 'the experiment must expose the default cap bias');
  for (const r of [capped, md, cd]) assert.ok(Math.abs(r.residual) < 0.05 * r.extension + 1e-7, 'elastic unloading returns to rest');
  console.log(`physical-membrane: 0.01 mN pull; capped=${capped.extension} mm MD=${md.extension} mm CD=${cd.extension} mm; elastic return, finite; not physical stock calibration`);
});
test('E13-axial: sufficiently small physical-modulus steps approach the axial-bar reference', () => {
  const a = pull(0, true, 10000, true, 128), b = pull(0, true, 10000, true, 256);
  const expected = 10000 * 100 / (5.5e9 * 0.1 * 10); // F L / (E t width), mm
  for (const r of [a, b]) assert.ok(Math.abs(r.extension - expected) / expected < 0.05, 'bar reference within 5%');
  assert.ok(Math.abs(a.extension - b.extension) / expected < 0.03, 'substep doubling shifts response by <3%');
  console.log(`E13-axial: S128=${a.extension} mm S256=${b.extension} mm bar=${expected} mm; synthetic numerical reference, not measured stock validation`);
});
