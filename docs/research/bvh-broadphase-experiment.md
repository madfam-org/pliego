# Refit broad-phase index experiment

Status: opt-in implementation comparison. Default `contactBroadPhase` remains
`'reference'`. `'bvh'` applies to swept candidates used by `continuousContact`
and `barrierContact`; it does not replace the legacy projection contact class.
The contact energy, material model, solver budgets, CCD and feasibility rules
remain the same. This index cannot repair their known limitations.

## Coverage and order

Both traversals use the same vertex, triangle and edge bounds, covering both
motion endpoints, maximum primitive caliper and the existing outward roundoff
margin. The BVH is initially partitioned by deterministic spatial medians.
Each call refits **every** leaf/internal bound, stationary flag and current rank;
there is no approximate temporal cache or curvature-based contact suppression.

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

Trees are scratch state. Snapshot restore can change spatial partition history,
but the complete refit and ordered output must still reproduce the same pairs.
Tests cover persistent refits, dense ties, empty trees, moving prescribed vertices,
changing fixed/weld state, independent brute-force bounds, native replay and the
retained 1592-stencil late-turn objective/search.

## Measurements and fidelity

`broadphase-pairs.mjs` compares cold first builds and alternating warm builds on
native initial/late poses, a native sweep, a large synthetic prescribed sweep and
deliberately dense synthetic bounds. It checks exact ordered pair bytes and
records wall/process CPU time separately. Dense output can erase an index's
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

Initial component checks pass; full-sequence equivalence, measured cost and
device/corpus acceptance are evaluated separately. Neither a matching pair hash
nor a faster index closes the force-convergence, contact-smoothness or material
calibration gates.
