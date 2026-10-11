# @pliego/engine

> Boundary: public package (AGPL-3.0-only). Design contract: [`docs/strategy/engine.md`](../../docs/strategy/engine.md).
> Document contract: [`docs/spec/v1/sheet-document.md`](../../docs/spec/v1/sheet-document.md).

The Pliego paper engine. It loads a **sheet document** (FOLD 1.2 + `pliego:`) and simulates it:

- **Tier R** (rigid / kinematic): face-tree poses, loop closure with damped least squares and a
  DOF report, closed forms (degree-4 vertex, Miura-ori, V-fold, four-bar) and the kinematic fold
  program.
- **Tier C** (compliant): real paper stiffness. Membrane, grain-anisotropic bending, creases with
  plastic memory, perforations that tear, glue welds, pivots, strings, sliders, pins, mechanisms,
  layer contact with friction (sidedness seeded from `faceOrders`), the ground plane, air drag and
  deterministic wind.

The package is plain ES modules with JSDoc (`// @ts-check`). It has zero dependencies and no build
step, and runs in the browser (the studio loads `/engine/index.js`) and in Node 20 or later.

```bash
node --test packages/engine/test/*.test.js     # Node 20 and 22; every benchmark prints a read-proof line
node packages/engine/test/helpers/write-fixtures.js   # regenerate test/fixtures/*.fold
```

## API

