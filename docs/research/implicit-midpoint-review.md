# Time integration candidate after the state audit

2026-11-10. Post-capture analysis of the closed candidate at3d778abc; no engine,
capture, force tolerance or budget change. The new state representation does not
remove backward-Euler damping. Its maximum continuous state discrepancy is
22.305306%, while its physical linear-BE discrepancy is .043004%. Those are
different comparisons, and neither can waive a force failure.

Primary reading: Burkardt and Trenchea, [Refactorization of the midpoint rule](https://www.mathematics.pitt.edu/sites/default/files/midpoint3_technicalreport.pdf),
§1–2, especially the BEFE construction; Hairer, [2010 lecture2](https://unige.ch/~hairer/poly_geoint/week2.pdf),
§1/Theorem3 and §2/Theorem5. Only the publisher abstracts of
[Simo–Tarnow–Wong1992](https://doi.org/10.1016/0045-7825(92)90115-Z) and
[Simo–Tarnow1994](https://doi.org/10.1002/nme.1620371503) were read for nonlinear
conservation/stability limits; no full-paper review or implementation is claimed.

For autonomous y'=f(y), implicit midpoint is algebraically obtained by solving
one backward-Euler half-step ym=y0+(h/2)f(ym), then y1=2ym-y0. This equality
assumes an exact stage solve; finite tolerance, rounding and extra projections
must be measured separately. It does not permit silently relabelling the current
World's final state or its force gate.

Our reduction for Mq''=-grad U(q), with fixed native mass, is a midpoint-position
solve with target qm_pred=q0+(h/2)v0 and real coefficient4M/h²:

    grad U(qm) + (4M/h²)(qm-qm_pred) = 0,
    q1=2qm-q0,  v1=(4/h)(qm-q0)-v0.

The objective for this stage is U(qm)+.5*(qm-qm_pred)^T(4M/h²)(qm-qm_pred).
An actual implementation must declare the rounded coefficient and every
multiply/add association. Authoritative u and public rounded positions need
separate stage-state force gates at unchanged original F0/tau. Endpoint q1 is a
different state from qm; the old endpoint-BE residual has no claim to certify
this integrator. Snapshot/restore, previous state and stage/final view semantics
require a named contract. Calling step(h/2) and overwriting private arrays would
not establish that contract.

For the undamped linear selected mode, set s=omega*h. Backward Euler has factor
rho=(1+s²)^(-1/2) and phase atan(s); midpoint has unit exact-real modulus and
phase2atan(s/2). `modal-methods.py` evaluates these formulas at the existing
levels/horizons, with unit initial modal q and zero v. At level1 it predicts
22.305288% BE full-state discrepancy and39.586444% energy loss, close to the
closed nonlinear candidate's22.305306% and39.586450% diagnostics. This supports
time damping as the dominant continuous-error explanation in this window; it
does not validate the selected nonlinear law against the linear reference.
The same linear midpoint calculation predicts .336711%, .084238%, .021063%
and .005266% state discrepancy at levels1/2/4/8. These are analytical modal
estimates, **not** measured World improvements or passing time gates.

The report's B-stability proof assumes a dissipative/monotone right-hand side;
it is not a blanket result for nonconvex StVK elastodynamics. Midpoint's
symplectic/quadratic-invariant result is not exact conservation of quartic StVK
energy or a universal nonlinear stability guarantee. Our exact-work identity
for the exact-real midpoint equations with fixed M is

    E1-E0 = U(q1)-U(q0)-grad U((q0+q1)/2) dot (q1-q0).

For a quartic polynomial U this equals D³U(qm)[d,d,d]/24 and need not vanish.
Energy–momentum/discrete-gradient schemes therefore remain distinct candidates.
The cited nonlinear-elastodynamics abstracts explicitly motivate that distinction;
their guarantees are not inherited by this proposal.

Next experiment: a separately named, no-contact, all-free planar reference-state
midpoint integrator with the actual old initial physical state. Use the same
meshes/horizons/material and declared work controls; compare independent linear
midpoint and continuous truths, actual native-C stage force and high-precision
selected nonlinear states. Retain energy drift and any newly excited modes.
Prove the state/velocity recurrence and stage identity first. Then examine
nonlinear energy–momentum methods and damping/contact compatibility separately.
No paper-stock, arbitrary grab, crease/join, contact, reader or device support
is added by this analytical diagnostic.
