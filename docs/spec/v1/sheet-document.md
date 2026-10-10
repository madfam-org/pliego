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
| `edges_foldAngle` | yes | the **design** fold angle of each crease — the angle the fold program folds it to (for a crease the program later releases, the angle it was folded to before release; its resting angle afterwards comes from plasticity, not from this field); `0` for `B`/`F`/`C`/`J`/`U` |
| `faces_vertices` | yes | counter-clockwise vertex cycles; every face is a simple polygon (no holes — holes are bridged with `J` edges) |
| `faces_edges` | no | if present must agree with `faces_vertices` |
| `edges_faces`, `vertices_vertices`, `vertices_faces` | no | derived; readers recompute them |
| `faceOrders` | no | layer order `[f, g, s]` (FOLD semantics); **may be partial in v1** — the kernel emits only pairs it can decide locally (faces adjacent across a folded M/V crease); a missing pair means "unknown", never "no overlap" |
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
| `pliego:edges_name` | (string\|null)[E] | no | stable kebab-case name per edge (or `null`): the names manifest interfaces cite in `edges[].edge` (`spine`, `gutter`, `fore-edge`, `slot`…). Several edges may share a name (a polyline). |
| `pliego:sheets` | object[] | yes | §5.1 |
| `pliego:stocks` | object | yes | stock snapshots keyed by stock id, each with its kernel-derived physics (§5.2) |
| `pliego:joins` | object[] | no | glue, pivots, strings, pins, sliders (§5.3) |
| `pliego:mechanisms` | object[] | no | drivers for kinematic sheets and drive points (§5.4) |
| `pliego:controls` | object[] | no | what the viewer exposes to the user (§5.5) |
| `pliego:sequence` | object | no | the fold program (§5.6) |
| `pliego:pieces` | object[] | no | removable pieces: keep / excess regions of a sheet (§5.8) |
| `pliego:stacks` | object[] | no | ordered piles of sheets a caliper apart (§5.8) |
| `pliego:dielines` | object[] | no | packaging dieline blocks: panels, bleed/safe areas, glue zones, inside dimensions (§5.9) |
| `pliego:finishes` | object[] | no | pressing and burning regions: emboss, deboss, foil, varnish, letterpress, burn (§5.10) |
| `pliego:artwork` | object[] | no | brand artwork placed on a sheet side (§5.11) |
| `pliego:annotations` | object[] | no | short texts printed on a sheet's front: edge numbers, part names (§5.12) |
| `pliego:pages` | object | no | print pages in the layout frame (§5.12) |
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
  rigid board (book boards, the base page halves of a pop-up spread). A kinematic sheet's vertices
  have infinite mass. It follows its mechanism's transform **only if the mechanism lists it in
  `sheets_moving`**; a kinematic sheet that its mechanism does not move is a **fixed board** and keeps
  its placement (the stationary half of a spread references the spread's hinge this way).

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
| `G12` (optional) | g/(mm·s²) | in-plane shear modulus; when absent the engine uses 0.387·√(E_md·E_cd) (Baum et al.) |
| `score_yield_deg` (optional) | deg | yield angle of a scored hinge; when absent the engine uses `crease_yield_deg × score_factor` |
| `perf_cut_mm`, `perf_bridge_mm` (optional) | mm | perforation pattern (cut length and bridge length); `perf_factor` = bridge / (cut + bridge) |

A snapshot may also carry `appearance: {"front": "#rrggbb", "back": "#rrggbb"}` (from the stock card)
— the default face colours a sheet inherits when its `front`/`back` are not authored.

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
     "duration_ms": 1000, "targets": [[12, 0]], "release": [], "note": null},
    {"id": "let-go", "label": {"en": "Let go", "es": "…", "fr": "…", "pt": "…"},
     "duration_ms": 1000, "targets": [], "release": [12], "note": null}
  ]
}
```

- `targets`: `[edge index, target fold angle]` pairs. During the step the engine drives each hinge
  toward its target with the stock's crease stiffness raised by the **hand factor** (a folding hand
  is far stiffer than paper). Plasticity applies (the crease takes a set).
- `release`: hinges handed back to the paper: their target is removed and they relax toward their
  plastic rest angle — "crease and unfold" leaves a crease memory, as real paper does. A release
  does not unfold: a crease folded flat and let go springs back only by about the stock's yield
  angle and stays mostly folded. Unfolding is a target (the hand opens the paper); letting go
  after it leaves the crease standing open instead of flat, as in the example above.
- `mode`: `physical` (engine physics follows the drive) or `kinematic` (rigid origami: faces stay
  rigid and the folded state is computed exactly — valid for rigid-foldable patterns such as
  Miura-ori; the kernel guarantees consistency).
- **State between steps.** A step lists only the creases it moves; every crease it does not list
  **holds its current angle**. The program starts from the angles of the `initial` frame (the signed
  dihedral of each crease measured on that frame) when one is present, else from flat (0). In
  `kinematic` mode a step's in-between states are the rigid motion between its start and target
  angles (the engine solves closure along the way; a plain linear blend of angles is only an
  approximation); `release` in kinematic mode leaves a crease free at its current angle.
- The sequence control (`kind: "sequence"`) scrubs the program; step labels are the diagram text.
- `remove` (optional, string[]): excess pieces taken out of the model during the step (§5.8).

### 5.7 `pliego:meta`

```json
{"cartridge": "valley-fold", "mode": "default", "params": {"size": 150},
 "kernel": "pliego-kernel 0.1.0", "min_feature_mm": 1.0, "digest": "sha256:…"}
