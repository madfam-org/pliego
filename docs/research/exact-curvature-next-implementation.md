# Smallest next implementation: exact membrane curvature with visible GN fallback

> Design inspected at engine source `3d778abc179988e1c1a31b43d8048aa6a08d00b1` (every inspected tracked file is
> byte-identical at the publication head). Campaign context: [paper physics campaign](paper-physics-campaign.md).
>
> **Status (2026-11-10): milestone 1 implemented, not accepted.** `membraneCurvature: 'exact-hessian'` exists in
> the reference-displacement domain only: `src/xpbd/membrane-curvature.js` (identity, receipts, snapshot checks),
> `src/xpbd/exact-newton.js` (policy loop), exact blocks/products in `orthotropic-membrane.js` and
> `accurate-membrane.js`, explicit selectors in `implicit.js`/`pcg.js`, identifiable pivots in `blockchol.js`.
> Checks: `test/exact-curvature-operators.test.js` and `test/exact-curvature-world.test.js`; Gauss–Newton and legacy
> trajectories were compared byte for byte against the previous engine.
>
> **Status (milestone 2, 2026-11-10): done.** The observer binds the effective operator, and the frozen same-24
> comparison ran at `af870bf`: [results](exact-curvature-results.md). The first-update defect falls 149×–10,600×, but
> latent failures move only 2369→2359 and public 7076→7078; at budget 1 the PCG stopping rule now dominates.

Read-only preparation at clean engine source `3d778abc`.
No source edits, World steps, oracle calls or counterfactual exact solves ran.
A durable source manifest binds the inspected implementation and tests by SHA256.

The post-hoc first-event diagnosis supplies a mechanism to test: four unique
starts, shared by the 24 trajectory references, have omitted geometric terms
much larger than their GN linear defects. Exact-real `H_membrane + C` is SPD at
those four starts. Neither later SPD nor the force achieved by a changed
direction follows from that result. The same represented energy and both force
gates remain authoritative for the next experiment.

## Recommended contract

Add the explicit requested option `membraneCurvature:'exact-hessian'`; retain
the existing explicit `'gauss-newton'` path and all old defaults/metadata bytes.
Document the new option as **exact membrane curvature**, not an exact Hessian
for arbitrary hinges/contact/constraints. Its fixed declared globalization
policy attempts exact membrane curvature and falls back visibly to GN when a
finite nonpositive Cholesky pivot prevents the exact direct solve. Do not add
eigenvalue clipping, diagonal shifts, a new material, tighter PCG tolerance,
extra Newton iterations, damping, rebasing or a new line search in this phase.

The smallest first World admission is the already accepted free, planar,
UV/DD/increment-search, reference-displacement domain. This avoids accidentally
enabling an indefinite membrane operator inside the existing barrier-contact
solver. The element operators themselves should remain explicitly callable in
both coordinate systems for derivative tests. Existing absolute/GN and state/GN
Worlds must replay unchanged; widening exact World admission to absolute/contact
is a separate decision, not necessary to test the four-start hypothesis.

Keep the state ABI identity/version, initial one-word conversion, actual public
projection, predictor, velocity, native mass and native C association unchanged.
Curvature is a separate operator/configuration identity, included in the
orthotropic configuration key/signature and exact-only diagnostics. Stats must
separate requested curvature, actual direction curvature and preconditioner
curvature. Never label a GN fallback as an exact direction.

## Concrete implementation map

| File | Small necessary change |
|---|---|
| `src/xpbd/orthotropic-membrane.js` | Add explicitly named `addExactHessianBlocks` and `addExactHessianTimes`; retain the GN methods' meanings. Bind requested curvature and the fixed fallback-policy identity in exact-only configuration/diagnostics. |
| `src/xpbd/accurate-membrane.js` | Reuse `accurateGN` and existing UV-aware `accurateGeometric` for DD exact blocks/product. Sum GN plus geometric terms before the final f64 rounding; do not round GN and geometric pieces separately then describe that as the existing validation evaluator. |
| `src/xpbd/implicit.js` | Add an explicit curvature selector/override after existing arguments, with unchanged old defaults. Assemble native C plus the selected membrane blocks. Fallback callers must request GN explicitly, rather than mutating World options or work flags. |
| `src/xpbd/pcg.js` | Apply the same selected current membrane operator in every matrix-free product. Keep all existing max-iteration, rtol, refactor and fail-hold constants. For exact mode, return an observable stop reason and reject a nonfinite/non-descent converged direction before adding it to the state. |
| `src/xpbd/newton.js` plus a small new curvature helper | Leave the GN branch's operation order intact. One original EnergySearch begin/finish per actual iteration; exact PCG failure can refactor exact, then a finite failed-SPD factor may rebuild GN once. Save the effective successful factor source and emit exact-only iteration receipts. |
| `src/linalg/blockchol.js` | Expose an identifiable finite nonpositive-pivot failure (block, pivot/component, value); preserve old error text. Nonfinite pivots/operator arithmetic are a separate visible invalid-state failure, not an indefinite-curvature success. No pivot floor or matrix regularization. |
| `src/xpbd/world.js` | Admit the named bounded option, pass it to the model, expose exact-only stats, and save effective factor curvature in exact-mode `_factorState`. Keep this already large file thin by putting policy/receipt logic in the helper. |
| `src/xpbd/increment-search.js` | Extend only the named curvature admission/identity checks. The DD increment objective, c1, 20 halvings, trial validity and accepted/stationary/precision-limited semantics stay unchanged. |
| `src/xpbd/state.js`, `reference-state.js` | Bind exact configuration through the existing signature, copy effective factor curvature and exact-only receipt counters. Preflight/rebuild the saved effective operator in detached scratch before any restore writes. Reject incompatible/corrupted operator metadata. |
| Generated `types/xpbd/*.d.ts` / package preparation | Regenerate from JSDoc; type the new literal and exact-only result metadata. Re-run the established declaration and package-consumer checks. |

