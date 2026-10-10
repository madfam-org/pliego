# The Pliego kernel — `pliego` (pure-stdlib Python)

> Last Updated: 2026-10-10
> Boundary: public-safe design document. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

`packages/kernel` (distribution `pliego-kernel`, import `pliego`, `AGPL-3.0-only`,
`dependencies = []`, Python ≥ 3.11) is the authoring and verification half of Pliego. Cartridges
(`projects/<slug>/main.py` in the `sheet-hyperobjects` commons) call it to build sheets, crease
patterns, cuts, assemblies and fold programs; it writes [sheet documents](../spec/v1/sheet-document.md)
and fabrication files, and it is the **single source of truth** for the paper-stock → physics mapping.

It follows the style of Fashion Cabinet's `fc` pattern kernel (MADFAM's 2-D garment kernel): `from __future__ import annotations`, full type hints, `@dataclass` value
types, mm / degrees / y-up, `EPS = 1e-4` mm, ruff line length 100 (`E,F,W,I,UP,B`), fail-loud
construction, verify-issue dicts `{level, kind, detail}`, a read-proof summary line, and a hard
**byte-determinism contract** (authored order, fixed rounding, `math.fsum`, explicit tie-breaks, no
randomness, no timestamps). Code adapted from FC (`geometry.py`, `piece.py`, `pattern.py`, the PDF/DXF
writers) is AGPL-3.0 from the same owner; keep a one-line provenance comment at the top of each
adapted module.

**No 3-D solid kernel, ever** (no OCCT/CadQuery/trimesh imports — solids belong to yantra4d and are
referenced through `hardware_ref`); the compliance lane enforces it.

---

## 1. Modules

