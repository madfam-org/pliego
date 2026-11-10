# Reference-displacement state: first bounded result

2026-11-10. Clean capture source `92d15aa1c6fcb9527e36fc85562e8dbb99fe3755`.
The published bundle contains fresh clean-source recovery captures after the
original temporary reports and reviewer records became unavailable. Both prior
full typed-endpoint hashes match; the original whole-report digest was not
retained completely, so whole-file equality to that missing report is unproven.
Original and newly generated evidence are distinguished explicitly.

This implements the [state representation proposal](membrane-state-precision.md)
and tests one retained failed substep plus an exact rigid-translation control.
It does **not** run the 24-trajectory state matrix or establish a resolved time
limit, calibrated paper, fixed-booklet interaction, device performance or optimal
abstraction. The original public force gate remains failed for the witness.

## What changed

The opt-in World stores binary64 reference displacement u/us/ut. Physical q is
the real sum X0+u; x/xs/xt are rounded projections. Elastic strain, force, GN
assembly/operator, inertia, search and velocity use authority directly. The
preconditioner's orientation and zero planar hinge terms use projected geometry.
Predictor association changes explicitly under the versioned state ABI. The
default absolute-position contract and its arithmetic remain canonical.

Initial u comes from the actual old captured x, with a zero TwoDiff low word and
byte-identical projection. Initial zero v and constructor zero xs/xt are retained;
the latter are marked invalid targets until a completed substep. No ideal modal
reinitialization, oracle trajectory, rebasing or rounded-position feedback is used.
Native material/reference words, M/h, F0, amplitude .004 mm, level 8, 16 Newton
iterations, predictor start, native coefficient association, c1 and 20 maximum
halvings stay fixed. This is the existing all-free exact-Y=0 UV/DD/increment
research domain, with no hands, damping, external forces or contact.

Boundary APIs return copied authority and separate residual observations.
Snapshots bind latent/public pairs, native coefficients and factor coordinates;
incoming factorization is checked on detached scratch before writes. Model/mode,
projection, mass/timestep, omitted-physics and malformed-array mismatches refuse.
Mid-Newton/substep boundary operations refuse, even after one search finishes.
An interrupted substep does not certify a completed solve. Existing stats fields
are explicitly labelled as projected diagnostics, with latent metrics separately
named. These restrictions are not a general shell/contact integration claim.

## Same tolerance, two physical states

Both gates use the original tau=max(1e-7 microN,1e-10 F0), here
**8.81400646629321e-5 microN**, with F0=881400.646629321 microN.
Native C is fl(M*fl(1/fl(h*h))). The independent observer also evaluates exact
represented physical states using that native C and, separately, real M/h².
Its direct rational metric/Piola formulation differs from the runtime's DD
displacement-gradient expansion. No tolerance or ULP allowance is added.

| Fixture | Native latent residual, microN | Native public residual, microN | Latent/public gates |
|---|---:|---:|---|
| Retained case80, actual first substep | 6.976770237088203e-7 | .005058552080299705 | pass / **fail** |
| Exact +2^-10 mm rigid X translation | 0 | 0 | pass / pass |

Independent represented truth gives 6.977244411476709e-7 microN latent and
.005058552096018637 microN public for the witness, with the same classifications.
The independent UV/reference-metric and UV/material meanings also retain that
classification. Native rounded C and real M/h² remain separately reported.

The new public x/xs/xt bytes equal the old failed endpoint; velocity differs
because it now derives from authoritative displacement. The old absolute World
separately replays all original x/xs/xt/v bytes and its literal residual exactly.
This is a bounded representation result: it does not prove that no equilibrium
exists on the public grid or that every latent solve will pass.

## Preserved failures and verification

The witness records **2 accepted updates and 14 precision-limited zero steps**.
The control records 16 stationary no-ops. All 32 final search endpoints and native
gradients are retained. Both accepted updates change some public position bytes,
so the predeclared **accepted-update-with-unchanged-whole-public-pose gate is
false**. The algebraic model control demonstrates a nonzero sub-public-grid
displacement; that is separate from actual accepted whole-pose evidence.

Independent exact rational review covers every one of these 32 endpoints and
only these two acceptances. Both accepted changes decrease the real latent
objective and satisfy strict real Armijo with the represented native c1, using
native C and real M/h² separately. The minimum accepted margins are
6.024650111407064e-16 nJ and 6.024650111395358e-16 nJ, respectively. Maximum
captured full-gradient error is 8.167509941046632e-11 microN for native C.
This does not certify unrecorded backtracks, future steps or a full trajectory.

The represented endpoint elastic error gates pass: maximum energy error
1.5377302978218865e-13 nJ <=1e-12, maximum gradient component error
4.691861677854737e-11 microN <=1e-9. Probe/repeat bytes match exactly. Complete
80/100-digit proofs match on 1948 leaves, excluding only the two declared
precision fields. Independent recovery review checks 68 source bindings and 9336 native
word decodings, including repeated old-input checks. Observed/plain and boundary snapshot replay match exactly; each parity
control runs its own explicitly recorded one-substep experiment.

All 108 historical affine controls match completely except the four previously
reviewed metadata fields: recordedAt and source git/runtime/helper identities.
The earlier unpublished driver was observed to exit 1 after its final comparison
paired the 108-case affine output with a 24-trajectory modal report. Its comparison-only
recovery was reported successful, but its original raw driver/terminal/proof files
are now unavailable. That run is not labelled fully completed. The fresh recovery
pipeline uses the correct immutable f145 baseline and completes all six capture
commands plus the comparison. Physics and oracle captures were explicitly rerun
for this recovery at unchanged source and inputs; they are new records.

Development review also found a restore atomicity failure: an oversized gateOff
array threw after changing time. Its exact pre-fix reference-state.js was recovered
by matching the previously recorded full SHA256 9bb01075fb6b3a1145d9fe65a2af8d0d4f22474490c7ee08185e2992f2b30e79.
A new isolated reproduction confirms the partial write and the fixed atomic refusal.
The original proof/reproducer/complete runtime-wrapper bytes remain unavailable;
51 companion modules in the new reconstruction come from source `92d15aa`, so the full
old execution context is not attested. Other reviewed domain, phase, projection
and scratch-isolation failures have focused regression coverage.
The first full development engine run failed its old five-module source
inventory after adding two modules; the comparator now names all seven additions
explicitly and continues to compare every legacy numerical field.

At capture source, all 16 CI checks pass, including the security aggregate
CodeQL check, 303 engine tests, 123 web tests, 52 source/declaration checks and
the 108-file package dry-run. No merge, deployment or package publication occurred.
The [lossless evidence and reproducible reviewers](evidence/membrane-state-2026-11-10/README.md)
distinguish fresh captures, exact recovered source, new reproducers and missing originals.
The [reproduction guide](membrane-state-reproduction.md) gives exact decode and CLI steps.
The separate [archive review](membrane-state-archive-review.json) and
[exact reviewer source](membrane-state-archive-review-source.json) verify all 42
stored files, 40 selected inputs, gzip reconstruction and decoded privacy checks;
its independent restore-to-rebuild comparison reproduces every archived byte.

The next bounded accuracy experiment is the same 24-trajectory matrix with
independent latent/public state identities and both original force gates. Full
amplitude/time/solve isolation, finite rotations, material calibration, bending,
buckling, creases, joins, friction/contact, natural left/right fixed-booklet
reading under the new model, actual touch/stylus input-to-paint and the 8 ms gate
remain open. Research and implementation are not exhausted.
