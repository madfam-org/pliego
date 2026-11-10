# Coupled normal-contact experiment

Status: opt-in research candidate. Pliego only; default reading is unchanged.
This is not a C-IPC implementation, a calibrated paper model or a release gate
closure. The earlier [global endpoint filter](continuous-contact-experiment.md)
failed page progress; adding more collision filtering alone did not fix it.

## Model and nonlinear solve

`World({ barrierContact: true })` replaces the legacy position projections with a
joint incremental potential: the existing membrane, hinge, point/join and inertial
energies plus finite-gap normal contact and ground barriers. It retains the
inertial prediction as `xt` but starts nonlinear iteration from the previous
pose. Every accepted update is filtered by swept VT/EE CCD and an energy descent
check. Contacts contribute to both the force gradient and a matrix-free PSD
radial Gauss–Newton operator. Elastic block Cholesky remains the preconditioner;
dynamic contact stencils do not need its fixed sparsity pattern to be enlarged.

Derivative checks below cover frozen point/driver coefficients and differentiable
closest-feature configurations. Overlapping parallel EE ties are nonsmooth in
the current unmollified model. General glue/pivot offsets and slider geometry
also need their full geometric Jacobians: updating join coefficients from the
current pose does not by itself differentiate those updates. These are open
engineering gates, not a global smooth-objective guarantee for arbitrary joins.

Two further opt-in ablations address linear/nonlinear work, without changing the
energy, force law, CCD bound or force tolerance:

- `consistentMembraneCurvature: true` uses the actual compressed spring's radial
  coefficient (`membraneCompression`, normally 0.05), including near-zero
  compression. The default GN approximation instead uses hysteresis and model
  compression 0.25, or full tensile stiffness near rest. This is radial GN, not
  the exact spring Hessian; transverse geometric stiffness remains omitted.
- `barrierLinearSolver: 'direct-local'` freshly assembles elastic, inertial and
  radial contact blocks in a separate sparse Cholesky matrix. It first checks
  every nonzero free contact pair against the elastic graph. Static/free contact
  often fits; general nonlocal free/free contact does not. Strict mode refuses a
  missing pair before changing positions. `'auto'` instead counts a fallback to
  the original PCG path; the default remains `'pcg'`. The separate factor does
  not modify the saved elastic preconditioner or its snapshot state. Slack
  strings are omitted from this current operator, matching matrix-free PCG.

Tests compare the combined direct direction to the independently applied
matrix-free operator, verify the scalar contact root, preserve active-contact
snapshot replay, and exercise strict rejection/automatic fallback. These tests
do not establish booklet convergence, speed or general self-contact support.
The `--local-matrix` benchmark isolates direct solving and consistent curvature,
then varies the nonlinear budget, uncapped modulus and substep count. Its 0.3
report adds a hash of every sampled pre-promotion pose and rejects source changes
during a run; a flat promoted endpoint alone is insufficient replay evidence.

The barrier used here is explicitly a function of **distance gap**, not C-IPC's
squared-distance offset formulation:

```
g = closest-feature distance - midpoint separation
b(g) = -k (g-h)^2 log(g/h), 0 < g < h
b(g) = 0,                  g >= h
b(g) = infinity,           g <= 0
```

