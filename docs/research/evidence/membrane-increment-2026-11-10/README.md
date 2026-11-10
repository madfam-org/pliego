# Membrane/inertia increment-search evidence — 2026-11-10

Clean implementation/measurement source:
[`6cd67d0`](https://github.com/madfam-org/pliego/commit/6cd67d082129b45f66ba3fc713df2a4d7b514fd6).
This is an opt-in arithmetic experiment within the wider Pliego paper-physics
campaign. The [transient protocol](../../membrane-transient-audit.md) keeps
interaction, material, solve and continuous-time accuracy gates separate.

**The candidate does not close those gates.** All 24 candidate trajectories
contain strict force failures. Its net two additional passing substeps combine
58 gains with 56 losses, and independent retained-state checks find computed
acceptances that increase the real potential. The fixed-probe full 80/100-digit
proof comparison also fails on seven retained one-ULP diagnostic differences.
No failure is removed, relabeled as success or excluded to obtain a pass.

## Source and unchanged physical problem

`lineSearchArithmetic:'membrane-inertia-increment'` selects approximate binary64
residual-dot-actual-step plus membrane/inertia remainder arithmetic in the
existing EnergySearch. It requires the declared free, exactly planar research
membrane domain. Omitted or explicit total-energy retains the historical path.
The candidate uses a strict computed Armijo inequality, c1=1e-4 and at most 20
halvings, with no full-energy floor or heuristic acceptance allowance.
A zero realized step with nonzero incremental gradient is precision-limited;
a true zero-gradient/zero-step decision is separately stationary, never accepted
descent. Computed strict Armijo is not a real-potential descent certificate.

Both methods use the same native World, GN/PCG budgets, physical material,
lumped masses, initial mode, timestep and force criterion. The synthetic
40×40 mm cells2/forward/grain0 patch has nine vertices, eight triangles and
native mass .128 g. E1=5.5e9, E2=2.5e9 microN/mm², thickness .1 mm,
G12=.387sqrt(E1*E2), explicit nu12=.293 and areal density 80e-6 g/mm² are fixed.
No gravity/contact/wind, pins/joins/drives, plasticity, damping or sleep override
enters the declared experiment. This does not change stock values or reader defaults.

The dimensionless independent mode has max nodal norm 1,
omega=107622.14139533653 rad/s and A=.004 mm. Four z=omega*h levels approximately
.08/.04/.02/.01, budgets 1/4/16 and predictor/previous-pose starts give 24
trajectories and 7110 actual public substeps per modal capture, over the same
5.872208842505872e-5-second horizon. The oracle, actual rounded-initial spectral
control, live gradient/inertia validation and transparent solve observer remain
separate from the search arithmetic.

All 16 source CI checks pass, including 241 engine/123 web tests and 47 checked
sources. The 98-file package has 47 source/47 type files, 636272 bytes unpacked
and 199082 packed. File counts differ from executed tests. Captures retain their
actual source/tool/test/native-input fingerprints and clean before/after guards.

## Five complete captures and their comparisons

Each linked `.gz` contains the **complete original JSON bytes**, not a summary.
Use the reconstruction command below before passing reports to comparison tools.

| Complete report |Purpose |Result |
|---|---|---|
|[baseline.json.gz](baseline.json.gz) |Historical total-energy arithmetic |6975/7110 force misses; 0/24 all-step solved |
|[candidate.json.gz](candidate.json.gz) |Opt-in increment arithmetic with solve observation |6973/7110 force misses; 0/24 all-step solved |
|[repeat.json.gz](repeat.json.gz) |Exact same candidate protocol |[Strict repeat](repeat-comparison.json) passes except recordedAt |
|[control.json.gz](control.json.gz) |Candidate without solve-observer wrappers |[Observer parity](observer-comparison.json) preserves all required physics fields |
|[constitutive-controls.json.gz](constitutive-controls.json.gz) |Full new-law constitutive audit and retained old controls |All 36 new-law cases pass;108 old controls preserved |

The [arithmetic comparison](arithmetic-comparison.json) binds source/runtime,
physical/native inputs, initial fields, references, time/Newton/PCG budgets and
literal force rule. It permits and separately retains measured outcome differences;
it is neither outcome equality nor physics acceptance. Numeric residuals, exact
thresholds, complete step sequences and report/row force summaries are checked.

The [historical default comparison](historical-baseline-comparison.json) verifies
that the new baseline equals the [93f6653 capture](../membrane-transient-2026-11-10/README.md)
except recordedAt and source provenance. The [old-control comparison](constitutive-controls-comparison.json)
keeps every measured old-law field from f145538 under its explicitly reviewed
source migration. Passing 36 synthetic constitutive cases does not validate
transient force convergence, measured paper or booklet reading.

## Mixed force outcomes and open time accuracy

The fixed native force scale is approximately 881400.646629321 microN. The unchanged
literal endpoint rule is max coordinate abs(gradU+M/h²*(x-xt)) no greater than
max(1e-7 microN,1e-10*F0), here 8.81400646629321e-5 microN. Every failed actual
endpoint remains a failed solve, regardless of a small field error or accepted search.

| Approximate z |Baseline misses |Candidate misses |Executed substeps |
|---|---:|---:|---:|
|.08 |339 |337 |474 |
|.04 |948 |948 |948 |
|.02 |1896 |1896 |1896 |
|.01 |3792 |3792 |3792 |
|Total |6975 |6973 |7110 |

There are 79 passes in both methods and 6917 failures in both. Of previously
failing substeps, 58 now pass; 56 previously passing substeps now fail, for a net
gain of two. Changes are mixed.
Coarse-level budget 4 predictor misses change 47→39, while budget 4 previous-pose
misses change 44→49; budget 16 changes 49→47 and41→44 respectively.
Every one of the24 trajectories still fails its every-substep force gate.

The candidate's 49770 actual Newton events classify 17903 as **computed accepted**
and 31867 as precision-limited zero steps. There are no stationary no-ops in this
measured modal matrix; the separate zero-load test is not counted here.
These decision counts are not counts of high-precision-verified descent.

Independent reference/live measurement/observer-coverage and discrete field gates
pass, while continuous-time gates fail. The maximum candidate rounded-initial
full-state discrete-BE error is .043004%; continuous full-state error falls from
about 22.31% to 3.111% across these levels. Those trajectory comparisons cannot
repair strict force failures or demonstrate amplitude/solve isolation. A single
amplitude/geometry does not close the full time-accuracy matrix or establish an
isolated first-order time limit. Whole time acceptance remains false.

## Native-rest arithmetic witnesses: retained failures

The [32 probes](probes.json) and [byte-exact repeat](probes-repeat.json) call actual
EnergySearch at fixed native rest poses, with xt=before. Four grains 0/31/45/90,
node 0 X/Z directions, signs and 2^-40/2^-50 mm perturbations are declared.
They perform no World timestep or equilibrium solve.

[80-digit](probes-precision-80.json) and [100-digit](probes-precision-100.json)
evaluation independently subtract the full Green-plus-inertia potential at the
actual represented endpoints. The stored-coefficient polynomial and independent
UV/material meaning remain distinct. All exact input hashes and 192 decoded
lossless field bindings agree. There are 12 computed acceptances and 20 rejections;
all 12 acceptances satisfy the declared **computed** strict inequality.

Among those 12 accepted fixed-pose probes, five increase the real stored-coefficient
potential (maximum 9.703930675670846e-22 nJ); all 12 increase the independent
UV/material potential (maximum 2.966831637627207e-21 nJ). These bounded witnesses
show why computed negative increments and heuristic EPS scales cannot certify
real descent. They do not measure a frequency over arbitrary paper states.

The [independent evidence review](independent-evidence-review.json) retains the
**failed complete 80/100 proof equality check**: seven one-ULP differences occur
in cases 0/1/2/3/12/30/31 at runtime.realSumOfStoredRuntimeTermsNJ, among 1954
compared leaves. No extra exclusion or waiver is added. The separately named
64 truth/error/Armijo meaning objects (1088 leaves) agree exactly; that subset
agreement does not turn the failed whole-proof gate into a pass.

## Actual trajectory sample: 69 accepted events

The [extraction manifest](extraction-manifest.json) and independently reproducible
[extractor](extract-increment-trials.py) select **all retained full incrementTrial
snapshots**, deduplicating only the same trajectory/iteration. There are 104
snapshot roles representing 85 distinct events: 69 computed accepted and 16
precision-limited. No unsaved full endpoint is inferred from scalar traces.

The [complete extracted input](captured-trials-input.json), [80-digit proof](captured-trials-80.json),
[100-digit proof](captured-trials-100.json) and [comparison](captured-trials-comparison.json)
bind 492605 input bytes/SHA and 10030 decoded binary64 entries. All 5187 parsed
leaves agree after excluding **only per-case decimalDigits**. This successful
85-event comparison is separate from the failed 32-probe comparison above.

The [portable independent sample review](independent-captured-trial-review.json)
finds **one of the 69 sampled accepted events** has wrong real Armijo acceptance
and positive real potential change in both meanings: level 4, budget 4, predictor
start, iteration 963/substepsRun 240, worstNominal role, alpha 1. Computed delta is
-1.0109285332781935e-24 nJ, but the real stored delta is +6.757180273073309e-26 nJ
and independent UV/material delta is +1.3848460711024363e-24 nJ. The stored real
recorded-Armijo margin is negative 6.775409797928849e-26 nJ.

The review's counts apply **only to these 85 retained events**, not all 17903
computed acceptances. Its portability metadata records the original review hash
and changed local-path metadata; numerical outcomes and captured inputs/proofs
are preserved. The five complete captured reports are never redacted.

## Lossless storage and exact reconstruction

The [archive producer](archive-increment-evidence.mjs) stores five standard gzip
streams at level 9, with zero gzip timestamp; no JSON parse/stringify normalization
changes a captured byte. Repeated builds produce identical gzip payloads in the
recorded Node/zlib environment. Ancillary inputs, outputs, comparisons and
reproduction producers are copied byte-exact.

The [manifest](archive-manifest.json) binds the producer itself and every stored/
original length and SHA256. All five complete original reports and 17 ancillary
artifacts reconstruct with exact original bytes and hashes. Original report bytes
total 235224434; their gzip streams total 31489622. These totals exclude ancillary
files and tools. Manifest SHA256:
`abf40942a71e91f2a5b40fc3259508dcb2101dcf1af3ced456a79b5bbffa1972`.

Every mode requires a nonexistent output directory; it is created privately with
mode `0700` and no recursive parent creation. Files use atomic exclusive `wx` with
mode `0600`, refusing existing files/symlinks. When using `mktemp -d`, pass a fresh
child path. Reconstruction checks its own producer hash, all compressed/copied
bytes and all decompressed original hashes before reporting success.

From the repository root, choose fresh output paths:

```sh
node docs/research/evidence/membrane-increment-2026-11-10/archive-increment-evidence.mjs --reconstruct docs/research/evidence/membrane-increment-2026-11-10 /tmp/pliego-increment-reconstructed
node packages/engine/bench/compare-membrane-modal-audit.mjs --arithmetic-comparison /tmp/pliego-increment-reconstructed/baseline.json /tmp/pliego-increment-reconstructed/candidate.json --out /tmp/pliego-increment-reconstructed/arithmetic-recheck.json
node packages/engine/bench/compare-membrane-modal-audit.mjs /tmp/pliego-increment-reconstructed/candidate.json /tmp/pliego-increment-reconstructed/repeat.json --out /tmp/pliego-increment-reconstructed/repeat-recheck.json
node packages/engine/bench/compare-membrane-modal-audit.mjs --observer-comparison /tmp/pliego-increment-reconstructed/control.json /tmp/pliego-increment-reconstructed/candidate.json --out /tmp/pliego-increment-reconstructed/observer-recheck.json
python3 docs/research/evidence/membrane-increment-2026-11-10/extract-increment-trials.py /tmp/pliego-increment-reconstructed/candidate.json --out-dir /tmp/pliego-increment-trials-reextracted
python3 packages/engine/bench/membrane-increment-precision.py --digits 80 < /tmp/pliego-increment-trials-reextracted/captured-trials-input.json > /tmp/pliego-increment-trials-80.json
python3 packages/engine/bench/membrane-increment-precision.py --digits 100 < /tmp/pliego-increment-trials-reextracted/captured-trials-input.json > /tmp/pliego-increment-trials-100.json
```

The modal producer also reproduces clean baseline/candidate/observer-control runs
with the archived stage/matrix and explicit arithmetic selector. The native-rest
producer is membrane-increment-probes.mjs. Source-clean repeated simulation is
separate from archive reconstruction or fixed-pose oracle evaluation.

Strict force convergence, full amplitude/time/solve isolation, physical paper,
bending/locking/contact/crease/join/hand coupling, new-law booklet reading and
actual-device/8 ms acceptance remain open. This bounded arithmetic experiment
does not establish an optimal abstraction or exhaust research or implementation.
