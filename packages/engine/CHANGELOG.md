# Changelog — `@pliego/engine`

> Boundary: public package (AGPL-3.0-only). Format: newest first; versions follow semver, and while the major is 0 a
> minor bump may break the API or the simulated numbers (see README «Package»).

## 0.1.0 — unreleased (first published version)

Optional `membraneModel: 'orthotropic-stvk'` adds objective per-triangle full-Q
Green-strain membrane energy, exact gradients and an explicitly named PSD
Gauss–Newton search matrix. It requires explicit uncapped/symmetric-compression,
nu12, curvature, no-projection and line-search research options. Initial planar
uncreased/no-join scope, finite geometry, snapshot identity and supported coupled
contact are checked. Independent linear/finite-strain references and unchanged
spring controls separate constitutive validation from material/device acceptance.
The spring law, stock snapshots and reader defaults are unchanged.

Optional `edgeEdgeMollification: 'surface-guarded'` differentiates the complete
parallel-edge weighted energy and retains uncovered pairs' original barriers.
Admission checks current VT topology/weld/fixed filters and sufficient caliper;
strict geometric feasibility/CCD remain independent of energy weights. Tests
cover native replay, independent multiplier gradients, PSD operator agreement
and the refused coverage counterexample. This is not global smooth contact,
C-IPC equivalence or material/performance acceptance.

Optional `contactBroadPhase: 'bvh'` adds a complete refit hierarchy for swept
candidates with reference pair ordering, native replay and brute-force coverage
checks. Reference traversal remains the default. Booklet measurements include
process CPU deltas and optional atomic checkpoints; no new physics acceptance
or backend optimality is implied by an index substitution.

Paper campaign continuation (2026-11-10, unreleased source): optional additive CCD,
coupled finite-gap normal barriers, previous-pose initialization, consistent radial
compression curvature and a checked direct-local/automatic contact solve. Native
eight-turn evidence, force-residual failures, CPU profiles and a parallel-edge
smoothness counterexample are retained. New physics remains off by default;
these are not C-IPC/OGC implementations or validated material/release presets.

Paper campaign additions (2026-11-09, unreleased source): fixed-query face contacts
reject negative barycentric weights near pinned corners; experimental
`physicalMembrane` and `lineSearch` options with objective/replay tests; native
booklet and contact-free axial comparison harnesses. Defaults retain capped
membranes and no energy line search. These additions do not close general contact,
material calibration or performance targets. See the research campaign for
measured failures and rejected alternatives. No package publish is implied.

First version published to MADFAM's registry (`npm.madfam.io`, scope `@pliego`), after the owner ruled on
2026-10-22 that the engine is a package other platforms consume rather than copy. The code is the engine as it
runs in the studio at this commit; nothing in `src/` changed for publishing.

- Public API: `loadDocument`, `DocumentError`, `buildMesh`, `defaultMeshEdge`, `locatePoint`, the `HINGE_*`
  constants, `World`, `dihedral`, and the namespaces `kinematics`, `materials` and `constants`;
  `ENGINE_KIND` / `ENGINE_VERSION` (equal to this file's version; test `package`).
- TypeScript declarations generated from the JSDoc (`types/`), shipped with the tarball.
- Zero runtime dependencies; plain ES modules for Node 20+ and browsers.
