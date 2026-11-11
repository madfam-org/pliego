# Force-tolerance PCG stop: fixed-24 comparison results

2026-11-10. Capture source `15422657ed909c5242ca9dadf6427cbec8853c9e`, run under the
[predeclared protocol](pcg-force-stop-protocol.md). Lossless evidence:
[`evidence/pcg-force-stop-2026-11-10/`](evidence/pcg-force-stop-2026-11-10/README.md).

**Bottom line.** With exact curvature, stopping PCG when the linear residual falls
below half the force tolerance removes 1013 latent failures and adds none. Latent
failures go from 2359 to 1346. At Newton budget 1 with the predictor start, levels 4
and 8 now pass the latent gate on every step. There is no measurable extra cost: PCG
still converged on every solve within its 12-iteration cap. Public failures go from
7078 to 7076.

The remaining budget-1 failures are the nonlinear remainder of a single Newton step;
they are largest from the previous-pose start and at the coarsest timesteps.
**No force, time, material, booklet or device acceptance follows.**

## Force gates, same source, curvature and inputs

Both arms use exact curvature and the same 24 rows, initial bytes, masses, reference
words, F0 and tau=8.81400646629321e-5 microN. The only difference is
`pcgAbsoluteTolerance` = 0.5·tau.

| Newton budget | Judged steps | Relative public | Absolute public | Relative latent | Absolute latent |
|---|---:|---:|---:|---:|---:|
| 1 | 2370 | 2370 | 2368 | 2359 | 1346 |
| 4 | 2370 | 2354 | 2354 | 0 | 0 |
| 16 | 2370 | 2354 | 2354 | 0 | 0 |
| Total | 7110 | 7078 | 7076 | 2359 | 1346 |

Public and latent changes are counted separately:

- **Latent:** 1013 gains, 0 losses.
- **Public:** 2 gains, 0 losses, both on the level-1 budget-1 predictor-start row.

Eighteen trajectories now pass the latent gate throughout (sixteen before); none passes
the public gate throughout.

## Budget 1 in detail

Latent failures out of judged steps, with median latent residual in microN
(relative stop → absolute stop):

| Level | Predictor start | Previous-pose start |
|---:|---|---|
| 1 | 79 → 74 of 79; 0.933 → 0.00467 | 79 → 79 of 79; 26.7 → 0.732 |
| 2 | 158 → 121 of 158; 0.234 → 0.000344 | 158 → 157 of 158; 14.4 → 0.217 |
| 4 | 315 → **0** of 316; 0.0582 → 0.0000230 | 316 → 309 of 316; 7.36 → 0.0561 |
| 8 | 626 → **0** of 632; 0.0145 → 0.00000155 | 632 → 606 of 632; 3.73 → 0.0144 |

Once the linear solve is accurate, what remains is the nonlinear remainder of one
Newton step. From the predictor start that remainder is below tau at levels 4 and 8. It
is not below tau at levels 1 and 2, whose timesteps are larger. From the previous-pose
start every step begins further from the solution, and the remainder stays above tau
even though medians fall 36× to 260×. Budgets 4 and 16 already passed and still do.

## Cost and solver behaviour

- **PCG:** all 12424 solves converged within the unchanged 12-iteration cap. There was
  no stagnation, iteration-limit stop, nonpositive curvature, non-descent or
  nonfinite event.
- **Factors:** exact factors 37346 versus 37345, with no fallback.
- **Wall time:** candidate 446 s versus 462 s for the baseline. That is research
  bookkeeping on one Mac, not an interaction benchmark.

## Integrity and independent checks

- **Exact-curvature replay.** The new relative-stop baseline equals the closed
  milestone-2 capture (`af870bf`) on 8916456 leaves, excluding only `recordedAt` and
  `source`. The source differs only in the 8 reviewed files; everything else is
  byte-identical. Force outcomes are identical (7078 public, 2359 latent).
- **Strict repeat:** 8930638 leaves identical.
- **Observer parity:** 5749783 leaves identical.
- **Captures:** all are measurement-valid, and all 24 restore continuations pass.
- **Endpoint oracle.** 467 retained endpoint samples give complete 80/100-digit proof
  equality (454393 leaves), within the energy (4.54e-13 ≤ 1e-12 nJ) and gradient
  (5.79e-11 ≤ 1e-9 microN) limits. 101 sampled latent and 457 sampled public residuals
  fail (147 and 457 before). Samples cannot certify all 7110 steps.
- **Selected-Newton review.** The frozen reviewer covers 104 role references (84
  unique events, 60 accepted). Every accepted change satisfies strict real Armijo with
  negative real potential change, under native C and real M/h².
- **CI.** CI on the capture source passes 16/16. The local clean-source suite passes
  (engine 358/358, web 123/123, kernel, API, type check, package).

The archive holds 106 payloads plus its manifest: 195852314 stored bytes restore
1094198457 original bytes. Manifest SHA256:
`793e8e1eeca33a0455e81f3c875892a5f9b94005eaadbcabbeadf0e6293b65c6`. The
[independent archive review](pcg-force-stop-archive-review.json) and its
[verifier source](pcg-force-stop-archive-review-source.json) sit outside the archive.
Raw suite logs are excluded with their hashes.

## Development rows

Six development rows were run before freezing: three budget-1 rows for each curvature,
with both stops. The protocol records them. The frozen capture reproduces the
exact-curvature values (74/79, 0/316, 0/632). The Gauss–Newton absolute-stop arm was
**not** frozen; its development rows (78/79, 311/316, 610/632) suggest the gain needs
both changes, but that claim rests on development evidence only.

## What this means and what is next

For the narrow planar research domain, the combination of exact curvature and a
force-tolerance stop makes a single Newton step converge at the finer timesteps when
it starts from the predictor. It does not make the catalogue page turn accurate: that
needs the accurate law in the booklet domain (bending, the spine crease, contact and
the hand). The [catalogue acceptance bar](catalogue-paper-acceptance.md) lists those
gates.

Next steps, each its own named experiment:

1. A frozen Gauss–Newton absolute-stop arm, to settle the interaction claim.
2. Bringing the accurate law to nonplanar states with panel bending, the first step
   toward the booklet domain.
3. Measuring the cost of the accurate path on target devices once they are named.