```

`min_feature_mm` (optional, mm, > 0) declares the smallest intended feature of this document — the
face-area floor of rule §8.3 becomes `min_feature_mm²` (default 1 mm²). Papercuts in tissue and
fine kirigami declare it; nothing else should.

`digest` is the SHA-256 of the canonical serialisation of the document with `digest` set to
`null` (GOC-1 compatible).

### 5.8 Removable pieces, stacks and tear-away — `pliego:pieces`, `pliego:stacks`, step `remove`

<!-- §5.8 added by wave 2b lane R (reveal blocks). Kept self-contained for the coordinator. -->

Some objects are made by taking paper **away**: a memo-block sculpture whose sheets are cut along
the cross-sections of a scene and torn off from the top until the scene stands revealed, a
perforated ticket stub, a kiss-cut sticker, a pop-out card. Three additions describe them; all
are optional, and a document without them behaves exactly as before.

**Pieces.** A *separable region* of a sheet is a maximal group of its faces connected across
edges that do not separate material. **Separating edges** are the outline (`B`), cuts and tear-off
perforations (`C`, treatment `cut` or `perforation`) and kiss cuts (`F` + `halfcut`); faces joined
across any other edge (`M`, `V`, `F` creases, `U`, `J`) belong together.

```json
{"id": "layer-012-excess-2", "sheet": "layer-012", "role": "excess", "faces": [301, 302],
 "label": {"en": "Corner chunk", "es": "Trozo de esquina", "fr": "Morceau d'angle", "pt": "Pedaço de canto"},
 "pull": [0, 1, 0]}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | kebab case, unique among pieces |
| `sheet` | yes | the sheet the piece belongs to |
| `role` | yes | `keep` (part of the object; it stays) · `excess` (meant to come away: torn off, weeded, popped out) |
| `faces` | yes | global face indices: exactly one separable region of `sheet` |
| `label` | no | i18n object |
| `pull` | no | world direction a hand draws the piece away when it is removed; default the sheet's front normal (lifted off the top) |

Faces in no piece are the sheet's body and stay, like `keep`. **How a piece is held until it is
removed** is read from its separating edges and the stack (below): across a `cut` it is free
(held only by contact, friction, a stack bond or padding; micro-joints are modelled as a
perforation); across a `perforation` it hangs on the bridges (`perf_cut_mm` / `perf_bridge_mm`)
and parts at the stock's `tear_strain`; across a `halfcut` it is held by the ply beneath the kiss
cut and peels off.

**Stacks.** A stack is an ordered pile of congruent sheets, **bottom → top**:

```json
{"id": "block", "sheets": ["layer-001", "layer-002", "…", "layer-040"],
 "pitch_mm": 1.2, "represents": 12, "bond": "keep",
 "binding": {"kind": "padding", "edge": [[0, 70], [70, 70]]}}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | kebab case, unique among stacks |
| `sheets` | yes | ≥ 2 sheet ids, bottom first; a sheet belongs to at most one stack |
| `pitch_mm` | yes | distance between consecutive sheet mid-planes along the stack normal |
| `represents` | no (default 1) | how many identical physical sheets each document sheet stands for. A preview may show a 480-sheet block as 40 sheets (`represents` 12); a fabrication document uses 1. `pitch_mm` = `represents` × the stock's `caliper_mm`. Exporters draw each document sheet once, so cut files for making the block come from a `represents` = 1 document. |
| `bond` | no (default `keep`) | `none`: sheets rest on each other (contact and friction only) · `keep`: keep pieces and body faces are bonded to the sheet below where they overlap (adhesive only where the material stays), excess rests by contact · `all`: a fully bonded laminate |
| `binding` | no | `{"kind": "padding", "edge": [[u, v], [u, v]]}`: a sheet-local segment where the pad is glued (the spine of a memo block); pieces touching it are held by the padding until removed |

The stack normal is the bottom sheet's front normal (its placement rotation applied to +Y);
sheet *k* (0-based) is placed at the bottom sheet's origin + *k* × `pitch_mm` × normal, with the
same rotation.

**Tear-away.** A sequence step may list `remove: [piece id, …]`. In `physical` mode the hand
grips each listed piece and draws it along `pull`: perforation bridges and padding part on the way
(tear physics: engine wave 3), and at the end of the step the piece is out of the model — no
longer simulated, collided with or rendered. A removed piece stays removed in later steps (the
state-between-steps rule of §5.6). Only `excess` pieces are removed, each at most once. A reveal
block removes the excess layer by layer **from the top** (the top sheet first); the order is the
author's, and the kernel's `pliego.reveal` emits it top-down. In `kinematic` mode and in the
studio preview the piece lifts along `pull` and disappears. Perforated tear-offs, kiss-cut
stickers and pop-outs use the same three fields.

---

### 5.9 `pliego:dielines` — packaging dielines

A list of dieline blocks, one per die-cut sheet, written by `pliego.dieline` (box, carton and
envelope generators). Sheet-local coordinates (mm); the exporters add the sheet's `offset`.

```json
{"style": "reverse-tuck carton", "family": "folding-carton", "sheet": "carton",
 "inside": {"length": 120, "width": 60, "depth": 180}, "caliper_mm": 0.47,
 "bleed_mm": 3, "safe_mm": 3,
 "panels": [{"name": "front", "kind": "panel", "label": {"en": "Front", "es": "Frente", "fr": "Face avant", "pt": "Frente"},
             "polygon": [[0, 125], [120.47, 125], [120.47, 305.47], [0, 305.47]], "print": true,
             "safe": [[3, 128], "…"], "bleed": [[-3, 125], "…"]}],
 "glue": [{"id": "manufacturers-joint", "kind": "glue", "panel": "glue-flap", "polygon": [[…]]}],
 "dimensions": [{"from": [0, 125], "to": [120.47, 125], "offset": -6, "text": "L 120 (inside)"}],
 "grain": {"kind": "grain", "angle_deg": 90, "at": [300, 40]}}
```

- `family` ∈ `corrugated` · `folding-carton` · `envelope` · `rigid` · `board`.
- `inside`: the inside dimensions the generator compensated for (`length`/`width`/`depth`, or
  the insert's `width`/`height` for envelopes); `caliper_mm`: the stock caliper it used.
- `panels[]`: `name` (kebab, also the `pliego:edges_name` of the panel's free cut edges),
  `kind` ∈ `panel flap dust-flap tuck lid glue-flap lock bottom pocket window-frame`, i18n
  `label`, `polygon`; printed panels (`print: true`) carry `safe` (the panel inset by
  `safe_mm`) and `bleed` (the panel grown by `bleed_mm` along its cut edges only).
- `glue[]`: `kind` ∈ `glue gum peel-and-seal tape hot-melt` — fabrication zones (the
  manufacturer's joint, gummed and peel-and-seal flaps). Welding them is the engine's job; a
  generator only writes `pliego:joins` glue when its initial frame satisfies the weld.
- `grain.kind` is `flute` for corrugated board (the arrow follows the flute axes, across MD).
- **Fold lines** of a dieline are ordinary `M`/`V` edges with treatment `score` (creasing
  rule); slits are `C` edges; tear lines are `perforation` (assignment `F`); kiss cuts
  `halfcut`. Box folds are mountain folds with the sheet's front as the print side, and box
  sheets are placed print side down (`placement.rotation = [1, 0, 0, 0]`).

### 5.10 `pliego:finishes` — pressing and burning

A list of finish regions on one side of a sheet (`pliego.press`):

```json
{"id": "logo", "kind": "emboss", "sheet": "card", "side": "front",
 "region": [[[20, 100], [60, 100], [60, 140], [20, 140]]],
 "depth_mm": 0.4, "profile": "dome", "registered": false}
```

| `kind` | `depth_mm` | required fields |
|---|---|---|
| `emboss` | relief height, (0, 5] | `profile` ∈ `flat dome bevel sculpted`, `registered` (bool) |
| `deboss` | recess depth, (0, 5] | `profile` |
| `foil` | 0 | `color` (#rrggbb), `finish` ∈ `metallic matte gloss holographic` |
| `varnish` | 0 | `finish` ∈ `gloss matte soft-touch spot-uv` |
| `letterpress` | impression depth, (0, 5] | `color` (ink) |
| `burn` | char depth, [0, 5] | `process` ∈ `iron laser`, `char` ∈ [0, 1] (darkness), `color` (char tone) |

`region` is a list of polygons (even-odd). The dieline export profile draws each finish as
plates on their own layers (emboss die female + counter male inset by the caliper; deboss die
male + counter female; foil, varnish and letterpress plates; branding-iron face, or laser
engrave vector + raster). **Engine:** embossed/debossed areas are locally stiffer and burned
areas thinner; v1 records the regions only — the engine does not yet change local stiffness or
thickness, and the studio does not yet render relief or sheen.

### 5.11 `pliego:artwork` — brand artwork

```json
{"id": "brand", "sheet": "carton", "side": "back", "asset": "assets/brand.svg",
 "at": [10, 90], "size": [60, 60], "rotation_deg": 0, "panel": "front", "clip": "bleed"}
