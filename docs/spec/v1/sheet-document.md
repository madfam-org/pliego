# Sheet document v1 — the contract between kernel, engine, exporters and the keystone

> Last Updated: 2026-10-10
> Boundary: public-safe specification; no operational detail. Policy:
> [`../../PUBLIC_REPO_BOUNDARY.md`](../../PUBLIC_REPO_BOUNDARY.md).

A **sheet document** is the single artifact every Pliego component speaks:

- the Python kernel (`packages/kernel`, import name `pliego`) **writes** it from a cartridge;
- the engine (`packages/engine`, `@pliego/engine`) **loads** it and simulates it (kinematics + physics);
- the exporters read it to emit SVG / DXF / PDF / GLB / HPGL;
- the keystone (`pliego-spec` in hyperobjects-spec) validates it.

It is a **FOLD 1.2 file** (Demaine, Ku, Lang — the `.fold` JSON format) with additional fields in
the `pliego:` namespace. Any FOLD reader can open the crease pattern; any FOLD 1.2 file can be loaded
by the engine (missing `pliego:` fields take the defaults in §7).

Machine-readable schema: [`packages/schemas/sheet-document.schema.json`](../../../packages/schemas/sheet-document.schema.json).
The schema checks structure; the semantic rules in §8 are enforced by `pliego.document.verify()` in
the kernel and by `loadDocument()` in the engine (both fail closed).

---

## 1. Units, frames and conventions

| Quantity | Unit | Notes |
|---|---|---|
| length | mm | every coordinate, thickness, offset |
| angle | degrees | in documents; the engine converts to radians internally |
| mass | g | stock `gsm` is g/m²; derived areal density is g/mm² |
| time | s (`duration_ms` in sequences) | |
| engine force / energy | g·mm/s² (µN) / g·mm²/s² (nJ) | derived physics is pre-converted by the kernel (§5) |

**Three frames.**

1. **Layout frame** — FOLD `vertices_coords` are 2-D in mm, y-up. Each sheet is laid out side by side
   so that **no two sheets overlap** in the layout frame (a FOLD viewer then shows every crease
   pattern legibly). Outer boundaries are counter-clockwise.
2. **Sheet-local frame** — `local = layout − sheet.offset`. Grain direction, printed art and joins
   are expressed in sheet-local coordinates. A sheet's local origin is its lower-left corner by
   convention.
3. **World frame** — 3-D, mm, **Y up** (glTF convention). Sheet-local `(u, v)` maps to the
   un-placed world point `(u, 0, −v)`, so a counter-clockwise sheet lying flat has its **front face
   pointing +Y**. `sheet.placement` (a rigid transform: rotation quaternion, then translation) maps
   un-placed points into the world. The ground plane is `y = 0`.

**Fold angle sign (FOLD convention).** `edges_foldAngle` is the deviation from flat, in degrees,
in `[-180, 180]`: **positive = valley** (the two faces rotate toward the front side), **negative =
mountain**. A flat sheet has fold angle 0 everywhere; a closed book's spine is ±180.

**Determinism.** The kernel emits byte-stable documents: authored order (never sorted by a hash),
coordinates rounded to 1e-6 mm, angles to 1e-6°, no timestamps, no random numbers. The engine
simulates deterministically: same document + same control timeline + same settings ⇒ bit-identical
state (see `docs/strategy/engine.md` §6).

---

## 2. FOLD fields used

| Field | Required | Meaning in Pliego |
|---|---|---|
| `file_spec` | yes | `1.2` |
| `file_creator` | yes | e.g. `"pliego-kernel 0.1.0"` |
| `file_title` | no | human title |
| `file_classes` | yes | `["singleModel"]` for one sheet, `["multiModel"]` for assemblies |
| `frame_classes` | yes | `["creasePattern"]` |
| `frame_attributes` | yes | `["2D"]` plus `"cuts"`/`"noCuts"`, `"joins"`/`"noJoins"` as applicable |
| `frame_unit` | yes | `"mm"` |
| `vertices_coords` | yes | 2-D layout coordinates `[[x, y], …]` |
| `edges_vertices` | yes | `[[a, b], …]` |
| `edges_assignment` | yes | `B` boundary · `M` mountain · `V` valley · `F` flat (a line that is drawn/scored but not folded in the target state) · `U` unassigned · `C` cut (both sides are boundary; the sheet is separated along it) · `J` join (an artificial edge that splits a face so every face is simply connected — never drawn, never folded) |
| `edges_foldAngle` | yes | target fold angle in the **final** state of the fold program; `0` for `B`/`F`/`C`/`J`/`U` |
| `faces_vertices` | yes | counter-clockwise vertex cycles; every face is a simple polygon (no holes — holes are bridged with `J` edges) |
| `faces_edges` | no | if present must agree with `faces_vertices` |
| `edges_faces`, `vertices_vertices`, `vertices_faces` | no | derived; readers recompute them |
| `file_frames` | conditional | 3-D frames (§6) |

