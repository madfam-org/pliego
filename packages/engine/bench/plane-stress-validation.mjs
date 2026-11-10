// Independent measurement/acceptance validation; no constitutive or solver imports.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const pairField = (value, n) => Array.isArray(value) && value.length === n && value.every(p => Array.isArray(p) && p.length === 2 && p.every(finite));
const integer = value => Number.isInteger(value) && value >= 0;
const eps = Number.EPSILON;
function sum(values) {
  let value = 0, correction = 0;
  for (const x of values) { const next = value + x; correction += Math.abs(value) >= Math.abs(x) ? (value - next) + x : (x - next) + value; value = next; }
  return value + correction;
}

/** Preserve finite nonconvergence as valid diagnostics, but never as convergence.
 * patch.world is optional; when present, independently checks the actual live pose.
 */
export function validateRuntime(patch, bc, runtime, { solver = {}, lineSearchMode } = {}) {
  const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  const n = patch?.vertices?.length ?? 0, total = 2 * n;
  const mode = lineSearchMode ?? runtime?.lineSearchMode;
  const forceValid = pairField(bc?.forces, n), fixed = bc?.fixedDofs;
  const fixedValid = Array.isArray(fixed) && fixed.length > 0 && fixed.every(i => integer(i) && i < total) && new Set(fixed).size === fixed.length;
  check(n > 0 && forceValid && fixedValid, 'invalid common boundary/mesh inputs');
  check(!!runtime && typeof runtime === 'object', 'missing runtime observation');
  if (!runtime || !forceValid || !fixedValid || n === 0) return { valid: false, converged: false, errors, computedResidualInfinity: null, computedForceTolerance: null };
  const fixedSet = new Set(fixed), fixedSorted = [...fixed].sort((a, b) => a - b);
  const free = Array.from({ length: total }, (_, i) => i).filter(i => !fixedSet.has(i));
  check(same(bc.freeDofs, free), 'boundary free DOFs are not the fixed-mask complement');
  check(same(runtime.fixedDofs, fixedSorted), 'actual solver fixed DOFs differ from boundary');
  check(same(runtime.freeDofs, free), 'actual solver free DOFs differ from boundary');
  const forceScale = Math.max(...bc.forces.map(f => Math.hypot(...f)));
  const forceTolerance = Math.max(1e-7, 1e-10 * forceScale);
  check(runtime.forceScale === forceScale, 'incorrect actual force scale');
  check(runtime.absoluteForceTolerance === 1e-7 && runtime.relativeForceTolerance === 1e-10, 'force tolerances differ from declared protocol');
  check(runtime.forceTolerance === forceTolerance, 'incorrect actual force threshold');
  check(['total-potential', 'energy-difference'].includes(mode) && runtime.lineSearchMode === mode, 'actual line-search mode differs from protocol');
  for (const key of ['maxIterations', 'maxBacktracks', 'armijo', 'relativePivotTolerance']) {
    if (solver[key] !== undefined) check(runtime[key] === solver[key], 'actual solver ' + key + ' differs from protocol');
  }
  check(integer(runtime.maxIterations) && runtime.maxIterations <= 100, 'invalid iteration budget');
  check(integer(runtime.maxBacktracks) && runtime.maxBacktracks <= 60, 'invalid backtracking budget');
  check(finite(runtime.armijo) && runtime.armijo > 0 && runtime.armijo < 0.5, 'invalid Armijo coefficient');
  check(runtime.linearRelativeTolerance === 1e-9, 'changed direction-solve residual tolerance');
  check(runtime.initialPose === 'zero displacement for each load', 'unexpected initial pose/continuation');
  check(runtime.steps === 0 && runtime.frames === 0 && runtime.time === 0, 'time stepping entered static observation');
  check(runtime.nonMembraneEnergy === 0 && runtime.nonMembraneGradientMax === 0, 'nonzero non-membrane contribution');
  for (const key of ['energy', 'loadWork', 'potential']) check(finite(runtime[key]), 'nonfinite ' + key);
  const displacementValid = pairField(runtime.displacement, n), gradientValid = pairField(runtime.gradient, n), reactionValid = pairField(runtime.reaction, n);
  check(displacementValid, 'invalid displacement field'); check(gradientValid, 'invalid exact gradient field'); check(reactionValid, 'invalid reaction field');
  let computedResidualInfinity = null, actualFixedExact = false, verifiedGradient = null;
  if (displacementValid) {
    actualFixedExact = fixed.every(i => runtime.displacement[Math.floor(i / 2)][i % 2] === 0);
    check(actualFixedExact && runtime.fixedExact === true, 'nonzero hard Dirichlet displacement or false exactness flag');
    const work = runtime.displacement.reduce((s, u, i) => s + bc.forces[i][0] * u[0] + bc.forces[i][1] * u[1], 0);
    check(runtime.loadWork === work, 'reported dead-load work differs from actual applied field');
    check(runtime.potential === runtime.energy - work, 'reported total potential differs from U-load work');
  }
  check(runtime.planarExact === true, 'false planar exactness flag');
  if (patch.world && displacementValid) {
    const w = patch.world;
    check(w.x?.length === 3 * n, 'live World pose has incorrect size');
    if (w.x?.length === 3 * n) for (let v = 0; v < n; v++) {
      check(w.x[3 * v + 1] === 0, 'actual live World has nonzero Y at node ' + v);
      check(w.x[3 * v] - patch.vertices[v][0] === runtime.displacement[v][0] &&
        -w.x[3 * v + 2] - patch.vertices[v][1] === runtime.displacement[v][1], 'reported displacement differs from actual World pose at node ' + v);
    }
    check(w.substepsRun === 0 && w.framesRun === 0 && w.time === 0, 'actual World was time stepped');
    check(!!w.orthotropicMembrane, 'actual selected membrane law is missing');
    if (w.orthotropicMembrane) {
      try {
        const actualGradient = new Float64Array(3 * n);
        w.orthotropicMembrane.addGradient(w.x, actualGradient);
        verifiedGradient = Array.from({ length: n }, (_, v) => [actualGradient[3 * v], -actualGradient[3 * v + 2]]);
        check(runtime.energy === w.orthotropicMembrane.energy(w.x), 'reported energy differs from actual selected-law energy');
        if (gradientValid) for (let v = 0; v < n; v++) check(runtime.gradient[v][0] === actualGradient[3 * v] &&
          runtime.gradient[v][1] === -actualGradient[3 * v + 2] && actualGradient[3 * v + 1] === 0,
        'reported gradient differs from actual selected-law gradient at node ' + v);
        const metric = w.orthotropicMembrane.diagnostics(w.x);
        for (const [key, value] of Object.entries(metric)) check(runtime.metric?.[key] === value, 'reported metric differs from actual selected-law metric: ' + key);
      } catch { check(false, 'actual selected-law final state cannot be evaluated'); }
    }
  }
  if (gradientValid || verifiedGradient) {
    const residual = (verifiedGradient ?? runtime.gradient).flatMap((g, v) => [g[0] - bc.forces[v][0], g[1] - bc.forces[v][1]]);
    computedResidualInfinity = Math.max(0, ...free.map(i => Math.abs(residual[i])));
    check(Array.isArray(runtime.residual) && same(runtime.residual, residual), 'reported full residual differs from exact gradient minus applied force');
    check(runtime.residualInfinity === computedResidualInfinity, 'reported free residual maximum is incorrect');
    check(runtime.relativeFreeResidual === (forceScale > 0 ? computedResidualInfinity / forceScale : null), 'reported relative free residual is incorrect');
    if (reactionValid) for (let i = 0; i < total; i++) {
      check(runtime.reaction[Math.floor(i / 2)][i % 2] === (fixedSet.has(i) ? residual[i] : 0),
        fixedSet.has(i) ? 'incorrect constrained support reaction at DOF ' + i : 'nonzero free reaction at DOF ' + i);
    }
  }
  const computedConverged = computedResidualInfinity !== null && computedResidualInfinity <= forceTolerance;
  check(typeof runtime.converged === 'boolean' && runtime.converged === computedConverged, 'reported convergence disagrees with independently computed exact free residual');
  const statuses = ['converged', 'iteration-limit', 'invalid-initial-pose', 'linear-solve-failed', 'non-descent-direction', 'line-search-rejected', 'precision-limited', 'measurement-exception'];
  check(statuses.includes(runtime.status), 'unknown solver status');
  check((runtime.status === 'converged') === runtime.converged, 'status and convergence flag disagree');
  check(runtime.metric?.finite === true && runtime.metric?.invalidTriangles === 0, 'invalid selected-law metric');
  const trace = runtime.trace;
  check(Array.isArray(trace), 'missing iteration trace');
  if (Array.isArray(trace)) {
    check(trace.length <= runtime.maxIterations && runtime.attemptedDirections === trace.length, 'invalid attempted-direction count/budget');
    let accepted = 0, backtracks = 0, invalidTrials = 0;
    for (let i = 0; i < trace.length; i++) {
      const t = trace[i], label = 'trace ' + i + ': ';
      if (!t || typeof t !== 'object') { check(false, label + 'missing iteration observation'); continue; }
      check(t.iteration === i && typeof t.accepted === 'boolean', label + 'invalid iteration/acceptance metadata');
      check(t.acceptanceBasis === mode, label + 'acceptance basis differs from actual solver mode');
      if (i && trace[i - 1]?.accepted) {
        check(t.energyBefore === trace[i - 1].energyAfter && t.potentialBefore === trace[i - 1].potentialAfter &&
          t.freeResidualBefore === trace[i - 1].freeResidualAfter, label + 'iteration trace is not continuous');
      }
      check(finite(t.freeResidualBefore) && t.freeResidualBefore >= 0, label + 'invalid starting residual');
      check(integer(t.backtracks) && t.backtracks <= runtime.maxBacktracks && integer(t.invalidTrials), label + 'invalid trial counters');
      backtracks += t.backtracks; invalidTrials += t.invalidTrials;
      if (!t.accepted) { check(i === trace.length - 1, label + 'unaccepted direction is not terminal'); continue; }
      accepted++;
      check(t.attempts === t.backtracks + 1 && t.attempts <= runtime.maxBacktracks + 1, label + 'trial count/backtracks mismatch');
      check(finite(t.slope) && t.slope < 0 && t.alpha === 2 ** -t.backtracks, label + 'invalid descent/alpha');
      check(finite(t.linearResidual) && t.linearResidual >= 0 && finite(t.relativeLinearResidual) && t.relativeLinearResidual <= 1e-9, label + 'direction solve residual failed');
      for (const key of ['energyBefore', 'energyAfter', 'potentialBefore', 'potentialAfter', 'freeResidualAfter']) check(finite(t[key]), label + 'nonfinite ' + key);
      check(t.rawPotentialDifference === t.potentialAfter - t.potentialBefore, label + 'incorrect raw potential difference');
      if (mode === 'total-potential') {
        const workBefore = t.energyBefore - t.potentialBefore;
        const expectedAllowance = 64 * eps * Math.max(1, Math.abs(t.potentialBefore), Math.abs(t.energyBefore), Math.abs(workBefore));
        check(finite(t.armijoRoundoffAllowance) && Math.abs(t.armijoRoundoffAllowance - expectedAllowance) <= 4 * eps * expectedAllowance, label + 'changed total-potential roundoff policy');
        check(t.potentialAfter <= t.potentialBefore + runtime.armijo * t.alpha * t.slope + t.armijoRoundoffAllowance, label + 'total-potential Armijo failed');
      } else {
        for (const key of ['actualStepSlope', 'residualDotActualStep', 'nonlinearEnergyRemainder', 'stablePotentialDifference', 'incrementAbsoluteTermSum', 'incrementRoundoffAllowance']) check(finite(t[key]), label + 'nonfinite ' + key);
        check(t.zeroActualStep === false && t.actualStepSlope < 0 && t.actualStepSlope === t.residualDotActualStep, label + 'accepted zero/non-descent actual step');
        check(t.nominalStepSlope === t.alpha * t.slope, label + 'incorrect nominal step slope');
        check(t.stablePotentialDifference === sum([t.residualDotActualStep, t.nonlinearEnergyRemainder]), label + 'stable potential regrouping mismatch');
        const allowance = 64 * eps * (t.incrementAbsoluteTermSum + Math.abs(t.stablePotentialDifference));
        check(t.incrementAbsoluteTermSum >= 0 && t.incrementRoundoffAllowance === allowance && t.armijoRoundoffAllowance === allowance, label + 'changed increment-only allowance');
        check(t.stablePotentialDifference <= runtime.armijo * t.actualStepSlope + allowance, label + 'energy-difference Armijo failed');
        check(t.rawMinusStablePotentialDifference === t.rawPotentialDifference - t.stablePotentialDifference, label + 'raw/stable discrepancy metadata mismatch');
      }
    }
    check(runtime.iterations === accepted && runtime.backtracks === backtracks && runtime.invalidTrials === invalidTrials, 'reported iteration/trial totals mismatch');
    check(runtime.rejections === (['line-search-rejected', 'precision-limited'].includes(runtime.status) ? 1 : 0), 'reported rejected-step count mismatch');
    const finalTrace = trace.at(-1);
    if (finalTrace?.accepted) check(finalTrace.freeResidualAfter === computedResidualInfinity &&
      finalTrace.energyAfter === runtime.energy && finalTrace.potentialAfter === runtime.potential, 'final accepted trace differs from final exact observation');
  }
  return { valid: errors.length === 0, converged: errors.length === 0 && computedConverged,
    errors, computedResidualInfinity, computedForceScale: forceScale, computedForceTolerance: forceTolerance,
    computedConverged, actualFixedExact, liveWorldChecked: !!patch.world,
    scope: 'independent boundary/metadata/exact-gradient residual and declared numerical-globalization checks; legitimate finite nonconvergence remains diagnostics, never an acceptance pass; increment allowance is not an interval certificate' };
}