```

`asset` is a relative path inside the cartridge directory (svg/png/jpg/webp, no `..`, no
scheme); `at` is the artwork's lower-left corner in sheet-local mm, before rotation about its
centre; `clip` ∈ `panel bleed none` (clip to the named panel, to its bleed, or not at all).
Exporters place the image on the Artwork layer (SVG) or draw its frame (PDF, DXF). This
complements `front.art`/`back.art` (one image over the whole sheet). The studio's texture
preview of placed artwork is a follow-up.

### 5.12 `pliego:annotations` and `pliego:pages` — print layout (optional)

Two optional top-level fields for documents meant to be printed and cut by hand, such as the
papercraft nets `pliego.unfold` writes. Both are print-only: the engine ignores them, and they
change no physics.

| Field | Type | Meaning |
|---|---|---|
| `pliego:annotations` | object[] | short texts printed on a sheet's front: `{"sheet", "at": [u, v], "text", "angle", "size"}`. `at` is the text's centre in sheet-local mm, `angle` the baseline direction in degrees counter-clockwise from +u (default 0), `size` the cap height in mm (0.5–50), `text` 1–32 printable characters. Papercraft prints each cut edge's number on both sides of the cut. |
| `pliego:pages` | object | print pages in the layout frame: `{"size": [w, h], "margin": m, "pages": [{"id", "origin": [x, y]}]}`. Each page is the rectangle `origin … origin + size`; its printable area is inset by `margin`. Pages do not overlap, and every sheet should lie inside one page's printable area. |

When `pliego:pages` is present, the PDF exporter prints each page once at 1:1 on a sheet of its
`size`, instead of tiling the whole layout. The SVG exporter draws the page frames on a `pages`
layer. SVG, PDF and DXF print annotations on their `label` / `TEXT` layers.

Rule 14 (§8) covers both fields.

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
3. Faces are simple, counter-clockwise, non-degenerate (area ≥ `pliego:meta.min_feature_mm`², default
   1 mm²), and the faces of a sheet tile the sheet (no overlap, no gap).
4. Assignment/treatment pairs are allowed by §4; `C` edges have fold angle 0; `B` edges border
   exactly one face, `C` edges border exactly one face on each side of a split, interior edges two.
5. Sheets do not overlap in the layout frame.
6. Every `stock` key resolves; every `derived` block is complete (§5.2 keys).
7. Every join, mechanism and control reference resolves; glue regions lie inside sheet *a*; join
   points lie inside their sheets.
8. Every sequence target references an `M`/`V`/`F` edge; angles are in [−180, 180].
9. If `initial` is present, its edge lengths match the layout lengths within 1e-3 relative error
   (sheets are developable — folding never stretches paper), and every glue weld is satisfied within
   `collision_thickness`: each vertex of the glue `region` polygon, mapped to sheet *b*, lies within
   `max(collision_thickness(a), collision_thickness(b))` of its image on *b* in the `initial` frame.
10. `pliego:meta.digest`, when present, matches.
11. Pieces (§5.8): every piece's sheet exists; its faces lie on that sheet and form exactly one
    separable region; no face belongs to two pieces; `role` is `keep` or `excess`; `pull`, when
    present, is a non-zero 3-D vector. Every step `remove` names an existing `excess` piece, and
    no piece is removed twice in a program.
12. Stacks (§5.8): every sheet exists and belongs to at most one stack; `pitch_mm` > 0 and equals
    `represents` × the `caliper_mm` of each member's stock (within 1e-5 mm); the members share one
    rotation and sit *k* × `pitch_mm` along the bottom sheet's front normal; the `binding` edge
    lies on every member.
13. Packaging blocks resolve: every `pliego:dielines` / `pliego:finishes` /
    `pliego:artwork` entry names an existing sheet; panel, safe, glue and finish polygons lie
    on their sheet (within its local bounding box; bleed outlines within the box grown by
    `bleed_mm`); finish and artwork records satisfy §5.10–§5.11.
14. Print layout (§5.12): every annotation's sheet exists and its `at` lies on that sheet, with
    `text` 1–32 printable characters and `size` 0.5–50 mm; `pliego:pages` is well formed (size
    > 0, 0 ≤ margin < half the page, ≥ 1 page, unique ids) and its pages do not overlap. A sheet
    outside every page's printable area is a warning (`sheet_off_page`).

The kernel prints a read-proof line for every document it verifies:
`verify: sheets=N vertices=V edges=E faces=F joins=J errors=0 warnings=W` — `sheets=0` is a failure.