`edges_assignment` is the **design** intent. The physical treatment of each line (how it was made)
is separate (`pliego:edges_treatment`, §4), because the same mountain line can be a pre-creased
fold, a scored fold or a perforated fold, and they behave differently.

---

## 3. Top-level `pliego:` fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `pliego:version` | integer | yes | `1` |
| `pliego:vertices_sheet` | int[V] | yes | sheet index of each vertex |
| `pliego:edges_sheet` | int[E] | yes | sheet index of each edge |
| `pliego:faces_sheet` | int[F] | yes | sheet index of each face |
| `pliego:edges_treatment` | string[E] | yes | §4 |
| `pliego:edges_restAngle` | number[E] | no | plastic rest angle at t = 0 (crease memory), degrees; default 0 |
| `pliego:sheets` | object[] | yes | §5.1 |
| `pliego:stocks` | object | yes | stock snapshots keyed by stock id, each with its kernel-derived physics (§5.2) |
| `pliego:joins` | object[] | no | glue, pivots, strings, pins, sliders (§5.3) |
| `pliego:mechanisms` | object[] | no | drivers for kinematic sheets and drive points (§5.4) |
| `pliego:controls` | object[] | no | what the viewer exposes to the user (§5.5) |
| `pliego:sequence` | object | no | the fold program (§5.6) |
| `pliego:meta` | object | yes | provenance of this document (§5.7) |

---

## 4. Edge treatment

`pliego:edges_treatment[e]` ∈

| Value | Allowed assignments | Physics (engine) | Fabrication (exporters) |
|---|---|---|---|
| `none` | `B`, `J`, `U`, `F` | a boundary, an artificial join, or plain paper | not drawn (B is the cut outline of the sheet) |
| `crease` | `M`, `V`, `F` | hinge with crease stiffness; carries plastic memory | fold line (mountain/valley styles) |
| `score` | `M`, `V`, `F` | hinge with stiffness × `score_factor`; lower yield | score pass (blade/laser at reduced power) |
| `perforation` | `M`, `V`, `F`, `C` | hinge with stiffness × `perf_factor`; may tear under strain | dashed cut (cut length / bridge length from stock) |
| `cut` | `C` | separated: vertices are split along it | full cut |
| `halfcut` | `F` | plain paper (kiss cut does not change bending) | kiss cut (sticker sheets) |

The sheet outline (`B` edges) is cut by the exporters; `treatment` for `B` is `none`.

---

## 5. Objects

### 5.1 `pliego:sheets[i]`

```json
{
  "id": "base",
  "label": {"en": "Base spread", "es": "Pliego base", "fr": "Double page", "pt": "Página dupla"},
  "stock": "cardstock-250",
  "grain_deg": 90,
  "offset": [0, 0],
  "placement": {"origin": [0, 0, 0], "rotation": [0, 0, 0, 1]},
  "front": {"color": "#f4efe6", "art": null},
  "back": {"color": "#f4efe6", "art": null},
  "kinematic": null
}
```

- `id`: strict kebab case, unique in the document.
- `label`: i18n object; `en` required, `es`/`fr`/`pt` expected (the commons gate requires all four).
- `stock`: key into `pliego:stocks`.
- `grain_deg`: direction of the machine direction (MD, the grain) in sheet-local coordinates,
  degrees counter-clockwise from +u. Default 90 (grain runs "up the page", long-grain portrait).
- `offset`: layout-frame position of the sheet-local origin.
- `placement`: rigid transform applied after the `(u, v) → (u, 0, −v)` map; quaternion `[x, y, z, w]`.
- `front` / `back`: render appearance. `art` (optional) is a relative path to an image covering the
  sheet's local bounding box (front is drawn as seen from +normal; back is mirrored as paper is).
- `kinematic`: `null` for a physical sheet, or `{"mechanism": "<mechanism id>"}` when the sheet is a
  rigid board moved by a driver (book boards, the base page halves of a pop-up spread). A kinematic
  sheet's vertices have infinite mass and follow the mechanism's transform exactly.

### 5.2 `pliego:stocks[id]` — stock snapshot

A snapshot of the stock card (`docs/spec/v1/stock-card.md`) as used by this document, **including
the kernel-derived physics in engine units**. The engine reads `derived` and nothing else; the
mapping from paper measurements to physics exists in exactly one place (`pliego.stock.derive`).

