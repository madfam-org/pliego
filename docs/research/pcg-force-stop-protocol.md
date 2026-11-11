# Force-tolerance PCG stop: fixed-24 comparison protocol

2026-11-10. Committed before the accepted capture. This is the next ablation named in
the [exact-curvature results](exact-curvature-results.md): at Newton budget 1, the
remaining force was dominated by the inexact linear solve, not by the curvature.

Everything from the [authoritative-state protocol](membrane-state-modal-protocol.md) is
unchanged: the same 24 rows, 7110 judged steps, 49770 declared Newton iterations,
F0=881400.646629321 microN and tau=8.81400646629321e-5 microN, both native force
gates, and the 24/168 restore controls. Material, inertia association, Newton budgets,
search and the exact-curvature policy also stay as they are.

## The single change

`pcgAbsoluteTolerance` is opt-in and admitted only in the reference-displacement
domain. When it is set, PCG counts as converged only when the infinity norm of the free
linear residual is at most that value, in microN. This replaces the relative test
(`PCG_RTOL` = 1e-3 of the initial residual). Everything else about PCG is unchanged:
the iteration cap (12), the stagnation stop at iteration 3, the refactor threshold (6),
the failure hold (4), the stale-factor preconditioner and the exact-curvature
descent/finiteness checks. A solve that does not converge writes nothing and falls
through to the direct factor, exactly as before. Omitting the option keeps the
historical relative rule byte for byte.

Predeclared value: **half of tau**, `0.5 * forceTolerance` = 4.407003233146605e-5
microN per row. The other half of tau is left for the nonlinear remainder. One value,
no tuning, no retry.

## Runs

The closed runner, reviewer, archive builder and restorer are reused byte for byte.

| Role | Run |
|---|---|
| baseline | exact curvature, relative stop (new source), instrumented |
| candidate | exact curvature, `--pcg-stop half-force-tolerance`, instrumented |
| repeat | the candidate again |
| plain | the candidate without the Newton observer |

Comparisons:

- **Exact-curvature replay (`--state-replay`).** The baseline against the closed
  milestone-2 capture (`af870bf` `run/candidate.json`, decoded SHA256 `d07ab0e0…`).
  Everything must match except `recordedAt` and `source`. The source may differ only in
  the reviewed list in `compare-membrane-state-modal-audit.mjs`.
- **Strict repeat** and **observer parity**, as before.
- **Stopping comparison (`--stopping-comparison`).** Baseline against candidate, with
  the same source and curvature and identical initial bytes, references, masses and
  options except `pcgAbsoluteTolerance`. Public and latent gate changes are counted
  separately. Exact-curvature events of both arms and residual quantiles are reported.

The probe exporter, the unchanged 80/100-digit oracle and the frozen selected-Newton
reviewer run on the candidate.

## Development observations before freezing

These were seen while building the option. Budget-1 rows, previous-pose start off,
latent failures out of judged steps:

| Arm | Level 1 | Level 4 | Level 8 |
|---|---:|---:|---:|
| Exact curvature, relative stop | 79/79 | 315/316 | 626/632 |
| Exact curvature, absolute stop | 74/79 | 0/316 | 0/632 |
| Gauss–Newton, relative stop | 79/79 | 316/316 | 631/632 |
| Gauss–Newton, absolute stop | 78/79 | 311/316 | 610/632 |

- Public failures were essentially unchanged in every arm.
- With the absolute stop, PCG still converged on every step at these rows, within the
  12-iteration cap and at about 5% extra wall time.
- At level 1, the remaining latent residual (median about 5e-3 microN) is the
  nonlinear remainder of a single Newton step from the predictor.
- The Gauss–Newton absolute-stop arm is not part of the frozen capture: disk space
  allows one more pipeline. Its three rows above are development evidence only.

Nothing in the protocol, gates or engine was changed after these observations.

## Expected reading, not acceptance

- **Budget 1:** latent failures should fall sharply at levels 4 and 8 and stay high at
  level 1.
- **Budgets 4/16:** keep 0 latent failures.
- **Public failures:** no material change expected.
- **Cost:** reported as research bookkeeping only, not a performance gate.

Whatever the counts, both force gates and every failure are reported. No time,
material, booklet, device or performance acceptance follows.
