# Actual-World membrane/inertia increment search

Research candidate, 2026-11-10. This extends the
[retained World transient failure](membrane-transient-audit.md); it does not close
that failure, the paper-physics campaign, or the separate fixed-booklet interaction gates.
The existing default search and constitutive energy/gradient/GN law remain unchanged.

## Named arithmetic and initial supported domain

`lineSearchArithmetic:'membrane-inertia-increment'` explicitly selects the new
arithmetic. Omission and explicit `total-energy` use the historical arithmetic,
including its option/snapshot/stat shapes. The new selection requires line search
and the existing explicit `orthotropic-stvk` research prerequisites. It is not
implicitly enabled in the reader or catalogue.

The first supported World domain is the measured free planar membrane experiment:
all native vertices free with positive finite coherent masses; exact Y=0 positions,
start/target buffers and velocities; zero velocity/bending damping, gravity,
ground, contact, wind and external/user forces. Active joins, drives, terms,
controls, mechanisms and kinematic sheets are unsupported. Inactive grab storage
is permitted. Normal panel stiffness may remain, but actual unwrapped hinge energy
and its force coefficient must be exactly zero, checked directly at each valid
pose. Unsupported physics throws visibly; an unsupported proposed pose restores
the search start and marks factor state dirty. No omitted energy is established
by subtracting large aggregate totals.

A collapsed/nonfinite membrane *trial* instead backtracks. An invalid starting
pose/gradient is an error. This is deliberately not an arbitrary spatial World
or bending/contact candidate. Element objectivity does not widen its runtime domain.

## Increment formula and strict acceptance

Within one search native M, h and target xt remain fixed. Let d be the actual
binary64 trial endpoint minus the saved starting endpoint. The real polynomial
identity is

    Delta Pi = g_Pi(x0) dot d + R_membrane(x0,d)
               + .5 sum_i (M_i/h^2) d_i^2.

The runtime uses the existing membrane remainder primitive, the passed *complete*
World gradient, compensated sums and the native coefficient M*(1/(h*h)). Inertia
is included on every selected-mode Newton iteration. External force already enters
xt; no second dead load is subtracted. Each halving regenerates a candidate from
the saved original realized proposal, then measures its actual rounded d again.

The computed expression is approximate: rounded base tangents/stress, gradient
accumulation, reference coefficient closure and mass/h association differ from
exact real polynomial arithmetic. Independent Decimal comparisons must report
both captured-coefficient and UV/material meanings. No exact potential-difference,
interval-error, nonlinear-equilibrium or physical-stock claim follows from this identity.

The first policy is strict Armijo: actual slope<0 and computed Delta Pi <=
1e-4*actual slope, with at most 20 halvings (21 evaluated trials). There is no
full-energy/minimum-one floor or numerical acceptance allowance. The reported
64*EPS times summed increment-term magnitudes is a heuristic diagnostic only.
Raw total-energy subtraction, stable membrane difference, both remainders,
linear terms and gradient/remainder discrepancy remain visible.

An all-zero realized d with any nonzero passed gradient stops immediately as
`precision-limited-zero-step`: restored, rejected and separately counted. A zero
d with every passed gradient component exactly zero is `stationary-noop`, never
an accepted descent update or a high-precision equilibrium certificate. A nonzero
d with zero/positive slope cannot accept. Search decisions do not alter the
literal endpoint-force tolerance.

Snapshots bind arithmetic name, version1, Armijo1e-4 and maximum20 halvings.
Missing historical metadata means total-energy. Cross-mode or changed identity
rejects before mutation. Same-mode diagnostic copies preserve signed zero.
Public-step replay is supported; mid-Newton snapshot/resumption is not claimed.

Independent development probes already exhibit near-rest computed acceptance
with positive real stored-coefficient potential change. A regression retains
this discrepancy explicitly. A strict rule on approximate increments is not a
real-descent certificate; do not reinterpret its heuristic scale as an error bound.

## Predeclared comparison

Use the same 24 trajectories as the accepted diagnostic source93f6653: cells2,
forward triangulation, grain0, A=.004mm, refinements1/2/4/8, Newton1/4/16 and both
predictor/previous-pose starts. Preserve native material, mass, reference mode,
physical horizon, World.step semantics and all existing measurement/accuracy gates.
Each endpoint retains the literal criterion

    max_coordinate |g_U + M/h^2*(x-xt)| <= max(1e-7 microN, 1e-10 F0),
    F0 = A*omega^2*max_i(nativeMass_i*norm(phi_i)).

Run a fresh source-identical total-energy baseline, selected increment candidate,
strict candidate repeat, and candidate observation ablation. Compare baseline
physics to the retained old-source capture separately from source identity.
An arithmetic comparison lists changed outcomes; it cannot be used as a strict
repeat or erase failures. Candidate decisions, actual endpoints/targets/masses,
nominal/rounded solve residuals and high-precision potential increments remain
observable. New-mode stationary no-ops must not become observer alpha1 successes.

Accepted runs require committed clean source unchanged through completion and
exclusive fresh output files outside the checkout. Store hashes/source/protocol,
preserve every failed force step, and keep whole time acceptance false until
its remaining amplitude/budget isolation, expected time trend and complete
geometry matrix gates pass. Full discrete-state agreement cannot override force
failure. This comparison does not measure browser/device cost or the 8ms target.

