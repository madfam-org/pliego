// Actual selected-law, in-plane static GN benchmark. No World stepping or 3D regularization.
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

const ABSOLUTE_FORCE_TOLERANCE = 1e-7, RELATIVE_FORCE_TOLERANCE = 1e-10;
const demand = (ok, message) => { if (!ok) throw new Error(`plane-stress-runtime: ${message}`); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const maxAbs = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function compensatedSum(terms) {
  let sum = 0, correction = 0;
  for (const value of terms) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}

/** Dead-load increment from ACTUAL binary64 World positions, never reconstructed u. */
function deadLoadIncrement(forces, before, after) {
  const terms = [];
  for (let i = 0; i < forces.length; i++) {
    terms.push(forces[i][0] * (after[3 * i] - before[3 * i]));
    terms.push(-forces[i][1] * (after[3 * i + 2] - before[3 * i + 2]));
  }
  return { difference: compensatedSum(terms), absoluteTermSum: compensatedSum(terms.map(Math.abs)) };
}

function residualIncrement(residual, before, after) {
  const terms = [];
  for (let i = 0; i < residual.length / 2; i++) {
    terms.push(residual[2 * i] * (after[3 * i] - before[3 * i]));
    terms.push(-residual[2 * i + 1] * (after[3 * i + 2] - before[3 * i + 2]));
  }
  return { difference: compensatedSum(terms), absoluteTermSum: compensatedSum(terms.map(Math.abs)) };
}

function rectangle(patch) {
  const xs = patch.vertices.map(p => p[0]), ys = patch.vertices.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  const tolerance = 1e-10 * Math.max(1, right - left, top - bottom);
  demand(right > left && top > bottom, 'nondegenerate rectangular patch required');
  return { left, right, bottom, top, tolerance };
}

/** Reference-boundary dead traction; benchmark constraints are not runtime joins.
 * Per-node forces and DOFs use sheet (u,v); world force is (fu,0,-fv).
 */
export function makeBoundary(patch, eta, boundary = 'clamped-left') {
  demand(finite(eta) && eta >= 0, 'eta must be finite and nonnegative');
  demand(['clamped-left', 'poisson-compatible'].includes(boundary), 'unknown boundary');
  const angle = ((patch.info.grain % 180) + 180) % 180;
  if (boundary === 'poisson-compatible') demand(Math.min(angle, Math.abs(angle - 90), 180 - angle) <= 1e-12, 'Poisson-compatible control requires aligned grain 0/90 modulo 180');
  const box = rectangle(patch), { left, right, bottom, top, tolerance } = box;
  const leftNodes = [], rightNodes = [], fixedDofs = [], forces = patch.vertices.map(() => [0, 0]);
  patch.vertices.forEach(([u], i) => {
    if (Math.abs(u - left) <= tolerance) leftNodes.push(i);
    if (Math.abs(u - right) <= tolerance) rightNodes.push(i);
  });
  demand(leftNodes.length === patch.info.cells + 1 && rightNodes.length === patch.info.cells + 1, 'complete rectangular edge-node coverage required');
  const anchors = leftNodes.filter(i => Math.abs(patch.vertices[i][1] - bottom) <= tolerance);
  demand(anchors.length === 1, 'unique left-bottom anchor required');
  for (const i of leftNodes) {
    fixedDofs.push(2 * i);
    if (boundary === 'clamped-left' || i === anchors[0]) fixedDofs.push(2 * i + 1);
  }
  fixedDofs.sort((a, b) => a - b);
  const fixed = new Set(fixedDofs), freeDofs = Array.from({ length: 2 * patch.vertices.length }, (_, i) => i).filter(i => !fixed.has(i));
  const edges = new Map();
  for (const t of patch.triangles) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
    const edge = edges.get(key);
    if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
  }
  const traction = eta * patch.material.E1, lineLoad = patch.material.thickness * traction;
  demand(finite(lineLoad), 'nonfinite boundary traction');
  const segments = [];
  for (const { a, b, count } of edges.values()) {
    demand(count <= 2, 'nonmanifold authored triangle edge');
    const pa = patch.vertices[a], pb = patch.vertices[b];
    if (count !== 1 || Math.abs(pa[0] - right) > tolerance || Math.abs(pb[0] - right) > tolerance) continue;
    const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    demand(length > tolerance, 'degenerate loaded boundary segment');
    forces[a][0] += lineLoad * length / 2; forces[b][0] += lineLoad * length / 2;
    segments.push({ vertices: [a, b], length, low: Math.min(pa[1], pb[1]), high: Math.max(pa[1], pb[1]) });
  }
  segments.sort((a, b) => a.low - b.low || a.high - b.high);
  demand(segments.length === patch.info.cells, 'complete right-edge segment coverage required');
  let covered = bottom;
  for (const segment of segments) { demand(Math.abs(segment.low - covered) <= tolerance, 'loaded boundary gap/overlap'); covered = segment.high; }
  demand(Math.abs(covered - top) <= tolerance, 'loaded boundary endpoint missing');
  const totalForce = forces.reduce((sum, f) => [sum[0] + f[0], sum[1] + f[1]], [0, 0]);
  const expected = lineLoad * (top - bottom);
  demand(Math.abs(totalForce[0] - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), 'boundary total force mismatch');
  return { boundary, eta, forces, fixedDofs, freeDofs, totalForce, traction, lineLoad,
    leftNodes, rightNodes, anchorNode: boundary === 'poisson-compatible' ? anchors[0] : null,
    loadedSegments: segments, coordinateToleranceMm: tolerance, referenceRectangle: box,
    convention: 'reference-boundary fixed-direction dead load; sheet force [fu,fv] maps to world [fu,0,-fv]; benchmark hard zero Dirichlet DOFs' };
}

