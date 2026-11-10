# First paper campaign measurements

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
