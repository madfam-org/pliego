import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch, measureAffine, affineDisplacement } from '../bench/membrane-patch.mjs';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

test('affine membrane observations preserve authored topology across grain and replay exactly without stepping', () => {
  let meshes = 0, measurements = 0;
  for (const cells of [4, 8, 16]) for (const pattern of ['forward', 'alternating', 'perturbed']) {
    let meshHash, native;
    for (const grain of [0, 30, 45, 90]) {
      const p = makePatch({ cells, pattern, grain }); meshes++;
      assert.equal(p.world.mesh.nV, (cells + 1) ** 2);
      assert.equal(p.world.mesh.nT, 2 * cells ** 2);
      if (meshHash) { assert.equal(p.meshSHA256, meshHash); assert.deepEqual(p.info.nativeByteFingerprints, native); }
      else { meshHash = p.meshSHA256; native = p.info.nativeByteFingerprints; }
      for (const strain of [[0, 0, 0], [1e-4, -3e-5, 5e-5], [-7e-5, 4e-5, -8e-5]]) {
        const observed = measureAffine(p, strain); measurements++;
        assert.deepEqual(observed, measureAffine(p, strain));
        assert.equal(observed.statsEnergy, p.world.stats().energy.stretch);
        assert.equal(observed.energy, implicitEnergy(p.world, p.world.x));
        const displacement = affineDisplacement(p, strain);
        for (let i = 0; i < p.vertices.length; i++) {
          assert.equal(displacement[i][0], p.world.x[3 * i] - p.vertices[i][0]);
          assert.equal(displacement[i][1], -p.world.x[3 * i + 2] - p.vertices[i][1]);
        }
        assert.equal(observed.nonMembraneEnergy, 0);
        assert.equal(observed.steps, 0); assert.equal(observed.frames, 0); assert.equal(observed.time, 0);
        if (strain.every((v) => v === 0)) assert.equal(observed.energy, 0);
      }
    }
  }
  console.log(`membrane-patch: meshes=${meshes}; observations=${measurements}; exact native topology across grain; no stepping/contact/inertia/non-membrane energy`);
});

test('measured actual-engine nodal and affine gradients agree with implicit objective finite differences for separate cap/compression policies', () => {
  let checks = 0, worst = 0;
  for (const [physicalMembrane, membraneCompression] of [[true, 1], [true, 0.05], [false, 1]]) {
    const p = makePatch({ cells: 4, pattern: 'perturbed', grain: 30, physicalMembrane, membraneCompression });
    const strain = [7e-5, -3e-5, 4e-5], measured = measureAffine(p, strain);
    assert.equal(p.world.kCompFactor, membraneCompression);
    assert.equal(p.world.opts.physicalMembrane, physicalMembrane);
    for (let c = 0; c < 3; c++) {
      const h = 1e-7, a = strain.slice(), b = strain.slice(); a[c] += h; b[c] -= h;
      const fd = (measureAffine(p, a).energy - measureAffine(p, b).energy) / (2 * h);
      const actual = measured.generalizedGradient[c];
      const error = Math.abs(fd - actual) / Math.max(1, Math.abs(actual), Math.abs(fd));
      worst = Math.max(worst, error); checks++;
      assert.ok(error < 2e-6, `affine derivative ${c}: ${error}`);
    }
    measureAffine(p, strain);
    const w = p.world, direction = new Float64Array(w.x.length);
    let expected = 0;
    for (let v = 0; v < p.vertices.length; v++) {
      direction[3 * v] = Math.sin(0.7 * v); direction[3 * v + 2] = Math.cos(0.3 * v);
      expected += measured.gradient[v][0] * direction[3 * v] - measured.gradient[v][1] * direction[3 * v + 2];
    }
    const pose = w.x.slice(), h = 1e-6;
    const observe = (sign) => {
      const x = pose.map((v, i) => v + sign * h * direction[i]);
      w.xt.set(x); return implicitEnergy(w, x);
    };
    const fd = (observe(1) - observe(-1)) / (2 * h);
    const error = Math.abs(fd - expected) / Math.max(1, Math.abs(fd), Math.abs(expected));
    worst = Math.max(worst, error); checks++;
    assert.ok(error < 2e-6, `nodal derivative: ${error}`);
    assert.equal(w.framesRun, 0); assert.equal(w.substepsRun, 0);
  }
  assert.throws(() => makePatch({ cells: 0 }), /cells/);
  assert.throws(() => makePatch({ pattern: 'unknown' }), /pattern/);
  assert.throws(() => measureAffine(makePatch(), [0, 0, NaN]), /finite/);
  const stepped = makePatch(); stepped.world.framesRun = 1;
  assert.throws(() => measureAffine(stepped, [0, 0, 0]), /time stepped/);
  assert.throws(() => measureAffine(makePatch(), [-2, 0, 0]), /preserve orientation/);
  console.log(`membrane-patch: actual engine energy/gradient finite-difference checks=${checks}; worst relative error=${worst}; uncapped symmetric/default-compression and cap-control policies separate`);
});

test('refined biaxial observations retain runtime summation roundoff and reject inconsistent energy reporting', () => {
  let worst = 0;
  for (const [pattern, grain, strain] of [
    ['forward', 0, [1e-4, 1e-4, 0]],
    ['alternating', 0, [-2.5e-5, -2.5e-5, 0]],
    ['forward', 90, [2.5e-5, 2.5e-5, 0]],
  ]) {
    const p = makePatch({ cells: 16, pattern, grain });
    const observed = measureAffine(p, strain);
    assert.equal(observed.energy, implicitEnergy(p.world, p.world.x));
    assert.equal(observed.statsEnergyDelta, observed.statsEnergy - observed.energy);
    assert.equal(observed.statsEnergyScaledDelta, Math.abs(observed.statsEnergyDelta) / observed.statsEnergyScale);
    assert.equal(observed.statsAgreementTolerance, 1e-12);
    assert.ok(observed.statsEnergyScaledDelta <= observed.statsAgreementTolerance);
    assert.equal(observed.nonMembraneEnergy, 0);
    worst = Math.max(worst, observed.statsEnergyScaledDelta);
  }
  const p = makePatch({ cells: 16, pattern: 'alternating' });
  const stats = p.world.stats.bind(p.world);
  p.world.stats = () => {
    const value = stats(); value.energy.stretch += 1e-6 * Math.max(1, value.energy.stretch); return value;
  };
  assert.throws(() => measureAffine(p, [1e-4, 1e-4, 0]), /"cells":16.*"pattern":"alternating".*"delta":.*"scaledDelta":.*"tolerance":1e-12/);
  console.log(`membrane-patch: refined biaxial runtime energy summation agreement; worst scaled delta=${worst}; declared observation-only tolerance=1e-12; inconsistent report rejected`);
});