function requirePatch(patch) {
  const w = patch.world;
  demand(w.orthotropicMembrane && w.opts.membraneModel === 'orthotropic-stvk', 'actual selected orthotropic-stvk World required');
  demand(w.framesRun === 0 && w.substepsRun === 0 && w.time === 0 && w.factorCount === 0, 'static adapter requires an unstepped, unfactored World');
  demand(!w.contact && !w.coupledContact && !w.motionGuard && !w.edgeContact && !w.opts.gravity && !w.opts.ground && !w.opts.plasticity, 'contact/gravity/plasticity must be absent');
  demand(!w.fixed.some(Boolean) && w.sys.nFree === w.mesh.nV, 'benchmark constraints must remain separate from runtime fixed vertices');
  demand(!w.driveOn.some(Boolean) && !w.terms.active.some(Boolean) && !w.userForce.some(Boolean) && !w.fext.some(Boolean) && !w.v.some(Boolean), 'runtime drives, forces and velocities must be absent');
  demand(w.mesh.nV === patch.vertices.length, 'native/reference vertex mismatch');
}

function field(value, count, name) {
  demand(Array.isArray(value) && value.length === count && value.every(p => Array.isArray(p) && p.length === 2 && p.every(finite)), `${name} must contain one finite [u,v] pair per node`);
}

/** Evaluate the actual full objective and gradient, with exactly zero inertia.
 * Does not solve or apply constraints. Invalid finite collapsed poses return valid:false.
 */
