# UV-displacement reference-law evidence — 2026-11-10

Clean capture source:
[`d739165`](https://github.com/madfam-org/pliego/commit/d739165c2f0d72382e2882715c33275c2967fff5).
The [protocol](../../membrane-uv-reference.md) defines this opt-in represented-law
comparison. Better alignment with ideal UV/material elastic gradients does not
close the unchanged force/time gates: recorded misses increase from 6956 to
6968 of 7110 substeps, and every one of the 24 trajectories still fails at least
one strict force check. There are 16 gained passes and 28 lost passes.

## What changes and what stays fixed

`membraneReference:'uv-displacement'` requires the research orthotropic StVK
model, `membraneArithmetic:'double-double'` and explicit
`lineSearchArithmetic:'membrane-inertia-increment'`. Omitted/explicit
`material-coefficients` preserves the historical runtime identity and shapes.

With unrotated stored UV derivative operator K, actual stored reference X0,
A=K X0 and H=K(x−X0), the candidate evaluates

    Euv = (AᵀH + HᵀA + HᵀH)/2,
    Em = Rᵀ Euv R, engineering strain = [Em11, Em22, 2 Em12].

It changes the represented polynomial from the historical rotated material
coefficient law. It is not only a more accurate evaluation of that old law.
No sampled old-law rest force or strain offset is used as a numerical correction.
There is no material/mass/timestep rescaling or rest-position shift. Stored Q/volume and legacy alpha/beta compatibility data,
physical UV/X0, grain, native mass, predictor/inertia, time/Newton/PCG budgets and
literal force threshold are fixed. Energy/gradient/GN/metric/increment paths
select the same new law; changed law metadata and initial evaluations remain
measured outcomes, not common-input equality requirements.

The modal fixture is the declared free planar 40×40 mm cells=2/forward/grain=0
patch: nine nodes, eight triangles, .128 g native mass, A=.004 mm, four time
levels and Newton budgets 1/4/16 with both starts. Each instrumented modal report contains
24 trajectories, 7110 actual public substeps and 49770 observed Newton events.
The control retains the same trajectories/substeps without Newton observation.
No stock calibration, hand/contact/joins/drives, physical damping or production
booklet behavior is inferred from this one amplitude/geometry.

Actual case references come from each selected simulation World, not its default
fixture World. Probe cases bind all 22 binary64 UV values per native triangle:
u[3], v[3], X0[9], c, s, Q[4], volume, in that order. Reference base64/SHA/encoding
preserves signed zeros lost in JSON numbers. Runtime x/xs/xt/v and probe inputs
also retain their lossless LE bytes and hashes.

## Complete captures and comparison controls

| Complete report | Purpose | Outcome |
|---|---|---|
| [baseline.json.gz](baseline.json.gz) | Old DD/material-coefficients, same increment search | Complete: 6956/7110 misses; 0/24 all-step solved |
| [candidate.json.gz](candidate.json.gz) | UV-displacement/DD candidate | Complete: 6968/7110 misses; 0/24 all-step solved |
| [repeat.json.gz](repeat.json.gz) | Complete candidate replay | [Whole repeat](repeat-comparison.json) passes except recordedAt |
| [control.json.gz](control.json.gz) | Candidate without transparent solve observation | [Observer parity](observer-comparison.json) passes six declared exclusions |
| [constitutive-controls.json.gz](constitutive-controls.json.gz) | Existing constitutive/control regression | 36 existing research-law cases pass; 108 old controls preserved |

The [historical baseline review](independent-historical-baseline-review.json)
compares the complete decoded baseline with the prior
[e96c592 DD candidate](../membrane-double-double-2026-11-10/README.md).
All fields are canonically equal except source and recordedAt, preserving its
failed force/time outcomes. This is an old-law regression, not UV calibration.

The [named reference comparison](reference-comparison.json) fixes DD/increment
search, source, physical UV/X0/material/native mass/time/initial bytes and all
budgets/force gates. It retains changed represented-law metadata and initial
energy/gradient/metric as outcomes. [Strict replay](repeat-comparison.json)
compares the whole report excluding only recordedAt. The
[observer comparison](observer-comparison.json) excludes recordedAt plus the
instrument selector, per-Newton completeness metadata and solve-observation
records; every other recorded field remains equal. Independent
[repeat](independent-repeat-review.json) and
[observer](independent-observer-review.json) reviews confirm those projections.

The [existing constitutive/control comparison](constitutive-controls-comparison.json)
preserves all 108 old measurements under its explicit source/helper metadata
migration. Its 36 current orthotropic cases use the existing represented law;
this regression is separate from UV-law material or non-affine validation.

## Strict force outcomes retain regressions

The fixed criterion remains

    max_coordinate |gU + native M*(1/(h*h))*(x−xt)|
        <= max(1e-7 microN, 1e-10*FIXED initial force scale).

The bound is 8.81400646629321e-5 microN. No coordinate-ULP allowance, accepted
search update or small field error replaces a failed literal force comparison.

| Recorded quantity | Old DD | UV-displacement DD |
|---|---:|---:|
| Failed actual substeps / 7110 | 6956 | 6968 |
| Trajectories passing every force gate | 0/24 | 0/24 |
| Computed accepted Newton events | 13332 | 13354 |
| Precision-limited zero-step events | 36438 | 36416 |
| Total Newton events | 49770 | 49770 |

The [independent trajectory review](independent-trajectory-outcomes-review.json)
checks all 7110 poststep scalar outcomes per law and retains every changed
residual/endpoint classification: 16 gains and 28 losses, net 12 more misses.
All changes occur at the coarsest time level; finer levels retain failures at
every poststep. It also verifies 1104 retained snapshot roles and native
force/state bindings. Intermediate vector states are not all retained; complete
scalar status/hash coverage is separate from full vector checkpoint coverage.

Source/reference/live-measurement/discrete-field/observer gates pass in the
completed baseline and candidate captures. Strict force, continuous agreement
and whole time acceptance remain false. Amplitude/budget/time isolation and a
resolved first-order limit remain open. Maximum discrete full-state error is .0004300396227587334 for old DD and
.00043003962280945495 for UV/DD (fractions); maximum continuous full-state error
is .22305306231139788 and .22305306231936597. No timing/performance claim is made.

## Fixed poses: common ideal truth and distinct represented truths

[rest.json](rest.json) and its [byte-identical repeat](rest-repeat.json) retain
all 32 actual native-rest EnergySearch calls: grains 0/31/45/90, components 0/2,
directions ±, and candidate magnitudes 2^-40/2^-50 mm. All 32 reject and restore
the original pose. Runtime and represented rest energy/elastic gradient are zero.
These are prescribed candidate searches, not World timesteps or Newton solves.

[frozen.json](frozen.json) and [repeat](frozen-repeat.json) retain all 85 archived
before poses under old DD and UV/DD, 170 fixed-pose evaluations. The old-DD side
replays historical energy plus complete LE physical state/direction/native
inertia/elastic/full-gradient bytes exactly. Both sides keep the same physical
inputs; no timestep, factorization or solve occurs.

Filtered [old-DD input](frozen-old-dd-input.json) uses the unchanged gradient
oracle; filtered [UV input](frozen-uv-input.json) uses the separate reference
oracle. There is no blanket dispatch that reinterprets old alpha/beta as UV.
The new oracle retains three separate meanings: stored UV-displacement,
independent exact UV/material with actual X0 metric, and ideal unit UV/material.

The [pretrajectory review](independent-pretrajectory-review.json) verifies
47331 full parsed 80/100 leaves with **only per-case decimalDigits** excluded:
5762 rest, 20317 UV frozen, 21252 old-DD frozen. Raw repeats, all 85 native
physical/inertia pairs, 49224 decoded state/search/reference words and 744 reference elements
are checked. The 117 UV cases retain lossless reference bytes.

Predeclared represented-law frozen gates pass: maximum energy error
4.2548363288e-13 nJ <=1e-12 and maximum elastic component error
5.6339910740e-11 microN <=1e-9. Each implementation's represented polynomial is
different; these gates certify neither equality of laws nor material behavior.

| Error against the same ideal UV/material truth | Old DD maximum | UV/DD maximum | Gains / ties / losses across 85 |
|---|---:|---:|---:|
| Elastic component, microN | 7.2020149678e-7 | 1.8266451503e-10 | 85 / 0 / 0 |
| Energy, nJ | 3.4482433393e-12 | 1.3835035570e-12 | 81 / 2 / 2 |
| Full native incremental component, microN | 7.2313771363e-7 | 9.1888044477e-9 | 85 / 0 / 0 |
| Full native projected slope, nJ | 3.4255098914e-13 | 6.2033658165e-13 | 62 / 16 / 7 |

Elastic projected slopes improve on 68, tie on 16 and worsen on one pose.
The complete review retains every energy/slope regression and comparisons
against each distinct represented law. Better elastic component agreement
coexists with unchanged native binary64 inertia and worsened full projected
slopes; field accuracy is separate from force convergence and real descent.

## Retained trajectory objective sample

[observed.json](observed.json), [80-digit](observed-80.json) and
[100-digit](observed-100.json) outputs preserve all 104 retained full
incrementTrial role occurrences, deduplicated only by geometry/trajectory+
iteration into 85 event IDs: 64 computed accepted and 21 precision-limited.

The producer re-evaluates each stored before pose in the same native law,
without stepping or solving, and requires bit-exact replay of the original full
solver gradient before exposing elastic U/g to the oracle. Source report
SHA/bytes, selection roles, native reference bytes, all state bytes and original
last-trial decisions remain bound. The
[independent sample review](independent-observed-trial-review.json) verifies
31875 decoded state/reference words, 680 reference elements and complete
80/100 equality across 22952 leaves, excluding **only per-case decimalDigits**.

Among the 64 sampled computed acceptances, there are zero real positive-potential
changes and zero recorded-Armijo failures under each of the three UV meanings,
with both real M/h² and native rounded mass-coefficient interpretations retained
separately. These are six explicitly evaluated meaning combinations, not a
universal real-descent guarantee. Event IDs may revisit the same physical state;
sample counts are not counts of independent states. The retained sample also
differs from older DD samples, so its rates are not a direct frequency ablation.

This result covers only retained sampled events, never all 13354 computed
acceptances or any unsaved endpoint. It does not close failed trajectory
force/time gates.

## Original oracle failure and bounded repair provenance

[input.json](input.json), [original 80](original-80.json),
[original 100](original-100.json), [corrected 80](corrected-80.json),
[corrected 100](corrected-100.json) and [repair manifest](repair-manifest.json)
preserve the separate development failure unchanged. The original dirty
pre-Fraction oracle produced ideal-UV rest gradients around 1e-72 at 80 digits
versus 1e-91 at 100 digits, failing full equality. The correction evaluates exact
rational UV inverse/F/Gram before Decimal material rotation/Q; it uses no
numerical zero filter, runtime physics change or gate waiver.

The original untracked dirty-d9 oracle executable bytes are NOT archived.
Its exact input, 80/100 outputs, verifier hash and dirty provenance survive;
checking out d9efde1d cannot recover that untracked program. The corrected
program is pinned and reproducible, but reproducing the original failure from
its original executable remains a provenance limitation. Original and corrected
proofs are not relabeled as clean d739165 simulation results.

## Execution recovery and source/CI provenance

The [pipeline completion record](pipeline-complete.json),
[comparison recovery](pipeline-comparison-recovery.json) and
[independent terminal review](independent-terminal-pipeline-review.json)
retain `originalDriverCompleted:false`. The initial comparison attempted the
nonexistent `paper-2026-11-09/membrane-run.json` and failed with ENOENT. The
recovered comparison uses
[the correct Nov10 baseline](../paper-2026-11-10/membrane-run.json), SHA starting
854db764. All required commands then completed; no simulation/oracle capture
was repeated and runtime/oracle/source stayed unchanged for that recovery.
The terminal reviewer verifies all 28 completion-manifest entries and the
complete 108-control canonical equality. This corrects comparison orchestration,
without erasing the failed driver attempt or changing physics results.

[measurement-source-snapshot.json](pliego-reference-d739165-measurement-source-snapshot.json) preserves
COMPLETE original d739165 producer/test bytes as base64 with path/length/SHA.
The [independent snapshot review](independent-source-snapshot-review.json)
verifies both against the frozen measurement source. Producer SHA starts
df45d57b; original test SHA starts 20bb5c51.

Source d739165 has a CodeQL file-system-race alert in the probe test's
stat(path)/later read(path) sequence, retained in
[source-codeql-annotations.json](source-codeql-annotations.json). The separately
prepared test-only repair follows capture freeze. The
[outside-only fd QA](test-only-codeql-fd-qa.json) checks same-descriptor
mode/content and a reopened O_NOFOLLOW descriptor's device/inode/content,
including replacement, unlink and symlink refusal. This isolated QA is not
aggregate CI. The descriptor-based test repair passes its six focused checks.
Current publication checks are tracked on
[PR69](https://github.com/madfam-org/pliego/pull/69); this record retains the
original capture finding and does not claim final or retroactive CI success.
Runtime/producer/oracle capture pins and bytes must remain unchanged. The
[independent publication-source review](pliego-reference-source-delta-review.json)
checks 11 source objects, 1102 inventory entries, 172 unique measured files and
all 50 runtime JS files. Runtime/producer/oracle dependency bytes remain equal
to measured Git blobs; the sole measured-source change is the named test from
20bb5c51 to 85b2c5c8. This preserves capture provenance without relabeling d739165
or retroactively changing its original CodeQL status.

## Complete-byte archive and reproducible independent reviews

The [archive manifest](archive-manifest.json) binds five COMPLETE original
reports: 367899033 raw bytes become 36178743 deterministic-gzip bytes, plus
50 byte-exact ancillary files. Every report and ancillary reconstructs exactly,
with original lengths and SHAs verified against its retained source. Manifest
SHA256: `ffa834c30c8bd458d1d684b7e00f59e3df9420e9669d7752b6373bd752ccb519`.
The unchanged producer's previously reviewed 20 refusal/roundtrip security
checks are reused; the new payload receives its own complete-byte verification. The unchanged reviewed gzip producer SHA is
7c91a126328e2a4ef5396990445eac95a5de6d130f7f9980f90ae3c97c2e599b.
Its historical basename/schema are storage compatibility details; the manifest
must bind the actual d739165 capture pin. All five complete original reports
and all ancillary captures/failures reconstruct without JSON normalization.

Fresh output directories must not exist. The producer creates them with 0700;
files are exclusively created with wx0600. File creation is atomic, while
content writes and whole-archive publication are not atomic transactions.

From repository root, reconstruct the complete captures:

```sh
node docs/research/evidence/membrane-reference-2026-11-10/archive-increment-evidence.mjs --reconstruct docs/research/evidence/membrane-reference-2026-11-10 /tmp/pliego-reference-reconstructed
```

[Pretrajectory script](review-pretrajectory-source.json),
[baseline script](review-baseline-source.json) and
[trajectory script](review-trajectories-source.json),
[replay/observer script](review-replays-source.json),
[sampled-trial script](review-observed-source.json),
[terminal script](review-pipeline-v2-source.json) and
[source-snapshot script](review-source-snapshot-from-git-source.json) and
[publication-delta script](review-source-delta-source.json) are JSON wrappers holding
complete Python bytes. The emitted-proof scripts retain their exact source.
The source-snapshot checker is a separately labeled verifier; the old snapshot
proof did not claim an emitter SHA. Decode and hash-check scripts before running:

```sh
python3 - <<'PY'
import base64, hashlib, json, os
from pathlib import Path
source = Path('docs/research/evidence/membrane-reference-2026-11-10')
out = Path('/tmp/pliego-reference-review-scripts')
out.mkdir(mode=0o700)
for wrapper in sorted(source.glob('review-*-source.json')):
    item = json.loads(wrapper.read_bytes())
    assert item['schema'] == 'pliego-independent-reviewer-source/1'
    assert item['encoding'] == 'base64'
    assert Path(item['filename']).name == item['filename'] and item['filename'].endswith('.py')
    raw = base64.b64decode(item['source'], validate=True)
    assert len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256']
    fd = os.open(out / item['filename'], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
PY
```

Use a clean Git checkout of measured d739165 as the source root for reviewer
source-hash checks, including its original test bytes. Current source after the
test-only repair intentionally has a different test fingerprint. The terminal
reviewer checks that the source checkout itself is clean at the capture pin.
With that checkout at `/tmp/pliego-reference-source` and fresh output paths:

```sh
python3 /tmp/pliego-reference-review-scripts/review-pretrajectory.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed
python3 /tmp/pliego-reference-review-scripts/review-baseline.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-baseline-review.json
python3 /tmp/pliego-reference-review-scripts/review-trajectories.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-trajectories-review.json
python3 /tmp/pliego-reference-review-scripts/review-replays.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-repeat-review.json repeat
python3 /tmp/pliego-reference-review-scripts/review-replays.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-observer-review.json observer
python3 /tmp/pliego-reference-review-scripts/review-observed.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-observed-review.json
python3 /tmp/pliego-reference-review-scripts/review-pipeline-v2.py /tmp/pliego-reference-source /tmp/pliego-reference-reconstructed /tmp/pliego-reference-terminal-review.json
```

The new snapshot verifier reads immutable d739165 Git blobs, so it can use the
publication repository without trusting its modified working test. It preserves
the historical matchesFrozenCheckout output field only for byte compatibility
with the original proof; it does not claim the repaired working tree is unchanged:

```sh
python3 /tmp/pliego-reference-review-scripts/review-source-snapshot-from-git.py . /tmp/pliego-reference-reconstructed/pliego-reference-d739165-measurement-source-snapshot.json /tmp/pliego-reference-snapshot-review.json /tmp/pliego-reference-reconstructed/independent-source-snapshot-review.json
```

The publication-delta reviewer additionally checks current publication bytes
against those captures and immutable Git blobs (use the corresponding publication
version when repeating this check):

```sh
python3 /tmp/pliego-reference-review-scripts/pliego-reference-source-delta-review.py --repository . --captures /tmp/pliego-reference-reconstructed --source-snapshot /tmp/pliego-reference-reconstructed/pliego-reference-d739165-measurement-source-snapshot.json --output /tmp/pliego-reference-source-delta-recheck.json
```

The provisional review-pipeline.py emitted no proof and is not substituted for the
reviewed v2 producer. No physics/oracle rerun is needed to review retained bytes,
classifications and provenance.

Measured stock, broader amplitude/time/solver isolation, folding/bending/locking,
contact/friction/joins/hands, richer state representations, new-law fixed-booklet
reading, public catalogue stability, actual devices and the 8 ms physics gate
remain open. This bounded result does not establish an optimal abstraction or
exhaust the research/implementation mission.
