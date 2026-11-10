# Refit broad-phase index experiment

Status: opt-in implementation comparison. Default `contactBroadPhase` remains
`'reference'`. `'bvh'` applies to swept candidates used by `continuousContact`
and `barrierContact`; it does not replace the legacy projection contact class.
The contact energy, material model, solver budgets, CCD and feasibility rules
remain the same. This index cannot repair their known limitations.

## Coverage and order

Both traversals use the same vertex, triangle and edge bounds, covering both
motion endpoints, maximum primitive caliper and the existing outward roundoff
margin. The BVH initially separates stationary and active primitives, then uses
deterministic spatial medians within those groups. Changing stationary state
does not preserve a stale exclusion: both groups' flags are fully refitted.
Each full build refits **every** leaf/internal bound, stationary flag and current
rank. The BVH may reuse an unswept candidate list only when every position, fixed
flag, weld, caliper, vertex group, vertex sheet and triangle sheet value is exactly
unchanged. Comparisons distinguish signed zero and snapshot contents independently
of caller array identity. Connectivity and primitive counts remain immutable, as
required by the constructor neighbor graph. Swept calls always rebuild and
invalidate reuse. There is no approximate temporal cache or curvature suppression.

An internal bound is the component-wise union of its children. Consequently a
primitive whose bound overlaps the query cannot be removed by an ancestor's
non-overlap test. A fully stationary fixed node is pruned only for a query that
is itself fully stationary fixed. Prescribed vertices with different endpoints
remain active. Existing topology/shared-group/weld exclusions are then applied.
This preserves the reference candidate set, including its existing exclusions;
it is not an independent certificate that those exclusions model all paper contact.

Query hits are returned in the reference's current min-X/primitive-ID rank order.
VT queries retain increasing vertex order. EE queries retain increasing outer
edge rank and strictly greater inner rank. This preserves multiplicity and the
order of floating-point force sums and sequential CCD bounds. Traversal topology
and node-visit counts may differ without changing those physics inputs.
When a query exactly encloses the root bound, every leaf overlaps; current ranks
are emitted directly with current stationary/rank filtering, avoiding a dense
walk and sort. This is an exact enclosure test, not a proximity heuristic.

Trees are scratch state. Snapshot restore can change spatial partition history,
but the complete refit and ordered output must still reproduce the same pairs.
Tests cover persistent refits, dense ties, empty trees, moving prescribed vertices,
changing fixed/weld state, independent brute-force bounds, native replay and the
retained 1592-stencil late-turn objective/search.

## Measurements and fidelity

`broadphase-pairs.mjs` compares cold first builds and alternating warm builds on
native initial/late poses, a native sweep, a large synthetic prescribed sweep and
deliberately dense synthetic bounds. It checks exact ordered pair bytes and
records wall/process CPU time separately. Schema 0.2 separates forced BVH rebuild
from allowed exact-pose reuse, so repeated identical poses do not masquerade as
refit timings. `build(..., false)` supplies the force-build control; this is an
internal candidate-builder argument, not a new World physics option. Dense output can erase an index's
advantage; no universal speedup is assumed. Synthetic stress cases are not
physical sheet simulations.

The booklet harness accepts `--broad-phase reference|bvh`. Its optional
`--checkpoint /tmp/file.json` writes atomic partial turn/case accumulators,
explicitly marked incomplete until the final source-integrity check succeeds.
Checkpoint files must be outside the source checkout so their writes do not
invalidate that check. A completed checkpoint/report can still contain failed
physics cases. Process CPU timings include JIT/GC threads; they do not measure
only solver self time.

```sh
node --test packages/engine/test/swept-bvh.test.js packages/engine/test/swept-contact.test.js
node packages/engine/bench/broadphase-pairs.mjs --out /tmp/broadphase-pairs.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 4 --model active-leaf --turns 1 --broad-phase bvh --checkpoint /tmp/bvh-progress.json --out /tmp/bvh-turn.json
```

`compare-broadphase-runs.mjs` requires matching recorded input protocol, fixture,
reader/metric fingerprints and model options. It compares every recorded result
field except enumerated timing fields/their 8 ms gate and the declared broad-phase
selection. This includes the hash covering every sampled pre-promotion pose and
all force/CCD diagnostics. Prior harness bytes can differ and remain recorded;
fresh reference/repeat runs must share the indexed run's source and harness.

## Recorded checkpoint

