# Next implementation: the accurate path with bending (catalogue bar G1, step 1)

2026-11-10. Design only, not implemented. Read-only inspection of engine source at
`1542265`. This is the first step of gate G1 in the
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

No implementation, capture or acceptance is claimed by this memo.
