import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch } from '../bench/membrane-patch.mjs';
import { makeBoundary, evaluateStatic, assembleRestrictedGN, solveDense, solveStatic } from '../bench/plane-stress-runtime.mjs';

const patch = (options = {}) => makePatch({ cells: 2, pattern: 'alternating', grain: 0,
  membraneModel: 'orthotropic-stvk', membraneNu12: 0.293, ...options });
const maximum = values => Math.max(0, ...values.map(Math.abs));
const zero = p => p.vertices.map(() => [0, 0]);

test('static boundary integrates reference dead traction and declares complete hard clamp/compatible control', () => {
  for (const pattern of ['forward', 'alternating', 'perturbed']) {
    const p = patch({ cells: 4, pattern }), b = makeBoundary(p, 1e-4);
    assert.equal(b.leftNodes.length, 5); assert.equal(b.rightNodes.length, 5);
    assert.equal(b.fixedDofs.length, 10); assert.equal(b.loadedSegments.length, 4);
    assert.equal(b.freeDofs.length + b.fixedDofs.length, 2 * p.vertices.length);
    const expected = p.material.thickness * p.material.E1 * 1e-4 * 40;
    assert.equal(b.totalForce[0], expected); assert.equal(b.totalForce[1], 0);
    for (const v of b.rightNodes) {
      const corner = p.vertices[v][1] === 0 || p.vertices[v][1] === 40;
      assert.equal(b.forces[v][0], expected / 4 * (corner ? 0.5 : 1)); assert.equal(b.forces[v][1], 0);
    }
    const c = makeBoundary(p, 1e-4, 'poisson-compatible');
    assert.equal(c.fixedDofs.length, 6); assert.equal(c.fixedDofs.filter(d => d % 2).length, 1);
  }
  assert.throws(() => makeBoundary(patch({ grain: 30 }), 1e-4, 'poisson-compatible'), /aligned grain/);
  assert.throws(() => makeBoundary(patch(), -1), /eta/);
  console.log('plane-stress-boundary: three authored topology families; half-segment endpoint loads, full left clamp and aligned Poisson-control masks exact');
});

test('static 2D restriction matches actual selected-law GN operator without mass, bending or full 3D factorization', () => {
  let worst = 0;
  for (const grain of [0, 30, 90]) for (const nonzero of [false, true]) {
    const p = patch({ grain, pattern: 'perturbed' }), boundary = makeBoundary(p, 1e-4);
    const displacement = zero(p).map((u, v) => u.map((_, c) => nonzero ? 0.001 * Math.sin(0.2 + 2 * v + c) : 0));
    evaluateStatic(p, displacement, boundary.forces);
    const matrix = assembleRestrictedGN(p), fixed = new Set(boundary.fixedDofs);
    const direction = Array.from({ length: matrix.length }, (_, i) => fixed.has(i) ? 0 : Math.cos(i * 0.3));
    const worldDirection = new Float64Array(3 * p.vertices.length), worldProduct = worldDirection.slice();
    for (let v = 0; v < p.vertices.length; v++) { worldDirection[3 * v] = direction[2 * v]; worldDirection[3 * v + 2] = -direction[2 * v + 1]; }
    p.world.orthotropicMembrane.addGaussNewtonTimes(p.world.x, worldDirection, worldProduct);
    const expected = direction.map((_, i) => i % 2 ? -worldProduct[3 * Math.floor(i / 2) + 2] : worldProduct[3 * Math.floor(i / 2)]);
    const actual = matrix.map(row => row.reduce((sum, value, i) => sum + value * direction[i], 0));
    const scale = Math.max(1, maximum(expected)), error = maximum(actual.map((v, i) => v - expected[i])) / scale;
    worst = Math.max(worst, error); assert.ok(error < 1e-12);
    for (let i = 0; i < matrix.length; i++) for (let j = 0; j < matrix.length; j++) assert.ok(Math.abs(matrix[i][j] - matrix[j][i]) / scale < 1e-12);
    const before = matrix.map(row => Array.from(row)); p.world.dt *= 17;
    assert.deepEqual(assembleRestrictedGN(p).map(row => Array.from(row)), before, 'no inertial mass/dt² may enter static matrix');
    assert.equal(p.world.factorCount, 0); assert.equal(p.world.sys.ch.factored, false);
  }
  console.log(`plane-stress-restriction: actual runtime sparse blocks/operator, free-clamp directions, rotated materials and deformed poses; maximum error=${worst}; zero full-3D factors`);
});