export function evaluateStatic(patch, displacement, forces) {
  requirePatch(patch); field(displacement, patch.vertices.length, 'displacement'); field(forces, patch.vertices.length, 'forces');
  const w = patch.world;
  for (let i = 0; i < patch.vertices.length; i++) {
    w.x[3 * i] = patch.vertices[i][0] + displacement[i][0]; w.x[3 * i + 1] = 0;
    w.x[3 * i + 2] = -(patch.vertices[i][1] + displacement[i][1]);
  }
  w.xt.set(w.x);
  const applied = patch.vertices.map(([u, v], i) => [w.x[3 * i] - u, -w.x[3 * i + 2] - v]);
  const energy = implicitEnergy(w, w.x), metric = w.orthotropicMembrane.diagnostics(w.x);
  const loadWork = applied.reduce((sum, u, i) => sum + forces[i][0] * u[0] + forces[i][1] * u[1], 0);
  if (!finite(energy) || !metric.finite) return { valid: false, energy: Infinity, potential: Infinity, loadWork, displacement: applied, metric };
  const stiffness = w.kMem.slice(), selected = w.orthotropicMembrane;
  let nonMembraneEnergy;
  try { w.kMem.fill(0); w.orthotropicMembrane = null; nonMembraneEnergy = implicitEnergy(w, w.x); }
  finally { w.kMem.set(stiffness); w.orthotropicMembrane = selected; }
  demand(nonMembraneEnergy === 0, 'nonzero non-membrane objective (no mass, bending, drive or penalty permitted)');
  demand(energy === selected.energy(w.x), 'full objective is not exactly the selected membrane energy');
  const actual = new Float64Array(w.x.length), selectedGradient = new Float64Array(w.x.length);
  gradient(w, w.x, actual); selected.addGradient(w.x, selectedGradient);
  let nonMembraneGradientMax = 0;
  for (let i = 0; i < actual.length; i++) {
    demand(finite(actual[i]) && finite(selectedGradient[i]), 'nonfinite actual gradient');
    nonMembraneGradientMax = Math.max(nonMembraneGradientMax, Math.abs(actual[i] - selectedGradient[i]));
  }
  demand(nonMembraneGradientMax === 0, 'nonzero non-membrane gradient');
  for (let i = 0; i < patch.vertices.length; i++) demand(w.x[3 * i + 1] === 0 && actual[3 * i + 1] === 0, 'out-of-plane static position/gradient');
  const nodalGradient = applied.map((_, i) => [actual[3 * i], -actual[3 * i + 2]]);
  const residual = nodalGradient.flatMap((g, i) => [g[0] - forces[i][0], g[1] - forces[i][1]]);
  return { valid: true, displacement: applied, energy, loadWork, potential: energy - loadWork,
    gradient: nodalGradient, residual, nonMembraneEnergy, nonMembraneGradientMax, metric };
}

/** Restrict actual assembled runtime membrane GN blocks BEFORE solving.
 * Returns a dense 2*nV matrix. No full-3D factor, inertia, hinge or diagonal regularizer.
 */
export function assembleRestrictedGN(patch) {
  requirePatch(patch);
  const w = patch.world, ch = w.sys.ch, n = 2 * w.mesh.nV;
  demand(ch, 'runtime sparse storage required'); ch.clear();
  w.orthotropicMembrane.addGaussNewtonBlocks(w, w.x, ch);
  const matrix = Array.from({ length: n }, () => new Float64Array(n));
  const vertexOfFree = new Int32Array(w.sys.nFree);
  for (let v = 0; v < w.mesh.nV; v++) vertexOfFree[w.sys.freeIdx[v]] = v;
  const components = [0, 2], sign = [1, -1];
  for (let c = 0; c < ch.n; c++) for (let p = ch.Ap[c]; p < ch.Ap[c + 1]; p++) {
    const row = ch.Ai[p], i = vertexOfFree[ch.perm[row]], j = vertexOfFree[ch.perm[c]];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const value = sign[a] * sign[b] * ch.Ax[9 * p + 3 * components[a] + components[b]];
      demand(finite(value), 'nonfinite actual GN block'); matrix[2 * i + a][2 * j + b] += value;
      if (row !== c) matrix[2 * j + b][2 * i + a] += value;
    }
  }
  return matrix;
}

/** Deterministic dense partial-pivot elimination; exact lowest-index tie rule.
 * No inverse, damping, stiffness rescaling, regularization or alternate solver.
 */
