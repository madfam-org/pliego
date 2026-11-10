# Continuous-contact experiment

Status: experimental, opt-in; not a stable reader or a coupled contact solver.
Scope: Pliego native Float64 engine. The default reader trajectory is unchanged.

## Reproduced failure

An isolated legacy `Contact.project` query moves a free point from
`(0.25, 0.3, 0.25)` to `(0.25, -0.3, 0.25)` through a fixed triangle with corners
`(0,0,0)`, `(1,0,0)`, `(0,0,1)`. Required midpoint separation is 0.1 mm.
The existing projection skips the end position because it is farther than twice
the contact thickness from the plane. The point tunnels through. At the engine's
S=8 timestep this displacement corresponds to 288 mm/s. This is an isolated
counterexample, not proof that all booklet failures have the same cause.

For this trajectory, first finite-thickness contact is at normalized time 1/3;
zero-thickness contact is at 1/2. The new query returns a positive lower bound
below each analytical contact time. Separate tests cover moving edge–edge contact
and lateral approach to a triangle boundary, which a face-plane-only test misses.

## Implemented components

- `src/collision/distance.js`: closest point–segment, point–triangle and
  segment–segment distances, with convex feature weights. Outside a face, actual
  boundary features are used. Degenerate and near-parallel fixtures are retained.
- `accd.js`: additive conservative advancement based on
  [C-IPC §5.3–5.4 and Algorithm 1](https://ipc-sim.github.io/C-IPC/file/paper_small.pdf).
  The common translation is removed before bounding relative speed. A distance
  gap divided by the primitive speed bound supplies a safe increment in exact
  arithmetic. Safety is 0.1. Our explicit 256-iteration cap returns the attained
  partial interval with an `iteration-limit` diagnostic; it never converts an
  unfinished search into a full step.
- `swept.js`: deterministic swept AABB reference for both vertex–triangle and
  edge–edge candidates. Both endpoints and finite thickness participate, including
  motion beyond the legacy 50 mm broad-phase reach cap. Primitive bounds use the
  maximum vertex thickness. Stationary prescribed pairs, one-ring/shared-group
  topology, and explicit welded-sheet neighborhoods are excluded. These exclusions
  mean this is not an unconditional certificate for every pair of triangles.
- `motion-guard.js`: a global linear-motion bound after the existing solver and
  projections, before velocity and hinge updates. Enable with
  `new World(doc, { continuousContact: true })`; contact must also be enabled.
  `ccdIterations` changes the per-pair search cap. `stats().continuousContact`
  retains counts, limiting pair, interval and computational-limit status;
  snapshots preserve them for bit-exact replay.

Initially infeasible eligible geometry fails explicitly. A limited step involving
prescribed moving vertices also fails, rather than silently moving pins away from
their targets. Positions are restored on these errors, but drivers and other
substep state may already have advanced: restore a full World snapshot or discard
the World before reuse. Adaptive prescribed-motion coupling is not implemented.

These are ordinary floating-point queries, not interval arithmetic or exact
predicates. Scale/rigid-motion, sliver and sampled-trajectory tests are evidence
within their tested domains, not a proof over every IEEE-754 input. Non-finite
distances/displacements fail rather than being accepted as safe.

## Why this does not finish the contact problem

A single global bound can stall every free vertex when one pair approaches its
thickness limit. The guard contributes no repulsion, friction or elastic contact
forces to the implicit solve. It does not enforce triangle non-inversion or strain
barriers. Intermediate Newton/projection positions are not individually filtered;
earlier operations such as tearing are not rolled back if the endpoint motion is
limited. This is a diagnostic/reference candidate, not an IPC implementation.

The C-IPC method filters each Newton line search and couples its barrier terms
to the incremental potential. Its published properties do not transfer to our
endpoint filter. Reviewing and implementing an ACCD query closes only one item
within that larger research candidate.

The native booklet comparison confirms this limitation. Guarded candidates either
stop making progress or fail the strain gate before their first complete turn.
Keeping a nearly motionless sheet below 1% stretch is not success. The guard stays
off by default; there is no stable-release or optimal-performance claim.
The [source-pinned reports and repeated comparison](evidence/paper-2026-11-09/README.md#continuous-contact-and-physical-turn-progress)
retain all failures and verify unchanged default-case numerical results against
the previous engine.

## Reproduction and gates

```sh
node --test packages/engine/test/collision-distance.test.js packages/engine/test/accd.test.js packages/engine/test/swept-contact.test.js packages/engine/test/paper-metrics.test.js
node packages/engine/bench/paper-campaign.mjs --contact-matrix --out /tmp/paper-contact.json
```

The eight-case matrix includes two unguarded S=8 references, guarded S=8/S=16
all-flexible/active-leaf models, and guarded uncapped-membrane plus energy-search
models. Source, engine tree, harness, metric helper, reader and fixture hashes are
recorded. Timing is exploratory; run it without competing tests.

Zero CCD progress stops a case as failure before flat endpoint promotion. An
additional endpoint gate requires each sampled fore-edge vertex to reach at least
90% of its destination X displacement in the **pre-promotion physical pose**.
This catches a page whose logical control reaches 180 degrees while geometry
remains on its starting side. It checks turn progress, not equilibrium, material
accuracy or all spatial degrees of freedom. Existing strain, ground, thickness
and timing gates remain separate. Exit zero means the harness completed, not that
its candidates passed.

Next: integrate feasible contact forces into the nonlinear solve, handle
prescribed motion and initially touching binding regions explicitly, and compare
cost at equal progress/strain/thickness tolerances. A faster broad phase alone
cannot fix the zero-progress failure.
