# First accepted Newton update: curvature dominates the selected defect

2026-11-10. **Post-hoc diagnosis**, not a new acceptance gate, experiment, replay or whole-trajectory result. Source is clean Pliego `3d778abc179988e1c1a31b43d8048aa6a08d00b1`. The current capture campaign is unchanged.

**Result:** for the first accepted update in each of the24 trajectories, the omitted geometric curvature is much larger than either the nominal GN linear defect or the realized endpoint-rounding contribution. An exact-curvature direction is therefore a credible next bounded investigation for these events; tighter inner linear solves are not the first mechanism suggested by this sample. No exact-curvature step was computed or executed, and no improved force pass is predicted.

## Selection and independent calculation

The selection was fixed before evaluation: the `first-accepted` full-record role in every trajectory, with no residual/pass filtering. All24 records are iteration1/substepsRun0, direct solve, accepted alpha1. All21 raw event vector bindings, reference binding, state identity and F0/tau deduplicate to four unique events, one for each level; all six budget/start combinations per level are retained as references. Their starting elastic linearization is identical and stored once.

Inputs are the closed `candidate.json` (279540463 bytes, SHA256 `09d94972d9f7f815d6fae4033eac6417810242a238911b542573b53ccbfadb78`) and frozen selected-Newton proof SHA256 `891197fd9e7e0147ff50adbb705408561e2f502d6af7ed28fe9503f6e57ed2aa`. The latter binds each selected role/event and independently verifies its actual decision and raw state. The frozen reviewer source and unchanged transitive Python oracle sources are bound in the output.

The unchanged independent `membrane-state-precision.py` computes exact Fraction elastic gradients and both exact/GN Hessians using `assemble(...,hessian=True)` at represented real q0=X0+u0. End gradients use actual captured q1=X0+lastTrialU. Native C is the exact real value of each captured binary64 mass-times-rounded-reciprocal coefficient. A separate real-M/h² interpretation uses exact input mass and h.

For the actual exact endpoint difference d=u1−u0, the proof verifies componentwise

\[
g_1=\underbrace{g_0+(H_{GN}+C)d}_{L}
+\underbrace{(H_{exact}-H_{GN})d}_{K}
+\underbrace{g_1-g_0-(H_{exact}+C)d}_{R}.
\]

L is further split into the true-GN residual at the captured nominal direction and `(H_GN+C)(d−d_nominal)`, the endpoint-addition rounding contribution. The actual endpoint difference, captured rounded subtraction direction, nominal packed direction and their differences are all retained. This avoids silently replacing an exact endpoint displacement by a rounded direction buffer. Captured-gradient and native observer linear-residual discrepancies are reported separately.

## Native-C results

All values below are coordinate infinity norms in microN; columns are not additive scalar identities. Original tau is `8.81400646629321e-5 microN` throughout.

| Level | End-of-this-update ∥g1∥∞ | Realized linear L | Omitted geometric K | Nonlinear remainder R | Nominal GN linear defect |
|---:|---:|---:|---:|---:|---:|
| 1 | 1.79904241 | 4.74874e-9 | 1.81118186 | .0121394444 | 1.40283e-10 |
| 2 | .454200934 | 4.62291e-8 | .454966944 | .0007660115 | 1.31035e-10 |
| 4 | .113830328 | 8.05299e-8 | .113878270 | .00004799075 | 2.36197e-10 |
| 8 | .0284748754 | 3.69110e-7 | .0284781137 | .000003001224 | 1.81180e-10 |

K is approximately20549/5162/1292/323 times tau. L is only0.000054/0.000524/0.000914/0.004188 times tau. The captured initial gradient differs from the exact native-C gradient by3.7811e-11 microN. Native-C versus real-M end gradients differ by at most5.64e-11 microN here, so that coefficient distinction does not explain the observed first-update defect.

At these four starts, the exact assembled elastic Hessian plus C is symmetric and strictly diagonally dominant with positive diagonal. Exact Gershgorin lower bounds are approximately9.433e9,3.839e10,1.542e11,6.176e11 microN/mm. This is a sufficient SPD certificate for these exact real start matrices only. It is not a numerical-factorization, all-iterate or general compression guarantee.

## What to investigate next

These data favor a separately declared exact/geometric-curvature direction comparison on the same selected law, native mass/h, state representation and objective, with domain/globalization checks and unchanged force tolerances. Existing GN fallback may still be appropriate where exact curvature is unsuitable. Compare actual nonlinear force/error and work before changing defaults or budgets.

Do **not** read R in this table as the force that an exact-Hessian Newton update would achieve: changing the matrix changes d, so its remainder must be evaluated at its own actual endpoint. No counterfactual nonlinear update was solved here.

The sample contains no later-PCG events and says nothing about their inner accuracy, later precision-limited iterations, every accepted event or entire trajectories. The six references per level are identical first events; they are not independent corroborating solves. For budgets4/16, this is an intermediate Newton endpoint, not the completed-substep endpoint. The public rounded-x force gate remains separate. Time accuracy, material calibration, booklet/contact/device acceptance and the broader research goal remain open.

Artifacts: frozen `diagnosis-plan.json`, `diagnose-first-accepted.py`, `first-accepted-defect.json`, `interpretation.json`, and terminal/log records in this directory. Full raw selected packets, reference words, exact rational matrices/vectors and exact decomposition identities are preserved; no World or trajectory replay ran.