For local indices, the extra term is `G_ij I3`, where the UV-aware helper already
rotates stress back to UV and uses the retained reference coefficients. Canonicalize
the entry ordering for both GN and geometric terms so diagonal 3x3 blocks are
bit-symmetric. Preserve the existing transpose-slot and fixed/free masking
contracts. Matrix-free exact products should use DD accumulators for the added
term alongside the GN contribution; do not allocate a global dense Hessian.
No energy, gradient, increment or reference-coefficient implementation needs to
change to select a different search operator.

## Fallback and replay details that cannot be skipped

1. PCG's current `pAp<=0` break is only generic nonconvergence. Record finite
   nonpositive curvature separately from nonfinite product, stagnation,
   iteration limit and zero RHS. A PCG breakdown does not by itself prove global
   indefiniteness: exact direct factorization may still succeed. A successful PCG
   solve is also not a global SPD certificate.
2. `pcgStep` currently adds its direction immediately on convergence. Exact-mode
   descent/finiteness checks must occur before that addition. Zero RHS keeps the
   existing no-addition stationary branch, including signed zeros.
3. `BlockCholesky.factor()` writes factor scratch before reporting a bad pivot.
   After exact rejection, clear and completely rebuild GN; never solve using a
   partial factor. Do not broadly catch collapsed-triangle, metadata, arithmetic
   or unrelated errors as a successful curvature fallback.
4. `_saveFactorState` currently stores only pose/coordinates and old constraint
   data. If an exact-requested World used a GN factor, restore must rebuild that
   **saved GN factor**, not retry exact under current options. Extend the factor
   packet and its detached restore preflight. The next PCG current operator may
   still be exact while its stale SPD preconditioner is GN; report both roles.
5. Only successful factors retain the old `factorCount` meaning. Separately
   expose exact attempts, finite SPD rejections, nonfinite/breakdown events,
   GN fallback factors, requested/effective last operator, descent check and
   fallback reason. Snapshot these exact-only diagnostics for deterministic
   continuation; preserve old GN snapshot/report shape.
6. A fallback changes the operator used to compute the direction. The Newton
   observer must bind the effective operator when computing nominal/realized
   linear defects. A GN-fallback residual against requested exact H may be an
   additional named diagnostic, never mislabeled as the solved-system defect.

## Meaningful checks before any accepted capture

- Exact block/product versus the existing element exact Hessian, independent
  Fraction oracle and gradient finite differences with step halving: skew UV,
  oblique grain, nonzero shear, both coordinates at the same represented state,
  fixed/free masks, nonmonotone triangle IDs and transpose slots. Include the
  native mass term in global assembly/product comparisons; keep GN distinct.
- Verify energy/gradient/increment and native reference/mass/initial-state bytes
  unchanged when only the requested curvature changes at a fixed pose.
- Use a real noncollapsed compressed single-triangle World with sufficiently
  weak inertia: its out-of-plane exact geometric Rayleigh quotient is negative
  while GN plus positive mass is SPD. Force a genuine first direct exact attempt,
  observe the actual finite pivot rejection, rebuild GN, and verify a finite
  descent direction and unchanged Armijo decision. This is an instrumentation
  control, not another accepted geometry/amplitude matrix.
- Exercise actual exact-direct and exact-PCG directions, zero-RHS stationary,
  failed-PCG-to-exact-direct, finite-SPD-failure-to-GN, and refused nonfinite
  arithmetic. Assert no proposal write before a failed solve/descent check, one
  original search begin/finish per completed iteration, and separate work counts.
- Snapshot continuation after an exact factor and after an actual GN fallback
  factor; replay the next step bit-exactly. Cross-curvature snapshots and corrupt
  effective-factor metadata must refuse before mutation, including shadow-factor
  validation. Retain public/latent projection and signed-zero guarantees.
- Run existing engine/web, declaration and package-consumer suites. In addition,
  replay the fixed GN/state24 result against the closed `3d778abc` capture under
  reviewed source migration, with all numerical fields exact. Old absolute/GN
  behavior remains a separate legacy regression.

## Same24 accepted comparison, after a new clean freeze

Freeze new operator, fallback/observer, validator, exporter and reviewer source.
Run a new-source GN/state baseline, exact-requested candidate, exact repeat and
exact plain matrix: identical 24 input rows, A=.004, levels1/2/4/8, I1/4/16,
both starts, S0=22422, N0=79, 7110 judged public steps, 49770 declared Newton
iterations, unchanged F0/tau and separately reported 24/168 restore controls.

Permit only the explicitly named curvature request/policy/observability metadata
to differ in common-input comparison. Actual reference, native initial public
and latent bytes, mass/h, material, state ABI and all solver/search budgets must
match. Repeat excludes timestamp only; plain comparison excludes only named
observer data. Preserve every direction source, negative-curvature/fallback,
no-op, precision-limited decision, actual work count and all endpoint force
tuples. Classify public and latent gains/losses separately against the new-source
GN baseline, not against an imagined exact-Newton endpoint.

Export the same predeclared endpoint roles and selected Newton roles independent
of force result. Independent80/100 proofs keep exact-real native C versus real
M/h2 separate; their complete equality omits declared precision only. Review
actual changed directions and Armijo decisions with the effective operator
bound. No SPD/force/time/material/booklet/device or optimality claim follows
from the four initial starts or from sampled successes. Any further mechanism
change requires its own named ablation.