## Remaining work

Results and independent reviews belong beside their actual source-pinned captures.
Even an improved result here leaves absolute-coordinate force resolution,
nonlinear/time/spatial convergence, calibration, bending/buckling/crease,
contact/friction, alternative formulations/backends and fixed-booklet integration
open under the larger campaign. No optimal abstraction or exhausted research
claim is justified by a planar line-search experiment.

## Clean-source result: the force failure remains

Source [`6cd67d0`](https://github.com/madfam-org/pliego/commit/6cd67d082129b45f66ba3fc713df2a4d7b514fd6)
completes the declared 24 trajectories and 7110 poststeps for both arithmetic
modes. [Complete lossless captures and independent proofs](evidence/membrane-increment-2026-11-10/README.md)
retain all failures. Strict candidate repeat and observer/no-observer parity pass.
The fresh total-energy baseline matches the retained 93f6653 report exactly after
excluding only source metadata and recording time. A separate complete
constitutive run preserves all 108 historical spring-control results.

| Refinement | Poststeps | Total-energy force failures | Increment force failures |
|---|---:|---:|---:|
| 1 | 474 | 339 | 337 |
| 2 | 948 | 948 | 948 |
| 4 | 1896 | 1896 | 1896 |
| 8 | 3792 | 3792 | 3792 |
| All | 7110 | 6975 | 6973 |

Every trajectory still fails the unchanged all-step literal force gate. The
increment mode gains 58 previously failed steps and loses 56 previous passes:
the net two extra passes are mixed outcomes, not a consistent solve improvement.
All 49770 observed Newton events have complete records: 17903 computed accepted
updates and 31867 precision-limited zero steps. No event is silently accepted as
a nonzero update after its realized displacement becomes zero.

The maximum normalized full-state error against discrete BE remains
0.00043003962282980315 (0.043004%). Continuous error remains unaccepted, and
small discrete-state agreement does not rescue force failure. These are untimed
experiments; no new browser/device or 8 ms certificate is implied.

Two independent precision controls expose remaining arithmetic error:

* The 32 native-rest fixed-pose captures reproduce exactly. One regression at
  grain 45 accepts computed DeltaPi=-6.472749837974225e-22 nJ while the real
  captured-coefficient polynomial increases by 2.131138134777538e-22 nJ.
  Across those probes, 12 computed acceptances include five real increases in
  the stored-coefficient meaning and 12 in the UV/material meaning at native rest.
* All 104 retained full trajectory-event roles deduplicate to 85 actual events,
  including 69 computed acceptances and 16 precision-limited decisions. Of those
  **69 sampled acceptances**, one violates real Armijo in both independently
  evaluated meanings. At level 4/I4/predictor start, iteration 963, actual maximum
  coordinate change 1.7618285302889447e-18 mm, computed DeltaPi is
  -1.0109285332781935e-24 nJ versus real stored-polynomial
  +6.757180273073309e-26 nJ. The UV/material increase is 1.3848460711024363e-24 nJ.

The trajectory witness's membrane-remainder error is about 1.65e-43 nJ;
runtime-gradient slope error about 1.0785e-24 nJ dominates this sign reversal.
The internal gradient-discrepancy diagnostic and heuristic EPS scale do not
bound that independent error. Both 80/100-digit trajectory proofs agree over
all 5187 parsed leaves after excluding only the declared decimal precision field.
The 69-event acceptance sample is not a count over all 17903 accepted updates.

The separate 32-probe precision comparison retains a failed full-output equality
gate: seven `runtime.realSumOfStoredRuntimeTermsNJ` values differ by one final
binary64 ULP between 80 and 100 decimal digits. Every real objective/error/Armijo
field agrees; the discrepant sums remain explicitly retained, without another
comparison exclusion. This does not become a passing whole-proof repeat.

This version is retained as a measured, opt-in arithmetic experiment. It does
not establish certified real descent or resolve the actual nonlinear force
failure. Rounded base-gradient/coordinate resolution now needs its own source-
pinned implementation comparison; all larger campaign gates remain open.

## Primary-source follow-up

[Ogita, Rump and Oishi, Accurate Sum and Dot Product (2005)](https://www.tuhh.de/ti3/paper/rump/OgRuOi05.pdf),
sections 3–5, provides error-free sum/product transformations and more accurate
dot products using ordinary working-precision arithmetic. The paper states
overflow/underflow and rounding assumptions; its historical timings do not
measure Pliego. This is a concrete next candidate for base tangent/strain/gradient
evaluation, beyond compensating the final already-rounded gradient dot product.
Whether it fixes the retained witness or native-coordinate force resolution is
an inference to test, not a transferred guarantee.

[Gao and Baidoo's February 2026 preprint](https://arxiv.org/abs/2602.19452)
reexamines compensated-summation error behavior. Its abstract and scope have
been checked; full algorithm/proof review remains open. It is not implementation
or paper-material evidence. The failed seven-sum diagnostic repeat also calls
for an independently exact stored-input sum/rounding control before changing
the oracle; the original failing proof must remain retained.