```json
{
  "name": {"en": "Cardstock 250 g/m²", "es": "Cartulina 250 g/m²", "fr": "Bristol 250 g/m²", "pt": "Cartolina 250 g/m²"},
  "gsm": 250,
  "caliper_mm": 0.30,
  "derived": {
    "areal_density": 0.00025,
    "thickness": 0.30,
    "E_md": 6.0e9, "E_cd": 3.0e9, "nu": 0.3,
    "D_md": 1.62e7, "D_cd": 8.1e6,
    "crease_k": 3.2e6, "crease_yield_deg": 25, "crease_set_rate": 0.6,
    "score_factor": 0.35, "perf_factor": 0.2,
    "tear_strain": 0.015,
    "friction": 0.45,
    "collision_thickness": 0.30
  },
  "derived_basis": "pliego.stock.derive v1"
}
```

| `derived` key | Engine unit | Meaning |
|---|---|---|
| `areal_density` | g/mm² | `gsm × 1e-6` |
| `thickness` | mm | caliper |
| `E_md`, `E_cd` | g/(mm·s²) | in-plane Young's moduli (1 GPa = 1e9) |
| `nu` | — | in-plane Poisson ratio |
| `D_md`, `D_cd` | g·mm²/s² | bending stiffness for curvature along MD / CD (1 mN·m = 1e6) |
| `crease_k` | g·mm/s² per rad, per mm of crease | crease hinge stiffness per unit length |
| `crease_yield_deg` | deg | elastic range of a hinge before its rest angle starts to move |
| `crease_set_rate` | — (0–1) | fraction of the excess beyond yield that becomes permanent per second of hold (§engine) |
| `score_factor`, `perf_factor` | — | stiffness multipliers for scored / perforated hinges |
| `tear_strain` | — | strain at which a perforation (and, later, plain paper) separates |
| `friction` | — | Coulomb coefficient, paper on paper |
| `collision_thickness` | mm | contact distance between layers (≥ caliper) |

### 5.3 `pliego:joins[k]`

Every join has `id` (kebab case) and `type`. Points are given in **sheet-local** coordinates; the
engine resolves them against its own mesh (point location → triangle + barycentric), so joins are
independent of mesh resolution.

| `type` | Fields | Physics |
|---|---|---|
| `glue` | `a: {sheet, region: [[u,v]…]}`, `b: {sheet}`, `map: [a, b, c, d, tx, ty]`, `side: "front"\|"back"` | every engine vertex of sheet *a* inside `region` is welded to the point `M·(u,v)+t` on sheet *b* (2×2 matrix `[[a,b],[c,d]]` row-major, translation `[tx,ty]`); `side` says which face of *b* the tab lies on |
| `pivot` | `a: {sheet, at: [u,v]}`, `b: {sheet, at: [u,v]}`, `hardware_ref?` | the two points coincide; rotation is free (a brad / split pin). `hardware_ref` follows the bridge contract to yantra4d (§9) |
| `string` | `a: {sheet, at}`, `b: {sheet, at} \| {world: [x,y,z]}`, `length` | unilateral distance ≤ `length` (thread, ribbon, the line a papel picado banner hangs from) |
| `pin` | `a: {sheet, at} \| {sheet, along: [[u,v],[u,v]]}`, `world: [x,y,z] \| null`, `mechanism?` | the point (or every vertex within `collision_thickness` of the segment) is fixed in the world (`world: null` means "where it starts"); with `mechanism` naming a `translate` driver, the pinned points move with it (kirigami pulled open, a banner line raised) |
| `slider` | `a: {sheet, at}`, `track: {sheet, from: [u,v], to: [u,v]}`, `mechanism?` | the point stays on the track segment of the track sheet; if `mechanism` names a `slide` driver, the point's position along the track is driven |

### 5.4 `pliego:mechanisms[m]`

| `type` | Fields | Meaning |
|---|---|---|
| `hinge` | `id`, `axis: {origin: [x,y,z], direction: [x,y,z]}`, `angle_control`, `rest: deg`, `sheets_moving: [sheet…]` | rigid rotation of every kinematic sheet in `sheets_moving` about the world axis by the control value relative to `rest` — the spread of a pop-up book, a book board, a flap |
| `slide` | `id`, `control`, `travel: mm` | drives the `slider` joins that reference it from 0 to `travel` |
| `rotate` | `id`, `center: {sheet, at}`, `control`, `sheets_moving: [sheet…]` | rotates kinematic sheets about the pivot normal (volvelles, wheels) |
| `leaf` | `id`, `sheet`, `spine: [[u,v],[u,v]]`, `control` | a book leaf hinged at its spine edge; the control drives a page turn (0 = lying right, 180 = turned to the left) by moving a drive point along the leaf's free edge — the paper bends physically |
| `translate` | `id`, `control`, `direction: [x,y,z]`, `travel: mm`, `sheets_moving?: [sheet…]` | moves kinematic sheets and every `pin` join that names it along `direction` by `control/max × travel` (control 0 = start) |

