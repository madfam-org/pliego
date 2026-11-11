# Exact membrane curvature: fixed-24 comparison protocol

2026-11-10. Committed before the accepted capture. This is milestone 2 of
[exact membrane curvature](exact-curvature-next-implementation.md). It reuses the
[authoritative-state protocol](membrane-state-modal-protocol.md) unchanged: the same
24 rows (cells2/forward/grain0, nu12=.293, A=.004 mm, levels 1/2/4/8, Newton budgets
1/4/16, both previous-pose starts), S0=22422, N0=79, 7110 judged public steps, 49770
declared Newton iterations, F0=881400.646629321 microN and tau=8.81400646629321e-5
microN, both native force gates, and 24/168 restore controls outside the judged steps.
Nothing about the material, inertia association, solver budgets, PCG constants or
search changes. The only difference between the arms is the requested
`membraneCurvature`.

## Runs

The frozen runner and plan from the closed capture are reused byte for byte, with a
new plan whose roles are:

| Role | Run |
|---|---|
| baseline | Gauss–Newton state matrix on the new source, instrumented |
| candidate | `--membrane-curvature exact-hessian`, instrumented |
| repeat | the candidate again |
| plain | the candidate without the Newton observer |

Comparisons:

- **Gauss–Newton replay (`--state-replay`).** The new baseline against the closed
  `3d778abc` capture (`run/candidate.json`, decoded SHA256 `09d94972…fadb78`).
  Everything must match except `recordedAt` and `source`. The source may differ only
  in the reviewed files listed in `compare-membrane-state-modal-audit.mjs`; every
  other inventory file must be byte-identical.
- **Strict repeat.** Candidate against repeat, excluding only `recordedAt`.
- **Observer parity.** Plain against candidate, excluding only the named
  observer-only fields.
- **Curvature comparison (`--curvature-comparison`).** Baseline against candidate,
  with the same source and identical actual initial bytes, references, masses and
  options except `membraneCurvature`. Public and latent gate changes are counted
  separately per step and per trajectory. The candidate's curvature events (exact
  factors, finite-pivot fallbacks, every PCG stop reason) are summed. Residual
  quantiles are descriptive only.

The probe exporter, the unchanged 80/100-digit oracle and the frozen selected-Newton
reviewer (same bytes as the closed capture) run on the candidate.

## Operator binding

The Newton observer now measures each iteration's nominal and realized linear
defects with the operator that produced that direction. It reads the exact loop's
own receipt and cross-checks it against the inferred PCG/direct source. A visible
Gauss–Newton fallback is measured, and labelled, as Gauss–Newton. Its residual
against the requested exact operator is kept as a separately named diagnostic,
never as the solved-system defect. Gauss–Newton records keep their historical shape
and wording, which the replay comparison enforces.

## Development observations before freezing

These were seen while building the capture tools. They are recorded here so the
frozen result is not presented as a blind prediction.

- On level-1 rows (79 steps), budget 4 with previous-pose start off had 0 latent
  failures under both operators. Budget 1 had 79/79 latent failures under both,
  for both starts.
- On level-2 budget-1 rows, both operators had 158/158 latent failures.
- At budget 1, the first step is a direct factor. There, the latent residual falls
  from 1.80 to 0.0121 microN, which agrees with the earlier first-update diagnosis.
- Every later budget-1 step is one PCG iteration with the stale factor. PCG stops at
  relative tolerance 1e-3 of a right-hand side near 1.4e6 microN. The remaining
  linear defect (about 0.05 to 9 microN) then accounts for nearly the whole residual
  under either operator.

Nothing in the protocol, gates or engine was changed after these observations.

## Expected reading, not acceptance

- The first-step latent residual should fall wherever the first step is a direct
  exact factor.
- Budget-1 latent failure counts are not expected to fall materially while the
  PCG relative stopping rule is unchanged. That rule is a separate, unchanged
  constant in this phase.
- Budgets 4/16 should keep 0 latent failures.
- Public failures receive no prediction.

Whatever the counts, both force gates and every failure are reported. No time,
material, booklet, device or performance acceptance follows. Changing the PCG
stopping rule would be its own named ablation.
