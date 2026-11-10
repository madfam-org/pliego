# Actual-reference membrane candidate

Research protocol and results, 2026-11-10. This is a named change of represented constitutive polynomial,
following the retained [double-double study](membrane-double-double.md). It does
not close the paper-physics campaign, accuracy or fixed-booklet interaction gates.

## Reason for the experiment

The old stored material-derivative coefficients need not produce an exactly
orthonormal tangent frame at the actual stored rest pose. More accurate arithmetic
exposes that residual stress; it cannot remove it while evaluating the same law.
The retained DD study still had 6,956 failed literal-force steps of 7,110 and two
sampled accepted endpoints with positive independent UV/material potential change.
Those results and their original inputs remain immutable.

[Shakeri et al., Stable numerics for finite-strain elasticity (2024), equation 3](https://arxiv.org/html/2401.13196v2)
motivates evaluating Green strain from displacement gradients to avoid near-rest
metric cancellation. Its Remark 2.1 retains an ill-conditioning caveat near large,
nearly pure rotations. Its results do not prove stability for this implementation.
[Cirak et al., sections 3.2–3.3](https://www.multires.caltech.edu/pubs/design.pdf)
uses reference/current surface metrics for shell membrane strain. The present
fixed-UV triangle law and its derivatives are independently derived here.

## Explicit law and implementation

`membraneReference:'uv-displacement'` requires the existing experimental
`membraneModel:'orthotropic-stvk'`, `membraneArithmetic:'double-double'` and
`lineSearchArithmetic:'membrane-inertia-increment'` selections. Omission or explicit
`material-coefficients` retains historical option/configuration/stat/snapshot shapes
and arithmetic. No reader default changes. The World search remains all-free,
exact-Y=0 planar, without extra force, damping, contact or authored terms. Standalone
element checks support finite 3D reference placements above the quality floor;
they do not widen that World domain.

Let K contain the native unrotated, rounded UV shape derivatives gu/gv, and let
X0 be the actual stored reference vertices in native cyclic order. Define
A=KX0 and H=K(x−X0), using difference-form derivatives with the coherent real
node-zero value −(g1+g2). The represented strain tensor is

    Euv = (AᵀH + HᵀA + HᵀH)/2
        = ((Kx)ᵀ(Kx) − (KX0)ᵀ(KX0))/2.

The first expression is evaluated; the independent Decimal oracle uses the second.
Recompute A from K and X0. A rounded cached tangent is not a new law constant.
The descriptor binds actual u/v coefficients, local X0, stored c=cos(grain) and
s=sin(grain). Exact native rest gives H=0, hence exact zero energy and force,
for every supported grain/reference placement. No sampled force is subtracted.

For engineering strain e_uv=[E00,E11,2E01], rotate the tensor before Voigt material
assembly using

    L = [[c², s², cs], [s², c², −cs], [−2cs, 2cs, c²−s²]],
    e_m = L e_uv, s_m = Q e_m, U = volume/2 * e_mᵀQe_m.

L entries are DD products of the stored c/s, retaining their low words. The
conjugate pulled stress is Lᵀs_m; the engineering strain and stress transforms
are not interchangeable. Native physical UV, material Q, volume, mesh, masses,
timestep and predictor arithmetic remain unchanged. Q acts in the fixed UV
material chart. For a non-isometric actual reference this covariant chart differs
from an orthonormal frame of the actual surface; this is not a parameterization-
invariant general shell constitutive implementation. No whitening is applied to U.

The element Jacobian is L times
[gu_i*a_r, gv_i*b_r, gu_i*b_r+gv_i*a_r], with a/b the current unrotated tangents.
The gradient and PSD search matrix are volume*Jᵀs and volume*JᵀQJ. The exact
Hessian additionally uses the pulled stress and unrotated derivatives for its
geometric term. Exact stress curvature may be negative in compression; GN is
explicitly a different approximation. Stable increments rotate the UV strain
change before constitutive multiplication and use the same pulled stress in
the nonlinear remainder. TwoDiff endpoint low words survive this chain.

Relative stretch diagnostics use the generalized current/reference metric
eigenproblem. DD cross products supply the area ratio and minimum stretch,
avoiding cancellation under strong compression; diagnostic Cholesky coordinates
do not alter the constitutive law. Report max|AᵀA−I| as `referenceMetricMismatch`.
Actual X0 triangle quality |edge1×edge2|/max(edge lengths squared) must exceed
1e-12; collapsed, poorly conditioned or out-of-range arithmetic is visibly rejected.
The existing DD multiplication domain [2^-450,2^450] and no-fallback rule remain.

Configuration binds a versioned `reference` policy, `referenceElements` and actual
reference quality floor into the snapshot signature. Pure restore/search preflight
binds the current options, work, descriptors and configuration to the original
configuration key/signature before any state/factor writes. Cross-law snapshots
and coordinated mutable descriptor/configuration drift are refused.

## Predeclared gates and evidence sequence

A development oracle check found precision-dependent spurious ideal-UV rest
gradients when a generic UV inverse was rounded to Decimal before metric
subtraction. The independent exact-UV branch now forms inverse, deformation and
metric with exact rational kinematics before Decimal material rotation/Q. This
preserves real placement strain and exact UV rest without an epsilon-zero filter.
The represented stored-coefficient target is unchanged. Original failing 80/100
development inputs/outputs are retained separately from accepted physics runs.
The original untracked prototype executable bytes were not archived; only its
hash and dirty `d9efde1` provenance survive with those original outputs. Checking
out that commit cannot recover the prototype. The repaired committed oracle and
its exact-zero regression are reproducible; do not claim full original-program
reproduction from the preserved failure outputs.

1. Numerical controls: exact stored-rest zero over multiple grains, finite 3D
   placements and deliberately non-isometric charts; exact/GN Hessian distinction;
   finite-difference step-halving; symmetry/objectivity; sparse/matrix-free masked
   operator parity; signed endpoint increments; strongly compressed/skew reference
   diagnostics; numeric-domain refusal; exact replay and atomic identity refusal.
2. Independent oracle: actual K, X0, stored c/s, Q and volume define the represented
   meaning. Derive A directly. Keep separate exact-UV/actual-reference and ideal
   exact-UV/material meanings, including their distinct reference metrics. Full
   80/100-digit outputs must agree after excluding only declared precision fields.
   Capture and verify lossless state/reference bytes and native inertia association.
3. Native-rest 32 searches: zero initial energy/gradient, no accepted nonzero step,
   no accepted real represented or ideal-UV potential increase. A rounded stationary
   no-op is recorded as such. Preserve every trial endpoint/decision.
4. Frozen 85 physical archived states: paired old DD/new reference evaluations,
   no World stepping or oracle trajectory updates. Fix actual x, X0, xt, native
   M/h and physical inputs. Predeclare maximum represented energy error ≤1e-12 nJ
   and elastic component error ≤1e-9 microN for this bounded set. Report ideal-UV
   accuracy gains/losses separately. Native inertia error is unchanged and is not
   hidden inside an elastic accuracy claim. Old-law evidence remains old-law evidence.
5. Only after the earlier controls, repeat the same 24 native modal trajectories
   at A=.004 mm, levels 1/2/4/8, Newton budgets 1/4/16 and both starting poses.
   Old DD and new reference share exact physical inputs. Preserve all force failures,
   gains/losses, timing/state gates, independent residuals and observer/repeat controls.
   The literal force gate remains max-coordinate|gU+M/h²(x−xt)| ≤
   max(1e-7 microN,1e-10*fixed initial modal force scale), without ULP allowance.
6. Before a result claim, run full required checks and all 108 historical old-law
   controls, pin source, preserve complete artifacts, and independently review
   comparisons. No accepted benchmark is produced from a dirty or changing source.

## Captured results and limits

Clean source `d739165c2f0d72382e2882715c33275c2967fff5` produced the
[complete preserved evidence](evidence/membrane-reference-2026-11-10/README.md).
The five complete reports retain every original byte through deterministic gzip.
Independent review verifies the full precision proofs, lossless inputs/reference
constants, native inertia, literal force formula and every gain/loss. These are
untimed research results; no performance or release acceptance follows.
The separate [archive review](membrane-reference-archive-review.json) and
[frozen reviewer source](membrane-reference-archive-review-source.json) verify
all 58 archive files without adding self-referential records to the archive.

All 32 rest searches have exact zero initial energy/force and reject their
nonzero proposals. The 85 paired frozen states preserve the old DD evaluation
bit-exactly and use identical physical inputs. New represented energy/component
errors are at most 4.254836328836703e-13 nJ / 5.633991074030091e-11 microN,
passing the declared 1e-12 / 1e-9 bounds. Full 80/100-digit outputs agree after
excluding only declared precision. Independent ideal-UV elastic component error
improves on 85/85 poses: maximum 7.20201497e-7 → 1.82664515e-10 microN.
Energy error improves on 81, ties on two and worsens on two. Full incremental
projected-work error improves on 62, ties on 16 and worsens on seven; its maximum
worsens from 3.42550989e-13 to 6.20336582e-13 nJ. Native inertia is unchanged.
Do not turn the component gain into an all-metric accuracy claim.

The 24 actual trajectories retain **6968/7110 force failures**, versus 6956/7110
for old DD: 16 steps gain and 28 regress. Every trajectory has failures; all
refined levels 2/4/8 still fail on every poststep. Computed accepted updates
change from 13332 to 13354, and precision-limited zero steps from 36438 to 36416,
over the same 49770 Newton observations. Maximum normalized full discrete state
error is 0.00043003962280945495, while continuous error reaches
0.22305306231936597. Measurement/discrete checks pass; literal force, continuous
agreement and whole time-accuracy acceptance remain false.

Complete strict repeat and transparent-observer comparisons pass. All 108
historical controls remain exact. The old DD baseline also reproduces all
recorded fields of the prior `e96c592` candidate after excluding only recording
time/source metadata. The final comparison initially used an incorrect Nov9
baseline path; only that comparison was rerun against the correct immutable
Nov10 file. Original captures/oracle results stayed unchanged, and completion
provenance explicitly retains the original driver failure and recovery.

All 104 retained trial-role occurrences yield 85 distinct captured events:
64 accepted and 21 precision-limited. Independent 80/100 checks agree fully.
Among only those 64 accepted endpoints, real Armijo failures and positive
potential changes are zero for all three reference meanings, with both native
stored inertia coefficients and real M/h². This does not certify all 13354
accepted updates or establish a matched acceptance rate against the earlier
study's different 59-event sample.

The capture commit's separate CodeQL finding concerned a test fixture's path
stat/read sequence. Its later descriptor-based test repair preserves the
original measurement source bytes and changes no runtime, producer or oracle.
Passing source checks does not close physical failures.

The next bounded hypothesis is a separately named
[authoritative displacement state](membrane-state-precision.md), retaining both
latent and literal public-position residual gates. Material calibration, finite
rotations, contact/booklet behavior, devices, 8 ms performance, broader amplitude/
geometry and optimal-abstraction claims remain open. This reference law stays
experimental, and the shipping reader defaults are unchanged.
