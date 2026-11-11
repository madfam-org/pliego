# Next implementation: creases on the accurate path (catalogue bar G1, step 2)

2026-11-11. Step 2 of gate G1 in the [catalogue acceptance bar](catalogue-paper-acceptance.md),
after [panel bending](bending-domain-next-implementation.md) ([capture results](bending-capture-results.md)).
A page turn bends each page around the spine crease; the accurate path must carry a crease
with its authored rest angle before contact and the hand drive can follow.

## Where the engine is

- **Accurate path today.** `referenceBending: 'panel-hinges'` (identity `latent-panel-bending`
  version 2) admits panel hinges with flat rest angles only. Any non-panel hinge or nonzero
  rest angle is refused.
- **Legacy crease mechanics.** Crease stiffness k = creaseK·L·f·grainFactor; the authored rest
  angle placed on its branch (`restBranch`); optional plasticity that drags the rest angle past
  yield; and a fold-limit projection, |theta| <= pi - 2·atan(caliper / 2h), that stops a crease
  folding through itself. The accurate path already requires plasticity off and never runs
  projections, so admitting creases as they are would drop the fold limit silently.
- **Recorded finding from the bending capture.** `setInitialReferencePose` leaves the hinge
  angle memory at the constructor's angles (flat for the authored X0). Harmless for small
  bends; a crease posed near 180 degrees would continue from the wrong branch.

## Milestone 1: engine and unit tests

Decisions taken as recommended unless overruled:

1. **A separate opt-in law value.** `referenceBending: 'panel-and-crease-hinges'`, identity
   `latent-panel-crease-bending` version 1. It keeps everything the panel identity does
   (latent geometry, step-scaled angle change, Gauss–Newton curvature, the Armijo bending
   term) and adds crease hinges. `'panel-hinges'` is unchanged byte for byte, so the bending
   capture stays replayable.
2. **The fold limit becomes a visible domain boundary.** A trial with any crease beyond its
   fold limit is invalid, so the search backtracks; a state beyond it is refused. No
   projection and no hidden contact: a solution that needs to cross the limit shows as a force
   gate failure. Contact (step 3) replaces this boundary later.
3. **Angle memory from the latent initial pose.** Under the new value, `setInitialReferencePose`
   sets each hinge's memory to the latent angle of the initial pose on its rest branch.

Admission under the new value: crease hinges with a finite authored rest angle inside their
fold limit; panel hinges still flat; scores, perforations, plasticity, drives, joins, contact,
gravity and damping still refused. The crease law (k = creaseK·L·f·grainFactor) and the
Gauss–Newton bending operator are unchanged; the exact hinge Hessian stays a later ablation.

Tests: admission and refusals; angle memory on the rest branch for folds near 180 degrees; a
free folded card perturbed off its rest angle relaxes and Armijo accepts with the latent
residual below tau; a trial past the fold limit is invalid; snapshots continue and refuse
across identities; panel-hinge and planar Worlds replay byte for byte.

## Milestone 2: capture (later)

A folded-card fixture (two panels and one crease at a 90-degree rest angle) through the same
fixed-24 pipeline. Its linear comparator is harder than the flat patch's: at a folded state
in-plane and out-of-plane motion couple at first order, so the independent reference needs
the coupled membrane and bending stiffness in 3D. That design is a decision for milestone 2.

## Implementation status

**Milestone 1, engine and unit tests (2026-11-11)**, decisions as recommended:

- `referenceBending: 'panel-and-crease-hinges'` selects identity `latent-panel-crease-bending`
  version 1. World construction, the increment-search domain and the identity admit crease
  hinges with authored rest angles strictly inside their fold limits; panel hinges stay flat;
  scores, perforations, set panel angles and plasticity stay refused.
- `setInitialReferencePose` sets the angle memory from the latent pose on each rest branch and
  refuses a pose past any fold limit, leaving the World pristine.
- Fold limit: a Newton trial past it is invalid (the search backtracks); a step that starts past
  it, for example because the predictor crossed, stops with "contact is not admitted".
- Tests (`test/reference-crease.test.js`): admission and refusals; memory on the rest branch 2e-3
  rad inside the limit; a card perturbed 5 degrees relaxes toward its 90-degree rest with Armijo
  accepts; crossing refused visibly; snapshots continue bit for bit and refuse across laws.
- Unchanged: 21 planar scenarios and the bending capture's panel rows replay with identical
  state and force hashes against main.

**Finding: the single-word displacement floor.** On a folded card the displacement reaches about
20 mm, where one binary64 ulp is 3.6e-15 mm; times the membrane stiffness that is about 1e-6
microN. Newton corrections below it round to zero steps (145 of the test's 320 iterations; 175
were accepted), and
the latent residual settles near 1.1e-6 microN instead of reaching tau = 1e-7. The flat bending
capture never met this (u about 0.004 mm). Page turns swing u to hundreds of millimetres, so the
G2 force gate needs either a two-word displacement state or an origin anchored near the current
pose. That is the next engine step before a crease capture can pass a force gate; see the
[two-word state design](two-word-state-next-implementation.md).

**Not done yet:** the state-precision fix above, the folded-card capture (milestone 2), contact
and the hand drive.