export function solveDense(matrix, rhs, relativePivotTolerance = 1e-14) {
  const n = rhs.length;
  demand(n > 0 && matrix.length === n && matrix.every(row => row.length === n && Array.from(row).every(finite)) && Array.from(rhs).every(finite), 'finite square linear system required');
  const a = matrix.map(row => Float64Array.from(row)), b = Float64Array.from(rhs);
  const scale = Math.max(...a.map(row => maxAbs(row)));
  demand(scale > 0 && finite(relativePivotTolerance) && relativePivotTolerance > 0, 'positive finite pivot scale/tolerance required');
  // Skipping zero products can change an existing -0 matrix entry's sign.
  // Retain the straightforward path for that uncommon input domain. From an
  // initially +0-only finite matrix, subtraction cannot create a new -0 entry.
  const signedZeroMatrix = a.some(row => row.some(value => Object.is(value, -0)));
  let minimumRelativePivot = Infinity;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    const magnitude = Math.abs(a[pivot][k]); minimumRelativePivot = Math.min(minimumRelativePivot, magnitude / scale);
    demand(magnitude > relativePivotTolerance * scale, 'rank-deficient or ill-conditioned reduced GN matrix');
    if (pivot !== k) { [a[pivot], a[k]] = [a[k], a[pivot]]; const v = b[pivot]; b[pivot] = b[k]; b[k] = v; }
    const pivotRow = a[k], pivotRhs = b[k];
    // Do not hide an intermediate overflow by skipping 0*Infinity/NaN.
    const skipZeroProducts = !signedZeroMatrix && pivotRow.every(finite);
    for (let i = k + 1; i < n; i++) {
      const row = a[i], exactZero = row[k] === 0;
      const multiplier = row[k] / pivotRow[k]; row[k] = 0;
      if (!exactZero || !skipZeroProducts) for (let j = k + 1; j < n; j++) row[j] -= multiplier * pivotRow[j];
      // Preserve this update even for zero multipliers: the RHS may contain -0.
      b[i] -= multiplier * pivotRhs;
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

/** Minimize actual U_runtime(u)-f.u in the planar subspace, hard zero benchmark clamp.
 * Failure is returned explicitly with the final exact residual and complete iteration trace.
 */
export function solveStatic(patch, { forces, fixedDofs, maxIterations = 100, maxBacktracks = 30,
  initialDisplacement, armijo = 1e-4, relativePivotTolerance = 1e-14, lineSearchMode = 'total-potential' } = {}) {
  requirePatch(patch); const n = 2 * patch.vertices.length;
  field(forces, n / 2, 'forces');
  demand(Array.isArray(fixedDofs) && fixedDofs.length > 0 && fixedDofs.every(i => Number.isInteger(i) && i >= 0 && i < n) && new Set(fixedDofs).size === fixedDofs.length, 'unique in-range fixed DOFs required');
  demand(Number.isInteger(maxIterations) && maxIterations >= 0 && maxIterations <= 100 && Number.isInteger(maxBacktracks) && maxBacktracks >= 0 && maxBacktracks <= 60, 'invalid bounded solver budget');
  demand(finite(armijo) && armijo > 0 && armijo < 0.5, 'invalid Armijo coefficient');
  demand(['total-potential', 'energy-difference'].includes(lineSearchMode), 'unknown line-search mode');
  if (lineSearchMode === 'energy-difference') demand(typeof patch.world.orthotropicMembrane.energyDifferenceDetails === 'function', 'runtime selected-law energy-difference method required');
  const fixed = new Set(fixedDofs), freeDofs = Array.from({ length: n }, (_, i) => i).filter(i => !fixed.has(i));
  const start = initialDisplacement ? initialDisplacement.map(p => p.slice()) : patch.vertices.map(() => [0, 0]);
  field(start, n / 2, 'initialDisplacement');
  demand(fixedDofs.every(i => start[Math.floor(i / 2)][i % 2] === 0), 'nonzero initial hard Dirichlet value');
  const forceScale = Math.max(...forces.map(f => Math.hypot(...f)));
  const threshold = Math.max(ABSOLUTE_FORCE_TOLERANCE, RELATIVE_FORCE_TOLERANCE * forceScale);
  const trace = []; let current = evaluateStatic(patch, start, forces), status = 'iteration-limit', error = null;
  let converged = false, backtracks = 0, invalidTrials = 0, rejections = 0;
  for (let iteration = 0; ; iteration++) {
    if (!current.valid) { status = 'invalid-initial-pose'; break; }
    const residual = Math.max(0, ...freeDofs.map(i => Math.abs(current.residual[i])));
    if (residual <= threshold) { status = 'converged'; converged = true; break; }
    if (iteration >= maxIterations) break;
    const before = current, entry = { iteration, freeResidualBefore: residual, energyBefore: before.energy,
      potentialBefore: before.potential, accepted: false, alpha: 0, backtracks: 0, invalidTrials: 0,
      acceptanceBasis: lineSearchMode, zeroActualTrials: 0, nonDescentActualTrials: 0 };
    const beforePositions = patch.world.x.slice();
    trace.push(entry);
    let linear;
    try {
      const matrix = assembleRestrictedGN(patch), reduced = freeDofs.map(i => Float64Array.from(freeDofs, j => matrix[i][j]));
      linear = solveDense(reduced, Float64Array.from(freeDofs, i => -before.residual[i]), relativePivotTolerance);
    } catch (cause) { status = 'linear-solve-failed'; error = cause.message; break; }
    Object.assign(entry, { linearResidual: linear.linearResidual, relativeLinearResidual: linear.relativeLinearResidual,
      minimumRelativePivot: linear.minimumRelativePivot, matrixScale: linear.matrixScale });
    if (linear.relativeLinearResidual > 1e-9) { status = 'linear-solve-failed'; error = 'reduced GN relative linear residual exceeds 1e-9'; break; }
    const delta = new Float64Array(n);
    for (let i = 0; i < freeDofs.length; i++) delta[freeDofs[i]] = linear.solution[i];
    const slope = freeDofs.reduce((sum, i) => sum + before.residual[i] * delta[i], 0); entry.slope = slope;
    if (!(finite(slope) && slope < 0)) { status = 'non-descent-direction'; break; }
    const allowance = 64 * Number.EPSILON * Math.max(1, Math.abs(before.potential), Math.abs(before.energy), Math.abs(before.loadWork));
    entry.armijoRoundoffAllowance = allowance; entry.rawArmijoRoundoffAllowance = allowance;
    for (let trial = 0; trial <= maxBacktracks; trial++) {
      entry.attempts = trial + 1; entry.backtracks = trial;
      const alpha = 2 ** -trial;
      const proposal = before.displacement.map((u, v) => u.map((value, c) => fixed.has(2 * v + c) ? 0 : value + alpha * delta[2 * v + c]));
      const candidate = evaluateStatic(patch, proposal, forces);
      if (!candidate.valid) { entry.invalidTrials++; invalidTrials++; }
      const rawDifference = candidate.potential - before.potential;
      const increment = candidate.valid && typeof patch.world.orthotropicMembrane.energyDifferenceDetails === 'function'
        ? patch.world.orthotropicMembrane.energyDifferenceDetails(beforePositions, patch.world.x) : null;
      const workIncrement = deadLoadIncrement(forces, beforePositions, patch.world.x);
      const firstOrder = residualIncrement(before.residual, beforePositions, patch.world.x);
      const zeroActualStep = patch.world.x.every((value, i) => value === beforePositions[i]);
      if (zeroActualStep) entry.zeroActualTrials++;
      else if (!(firstOrder.difference < 0)) entry.nonDescentActualTrials++;
      const available = increment?.valid && finite(increment.remainder) && finite(increment.absoluteRemainderTermSum);
      // Exact same StVK/dead-load polynomial, regrouped around the old pose:
      // Pi_new-Pi_old = (g_old-f).actualDelta + nonlinear energy remainder.
      // Avoid both full-U subtraction and cancellation of large linear internal/work terms.
      const stableDifference = available ? compensatedSum([firstOrder.difference, increment.remainder]) : null;
      const energyMinusWork = increment?.valid ? compensatedSum([increment.difference, -workIncrement.difference]) : null;
      // Arithmetic-scale allowance, not a rigorous interval error bound. No
      // absolute floor or full-energy scale: identical poses have zero allowance.
      const incrementAllowance = available ? 64 * Number.EPSILON *
        (increment.absoluteRemainderTermSum + firstOrder.absoluteTermSum + Math.abs(stableDifference)) : null;
      Object.assign(entry, { rawPotentialDifference: finite(rawDifference) ? rawDifference : null,
        stablePotentialDifference: stableDifference, rawMinusStablePotentialDifference: stableDifference === null || !finite(rawDifference) ? null : rawDifference - stableDifference,
        stableInternalEnergyDifference: increment?.valid ? increment.difference : null,
        stableDeadLoadWorkDifference: workIncrement.difference,
        energyMinusDeadWorkDifference: energyMinusWork, residualDotActualStep: firstOrder.difference,
        actualStepSlope: firstOrder.difference, nominalStepSlope: alpha * slope, zeroActualStep,
        nonlinearEnergyRemainder: available ? increment.remainder : null,
        incrementAbsoluteTermSum: available ? increment.absoluteRemainderTermSum + firstOrder.absoluteTermSum : null,
        incrementRoundoffAllowance: incrementAllowance });
      if (lineSearchMode === 'energy-difference') entry.armijoRoundoffAllowance = incrementAllowance;
      const acceptable = lineSearchMode === 'total-potential'
        ? candidate.potential <= before.potential + armijo * alpha * slope + allowance
        : available && !zeroActualStep && firstOrder.difference < 0 && finite(stableDifference) &&
          stableDifference <= armijo * firstOrder.difference + incrementAllowance;
      if (candidate.valid && acceptable) {
        Object.assign(entry, { accepted: true, alpha, backtracks: trial, energyAfter: candidate.energy,
          potentialAfter: candidate.potential, freeResidualAfter: Math.max(0, ...freeDofs.map(i => Math.abs(candidate.residual[i]))) });
        current = candidate; backtracks += trial; break;
      }
    }
    if (!entry.accepted) {
      status = lineSearchMode === 'energy-difference' && entry.zeroActualTrials === entry.attempts ? 'precision-limited' : 'line-search-rejected';
      rejections++; backtracks += entry.backtracks; current = evaluateStatic(patch, before.displacement, forces); break;
    }
  }
  const freeResidualMax = current.valid ? Math.max(0, ...freeDofs.map(i => Math.abs(current.residual[i]))) : null;
  const reactions = current.valid ? patch.vertices.map((_, v) => [0, 1].map(c => fixed.has(2 * v + c) ? current.residual[2 * v + c] : 0)) : null;
  const fixedExact = current.displacement.every((u, v) => u.every((value, c) => !fixed.has(2 * v + c) || value === 0));
  return { schema: 'pliego-plane-stress-runtime/0.1', converged, status, error, iterations: trace.filter(t => t.accepted).length,
    displacement: current.displacement, reaction: reactions, gradient: current.gradient ?? null, residual: current.residual ?? null,
    energy: current.energy, loadWork: current.loadWork, potential: current.potential, metric: current.metric,
    residualInfinity: freeResidualMax, forceTolerance: threshold, forceScale,
    relativeFreeResidual: forceScale > 0 && freeResidualMax !== null ? freeResidualMax / forceScale : null,
    absoluteForceTolerance: ABSOLUTE_FORCE_TOLERANCE, relativeForceTolerance: RELATIVE_FORCE_TOLERANCE,
    forceScaleDefinition: 'maximum nodal Euclidean applied force, microN', fixedDofs: [...fixedDofs].sort((a, b) => a - b), freeDofs,
    fixedExact, planarExact: Array.from(patch.world.x).every((value, i) => i % 3 !== 1 || value === 0),
    nonMembraneEnergy: current.nonMembraneEnergy ?? null, nonMembraneGradientMax: current.nonMembraneGradientMax ?? null,
    initialPose: initialDisplacement ? 'provided; caller must label continuation' : 'zero displacement for each load',
    maxIterations, maxBacktracks, armijo, relativePivotTolerance, linearRelativeTolerance: 1e-9, lineSearchMode,
    incrementAllowanceConvention: '64*EPS*(runtime absolute nonlinear-remainder term sum + absolute exact-residual/actual-step dot terms + absolute stable potential increment); arithmetic diagnostic, not an interval certificate; no full-potential scale or absolute floor; stable change=(g_old-f).actualDelta+runtime remainder',
    attemptedDirections: trace.length, backtracks, invalidTrials, rejections, trace,
    steps: patch.world.substepsRun, frames: patch.world.framesRun, time: patch.world.time,
    scope: 'actual runtime energy/exact gradient/GN blocks restricted to planar static DOFs; no 3D factorization, timestep, inertia, bending work, artificial stiffness, fallback, physical-stock or buckling validation' };
}
