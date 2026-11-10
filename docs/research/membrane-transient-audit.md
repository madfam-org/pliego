# Actual-World membrane modal transient experiment

Clean diagnostic source [`93f6653`](https://github.com/madfam-org/pliego/commit/93f6653136bc37c4feff48c86f88259000c7dde8), 2026-11-10.
[Complete captures, strict repeat and observation/precision proofs](evidence/membrane-transient-2026-11-10/README.md)
are retained. **Every trajectory contains strict force failures; time accuracy remains unaccepted.**
This stage extends the membrane campaign from static equilibrium to actual World time stepping.
The wider mission remains accuracy and interactive paper reading with separate acceptance gates.
A diagnostic subset does not exhaust that mission or substitute for complete transient acceptance.

## Scope and current evidence status

The implemented path uses a free planar orthotropic StVK research sheet, native lumped mass,
real `World.step(World.dt)` calls, an independent linear CST modal reference and a separate live acceptance reducer.
No surrogate 2D integrator, repeated private Newton call, hidden pin, oracle predictor or trajectory injection is used.
Materials, thickness, areal density and rest geometry retain their physical engine values.

The clean-source smoke diagnostic completes and repeats24 full trajectories, with every trajectory
containing strict force failures. The captures establish reproducible diagnostics, not solved time accuracy.
The current audit hard-codes whole time-accuracy acceptance false until all remaining isolation/trend/full-matrix gates exist and pass.

This experiment does not validate bending, buckling, contact, joining, finite deformation dynamics,
calibrated paper stocks, continuum spatial convergence, new-law multi-page booklet reading,
interaction latency, browser/device performance, an 8 ms budget or stable catalogue release.
The existing fixed-booklet interaction objective remains a separate product acceptance track.

## Supported runtime construction and initialization

The constructor requires the opt-in research law `membraneModel:'orthotropic-stvk'`,
`physicalMembrane:true`, compression 1, explicit synthetic `nu12` and its `nu12` convention,
`membraneCurvature:'gauss-newton'`, `membraneProjection:'none'` and `lineSearch:true`.
Physical velocity damping, bend damping, gravity, ground, contact and plasticity are disabled.
There are no pins, kinematic sheets, drives, controls, mechanisms, joins, perforations or crease mechanisms.
All vertices remain free; neither inverse masses nor the native free-system mapping are edited.

A dimensionless independent mode phi is normalized to maximum nodal Euclidean norm 1.
An amplitude A therefore has units millimetres.
Exactly once, before time stepping, actual positions become

    x_i = u_i + A phi_(u,i),  y_i = 0,  z_i = -(v_i + A phi_(v,i)).

Actual velocities are set to zero. Native X0, reference UV, connectivity, material and rest angles remain unchanged.
Store the actual binary64 initial position; ideal addition and represented addition need not coincide.
The constructor's initial xs/xt buffers are retained raw, explicitly not treated as an already-existing inertial prediction.

Panel hinge stiffness may retain its normal value in this strictly planar experiment.
The observer must measure zero omitted bending/drive/term energy and gradient, rather than infer this from intended options.
Likewise `damping:0` does not disable all air code: require wind, user force and actual external force zero,
and exact Y position/velocity/gradient zero at every observed endpoint.
No sleep override is permitted. Sleep advances time without executing the normal dynamics and censors the experiment.

## Native mass and independent modal reference

Native per-node mass is the sum of reference triangle area times areal density divided by three.
Density is already areal; no second thickness multiplier or consistent-mass substitution is allowed.
Native World masses are the source for exact force thresholds, modal normalization and observed kinetic energy.
Independently assembled per-node masses are compared within 1e-12 relative to the declared mass scale.
An association ULP between area-weighted summation orders is retained, not repaired by replacing World masses.

The Python stdlib reference reuses the independently tested linear CST assembler, without its static clamp/solve wrapper.
It constructs full free stiffness K, diagonal lumped M, and B = M^(-1/2) K M^(-1/2).
A deterministic bounded symmetric Jacobi eigensolver handles the declared cells2/cells4 domain, at most 50 in-plane DOFs.
Its original physical matrix is not rescaled, shifted or regularized to make the spectrum convenient.

There must be exactly three free in-plane rigid modes: two translations and infinitesimal rotation.
The reference checks explicit mass-weighted rigid vectors, null classification, positive remaining spectrum,
matrix symmetry, eigen residual, orthogonality, spectral reconstruction, trace and bounded sweep convergence.
Reported normalized spectral/rigid verification thresholds are 1e-10; Jacobi off-diagonal stopping is 1e-14 of original Frobenius norm.
The first positive mode with the predeclared relative adjacent spectral gap at least 1e-6 is selected.
Sign is fixed by the lowest-index maximum-magnitude component being positive.
A clustered basis is not declared a physically matching mode across different meshes.

The reference emits the selected dimensionless mode, modal mass phi^T M phi in grams,
and the complete mass-normalized spectrum and rigid classification.
The full basis supports a separate propagation of the **actual rounded initial displacement**.
Its mass orthogonality and actual-field reconstruction are checked before use.
The independent oracle's reported modal mass must also agree with native phi^T M phi within 1e-12.
All reference tests must pass before actual World results are judged.

## Derive the actual time method

For this undamped, zero-force experiment, World makes the actual predictor xt = x_n + h v_n.
The selected implicit objective is

    Phi(x) = (x - xt)^T M (x - xt)/(2 h^2) + U(x).

After its fixed-budget GN/PCG updates and actual line search, World sets

    v_(n+1) = (x_(n+1) - x_n)/h.

A converged endpoint satisfies

    r = M/h^2 (x_(n+1) - xt) + grad U(x_(n+1)) = 0.

In exact arithmetic this is backward Euler for the first-order position/velocity system.
It is not the average-acceleration Newmark method.
World uses exact selected elastic gradient and a GN PSD search matrix rather than the exact StVK Hessian.
Existing PCG permits direction relative tolerance 1e-3 and at most 12 iterations; direct-factor fallback is separate.
These linear-search controls are not the strict nonlinear endpoint-force tolerance.

The retained baseline World search compares raw total incremental energies with its existing Armijo allowance.
The stable energy-increment method used by the static BVP bench is **not** adopted by World here.
The subsequent [named planar increment candidate](membrane-increment-search.md)
is a separate opt-in experiment; this baseline capture and its failures are retained.
A predictor-start first iteration has zero inertia gradient because x equals xt.
Previous-pose start includes inertia from iteration zero. It is a named controlled numerical candidate.
Calling private `_newton` repeatedly from a benchmark would change these semantics and is forbidden.

If scalar damping were enabled, the predictor would first multiply v_n by exp(-gamma h).
That split predictor has a different discrete damped-oscillator recurrence from backward Euler on C v_(n+1).
This protocol fixes gamma zero; it transfers no unmeasured damping guarantee.

## Two truths and the rounded-initial control

Let omega be the selected independent natural frequency and z = omega h.
For ideal single-mode initialization q_0=A and qdot_0=0, exact discrete backward Euler is

    q_n = A (1+z^2)^(-n/2) cos(n atan z)
    qdot_n = -A omega (1+z^2)^(-n/2) sin(n atan z)
    E_n/E_0 = (1+z^2)^(-n).

Continuous linear truth is q(t)=A cos(omega t), qdot(t)=-A omega sin(omega t).
A faithful discrete trajectory can still fail continuous-time accuracy because backward Euler damps numerically.
Its one-period energy ratio is approximately exp(-2 pi z): z=.01 implies about 6.1% artificial energy loss,
whereas z=.0025 implies about 1.56%. These are analytic predictions, not measured World results.

The complete independent K/M basis also propagates the actual reconstructed initial displacement,
with its tiny rigid and other-mode components retained and zero initial velocity.
Only declared rigid modes propagate at zero frequency; raw small eigenvalues remain reported.
Ideal single-mode and actual-initial-field errors are stored separately.
No reconstruction is copied into World after initialization.

Full 3D mass-weighted errors accompany modal coordinate, velocity, phase and leakage.
Fixed scales are A sqrt(phi^T M phi), A omega sqrt(phi^T M phi), and .5 A^2 omega^2 phi^T M phi.
They remain nonzero through displacement and velocity crossings.
Energy is actual selected U plus kinetic energy; the reference's linear energy is retained separately.
Phase is unwrapped across the actual sampled trajectory, with a declared observability floor.
A plausible single projection does not hide rigid, out-of-plane or other-mode errors.

## Literal solve acceptance and observation validity

At every actual endpoint, a separate reducer recomputes full and selected gradients,
then forms the actual inertia from native masses and retained x/xt.
It never treats stale World.g or elastic gradient alone as the final incremental residual.
The fixed force scale is

    F0 = A omega^2 max_i(m_i ||phi_i||).
    max_coordinate |r| <= max(1e-7 microN, 1e-10 F0).

Report raw coordinate maximum, nodal maximum, mass-dual norm, exact threshold and every failed step.
Instantaneous force, a zero crossing and coordinate ULP never change this literal gate.
A legitimate finite residual failure returns measurement-valid true and convergence false.
Small trajectory error or negligible budget changes cannot rescue that failure.

Live validation binds x/xs/xt/v and their native-byte hashes to the actual current World,
checks one public substep, exact predecessor/predictor/velocity identities, counters and accumulated time,
zero hidden forcing/constraints/contact/damping, native/reference mass and selected-law metric/energy.
It recomputes kinetic/mechanical energy, modal reductions, momentum and center of mass.
Full-gradient evaluation uses cloned selected-law work and hinge/edge scratch, not actual solver-cache mutation.
Exact observed-versus-unobserved replay is a required measurement check.
Offline reported-field algebra is explicitly not actual-gradient or physics-convergence certification.

The basic observer exposes final public PCG iteration count and cumulative factorization/backtrack/rejection counts.
Its per-Newton fields remain null. The audit now attaches a separate bench-only solve observer by default:
transparent wrappers call each original EnergySearch begin/finish exactly once and never repeat a solve.
They capture the actual nominal packed direct/PCG direction and realized rounded candidate-minus-start,
then check both against the actual pre-search GN operator using cloned scratch. Direct, PCG and fallback
paths, accepted alpha and accepted-backtrack counts are explicit. Rejected trial count is not exposed
by the original search and remains unknown, rather than inferred from its accepted-backtrack counter.

Five focused observer tests check source association and exact observed/unobserved replay.
The audit's complete observer-coverage gate requires every expected actual Newton iteration,
no missing/callback-failure records and matching begin/finish counts. This is an observation-validity gate,
not a claim that every linear direction or final nonlinear endpoint satisfies its convergence tolerance.
`--no-solve-observer` is a named observation ablation; it does not alter physics or close missing diagnostics.

## Declared stages and remaining accuracy gates

The implemented diagnostic protocol uses z0 at most .08, integer timestep refinements 1/2/4/8,
A=.004 mm, Newton budgets 1/4/16, and predictor/previous-pose starts.
The smoke geometry is cells2, forward diagonals, grain0: 24 complete trajectories when actually run.
The full geometry matrix is cells2/cells4, forward/alternating/perturbed, grains0/45: 12 cases, 288 diagnostic trajectories.
The retained clean smoke capture completes all 24 full trajectories; the earlier one-step development probe is not counted as another trajectory result.

The separately declared window protocol uses z0 at most .04 and refinements 1/2/4/8/16,
A=.08/.04/.02/.01 mm, budgets16/32, and both starts: 80 smoke or 960 full-matrix trajectories.
It studies whether solve accuracy, amplitude linearity and timestep accuracy have a common resolved window.
It does not assume that the larger amplitude is already linear or that smaller amplitude always improves numerical accuracy.

For each geometry choose S0=ceil(omega/(60 z0)), h0=1/(60 S0), N0=ceil(2 pi/(omega h0)).
Refinement l uses S=l S0, h=h0/l, N=l N0, preserving a common physical horizon just over one period.
Every observation follows exactly one `World.step(World.dt)` call, not a default 1/60-second frame.
Truth uses actual recorded times; accumulated-clock versus n h differences remain visible.

Declared discrete comparison limits are .1% full-field displacement/velocity and .5% energy.
Continuous limits are 1% displacement/velocity, 5% energy and .01 phase cycles.
Budget isolation requires normalized state changes at most 1e-4 with both members passing literal force.
Last amplitude-halving isolation requires normalized response change at most .001, again with both members solved.
The current paired controls use 17 predeclared horizon checkpoints and explicitly claim sampled comparisons only.
Whole time acceptance additionally requires all-step isolation, an expected first-order time-error window,
full matrix completion, all oracle/measurement/force gates, and a passing strict repeat.
Those requirements remain open; numerical agreement flags alone are not whole acceptance.

## Retention, source guard and reproducibility

The observer streams every initial/post-public-step observation to synchronous live validation and metrics.
The report retains every scalar force outcome, accuracy metric and raw x/xs/xt/v hash across the trajectory.
Full snapshots are bounded: 17 horizon checkpoints, initial/final, first invalid state,
first/worst force failure, and worst discrete/continuous full-state errors.
No claim is made that every full gradient or raw pose remains available after this reduction.

Each retained snapshot also contains explicit little-endian binary64 base64 x/xs/xt/v payloads.
These preserve signed zero and exact represented states lost by ordinary JSON number arrays.
Native-byte hashes are interpreted with the report's recorded host byte order; the payload is explicitly LE.
Use the binary payload for exact state reconstruction, not JSON arrays alone.

Before/after source guards bind git SHA/status, the engine source tree, modal tools/tests,
imported independent CST code and fixture builder. Dirty runs are development only.
Input/output fingerprints bind the initial oracle and response requests, and their unchanged core reference is checked.
The strict comparator covers every report field except recordedAt and fingerprints its implementation.
A separately named observer ablation excludes only observation selector/records/completeness metadata,
while preserving exact physics/force/state/metric parity. Both comparisons pass at the clean source.
The [evidence archive](evidence/membrane-transient-2026-11-10/README.md) retains the full first capture
and declared-path deltas reconstructing every original repeat/control byte and SHA256. Reconstruct
the complete reports before rerunning official comparisons; no captured failure or field is omitted.

Implemented CLI, from the repository root:

    node packages/engine/bench/membrane-modal-audit.mjs --stage diagnostic --matrix smoke --out /tmp/pliego-modal-diagnostic.json
    node packages/engine/bench/membrane-modal-audit.mjs --stage diagnostic --matrix full --out /tmp/pliego-modal-full-diagnostic.json
    node packages/engine/bench/membrane-modal-audit.mjs --stage window --matrix full --out /tmp/pliego-modal-window.json

Development can explicitly add `--allow-dirty`; such a report is never accepted clean-source evidence.
Outputs must be new paths outside the checkout. Repeated accepted runs require distinct output files.

## Clean-source diagnostic outcomes and precision interpretation

The clean-source diagnostic completes 24 smoke trajectories and 7110 actual public substeps.
Independent reference, live measurement and 49770-event solve-observer coverage checks pass, while all 24
trajectories contain strict endpoint-force failures: 6975/7110 substeps miss the unchanged literal threshold.
The whole report repeats exactly except recordedAt, and observed/unobserved physics remains exactly equal.
These are accepted-source diagnostic results, not time-accuracy acceptance. All 16 source CI checks pass,
including 214 engine/123 web tests, 46 typechecked sources and the 96-file package.

Maximum actual-rounded-initial discrete-BE full-state error is .00043004 fraction, or about .0431%.
Maximum continuous full-state errors decrease from about 22.31% to 11.87%, 6.124% and 3.111%
as z decreases from approximately .08 to .04, .02 and .01. These are full position/velocity state norms;
individual displacement/velocity and energy gates remain separately reported.
Small discrete-state errors do not repair failed force solves or establish an isolated first-order time limit.
The single amplitude does not demonstrate small-strain separation, and only one geometry is measured here.

A passing first substep is not a passing trajectory. All 24 retained full trajectories contain failures.
The larger full geometry/window matrix, amplitude/all-step budget isolation and time trend remain open.

The retained80/100-digit fixed-pose witnesses separately evaluate independent exact-UV/material StVK
and the stored-runtime-coefficient polynomial, plus real stored M/h^2*(x-xt). Both remain above the
unchanged force threshold. Independent UV residuals are about .799479 microN at the selected search-stalled
state and .0108206 microN at the finer-step state, against 8.8140e-5 microN. Each 80/100 pair agrees on
all 335 parsed leaves except decimalDigits, including source/input/coefficient/LE-state provenance.
These are pointwise endpoint diagnostics, not a new solve or proof that no other representable equilibrium exists.

Absolute positions introduce a possible precision interaction: M/h^2 magnifies represented x-xt spacing.
The diagnostic scale m ULP(x)/h^2, or relatively ULP(x)/(A z^2), is not a rigorous bound,
not proof that no representable equilibrium exists, and never an acceptance allowance.
Smaller h can improve continuous trajectory accuracy while worsening the literal computed residual.
Retain actual failed endpoint/predictor states for independent fixed-pose, higher-precision diagnosis.
Keep exact-UV/Q physical evaluation separate from an optional stored-runtime-coefficient polynomial check.
Do not subtract rest force, relax the gate after seeing data or silently change position representation.

Likewise floating predictor reconstruction can contribute a momentum increment of
sum_i m_i[(xt_i-xs_i)/h-v_(n,i)]. It must not be mislabeled a material force or silently folded into a passing residual.
The reported momentum is recomputed from actual velocities; a universal exact nonlinear angular-momentum
or mechanical-energy conservation guarantee is not asserted for backward Euler/StVK.

## Primary references and claim boundary

[Bleyer, Transient elastodynamics with Newmark time integration](https://bleyerj.github.io/comet-fenicsx/tours/dynamics/elastodynamics_newmark/elastodynamics_newmark.html)
provides the semidiscrete elastodynamic oscillator and separate kinetic/elastic/dissipation context.
Its particular Newmark accuracy, stability and energy properties do not apply to this derived World method.

[Offner, Glaubitz and Ranocha, Analysis of Artificial Dissipation, section4](https://arxiv.org/html/1609.02393v2#S4)
examines implicit-Euler artificial dissipation. Its PDE examples are not membrane validation.
The modal recurrence, discrete energy loss and World-specific conclusions here are independent derivations.

Clean-source diagnostics and exact repeats are retained; strict solves, full isolation/refinement and whole time acceptance remain open.
No optimality, lowest-abstraction, exhausted-research or production-readiness conclusion follows from this checkpoint.
