# Next implementation: the accurate path with bending (catalogue bar G1, step 1)

2026-11-10. Designed from a read-only inspection of engine source at `1542265`;
milestone 1 (engine and unit tests) and milestone 1b (step-scaled angle change) are now
implemented, see [Implementation status](#implementation-status). This is the first step of gate G1 in the
[catalogue acceptance bar](catalogue-paper-acceptance.md): run the accurate membrane path
on paper that bends out of plane. The spine crease, contact and the hand drive are later
steps, each with its own frozen audit.

## Why this step

The accurate path (UV-reference membrane, displacement state, two-word arithmetic, exact
curvature, force-tolerance PCG stop) is admitted only for a flat, free sheet. A page turn
is mostly bending. The current domain blocks it in three places:

- **Flat states only.** `reference-state.js` (initial conversion, state and snapshot
  checks) and `increment-search.js` (`validateIncrementDomain` and the trial loop)
  refuse any nonzero Y coordinate. The capture validators assume the same.
- **No bending energy.** `validateIncrementDomain` refuses any panel hinge with nonzero
  energy or force. The increment search's Armijo change sums only the membrane and
  inertia terms, so admitting bending without adding its term would silently omit work.
- **Bending is evaluated on rounded positions.** `implicit.js` and `pcg.js` compute
  dihedral angles on `projectReference(w, u)`, the binary64 rounding of X0+u. That was
  harmless while bending energy was exactly zero.

## Minimal contract

- **Admission.** Keep everything named today and lift two restrictions together, as one
  opt-in identity (`stateCoordinates:'reference-displacement'` with a new named bending
  version), so the historical flat domain replays unchanged:
  - Admit nonzero Y in states, targets, velocities and snapshots.
  - Admit nonzero panel-hinge energy with a flat rest angle (`restTheta = 0`).
  - Keep refusing creases, scores, perforations, drives, joins, contact, gravity,
    damping and bend damping.
- **Latent bending geometry.** Evaluate each hinge on the latent sum X0+u. Form the edge
  and wing difference vectors exactly (TwoSum of origin and displacement differences),
  round each once, then run the existing dihedral formula. This removes the projection
  rounding from the authoritative state. The public residual keeps its rounded-position
  meaning and is reported separately, as today.
- **Energy change in the search.** Add the hinge term to the Armijo change as
  `k·(θ0−θ̄)·Δθ + ½·k·Δθ²`. Compute Δθ from the two poses with a cancellation-safe
  angle difference, `atan2(sin(θ1−θ0), cos(θ1−θ0))` built from normalized normal pairs,
  not by subtracting two rounded angles. Report its magnitude in the existing
  precision diagnostics. This is not an interval bound.
- **Curvature.** Phase 1 keeps the Gauss–Newton bending operator `k·∇θ∇θᵀ`, which the
  assembly and PCG already apply, labelled "exact membrane, Gauss–Newton bending". The
  exact bending Hessian (`k·(θ−θ̄)·∇²θ`, closed forms in Tamstorf & Grinspun 2013) is a
  separate named ablation afterwards.
- **No new law.** The panel stiffness stays `k = C_B·D(φ)·L²/A`. Adopting a different
  discrete-shell law would be its own decision, not part of this step.

## Engine edits, in dependency order

1. **`reference-state.js`**: a named bending version of the state identity. Planar
   checks become conditional on it, and snapshots bind it.
2. **A small `reference-bending.js`** (dependency leaf): latent-sum hinge geometry,
   bending energy and gradient, and the stable Δθ. Called by `implicit.js` (gradient,
   assembly), `pcg.js` (products) and `energy-search.js` (objective) only in the new
   domain. The absolute-position paths keep their current code.
3. **`increment-search.js`**: admission of the new identity; the hinge term in the trial
   change and its diagnostics. The nonplanar-trial refusal becomes conditional.
4. **`world.js`**: thin admission only, staying under the file-size gate.
5. **Bench and capture tools**: drop the Y=0 assumptions behind the identity; add a
   transverse-mode fixture; give the oracle a bending term.

## Independent truth and gates

- **Force.** Extend the 80/100-digit precision oracle
  (`bench/membrane-state-precision.py`) with the hinge energy and its gradient at
  captured states, using high-precision atan2. Both native force gates keep tau fixed.
- **Fixture.** The same cells2 patch, given a small transverse initial amplitude in the
  lowest discrete bending mode, with the same levels 1/2/4/8, budgets 1/4/16 and both
  starts.
- **Linear comparator.** A generalized eigenproblem for the discrete bending stiffness
  and native mass at the flat state, solved independently. This is the bending
  counterpart of the membrane CST comparator. It checks the integrator against the
  represented discrete law, not against continuous plate theory.
- **Physical meaning.** Comparing to an orthotropic Kirchhoff plate needs mesh
  refinement and calibrated D values (bar gates G3/G4); it is out of scope here.
- **Controls.** Exact replay of the flat domain under the old identity, strict repeat,
  observer parity, restore continuations, and selected-Newton real-Armijo review now
  including the bending term.

## Tests before any accepted capture

- Latent-sum dihedral, gradient and Gauss–Newton blocks against finite differences and
  an exact-rational/high-precision oracle, including near-flat and moderate angles.
- The stable Δθ against high-precision differences, at tiny and moderate angle changes.
- Flat-domain Worlds replay byte for byte; the new identity refuses creases, drives,
  contact and nonzero rest angles before any write.
- Snapshot continuation, and cross-identity refusal.

## Decisions to confirm

1. Keep Pliego's discrete panel law for this step (recommended), or adopt a
   discrete-shell law first.
2. The transverse amplitude for the fixture (recommended: matching the membrane study's
   small-strain regime, so the linear comparator applies).

## Implementation status

**Milestone 1, engine and unit tests (2026-11-10).** Decisions taken as recommended: Pliego's
discrete panel law is kept, and the fixture will use a small transverse amplitude.

- **Option and identity.** `referenceBending: 'panel-hinges'`, admitted only with
  `stateCoordinates: 'reference-displacement'`. The World's state identity becomes the
  planar identity plus `bending: REFERENCE_BENDING_IDENTITY` (`latent-panel-bending`
  version 1). Snapshots carry a copy; planar and bending snapshots refuse each other.
  Omitting the option keeps the planar identity, checks and trajectories byte for byte.
- **Admission.** Nonzero Y is admitted in states, targets, velocities, snapshots and
  saved factors. Panel hinges may carry energy with a flat rest angle. Creases, drives,
  nonzero rest angles, bending damping, contact and the other refusals are unchanged.
- **Latent geometry** (`reference-bending.js`). The gradient, the assembly, the search
  objective and the authoritative residuals evaluate hinges on X0+u, as designed. PCG
  products reuse the hinge gradients cached by that gradient. `_hingeUpdate`, `stats()`
  and the public residual keep using the rounded public pose.
- **Search term.** The slope already contains the bending gradient. The trial change adds
  the bending remainder `k(θ0−θ̄)(Δθ − ∇θ·d) + ½kΔθ²`, and the trial record reports the
  bending difference, linear part, remainder and magnitude. An invalid hinge makes the
  trial invalid, so it backtracks.
- **Deviation from this design (resolved in milestone 1b).** Milestone 1 formed Δθ as a
  wrapped binary64 difference of the two latent angles.
- **Tests** (`test/reference-bending.test.js`):
  - The latent angle and gradient equal the public dihedral bit for bit on exact sums.
    On rounded sums they equal an integer-arithmetic oracle of the once-rounded
    differences; the public angle differs on 4 of 8 hinges.
  - Central differences converge as ε², and the engine gradient's hinge part matches.
  - The search's bending change matches the energy difference.
  - Nonplanar stepping: the bump relaxes, Armijo accepts, and the latent residual
    (2.3e-8 microN) is below tau, while omitting bending would leave 2.9e3 microN.
  - Rest-angle, drive and bending-damping refusals happen before any write.
  - Snapshots continue bit for bit, and cross-identity restores are refused.

**Milestone 1b, step-scaled angle change (2026-11-11).** The identity is now
`latent-panel-bending` version 2 (`angleChange: 'two-word-step-expansion-atan2'`).

- **Why the design's form was not enough.** One atan2 of the two poses' angle pairs
  (normal pairs) still rounds each pose's geometry on its own, which leaves an absolute
  floor near 1e-31 rad. Newton steps near convergence change angles by 1e-40 or less.
- **Form used.** With E = p1−p0, U = w0−p0, W = w1−p0, the dihedral's normals give
  N0·N1 = (E·W)(U·E) − (E·E)(U·W) =: D and E·(N1×N0) = |E|²·det[W,E,U], so θ = atan2(|E|·T, D)
  with T = det[W,E,U]. The pose is formed exactly and rounded once to two words; the step
  (after − before) is formed exactly. ΔD, ΔT and Δ|E| are expanded so every term carries
  a step factor, and Δθ is the angle between the two (D, |E|·T) pairs. Two-word
  arithmetic throughout; outside the two-word product domain it throws, like the planar
  two-word path.
- **Accuracy.** Against an exact oracle (integer geometry, the dihedral's original
  normal-vector formula, fixed-point arctangent to 2^-320): within 0.98 ulp relative for
  |Δθ| from 1.5e-45 to 0.19 rad, including one-ulp steps and 1e-40 steps on zero
  coordinates. Subtracting two rounded angles was off by 4× at the smallest steps and by
  1e-2 at one-ulp steps.
- **Limit that stays.** The remainder `k(θ0−θ̄)(Δθ − ∇θ·d)` is still computed in binary64
  from an accurate Δθ, so its error is about eps × the bending first-order term. That is
  the same class as the slope, whose gradient is rounded to binary64. Trials closer than
  that are precision-limited for the planar terms too; the search's `heuristicScale`
  flags them.
- **Effect on the search** (the 0.25 mm bump, 8 substeps, 16 Newton iterations each).
  Main accepted 109 steps, 44 of them at α ≤ 2^-10 after 855 backtracks, and its latent
  residual sat between 2.6e-6 and 3.3e-5 on substeps 2–6. With this form, 59 of 74
  accepts are full steps, none tiny, after 50 backtracks, and the residual stays at or
  below 2.1e-8 on every substep. The final lift agrees to 1.7e-13 mm. An exact-remainder
  audit of every accepted trial in both runs found no accept that misses Armijo by more
  than the reported `heuristicScale`.

**Milestone 2, capture tooling (2026-11-11).** The fixed-24 bending capture is specified in
the [bending capture protocol](bending-capture-protocol.md):

- A transverse-mode fixture: the lowest discrete bending mode of the cells2 patch from an
  independent stdlib reference (`bench/bending-modal-reference.py`), which rebuilds the
  flat-state stiffness exactly from plate kinematics and the documented law.
- A bending runtime, validator, linear comparator, 24-row runner and comparison tool
  (`bench/bending-state-*.mjs`, `bench/compare-bending-state-audit.mjs`). The planar tools
  are unchanged except the Newton observer's identity check.
- An oracle bending term: `bench/bending-state-precision.py` reuses the planar membrane
  oracle and adds bending energy and gradient at 80/100 digits from exact latent geometry.

**Not done yet:**

- The frozen capture itself, its independent Newton review, results and archive.
- No force, time, material, booklet or device acceptance follows from any of this.
- Known engine behaviours recorded by the tooling, not changed: `setInitialReferencePose`
  leaves the hinge angle memory at the constructor's flat angles, and the memory that
  continues latent angles is updated from the public pose. Both are harmless at this
  amplitude; a large initial fold would need the first fixed before relying on it.