Source [`9a62ba9`](https://github.com/madfam-org/pliego/commit/9a62ba9b0a151ab28ef9b0171903a57013078b1f)
passes exact ordered-pair comparison on all five component scenes. Native warm
candidate-build medians fall from 4.66–5.24 ms to 0.95–1.61 ms. The deliberately
large prescribed sweep regresses from 85.05 to 128.25 ms; dense all-free bounds
improve from 105.84 to 74.96 ms. The initial index and its regressions are retained
alongside the refinement, rather than discarded.

The complete eight-turn indexed candidate matches **every recorded non-timing
result**, including the reference hash of all 672 sampled pre-promotion poses.
The first turn also matches a fresh same-source reference and a repeated indexed
run. The comparator rejects altered trajectory and force diagnostics. A separately
retained all-flexible case still fails initial strict-ground feasibility; its
completed harness/checkpoint does not claim a completed physical turn.

Fresh first-turn active-frame p95 is 1009.72 ms with the reference versus
318.90/303.52 ms indexed. Full-sequence diagnostic active p95 falls from
23253.50 to 7861.01 ms, with the same 680/5264 unconverged substeps and 250492
backtracks. These are exploratory local costs, not isolated device certification:
the older full run included short profiling/probes; the indexed full run included
two brief independent algebra checks. There was no competing full physics suite.
Both miss the 8 ms target by a large margin. Full-sequence indexed repeat, corpus
and real-device acceptance remain open.

[Raw reports, comparisons and reproduction](evidence/paper-2026-11-09/README.md#ordered-refit-bvh)
retain source/input fingerprints and all failed gates. This index is an exact
substitution for the existing candidate policy, not its physical validation.
The [parallel-contact audit](parallel-contact-review.md) demonstrates that native
neighbor exclusions can remove the VT backup needed before applying the published
EE smoothing construction. Contact smoothness, coverage and material calibration
remain open. Other indices, exact pose reuse and lower-level backends have not
been exhausted.

[Toolkit 1.6.0](https://github.com/ipc-sim/ipc-toolkit/releases/tag/v1.6.0)
now defaults to LBVH and reports gains on its own benchmark scenes. That is an
additional implementation candidate, not a measured comparison against Pliego's
refit index; its performance claims have not been reproduced here.

## Exact-pose reuse validation

The targeted suite retains ordered reference pairs/bounds through ten live-input
states, including signed zero, in-place pose/filter/caliper changes, copied input
arrays, swept bypass and recovery after nonfinite coordinates. Native replay and
the retained late-turn objective/search remain exact. Candidate scratch arrays
are internal and must not be mutated by consumers.

`compare-paper-execution.mjs` compares whole campaign reports while allowing only
the implementation commit/tree fingerprints and enumerated timing fields to
differ. Unlike a model comparison, every recorded physics option, diagnostic,
trajectory hash and non-time gate must agree. The older capped control predates nullable iteration-override metadata. An explicit
`--legacy-iteration-metadata` comparison accepts only the two reviewed harness
fingerprints, an absent old override and a null new override. Effective solver
options still compare exactly; unknown harnesses and non-null overrides fail.
The retained harness diff only adds override parsing/application and metadata.

Source `62fd4565de9215b69724457740d862365ed11cf7` completes both capped and uncapped
S8/I32 eight-turn sequences with **all** recorded non-time physics unchanged from
their controls, including every sampled-pose hash and contact/force counter.
Both repeat every recorded non-time report field on the new source. This retains
0/5168 capped and 0/5200 uncapped force misses; it does not change material gates.

The clean-source component report separates forced rebuild and reuse: native
initial/late candidate medians are 1.08/1.63 ms for full BVH builds and 0.023/0.022 ms
for exact reuse, with zero traversal tests on hits. Swept input medians remain
0.97 ms native and 134–135 ms for the synthetic large sweep. That stress case is
still slower than the 81.08 ms reference scan. Dense all-free inputs use separate
endpoint arrays and intentionally rebuild; their 77.5–77.6 ms costs show no reuse
benefit. All five scenes retain identical ordered pair bytes.

Full active-frame p95 is 290.21/237.21 ms capped and 364.81/344.81 ms uncapped;
CPU p95 is 273.27/237.44 and 357.47/343.69 ms respectively. The first capped run
overlapped the local engine suite and is excluded from performance conclusions.
Repeats, uncapped runs and the component/profile experiments were sequential,
with no competing local campaign/suite, but ordinary background activity remains.
Prior-source timings are retained controls, not a fresh paired device trial.
Every full run still fails the 8 ms target.

A fresh first-turn whole-process V8 profile preserves the prior profiled run's
non-time physics and input metadata. Candidate construction/query/refit accounts
for 55.51% of sampled self time (37.29% tree, 18.22% swept builder), versus 68.23%
previously; Cholesky is 6.37%. This keeps exact active-traversal/backend work ahead
of a factor-only port. Samples include startup, construction, JIT and diagnostics;
shares are not retired instructions or a device certificate. Raw profiles remain
local; the committed summary removes local paths and records their hashes.

[Raw reports, strict comparisons and reproduction](evidence/paper-2026-11-10/README.md#exact-pose-candidate-reuse)
retain all limitations. The targeted invalidation/replay checks, full 146-test
engine suite and 43-source JSDoc check pass at the implementation checkpoint;
additional comparator negative controls protect the metadata compatibility path.
