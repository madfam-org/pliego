# @pliego/engine

> Boundary: public package (AGPL-3.0-only). Design contract: [`docs/strategy/engine.md`](../../docs/strategy/engine.md).
> Document contract: [`docs/spec/v1/sheet-document.md`](../../docs/spec/v1/sheet-document.md).

The Pliego paper engine. It loads a **sheet document** (FOLD 1.2 + `pliego:`) and simulates it:

- **Tier R** (rigid / kinematic): face-tree poses, loop closure with damped least squares and a
  DOF report, closed forms (degree-4 vertex, Miura-ori, V-fold, four-bar) and the kinematic fold
  program.
- **Tier C** (compliant): real paper stiffness. Membrane, grain-anisotropic bending, creases with
  plastic memory, glue welds, pivots, strings, sliders, pins, mechanisms, layer contact with
  friction, the ground plane, air drag and deterministic wind.

The package is plain ES modules with JSDoc (`// @ts-check`). It has zero dependencies and no build
step, and runs in the browser (the studio loads `/engine/index.js`) and in Node 20 or later.

```bash
node --test packages/engine/test/*.test.js     # Node 20 and 22; every benchmark prints a read-proof line
node packages/engine/test/helpers/write-fixtures.js   # regenerate test/fixtures/*.fold
```

## API

```js
import { loadDocument, buildMesh, World, kinematics, materials, constants } from '@pliego/engine';

const doc = loadDocument(json);        // validates spec §8; throws DocumentError listing EVERY problem
const world = new World(doc, {
  meshEdge: 6,        // mm target edge length (default: largest sheet span / 30, clamped to 3–8 mm)
  substeps: 20,       // fixed substeps per 60 Hz frame; step() runs whole substeps only
  contact: true, ground: true, gravity: true,   // gravity may also be a scale factor
  seed: 1,            // wind turbulence PRNG
  // advanced: damping (1/s), windDir [x,y,z], panelStiffness (×), handFactor, plasticity,
  //           mechanismRate (deg/s or mm/s), grabStiffness, membraneCompression, refactorAngle
});
world.setControl('open', 120);   // any pliego:controls id (sequence controls take a step position)
world.step(1 / 60);
world.positions;                 // Float64Array xyz of the simulation vertices (live)
world.render();                  // { positions, normals: Float32Array, uvs, sheetIds: Float32Array, indices: Uint32Array }
world.creaseLines();             // { positions: Float32Array (xyz pairs), kinds: Uint8Array (0 M, 1 V, 2 score, 3 perf, 4 cut), edges, names, count }
world.docVertexMap();            // Int32Array: document vertex → simulation vertex
world.grab(v, [x, y, z]); world.moveGrab([x, y, z]); world.release();
world.pick(origin, dir);         // { vertex, triangle, point, sheet } | null
world.setForce(v, [fx, fy, fz]); // constant external force (µN), for tests and tools
world.stats();                   // { maxStrain, maxCompression, energy{stretch,bend,crease}, contacts, grounded,
                                 //   substepsRun, factorizations, pcgIterations, kinematicResidual, finite, time }
world.snapshot(); world.restore(s);   // bit-exact, including the factorisation state
```

`render()` buffers are allocated once and refreshed in place. Render vertices are split along fold
hinges into smoothing groups, and the UVs span each sheet's local bounding box.

`kinematics` exports `FaceTree`, `LoopClosure`, `KinematicProgram` and the closed forms
(`degree4`, `degree4Multipliers`, `miuraDims`, `miuraPoisson`, `miuraFoldAngles`, `vfold`,
`fourBar`).

## Units

All quantities are in mm, g and s. Force is g·mm/s² (µN) and energy is g·mm²/s² (nJ). Angles are
degrees in documents and radians inside the engine. The world is Y-up: sheet-local `(u, v)` maps
to `(u, 0, −v)` before placement, so a counter-clockwise sheet faces +Y. Fold angles follow FOLD:
valley is positive, mountain negative. The `sign-convention` test pins this.

The engine reads **only** the stock snapshot's `derived` block (spec §5.2). It honours the optional
`G12`, `score_yield_deg` and `perf_*` keys. The kernel's `pliego.stock.derive` is the single source
of the measurement-to-physics mapping. The engine's only built-in stock is `kami`, used for plain
FOLD files (spec §7).

## How Tier C integrates

Each fixed substep, of length Δt = 1/(60·S), runs these stages in order:

1. **Drivers.** Kinematic sheets and pins follow their mechanisms. Fixed boards keep their
   placement. The sequence player eases hinge drives (smoothstep), keeps them held until a later
   step releases them, and accepts fractional step positions. The page-turn hand drives a band of
   fore-edge vertices along arcs. A kinematic fold program poses its sheets rigidly with loop
   closure solved once per frame.
2. **Prediction.** `v ← v·exp(−c·Δt)`, then `x̃ = x + Δt·v + Δt²·M⁻¹·f_ext`, where the external
   forces are gravity, air drag with wind, and user forces.
3. **Implicit block.** The engine takes one Gauss–Newton step on the stiff sheet energies:
   membrane springs, panel and crease hinges with their drives, and point terms (welds, pivots,
   sliders, strings, grabs). It solves `H δ = −∇E(x̃)` with `H = M/Δt² + Σ k∇C∇Cᵀ`, using a sparse
   3×3-block Cholesky factorisation (minimum-degree ordering, symbolic analysis once). Between
   refactorisations it uses PCG preconditioned by the last factorisation.
