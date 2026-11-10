# Parallel-edge contact smoothing review

Status: primary derivation reviewed, independent algebra checked, and an opt-in
native surface-guarded energy experiment implemented. This does not close C-IPC,
contact coverage, force convergence or material-validation gates.

## Reviewed sources

[IPC 2020 §6.1–6.2, Eq.24](https://ipc-sim.github.io/file/IPC-paper-fullRes.pdf)
multiplies each EE barrier by m(c), where c=|u×v|² and
ε=10⁻³|u_rest|²|v_rest|². For r=c/ε<1, m=2r−r²; otherwise m=1.
The multiplier vanishes for parallel edges. The stated surface-coverage argument
uses accompanying VT terms; it is not permission to remove geometric CCD pairs.
The implementation discussion uses squared distance, whereas Pliego's experiment
uses a linear finite-caliper gap. That difference still needs native validation.

[Technical supplement §1 and §7.1–7.2](https://ipc-sim.github.io/file/IPC-supplement-A-technical.pdf)
explains multiplication smoothing, retaining duplicate-stencil multiplicity and
reducing nearly parallel EE distance evaluation to PP/PE below an angle threshold
to avoid roundoff. Reproducing its complete distance policy remains open.

[Toolkit v1.6.0 scalar/Cartesian source](https://github.com/ipc-sim/ipc-toolkit/blob/478876f30bf8ea768772dd8983c26a1a801ad976/src/ipc/distance/edge_edge_mollifier.cpp)
confirms the multiplier and rest threshold. Its
[release notes](https://github.com/ipc-sim/ipc-toolkit/releases/tag/v1.6.0)
include nearly parallel distance/CCD and shape-derivative fixes. The local compiled
reference below is **1.4.0**, not a runtime test of 1.6.0. Rest-shape derivatives
are distinct from the Cartesian derivative needed for fixed native rest positions.

## Native derivation and approximation

The following is our candidate algebra, not a guarantee from
those sources. Let B=b(g), s=u×v, c=s·s, and J=∂s/∂x for the twelve endpoint
coordinates. With fixed rest geometry, ε is constant. Then

- ∇c=2Jᵀs;
- E=m(c)B;
- ∇E=m B' ∇g + B m' ∇c;
- ∇²E contains m∇²B, mixed first derivatives and B∇²m.

Ignoring the derivative of m is not the gradient of this energy. Multiplying
only the existing normal force or deleting parallel pairs is insufficient.

The native experiment uses the explicitly approximate PSD operator

    H~=m B'' (∇g)(∇g)ᵀ + 2 B m' JᵀJ

inside the smoothing interval; outside it, retain the existing radial B'' term.
Here B≥0, B''≥0 and m'≥0, so this is PSD. At exact parallelism, s=0 and
∇c=0, while ∇²c=2JᵀJ; H~ therefore equals the limiting exact EE Hessian
4B/ε JᵀJ. At c=ε the extra term vanishes. Elsewhere it omits mixed,
closest-feature and cross-product second derivatives: it is neither the exact
Hessian nor a demonstrated spectral PSD projection/bound. Actual energy search
and fresh target-force residuals would remain mandatory.

An alternative residual-factor GN construction must also be checked: a vector
residual proportional to sqrt(m/c) s has a finite parallel limit, but a naive
extension introduces angular curvature even where m=1. Do not silently call that
operator equivalent to the current radial model.

## Native coverage counterexample

`parallel-contact-limit.test.js` now constructs an analytical triangulated
hexagonal disk with six faces incident on a central vertex. Two non-neighbor
boundary edges are parallel, with distance 0.12 mm. A vertex of the shorter edge
also has distance 0.12 mm to the other edge's triangle. Both traversals retain
exactly one EE candidate but **zero VT candidates**: each outer vertex neighbors
the common center, so the native neighbor filter removes all VT backups.

This is a candidate-policy counterexample, not an admissible full World trajectory
or a failure of the published method. Applying its zero parallel-EE multiplier
alone would erase the only retained barrier in this fixture. Geometric CCD must
remain active, and topology/coverage must be resolved with smoothing rather than
assuming the published surface argument transfers to our stricter exclusions.

## Implemented admission and native experiment

`edgeEdgeMollification: 'surface-guarded'` requires `barrierContact` and is off by
default. For an EE pair, every one of its four endpoints must have an eligible
triangle containing the opposite edge. Admission uses the **same** adjacency,
shared-group, stationary-fixed and weld exclusions as the existing VT traversal.
It also requires that backup VT's hard thickness offset be **at least** the EE
offset. The state is rechecked each call; no cached weld/fixed eligibility survives
a change. Incident triangle lists depend only on immutable mesh topology.

This is a sufficient condition: two parallel finite segments attain their minimum
distance at an endpoint of at least one segment to the other segment. A triangle
containing that other edge has point–triangle distance no greater. Requiring all
four possible endpoint backups avoids making admission depend on a pose's current
closest feature. With VT offset ≥ EE offset, the retained backup gap is no larger
at that parallel limit. The existing expanded bounds retain a VT pair within its
activation distance. Tests audit the actual returned candidates on 96 translated
and rotated parallel surface pairs. This does not validate every native exclusion
or certify arbitrary floating-point CCD; that scope remains distinct.

The condition is deliberately stronger than necessary. A missing triangle,
excluded backup or insufficient caliper leaves the EE barrier **unmollified**,
and diagnostics count it when it lies in the smoothing interval. The central-fan
counterexample retains exactly its previous energy and force. This is partial
smoothing, not a claim that every contact configuration is C1. Triangle collapse,
degenerate features, and geometry-dependent join derivatives are still open.

The native gradient differentiates both multiplier and gap. The approximate
operator adds one radial and up to three angular rank-one rows; geometric contact
pair counts are separate from curvature row counts. Native assembled/matrix-free
agreement and snapshot replay are tested. At exact covered parallelism the
two-edge energy cusp is removed, with finite limiting tilt curvature. The same
fixture without surface backups is refused; no standalone-rod coverage is claimed.
Strict positive-gap checks occur **before** energy multiplication and geometric
CCD uses all eligible pairs, even when the multiplier is zero.

The extended independent adapter checks the production JavaScript multiplier and
Cartesian gradient against the compiled reference. The whole contact gradient is
also checked against energy finite differences, with force/torque balance and PSD
symmetry tests. Neither check substitutes for fresh trajectory force/material and
device gates. New energy means new physics: index-only trajectory equality is not
an acceptance criterion for the smoothed variant.

[Source-pinned booklet measurements](evidence/paper-2026-11-10/README.md) now
complete and repeat all eight capped S8/I32 turns with no force-tolerance misses
across 5168 executed substeps. Active p95 remains 287–289 ms; uncapped S8/I8
still fails 103/672 force checks. The global capped-stock ratios and uncovered
observation counts remain visible. These results do not validate the material or
close general coverage/performance gates.
With I32, the uncapped full sequence also completes and repeats with 0/5200
misses. Its wall-time variation and contact-free loading/unloading evidence are
recorded separately; using input moduli still does not establish measured-paper
accuracy.

```sh
python packages/engine/bench/mollifier-prototype.py --native > /tmp/native-mollifier.json
node --test packages/engine/test/mollified-contact.test.js
node packages/engine/bench/contact-objective-variants.mjs --out /tmp/objective-variants.json
node packages/engine/bench/paper-campaign.mjs --local-matrix --case 4 --model active-leaf --turns 1 --broad-phase bvh --edge-mollification surface-guarded --checkpoint /tmp/mollified-progress.json --out /tmp/mollified-turn.json
```

## Prototype evidence and native gates

The standalone Python prototype derives Cartesian cross-product derivatives
independently and compares with the compiled Toolkit 1.4.0 bindings. It checks
parallel/near-parallel/general edges, three scales and a zero rest-threshold case,
plus finite differences away from the multiplier clamp. This is component algebra;
it does not evaluate a complete mollified distance/barrier Hessian or World step.
The [60-case report](evidence/paper-2026-11-09/mollifier-independent.json) records
maximum normalized reference errors below 3.1×10⁻¹⁶ and finite-difference errors
below 6.3×10⁻¹⁰. Reproduce with an isolated environment containing Toolkit 1.4.0
and NumPy:

```sh
python packages/engine/bench/mollifier-prototype.py > /tmp/mollifier-independent.json
node --test packages/engine/test/parallel-contact-limit.test.js
```

Validation requirements for the experimental option and any future release:

1. Differentiate the whole mB energy, with fixed immutable rest-edge thresholds;
   include exact parallel, clamp, near-feature, duplicate-ID and degenerate cases.
2. Check finite-difference energy/gradient, PSD operator and local direct/matrix-free
   agreement. Count contact pairs separately from multiple curvature rows.
3. Retain strict feasibility and geometric CCD for every eligible pair, even if
   its multiplier is zero; do not form 0×Infinity and accept an invalid pose.
4. Audit actual VT backup under native topology/weld exclusions and variable
   caliper; the standalone two-edge fixture alone has no VT backup.
5. Revisit the retained frame-650 objective and full eight-turn trajectories,
   strict force tolerance, uncapped stock/timestep/mesh and corpus regressions.
   Changed physics must not be presented as an index-only replay equivalence.

Default reader behavior and fabrication data are unchanged by this review.

## Related finite-thickness and stopping rules

[C-IPC §5.1](https://ipc-sim.github.io/C-IPC/file/paper_small.pdf)
evaluates b(d²−ξ², 2ξh+h²). Merely substituting b(d−ξ,h) changes the force
law and stiffness units. Our current linear-gap candidate and the proposed
multiplier experiment must keep that distinction explicit.

[C-IPC supplement §7](https://ipc-sim.github.io/C-IPC/file/supp.pdf)
uses the normalized Newton-increment velocity ||p||/(dt sqrt(n_free)) and requires
three qualifying iterations. That differs from Pliego's current absolute nodal
force threshold. A future comparison should report both diagnostics with declared
units; it must not replace a failed force gate with a passing small-step label.
