# First paper campaign measurements

This page retains the first solver measurements and the subsequent
[continuous-contact comparison](#continuous-contact-and-physical-turn-progress).
Their source checkpoints are separate; later evidence does not replace earlier failures.

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
listed solver files; the commit pins the remaining dependencies. No preview fallback,
compressed simulation time or dropped physics frames is used. A successful CLI exit
means the experiment finished recording results, including failures.

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
solver optimum. Only S=128 and S=256 pass the 5% bar gate; S=128 also meets the
strip's 8 ms target. This does not transfer to the booklet workload or phones.

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