### 5.5 `pliego:controls[c]`

```json
{"id": "open", "kind": "angle", "label": {"en": "Open", "es": "Abrir", "fr": "Ouvrir", "pt": "Abrir"},
 "min": 0, "max": 180, "default": 180, "unit": "deg"}
```

`kind` ∈ `angle` · `distance` · `sequence` (value = step position, 0…N, fractional values are
mid-step) · `wind` (value = m/s) · `toggle`. Every mechanism control and the sequence clock must be
declared here; the viewer builds its UI from this list.

### 5.6 `pliego:sequence` — the fold program

```json
{
  "mode": "physical",
  "steps": [
    {"id": "valley-diagonal", "label": {"en": "Valley-fold the diagonal", "es": "…", "fr": "…", "pt": "…"},
     "duration_ms": 1500, "targets": [[12, 180]], "release": [], "note": null},
    {"id": "unfold", "label": {"en": "Unfold", "es": "…", "fr": "…", "pt": "…"},
     "duration_ms": 1000, "targets": [], "release": [12], "note": null}
  ]
}
```

- `targets`: `[edge index, target fold angle]` pairs. During the step the engine drives each hinge
  toward its target with the stock's crease stiffness raised by the **hand factor** (a folding hand
  is far stiffer than paper). Plasticity applies (the crease takes a set).
- `release`: hinges handed back to the paper: their target is removed and they relax toward their
  plastic rest angle — "crease and unfold" leaves a crease memory, as real paper does.
- `mode`: `physical` (engine physics follows the drive) or `kinematic` (rigid origami: faces stay
  rigid and the folded state is computed exactly — valid for rigid-foldable patterns such as
  Miura-ori; the kernel guarantees consistency).
- The sequence control (`kind: "sequence"`) scrubs the program; step labels are the diagram text.

### 5.7 `pliego:meta`

```json
{"cartridge": "valley-fold", "mode": "default", "params": {"size": 150},
 "kernel": "pliego-kernel 0.1.0", "digest": "sha256:…"}
```

`digest` is the SHA-256 of the canonical serialisation of the document with `digest` set to
`null` (GOC-1 compatible).

---

## 6. `file_frames` — 3-D states

- **`initial`** (required when any sheet is non-planar at t = 0, when any join exists, or when any
  sheet has a non-identity placement): a frame with `frame_title: "initial"`,
  `frame_classes: ["foldedForm"]`, `frame_attributes: ["3D"]`, `frame_inherit: true`,
  `frame_parent: 0`, and 3-D `vertices_coords` in the world frame. The kernel computes it
  kinematically so every join is satisfied at t = 0 (a glued tab lies on its zone; a pop-up stands
  at the default spread angle). The engine starts from it.
- **`target:<name>`** (optional): reference states used by validation — e.g. `target:flat-folded`
  (the flat-folded state of a flat-foldable crease pattern) or `target:open-90`. The keystone and
  the engine benchmarks compare simulated states against them.

---

## 7. Defaults for plain FOLD files

A FOLD file without `pliego:` fields loads as: one sheet `sheet-0`, stock `kami` (the engine
ships that one stock snapshot as its only built-in), grain 90°, treatment `crease` for `M`/`V`,
`cut` for `C`, `none` otherwise; placement identity; controls `[sequence]` with a single step that
drives every `M`/`V` edge to its `edges_foldAngle`.

---

## 8. Semantic rules (fail closed)

1. All per-vertex / per-edge / per-face arrays have matching lengths; every index is in range.
2. Every edge's two vertices and every face's vertices belong to the edge's / face's sheet.
3. Faces are simple, counter-clockwise, non-degenerate (area ≥ 1 mm² unless the cartridge
   declares a smaller minimum feature), and the faces of a sheet tile the sheet (no overlap, no gap).
4. Assignment/treatment pairs are allowed by §4; `C` edges have fold angle 0; `B` edges border
   exactly one face, `C` edges border exactly one face on each side of a split, interior edges two.
5. Sheets do not overlap in the layout frame.
6. Every `stock` key resolves; every `derived` block is complete (§5.2 keys).
7. Every join, mechanism and control reference resolves; glue regions lie inside sheet *a*; join
   points lie inside their sheets.
8. Every sequence target references an `M`/`V`/`F` edge; angles are in [−180, 180].
9. If `initial` is present, its edge lengths match the layout lengths within 1e-3 relative error
   (sheets are developable — folding never stretches paper), and every glue weld is satisfied within
   `collision_thickness`.
10. `pliego:meta.digest`, when present, matches.

The kernel prints a read-proof line for every document it verifies:
`verify: sheets=N vertices=V edges=E faces=F joins=J errors=0 warnings=W` — `sheets=0` is a failure.