Gap and activation `h` are mm, stiffness `k` is g/s², energy is nJ and force is
µN. Defaults are `h=0.05 mm`, `k=100000 g/s²`. These are numerical experiment
parameters, not measured paper contact stiffness. The clamped barrier form and
feasible-iterate strategy are informed by
[IPC / C-IPC](https://ipc-sim.github.io/C-IPC/file/paper_small.pdf); their published
guarantees do not transfer to this implementation. In particular, its contact
curvature omits the distance Hessian rather than reproducing projected IPC
Hessians. The default remains unmollified. Optional
[`edgeEdgeMollification: 'surface-guarded'`](parallel-contact-review.md) changes
covered EE energy/gradient and adds approximate angular PSD rows; uncovered
pairs retain their original barriers. Contact area weighting and
multiplicity-aware stencil aggregation remain open. Simply deleting duplicate
features would change the energy; mesh/contact multiplicity can change response.

Configuration:

```js
new World(doc, {
  barrierContact: true,
  barrierDistance: 0.05,
  barrierStiffness: 100000,
  barrierIterations: 8,
  barrierCgIterations: 128,
  barrierTolerance: 0.001, // infinity norm of free force residual, µN
});
```

PCG includes the current radial contact operator and tries at most the configured
budget before an elastic refactor/retry. If it still fails, a preconditioned
descent direction is tested against the **same** feasibility and energy checks.
That event is counted as a linear failure. It is not silently reported as a
converged solve. Nonlinear budget exhaustion, rejected steps, backtracks, active
stencils and actual end-of-substep residuals are retained in
`stats().coupledContact`. Snapshot/restore preserves those diagnostics.

Velocity alone cannot establish convergence: the candidate cannot enter sleep
while its last free-force residual exceeds its configured tolerance. A residual
threshold is not a material accuracy or temporal convergence certificate.

## Domain and limitations

- The ground retains Pliego's existing mid-surface `y=0` convention. This strict
  log barrier requires free initial vertices to satisfy `y>0`; initially touching
  sheets fail explicitly. No hidden lift or contact feasibility repair is used.
- Real prescribed motion is not implemented in this candidate and fails
  explicitly. Initial static Dirichlet positions are canonicalized to their
  evaluated targets only within `64 epsilon × coordinate scale`; the maximum
  adjustment is reported. The codex fixture needed at most about `3.56e-14 mm`
  in the initial probe, caused by two evaluations of mesh interpolation. This
  is distinct from accepting moving pins. Feasibility is checked on the resulting
  initial state by the barrier evaluation.
- The legacy strain, fold-limit, layer friction and ground-friction projections
  are not applied after the coupled solve: doing so would bypass its energy and
  feasible-iterate logic. Their replacement by coupled constraints/energies is
  still required. This candidate has normal contact only, not friction.
- It uses the existing membrane/hinge energy model and its stiffness cap unless
  `physicalMembrane: true` is selected. An accurate solve of a capped material
  remains a different model from the stock's uncapped modulus.
- Collision thickness still has a 0.05 mm floor in the barrier and motion guard.
  The booklet probes use 0.1 mm stock and do not validate thinner material.
  Activation distance/stiffness are numerical parameters, and reading poses
  impose at least 0.12 mm page spacing. Force convergence alone cannot calibrate
  physical stack thickness, contact pressure or this reading approximation.
- Topology, stationary prescribed-pair and welded-sheet exclusions remain those
  of the swept candidate reference. Ordinary Float64 distance/CCD queries are
  not exact predicates or interval arithmetic. No unconditional whole-engine
  collision, non-inversion or fabrication-safety claim is made.
- Errors can occur after driver state advances. Restore a complete World
  snapshot or discard the World before reuse; restoring positions alone is not
  a transactional substep rollback.

## Verification before booklet comparison

The implementation is checked in increasing scope:

1. Scalar first/second derivatives against finite differences, including the C²
   activation clamp and infeasible domain.
2. VT and EE force gradients against all stencil-coordinate finite differences,
   internal force/torque balance and symmetric PSD radial curvature.
3. A point mass whose prediction crosses a fixed triangle: the actual coupled
   solver reaches `y=0.14190853382678056 mm`, agreeing with an independently
   bracketed scalar equilibrium (`0.14190853382678054 mm`). Its free residual is
   about `1.22e-15 µN`. This is an analytical element fixture, not a native sheet.
4. A native two-sheet tilted-contact objective has directional derivative error
   about `9.60e-9`. Its perturbation stays off the membrane's C¹
   tension/compression switch to avoid central-difference truncation at that kink.
5. A native falling sheet reaches support `3.13919999993 µN` for weight
   `3.1392 µN`, with residual below `1e-6 µN`, positive ground clearance and
   negligible tensile strain. This is a numerical equilibrium, not measured stock
   validation.
6. Native pose/diagnostic replay, explicit input-domain errors and residual-aware
   sleep are checked. The analytical point-mass fixture exposed a zero-covariance
   best-rotation bug: identity now preserves the SPD preconditioner, replacing
   the previous zero quaternion for that degenerate free set.

## Isolating the initialization effect

The axial-strip improvement must not be attributed to contact forces: that test
has no physical contact. `World({ previousPoseStart: true, lineSearch: true })`
is a separate ablation of the **legacy** solver. Only free starting positions are
reset to the previous pose; prescribed targets are applied normally. Inertia is
then included in the first Newton gradient as well as later gradients. Later
legacy projections still run, so this option is not a collision guarantee.

With uncapped membrane stiffness and S=8, both this one-GN warm start and the
coupled solve recover about `0.000180146 mm` extension under a 10 mN load on the
synthetic 100×10×0.1 mm strip. The analytical bar reference is `0.000181818 mm`.
Reversible unloading is tested separately. These are numerical reference tests,
not measurements of real paper or proof of transient accuracy. The coupled
256-iteration budget is a maximum, not a claim that every substep uses 256
iterations; actual work and any unconverged substeps are recorded.

The axial benchmark now separates active-step timings from frames already asleep
at step start and reports maximum latency. Older reports' timing scope remains
unchanged. Endpoint progress, material response, convergence and wall time must
be evaluated separately rather than counting sleeping frames as solver speed.

```sh
node --test packages/engine/test/barrier-contact.test.js packages/engine/test/coupled-contact.test.js packages/engine/test/pcg-rotation.test.js
node packages/engine/bench/axial-pull.mjs --out /tmp/coupled-axial.json
node packages/engine/bench/paper-campaign.mjs --barrier-matrix --turns 1 --out /tmp/coupled-first-turn.json
```

The booklet matrix compares the default, legacy multi-iteration search, the
previous-pose ablation, capped coupled S8/I8 and S1/I64, and uncapped coupled S8/I8
in both all-flexible and active-leaf models. Equal nominal nonlinear-update
counts do not imply equal work or equal accuracy. A successful first turn cannot
close the eight-turn, corpus or actual-device gates. The benchmark preserves
unsupported and initially infeasible cases instead of removing their denominator.

The [source-pinned results](evidence/paper-2026-11-09/README.md#coupled-normal-forces-and-previous-pose-initialization)
now retain the axial ablation, first-turn comparison/repeat and eight-turn
previous-pose failures. Coupled active leaves turn with low strain and zero
partial thickness deficit, but most moving substeps exhaust their force budget.
All-flexible initial table contact is rejected. The inexpensive seed change
does not fix eight-turn thickness failures. Timing was collected under verified
host contention and cannot close the performance gate.

The subsequent [local-solve evidence](evidence/paper-2026-11-09/README.md#consistent-curvature-and-direct-local-contact)
isolates the two new options: consistent compression curvature improves nonlinear
convergence; direct solving removes PCG work without fixing that convergence by
itself. A full eight-turn direct S8/I32 run passes sampled endpoint/tensile/partial
thickness gates, but fails force convergence and timing. CPU profiles identify
the swept candidate scan as the main sampled cost. The retained native late-turn
objective reproduces its force residual and energy, with excess directional
curvature concentrated in EE contact. An analytical parallel-edge fixture proves
that this unmollified contact potential has no smooth gradient at that tie.
Regularization, contact weighting and efficient conservative indexing remain open.

The later [surface-guarded measurements](evidence/paper-2026-11-10/README.md)
now complete and repeat eight turns with every executed substep satisfying the
same 0.001 µN force tolerance: 5168 capped-model substeps and 5200 uncapped-model
substeps. Both remain above the 8 ms target. The uncapped strip loading/unloading
ablation agrees with its analytical reference with no contact energy active;
that result must not be credited to smoothing. Held-out stock data, full temporal/
mesh convergence, friction and general contact/device acceptance remain open.