test('actual static potential gradient includes exact dead-load work and sheet/world sign mapping', () => {
  const p = patch({ grain: 30 }), b = makeBoundary(p, 1e-4), forces = b.forces.map((f, i) => [f[0], 17 * Math.cos(i)]);
  const u = zero(p).map((row, i) => row.map((_, c) => 0.0002 * Math.sin(2 * i + c)));
  const measured = evaluateStatic(p, u, forces), d = measured.residual.map((_, i) => Math.cos(0.2 + i)), h = 1e-6;
  const a = u.map((row, i) => row.map((v, c) => v + h * d[2 * i + c]));
  const z = u.map((row, i) => row.map((v, c) => v - h * d[2 * i + c]));
  const fd = (evaluateStatic(p, a, forces).potential - evaluateStatic(p, z, forces).potential) / (2 * h);
  const slope = measured.residual.reduce((sum, r, i) => sum + r * d[i], 0);
  const error = Math.abs(fd - slope) / Math.max(1, Math.abs(fd), Math.abs(slope));
  assert.ok(error < 1e-6, `total potential FD=${error}`);
  assert.equal(measured.nonMembraneEnergy, 0); assert.equal(measured.nonMembraneGradientMax, 0);
  assert.equal(measured.potential, measured.energy - measured.loadWork);
  const collapsed = p.vertices.map(([x, y]) => [-x, -y]);
  assert.equal(evaluateStatic(p, collapsed, forces).valid, false);
  console.log(`plane-stress-objective: actual full objective and gradient, exact zero non-membrane contribution; dead-load directional FD=${error}; collapsed trial invalid`);
});

test('hard-left-clamped static GN solves a genuine non-affine field with exact fixed/Y coordinates and support balance', () => {
  const p = patch(), b = makeBoundary(p, 1e-4), result = solveStatic(p, b);
  assert.equal(result.status, 'converged'); assert.equal(result.converged, true);
  assert.ok(result.residualInfinity <= result.forceTolerance); assert.ok(result.iterations > 0);
  assert.equal(result.fixedExact, true); assert.equal(result.planarExact, true);
  assert.equal(result.steps, 0); assert.equal(result.frames, 0); assert.equal(result.time, 0);
  const sum = result.reaction.reduce((s, r, i) => [s[0] + r[0] + b.forces[i][0], s[1] + r[1] + b.forces[i][1]], [0, 0]);
  const relativeForceBalance = Math.hypot(...sum) / Math.hypot(...b.totalForce);
  assert.ok(relativeForceBalance < 1e-10);
  const moment = result.reaction.reduce((sum, r, i) => {
    const u = p.vertices[i][0] + result.displacement[i][0], v = p.vertices[i][1] + result.displacement[i][1];
    return sum + u * (r[1] + b.forces[i][1]) - v * (r[0] + b.forces[i][0]);
  }, 0);
  assert.ok(Math.abs(moment) / (Math.hypot(...b.totalForce) * 40) < 1e-10);
  const right = b.rightNodes.slice().sort((a, c) => p.vertices[a][1] - p.vertices[c][1]);
  const transverseVariation = Math.abs(result.displacement[right.at(-1)][1] - result.displacement[right[0]][1]);
  assert.ok(transverseVariation > 1e-3 * maximum(result.displacement.flat()), 'full left clamp forbids an affine field with varying transverse displacement on the right');
  const fixed = new Set(b.fixedDofs);
  result.reaction.forEach((r, v) => r.forEach((value, c) => { if (!fixed.has(2 * v + c)) assert.equal(value, 0); }));
  for (const entry of result.trace) {
    assert.equal(entry.accepted, true); assert.ok(entry.slope < 0); assert.ok(entry.relativeLinearResidual <= 1e-9);
    assert.ok(entry.potentialAfter <= entry.potentialBefore + result.armijo * entry.alpha * entry.slope + entry.armijoRoundoffAllowance);
  }
  assert.equal(p.world.factorCount, 0); assert.equal(p.world.sys.ch.factored, false);
  console.log(`plane-stress-nonaffine: actual selected-law static GN iterations=${result.iterations}, exact free residual=${result.residualInfinity} <=${result.forceTolerance}; support balance=${relativeForceBalance}; hard clamp/Y exact`);
});

