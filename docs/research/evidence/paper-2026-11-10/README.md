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

## Uncapped comparison remains open

The [uncapped S8/I8 first turn](ba6-uncapped-I8.json) passes the endpoint, numerical
and partial resting-block gates but misses force tolerance on **103/672** substeps,
with peak end residual 7896.50 µN and active p95 360.84 ms. Lower tensile strain
(0.00548%) does not close that failure. The implementation checkpoint therefore
adds an explicit `--iterations` budget override for continued uncapped comparisons;
no tolerance is weakened. Contact-free axial loading/unloading comparisons are
also available via `axial-pull.mjs --local-contact`; measured source-clean results
are recorded separately when completed.

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