4. **Gauss–Seidel projections.** Fold limits, layer contact and the ground (3 passes, Coulomb
   friction, remembered sidedness), then the 0.5 % stretch limiter last.
5. **Bookkeeping.** `v = (x − x_start)/Δt`, unwrapped hinge angles, and rate-independent crease
   plasticity (Narain et al. 2013): `θ_rest ← θ − sign·θ_y`.

**Why stage 3 departs from engine.md §3.1 (one Gauss–Seidel iteration for every constraint).**
Each finding below was measured in this lane's prototypes (all numbers are in the lane report):

- **Saturated bending.** For paper, the per-substep bending stiffness k_b·Δt²·|∇θ|²/m is about 60
  (copy paper, h = 6 mm, S = 20). One Gauss–Seidel sweep then does not converge, and the
  equilibrium saturates at a stiffness set by the solver: a cantilever came out 15× too soft at
  S = 20 and 5× at S = 40. All stocks would look alike.
- **Stretching membrane.** Hard Gauss–Seidel membranes stretch by about N·g·Δt²/h along tension
  paths: 3 % at h = 4 mm and 13 % at h = 2 mm.
- **Warm starting does not fix it.** Warm-starting the multipliers diverged.

The joint solve is still XPBD's compliant-constraint formulation (α = 1/k, λ reset every substep),
with the per-substep linear system solved directly instead of by one sweep. The steady state is
exact (∇E = f_ext) whatever the age of the factorisation, and test `E12-substeps` checks it.

### Discretisation choices

- **Mesh.** Edges are split to segments of at most h, so shared edges conform. Each face is ear
  clipped, then a grain-aligned equilateral lattice is inserted with Delaunay flips. Long edges
  are split (to at most 1.25 h) and the result is Laplacian-smoothed. Crease and cut lines stay
  exact mesh edges. Cut edges duplicate their vertices; cut tips stay shared.
- **Bending.** Each hinge carries `k_b = C_B·D_eff(φ)·|e|²/(A₁+A₂)`. `D_eff` is the orthotropic
  D(φ), Fourier-deconvolved so that hinge sums reproduce D(φ) in every bending direction.
- **Membrane.** Per-edge springs use `E(φ)·t·w_e/l₀`, with the modulus capped at
  `MEMBRANE_CAP_LENGTH·ρ_A·g`. Compression is soft (5 % of tension stiffness), which removes
  membrane locking and matches fibre-scale buckling.
- **Clamp lines.** A hinge whose edge and one wing are fixed has its stiffness doubled, because
  only half of its lever region bends.
- **Glue welds.** A welded vertex sits exactly on its zone, with zero offset. Contact is skipped
  within two mesh rings of a weld, and `side` is a rendering hint.

## Determinism contract

The same document, World options and sequence of `setControl` / `grab` / `step` calls give
bit-identical `positions` (Float64) on the same JavaScript engine. To guarantee this, the engine
uses:

- fixed substeps only;
- fixed iteration orders, with no hashing in hot paths;
- a seeded PRNG for wind (never `Math.random`);
- no clocks inside `step`;
- typed arrays.

`snapshot()` / `restore()` reproduce the factorisation from the state it was built from.
Tests: `determinism-replay` and `determinism-snapshot`.

## Calibration constants (`src/constants.js`)

| constant | value | fixed by |
|---|---|---|
| `C_B` (bending discretisation) | 1.0244 | `E1-peirce` MD (copy paper 80 g/m², 25 mm strip, h = 6 mm). CD then checked without recalibration |
| `HAND_FACTOR` | 50 | `crease-drive` |
| `PANEL_YIELD_DEG` | 60 | `crease-unfold` (panels stay elastic) |
| `STRAIN_LIMIT` / `STRAIN_PASSES` | 0.5 % / 4 | `inextensible` |
| `MEMBRANE_CAP_LENGTH` | 1e7 mm | `inextensible`, E1 (stability of the Newton step) |
| `MEMBRANE_COMPRESSION` | 0.05 | `E1-peirce` (membrane locking) |
| `CONTACT_PASSES` | 3 | `contact-stack` |
| `PCG_MAX_ITER` / `PCG_REFACTOR_ITER` / `PCG_RTOL` / `REFACTOR_ANGLE` | 12 / 6 / 1e-3 / 0.3 rad | `E12-substeps` (equilibrium independent of these) |

## Verification (engine.md §7)

Every row of engine.md §7 is a test in `test/`. Each prints
`bench <id>: measured=… expected=… tol=… PASS|FAIL`. The exact numbers are in the lane report and
in the CI log.

## Attribution

- **Dihedral-angle gradient.** Bridson, Marino & Fedkiw 2003. As restated by Ghassaei, Demaine &
  Gershenfeld 2018 (Origami Simulator, MIT licence, © 2018 Amanda Ghassaei). Written from the
  equations; no code copied (see `src/xpbd/dihedral.js`).
- **Sparse Cholesky.** The up-looking algorithm after T. Davis, *Direct Methods for Sparse Linear
  Systems* (2006), generalised to 3×3 blocks.
- **Degree-4 closed forms.** Foschi, Hull & Ku 2022.
- **Miura-ori.** Schenk & Guest 2013.
- **Orthotropic paper relations.** Baum, Habeger & Fleischman 1981.
- **Crease length scale.** Lechenault, Thiria & Adda-Bedia 2014.
- **Plasticity rule.** Narain, Pfaff & O'Brien 2013.
- **Not used.** No GPL code: Rabbit Ear, ORIPA and TreeMaker are not used. No third-party crease
  patterns appear in fixtures; every test geometry is generated here.
