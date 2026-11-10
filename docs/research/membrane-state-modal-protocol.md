# Authoritative-state 24-trajectory protocol

2026-11-10. Predeclared before accepted captures. This extends the
[bounded state experiment](membrane-state-results.md) without changing engine
equations, material, solver budgets or force tolerances. Research remains active.
An accepted capture is a completed, source-bound record, including failed physics
gates; it does not mean an accepted physical model or stable release.

## Inputs and physical meaning

Use only `diagnostic` / `smoke`: cells2, forward triangulation, grain0, synthetic
nu12=.293, initial amplitude .004 mm, levels1/2/4/8, Newton budgets1/4/16 and both
previous-pose starts. S0=22422, N0=79; each level uses S=S0*level and
steps=N0*level. There are24 trajectories,7110 judged public substeps and49770
declared Newton iterations. No `full` matrix, dirty-source override, new amplitude
or retry with a larger budget is part of this experiment.

The small hash-pinned input fixture is extracted from the complete archived
actual-reference report. Initialization preserves the actual old native x/v,
constructor xs/xt, native lumped mass, timestep, reference coefficients and F0.
One exact initial x-X0 conversion creates authoritative u; an extra unstepped
historical context supplies no oracle targets or physical updates.
F0=881400.646629321 microN and tau=max(1e-7,1e-10*F0) remain fixed.

World consumes direct u/us/ut/v with UV-reference/DD/increment search. Actual
rounded x/xs/xt remain public views. Every completed step has separately named
native public and authoritative force gates at the same tau. A latent pass does
not replace a public failure. Native residuals retain their rounded coefficient
C=M*(1/(h*h)) and subtraction/multiply/add association.

The immutable continuous/BE exact-UV CST spectrum uses real M/h². It is a physical
linear comparator, **not** exact propagation of the selected rounded-reference
law/native coefficient. Report complete full-state and energy discrepancies,
including modal leakage and rounded initial fields; do not claim time acceptance
from visual similarity or a small modal-coordinate error.

## Capture and independent checks

Commit all producers/tests first. Use a clean checkout and one unchanged source
inventory through all runs and current-source checks. Store outputs in fresh
persistent0700 directories outside the checkout, with exclusive0600 outputs,
terminal status and logs. Retain failed reserved files; do not overwrite or
restart a process just because an observation timeout expires.

Run four separate complete matrices: current-source absolute baseline,
instrumented candidate, strict candidate repeat and uninstrumented candidate.
The baseline migration compares the entire old report after excluding only the
explicit source/recording metadata; repeat excludes recordedAt only. Observer
comparison excludes only the named observer metadata, retaining all native state,
metrics, counters, force decisions and continuation results. A state comparison
lists every public force gain/loss; authority outcomes remain separate.

Each trajectory retains every state and six native force vectors as Float64LE
bytes with SHA256, alongside readable numeric views. Validation independently
binds actual live gradients, targets, mass/reference, controlled options and
one-call/one-substep counters. Constructor and sleeping/partial targets cannot
certify solves. Callbacks get copies, and actual native boundary input drift
refuses the next solve. All initial14 word bindings are checked independently.

Keep all49770 Newton decision scalars, precision-limited/stationary/rejected
classification, and selected full records. One separately labelled final-substep
snapshot continuation per trajectory adds24 control calls and168 declared Newton
iterations; these are outside the7110 judged steps. No hidden physical replay
is charged to a judged trajectory.

Compare iteration budgets at every common step and adjacent refinements at
coarse index k / fine index2k. Record actual accumulated-clock differences;
the old17 rounded checkpoint indices are not common-time refinement evidence.

The probe exporter selects **every retained completed endpoint role**, deduplicated
only by trajectory+step, without pass/fail filtering. It lists every skipped
constructor/uncertified role. It copies original19 state/force word bindings and
the separate native reference binding; it executes no physics. Run the unchanged
independent exact-rational/80-digit and100-digit oracle and compare complete
proofs excluding declared precision fields only. It distinguishes represented
latent/public states, native-C and real-M inertia, and independent exact-UV
reference/material meanings. These samples cannot certify all7110 force truths.

Review selected full Newton records independently for actual realized-direction
descent and real Armijo, using native-C and real-M inertia separately. Keep
failures and unchanged trials. This sampled check cannot certify all49770 events
or unrecorded backtracking trials. Freeze its reviewer before accepted capture.

CLI entry points (supply fresh persistent output paths):

```sh
node packages/engine/bench/membrane-state-modal-audit.mjs --baseline-absolute --out BASELINE
node packages/engine/bench/membrane-state-modal-audit.mjs --out CANDIDATE
node packages/engine/bench/membrane-state-modal-audit.mjs --out REPEAT
node packages/engine/bench/membrane-state-modal-audit.mjs --no-solve-observer --out PLAIN
node packages/engine/bench/compare-membrane-state-modal-audit.mjs --baseline-migration OLD_ARCHIVE BASELINE --out MIGRATION
node packages/engine/bench/compare-membrane-state-modal-audit.mjs CANDIDATE REPEAT --out REPLAY
node packages/engine/bench/compare-membrane-state-modal-audit.mjs --observer-comparison PLAIN CANDIDATE --out PARITY
node packages/engine/bench/compare-membrane-state-modal-audit.mjs --state-comparison BASELINE CANDIDATE --out STATE_CHANGE
node packages/engine/bench/membrane-state-modal-probes.mjs --input CANDIDATE --out PROBES
python3 packages/engine/bench/membrane-state-precision.py --digits 80 < PROBES > TRUTH80
python3 packages/engine/bench/membrane-state-precision.py --digits 100 < PROBES > TRUTH100
```

## Acceptance limits

Retain measurement failures and both force failures; do not waive them because
the independent comparator is close. Time accuracy acceptance remains false:
selected-law integrator isolation, amplitude isolation and first-order convergence
are not completed here. Material calibration, finite rotations, bending/buckling,
creases, joins, friction/contact, new-model booklet reading, touch/stylus/device
latency and the8 ms gate remain separate requirements. No default stock/reader,
merge, deployment, publication or optimal-abstraction claim follows from this run.
