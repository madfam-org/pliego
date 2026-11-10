# Surface-guarded contact evidence

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