test('static solves reset to zero and replay exactly; exhausted and rank-deficient solves remain visible failures', () => {
  const p = patch({ grain: 45, pattern: 'perturbed' }), b = makeBoundary(p, 5e-5);
  const first = solveStatic(p, b), second = solveStatic(p, b);
  assert.deepEqual(second, first); assert.equal(first.initialPose, 'zero displacement for each load');
  const exhausted = solveStatic(p, { ...b, maxIterations: 0 });
  assert.equal(exhausted.converged, false); assert.equal(exhausted.status, 'iteration-limit');
  assert.ok(exhausted.residualInfinity > exhausted.forceTolerance); assert.equal(exhausted.iterations, 0);
  assert.deepEqual(exhausted.displacement, zero(p));
  const deficient = solveStatic(p, { forces: b.forces, fixedDofs: [0] });
  assert.equal(deficient.converged, false); assert.equal(deficient.status, 'linear-solve-failed');
  assert.match(deficient.error, /rank-deficient|ill-conditioned/); assert.equal(p.world.factorCount, 0);
  assert.throws(() => solveDense([[0, 0], [0, 0]], [1, 2]), /pivot scale/);
  assert.throws(() => solveStatic(p, { ...b, fixedDofs: [0, 0] }), /fixed DOFs/);
  console.log(`plane-stress-replay: deterministic zero-start solve status=${first.status}; iteration exhaustion and missing rigid-mode constraints fail visibly, no stiffness/fallback`);
});

test('selected-law energy remainder resolves total-potential Armijo cancellation without changing force gates or initial fields', () => {
  const p = patch({ pattern: 'forward', grain: 0 }), b = makeBoundary(p, 1e-4);
  const legacy = solveStatic(p, b);
  const stable = solveStatic(p, { ...b, lineSearchMode: 'energy-difference' });
  assert.equal(legacy.lineSearchMode, 'total-potential');
  assert.equal(legacy.converged, false); assert.equal(legacy.status, 'iteration-limit');
  assert.ok(legacy.residualInfinity > legacy.forceTolerance);
  assert.equal(stable.converged, true); assert.equal(stable.status, 'converged');
  assert.ok(stable.residualInfinity <= stable.forceTolerance);
  assert.equal(stable.forceTolerance, legacy.forceTolerance);
  assert.equal(stable.absoluteForceTolerance, legacy.absoluteForceTolerance);
  assert.equal(stable.relativeForceTolerance, legacy.relativeForceTolerance);
  assert.equal(stable.maxIterations, legacy.maxIterations); assert.equal(stable.initialPose, legacy.initialPose);
  assert.equal(stable.fixedExact, true); assert.equal(stable.planarExact, true);
  assert.ok(legacy.trace.some(t => Math.abs(t.rawMinusStablePotentialDifference) > 1e-12));
  for (const t of stable.trace) {
    assert.equal(t.acceptanceBasis, 'energy-difference'); assert.equal(t.zeroActualStep, false);
    assert.ok(t.actualStepSlope < 0);
    assert.ok(t.stablePotentialDifference <= stable.armijo * t.actualStepSlope + t.incrementRoundoffAllowance);
    assert.equal(t.armijoRoundoffAllowance, t.incrementRoundoffAllowance);
    assert.ok(t.incrementRoundoffAllowance <= 64 * Number.EPSILON *
      (t.incrementAbsoluteTermSum + Math.abs(t.stablePotentialDifference)));
  }
  assert.deepEqual(solveStatic(p, { ...b, lineSearchMode: 'energy-difference' }), stable);
  assert.throws(() => solveStatic(p, { ...b, lineSearchMode: 'unknown' }), /line-search mode/);
  console.log(`plane-stress-increment: same actual law/load/clamp/zero-start/budget; total-potential status=${legacy.status}, residual=${legacy.residualInfinity}; exact runtime remainder mode=${stable.status}, residual=${stable.residualInfinity} <=${stable.forceTolerance}; no force-gate relaxation`);
});

// Retained straightforward algorithm: independent control for the exact-zero
// loop optimization, including every arithmetic association and diagnostic.
function straightforwardDense(matrix, rhs, relativePivotTolerance = 1e-14) {
  const demand = (ok, message) => { if (!ok) throw new Error(`plane-stress-runtime: ${message}`); };
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const maxAbs = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const n = rhs.length;
  demand(n > 0 && matrix.length === n && matrix.every(row => row.length === n && Array.from(row).every(finite)) && Array.from(rhs).every(finite), 'finite square linear system required');
  const a = matrix.map(row => Float64Array.from(row)), b = Float64Array.from(rhs);
  const scale = Math.max(...a.map(row => maxAbs(row)));
  demand(scale > 0 && finite(relativePivotTolerance) && relativePivotTolerance > 0, 'positive finite pivot scale/tolerance required');
  let minimumRelativePivot = Infinity;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    const magnitude = Math.abs(a[pivot][k]); minimumRelativePivot = Math.min(minimumRelativePivot, magnitude / scale);
    demand(magnitude > relativePivotTolerance * scale, 'rank-deficient or ill-conditioned reduced GN matrix');
    if (pivot !== k) { [a[pivot], a[k]] = [a[k], a[pivot]]; const v = b[pivot]; b[pivot] = b[k]; b[k] = v; }
    for (let i = k + 1; i < n; i++) {
      const multiplier = a[i][k] / a[k][k]; a[i][k] = 0;
      for (let j = k + 1; j < n; j++) a[i][j] -= multiplier * a[k][j];
      b[i] -= multiplier * b[k];
    }
  }
  const solution = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let value = b[i]; for (let j = i + 1; j < n; j++) value -= a[i][j] * solution[j];
    solution[i] = value / a[i][i]; demand(finite(solution[i]), 'nonfinite reduced GN solution');
  }
  let linearResidual = 0;
  for (let i = 0; i < n; i++) {
    let value = -rhs[i]; for (let j = 0; j < n; j++) value += matrix[i][j] * solution[j];
    linearResidual = Math.max(linearResidual, Math.abs(value));
  }
  return { solution, minimumRelativePivot, matrixScale: scale, linearResidual,
    relativeLinearResidual: linearResidual / Math.max(maxAbs(rhs), Number.MIN_VALUE), relativePivotTolerance };
}

