# Double-double membrane evaluation evidence — 2026-11-10

Clean simulation/measurement source:
[`e96c592`](https://github.com/madfam-org/pliego/commit/e96c592ea6d56c47dfbddaaaa447d2c9655b6223).
The [protocol](../../membrane-double-double.md) defines this opt-in arithmetic
chain, unchanged physical inputs and separate acceptance gates.

The candidate reduces recorded force misses from 6973 to 6956 of 7110 substeps,
but every one of the 24 trajectories still contains force failures. Gains are
mixed: 49 previously failed substeps pass and 32 previous passes fail. Same-pose
stored-polynomial gradient errors improve, while independent UV/material and
real-descent results retain important limits. This is not whole time accuracy,
measured paper, booklet/device acceptance, an 8 ms timing result or evidence
that the research mission is exhausted.

## Candidate meaning and source closure

`membraneArithmetic:'double-double'` is explicitly paired with
`lineSearchArithmetic:'membrane-inertia-increment'`. Omitted/explicit binary64
retain historical options, configurations, snapshot/stat shapes and behavior.
Stored alpha1/2, beta1/2, Q and volume are unchanged, as are reference geometry,
physical mass and timestep. No rest force, reference strain or material scaling is subtracted.

The selected path carries two-word tangents, strain, stress, gradient, energy
and GN calculations, plus TwoDiff endpoint changes in slope and remainders.
It is a declared whole evaluation-chain comparison, not causal isolation of
base-gradient accuracy alone. Native predictor, absolute binary64 positions,
velocity and inertia-gradient arithmetic remain unchanged. The coefficient is
native `M*(1/(h*h))`, not a substituted real M/h². The strict c1=1e-4 policy,
20 halvings (21 total candidate trials), zero-step categories and literal force
gate are fixed.

The same free planar 40×40 mm cells=2 / forward / grain=0 patch has nine vertices,
eight triangles and .128 g native lumped mass. Synthetic E1=5.5e9, E2=2.5e9
microN/mm², t=.1 mm, G12=.387sqrt(E1*E2), explicit nu12=.293 and areal density 80e-6
g/mm² are fixed. A=.004 mm times the independent max-node-normalized mode,
omega=107622.14139533653 rad/s, refinements 1/2/4/8, budgets 1/4/16 and both starts
give 24 trajectories/7110 actual public substeps per modal capture. There are no
pins, joins, drives, external forces, gravity/contact, damping or sleep override.

All 16 source CI checks pass, including 259 engine/123 web tests and 49 checked
sources. The package has 102 files: 49 source / 49 type files, 663907 bytes
unpacked / 206498 packed. Captures retain 49 engine-JS, 19 tool and 88 test-file fingerprints; file
counts are distinct from executed tests. Final artifact-commit checks are separate.

## Five complete captures and comparison proofs

Each `.gz` below holds the COMPLETE original JSON bytes. Reconstruct before
passing reports to comparison tools; no abbreviated report replaces a capture.

| Complete report | Purpose | Outcome |
|---|---|---|
| [baseline.json.gz](baseline.json.gz) | Source-identical binary64/increment control | 6973/7110 misses; 0/24 all-step solved |
| [candidate.json.gz](candidate.json.gz) | DD/TwoDiff candidate with solve observation | 6956/7110 misses; 0/24 all-step solved |
| [repeat.json.gz](repeat.json.gz) | Complete candidate repeat | [Strict repeat](repeat-comparison.json) exact except recordedAt |
| [control.json.gz](control.json.gz) | Candidate without solve observation | [Observer parity](observer-comparison.json) passes required physics equality |
| [constitutive-controls.json.gz](constitutive-controls.json.gz) | Existing constitutive/control regression at new source | 36 existing research-law cases pass; 108 old controls preserved |

The [named membrane comparison](arithmetic-comparison.json) holds increment
search, source/native inputs, material/constants, initial physical bytes,
references, time and numerical budgets fixed. Initial energy/gradient/metric
changes remain measured outcomes. It is not equality or acceptance of outcomes.
Every numeric residual, exact force tolerance, step sequence and row/global
force summary remains independently checked.

The [historical baseline proof](historical-baseline-comparison.json) preserves
the [6cd67d0 candidate](../membrane-increment-2026-11-10/README.md) except recordedAt
and source provenance. The [old-control comparison](constitutive-controls-comparison.json)
preserves all 108 original f145538 measurements under its reviewed migration.
These regressions do not establish DD material calibration or solved time accuracy.

## Mixed force and trajectory results

The unchanged endpoint criterion is

    max_coordinate |gradU + M/h²*(x-xt)| <= max(1e-7 microN,1e-10*F0),
    F0=A*omega²*max_i(nativeMass_i*norm(phi_i)).

Here the fixed bound is 8.81400646629321e-5 microN. No coordinate-ULP allowance,
accepted search or small trajectory error replaces that literal check.

| Measured quantity | Binary64 | Double-double |
|---|---:|---:|
| Force misses / actual substeps | 6973/7110 | 6956/7110 |
| Trajectories passing every force gate | 0/24 | 0/24 |
| Computed accepted Newton events | 17903 | 13332 |
| Precision-limited zero-step events | 31867 | 36438 |
| Total observed Newton events | 49770 | 49770 |
| Maximum discrete full-state error, fraction | .00043003962282980315 | .0004300396227587334 |
| Maximum continuous full-state error, fraction | .22305306233435135 | .22305306231139788 |

There are 49 gained passes and 32 lost passes, for a net gain of 17 rather than
uniform improvement. Reference, live measurement, observer-coverage and discrete
field gates pass; strict force and continuous-time gates fail. Both maximum
discrete state errors are about .043004%, while maximum continuous state error
is about 22.3053%. A single amplitude/geometry does not establish amplitude or
all-step budget isolation, a resolved first-order limit or full matrix acceptance.
No timing/performance certificate is measured here.

The [second independent review](pliego-dd-second-independent-evidence-review.json)
checks recorded numeric force outcomes, complete candidate repeat, historical
baseline and comparison input hashes. It does not turn a failed force trajectory
into a solved integrator or independently evaluate every unsaved search endpoint.

## Same-pose gradient evidence: 85 pairs, no timesteps

[gradient-probes.json](gradient-probes.json) evaluates 85 archived before poses
under both modes, giving 170 cases with unchanged geometry/coefficients/native
mass/h/target. [Raw repeat](gradient-probes-repeat.json) is byte-identical.
[80-digit](gradient-80.json) and [100-digit](gradient-100.json) outputs agree on
all 42502 parsed leaves except **only per-case decimalDigits**; 29240 lossless
binary64 entries and native inertia/addition associations are verified.
The [independent review](independent-gradient-review.json) retains both real meanings.

| Maximum stored-polynomial absolute error | Binary64 | Double-double |
|---|---:|---:|
| Energy,nJ | 3.9288202322e-9 | 4.0877236713e-13 |
| Elastic gradient component,microN | 2.1961009044e-6 | 4.6190130041e-11 |
| Native incremental gradient component,microN | 2.1964362009e-6 | 9.1900932729e-9 |

All 85 stored-polynomial energy/component-error pairs improve. Unchanged native
inertia error against real M/h² reaches 5.5934674694e-9 microN; better elastic
arithmetic does not replace that term or create higher-precision position storage.
At frozen pose 49, projected stored slope error improves from 1.0785003360e-24 to
1.6101272748e-29 nJ, passing the predeclared 1e-27 nJ witness gate.

UV/material energy and component errors also improve on all 85 poses, but UV
projected slopes improve on 59, tie on 16 and worsen on 10. Stored and independent
UV/material polynomials are distinct interpretations of rounded coefficients;
these outcomes must not be merged into one physical-accuracy or real-descent pass.

## Declared native-rest searches: bounded 32 cases

[Binary64 rest probes](probes-binary64.json) and [DD rest probes](probes-dd.json)
retain all declared cases. [DD 80](probes-dd-80.json)/[DD 100](probes-dd-100.json)
agree on 1986 leaves except per-case decimalDigits, with 1696 lossless values checked.
These are actual fixed-pose EnergySearch calls, not World time integration.

The [rest review](independent-rest-review.json) finds 16 computed acceptances and
16 rejections. Among the 16 DD acceptances, zero violate real stored-polynomial
Armijo, while all 16 increase independent UV/material potential and fail that
meaning's real Armijo. Actual selected endpoints can differ between arithmetic
modes. These bounded cases are not a frequency estimate over arbitrary states
or a universal real-descent guarantee.

## Retained DD trajectory sample: 86 events, not 13332

The [extractor](extract-increment-trials.py) and [extraction manifest](extraction-manifest.json)
select all retained full incrementTrial snapshots, deduplicating only identical
trajectory/iteration IDs. There are 104 roles representing 86 distinct events:
59 computed accepted and 27 precision-limited.

The [input](captured-trials-input.json), [80-digit](captured-trials-80.json) and
[100-digit](captured-trials-100.json) proofs bind 521799 exact input bytes,
5334 parsed leaves and 10148 verified binary64 entries. Full 80/100 equality
excludes **only per-case decimalDigits**. The [sample review](independent-captured-trial-review.json)
finds zero stored-polynomial real-Armijo failures among those 59 acceptances,
and two UV/material failures with real increases 4.1974630190980565e-25 nJ.

Those two event IDs describe the **same physical state**: level 2, I4/I16,
predictor start, substepsRun=78. They are not two independent physical states.
The old 69-acceptance sample differs, so these are not directly comparable rates.
No conclusion is drawn about real descent for all 13332 computed accepted events
or any unsaved endpoint. Every force/time failure remains unchanged in the reports.

## Isolated repair of historical oracle diagnostics

The versioned [repair review](diagnostic-sum-repair-comparison.json),
[32-probe v2 outputs](probes-v2-80.json)/[100](probes-v2-100.json), and
[85-capture v2 outputs](captured-v2-80.json)/[100](captured-v2-100.json)
reevaluate **old 6cd67d0 inputs**, not these DD trajectories. Their inputs are
[legacy 32 probes](../membrane-increment-2026-11-10/probes.json) and
[legacy 85 captured poses](../membrane-increment-2026-11-10/captured-trials-input.json).
The latter SHA starts 21543a3f; it is NOT this directory's new 86-case input,
whose SHA starts 4afcbb2c. Input names alone do not identify the dataset.

The original [failed full 80/100 comparison](../membrane-increment-2026-11-10/independent-evidence-review.json)
and old proofs remain immutable. Exact-rational-dot-plus-remainders/2 changes
only diagnostic sums and explicit method/source metadata: 8 old 80-digit and
9 old 100-digit values change by one ULP, including five old values that agreed but were wrong.
All original objective/error/Armijo fields remain identical. Repaired full
comparisons agree on 1986/5272 leaves with only decimalDigits excluded.

The repair review preserves its actual original dirty-worktree verifier metadata,
source hash and original physics source 6cd67d0. It is not mislabeled as another
clean e96c592 simulation or as a repair of runtime force/time failures.

## Complete byte-preserving archive

The [manifest](archive-manifest.json) binds five COMPLETE standard-gzip report
streams, 27 byte-exact ancillary files, original/stored lengths and SHA256, and
the [reconstruction producer](archive-increment-evidence.mjs) itself. This is the
unchanged previously checked five-report gzip tool (historical compatible
storage-schema/basename retained); the manifest binds the actual e96c592 source.
No captured field, trace, decision or failure is omitted or JSON-normalized.

Original report bytes 322490793 become 35451118 gzip bytes, excluding ancillary
files/tools. Every original report and ancillary file reconstructs byte-for-byte
and matches its original SHA. Producer SHA256:
`7c91a126328e2a4ef5396990445eac95a5de6d130f7f9980f90ae3c97c2e599b`.
Manifest SHA256:
`52b53a89372229bbe86c6f98b1d857167ddc039355f00e36c0a3f435ff75f71e`.
The unchanged producer's prior 20 refusal/roundtrip checks are reused; all new
payload bytes and hashes receive separate independent verification.

Output directories must themselves be nonexistent. The tool creates them
nonrecursively with 0700. Each file is created exclusively using wx and 0600;
creation is atomic, while content writes and whole-archive publication are not
atomic transactions. It checks own-producer, compressed/copied and decompressed
original hashes. With
`mktemp -d`, pass a fresh child path. Comparison/oracle commands use the
measurement source pinned above. From repository root:

```sh
node docs/research/evidence/membrane-double-double-2026-11-10/archive-increment-evidence.mjs --reconstruct docs/research/evidence/membrane-double-double-2026-11-10 /tmp/pliego-dd-reconstructed
node packages/engine/bench/compare-membrane-modal-audit.mjs --membrane-arithmetic-comparison /tmp/pliego-dd-reconstructed/baseline.json /tmp/pliego-dd-reconstructed/candidate.json --out /tmp/pliego-dd-reconstructed/membrane-recheck.json
node packages/engine/bench/compare-membrane-modal-audit.mjs /tmp/pliego-dd-reconstructed/candidate.json /tmp/pliego-dd-reconstructed/repeat.json --out /tmp/pliego-dd-reconstructed/repeat-recheck.json
node packages/engine/bench/compare-membrane-modal-audit.mjs --observer-comparison /tmp/pliego-dd-reconstructed/control.json /tmp/pliego-dd-reconstructed/candidate.json --out /tmp/pliego-dd-reconstructed/observer-recheck.json
python3 docs/research/evidence/membrane-double-double-2026-11-10/extract-increment-trials.py /tmp/pliego-dd-reconstructed/candidate.json --out-dir /tmp/pliego-dd-trials-reextracted
python3 packages/engine/bench/membrane-increment-precision.py --digits 80 < /tmp/pliego-dd-trials-reextracted/captured-trials-input.json > /tmp/pliego-dd-trials-80.json
python3 packages/engine/bench/membrane-gradient-precision.py --digits 80 < /tmp/pliego-dd-reconstructed/gradient-probes.json > /tmp/pliego-dd-gradient-80.json
```

Repeat precision commands with 100 digits and exclude only declared decimalDigits.
New source-clean simulations are separate from reconstruction/fixed-pose evaluation.
Physical stock, broader geometries/amplitudes/time isolation, folding/bending/
locking/contact/friction/joins/hands, richer coordinate representations,
alternative formulations/backends, new-law booklet reading, actual devices and 8 ms
remain part of the active mission. No optimality or exhausted-research claim follows.
