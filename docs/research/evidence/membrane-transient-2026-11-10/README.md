# Actual-World membrane transient evidence — 2026-11-10

Clean implementation/measurement source:
[`93f6653`](https://github.com/madfam-org/pliego/commit/93f6653136bc37c4feff48c86f88259000c7dde8).
The [method](../../membrane-transient-audit.md) defines actual World stepping,
independent linear modal truths, observation/force gates and remaining acceptance.

All three clean captures, strict repeat, observer ablation and 80/100-digit endpoint
checks complete. The lossless archive reconstructs each complete original report
byte-for-byte; official comparisons rerun on reconstructed bytes pass.
All 16 source CI checks pass, including 214 engine and 123 web tests. The final
evidence-documentation commit receives its own checks; these captures retain the source pin above.

This is an accepted-source **diagnostic capture**, not accepted time accuracy.
All 24 trajectories contain strict endpoint-force failures. Small differences
from exact discrete backward Euler do not repair those failures or establish a
continuous-time limit. No physical-stock, new-law booklet, device or 8 ms pass
is claimed. Runtime energy/gradient/search, stocks and reader defaults are unchanged.

## Fixed protocol and native physical inputs

The smoke case is an authored 40×40 mm free planar rectangle with cells2,
forward diagonals and grain0: nine vertices, eight triangles, no pins/joins/drives.
Synthetic E1=5.5e9, E2=2.5e9 microN/mm², t=.1 mm,
G12=.387sqrt(E1*E2), explicit nu12=.293 and native areal density 80e-6 g/mm²
remain unchanged. No material/mass rescaling slows the physical frequency.

Areal density times reference triangle area, lumped one third per node, gives
native total mass .128 g. Native mass—not an oracle replacement—is used for
force thresholds and actual energy/momentum reductions. The independent mass
check uses tolerance 1e-12 and has zero maximum scaled difference in this case.
The independently selected first isolated positive mode has
omega=107622.14139533653 rad/s, relative adjacent gap .20387026412215772,
maximum nodal norm1 and modal mass .05850209502350405 g. Exactly three rigid
in-plane modes remain free; no pin or artificial spring removes them.

Each trajectory initializes actual x once with A=.004 mm times that mode,
sets velocity zero and preserves native rest UV/X0/material data. Gravity,
contact, ground, plasticity, scalar damping, bend damping, actual air/user force
and wind are zero. Exact planarity and zero omitted energy/gradient are measured,
not inferred. Sleep is never overridden; a sleeping case would be censored.

The timestep uses h=1/(60*S), S0=22422, N0=79, and refinement factors 1/2/4/8.
The common physical horizon is 5.872208842505872e-5 s, just over one modal period.
One `World.step(World.dt)` executes per observation. Newton budgets 1/4/16 and
predictor/previous-pose starts yield 24 trajectories, 7110 substeps and 7134 states
including 24 initial observations. Initial raw xs/xt are not called a prediction.

Reports record Node v20.19.5, Python 3.13.7, x64/darwin, little-endian.
Source guards retain 46 engine JS, 15 bench/tool and 78 JS test-file fingerprints,
plus fixture-builder, input/output and native geometry/material/options hashes.
File counts are distinct from executed tests. Targeted 21 new JS checks, eight
modal-reference tests and six precision-helper tests pass. Source CI also verifies 46
typechecked sources and the 96-file package (46 source/46 type files), 619304 bytes
unpacked/193951 packed.
Before/after source and clean-state guards reject a changed implementation.

## Captures and equality proofs

| Capture / proof | Scope | Status |
|---|---|---|
| [Instrumented diagnostic](diagnostic.json) |All 24 trajectories, live endpoint validation and actual Newton observation |Inspected, source clean |
| [Instrumented repeat delta](diagnostic-repeat.delta.json) |Same complete declared protocol |Complete |
| [Strict repeat proof](repeat-comparison.json) |Whole report equality except recordedAt |PASS |
| [Uninstrumented control delta](diagnostic-uninstrumented.delta.json) |Same source and physics without solve wrappers |Inspected, source clean |
| [Observer comparison](observer-comparison.json) |Exact physics/state/force/metrics parity |PASS |

Strict replay excludes only recordedAt. The named observer comparison may also
exclude the instrumentation selector, its records and observation-completeness
metadata; all source/runtime/material/mesh/reference, actual fields, raw hashes,
force failures, physical counters and other gates must remain exactly equal.
These are reproducibility/noninvasive-observation proofs, not physics acceptance.

## Lossless archival integrity

The [manifest](archive-manifest.json) and [reconstruction tool](archive-modal-evidence.mjs)
store the complete first capture plus two declared-path deltas. The original three
reports total 100965983 bytes; their stored representations total 40709224 bytes.
Those totals describe report representations, excluding ancillary proofs/tools.
Actual reconstruction byte equality and all original SHA256 checks pass.
No field, force status, diagnostic, trace or failed gate is dropped.

The repeat delta changes only recordedAt. The uninstrumented delta changes only
the already-reviewed timestamp/observer selector, records and completeness metadata.
The tool restricts the replacement paths, verifies stored/base/target hashes and
lengths, and refuses existing output files. These are complete report reconstructions,
not abbreviated reports or a new simulation. The official comparison proofs above
were rerun against the reconstructed original byte streams.

| Stored artifact |Stored bytes |SHA256 |
|---|---:|---|
|[diagnostic.json](diagnostic.json) |40684804 |`db235d86c022470fe58f4bd44b6495ff07b892ab1b35c784fc7553c1982110d8` |
|[diagnostic-repeat.delta.json](diagnostic-repeat.delta.json) |641 |`54e5b46ea2134334c9759e2f63d5ffe98369c7edbc81f6875a8ac93054f6e36c` |
|[diagnostic-uninstrumented.delta.json](diagnostic-uninstrumented.delta.json) |23779 |`0d455aebbddac5e485a67ff9df0a719a1ebaa303a728f8fdb69c55cad4be08e9` |

The manifest also names the reconstructed targets and their original hashes:
`diagnostic-repeat.json` is 40684804 bytes with SHA256
`338f122996624b9fd7da905e95811df73771cab73909c34052ff159ef23afe56`;
`diagnostic-uninstrumented.json` is 19596375 bytes with SHA256
`3b2b72589a743f3fd8f4ca7c41b9bbe44f2f44c94869285c2776476149d8796c`.
They are intentionally represented by linked deltas, rather than absent raw files.
The reconstruction producer SHA256 is retained in the manifest separately from
simulation-source fingerprints.

## Exact endpoint-force failures and time errors

The selected-law exact gradient is independently reevaluated on the live current
World with cloned scratch, and inertia is M/h²*(x-xt) from actual native masses.
No stale World.g, projected force or instantaneous modal scale defines acceptance.
The fixed F0 is 881400.646629321 microN, giving the unchanged literal threshold
8.81400646629321e-5 microN under max(1e-7 microN,1e-10*F0).

Every trajectory contains force failures: **6975/7110** actual substeps miss the
gate, despite valid independent reference, live measurement and complete
instrumented Newton observation. Finite honest nonconvergence remains valid
diagnostics and convergence false. The finer three levels fail on every substep.
An [independent force/byte inventory](independent-force-review.json) checks all 7110
post-step classifications, 135 passes / 6975 failures, 552 retained snapshots and
59616 binary64 entries against decoded LE data, native hashes and scalar traces.
It does not recompute unsaved full vectors or claim another independent solve.

| Approximate z=omega*h | h (s) | Steps / trajectory | Force misses / level | Max discrete full-state error | Max continuous full-state error | Max continuous energy error |
|---|---:|---:|---:|---:|---:|---:|
|.08 |7.433175750007433e-7 |79 |339/474 |.0302421% |22.3053% |39.5865% |
|.04 |3.7165878750037167e-7 |158 |948/948 |.0367377% |11.8684% |22.3207% |
|.02 |1.8582939375018583e-7 |316 |1896/1896 |.0407762% |6.12351% |11.8708% |
|.01 |9.291469687509292e-8 |632 |3792/3792 |.0430040% |3.11053% |6.12375% |

Each level aggregates six trajectories, covering both starts and three budgets.
Errors above use full independent spectral propagation of actual rounded u0.
The full-state norm combines normalized mass-weighted displacement and velocity;
it is distinct from their individual comparison gates. All individual discrete
field/velocity/energy gates pass: maxima over the whole capture are .0268518%,
.0415508% and .00000665924%, respectively. Continuous gates fail at every level;
maximum phase error .00213741 cycles is separately below .01.

These comparisons are not a solved BE or time-accuracy claim: all trajectories
fail literal endpoint convergence. Only one amplitude and one geometry are
measured, so finite-strain isolation and full matrix acceptance remain open.
Budget/amplitude control diagnostics are 17 checkpoint samples, not an all-step
state-change bound. The larger declared window and first-order trend are unclosed.
The earlier first-step development probe is not another full-trajectory result.

## Actual Newton observation and bounded retention

The companion bench observer wraps each original EnergySearch begin/finish once.
It does not repeat a solver call, change a direction, refresh live gradient caches
or alter line-search decisions. The instrumented capture includes 49770 actual
Newton events with no missing or callback-failure observation; direct and PCG
paths occur. No direct-after-PCG-failure path is claimed by this measured run.

For each event it measures nominal packed and realized rounded directions
against the actual pre-search GN operator, with source, residuals, PCG count,
rounding discrepancy, accepted alpha and accepted/rejected search information.
Observation validity/completeness is separate from linear accuracy and exact
final nonlinear force convergence. Rejected trial count is not exposed by the
original search and is never inferred from accepted-backtrack totals.
The basic observer's per-Newton fields remain null; the companion supplies these
separately named records. Exact ablation/replay proofs are required above.

Every observed step retains changing scalar metrics, force status and raw
x/xs/xt/v hashes. Every actual Newton event retains its changing values; invariant
definitions/scope live once in report metadata or full event snapshots.
Full state snapshots include 17 fixed horizon checkpoints plus initial/final,
first invalid, first/worst force failure and worst continuous/discrete states.
Full linear snapshots retain worst nominal/rounded and first missing/rejected events.
This reduction precedes the pinned runs; it is not after-the-fact failure removal.

Snapshot `stateFloat64LE` explicitly stores base64 little-endian binary64 arrays.
Decode those payloads to preserve exact signed zeros lost by ordinary JSON
numbers. Raw hashes are native-byte hashes, interpreted with runtime.byteOrder.
Only retained snapshots permit full posthoc pose/gradient reevaluation; scalar
traces/hashes are not substitutes for all missing full states. Live independent
validation covers every observation before the streaming reduction.

## Higher-precision endpoint witnesses

The accepted fixed-pose witnesses separately evaluate independent exact-UV/
material StVK and captured runtime alpha/beta/Q/volume coefficients, plus real
stored M/h²*(x-xt). Both selected endpoints remain literal failures. Each 80/100
pair agrees on all 335 parsed leaves after excluding **only decimalDigits**,
including complete source/input/state/coefficient provenance.

| Selection, all cells2/forward/grain0, I16,A=.004,worst-force |80/100-digit witnesses and proof |Runtime / independent-UV / stored-coefficient residual (microN) |
|---|---|---|
|Search-stalled: level2, previous-pose start, step35 |[80](search-precision.json) / [100](search-precision-100.json) / [proof](search-precision-comparison.json) |.799480676 / .799479086 / .799478366 |
|Fine step: level8, predictor start, step210 |[80](fine-precision.json) / [100](fine-precision-100.json) / [proof](fine-precision-comparison.json) |.0108198168 / .0108206044 / .0108198844 |

The unchanged threshold is8.81400646629321e-5 microN for both. Maximum runtime
inertia-evaluation errors are6.6981e-12 and2.5920e-11 microN respectively; selected
elastic/coefficient/represented-state effects remain separate. The approximate
coordinate-spacing warnings are .000823041 and .0131687 microN, not error bounds.
Each proof checks the exact archived input SHA, captured source fingerprints,
helper hashes, coefficients, native M/h and all four decoded LE/native state hashes.

A coordinate-spacing scale m*ULP(x)/h² is diagnostic only, never a rigorous bound
or tolerance allowance. A high-precision fixed-pose residual above threshold
shows that improved summation does not repair that represented endpoint. It is
not a new solve, proof of unrepresentable equilibrium or general precision theorem.
The World raw-total-energy Armijo remains unchanged; static bench stable increments
are a separate experiment. No force subtraction or hidden state correction occurs.

## Reproduction and open acceptance

To inspect the archived complete reports, reconstruct into a fresh outside-repository
directory first. From the repository root:

```sh
node docs/research/evidence/membrane-transient-2026-11-10/archive-modal-evidence.mjs --reconstruct docs/research/evidence/membrane-transient-2026-11-10 /tmp/modal-reconstructed
node packages/engine/bench/compare-membrane-modal-audit.mjs /tmp/modal-reconstructed/diagnostic.json /tmp/modal-reconstructed/diagnostic-repeat.json --out /tmp/modal-reconstructed/repeat-proof.json
node packages/engine/bench/compare-membrane-modal-audit.mjs --observer-comparison /tmp/modal-reconstructed/diagnostic-uninstrumented.json /tmp/modal-reconstructed/diagnostic.json --out /tmp/modal-reconstructed/observer-proof.json
```

To rerun the actual experiment, use fresh outside-checkout paths and clean source:

```sh
python3 packages/engine/bench/membrane-modal-reference.py --self-test
python3 packages/engine/bench/membrane-modal-precision.py --self-test
node packages/engine/bench/membrane-modal-audit.mjs --stage diagnostic --matrix smoke --out /tmp/modal-diagnostic.json
node packages/engine/bench/membrane-modal-audit.mjs --stage diagnostic --matrix smoke --out /tmp/modal-repeat.json
node packages/engine/bench/compare-membrane-modal-audit.mjs /tmp/modal-diagnostic.json /tmp/modal-repeat.json --out /tmp/modal-comparison.json
node packages/engine/bench/membrane-modal-audit.mjs --stage diagnostic --matrix smoke --no-solve-observer --out /tmp/modal-uninstrumented.json
node packages/engine/bench/compare-membrane-modal-audit.mjs --observer-comparison /tmp/modal-uninstrumented.json /tmp/modal-diagnostic.json --out /tmp/modal-observer-comparison.json
python3 packages/engine/bench/membrane-modal-precision.py /tmp/modal-diagnostic.json --cells 2 --pattern forward --grain 0 --level 2 --budget 16 --amplitude .004 --seed true --snapshot worst-force --digits 80
python3 packages/engine/bench/membrane-modal-precision.py /tmp/modal-diagnostic.json --cells 2 --pattern forward --grain 0 --level 8 --budget 16 --amplitude .004 --seed false --snapshot worst-force --digits 80
```

Repeat the two precision commands with `--digits 100` and compare every parsed
field except decimalDigits, retaining source/input/hash equality.

The full diagnostic geometry matrix and larger amplitude/time/iteration window
are declared in the [method](../../membrane-transient-audit.md); they are not
claimed by this smoke capture. All-step budget isolation, amplitude halving,
resolved first-order time error and every literal force gate must close before
time acceptance. Broader spatial/mass/bending/contact/joins, measured stock,
booklet reading, actual devices and 8 ms remain independent gates. Research and
implementation are not exhausted and no optimal-abstraction conclusion follows.