```js
import { loadDocument, buildMesh, World, kinematics, materials, constants } from '@pliego/engine';

const doc = loadDocument(json);        // validates spec §8 (incl. meta.digest); throws DocumentError listing EVERY problem
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
                                 //   substepsRun, factorizations, pcgIterations, kinematicResidual, finite, time,
                                 //   tornWelds, unheldWelds }
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
   refactorisations it uses PCG preconditioned by the last factorisation. The preconditioner is
   co-rotated by the sheet's best-fit rotation since factorisation (Horn's quaternion method), so
   page turns keep converging. The engine refactorises when PCG stalls, when the stiffness set
   changes (drives, grabs, strings, torn perforations) or past a 0.3 rad rotation safety cap.
4. **Gauss–Seidel projections.** Fold limits, layer contact and the ground (3 passes, Coulomb
   friction, remembered sidedness), then the 0.5 % stretch limiter last.
5. **Bookkeeping.** `v = (x − x_start)/Δt`, unwrapped hinge angles, and rate-independent crease
   plasticity (Narain et al. 2013): `θ_rest ← θ − sign·θ_y`.

**Keyed mechanisms** (spec §5.18, `src/keyed.js`). A `hinge`, `rotate`, `leaf`, `translate` or
`slide` with `keys` maps its control value through a linear table (optionally `period`ic) before
its usual formula, and a `hinge`/`rotate`/`translate` with `ride` is carried by another one
(T = T_ride ∘ T_own). One control then drives a crank-rocker four-bar (the coupler rides the crank)
or a cam follower exactly; the studio's preview stub evaluates the same table. Test
`keyed-mechanisms`.

**Step-activated joins** (spec §5.19, `src/gates.js`, `src/xpbd/gates.js`). A glue, pivot, string
or pin with `active_from` is off until its step begins. When it switches on it is created from the
current geometry: weld points within the snap distance (max(1 mm, 4 × caliper)) snap onto their
zone, paper that lies on its zone but slid along it is welded where it lies, and paper off its
zone does not take hold (`stats().unheldWelds`). A gated pin is a stiff anchor term rather than a
fixed vertex, so the free-vertex set (and the symbolic factorisation) never changes. Switching
refactorises; contact exclusion around welds follows the gates. Test `step-joins`.
A step's `release_joins` (spec §5.20) unties joins from that step on, through the same gates
(test `untie-joins`).

**Start pose** (backlog item 21). A mechanism control starts at its `default` unless the
mechanism's neutral value (0, or a hinge's `rest`) reproduces the document's initial pose better;
then it starts there and glides to the default at `mechanismRate`, and `world.warnings` says so.
Before, such a document teleported its kinematic sheets on the first substep and smashed the
paper around them: `pull-tab-slider` `straight` stretched 8–16 % and `dissolve-scene` 5–13 %; now
0.45–2.4 % and < 0.5 % (the rest in `pull-tab-slider` comes from the document stacking its strip
0.3 mm above the backing where 0.33 mm is the contact distance, so the sliding strip drags the
free backing by friction). Test `start-pose`.

**Next engine milestones** (measured, not implemented): `rotating-squares` needs in-plane
plasticity of its kirigami ligaments (46–218 % stretch today), and `tab-and-slot` needs
edge–edge contact (10–13 % stretch, 1.5 % in `low-cross`), because vertex–triangle contact lets a
tab's edge pass a slot's edge.

**Digest** (spec §5.7 and rule 10, canonical serialisation per lane H's §5.15, `src/digest.js`).
When `pliego:meta.digest` is present, `loadDocument` recomputes "sha256:" + SHA-256 of the RFC 8785
canonical text of the document (keys sorted as UTF-16 code units, ECMAScript number spelling,
digest set to null) and rejects a mismatch. SHA-256 is implemented here (synchronous; WebCrypto's
digest is asynchronous). About 7 ms for a 250 kB document. Test `digest` (the kernel's shared
vector, node:crypto parity, tamper rejection).

**Split cuts** (spec §5.13, from lane H). The kernel writes a cut once per side: twin `C` edges with
the same coordinates over split vertices, each bordering one face. Rule 4 accepts a `C` edge that
borders one face when exactly one other `C` edge of its sheet has the same endpoint coordinates;
the mesher builds one side per twin (an unsplit cut is still split by the mesher), and coincident
copies share a contact group. Rule 3's area floor is measured per material face (faces joined
across `J` edges), as the kernel's verify measures it. Test `split-cuts`.

**Perforation tearing.** Perforation lines are split like cuts. Their duplicated vertices are
re-joined by welds, with a perforation hinge spanning the split. A weld breaks when its force
exceeds `perf_factor·Y·tear_strain·(length it carries)`. Only the most loaded weld breaks in each
substep, so a tear runs along the line. Test `perforation-tear`.

**Sleep.** When nothing drives the world (controls settled, no grab, no wind) and every free
vertex stays slower than 1e-5 mm/s for 30 frames, the world skips frames. Any `setControl`,
`grab`, `setForce` or `restore` wakes it. The decision depends only on state, so replays stay
bit-identical.

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
| `STRAIN_LIMIT` / `STRAIN_PASSES` | 0.45 % guard target (keeps measured stretch below 0.5 %) / 4 | `inextensible`, `mesh-sweep` |
| `MEMBRANE_CAP_LENGTH` | 1e7 mm | `inextensible`, E1 (stability of the Newton step) |
| `MEMBRANE_COMPRESSION` | 0.05 | `E1-peirce` (membrane locking) |
| `CONTACT_PASSES` | 3 | `contact-stack` |
| `MODEL_COMPRESSION` | 0.25 | `E12-substeps`, `contact-stack` (Newton model never underestimates a stretched edge) |
| `SLEEP_SPEED` / `SLEEP_FRAMES` | 1e-5 mm/s / 30 | `E2-cantilever` (µm deflections settle before sleeping) |
| `PCG_MAX_ITER` / `PCG_REFACTOR_ITER` / `PCG_RTOL` / `REFACTOR_ANGLE` | 12 / 6 / 1e-3 / 0.3 rad | `E12-substeps` (equilibrium independent of these) |

## Board (corrugated and folding boxboard)

Board needs nothing the paper path lacks:

- **Caliper** sets the contact gap (`collision_thickness`; two different stocks touch at the mean
  of theirs).
- **Strong orthotropy** comes through the per-hinge D(φ) with `grain_deg`.
- **Machine scores** use the `score` treatment with `score_factor` and `score_yield_deg`.

Test `board` checks a 4 mm corrugated-like stock (D 2 / 0.67 N·m):

- the cantilever drop is within 1.4 % (MD) and 4 % (CD) of small-deflection theory, and the
  CD/MD ratio is 2.92 against an expected 3;
- a scored flap folds to 89.86° for a 90° target;
- a stack rests at a 3.99 mm gap for a 4 mm caliper.

Two limits apply:

- Tier R uses zero-thickness kinematics. Offset-panel thickness accommodation (Tachi 2011;
  Chen, Peng & You 2015) is not implemented, so thick-board rigid folds close with an overlap of
  about one caliper at 180°.
- Tier C hinges sit on the mid-surface. A 7 mm board's fold-around-a-score geometry (the inner
  liner buckling, the outer liner wrapping a radius of about t) is not resolved; the score acts as
  a soft hinge.

## Performance (this Mac, Node 20, S = 20)

| case | measured |
|---|---|
| any world at rest | about 0 ms/frame (asleep) |
| A5 page turn, 1138 vertices | about 320 ms/frame while turning |
| kinematic Miura, 1285 vertices | 21 ms/frame |
| folding a 726-vertex sheet | about 170–240 ms/frame |
| folding an 1838-vertex sheet | about 680–820 ms/frame |

**Studio interactive options** (mesh edge from the sheet area, 8 substeps; backlog item 22,
`node packages/engine/test/helpers/perf-docs.js <docs>`; best mean of 5 interleaved runs per side,
this Mac, Node 20, under load from other jobs, so treat ±10 % as noise):

| document | V | before (origin/main) | after | change |
|---|---|---|---|---|
| page-turn (default) | 424 | 24.8 ms/frame | 24.2 | ≈ 0 |
| valley-fold (default) | 449 | 37.1 | 34.5 | −7 % |
| v-fold-popup (spread) | 477 | 13.6 | 11.6 | −15 % |
| papel-picado-banner (default, in wind) | 1955 | 248.3 | 127.9 | −48 % |

What was measured first (CPU profiles): the triangular solves inside PCG (≈ 25 %) and the
numeric factorisation (≈ 18 %) lead on single sheets; on the banner the contact broad phase led
(44 % in the per-candidate sphere test alone). The change: triangle bounding spheres once per
broad phase and a typed-array cell table (same candidates in the same order, so results are
bit-identical), and no allocation inside the factorisation's inner loop (bit-identical). What did
not pay: minimum-fill ordering is within 2 % of the current minimum-degree fill on these meshes
(so AMD or nested dissection would not either); the symbolic analysis is already done once per
World; the solve and factorisation already run at about 1.3 and 2.3 GFLOP/s, the scalar limit of
plain JavaScript, so a supernodal layout would add little without SIMD; raising or lowering the PCG
refactor threshold (3–12 iterations) was slower than today's 6. The next step is WASM SIMD or
WebGPU (out of scope here).

The < 8 ms/frame target is not met for moving sheets above a few hundred vertices. The
factorisation and the triangular solves dominate (block Cholesky in plain JavaScript). Ways to
get interactive rates:

- `meshEdge` 8–10 mm;
- `substeps` 8 (equilibria do not depend on S, test `E12-substeps`);
- later, a supernodal factorisation or a WebGPU path.

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