| Module | Responsibility |
|---|---|
| `geometry.py` | `Vec2` (frozen), `Line`, cubic `Bezier` with adaptive `flatten(tol)`, arcs, `offset_ring` (per-segment distances: glue tabs, bleed, kerf), polygon area/orientation/point-in-polygon, segment intersection with a tolerance model, polyline simplification. Adapted from FC `geometry.py`. |
| `exact.py` | rational predicates with `fractions.Fraction`: orientation, intersection, and the **exact local Kawasaki test** (product of rational reflection matrices = identity — rsE §a6) for crease directions with rational slopes. |
| `arrangement.py` | planar subdivision of a sheet: outline + holes + crease/score/perforation segments + slits → split at intersections with snapping (grid `GRID_MM` = 1e-6 mm, a documented constant), merge overlaps by priority (cut > crease > score > perforation > flat), DCEL, faces, hole bridging with `J` edges so every face is simple; Euler check V − E + F = 1 + components. Bridging (`arrangement_dcel`) runs in batched passes: every hole gets two J edges at once (the nearest visible bridge, then one from its farthest vertex to another target) and attaches only to its host face or to holes already attached, so neighbouring holes leave no J-only slivers. Identical sheets share one subdivision (bounded cache keyed on exact geometry). |
| `sheet.py` | the authoring API: `Sheet(id, outline, stock, grain_deg, label, front, back)` with `.crease(a, b, kind="valley", angle=180, treatment="crease", *, name=None, rest=None)`, `.mountain(...)`, `.valley(...)`, `.score(...)`, `.perforate(...)`, `.cut(polyline, name=)`, `.hole(polygon)`, `.tab(edge, width, taper, name=)`, `.label_edge(name, a, b)`, `.art(front=..., back=...)`, `.copy(new_id)`; `.build()` → arrangement → per-sheet FOLD arrays. `name=` / `label_edge` / `tab(name=)` → `pliego:edges_name` (kebab slugs, shared names allowed, conflicting names fail the build); `rest=` (magnitude, signed by `kind`; signed as given for flat lines) → `pliego:edges_restAngle` (pre-creased sheets). Face colours left unauthored (`Face(color=None)`) inherit the stock snapshot's `appearance`. |
| `assembly.py` | `Assembly(sheets, joins, mechanisms, controls, sequence, initial_frame)`; join builders `glue(...)`, `pivot(...)`, `string(...)`, `pin(...)`, `slider(...)`; mechanism builders `hinge(...)`, `slide(...)`, `rotate(...)`, `leaf(...)`; layout of sheets side by side in the layout frame. |
| `document.py` | `Document` — the in-memory sheet document; `to_json()` (canonical, byte-stable), `from_json()`, `digest()` (GOC-1 compatible sha256), `verify()` implementing spec §8, `summary()` (read-proof line + counts). |
| `foldfile.py` | FOLD 1.2 import/export: plain FOLD files (Origami Simulator, ORIPA exports, flat-folder) load with spec §7 defaults; export strips nothing (pliego: fields are legal FOLD custom fields). |
| `flatfold.py` | local flat-foldability: Maekawa (|M − V| = 2), Kawasaki–Justin (exact via `exact.py` when slopes are rational, else float within the per-vertex grid bound Σ √2·`GRID_MM`/Lᵢ — `KAWASAKI_TOL_RAD` = 1e-6 rad is that bound for degree-4 creases ≥ 5.7 mm), big-little-big lemma; flat-folded vertex positions via the face tree (reflections); local layer-order constraints (taco/tortilla) → `faceOrders` for small patterns; issues as verify dicts. |
| `kinematics.py` | Tier R reference (float64): face-tree pose from fold angles; degree-4 closed forms (Foschi–Hull–Ku); Miura-ori closed form; loop-closure residuals (`closure_residual(..., relative=)` in mm or per sheet diagonal, `vertex_residuals` in rad per vertex, `snap_angle_rad` the grid floor); DOF via a small dense SVD in stdlib. Re-exports the motion solver. This is the **arbiter** the engine's Tier R tests compare against. |
| `motion.py` | the Tier R motion solver `kinematics.solve(system, start, drive, fixed=(), steps=16, along="drive"\|"chord") → KinematicPath` (§4), `vertex_folds(rays, previous=None, sectors=None)` (signed dihedrals from world rays, the kernel's sign convention), `vertex_residuals`, `KinematicsError`. |
| `program.py` | `Sequence.kinematic_path(sheet, key_steps, start=, substeps=)`: key-pose `Step`s → exact rigid substeps (chord continuation), honouring spec §5.6 step semantics; `EdgeRef(sheet, edge)` step targets. |
| `linalg.py` | stdlib dense linear algebra for Tier R: Cholesky, damped least squares, one-sided Jacobi SVD with right singular vectors, min-norm solves. |
| `params.py` | `pliego.param(get, default)` / `pliego.clamp(value, lo, hi)` — the cartridge accessors, at the package top level (sandbox-reachable). |
| `axioms.py` | Huzita–Justin axioms O1–O7 as constructions returning `Line`s (authoring helpers: "fold this point to that line through that point"). |
| `simplefold.py` | the simple-fold model: a folded state = stack of layers (polygon of the original sheet + affine transform + order). `fold(line, direction, layers="all"|"top"|n)` splits layers by the fold line's pre-image, reflects the moving part and restacks it; `unfold()`. Produces step-by-step diagram frames and the crease pattern of the folds made. |
| `foldcut.py` | **fold-and-cut**: after simple folds, `cut(region_in_folded_frame)` removes every point of the sheet whose folded image lies inside the region — computed by mapping the region's boundary back through every layer into the arrangement and classifying faces (kept/removed) by mapping their centroids forward. Exact for polygonal regions. Powers papel picado, jianzhi, snowflakes, kirigami cards. |
| `papercut.py` | papercut validation: kept regions are connected (or intentionally separate), minimum bridge width ≥ the stock's `min_feature_mm`, no slivers below the cutter's minimum, island report; motif primitives (petal, circle, diamond, scallop, zig-zag border, lattice) and symmetry generators (n-fold wedge, mirror, accordion repeat). |
| `pieces.py` | removable pieces and stacks (spec §5.8): `piece(id, sheet, at= \| faces=, role="keep"\|"excess", pull=)` and `stack(id, sheets, pitch_mm, represents=, bond=, binding=)` builders for `Assembly(pieces=, stacks=)`; `Step(remove=[…])` takes excess pieces out; separable regions (faces connected across non-separating edges — `B`, `C` and kiss-cut `F` separate); verify rules §8.11 (pieces, removal) and §8.12 (stacks). |
| `reveal.py`, `reveal_scene.py` | reveal blocks (memo-block sculptures): scenes — `heightfield(h)` and a small CSG (`sphere`, `box`, `cylinder`, `cone`, `union`, `intersect`, `subtract`, negative inside) — and `slice_block(scene, size=, height=, layers=, stock=, fabrication=, min_feature=, tear_grid=, contour=, tear=)`: per layer, the mask at mid-layer height is opened and closed at the minimum feature, kept `margin` from the edge, traced by marching squares (saddles by the cell centre), simplified and cut; a perforated tear grid splits the excess; every separable region becomes a keep/excess piece; the sheets form a stack at `represents × caliper` and the program removes the excess top-down. A preview sheet stands for `represents` real sheets; `fabrication=True` slices every real sheet. `bridge_report` samples `papercut.analyze`. |
| `tessellate.py` | generators: Miura-ori, Yoshimura, Kresling, waterbomb, square twist, hexagonal twist, Resch-type, accordion — each returns a sheet with M/V assignment and target angles, plus the closed-form 1-DOF angle law where one exists. All original geometry (no copied third-party crease patterns). |
| `popup.py` | paper-engineering generators: V-fold, parallel (box) fold, floating layer, step fold, tent, 90° origamic-architecture cut-fold; each returns an `Assembly` (base spread with gutter + pieces + glue joins + `hinge` mechanism on the spread + `open` control) and its kinematic initial frame; closure checks (lies flat at 0° and 180°, no lock). |
| `book.py` | book structures: leaf (one page hinged at a spine — the simplest object in the commons), codex of N leaves, accordion/leporello, screenfold codex, tunnel book (two leporello walls + layered frames), carousel; `leaf` mechanisms and page-turn controls. |
| `stock.py` | paper stock cards: load `materials/<slug>/stock.json`, validate, and `derive(card) -> dict` — the **only** implementation of the measurement → physics mapping (spec §5.2 keys, engine units), plus the optional `G12` (0.387·√(E_md·E_cd), Baum), `score_yield_deg` (crease yield × score factor) and the card's `perf_cut_mm` / `perf_bridge_mm`. Measured values win; documented estimates otherwise (rsE §b formulas: Baum relations, `D = E t³/12(1−ν²)`, `L* = 200 t` hand crease / 50–100 t scored, yield 35°). `snapshot()` adds the card's `appearance {front, back}`. `derived_basis` names the version. `python -m pliego.stock` imports cleanly (kernel-gen modules load lazily, PEP 562). |
| `export/svg.py` | layered SVG: `cut` (outline + cuts), `mountain`, `valley`, `score`, `perforation` (dash = cut length / bridge), `glue` (tab hatching), `art`, `registration` (print-then-cut corner marks), `label`; laser-friendly colour convention selectable (`--palette lightburn|cricut|diagram`); mm units, viewBox in mm. |
| `export/dxf.py` | DXF R12, named layers `CUT`, `MOUNTAIN`, `VALLEY`, `SCORE`, `PERF`, `GLUE`, `TEXT`, `$INSUNITS = 4`. Adapted from FC `export/dxf.py`. |
| `export/pdf.py` | hand-written PDF 1.4 (adapted from FC): 1:1 tiling on A4/Letter/A3/A0 with alignment crosses and tile ids, plus print-then-cut registration marks; mountain/valley line styles per origami diagram convention. |
| `export/hpgl.py` | HPGL for plotters/cutters: `SP` pen per pass (score pass before cut pass), `PU`/`PD` in plotter units (40 units/mm), path ordering inside-out (cut inner features before outer). |
| `export/glb.py` | glTF 2.0 binary of a 3-D state (the `initial` frame or a kernel-computed folded state): two-sided materials (front/back colours), per-sheet meshes; optional morph targets for a kinematic fold program. Stdlib only (struct + json). |
| `export/fold.py` | `.fold` writer (thin wrapper over `document.to_json`). |
| `cartridge.py` | the `result` contract checks and the `python -m pliego.cartridge` CLI (re-exports `param` / `clamp`). |

---

## 2. Cartridge contract (as in the commons)

`<slug>/main.py`, `<slug>/project.json`, `<slug>/docs/README.md`. The runner (in `apps/api`, built
on the shared `commons_sandbox`) injects `pliego` and `math` as the only importable modules, injects
parameters and `mode` (the mode id) as bare globals — both the API runner and the CLI, the mode
winning over a parameter of the same name — executes the script, and reads `result` — a
`pliego.Sheet`, `pliego.Assembly` or `pliego.Document`. Scripts read parameters through an
accessor with a default so they also run standalone — `pliego.param` / `pliego.clamp`, or a local
copy:

```python
def PARAM(get, default):
    try:
        return get()
    except NameError:
        return default

size = PARAM(lambda: size, 150.0)           # noqa: F821
stock = PARAM(lambda: stock, "kami")     # noqa: F821

sheet = pliego.Sheet("square", pliego.square(size), stock=stock,
                     label={"en": "Square", "es": "Cuadrado", "fr": "Carré", "pt": "Quadrado"})
sheet.valley((0, 0), (size, size), angle=180)
result = pliego.Assembly([sheet], controls=[pliego.sequence_control()],
                         sequence=pliego.Sequence.fold_each())
```

The runner always prints `verify: sheets=N vertices=V edges=E faces=F joins=J errors=E warnings=W`
and exits 1 on any error. The standalone CLI `python -m pliego.cartridge <dir>` (used by the commons
CI) prints one line per run: `verify: cartridge=<slug> mode=<mode> …` for defaults and
`verify: cartridge=<slug> mode=<mode>:<preset> …` for each preset, and exits 1 on any error or when
zero runs happened.

---

Generators (`popup`, `book`, `tessellate`) never write `pliego:meta.cartridge`; the runner and the
CLI set it. `Assembly(..., min_feature_mm=…)` writes `pliego:meta.min_feature_mm`, and `verify()`
then floors face areas at its square (spec §8.3; an explicit `verify(min_face_area_mm2=)` wins).
The floor applies per **material face**: faces joined across `J` edges count as one region, since
`J` edges are artificial splits (spec §2).

---

## 3. Tests (`pytest packages/kernel/tests`)

- **Geometry and arrangement:** intersections with tolerance; Euler characteristic on random
  arrangements; hole bridging yields simple faces; overlap priority.
- **Flat-foldability:** Maekawa/Kawasaki/BLB on known flat-foldable vertices (square twist,
  waterbomb base, preliminary base, Miura) and on perturbed non-flat-foldable ones; exact rational
  Kawasaki agrees with the float version.
- **Kinematics:** degree-4 closed forms — vertex α = (70, 80, 110, 100)°: mode 1 at ρ1 = 90° gives
  |ρ2| = 29.13°, mode 2 at ρ2 = 90° gives |ρ1| = 10.31° (rsE E5); Miura Poisson ratio
  ν = −cos²θ·tan²γ (E6); face-tree pose preserves edge lengths (developability) to 1e-9.
- **Motion (`test_motion.py`):** solved degree-4 paths from flat stay on the closure manifold
  (< 1e-9 rad) and match both Foschi–Hull–Ku modes, the branch picked by drive sign × M/V; a
  4 × 4 Miura sheet folded from flat matches its closed form (1e-5°); the c2 commons programs
  (inside reverse fold, rabbit ear, squash) are reproduced; `vertex_folds` inverts a pose; the
  hex twist passes `flatfold.check` with the grid-derived tolerance.
- **Simple folds and fold-and-cut:** folding a square in half twice and cutting a disc at the corner
  yields the expected symmetric holes; papel picado wedge symmetry (n-fold) is exact; every kept
  region is connected.
- **Pop-ups:** V-fold and parallel fold close flat at 0° and 180°; the initial frame satisfies every
  glue weld within `collision_thickness`.
- **Stock:** `derive()` matches hand-computed values for copy paper 80 g/m² (rsE §a4 worked example:
  `D_md ≈ 5.0e-4 N·m` → `5.0e5` engine units); every committed `materials/*/stock.json` `derived`
  block equals a fresh `derive()` (drift gate, `--check`).
- **Documents:** `verify()` rejects each §8 violation with a precise issue; round-trip
  `from_json(to_json(d)) == d`; byte-determinism under ±1e-9 mm input noise and shuffled authoring of
  independent sheets (FC `flats.py` contract).
- **Exporters:** golden files (byte-exact) for a fixed small document per format; SVG/DXF layer names
  and colours; PDF tiles cover the sheet; GLB parses (header, JSON chunk, BIN chunk, accessor bounds).

---

## 4. Tier R motion (`pliego.kinematics.solve`, kernel 0.2)

`solve(system, start, drive, fixed=(), steps=16, *, along="drive")` — `system` is an
`Arrangement`, a `Sheet` (keys may be its `Mark`s) or a `Document` (global edge indices); angles
in degrees; unlisted creases start at 0. Variables are the M/V/U creases (plus any F line a caller
names). Each interior vertex closes `F_v = R(d₁, ρ₁)⋯R(d_k, ρ_k) = I` (creases met
counter-clockwise, the `face_transforms` sign convention); residual `vee(log F_v)` in rad,
Jacobian columns ℓᵢ (rsE §a2). Per substep: the minimum-norm solution of the linearised closure
(null-space projection of the drive), then Levenberg–Marquardt damped least squares — λ starts at
1e-3 (C's columns are unit vectors, so its singular values are O(1)) and shrinks ×10 per accepted
step to 1e-12, which bounds the update at the flat singularity. At planar vertices (flat or
flat-folded, every ℓᵢ coplanar) the second-order tangent cone (in-plane linear constraint plus
`n·½Σ_{i<j} vᵢvⱼ(ℓᵢ×ℓⱼ) = 0` per vertex) yields the branches; each is followed by Newton and the
one whose free creases fold most consistently with σ·(their M/V sign) wins, σ = sign of the
drive × the drive crease's M/V sign (ties: least motion). `along="chord"` is pseudo-arclength
continuation toward a known end state (all driven creases free, progress measured along the
start → target chord) — even sampling where a crease races near a flat-folded end.

The result is a `KinematicPath` (a list of `{edge: deg}`, start excluded) with `dof`, `free_dof`,
`max_residual_rad` and `branch_steps`. Acceptance: Newton aims for 1e-13 rad; a state is accepted
below max(1e-10 rad, the worst vertex's snapping floor Σ √2·`GRID_MM`/Lᵢ) — a vertex snapped off
exact flat-foldability cannot close exactly at its flat-folded state. `KinematicsError` is raised
when the start does not close, when the drive leaves the rigid configuration space (no closed
state near the path) or when a crease would pass ±180°. Loops around holes are not constrained
(vertex loops only).

`Sequence.kinematic_path(sheet, key_steps, start=None, substeps=8)` expands key-pose `Step`s into
exact rigid substeps: unlisted creases hold (they are `fixed`), released creases become free, the
listed creases advance by chord continuation and must arrive at their targets (within 1e-5°). The
program starts from `start` (the initial frame's angles, `{mark: deg}` or `{"angles": …}`) or
from flat; the returned sequence is `kinematic` and carries `.report`.


## 5. Layer-ordered flat states and layer-aware folding

The rigid programs of §4 fold whole crease patterns. Traditional models (the crane, the flapping
bird) need operations on *chosen layers* of a flat-folded state — narrowing a flap, reversing a
neck, squashing or petal-folding one face — and a layer order that stays physical. These modules
provide that, from a convex sheet, without a crease pattern to start from:

| Module | Responsibility |
|---|---|
| `flatstate.py` | `FlatState`: the faces made so far (convex sheet-frame polygons sharing a point list), each face's placement in the folded frame (a plane isometry, det −1 = turned over) and the **complete layer order** of every pair of faces whose images overlap (FOLD `faceOrders` semantics). Crease angles follow from it (0 flat, ±180 valley/mountain by layer parity). `unfold()` returns the crease pattern on the flat sheet as a `Sheet` (M/V from the state, `F` for creases left open); `turn_over()`, `rotate()`, `faces_at()`, `vertex_near()` (snap lines to exact vertex images). |
| `flatcheck.py` | validity: placement agreement across every crease; a total order per cell of the overlay of all face images (transitivity); taco-taco, taco-tortilla and tortilla-tortilla as parity constraints (XOR of "above" literals, Bern & Hayes 1996); Kawasaki / Maekawa / big-little-big via `flatfold`. `solve()` completes a partial order: Gaussian elimination over GF(2) on the unknown pairs, free choices from a hint, transitivity checked per cell. |
| `flatops.py` | `Move`-returning operations (lines and points in the folded frame): `fold(line, "valley"\|"mountain", at=, layers=, faces=, sheet_points=, from_=)` through all layers on one side or a selected flap — the picked layers plus every layer joined to them on that side without crossing the line; refused when another layer lies in the way (it would pass through the flap). `crease` (the same creases, no motion), `crease_and_unfold`, `subdivide`, `halves` (a flap's front and back halves at its spine). Lines that graze a vertex of a layer they cut (closer than 0.05 mm) are refused. |
| `flatcompound.py` | `reverse_fold(kind="inside"\|"outside")` (refused when the tip would cross the flap's folded edge), `squash` (the top flap stood on its hinge and pressed symmetric about it), `petal` (the top layer's petal up about K₁–K₂, the sides in along the kite lines, the layer under each side opening flat and folding along the axis of R_h ∘ R_k ∘ R_e — the kite line on a square flap, another line on a squashed preliminary flap), `rabbit_ear`. Layer orders between moving groups come from the side each face arrives from in the move's own rigid motion, completed and checked by `flatcheck`. |
| `flatmotion.py` | each move's 3-D motion as rigid face groups: one rotation for a fold; the squash, the petal fold and the rabbit ear as spherical linkages around their vertex (exact, branch-tracked); the reverse fold as candidate paths (a rigid flap cannot reverse with its root closed — the two modes of the reverse-fold vertex meet only at the open flat flap). |
| `foldprogram.py` | `FoldProgram`: record moves the way a diagram reads (`fold`, `crease`, `crease_and_unfold`, `unfold_last`, `reverse_fold`, `squash`, `petal`, `add`, `turn_over`, `rotate`, then 3-D `hinge`/`hinges` poses about existing creases — flaps picked by layers or as the n-th leaf of a book); `build(id, start_after=)` → `Built` with the unfolded `Sheet`, a `physical` `Sequence` whose substeps are fitted to what the studio preview can draw, `final_angles` / `pose_angles`, `face_orders()` (complete `faceOrders` on the pattern's faces), `initial()` (an exact initial-frame spec for programs that start from the finished model), `target()`, and a per-step report (`tear_mm`, `mid_tear_mm` between samples, `deviation_mm`). |
| `preview.py` | `PreviewTree`: a replica of the studio preview's face tree (`apps/web/studio/src/engine-stub.js`: breadth-first from face 0 through M/V/F/U/J edges, same rotation convention; the stub additionally clamps display angles at ±179.5°). `pose`, `fit` (tree-edge angles that draw each face closest to its intended pose), `tear`, `deviation`. Cross-checked against the stub to 0.0000 mm. |

Fidelity of the preview, per move: simple folds exact (one rotation per step); squash, petal and
rabbit ear exact at every sample, samples refined until the linear blend tears < 0.5 mm; reverse
folds approximate — the best of several rigid paths in the preview's own tree, typically the tip
turned as one stack with its back half flipping inside in the last sub-step, reported per step.

`flatfold.vertex_report`: big-little-big compares sectors beyond the grid-snapping bound (the
per-vertex Kawasaki tolerance in degrees), so equal sectors built from snapped points (which
differed by ~1e-6°) are no longer reported as a strictly smallest sector.

<!-- FL2 (wave 3, flat operations) begin -->
**Wave-3 flat operations (lane FL2).**

- **Preimage.** `FlatState.layers_at(q, faces=None)` lists the layers of paper at a folded point,
  bottom → top, as (face, sheet point); a point on a crease or an edge counts each layer once.
  `FlatState.preimage(q, layer="top" | "bottom" | index, faces=None)` is the sheet point under q on
  that layer (negative indices count from the top), the inverse of `to_folded` for that layer;
  `layer_index(sheet_point, q=None)` is the converse. Cartridges compute crease seeds and
  `sheet_points` selections with it instead of copying the placement algebra.
- **Cuts** (`flatcut.py`). `cut(state, (p0, p1), at=, layers=, faces=, sheet_points=, from_=)`
  cuts along a folded segment through every layer it crosses, or the layers picked at `at` (and
  the same layers where they continue flat along the segment); each cut layer's part of the
  segment is mapped back through its placement (the pre-image mapping of `foldcut`, one segment
  per layer). `FlatState.cuts` holds the slits (sheet frame): their faces are not joined — no
  crease, no placement or layer constraint, no flap selection across them — and `unfold()` writes
  them as `C` cuts. Faces are split along the slit's whole line to stay convex; where a slit ends
  inside a face the rest of the line is a **seam** (`FlatState.seams`: joined flat, no line on the
  sheet) until a move folds it (`FlatState.creased`; a crease from then on). `FoldProgram.cut(...)`
  records it as a step with no targets (the document's slits exist from the first frame).
  `Built.face_orders()` keeps its meaning; for sheets with slits each pattern face is the union of
  the state faces inside it. The preview's `tear` ignores slit edges (their sides part).
  Hinge poses now take the paper joined to the picked layers without crossing the line's creases,
  even where it lies past the line in the folded image (a wing folded back across the keel); the
  side-of-line rule remains the fallback when that reaches the whole model. Today a slit's two
  sides share their end vertices on the flat sheet, so a target frame that opens a slit (a trimmed
  tab) is drawn with those vertices on one side; when `Sheet.cut` splits cut vertices, it is exact.
  Cutting along an existing crease is not supported (the segment must cross the paper).
- **Vertex moves** (`flatvertex.py`). `star(state, center)` reads the linkage at the sheet vertex
  under a folded point: its rays (counter-clockwise on the flat sheet), the sector each wedge
  carries (the wedge and every face joined to it without crossing a crease on a ray's folded
  image; layers stacked at the vertex but hinged only on rays — a blintzed corner whose tip sits
  on it — join the sector whose wedge they lie in) and the rays' fold angles.
  `collapse(state, center, folds, fixed=)` folds the listed rays flat at once (`folds`: sheet
  direction in degrees or a sheet point on the ray → `"valley" | "mountain" | "flat"`, crease-
  pattern sense; unlisted rays hold): placements compose the reflections across the folded rays
  (Kawasaki closes them or the move fails), the layer order is solved from the side each face
  arrives from in the 3-D motion and checked, and every ray must end with its asked sign. The
  3-D path (`VertexPath`, n − 3 DOF for degree n) is the start → target chord in angle space
  projected onto the rigid configuration space: `kinematics.solve(..., along="chord")` on the
  vertex's star picks the branch at the flat or flat-folded start and seeds each sample, which
  is then the closed state nearest its chord point; poses between samples are the nearest closed
  state to the chord too. A symmetric start and target therefore give a symmetric path (the
  waterbomb collapse is mirror- and diagonal-symmetric to 1e-13°). `FoldProgram.collapse(...)`
  records it; `FoldProgram.vertex_pose(sid, label, center, {ray: deg})` drives the same linkage
  to fold angles off flat as a 3-D pose step (the fortune teller shaped, opened, closed), from
  this vertex's previous pose; vertex poses come before `hinge` poses. Fidelity: exact at every
  sample (tear and deviation ~1e-13 mm); the preview's linear blend between samples tears up to
  0.5 mm after refinement. Proven on the waterbomb base, the preliminary base (one collapse: the
  midlines valley, the diagonal through the open corners mountain, the other diagonal flat), the
  jumping frog's degree-6 head and the fortune teller's degree-8 vertex.
  `foldpattern.py` holds the pattern-side helpers (`face_points`, `edge_angles`, `face_orders`),
  re-exported by `foldprogram`.
<!-- FL2 (wave 3, flat operations) end -->

Tests: `test_flatstate.py`, `test_flatcompound.py` (bird base and frog base by operations — layer order,
crease parity, four-fold symmetry — and a crane valid at every vertex), `test_foldprogram.py`; sequences in
`tests/flat_models.py`.

---

## 6. Papercraft: `pliego.mesh` and `pliego.unfold` (mode J2)

| Module | Responsibility |
|---|---|
| `mesh.py` | `Mesh(vertices, faces)`: counter-clockwise faces seen from outside, a consistently oriented 2-manifold that may be open (`check()` fails loud otherwise, and `net()` refuses an inside-out closed mesh). Primitives: `box`, `icosahedron`, `icosphere(n)`, `uv_sphere`, `lathe(profile, segments, closed=…)` (vases, gems, rings; a closed profile makes a torus-like ring), `torus`, `prism(profile, depth)`. Operations: `extrude(mesh, face, distance, shrink)` (0 makes a pyramid), the affine maps `scaled`/`moved`/`rotated`, `mapped(fn)` for any deformation (`net()` triangulates faces it bends), and `merged` for disjoint parts. No booleans and no volumes: these are polyhedral surfaces, not a solid modeler (§1). |
| `unfold.py` | `net(mesh, size, page, margin, method, tabs, tab_height, tab_angle, label_size) → Net`. It scales the mesh to `size` mm on the ground, then builds the cut tree greedily: Kruskal over the dual graph in `min-perimeter` order (long edges first) or `steepest-edge` order (Schlickenrieder's steepest-edge cut tree, with its cuts tried last). A join is accepted only if the joined piece stays overlap-free (inset-triangle separating axes plus a pinch test), keeps a tab zone free beside every open edge, and still fits the printable page. Edges never joined are cuts, so nets that would overlap split into islands. |
| `unfold_layout.py` | Cut numbering (island order), one glue tab per cut, alternating sides by number: a trapezoid or triangle within the side-angle limit, inside the footprint of the face it glues under, never overlapping its net or its other tabs. Edge numbers on both sides of each cut. Pages: each island is rotated to fit, preferring a turn that makes its root face the arrangement's face 0, then shelf-packed onto A4 or US Letter pages. |
| `unfold_build.py` | `Net.assembly(mode)` writes one sheet per island, laid out on its page (`pliego:pages`) and carrying its numbers (`pliego:annotations`, spec §5.12). Fold lines are the tree edges and the tab hinges; their mountain or valley assignment and angle come from the signed 3-D dihedral, with the printed side outside. Fold lines are `score` on card stock and `crease` otherwise (`fold_lines=`). Mode `fold` is a kinematic program (the tabs, then one step per piece) with the assembled model as a `target:assembled` frame. Mode `glued` puts the assembled model in the initial frame, adds a glue join under every tab, gives every crease its fold angle as rest angle (the card is pre-folded before gluing), and lets go of every crease in a physical program. |

**Exactness.** An island's crease pattern is a tree of hinges with no interior vertex: each mesh
vertex inside an island keeps at least one cut. Any assignment of fold angles is therefore rigid
and closes, and the kinematic program is exact. The face-tree pose holds the arrangement's face 0
still, so each sheet's `placement` maps face 0's flat position onto its pose in the model. Folding
every crease to its target then rebuilds the model; the tests check this to 1e-4 mm. The glued
mode's welds pass §8 rule 9.

**Preview limits.** The fold-up is kinematic. Each piece folds in place about its face 0 and
starts flat in that face's plane. There is no control that carries flat pieces in from a table:
`translate`/`hinge` move only rigid (kinematic) sheets (§5.4), and a folding piece is not rigid.
The glue welds, the paper's springback against them, and settling need the physics
engine. In the preview, the glued mode shows the finished model standing still.
