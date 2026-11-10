# First paper campaign measurements

This page retains successive solver, [CCD](#continuous-contact-and-physical-turn-progress)
and [coupled-contact](#coupled-normal-forces-and-previous-pose-initialization)
measurements. Each section pins its own source; later evidence preserves earlier failures.

Source: [`78ca50699ebfd7700e5fc97ba8cceb499b0ed01c`](https://github.com/madfam-org/pliego/commit/78ca50699ebfd7700e5fc97ba8cceb499b0ed01c),
clean during these runs. Recorded 2026-11-10 UTC (2026-11-09 local).
One sequential local run per candidate, Node 20.19.5, Intel Core i7-9750H.
These are exploratory measurements, not a target-device performance certificate.

Machine-readable reports:

- [Baseline engine `21df7df`](baseline-21df7df.json), with the same new reader/harness.
- [Candidate engine and reader](candidate-78ca506.json).
- [Contact-free axial pull](axial-78ca506.json).

The booklet reports fingerprint the entire engine source tree, reader modules,
harness and native fixture. The axial report fingerprints its fixture, harness and
listed solver files; the commit pins the remaining dependencies. The harness adds
no preview fallback or wall-time-based simulation compression. Deterministic
engine sleep remains part of `World.step`; later reports count it explicitly.
A successful CLI exit means recording completed, including failures.

## Native four-leaf booklet

All runs use the same kernel-built 90 × 128 mm copy-80 codex. Each requests four
forward and four backward turns, 84 frames per turn at 60 Hz. Plasticity is disabled
in both models. The reader uses flat resting page blocks; pre-promotion dynamic
release poses are included in the audit. The independent thickness check tests
active vertices against those flat blocks, not all primitive crossings or CCD.

Candidate active-leaf results (all completed 8/8 turns):

| Substeps / GN iterations | Membrane / search | Peak stretch | Step p95 | Maximum thickness deficit |
|---|---|---:|---:|---:|
| 8 / 1 | capped / off (reader default) | 0.582% | 18.20 ms | 0.09985 mm |
| 4 / 2 | capped / off | 0.852% | 14.72 ms | 0.09041 mm |
| 16 / 1 | capped / off | 0.436% | 33.60 ms | 0.09542 mm |
| 8 / 1 | physical / off | 0.629% | 17.55 ms | 0.09977 mm |
| 8 / 1 | physical / on | 0.681% | 19.41 ms | 0.09776 mm |

Five cases pass the 1% stretch/floor gate, **zero** pass 0.1% stretch, **zero** pass
the partial thickness gate (≤ 0.001 mm deficit), and **zero** meet the 8 ms physics
p95 target. The material collision thickness is 0.1 mm, so a nearly 0.1 mm deficit
is a substantial failure. Flat readable endpoints do not erase these dynamic results.
Step timing excludes later model selection/construction and input-to-paint latency;
initial construction is reported separately. Two solver worlds is the observed cache peak.

All five all-flexible candidate cases fail before completing the second turn:
peak stretch at stopping is 1.26%, 1.04%, 1.12%, 4.60%, and 8.02% respectively.
Their requested sequence remains incomplete. The corresponding three supported
baseline cases stop during the first turn; its four physical/search cases are
explicitly unsupported, not numerical passes.

The fixed-query contact correction is **not** a universal improvement: baseline
active-leaf S=16/I=1 passed this partial thickness gate (0.000158 mm deficit),
while the candidate fails it (0.09542 mm). The new regression must remain visible
in subsequent contact work and full-corpus comparisons. Passing unit/CI checks is
insufficient to approve a stable physics release.

The copy-80 default cap retains only 1.427% of physical MD extensional stiffness
and 3.139% of CD stiffness in this fixture. The uncapped option is necessary for
constitutive comparisons; enabling it alone does not validate the material model.

## Axial accuracy and timestep convergence

A 100 × 10 × 0.1 mm strip, pinned along one end, receives a 10 mN axial step load
without gravity, ground, contact or plasticity. The stock is a synthetic estimate.
The small-strain axial-bar reference `F L / (E t width)` is **0.000181818 mm**.
This is a numerical reference, not a measured paper sample or a converged 2D FE solution.
The report runs 180 frames and checks drift between 1.5 and 3 simulation seconds.

| Substeps / GN iterations | Membrane / search | Extension at 3 s | Relative bar error | Step p95 |
|---|---|---:|---:|---:|
| 8 / 1 | capped / off | −0.458915 mm | 252,503% | 1.24 ms |
| 8 / 1 | physical / off | −0.625138 mm | 343,926% | 1.78 ms |
| 8 / 1 | physical / on | −0.625138 mm | 343,926% | 1.31 ms |
| 8 / 8 | physical / on | −0.008004 mm | 4,502% | 4.51 ms |
| 64 / 1 | physical / on | 0.000071016 mm | 60.94% | 2.85 ms |
| 128 / 1 | physical / on | 0.000183921 mm | 1.16% | 4.76 ms |
| 256 / 1 | physical / on | 0.000180332 mm | 0.82% | 9.56 ms |

Negative extension under axial tension is a failure, even when positions are finite
and strain guards pass. Line search alone does not repair the under-converged step.
The prediction moves the loaded boundary about 16 mm in the first S=8 substep;
reducing the timestep improves the local approximation. S=64/I=1 and S=8/I=8 have
the same nominal GN-update count, but different solver/projection costs. Their
comparison favors smaller steps in this fixture; it does not establish a general
solver optimum. Only S=128 and S=256 pass the 5% bar gate. The recorded S=128
whole-run p95 is below 8 ms, but includes sleeping frames; it does not establish
an active-step budget. This does not transfer to the booklet workload or phones.

## Verification and remaining work

The source checkpoint passes 100 engine tests and the web CI job (123 tests,
including five booklet cases), JSDoc checking, package declarations/tarball,
native fixture verification/drift, compliance and deployment-path checks. Browser
acceptance verified sequential forward/backward turns, a readable back cover,
390 px forward/reverse page-relative dragging, keyboard reading, inert background,
idle pause, resize and EN/ES state. No real touch-device performance was measured.

The [campaign register](../../paper-physics-campaign.md) remains active: general
contact and closest-feature/coupled formulations, analytical/physical material
validation, developable/rod and local-solver prototypes, backend comparisons,
full-corpus before/after coverage and the archive companion adapter are open.
No merge, publication, deployment or engine-wide stability claim follows from this milestone.

## Continuous contact and physical turn progress

Source [`e749ff46beef833a418512526cdbafd2f2139247`](https://github.com/madfam-org/pliego/commit/e749ff46beef833a418512526cdbafd2f2139247),
clean at both candidate runs and the old-engine comparison. Same runtime/hardware
as above. Reports include the new metric-helper hash as well as engine, reader,
harness and fixture hashes. All use the schema 0.2 contact matrix:

- [Previous engine `c3d7747`](contact-baseline-c3d7747.json), with the new harness.
  Two default cases supported; six CCD cases explicitly unsupported.
- [Candidate, first run](contact-e749ff4.json).
- [Candidate, second run](contact-e749ff4-repeat.json).
- [Machine-readable comparison](contact-comparison.json).

The two default cases are numerically identical to the previous engine. All eight
candidate cases replay identically between the two runs: every result field except
build/step timing agrees, including endpoint progress, final position hash,
strain, failure and CCD diagnostics. This does not compare timing statistically.

| Model | Substeps | Membrane / search | Frames before stop | Completed turns | Peak stretch | Step p95, first / repeat | Result |
|---|---:|---|---:|---:|---:|---:|---|
| All flexible, guard off | 8 | capped / off | 107 | 1/8 | 1.260% | 35.70 / 35.65 ms | strain failure |
| Active leaf, guard off | 8 | capped / off | 672 | 8/8 | 0.582% | 18.23 / 18.71 ms | turn progress passes; thickness and timing fail |
| All flexible, guard on | 8 | capped / off | 3 | 0/8 | 0.0197% | 218.37 / 223.53 ms | zero progress |
| Active leaf, guard on | 8 | capped / off | 3 | 0/8 | 0.0913% | 89.30 / 97.55 ms | zero progress |
| All flexible, guard on | 16 | capped / off | 1 | 0/8 | 0.0088% | 229.06 / 232.37 ms | zero progress |
| Active leaf, guard on | 16 | capped / off | 6 | 0/8 | 1.513% | 163.04 / 160.00 ms | strain failure |
| All flexible, guard on | 8 | physical / on | 2 | 0/8 | 0.0086% | 155.51 / 158.32 ms | zero progress |
| Active leaf, guard on | 8 | physical / on | 18 | 0/8 | 0.0719% | 83.43 / 83.57 ms | zero progress |

Early-stopped timing samples describe only those short prefixes, sometimes one
frame. They do not establish steady-state performance or an equal-completed-work
speed ratio. They do show that this implementation misses the 8 ms gate on the
tested prefixes. The low strains of stalled cases cannot be counted as successful
reading or material accuracy. Five guard cases reach an explicit precision-limit
zero interval; the sixth has 359 per-pair iteration-limit events and exceeds 1%
stretch. No guarded case completes the first turn.

The default active-leaf reader's minimum pre-promotion fore-edge progress is
0.999313 across all eight endpoints (required ≥0.9), but its thickness deficit
remains 0.099853 mm. Readability, progress and thickness are independent results.
An earlier exploratory run without zero-progress termination was interrupted
before producing a complete report. Its logical turn count is not acceptance
evidence; the retained protocol stops stalled motion before endpoint promotion.

Reproduce the recorded comparison, failing on numerical drift:

```sh
node packages/engine/bench/compare-paper-runs.mjs docs/research/evidence/paper-2026-11-09/contact-baseline-c3d7747.json docs/research/evidence/paper-2026-11-09/contact-e749ff4.json docs/research/evidence/paper-2026-11-09/contact-e749ff4-repeat.json
```

The [component implementation and limits](../../continuous-contact-experiment.md)
explain why a global CCD endpoint filter cannot replace a coupled contact solve.
It remains experimental and disabled by default.

## Full first-turn recovery probe

The zero-progress gate above stops immediately. To test whether later frames
recover, [source `51f5278`](https://github.com/madfam-org/pliego/commit/51f527840a39f570101de1a8ffedd57f0503120f)
adds an explicit `--continue-after-zero` diagnostic protocol and `--turns 1`.
The [recorded report](contact-recovery-51f5278.json) is source-clean and retains
the same engine tree as `e749ff4`. It requests all 84 frames of the first forward
turn, preserving the strain/floor gates and pre-promotion endpoint audit.

| Guarded model | Substeps | Membrane / search | Mean fore-edge progress | Minimum fore-edge progress | Endpoint gate |
|---|---:|---|---:|---:|---|
| All flexible | 8 | capped / off | 0.00729% | −0.00055% | fail |
| Active leaf | 8 | capped / off | 0.25708% | 0.04375% | fail |
| All flexible | 16 | capped / off | 0.00502% | 0.00057% | fail |
| Active leaf | 16 | capped / off | unavailable | unavailable | strain failure at frame 6 |
| All flexible | 8 | physical / on | 0.00052% | −0.00005% | fail |
| Active leaf | 8 | physical / on | 0.52855% | 0.06132% | fail |

Required progress is ≥90% at **every** sampled fore-edge vertex. The five cases
that run all 84 frames advance their logical turn count but fail physical turn
progress by a wide margin. Their p95 step times range from 79.92 to 733.86 ms.
Some motion resumes between zero intervals, but no guarded case reaches the
required first-turn endpoint. This separates persistent practical failure from
the earlier immediate-zero acceptance failure.

Engine sleep is not an equilibrium certificate here: it uses velocities and
control goals, and a globally clipped proposal can zero velocities while the
geometry remains far from its target. Some runs therefore execute fewer than
84×S guarded substeps; raw counts are retained. `framesEndingWithZeroProgress`
counts frame statistics reporting a zero last interval, including a retained
diagnostic while asleep, not distinct executed CCD queries. No fallback or
wall-time-based simulation compression is added by the harness.

Both unguarded first-turn cases pass the endpoint gate. The unguarded active leaf
also passes this **first-turn** partial thickness check; its separately recorded
eight-turn thickness failure remains open.

```sh
node packages/engine/bench/paper-campaign.mjs --contact-matrix --turns 1 --continue-after-zero --out /tmp/contact-recovery.json
```

## Independent compiled distance reference

[Source `ad6a64c`](https://github.com/madfam-org/pliego/commit/ad6a64c4b8b73b93a91b1a0eb9c3967dbc1b5e4e)
and the [reference report](distance-reference-ad6a64c.json) pin the component
generator, native distance implementation, complete generated-input hash,
adapter, IPC Toolkit 1.4.0 binary and public wheel hashes. Source was clean.
Running the adapter twice on that same input produces byte-identical reports.

Of 2,216 queries (1,107 VT / 1,109 EE), 2,215 have finite independent reference
results; all agree within `1e-10 × stencil diameter²`, with maximum normalized
discrepancy 3.87e-16. The remaining collapsed point-triangle returns non-finite
in the reference. Native 0.25 mm² agrees with its analytical fixture. This remains
an explicit reference-unavailable result, so the adapter exits 1; it is not
counted as a comparison pass or silently removed from the denominator.

The input generator covers seeded random, uniformly scaled, near-parallel,
sliver, pinned-corner and collapsed stencils. This establishes tested component
agreement, not exact predicates, full CCD safety, contact-force convergence,
measured stock calibration or solver/backend optimality. The
[reference workflow](../../continuous-contact-experiment.md#independent-distance-reference)
uses an isolated Python environment; the native engine retains zero runtime
dependencies.

## Coupled normal forces and previous-pose initialization

Source [`f11cc78495976aa3a6baa3dd42945adaf3198780`](https://github.com/madfam-org/pliego/commit/f11cc78495976aa3a6baa3dd42945adaf3198780),
clean at every recorded run. Same fixture/runtime family as above; no UI or
reader-source change. The [model and limits](../../coupled-contact-experiment.md)
describe the gap barrier, radial GN operator, per-iteration CCD/descent and
residual-aware sleep. It is not a C-IPC solver.

Reports:

- [Eleven axial cases](axial-f11cc78.json), including the previous-pose ablation
  and three coupled nonlinear budgets.
- [Twelve-case first-turn booklet matrix](barrier-f11cc78-first-turn.json).
- [Previous engine `6cc50a2` with the same new harness](barrier-baseline-6cc50a2.json):
  four supported references, eight explicitly unsupported new-option cases.
- [Repeated active-leaf S8/I8 coupled case](barrier-f11cc78-repeat.json).
- [Recorded-field comparison](barrier-comparison.json): all four supported
  legacy booklet cases agree numerically with the prior engine; the one repeated
  coupled case agrees in every recorded non-timing result. This is not a
  full per-frame trajectory hash. Active-contact World snapshot replay is also
  covered by the unit suite.
- [Eight-turn previous-pose reader](previous-pose-f11cc78-eight-turn.json).

The seven original axial cases also retain exactly the prior report's fixture
hash, extensions, drift, peak tensile strain, final speed and final position
hash. The new options stay off by default.

### Axial response and the initialization ablation

The strip is unchanged: 10 mN, 100×10×0.1 mm, uncapped synthetic copy-80 MD,
3 simulation seconds. The analytical bar reference is 0.000181818 mm. All four
new cases reach about **0.000180146 mm**, a **0.920%** bar discrepancy, with zero
half-time-to-end drift. Contact is disabled for the previous-pose case; coupled
cases require zero barrier stencils and zero barrier energy in this workload.
Thus the improvement is not evidence that contact forces fixed the axial model.

| New S8 case | Maximum nonlinear budget per substep | Unconverged executed substeps | Final force residual | Active / asleep frames |
|---|---:|---:|---:|---:|
| Previous-pose legacy, line search | 1 | not measured | not measured | 32 / 148 |
| Coupled normal solver | 8 | 20 | 0.0009515 µN | 32 / 148 |
| Coupled normal solver | 32 | 5 | 0.0009733 µN | 30 / 150 |
| Coupled normal solver | 256 | 0 | 0.0009808 µN | 30 / 150 |

Budget 256 is a ceiling: actual work is reported, and many settled substeps use
zero nonlinear updates. Lower budgets reach the same final axial response but
do not pass the all-substeps force-convergence gate. The native unit tests also
check unloading back to rest. Neither bar agreement nor force convergence is
physical-stock calibration or proof of transient accuracy.

The revised harness explicitly counts deterministic engine sleep and reports
active-step p95 and maximum latency. For example, the 256-budget case has active
p95 1.17 ms but maximum step 40.53 ms in this run. Do not use the mostly sleeping
whole-run distribution to claim hard real-time behavior.

### First physical page turn

Each row below runs all 84 requested frames of the first forward turn. Endpoint
progress uses the physical release pose before flat promotion. Required minimum
progress is 90% at every sampled fore-edge vertex.

| Active-leaf model | Peak tensile strain | Minimum endpoint progress | Partial thickness deficit | Unconverged / executed substeps |
|---|---:|---:|---:|---:|
| Default S8/I1 | 0.28751% | 99.97263% | <1e-15 mm | not measured |
| Legacy S8/I8, line search | 0.35592% | 99.97953% | <1e-15 mm | not measured |
| Previous-pose S8/I1, line search | 0.40428% | 99.97298% | <1e-15 mm | not measured |
| Coupled capped S8/I8 | 0.01914% | 99.98334% | 0 mm | 436 / 672 |
| Coupled capped S1/I64 | 0.01911% | 99.98334% | 0 mm | 51 / 84 |
| Coupled uncapped S8/I8 | 0.00548% | 99.98254% | 0 mm | 443 / 672 |

All three coupled active-leaf cases pass this first-turn progress, 0.1% tensile
strain and partial thickness audit. This is a concrete improvement over the
motion-filter-only candidate's stalled physical pages. **None** passes force
convergence at every moving substep: maximum end residuals are approximately
877, 26.6 and 25,450 µN respectively, despite their final static residuals below
0.001 µN. Their numerical work is large: about 169k, 134k and 194k PCG iterations
over the first turn. More nominal updates are not automatically more efficient.

All three coupled **all-flexible** cases fail before the first completed frame
because free vertices initially touch the strict ground barrier. These failures
remain in the 12-case denominator. An initially feasible reduced reader does not
close the general initial-contact problem. No coupled eight-turn or full-corpus
claim follows from this first-turn experiment.

### Eight-turn initialization-only reader

The active reader completes 8/8 requested turns, with minimum sampled endpoint
progress about 99.8931%, peak strain 0.5709% and maximum thickness deficit
**0.098462 mm**. The all-flexible model completes only 1/8 turns and then fails
strain at 1.1733%. The previous-pose option fixes the axial counterexample but
does not solve stack contact or produce a stable physics release.

### Timing context and reproduction

The [live runtime sample](coupled-runtime-context.json) confirms substantial
scheduler contention during this campaign: the research process received about
52% of one logical CPU at that observation. Wall-time distributions are retained
but cannot establish a reliable speedup or close the 8 ms target. First-turn
coupled active-step p95 was about 2.0–2.8 seconds locally; these are exploratory
figures on a contended host, not an isolated equal-error benchmark. Fixed-step
numerical inputs and outcomes do not depend on those wall times.

Reproduce the selected recorded comparison:

```sh
node packages/engine/bench/compare-paper-runs.mjs docs/research/evidence/paper-2026-11-09/barrier-baseline-6cc50a2.json docs/research/evidence/paper-2026-11-09/barrier-f11cc78-first-turn.json docs/research/evidence/paper-2026-11-09/barrier-f11cc78-repeat.json
node packages/engine/bench/paper-campaign.mjs --barrier-matrix --turns 1 --case 4 --model active-leaf --out /tmp/repeated-coupled-turn.json
node packages/engine/bench/paper-campaign.mjs --barrier-matrix --turns 8 --case 3 --out /tmp/previous-pose-eight-turn.json
```

The source checkpoint's CI passes 127 engine and 123 web tests, types/package
checks, and all 16 repository checks. The physics campaign remains active:
initial-contact handling, coupled friction/strain constraints, full sequence and
corpus coverage, independent material measurements and efficient solver/backend
comparisons are still required. No merge, deployment or GA claim is made.

## Consistent curvature and direct local contact

Measured engine/harness checkpoint:
[`e25b8e53e22d361d24156f878ea602751ddc4004`](https://github.com/madfam-org/pliego/commit/e25b8e53e22d361d24156f878ea602751ddc4004).
The [16-case first-turn matrix](local-e25b8e5-first-turn.json),
[eight-turn direct candidate](local-e25b8e5-eight-turn.json),
[prior-engine default controls](local-baseline-5257bf8.json) and
[profiled first-turn repeat](local-e25b8e5-repeat.json) retain source-clean
start/end checks, engine/reader/harness/fixture fingerprints and failures.
Reports use schema 0.3: every sampled pose before flat promotion contributes to
a trajectory hash. The [comparison](local-comparison.json) verifies both default
controls against the prior engine and one selected candidate repeat, including
the whole sampled first-turn trajectory and every recorded non-timing field.
This is not an eight-turn repeat claim.

The declared compressed spring force normally uses 0.05 of tensile stiffness.
The legacy radial GN approximation uses 0.25 after entering compression, or full
stiffness near rest under hysteresis. The optional consistent curvature follows
the actual radial branch, retaining the same energy and gradient. The independent
direct option assembles contact only when every nonzero free pair fits the
elastic graph, in a separate fresh factor. General nonlocal contact is explicitly
refused or counted as a PCG fallback in auto mode.

| Active-leaf first turn | Missed tolerance / executed substeps | Nonlinear updates | CG iterations | Direct solves |
|---|---:|---:|---:|---:|
| PCG, legacy curvature, S8/I8 | 436 / 672 | 3520 | 169021 | 0 |
| Direct, legacy curvature, S8/I8 | 436 / 672 | 3520 | 0 | 3520 |
| PCG, consistent curvature, S8/I8 | 13 / 672 | 2239 | 126193 | 0 |
| Direct, consistent curvature, S8/I8 | 13 / 672 | 2239 | 0 | 2239 |
| Direct, consistent curvature, S8/I32 | 5 / 672 | 2379 | 0 | 2379 |
| Direct, consistent curvature, uncapped S8/I8 | 103 / 672 | 3001 | 0 | 3001 |
| Direct, consistent curvature, S1/I64 | 1 / 84 | 612 | 0 | 612 |

Compression curvature explains the nonlinear-budget improvement in this ablation.
Changing the linear solver alone leaves the miss count unchanged. Direct solves
and CG iterations are different work units; their counts are not a speedup ratio.
All seven coupled active-leaf cases exceed 99.98% endpoint progress, stay below
0.02% peak tensile strain and have zero partial resting-block deficit. All seven
coupled all-flexible cases fail initial strict ground feasibility before a complete
frame. No case passes every moving-substep force tolerance or the 8 ms gate.

### Full sequence and cost

The direct consistent S8/I32 candidate completes **8/8 turns and 672 frames**.
Its minimum endpoint progress is 99.98334%, peak tensile strain 0.019115%, maximum
compression 0.495494%, and partial vertex-to-resting-block thickness deficit zero.
The cache stays at two worlds. Fourteen frames begin asleep; 658 begin active,
corresponding to 5264 executed substeps. Of those, **680 miss the 0.001 µN force
tolerance**, with a peak end residual of 43.5491 µN. The final pre-promotion
residual is 0.672527 µN. Actual work includes 38503 direct solves and **250492
backtracks**, with no nonlocal fallback or rejected search recorded.

Active-frame p95 is about **23.25 seconds**, maximum step 26.85 seconds, and
whole-run mean step 3.18 seconds. This diagnostic run included a short inspector
profile, read-only state captures and a small objective diagnosis; it is not an
isolated device performance certificate. It clearly does not satisfy interaction
latency. The [runtime observation](local-runtime-context.json) records about 98%
of one CPU during the run, without node/network identity. The retained geometry
passes are partial tests on a capped material model, not physical calibration,
full primitive-contact certification or browser acceptance.

The [whole-process first-turn profile](local-first-profile.json) attributes 91.48%
of sampled time to `swept.js`; its Cholesky factor sample share is 1.21%.
The [two-second late-turn sample](local-late-profile.json) attributes 91.29% to
`swept.js` and 1.71% to factorization. Loading/JIT/diagnostics are included in the
first profile. These are sample attributions, not retired-instruction counts or
a proof about every workload. They prioritize conservative spatial indexing over
assuming a faster factorization backend will fix the reader.

### Late-turn convergence diagnosis

The [native objective capture](late-turn-objective.json) records the accepted
pre-direction pose during frame 650 of the final reverse turn, its previous pose,
inertial target and solver/driver inputs. It normalizes the in-flight snapshot's
trial `x` to that accepted pose. JSON numeric arrays do not preserve signed zero;
this is an objective reproducer, not bit-exact `World.step` replay.

`replay-contact-objective.mjs` reconstructs energy `355.1898846773351 nJ` and
free-force residual `0.6630251270038201 µN`, with zero difference in the captured
free gradient values. The [source-clean reconstruction report](late-objective-49ab74d.json)
pins the replayer, capture and measured engine source separately. Along its GN proposal, the symmetric energy change
`(E(x+alpha*d)+E(x-alpha*d))/2-E(x)` is concentrated in EE contact:

| alpha | Implicit terms, nJ | VT contact, nJ | EE contact, nJ |
|---|---:|---:|---:|
| 0.1 | 2.29e-9 | 1.64e-9 | 7.87e-7 |
| 0.01 | 2.27e-11 | 1.64e-11 | 7.60e-8 |

That behavior motivates regularization and contact multiplicity work; it does
not attribute every backtrack to one mechanism. The separate
[analytical parallel-edge probe](parallel-e25b8e5.json) proves a concrete
smoothness limit: for two overlapping parallel segments, tilting gives distance
`0.12-|epsilon| mm`. Both signs increase the unmollified barrier energy. One-sided
slopes approach ±9.997744 µN while the central slope is zero. A selected closest
branch cannot be a smooth gradient at that tie. The new limitation test records
this as an **open gate**, not a successful smooth-contact validation.

Reproduction at the measured checkpoint (the capture replayer is added in the
following evidence checkpoint):

```sh
node packages/engine/bench/paper-campaign.mjs --local-matrix --turns 1 --out /tmp/local-first.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 6 --model active-leaf --turns 8 --out /tmp/local-eight.json
node packages/engine/bench/compare-paper-runs.mjs docs/research/evidence/paper-2026-11-09/local-baseline-5257bf8.json docs/research/evidence/paper-2026-11-09/local-e25b8e5-first-turn.json docs/research/evidence/paper-2026-11-09/local-e25b8e5-repeat.json
node packages/engine/bench/replay-contact-objective.mjs --out /tmp/late-objective.json
node --test packages/engine/test/local-contact-solve.test.js packages/engine/test/parallel-contact-limit.test.js
```

The engine checkpoint passes 132 engine / 123 web tests and all 16 CI checks.
The later evidence checkpoint adds the parallel-contact limitation test and
clarifies derivative scope. General geometry-dependent join Jacobians, contact
weighting/mollification, material measurements, full corpus/device acceptance,
local solver/model candidates and lower-level backend comparisons remain open.
Research and implementation are **not exhausted**. No merge or deployment.

## Ordered refit BVH

The opt-in index is measured at source
[`9a62ba9b0a151ab28ef9b0171903a57013078b1f`](https://github.com/madfam-org/pliego/commit/9a62ba9b0a151ab28ef9b0171903a57013078b1f).
Default traversal stays `reference`. The [coverage/order explanation](../../bvh-broadphase-experiment.md)
distinguishes exact substitution of the current policy from physical validation.
All measured runs start/end with clean, unchanged source and recorded fingerprints.

- [Initial component index](bvh-02e82e1-pairs.json),
  [refined component index](bvh-9a62ba9-pairs.json) and
  [same-input/pair comparison](bvh-refinement-comparison.json) retain all five scenes.
- [Fresh first-turn reference](bvh-9a62ba9-reference.json),
  [indexed first turn](bvh-9a62ba9-first-turn.json),
  [indexed repeat](bvh-9a62ba9-repeat.json) and
  [strict comparison](bvh-first-comparison.json) match every recorded non-timing
  result against the prior first-turn matrix and each other.
- [Indexed eight turns](bvh-9a62ba9-eight-turn.json) and
  [strict comparison](bvh-eight-comparison.json) match every recorded non-timing
  result against the earlier complete direct S8/I32 sequence. The hash covering
  all 672 sampled pre-promotion poses is still
  `b34618c7cc73f041a18e74547f72c6b9a7316a255a74703317f802a62ffa4ebd`.
  This is one indexed full sequence, not an indexed full-sequence repeat.
- [All-flexible initial-feasibility failure](bvh-9a62ba9-infeasible.json) remains a
  failed physical case: zero completed frames/turns. Its terminal checkpoint was
  marked complete only for the harness, retaining the failed case and false gates.
  Comparator negative controls reject altered pose hashes and force diagnostics.

Warm component medians (ms), nine alternating sequential samples per traversal:

| Scene | Paired reference | Refined BVH | Exact ordered pairs |
|---|---:|---:|---|
| Native initial energy | 5.027 | 0.977 | yes |
| Native late energy | 5.236 | 1.614 | yes |
| Native late sweep | 4.662 | 0.953 | yes |
| Synthetic large prescribed sweep | 85.053 | 128.250 | yes; slower |
| Synthetic dense all-free | 105.836 | 74.962 | yes |

The initial index was about 1.5× slower on both synthetic scenes; those negative
measurements remain. Initial stationary/active grouping and exact enclosing-root
queries improve the refinement but do not eliminate the large-sweep regression.
Candidate coverage/order and component timing are separate claims. Counts distinguish
primitive overlap tests from internal/leaf tests and separate root-enclosure tests.

Fresh first-turn active-frame p95 is 1009.72 ms reference versus 318.90/303.52 ms
indexed. Full-sequence diagnostic active p95 is 7861.01 ms indexed versus the older
23253.50 ms reference; indexed mean is 1062.09 ms and maximum 9324.12 ms. Process
CPU mean is 1060.56 ms and active p95 7855.49 ms, including JIT/GC threads. The older
full run included short profiles/probes; the indexed full run included two brief
independent Python algebra checks. These are exploratory local timings, not an
isolated device certificate or a universal speed ratio. No competing full physics
suite ran. Strictly identical physics still has **680/5264 unconverged substeps,
250492 backtracks and 43.5491 µN peak end residual**. Both accuracy and 8 ms fail.

Reproduce component/first-turn comparisons with the commands in the index memo;
for the full sequence (known slow; use the incremental checkpoint):

```sh
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 6 --model active-leaf --turns 8 --broad-phase bvh --checkpoint /tmp/bvh-eight-progress.json --out /tmp/bvh-eight.json
node packages/engine/bench/compare-broadphase-runs.mjs docs/research/evidence/paper-2026-11-09/local-e25b8e5-eight-turn.json /tmp/bvh-eight.json
```

[Parallel-contact research](../../parallel-contact-review.md) now adds a
[60-case independent multiplier prototype](mollifier-independent.json): maximum
normalized scalar/gradient/Hessian reference errors ≤3.1×10⁻¹⁶, finite-difference
errors ≤6.3×10⁻¹⁰. It uses compiled Toolkit **1.4.0** with the recorded binary hash;
source review of 1.6.0 is not a runtime test of that release. Native neighbor-filter
regression shows a parallel EE pair without its geometric VT backup retained.
No smoothing, friction, new material validation or native contact-force fix is
claimed by this checkpoint. Corpus, devices, model alternatives and backend
comparisons remain open. Research and implementation are **not exhausted**.

The [following guarded-contact checkpoint](../paper-2026-11-10/README.md) now
records repeated force-converged capped and uncapped eight-turn readers. These
historical failures remain; later force-gate progress does not erase timing,
calibration, general coverage or device work still owed.