test('exact-zero elimination and cached rows preserve bitwise dense outputs on actual restricted meshes and signed-zero/pivot/domain controls', () => {
  let meshCases = 0, controls = 0, negativeZeroSolutions = 0;
  const compare = (matrix, rhs) => {
    const before = matrix.map(row => Array.from(row)), oldRhs = Array.from(rhs);
    const expected = straightforwardDense(matrix, rhs), actual = solveDense(matrix, rhs);
    assert.deepEqual(actual, expected);
    assert.deepEqual(new Uint8Array(actual.solution.buffer), new Uint8Array(expected.solution.buffer));
    for (let i = 0; i < actual.solution.length; i++) {
      assert.equal(Object.is(actual.solution[i], -0), Object.is(expected.solution[i], -0));
      if (Object.is(expected.solution[i], -0)) negativeZeroSolutions++;
    }
    assert.deepEqual(matrix.map(row => Array.from(row)), before); assert.deepEqual(Array.from(rhs), oldRhs);
  };
  for (const cells of [2, 4, 8]) for (const pattern of ['forward', 'alternating', 'perturbed']) for (const grain of [0, 30, 45, 90]) {
    const p = patch({ cells, pattern, grain }), bc = makeBoundary(p, 2.5e-5);
    const fixed = new Set(bc.fixedDofs);
    const u = p.vertices.map(([x, y], i) => [0, 1].map(c => fixed.has(2 * i + c) ? 0 :
      2.5e-5 * (c ? -0.293 * y : x) + 1e-6 * Math.sin(0.7 * i + c)));
    const observed = evaluateStatic(p, u, bc.forces), matrix = assembleRestrictedGN(p);
    compare(bc.freeDofs.map(i => Float64Array.from(bc.freeDofs, j => matrix[i][j])),
      Float64Array.from(bc.freeDofs, i => -observed.residual[i]));
    meshCases++;
  }
  for (const [matrix, rhs] of [
    [[[0, 2, 1], [1, -2, -3], [2, 3, 1]], [3, 0, 7]],
    [[[2, 0, 0], [0, 3, 0], [0, 0, 4]], [-0, 0, -0]],
    [[[2, -0, 0], [-0, 3, -0], [0, -0, 4]], [-0, 0, -0]],
    [[[-2, 0, 0], [0, -3, 0], [0, 0, -4]], [0, -0, 0]],
    [[[1e308, 1], [1e-300, 1e308]], [1, 0]],
    [[[1e308, -1e308], [1e308, 1e308]], [1, 2]],
  ]) { compare(matrix, rhs); controls++; }
  for (const [matrix, rhs] of [
    [[[0, 0], [0, 0]], [1, 2]],
    [[[1, 2], [2, 4]], [1, 2]],
    [[[1, 0], [0, 1e-15]], [1, 2]],
    [[[Infinity, 0], [0, 1]], [1, 2]],
  ]) {
    let oldError, currentError;
    try { straightforwardDense(matrix, rhs); } catch (error) { oldError = error.message; }
    try { solveDense(matrix, rhs); } catch (error) { currentError = error.message; }
    assert.equal(typeof oldError, 'string'); assert.equal(currentError, oldError); controls++;
  }
  assert.ok(negativeZeroSolutions > 0, 'signed-zero output controls must actually exercise -0');
  console.log(`plane-stress-dense: actual restricted mesh cases=${meshCases}; pivot/signed-zero/underflow/overflow/rank controls=${controls}; all solution bytes and diagnostics unchanged; negative-zero outputs checked=${negativeZeroSolutions}; inputs preserved`);
});
