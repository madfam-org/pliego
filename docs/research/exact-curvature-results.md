# Exact membrane curvature: fixed-24 comparison results

2026-11-10. Capture source `af870bf776023b01f6e205a420fa493cccd549c5`, run under the
[predeclared protocol](exact-curvature-capture-protocol.md). Lossless evidence:
[`evidence/exact-curvature-2026-11-10/`](evidence/exact-curvature-2026-11-10/README.md).
This is milestone 2 of [exact membrane curvature](exact-curvature-next-implementation.md).

**Bottom line.** Exact curvature removes the first-update defect it targeted: the
first-step latent residual shrinks 149× to about 10,600×. But whole-trajectory force
outcomes barely move:

- Latent failures go from 2369 to 2359 (10 gains, 0 losses).
- Public failures go from 7076 to 7078 (0 gains, 2 losses).

At Newton budget 1, the binding limit is now the PCG stopping rule, not the curvature.
**No force, time, material, booklet or device acceptance follows.**

## Force gates, same source and inputs

Both arms use the same 24 rows, initial bytes, masses, reference words, F0 and
tau=8.81400646629321e-5 microN. The only difference is the requested
`membraneCurvature`.

| Newton budget | Judged steps | GN public | Exact public | GN latent | Exact latent |
|---|---:|---:|---:|---:|---:|
| 1 | 2370 | 2370 | 2370 | 2369 | 2359 |
| 4 | 2370 | 2353 | 2354 | 0 | 0 |
| 16 | 2370 | 2353 | 2354 | 0 | 0 |
| Total | 7110 | 7076 | 7078 | 2369 | 2359 |

Sixteen trajectories pass the latent gate throughout under both operators; none
passes the public gate throughout.

- **Latent gains.** All 10 are in the first one to five steps of budget-1 rows at
  levels 4 and 8.
- **Public losses.** The two are each on the final step (79) of a level-1 row with
  previous-pose start, at budgets 4 and 16.

Public and latent changes are counted separately; a latent pass is never a public
gain.

## What changed and what did not

At budget 1 the first step is a direct factor. There the latent residual falls with
exact curvature, by a ratio that grows with level:

| Level | GN first-step residual (microN) | Exact first-step residual (microN) |
|---:|---:|---:|
| 1 | 1.80 | 0.0121 |
| 2 | 0.454 | 0.000766 |
| 4 | 0.114 | 0.000048 |
| 8 | 0.0285 | 0.0000027 |

Every later budget-1 step is a single PCG iteration preconditioned by the stale
factor. That PCG stops at relative tolerance 1e-3 of a right-hand side near 1e6
microN, and its remaining linear defect dominates the step residual under either
operator. The stale exact factor preconditions no better than the stale GN factor:

- **Previous-pose start on:** median budget-1 latent residuals roughly double, for
  example 13.8 → 26.7 microN at level 1.
- **Previous-pose start off:** medians stay similar.

Budgets 4 and 16 are unchanged; their latent residuals were already far below tau.

Exact curvature was well defined throughout this domain. All 37345 exact factor
attempts were positive definite: there were no finite nonpositive pivots, no
Gauss–Newton fallbacks and no nonfinite events. All 12425 exact PCG solves
converged. The fallback path is exercised only by the engine and capture tests, which use
compressed states with weak inertia.

## Integrity and independent checks

- **Gauss–Newton replay.** The new-source GN baseline equals the closed `3d778abc`
  capture on 8542141 leaves, excluding only `recordedAt` and `source`. The source
  differs only in the reviewed migration list; every other inventory file is
  byte-identical. Force outcomes are identical (7076 public, 2369 latent).
- **Strict repeat:** 8917193 leaves identical, excluding only `recordedAt`.
- **Observer parity:** 5736338 leaves identical, excluding only named observer fields.
- **Captures.** All three exact captures are measurement-valid. All 24 restore
  continuations pass, and every Newton record's defect is measured with the operator
  that produced it.
- **Endpoint oracle.** The 465 retained endpoint samples, across all 24 trajectories,
  give complete 80/100-digit proof equality (452447 leaves). Represented-polynomial
  errors are 4.44e-13 nJ in energy (limit 1e-12) and 5.81e-11 microN in gradient
  (limit 1e-9). Among these samples, 147 latent and 457 public residuals fail; these
  samples cannot certify all 7110 steps.
- **Selected-Newton review.** The frozen reviewer, byte-identical to the closed
  capture's, covers 104 role references (83 unique events, 59 accepted). Every
  accepted change has negative real potential change and satisfies strict real
  Armijo, under native rounded C and real M/h², with both captured and independent
  gradients. This covers selected events only, not all 49770.
- **CI.** CI on the capture source passes 16/16, and the local clean-source suite
  passes (engine 355/355, web 123/123, kernel, API, type check, package).

The archive holds 106 payloads plus its manifest: 195738756 stored bytes restore
1079753265 original bytes. Manifest SHA256:
`ecec80b6b5f827785f8965ac074a42c6a3778c527628dc38bbe3c28c2cef22a4`. The
[independent archive review](exact-curvature-archive-review.json) and
[its exact verifier source](exact-curvature-archive-review-source.json) sit outside
the archive. Raw suite logs are excluded with their hashes, because the passing
engine log contains benchmark lines that the full-history secret scan flags.

## Development rows

Before freezing, five rows were run during development (three at level 1, two at
level 2), and the protocol records what they showed. The frozen capture reproduces
those values. No protocol, gate or engine change followed them.

## What should change next

The data point to the inexact solve, not the operator, as the budget-1 limit. Two
candidate next ablations, each a separate named experiment against the same gates:

- A PCG stopping rule tied to the force tolerance rather than a relative tolerance.
- A fresh direct exact factor on every budget-1 step.

Neither changes the represented energy. The [implicit-midpoint stage](implicit-midpoint-next-implementation.md)
remains design only; its energy-work threshold must be predeclared by the owner
before any capture. Exact curvature stays opt-in; defaults and the reader are
unchanged. Research and implementation remain active.
