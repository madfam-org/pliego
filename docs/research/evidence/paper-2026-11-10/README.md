# Paper physics evidence

Status: research checkpoint, not a stable catalogue physics release. The model
changes EE energy and its gradient; this is not an index-only equivalence claim.
Implementation source:
[`ba6dd592de4e0ae676e88adb6a4b9e81d917e843`](https://github.com/madfam-org/pliego/commit/ba6dd592de4e0ae676e88adb6a4b9e81d917e843).
Read the [coverage condition and approximation](../../parallel-contact-review.md).

## Controls and first turn

The current harness runs an archived engine from
`b36347cc90244e0deb0a694610cd434f06a03d3c` and the new engine with smoothing disabled,
then the new candidate and repeat. `source.git` identifies the harness checkout;
`source.engine` explicitly identifies the old archive and `engineTreeSHA256` pins
its engine bytes. The archive's engine hash also matches the earlier retained BVH
run. Every recorded non-timing control result, including the hash of all sampled
poses, agrees. The candidate repeat matches every recorded non-timing result,
including new contact/coverage totals. Sources stay clean and unchanged throughout.

- [Archived control](ba6-old-control.json), [fresh control](ba6-fresh-control.json)
- [S8/I8 candidate](ba6-first-turn.json), [candidate repeat](ba6-first-repeat.json)
- [Strict control/repeat comparison](ba6-first-comparison.json)

| First turn, capped S8/I8 direct/consistent | Force misses | Backtracks | Active-frame p95 |
|---|---:|---:|---:|
| Archived control | 13 / 672 | 17 | 300.13 ms |
| Fresh control | 13 / 672 | 17 | 296.33 ms |
| Surface-guarded candidate | 5 / 672 | 1 | 295.32 ms |
| Candidate repeat | 5 / 672 | 1 | 298.00 ms |

All pass endpoint progress, 0.1% tensile strain and the partial resting-block
vertex audit; the force and 8 ms gates still fail. The candidate peak end force
is 511.883 µN, close to the control's value: fewer failures is not all-step
convergence. This first-turn timing does not establish a speedup.

## Complete eight-turn S8/I32 candidate

[First full sequence](ba6-eight-turn.json), [full repeat](ba6-eight-repeat.json)
and [whole-report repeat comparison](ba6-eight-repeat-comparison.json) retain
all eight turns, 672 frames and every sampled pre-promotion pose. All recorded
non-timing report fields match exactly, including source/input protocol,
solver/CCD/coverage diagnostics and every non-time gate. The trajectory hash is
`666347fe93c97daa9db829fc80921db043477ede3c7041eb6d72283ef2124636`.

| Measure | Unsmoothed indexed reference | Surface-guarded candidate / repeat |
|---|---:|---:|
| Turns / frames | 8 / 672 | 8 / 672 |
| Active / sleeping frames | 658 / 14 | 646 / 26 |
| Executed substeps | 5264 | 5168 |
| Substeps missing 0.001 µN force tolerance | 680 | **0 in both runs** |
| Maximum end force residual | 43.5491 µN | **0.000998705 µN** |
| Direct solves | 38503 | 17230 |
| Backtracks | 250492 | 62 |
| Active-frame p95 | 7861.01 ms | 286.58 / 289.42 ms |
| Mean step | 1062.09 ms | 131.92 / 132.05 ms |
| Maximum step | 9324.12 ms | 522.28 / 522.74 ms |

The [unsmoothed reference](../paper-2026-11-09/bvh-9a62ba9-eight-turn.json)
is the retained prior-source run, not a fresh same-harness full-sequence control;
its source and timing context remain recorded. Current fresh controls verify the
first turn. New full runs were sequential without a competing physics/test suite.
Timings include first-frame/JIT cost and are exploratory local measurements;
this is not a sustained browser/device certificate or universal speed ratio.

The changed energy reaches the existing sleep criteria earlier, after force
convergence; both runs still sample all 672 frames and retain release poses before
flat promotion at 1.4 simulation seconds. There is no wall-time compression or
preview fallback. Peak tensile strain is 0.019115%, compression 0.495484%, minimum
endpoint progress 99.98334%, partial resting-block deficit zero. No rejected
steps, linear failures or nonlocal fallbacks occur.

The declared model's all-substep force gate now passes. The 8 ms target still
fails by a large margin, and the partial resting-block audit is not full CCD
certification. These runs still use the capped membrane: the stock-level audit
shows only 1.4269% MD / 3.1392% CD of the input in-plane stiffness. Passing force
balance for that model is **not material validation**.

Coverage totals count repeated gradient evaluations, not unique contacts:
27566 evaluations, 4726033 active EE observations, 1048368 smoothed observations
and 7626 uncovered observations retaining their original barriers. No exact-zero
parallel multiplier is observed in this native sequence; the analytical parallel
limit is tested separately. This remains partial smoothing, with general topology,
degenerate-feature, friction and contact-weighting work open.

## Uncapped budget limitation at the first checkpoint

The [uncapped S8/I8 first turn](ba6-uncapped-I8.json) passes the endpoint, numerical
and partial resting-block gates but misses force tolerance on **103/672** substeps,
with peak end residual 7896.50 µN and active p95 360.84 ms. Lower tensile strain
(0.00548%) does not close that failure. The implementation checkpoint therefore
adds an explicit `--iterations` budget override for continued uncapped comparisons;
no tolerance is weakened. Contact-free axial loading/unloading comparisons are
also available via `axial-pull.mjs --local-contact`; source-clean results from the
following checkpoint are recorded below.

## Reproduction

```sh
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 4 --model active-leaf --turns 1 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/surface-first-progress.json --out /tmp/surface-first.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 6 --model active-leaf --turns 8 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/surface-eight-progress.json --out /tmp/surface-eight.json
node packages/engine/bench/compare-paper-repeat.mjs docs/research/evidence/paper-2026-11-10/ba6-eight-turn.json docs/research/evidence/paper-2026-11-10/ba6-eight-repeat.json --out /tmp/eight-repeat-comparison.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 7 --model active-leaf --turns 1 --iterations 32 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/uncapped-progress.json --out /tmp/uncapped.json
node packages/engine/bench/axial-pull.mjs --local-contact --out /tmp/local-axial.json
```

Run commands from the repository root. The repeat checker compares whole reports except
recording timestamps and enumerated timing fields/their 8 ms gate; deterministic
failure does not become acceptance. The contact-variant comparator independently
checks unchanged controls and changed-model repeats.

Research and implementation are not exhausted. No merge, deployment, package
publication, calibrated material model or stable physical catalogue is claimed.

## Uncapped I32, strip reference and current performance evidence

Measurement/harness source:
[`6fbc553096d75846870710c18f7cfa47d2d9c1ee`](https://github.com/madfam-org/pliego/commit/6fbc553096d75846870710c18f7cfa47d2d9c1ee).
The engine tree is unchanged from `ba6dd59`; this checkpoint adds explicit budget,
loading/unloading and repeat-verification harness support. The stock-level
`materialAudit` ratios describe the cap; cases with `physicalMembrane: true`
bypass it and use the input modulus. This does not turn the edge/hinge model
into a calibrated orthotropic FE reference.

- [Uncapped I32 first turn](6fb-uncapped-I32-first.json)
- [Full uncapped eight turns](6fb-uncapped-eight-turn.json),
  [full repeat](6fb-uncapped-eight-repeat.json) and
  [strict whole-report repeat](6fb-uncapped-repeat-comparison.json)

The first turn changes from 103/672 force misses at I8 to 0/672 at I32, without
changing force tolerance. Both full sequences then complete all eight turns,
672 frames and 5200 executed substeps with **zero force misses**. Every recorded
non-timing result, source/input field, sampled-pose hash and solver/contact
metric agrees between full runs. The full trajectory hash is
`01aef1cb7236da259a6e16a461721a89bdcd8a28a61a327b10c3cdfb8f219dbf`.

| Full uncapped S8/I32 | First run | Repeat |
|---|---:|---:|
| Active / sleeping frames | 650 / 22 | 650 / 22 |
| Force misses / executed substeps | 0 / 5200 | 0 / 5200 |
| Maximum end force residual | 0.000999169 µN | identical |
| Direct solves / backtracks | 24377 / 178 | identical |
| Active-frame wall p95 | 504.15 ms | 783.95 ms |
| Active-frame process-CPU p95 | 456.46 ms | 477.77 ms |
| Mean wall step | 206.66 ms | 252.71 ms |
| Mean process-CPU step | 194.04 ms | 207.20 ms |
| Maximum wall step | 888.07 ms | 2111.99 ms |

Wall-cost variation is substantial despite exact recorded physics replay.
These are sequential exploratory local runs without a competing physics/test
suite, not isolated target-device certification. Neither meets 8 ms. Numerical
peak tensile strain is 0.005476%, compression 0.064356%, minimum endpoint progress
99.98254%, and the partial resting-block vertex deficit is zero. No rejected
steps, linear failures or nonlocal fallbacks occur. Repeated gradient totals are
34777 evaluations, 5766533 active EE observations, 1298506 smoothed observations
and 9634 uncovered observations; general smooth coverage remains open.

The [contact-free strip matrix](axial-local.json), regenerated at
[`cc74f251b95872a5838d7ff205a2f4aee2dce095`](https://github.com/madfam-org/pliego/commit/cc74f251b95872a5838d7ff205a2f4aee2dce095),
tests direct/consistent uncapped
I32/I128, each with smoothing off/on, for 180 loaded plus 120 unloading frames.
All four pass the declared 5% axial-reference, 1% half-time drift, every-substep
force and unloading-return gates. Loaded extension is 0.000180145916 mm versus
the synthetic axial reference 0.000181818182 mm: 0.91975% error and zero recorded
half-time drift. Final unloaded extension is −1.55745×10⁻⁹ mm.
[Strict off/on comparison](axial-local-comparison.json) verifies all recorded
non-timing results, loaded/unloaded pose hashes and force counters match at
each budget. Active contact stencils and energy remain zero: this validates
that combined material/solver response in this fixture, **not contact forces or
a causal improvement from smoothing**. It is not held-out paper data, a 2D FE
reference, or mesh/time convergence. Loaded active p95 spans about 1.13–4.87 ms
across this small, sequential four-case matrix; that is not booklet performance.
Per-file source digests use explicit path/SHA256 records. The metadata-format
change preserves every digest and all numerical loading/unloading results.

The [all-flexible uncapped probe](6fb-initial-feasibility.json) still fails initial
strict geometry/ground feasibility before a completed frame; all physical gates
remain false. No unsupported case is silently turned into a successful reader.

The [S1/I64 capped first-turn probe](6fb-S1-first-turn.json) completes 0/84 force
misses with active p95 about 66.51 ms. It is a single first turn, not a repeated
full sequence or temporal-accuracy certificate. Changing time integration is a
separate model/work comparison, not an equivalent-backend speedup. The target
still fails.

The [fresh whole-process CPU sample](6fb-first-profile-summary.json) and its
[profiled run](6fb-first-profile-run.json) identify the current cost after smoothing:
46.08% sampled self time in `bounds-tree.js`, 22.15% in `swept.js`, and 4.65% in
Cholesky factorization. Query, refit and candidate construction therefore remain
priority measurements for exact reuse/index/backend work. The sample includes
loading, construction, JIT and diagnostics, and is not an isolated step or
retired-instruction profile. Raw local paths are removed from the public summary;
its raw-profile, run, reducer and stage-classifier hashes remain recorded.

[Production multiplier comparison](6fb-independent-reference.json) checks all
60 cases against compiled IPC Toolkit 1.4.0: scalar values match and maximum
normalized gradient error is 3.04×10⁻¹⁶. The accompanying Python multiplier-Hessian
algebra checks are distinct from the native approximate contact curvature.
The [retained late-pose probe](6fb-late-objective.json) reconstructs the old
control energy/free gradient, then transplants that pose into the changed model.
Its candidate accepts a full step with no backtracking and reduces **its own**
force residual from 61.0893 to 4.30834 µN; the energy change means those residuals
cannot be compared as the same objective. Random-direction finite differences
approach the new gradient as perturbations shrink. This JSON-valued frozen-pose
probe is not bit-exact World history or a new material-validation result.

The repeat checker also rejects deliberately altered trajectory hashes and
coverage counts. Reproduce the strip ablation and uncapped full repeat:

```sh
node packages/engine/bench/axial-pull.mjs --local-contact --out /tmp/local-axial.json
node packages/engine/bench/compare-axial-contact.mjs /tmp/local-axial.json --out /tmp/axial-comparison.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 7 --model active-leaf --turns 8 --iterations 32 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/uncapped-eight-progress.json --out /tmp/uncapped-eight.json
node packages/engine/bench/compare-paper-repeat.mjs docs/research/evidence/paper-2026-11-10/6fb-uncapped-eight-turn.json docs/research/evidence/paper-2026-11-10/6fb-uncapped-eight-repeat.json --out /tmp/uncapped-repeat-comparison.json
```

The 0.05 mm collision-thickness floor and minimum 0.12 mm reading-pose spacing
are further explicit limits: these 0.1 mm stock examples do not calibrate thin
paper, physical stack height, contact pressure or the imposed resting blocks.
Force convergence is a numerical gate for the declared model. Measured stock,
general friction/strain/contact, corpus, live hand coupling, real devices and
alternative solver/backend gates still require work. Research remains active.


## Exact-pose candidate reuse

Implementation source: [`62fd456`](https://github.com/madfam-org/pliego/commit/62fd4565de9215b69724457740d862365ed11cf7).
The [implementation and cost scope](../../bvh-broadphase-experiment.md#exact-pose-reuse-validation)
explain exact invalidation, immutable connectivity, swept bypass and the retained
large-sweep regression. Physics defaults and force tolerances are unchanged.

| Model | New full run / repeat | Prior parity / new repeat comparison | Force misses | Active-frame p95, ms |
|---|---|---|---:|---:|
| Capped S8/I32 | [run](reuse-capped-eight.json), [repeat](reuse-capped-repeat.json) | [prior](reuse-capped-comparison.json), [repeat](reuse-capped-repeat-comparison.json) | 0/5168 | 290.21 / 237.21 |
| Uncapped S8/I32 | [run](reuse-uncapped-eight.json), [repeat](reuse-uncapped-repeat.json) | [prior](reuse-uncapped-comparison.json), [repeat](reuse-uncapped-repeat-comparison.json) | 0/5200 | 364.81 / 344.81 |

The first capped run overlaps the engine suite; exclude its timing from performance
conclusions. Other runs are sequential with no competing local campaign/suite;
ordinary background activity still applies. Physics results match independently
of wall cost. All 672 sampled poses and all recorded force/contact counters match
their controls. The capped comparator's explicit compatibility path accepts only
the reviewed old/new harness fingerprints and absent-to-null iteration metadata;
effective options and every other non-time field remain strict. Unknown harnesses,
non-null overrides, altered poses, solver options, protocols or force gates are rejected.

[Five-scene component data](reuse-component.json) distinguishes reference scans,
forced BVH refits and allowed exact reuse. Native identical-pose reuse is about
0.02 ms; native sweeps rebuild at about 0.97 ms. Large-sweep BVH cost still exceeds
the reference; dense separate-array inputs deliberately rebuild. Ordered pair
bytes agree in all scenes. These candidate timings are not World.step timings.

The [new profiled run](reuse-first-profile-run.json), [sanitized summary](reuse-first-profile-summary.json)
and [strict prior-run comparison](reuse-first-profile-comparison.json) retain the
same physical trajectory. Candidate construction/query/refit remains 55.51% of
sampled whole-process self time, versus 68.23% before reuse. The sample includes
loading, construction, JIT and diagnostics; local raw profiles are not committed.
An exact active-only traversal and equivalent backend comparisons remain open.

```sh
node --test packages/engine/test/swept-bvh.test.js packages/engine/test/paper-execution.test.js
node packages/engine/bench/broadphase-pairs.mjs --out /tmp/reuse-component.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 6 --model active-leaf --turns 8 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/reuse-capped-progress.json --out /tmp/reuse-capped.json
node packages/engine/bench/compare-paper-execution.mjs docs/research/evidence/paper-2026-11-10/ba6-eight-turn.json /tmp/reuse-capped.json --legacy-iteration-metadata --out /tmp/reuse-capped-comparison.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 7 --iterations 32 --model active-leaf --turns 8 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/reuse-uncapped-progress.json --out /tmp/reuse-uncapped.json
node packages/engine/bench/compare-paper-execution.mjs docs/research/evidence/paper-2026-11-10/6fb-uncapped-eight-turn.json /tmp/reuse-uncapped.json --out /tmp/reuse-uncapped-comparison.json
```

Use the recorded Node/runtime for strict cross-source comparisons. Repeat each
full run on the same clean source and use `compare-paper-repeat.mjs` to check all
recorded non-time fields. Source changes during a campaign invalidate its report.
Interaction, measured-paper accuracy and device gates remain separate and open.


## Rank-preserving active-edge traversal

The [first experiment](active-naive-component.json), source
[`f4b33a6`](https://github.com/madfam-org/pliego/commit/f4b33a6c70cb81eb98d890e661fb4a847a684195),
reduces query count but increases node visits and has no consistent native cost
win. The [refined six-policy comparison](active-refined-component.json), source
[`fe2ae0c`](https://github.com/madfam-org/pliego/commit/fe2ae0c215022c90e7d022713994f1576584523f),
preserves active-rank pruning while retaining earlier stationary partners. It
compares reference, original rank, naive active, ranked active, auto and cache-hit
policies on identical inputs. The [strict component comparison](active-component-comparison.json)
checks five input/pair fingerprints and unchanged original/naive structural work.
All ordered pair bytes agree within each component report.

Native edge queries fall 1312→317. Combined VT/EE node tests fall from
19850/38446/19829 to 18680/34906/18619 for the retained initial/late/sweep scenes.
These retained native poses include the older unsmoothed late-state capture;
they are component inputs, not full refined-model histories. Auto full builds
measure roughly 0.95/1.55/0.95 ms; rank traversal roughly 0.99/1.59/0.98 ms.
The differences are small exploratory local measurements. Fully mobile scenes
use rank traversal; forced active variants retain their dense/large-sweep costs.
The synthetic large-sweep BVH remains slower than the reference scan.

| Model | Full run / repeat | Prior parity / same-source repeat check | Force misses | Active p95, ms |
|---|---|---|---:|---:|
| Capped S8/I32 | [run](active-capped-eight.json), [repeat](active-capped-repeat.json) | [prior](active-capped-comparison.json), [repeat](active-capped-repeat-comparison.json) | 0/5168 | 205.28 / 201.62 |
| Uncapped S8/I32 | [run](active-uncapped-eight.json), [repeat](active-uncapped-repeat.json) | [prior](active-uncapped-comparison.json), [repeat](active-uncapped-repeat-comparison.json) | 0/5200 | 319.83 / 299.78 |

Every recorded non-time result and the complete 672-frame sampled-pose hashes
match the exact-reuse controls. Every recorded non-time report field repeats on
the new source. Effective physics options, force tolerance and all non-time gates
remain unchanged. All new full/component/profile runs were sequential, without
competing local campaigns/suites; ordinary background activity is not excluded.
Prior-source timing comparisons are not a fresh paired device trial.

The [profiled first turn](active-first-profile-run.json), [sanitized sample summary](active-first-profile-summary.json)
and [strict prior-profile parity check](active-first-profile-comparison.json)
preserve the preceding profiled run's non-time results and input metadata.
Candidate work remains 53.35% of sampled whole-process self time versus 55.51%
before active traversal; factorization is 6.53%. The profile includes startup,
construction, JIT and diagnostics. Raw local profiles are not committed.

```sh
node --test packages/engine/test/swept-bvh.test.js packages/engine/test/swept-contact.test.js
node packages/engine/bench/broadphase-pairs.mjs --out /tmp/active-component.json
node packages/engine/bench/compare-edge-traversals.mjs docs/research/evidence/paper-2026-11-10/active-naive-component.json docs/research/evidence/paper-2026-11-10/active-refined-component.json --out /tmp/active-component-comparison.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 6 --model active-leaf --turns 8 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/active-capped-progress.json --out /tmp/active-capped.json
node packages/engine/bench/compare-paper-execution.mjs docs/research/evidence/paper-2026-11-10/reuse-capped-eight.json /tmp/active-capped.json --out /tmp/active-capped-comparison.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 7 --iterations 32 --model active-leaf --turns 8 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/active-uncapped-progress.json --out /tmp/active-uncapped.json
```

Repeat on the same clean source and use `compare-paper-repeat.mjs`. The
[algorithm audit](../../bvh-broadphase-experiment.md#active-edge-traversal-experiment)
details ordering, coverage and the mobility heuristic. Native reading still
misses 8 ms, and measured-paper, general-contact and actual-device gates remain
open. Equivalent backend ports and broader solver/model comparisons remain work.


## Scalar binary64 WebAssembly refit/query

This is an opt-in exact backend experiment, with an unchanged JavaScript default.
[Implementation and reproduction](../../wasm-contact-experiment.md) describe its
1,268-byte kernel, interface, memory costs and compiler provenance. Full/native
component measurements and the profile pair use clean source
[`4b48ec1`](https://github.com/madfam-org/pliego/commit/4b48ec15ab40c5a5cc6c6b9002ecb5e44a82f0a8).
Fresh JS controls and Wasm candidates use the same source, harness, runtime,
inputs and effective physics options except the declared backend selector.
The implementation does not change tolerances, time steps, solver work or energy.

| Model | Fresh JS control | Wasm run / repeat | Fresh backend / same-source repeat comparisons | Force misses | Active wall p95, JS → Wasm / repeat |
|---|---|---|---|---:|---:|
| Capped S8/I32 | [control](wasm-control-capped-eight.json) | [run](wasm-capped-eight.json), [repeat](wasm-capped-repeat.json) | [backend](wasm-capped-backend-comparison.json), [repeat](wasm-capped-repeat-comparison.json) | 0/5168 | 207.25 → 185.73 / 189.18 ms |
| Uncapped S8/I32 | [control](wasm-control-uncapped-eight.json) | [run](wasm-uncapped-eight.json), [repeat](wasm-uncapped-repeat.json) | [backend](wasm-uncapped-backend-comparison.json), [repeat](wasm-uncapped-repeat-comparison.json) | 0/5200 | 311.92 → 283.46 / 278.00 ms |

Every recorded non-time physics result, including all 672 sampled poses and all
force/contact diagnostics, matches each fresh control. Wasm repeats match whole
non-time reports on the same source. The fresh controls also match the prior
active traversal runs ([capped](wasm-control-capped-comparison.json),
[uncapped](wasm-control-uncapped-comparison.json)); that cross-source checker
explicitly allows only the reviewed harness metadata migration, source pins and
enumerated clocks. Full physics options remain exact.

These six full runs were sequential without a competing local campaign, suite
or browser. Ordinary background activity remains. The roughly 9–11% observed
p95 reduction is exploratory local evidence, not a universal speed ratio or a
sustained target-device certificate. Both models still fail 8 ms. Their recorded
pose hashes remain `666347fe93c97daa9db829fc80921db043477ede3c7041eb6d72283ef2124636`
and `01aef1cb7236da259a6e16a461721a89bdcd8a28a61a327b10c3cdfb8f219dbf`.
Force convergence remains a numerical gate for the declared model, with the
material, geometry, stock and reader-model limits above still applying.

### Component costs and negative control

The [three-round isolated comparison](wasm-isolated/isolated-comparison.json)
retains six raw reports with their original names and SHA256 digests in the same
directory. Each backend/round starts a fresh process, alternates process order,
runs 32 warmups and measures nine full builds. The reference oracle runs after
timing. Inputs, ordered pair bytes and structural traversal work agree exactly.

| Scene | JS median of medians | Wasm median of medians |
|---|---:|---:|
| Native initial energy | 0.918 ms | 0.754 ms |
| Retained native late energy | 1.486 ms | 1.162 ms |
| Retained native late sweep | 0.931 ms | 0.763 ms |
| Synthetic large prescribed sweep | 126.518 ms | 101.786 ms |
| Synthetic dense all-free | 76.884 ms | **85.704 ms** |

Dense contact regresses in all three rounds. These are candidate-build costs,
including validation, copies, refits, queries, JS sorting/filtering and boundary
calls; they are not World.step or a new trial corpus. Retained late poses include
the older unsmoothed capture. Two warmups produced misleading apparent gains;
only the clean fresh-process 32-warmup reports above support these comparisons.

The first JS constructor/build costs 0.463/20.820 ms; the first Wasm constructor/build
costs 1.442/17.511 ms. Wasm compilation, instance and memory setup are included,
and the first build includes initial JS topology/refit plus Wasm refit. These
are candidate-builder cold costs, not full World initialization. Wasm linear
memory occupies 524,288 bytes per two-tree candidate builder, approximately
1 MiB for potential plus guard per World and 2 MiB for two cached Worlds, in
addition to host allocations. JS memory reporting zero means no Wasm memory;
it does not mean no JS allocation. Hit views still borrow Wasm memory; a
host-owned copy or batched filtering is an unmeasured next experiment.

### Verified samples and browser policy

The profiled [JS first turn](wasm-profile-control-run.json) and
[Wasm first turn](wasm-profile-candidate-run.json) retain
[exact backend parity](wasm-profile-backend-comparison.json).
Their sanitized [JS](wasm-profile-control-summary.json) and
[Wasm](wasm-profile-candidate-summary.json) summaries retain raw-profile/run and
reducer/sanitizer/classifier digests. Raw profiles contain local paths and are
not committed. Current reducer tooling verifies the archived runtime source,
unchanged kernel bytes and its actual exported function indices before
attributing the sole observed Wasm module and known call-boundary signatures.
Unknown modules/functions fail attribution; sample IDs and weights are unchanged.
The supplied profile/run association follows the capture protocol; separate hashes
do not prove that an arbitrary supplied trace belongs to its supplied run.

Candidate work accounts for 54.28% of JS whole-process sampled self time and
49.00% with Wasm. The latter includes 26.07% in `swept.js`, 9.96% Wasm query,
5.74% Wasm refit, 6.34% wrapper, 0.67% call boundary and small JS setup costs.
Factorization accounts for 6.76% / 7.33%. These profiles include startup,
construction, JIT and diagnostics; they are not isolated step or retired-instruction
measurements. Wasm samples are counted rather than scrubbed into generic runtime.

The [strict-policy browser probe](wasm-browser-strict.json) confirms expected
compilation rejection under `script-src 'self'`. The
[research-policy probe](wasm-browser-allow.json) explicitly permits Wasm and
passes both capped and uncapped 84-frame first turns: 492 vertices, 672 executed
substeps and zero force misses each, exact position/velocity bytes, release poses
and recorded contact diagnostics against JS. Source is clean
[`d969fe0`](https://github.com/madfam-org/pliego/commit/d969fe0190e16eafac249c6a2ef521df05fa5341),
whose engine equals the full-run source. This is same-browser backend parity;
production policy, pointer/paint timing and actual touch/stylus devices remain
uncertified. Production headers and the default studio backend are unchanged.

### Post-measurement platform guard

[`c05de1a`](https://github.com/madfam-org/pliego/commit/c05de1a63872e4d850827f69d6a786de0e9189af)
adds an explicit little-endian host check, plus verified profile tooling. The
runtime diff from the full-run source is only that two-line platform guard;
the kernel and numerical algorithms are unchanged. Fresh clean-source
[JS](wasm-guard-control-run.json) and [Wasm](wasm-guard-candidate-run.json)
first turns pass [same-source backend parity](wasm-guard-backend-comparison.json)
and match the preceding profiled first turns in every recorded non-time field
([JS](wasm-guard-control-comparison.json), [Wasm](wasm-guard-candidate-comparison.json)).
The six complete runs remain attributed to their actual source `4b48ec1`.

At `c05de1a`, all 16 CI checks pass, including 154 engine and 123 web tests,
45-source JSDoc/declaration checks, a 94-file package check and full-history
secret scanning. This milestone does not close material or interaction gates,
establish a lowest possible abstraction, or exhaust implementation/research.


## Independent membrane tensor audit

Clean implementation/measurement source:
[`f145538`](https://github.com/madfam-org/pliego/commit/f145538f8200563ff110439f006605882050d2ba).
The [complete run](membrane-run.json), [repeat](membrane-repeat.json) and
[strict whole-report comparison](membrane-comparison.json) retain **108 cases**
with exact agreement in every field except recording time, including failed
engineering gates. The [method and derivation](../../membrane-constitutive-audit.md)
explain the independent CST reference, material convention and model restriction.
Runtime engine code, reader defaults and stock snapshots are unchanged.

The matrix uses three authored triangle layouts, three resolutions, four grain
angles and three separate cap/compression policies. Native geometry/connectivity
hashes remain fixed across grain/policy changes. All nodes have prescribed affine
poses; no time step, contact, inertia or non-membrane energy occurs. This is an
energy/reaction audit, not a solved boundary-value patch test.

The independent stdlib Python reference evaluates 2,628 cases: 19 mathematical
affine checks plus 54 actual binary64 applied fields for each of 36 mesh/grain
combinations. Actual and nominal inputs are distinguished, so coordinate-rounding
nonaffinity is retained without relaxing the nominal oracle threshold. All 5,832
nonzero engine observations and 324 zero-strain observations complete.

| Separate policy, 36 cases each | Finest-amplitude tensor error | Per-case worst signed energy error |
|---|---:|---:|
| Uncapped, compression = 1 | **14.08–29.78%** | 46.08–60.89% |
| Uncapped, compression = 0.05 | No unique zero-strain tensor | 95.36–98.02% |
| Capped control, compression = 1 | 97.88–98.52% | 99.06–99.23% |

Tensor error is the relative Frobenius norm in the declared global engineering-
Voigt representation, with entry errors separately normalized by sqrt(Qii Qjj).
Each case's worst energy error spans both signs of all nine tested modes. This
does not mean every individual observation fails. The three controls separate
cap and compression effects; the combined shipping cap plus 0.05 policy is not
claimed as another measured policy here.

All 72 symmetric-policy cases pass strain extraction and exhibit the predicted
central-force limit C12 = C66. All fail their 1% tensor gates. Every case fails
its worst-signed-energy gate. Of 48 refinement/topology comparisons, 42 fail
thresholds of 0.5% for 8→16 cells and 1% between finest layouts.

For the uncapped 16×16 forward/alternating layouts at grain zero, C12 and C66
both approach 0.568770 GPa. The independent declared target instead requires
Q12 = 0.762245 GPa and Q66 = 1.435034 GPa. The forward layout also creates
C16/C26 ≈ 0.568770 GPa against a zero target; alternating diagonals suppress that
coupling but retain the constitutive mismatch. Scalar spring refinement and
backend optimization cannot independently tune the constrained tensor entries.

Maximum tensor change across all consecutive strain halvings is 8.46×10⁻¹⁰;
nominal-reference energy and traction errors are below 9.47×10⁻¹⁶ and
7.18×10⁻¹⁵, respectively, against the unchanged 10⁻¹⁰ oracle threshold. The
independent oracle self-tests also pass 144 affine cases and 18 derivative
checks. Engine stats/implicit-objective differences are explicitly retained:
maximum scaled discrepancy 5.08×10⁻¹⁵ against a separate 10⁻¹² observation guard.
No physical 1% gate is weakened. All sources, inputs, tools and reference outputs
retain SHA256 provenance; the two reports compare whole fields exactly.

The target explicitly declares synthetic nu12 = 0.293, consistent with current
directional membrane compliance. Stock provenance and bending use a geometric-
mean Poisson convention; this ambiguity remains unresolved. These failures
establish limits of the declared model, not measured-stock properties or a
dynamic solver failure. A coupled per-triangle orthotropic research model and
an independently solved non-affine reference are next implementation work.
Material calibration, interaction performance and actual-device gates remain open.


## Objective orthotropic triangle model

Implementation and measurement source:
[`25ca58d`](https://github.com/madfam-org/pliego/commit/25ca58d55ba6caad2b8562d03034309cece3d0ac).
The [clean full report](orthotropic-run.json), [repeat](orthotropic-repeat.json)
and [strict comparison](orthotropic-comparison.json) retain 36 new-model cases
plus all 108 spring controls. Every non-recording field agrees, including source,
reference outputs, geometry, energy/gradient/tensor/metric/objectivity results and
failed or unmeasured gates. The [reviewed legacy-control comparison](orthotropic-controls-comparison.json)
checks the full historical audit against the fresh controls; only the explicit
runtime/helper/git migration is allowed. Its old-law physics fields remain exact.
Read the [law, research domain and remaining gates](../../orthotropic-membrane-experiment.md).

| Same synthetic matrix, uncapped symmetric model | Tensor Frobenius error (fraction) | Finest-amplitude worst signed linear-reference energy error (fraction) |
|---|---:|---:|
| Scalar springs, 36 controls | 0.1408–0.2978 | 0.4608–0.6089 |
| Objective orthotropic triangles, 36 cases | ≤1.493e-10 | ≤3.079e-5 |

All new cases pass the unchanged 1% tensor/entry/signed-energy gates, every
strain-halving check and all 24 mesh/topology comparisons. The maximum finest-
amplitude signed energy error is 0.003079%; over all amplitudes it is 0.012314%.
This expected finite-Green versus infinitesimal-strain difference is retained.
At grain zero the new tensor independently represents C12≈0.762245 GPa and
C66≈1.435034 GPa; the old spring C12=C66 restriction is removed.

The independent matrix F/S/P oracle directly evaluates all 1,944 new-model
nonzero applied poses. Maximum energy/gradient relative discrepancies are
1.55e-11 / 5.54e-11 against a separately declared near-rest 1e-7 computational
agreement gate. Runtime stretches and area ratios agree within 8.89e-16 against
1e-10. These numerical checks do not replace the 1% constitutive gates.
An additional 36 finite-rotation cases reuse the original UV/material reference,
with 0/90/180-degree rotations and translations. All pass the declared energy
and **stress-scaled** gradient checks; the force-scale floor dominates here,
so this is not a uniform relative-to-actual-gradient accuracy claim.

Fresh [capped](orthotropic-legacy-capped.json) and
[uncapped](orthotropic-legacy-uncapped.json) retained spring-model S8/I32 booklet
runs preserve every recorded non-time result from their preceding controls
([capped comparison](orthotropic-legacy-capped-comparison.json),
[uncapped comparison](orthotropic-legacy-uncapped-comparison.json)). Both complete
all eight turns and 672 sampled poses, with 0/5168 and 0/5200 force misses.
Their local active p95 values are 211.53 and 306.32 ms; these sequential controls
remain exploratory timing, not a new-law performance or real-device certificate.
No other local physics suite/campaign/profile/browser competes during those runs.

At source `25ca58d`, all 16 CI checks pass: 173 engine / 123 web tests, 46-source
typechecking, 96-file package verification and image smoke. Exact element/Hessian,
GN PSD/operator agreement, active panel bending, supported contact solvers and
snapshot replay have separate tests. No new-model time-step cost is claimed.

This is a synthetic constitutive/objectivity pass for an explicitly selected
research model, not measured-paper or full-shell calibration. Initially planar,
uncreased sheets are supported; joins, creases, hand drives and new-model booklet
reading remain outside acceptance. A solved non-affine FE reference, time/iteration
accuracy, locking/bending, strain/contact limits, stock conventions and actual
input/device performance remain work. Stock snapshots and reader defaults stay
unchanged. Sharing StVK with a published framework transfers no contact guarantees.
