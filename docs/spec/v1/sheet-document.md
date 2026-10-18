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
| `faceOrders` | no | layer order `[f, g, s]` (FOLD semantics: face f lies on side s = ±1 of face g's normal; f ≠ g on one sheet); **may be partial** — a missing pair means "unknown", never "no overlap". <!-- lane H (w3/hardening) item 7 --> The kernel writes it when a cartridge supplies a layer order: a fold program's complete flat-state order (`pliego.FoldProgram`, every overlapping pair) or the author's own triples |
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
  sheet's local bounding box (front is drawn as seen from +normal; back is mirrored as paper is),
  or an image data URI (§5.17). <!-- lane H (w3/hardening) item 10 -->
- `presentation` (optional, preview only): the root face and end transform a viewer uses to
  present the fold program (§5.16). <!-- lane H (w3/hardening) item 9 -->
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
| `D12`, `D66` (optional, laminate only) | g·mm²/s² | the free stack's D*12 and D*66 (§5.40); when absent the engine uses ν·√(D_md·D_cd) and G12·t³/12 |

A snapshot may also carry `appearance: {"front": "#rrggbb", "back": "#rrggbb"}` (from the stock card)
— the default face colours a sheet inherits when its `front`/`back` are not authored.

### 5.3 `pliego:joins[k]`

Every join has `id` (kebab case) and `type`. Points are given in **sheet-local** coordinates; the
engine resolves them against its own mesh (point location → triangle + barycentric), so joins are
independent of mesh resolution.

| `type` | Fields | Physics |
|---|---|---|
| `glue` | `a: {sheet, region: [[u,v]…]}`, `b: {sheet}`, `map: [a, b, c, d, tx, ty]`, `side: "front"\|"back"` | every engine vertex of sheet *a* inside `region` is welded to the point `M·(u,v)+t` on sheet *b* (2×2 matrix `[[a,b],[c,d]]` row-major, translation `[tx,ty]`); `side` says which face of *b* the tab lies on |
| `pivot` | `a: {sheet, at: [u,v]}`, `b: {sheet, at: [u,v]}`, `hardware_ref?` | the two points coincide; rotation is free (a brad / split pin). `hardware_ref` follows the bridge contract to yantra4d: the `hardwareRef` shape in `packages/schemas/sheet-document.schema.json` (`{platform: "yantra4d", project_slug, mode?, linked?, params_map?}`), which is Fashion Cabinet's `hardware_ref` shape; hyperobjects-spec owns the bridge (its `hardware-ref` contract and `docs/BRIDGE_HANDSHAKE.md`). The kernel checks it name-level against a vendored Yantra4D snapshot (§5.42, rule 41); the physical half of the bridge is out of scope. (There is no §9: the earlier pointer named a section that was never written.) |
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

`digest` is `"sha256:"` + the hex SHA-256 of the canonical serialisation (§5.15) of the document
with `digest` set to `null`. <!-- lane H (w3/hardening) item 8: was "(GOC-1 compatible)" -->

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

<!-- lane H (w3/hardening) §5.13: begin -->
### 5.13 Cuts split their vertices

A `cut` (assignment `C`, treatment `cut`) separates the sheet (§4), and the document carries the
separation in its topology. Around each vertex, the faces touching it are grouped across the
edges that do not separate material (every edge except `C` + `cut`). A vertex whose faces fall
into k > 1 groups is written as k vertices with the same layout coordinates, one per group. A cut
edge whose two sides then reach different vertices is written twice, once per side: **twin
edges** with the same coordinates, assignment, treatment and name, each bordering one face. That
is what rule 4's "one face on each side of a split" means.

- A slit opens wherever it can: along its interior vertices and where it reaches the outline. An
  interior tip, whose faces are still joined around its far side, stays one vertex. A
  single-segment slit with both ends inside the sheet has nothing to split and stays one edge
  between two faces.
- A closed cut frees its island. Tear-off perforations (`C` + `perforation`) stay joined until
  they tear (engine).
- Frames (`initial`, `target:*`) may move twin vertices apart: an opened slit is developable
  (rule 9).
- Exporters draw each cut once (the twins coincide); papercut checks measure one vertex per
  point.

A reader that needs the unsplit topology merges the vertices of one sheet that share coordinates.
<!-- lane H (w3/hardening) §5.13: end -->

<!-- lane H (w3/hardening) §5.14: begin -->
### 5.14 The initial state: set creases and world placement

- **Set creases.** A foldable edge (`M`, `V`, `F`, `U`) folded in the `initial` frame is a set
  crease: its `pliego:edges_restAngle` is the signed dihedral it has in that frame (§1 signs; a
  crease folded flat takes its design sign), unless the author gave it a rest angle. Without it
  the engine would read the pose as elastic and spring a standing pop-up or a rolled tube back
  toward flat at the first step. The kernel writes it; `B`, `C` and `J` edges keep 0.
- **World placement.** Un-placed sheets would all lie at the world origin, on top of each
  other. When a multi-sheet document has no joins, mechanisms or stacks and every sheet's
  placement is the identity, the kernel lays the sheets out in the world as in the layout frame:
  each sheet's `placement.origin` is `[offset.x, 0, −offset.y]`, so local `(u, v)` lands at
  `(offset.x + u, 0, −(offset.y + v))`, side by side on the table (and an `initial` frame is
  written, §6). A cartridge that places any sheet itself, or ties sheets together, keeps its own
  placements.
<!-- lane H (w3/hardening) §5.14: end -->

<!-- lane H (w3/hardening) §5.15: begin -->
### 5.15 Canonical serialisation (what `meta.digest` hashes)

The canonical serialisation of a document is **RFC 8785 (JSON Canonicalization Scheme)**: the
bytes JavaScript's `JSON.stringify` writes for the parsed document with every object's keys
sorted, encoded as UTF-8. So a reader in any language reproduces the kernel's digest from the
JSON it received, whatever number spelling or key order the file used.

- **Objects:** members sorted by key, comparing the keys as **UTF-16 code units** (JavaScript's
  default sort; for keys within the Basic Multilingual Plane this is code-point order); no
  whitespace anywhere.
- **Numbers:** IEEE-754 doubles printed as ECMAScript `Number.prototype.toString` does — the
  shortest digits that round-trip, plain notation for 1e-7 ≤ |x| < 1e21, exponent form
  otherwise. So every integral value is written as an integer (`0.0` → `0`, `90.0` → `90`,
  `-0` → `0`), `0.000015` stays `0.000015` (not `1.5e-05`), `1e-7` → `1e-7` (not `1e-07`),
  `1e21` → `1e+21`, `1.5e300` → `1.5e+300`: the exponent is written as `e`, a sign, and its
  digits without leading zeros. Integers beyond ±2^53, NaN and infinities are not allowed. How a
  writer spelled a number in its file never matters: readers hash the value.
- **Strings:** escaped as `JSON.stringify` does: `\"`, `\\`, `\b \f \n \r \t`, other
  characters below U+0020 as `\u00xx` (lower-case hex); everything else, `/`, U+2028 and U+2029
  included, is written as itself. Strings with lone surrogates are not allowed.
- **Literals:** `true`, `false`, `null`.

`digest` = `"sha256:"` + hex SHA-256 of the canonical bytes of the document with
`pliego:meta.digest` set to `null`. The kernel's `pliego.canonical_bytes` implements it;
`packages/kernel/tests/fixtures/digest_vector.json` is a shared test vector (a document, its
canonical text and its digest, cross-checked against Node's `JSON.stringify`). The engine
recomputes the digest on load when it is present (rule 10). This is GOC-1 §3.1 made exact
across languages: GOC-1's integral-float rule falls out of the number rule, but GOC-1's
Python `repr` spelling of other floats (`1.5e-05`, `1e-07`, `1e+16`) differs from the
ECMAScript spelling, so a checker built on GOC-1 `canonical_json` agrees with §5.15 only on
documents whose non-integral numbers lie in 1e-4 ≤ |x| < 1e16.
<!-- lane H (w3/hardening) §5.15: end -->

<!-- lane H (w3/hardening) §5.16: begin -->
### 5.16 `presentation` — how a viewer presents a sheet (optional, preview only)

A sheet may carry `"presentation": {"root_face": f, "end": {"origin": [x, y, z], "rotation":
[x, y, z, w]}}`, both members optional. It changes no physics and no frame; it tells a viewer
how to show the fold program, so a finished model can stand upright without the cartridge
tilting the flat sheet at t = 0.

- `root_face` (global face index, on this sheet): the face the preview holds still while the
  program folds the rest of the sheet about it. Default: the sheet's first face. Its pose is its
  t = 0 pose (the `initial` frame, else the placement).
- `end`: a rigid transform the viewer blends in over the program — identity at sequence position
  0, `end` at the last step, linearly in between (rotation by slerp, translation by lerp). It
  rotates about the root face's t = 0 centroid, then translates by `origin`. Mechanisms apply
  before it.

The studio stub implements both. The kernel's replica of the preview (`pliego.preview.PreviewTree`,
which a fold program fits its samples on) roots at `root_face` too: `FoldProgram.build(root=)`
sets the sheet's presentation root and fits on the tree held there. <!-- lane FL3
(w4/fold-robustness) item 7 --> **Ground:** the preview also keeps the posed paper above the
table (`y = 0`, §1): when a rigid preview would swing any visible point below it, the whole scene
is lifted until its lowest point rests on the table. The physics engine needs no clamp (contact
with the ground does this). Rule 17 (§8) checks the field.
<!-- lane H (w3/hardening) §5.16: end -->

<!-- lane H (w3/hardening) §5.17: begin -->
### 5.17 Printed art sources (`front.art`, `back.art`)

`art` is either a **relative path** inside the cartridge (no scheme, no leading `/`, no `..`
segment, no backslash) or an **image data URI** — so a cartridge can compute its printed faces
in `main.py` without shipping files:

- `data:image/svg+xml[;charset=…][;base64],…` (URL-encoded or base64), or
  `data:image/png;base64,…` (the payload must start with the PNG signature);
- the decoded payload is at most 1 MiB;
- an SVG payload is UTF-8, has an `<svg>` element and none of: `<script`, `foreignObject`, a
  `javascript:` URL, an `on…=` event-handler attribute, a DOCTYPE or ENTITY declaration,
  `@import`, or a `href` / `src` / `url(…)` reference outside itself (only `#fragment` and
  inline `data:image/png` / `data:image/jpeg` references are allowed).

Renderers load art **only as images** (an `<img>`, an `Image` decoded into a texture, an SVG
`<image href>`), never as inline DOM or fetched text, so even an SVG that slipped past the
sanitiser cannot run script. Rule 18 (§8) enforces the list above. Exporters: the SVG export
places the front art on its `art` layer; PDF, DXF and HPGL ignore art for now (export parity
is a backlog item).
<!-- lane H (w3/hardening) §5.17: end -->

<!-- lane E (wave 3) §5.18–§5.20: begin -->

### 5.18 Keyed mechanisms — `keys`, `period`, `ride`

A mechanism moves linearly in its control by default (§5.4). Three optional fields let one control
drive non-linear motion exactly: couplers, crank-rockers and cam followers.

| Field | On | Meaning |
|---|---|---|
| `keys` | `hinge`, `rotate`, `leaf`, `translate`, `slide` | ≥ 2 `[control value, output]` pairs, control values strictly increasing. The output is linear between keys and held at the first or last output outside them. It **replaces the control value** in the mechanism's formula: the effective hinge angle (rotation = output − `rest`), the `rotate` or `leaf` angle (deg), the `translate` displacement along `direction` (mm, within ±`travel`) or the `slide` position along the track (mm, within [0, `travel`]). |
| `period` | with `keys` | > 0. The control value is wrapped into [c₀, c₀ + `period`) before the lookup (c₀ = the first key's control value), and the segment after the last key runs linearly back to the first key's output at c₀ + `period`. Keys span at most one period. A table whose output gains a whole turn per period (a coupler's own rotation) ends with a key at c₀ + `period`; the wrap back to the first output is then a whole turn, invisible in a rotation. |
| `ride` | `hinge`, `rotate`, `translate` | the id of another `hinge`, `rotate` or `translate` mechanism that carries this one: the mechanism's transform is applied first, in the placed frame, then the ridden mechanism's transform, both at the same moment (T = T_ride ∘ T_own). Rides form no cycle. A coupler is a `rotate` about its crank pin (a point of the crank sheet in its placed pose) riding the crank's `rotate`, keyed by the coupler's heading minus the crank angle. |

A kinematic sheet still follows exactly one mechanism (§5.1); `ride` is how motions combine.
The engine and the studio preview evaluate the same table; between keys the motion is the linear
blend of the outputs, so authors sample the closed form finely enough for the linkage to stay
within tolerance (5° keys keep a 76 mm coupler within 0.04 mm of its rocker pin).

### 5.19 Step-activated joins — `active_from`

A `glue`, `pivot`, `string` or `pin` join may carry `active_from`: a step id of the fold program
(§5.6), or its 0-based index. The join does not hold until that step has begun (sequence position
p > k) and holds from then on; scrubbing the program back before the step lets go again (a join's
state is a function of p, like every other part of the program). A fold program can then show the
making — flat at t = 0 — and still end glued.

- **Rule 9 does not apply** to a step-activated glue: the `initial` frame shows the paper before
  it is glued. (Rule 9 still asks for an `initial` frame when joins exist.)
- **Created from the current geometry.** When the join switches on, the engine welds what the
  paper is doing at that moment. The snap distance is max(1 mm, 4 × the larger
  `collision_thickness` of the two sheets).
  - glue and pivot: a weld point within the snap distance of its authored point snaps onto it.
    Otherwise, if the paper lies on its zone (the gap across sheet *b*'s surface is within the
    snap distance) but has slid along it, it is welded where it lies. Otherwise the paper does
    not touch its zone and that weld point does not take hold (the engine counts it, and holds
    it only if the join switches off and on again). Glue closes the gap across *b*; a pivot
    keeps it (two layers riveted).
  - string: holds from then on, slack or taut as the geometry is.
  - pin: grips the point where it is (`world: null`), or moves it to `world` when it is within
    the snap distance; a pin's `mechanism` moves it by the mechanism's motion since activation.
- **Preview.** The studio's preview has no welds. It applies the same rule to what it can show:
  while a glue within one sheet holds, a `release` of a crease on the face-tree path between the
  tab's face and its zone's face (the loop the glue closes) leaves that crease where it is.

### 5.20 Untying joins — step `release_joins`

A step may list `release_joins`: ids of `glue`, `pivot`, `string` or `pin` joins it unties. From the
moment that step has begun (p > r) the join no longer holds, and it stays released in later steps
(the state-between-steps rule of §5.6); scrubbing back before the step ties it again. A carousel
book's ribbons are untied before it opens; a brad comes out; a pinned sheet is let go.

- A join is released at most once, by a step after the one that activates it (§5.19).
- A released join that has no `active_from` holds from the start; a released glue without
  `active_from` still satisfies rule 9 in the `initial` frame.
- The engine treats a released pin as a stiff anchor (not a fixed vertex), so letting it go
  changes no simulation topology. In the preview, releasing a glue within one sheet ends the
  crease lock of §5.19 from that step on.

<!-- lane E (wave 3) §5.18–§5.20: end -->

<!-- lane X (w3/trace-finish) §5.30: begin -->
### 5.30 Conductive traces — `pliego:finishes[k]` with `kind: "trace"`

A paper circuit's conductors are finishes on one side of a sheet (`pliego.press.trace`):
copper tape or conductive ink laid along a centre line, with contact pads where parts sit.

```json
{"id": "plus", "kind": "trace", "sheet": "card", "side": "front", "depth_mm": 0,
 "material": "copper-tape", "width_mm": 6, "path": [[20, 20], [20, 80], [60, 80]],
 "region": [[[23, 17], [23, 77], [63, 77], [63, 83], [17, 83], [17, 17]]],
 "pads": [{"id": "cell-plus", "at": [20, 20], "size_mm": 10, "part": "cell", "pin": "plus"},
          {"id": "led-a", "at": [60, 80], "size_mm": 6, "part": "led", "pin": "anode"}]}
```

- `material` ∈ `copper-tape conductive-ink`; `width_mm` ∈ (0, 50]; `depth_mm` is 0 (the layer
  adds no relief the engine models).
- `path` (≥ 2 points, sheet-local mm) is the centre line; `region` is the conductor's outline —
  the path stroked by the width, square ends (the tape runs half a width past each end),
  mitred joins, counter-clockwise — so rule 13 checks it lies on its sheet like any finish region. The kernel
  refuses paths that turn sharper than 120° or cross themselves (split them into traces).
- `pads[]`: `id` (unique in the trace), `at`, `size_mm` (a square pad), and optionally `part`
  (a part id) with `pin` ∈ `plus minus` (a coin cell), `anode cathode` (an LED) or `contact`
  (a fold switch: the switch is the `part`, its contacts are two pads). A pad touches its
  trace (centre within half the width plus half the pad of the path).
- **Exports.** The dieline export profile draws each trace on its own layers: the conductor's
  outline (`Copper tape (outline)` / `Conductive ink (outline)` — what a cutter cuts from tape
  or a pen fills with ink), its centre line (`… (centre line)`, an open polyline a plotter
  follows to lay tape or ink) and the pads (`Contact pads`), each with its own spot colour and
  DXF layer.
- **Parts are not paper.** LEDs, coin cells, tape and ink are named by the pads only; they carry
  no geometry or physics in v1. Linking them to the keystone's standard-parts catalogue is a
  follow-up (the catalogue has no LED or coin cell entry yet).
- **Engine.** v1 records the traces only: the engine does not stiffen taped areas and the studio
  does not render the conductor.
<!-- lane X (w3/trace-finish) §5.30: end -->

<!-- lane FL3 (w4/fold-robustness) §5.35: begin -->
### 5.35 Kernel fold programs: a rigid step through turned-over layers

How the kernel's `FoldProgram.kinematic` (a rigid 3-D step on the whole crease pattern) reads its
drive. It changes no document field: the step's targets are signed fold angles (§5.6) as before.

- A drive or free segment names every layer's crease whose folded image lies on it. With
  `frame="sheet"` (the default) each takes the angle as given, in the sheet's sense (valley > 0):
  the layers of a model folded in half turn as mirror images.
- With `frame="folded"` the angle is in the folded frame: valley > 0 turns the paper towards the
  viewer, relative to the paper that stays. A layer whose paper on the staying side shows its
  front takes the angle as given; a turned-over layer takes its opposite. For a crease folded
  flat, the staying side is the face joined to the fixed face once the segment's creases are
  cut; where the paper joins round the segment, the crease keeps the sheet's sense. Every layer
  then turns as one stack (a frog's spring pleat, a plane's fuselage, a rolled ring).
- A crease folded flat starts at ±180° by its layer order, not by the sign of round-off in the
  posed faces. The pattern merges collinear creases into one edge; an edge whose creases would
  take opposite signs is refused.
- A sheet-frame drive that finds no rigid path across layers turned opposite ways says so and
  names `frame="folded"`.
<!-- lane FL3 (w4/fold-robustness) §5.35: end -->

<!-- lane FL3 (w4/fold-robustness) §5.36: begin -->
### 5.36 Kernel fold programs: the branch of a rigid step does not depend on its sampling

A kernel rigid step (`FoldProgram.kinematic`) is sampled at `4 × substeps` states on the chord
continuation (§5.6, `kinematics.solve(..., along="chord")`). Where the rigid paths branch (a
flat or flat-folded start), a coarse sampling could let the predictor jump to a neighbouring
branch between two samples, so the folded result depended on `substeps` (a masu gusset folding
out at 5).

- After solving, the kernel checks the path: a hinted free crease must stay on its hinted side
  of its start angle, and a free crease that has left flat on one side must not turn up on the
  other.
- A path that fails is solved again with 2, 4, 8, then 16 internal states per sample. The
  states at the sample fractions are the same closed states of one branch, so the program keeps
  them and drops the rest: every sampling gives the same states where their fractions agree.
- A free crease that still flips at the finest refinement passes through flat for real, and the
  path is kept. A hinted crease that still turns against its hint fails the step.
<!-- lane FL3 (w4/fold-robustness) §5.36: end -->

<!-- lane FL3 (w4/fold-robustness) §5.37: begin -->
### 5.37 Kernel fold programs: rigid steps solve on exact geometry, not on the grid

A document's vertices lie on the 1e-6 mm grid (§1). The kernel's fold-program state keeps exact
coordinates. A rigid step that ends where rigid branches meet (the masu's end wall standing with
its gussets folded flat) could not reach that end on the snapped pattern when the vertices fell
off the grid: the solver landed on another branch and the next step's start did not close (the
masu lid needed its square rounded to 8 µm).

- A kernel rigid step (`FoldProgram.kinematic`) solves loop closure on the arrangement's
  topology with each vertex off the grid put back on the state's exact point (within 1e-5 mm;
  `foldpose.exact_arrangement`). A vertex on the grid up to round-off (1e-9 mm) keeps the
  grid's value, so the solver has no float noise to chase there.
- The build's penetration check (§5.6 report, `penetration_mm`) reads the faces on the same
  exact points, so touching faces off the grid do not count as crossing.
- The document keeps its vertices on the grid and its targets rounded as before. A pattern on
  the grid gives the same programs. Off the grid, a step's angles now close on the exact
  pattern instead of the snapped one, which moves step targets by the snapping misfit (about
  1e-5°).
<!-- lane FL3 (w4/fold-robustness) §5.37: end -->

<!-- lane FL3 (w4/fold-robustness) §5.38: begin -->
### 5.38 Kernel fold programs: the sign of a crease at ±180°

A crease folded flat is +180° (valley) or −180° (mountain): one pose for paper of no thickness,
two layer orders. The preview blends angles linearly between steps, so a wrong sign swings
the paper the long way round, through itself. The kernel signs a crease at ±180° as follows:

- **By its motion.** A crease that goes from open (0°) to ±180° within one sample takes the sign
  of its angle halfway through that sample. It took the sign of round-off before (the masu's
  flap had to be sampled at 0.5 as well).
- **A tuck's end.** A tuck turns its flap the simple fold's way and ends with it behind the
  pocket's wall: its layer order may give the flap's crease the other sign than the motion
  for the same pose. The step's end takes the motion's sign (the balloon's points end turned
  towards the viewer), and later steps keep that sign while the crease stays at ±180°.
- **At a rigid step's start** (`FoldProgram.kinematic`), a crease at ±180° whose faces keep
  their flat-state placement takes the flat state's sign (§5.35). One that a 3-D step folded
  takes the sign that step approached it with, read halfway.

`Built.final_angles` and `target()` still give the layer order's signs; `pose_angles`, the
sequence and `target(pose=True)` give the motion's.
<!-- lane FL3 (w4/fold-robustness) §5.38: end -->

<!-- lane FL3 (w4/fold-robustness) §5.39: begin -->
### 5.39 Kernel fold programs: naming a hinge flap

A kernel hinge pose (`FoldProgram.hinge` / `hinges`) turns a flap about a folded line that runs
along existing creases. By default the flap is the layers picked at a point and the paper joined
to them without crossing a crease whose image lies on the line. A flap folded onto that line
(the dart's corner flaps, folded to the keel) is joined to its half by such a crease, so the
flood leaves it behind.

- `sheet_points=[…]`: the faces at those sheet points seed the flood, in place of the layers
  at `at`.
- `faces=[…]`: exactly those faces of the state are the flap.
- `at` still gives the flap's side, and with it the sense of the turn. The flap is still
  checked: it must not be the whole model, must not share faces with another flap of the
  step, and may be joined to the rest only along the line.
<!-- lane FL3 (w4/fold-robustness) §5.39: end -->

<!-- lane T3 (geo-stab, RFC 0045 phase 2) §5.40–§5.42: begin -->
### 5.40 Laminate stocks — `pliego:stocks[id].laminate`

A stock may be a **laminate**: layers bonded face to face, bottom first (cover cloth backed with
paper, a covered board). Each layer is a committed Pliego stock (`stock: <slug>`) or another
platform's material by `material_ref` (§5.41), with its `thickness_mm` (default: the layer's
caliper) and `angle_deg` (the layer's axis 1 from the sheet's grain, counter-clockwise). The
kernel writes it with `pliego.laminate.stock(name, layers)`; a cartridge passes it as
`Assembly(stocks={id: snapshot})` and names `id` as the sheets' `stock`.

```json
"case-cloth": {
  "name": {"en": "Case cloth", "es": "Tela de encuadernar", "fr": "Toile de reliure", "pt": "Tecido de encadernação"},
  "gsm": 260, "caliper_mm": 0.51,
  "derived": {"thickness": 0.51, "E_md": 3.2865e8, "D_md": 5.64049e6, "D12": 958700, "D66": 574058, "…": "…"},
  "derived_basis": "pliego.laminate v1",
  "laminate": {
    "layers": [
      {"stock": "kraft-120", "thickness_mm": 0.16, "angle_deg": 0, "own_bending": "card",
       "basis": "card-carried sheet_behaviour (rule pliego-stock/1)"},
      {"material_ref": {"platform": "fashion-cabinet", "material_slug": "manta-cruda", "behaviour": "sheet"},
       "thickness_mm": 0.35, "angle_deg": 0, "own_bending": "card", "basis": "vendored snapshot (rule fc-fabric/1, …)"}
    ],
    "A": [[…]], "B": [[…]], "D": [[…]], "coupled": true, "coupling_ratio": 0.921974, "governing_layer": 0
  }
}
```

- **Every layer's physics is a `sheet_behaviour` document**, the keystone's cross-commons
  contract (hyperobjects-spec `docs/SHEET_BEHAVIOUR.md`). A Pliego stock layer reads the block
  its card carries (`materials/<slug>/stock.json` → `sheet_behaviour`, written by the keystone
  rule `pliego-stock/1`; stock-card.md). A card that carries none cannot be a layer. The kernel
  never imports the keystone: `scripts/qa/verify_sheet_behaviour.py` (stocks lane, keystone at
  `SPEC_PIN`) fails when a carried block drifts from the rule.
- **Classical laminate theory** (`pliego.laminate`, the keystone's `hyperobjects_sheet.laminate`
  restated): engineering shear strain, Voigt order (1, 2, 6), `z` from the bottom face;
  `A = Σ Q̄ₖtₖ`, `B = Σ Q̄ₖtₖz̄ₖ`, `D = Σ (ownₖ + Q̄ₖtₖz̄ₖ²)`, where a layer's own bending is its
  card's bending, rotated (a fabric bends far below the plate value of its membrane modulus).
  `A`, `B`, `D` are written in engine units (g/s², g·mm/s², g·mm²/s²). The kernel agrees with
  the keystone's calculator on the same layers to its six significant digits (golden test,
  `tests/test_laminate.py`).
- **`derived` is the free stack** (the engine reads it and nothing else, §5.2): membrane
  constants from the inverse of the 6 × 6 ABD matrix, bending `D* = D − B·A⁻¹·B` (`D_md` =
  D*11, `D_cd` = D*22, and the optional laminate-only `D12` = D*12, `D66` = D*66, which the
  engine reads in place of its plate relations); `nu` = √(ν12·ν21), `G12` = G12t / t.
- **Crease, tear, perforation and friction** are not laminate quantities. `pliego.laminate v1`
  takes them from the **governing layer** — the Pliego stock layer with the largest own bending
  √(D11·D22) — so a laminate needs at least one Pliego stock layer: `crease_k` = √(D_md·D_cd)/L*
  with L* = that layer's `crease_length_scale_t` × the stack's caliper, its yield, set rate and
  score factor, and its card's `tear_strain` and `perf_factor`. `friction` is the mean of the
  two face layers that state one (else the governing layer's). All are estimates.
- **Coupling.** A non-zero `B` (an asymmetric stack: stretching bends it — the warp of a covered
  board when the glue shrinks the cloth) is flagged `coupled` with `coupling_ratio` =
  max|B| / √(max|A|·max|D|), never failed. The engine reads the free stack's bending and
  membrane today; the curl that `B` drives under in-plane load or pre-strain is a follow-up.

### 5.41 `material_ref` — another platform's material as a layer

`{"platform": "fashion-cabinet" | "pliego" | "yantra4d", "material_slug": <slug>, "behaviour":
"sheet"}` (the keystone's shape; the sheet manifest's `material_ref` items carry the same keys
plus an optional `role`). Pliego never copies another platform's card into `materials/`.
Cross-platform data enters as data: `packages/kernel/src/pliego/data/sheet-behaviour.snapshot.json`
holds, per referenced card, the `sheet_behaviour` document the keystone's own rule wrote
(`fc-fabric/1` for a Fashion Cabinet fabric), with its provenance — keystone commit and version,
the source card's repository, path, commit, git blob id and sha-256 — and the source card itself
is vendored byte-identical under `scripts/qa/fixtures/sheet-behaviour/`. The drift gate fails
when an entry differs from the keystone's mapping of that card. A `pliego` reference reads the
card's carried block; a `yantra4d` filament is a sheet only through a thin-print descriptor
(keystone rule `y4d-thin-print/1`), which `pliego.laminate v1` does not take.

A document records the references it uses in its laminate layers (`pliego.laminate.material_refs`
lists them). `python -m pliego.cartridge` fails when a laminate layer's `material_ref` is not
declared in the manifest's `material_ref` (with `behaviour: "sheet"`), or when a declared one is
not a usable layer, and prints `refs: cartridge=… hardware_ref=H material_ref=M unresolved=U`.

### 5.42 `hardware_ref` — a Yantra4D part, name-level

A cartridge names a printed part it needs (a magnetic clasp, a brad, a stand) by a top-level
`hardware_ref` in its manifest (`{platform: "yantra4d", project_slug, mode?, linked,
params_map?}`), and a `pivot` join may carry one (§5.3). Pliego never models the solid. The
kernel checks every reference **name-level** — the bridge handshake's rule 1 (hyperobjects-spec
`docs/BRIDGE_HANDSHAKE.md`) — against a vendored, version-pinned slice of Yantra4D's published
`docs/commons-catalog.json` (`packages/kernel/src/pliego/data/yantra4d-hardware.snapshot.json`,
refreshed by `scripts/qa/refresh_hardware_snapshot.py` with the upstream commit recorded; the
slug set is derived from the commons' claims): the slug exists; `mode`, when given, is one of the
part's modes; every `params_map` key is a parameter of the part; every value parses as an
expression (numbers, arithmetic and `round`/`ceil`/`floor`/`int`/`min`/`max`/`abs`) that reads
only the cartridge's own parameters. Expressions are parsed, never evaluated. The physical half
of the handshake (render the part at the mapped values, check that it fits) needs the solid
kernel; it stays with Yantra4D's and the keystone's tooling and is out of scope here.
<!-- lane T3 (geo-stab, RFC 0045 phase 2) §5.40–§5.42: end -->

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
   points lie inside their sheets. A mechanism's control has a kind that mechanism accepts:
   `angle` for `hinge`, `rotate` and `leaf`; `distance` or `angle` for `translate` and `slide`.
   A `sequence` control drives the fold program, never a mechanism.
8. Every sequence target references an `M`/`V`/`F` edge; angles are in [−180, 180].
9. If `initial` is present, its edge lengths match the layout lengths within 1e-3 relative error
   (sheets are developable — folding never stretches paper), and every glue weld (except a
   step-activated one, §5.19) is satisfied within
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
<!-- lane H (w3/hardening) rule 15: begin -->
15. Mechanisms move only rigid sheets (§5.4): every sheet a `hinge`, `rotate` or `translate`
    lists in `sheets_moving` is kinematic on that mechanism (`kinematic.mechanism` = its id),
    and the sheet a `leaf` turns is physical (`kinematic: null`) — a leaf bends its page. The
    engine refuses both mistakes, and so does the kernel: an error (`mechanism_moves_physical`,
    `leaf_on_kinematic`) since 2026-10-11, when the last landed cartridge was cleaned.
<!-- lane H (w3/hardening) rule 15: end -->
<!-- lane H (w3/hardening) rule 16: begin -->
16. `pliego:meta` carries only the §5.7 keys (`cartridge`, `mode`, `params`, `kernel`,
    `min_feature_mm`, `digest`); the schema closes the object. Cartridge data belongs in
    `params` or in step notes. The kernel reports extra keys as an error (`meta_unknown_key`)
    since 2026-10-11, when the commons was cleaned.
<!-- lane H (w3/hardening) rule 16: end -->
<!-- lane H (w3/hardening) rule 17: begin -->
17. Presentation (§5.16): a sheet's `presentation` has only `root_face` and `end`; `root_face`
    is a face of that sheet; `end` is a placement with a finite origin and a unit quaternion.
<!-- lane H (w3/hardening) rule 17: end -->
<!-- lane H (w3/hardening) rule 18: begin -->
18. Printed art (§5.17): every sheet's `front.art` / `back.art` is null, a relative path inside
    the cartridge, or an `image/svg+xml` / `image/png` data URI that decodes, is at most 1 MiB
    and (SVG) carries no script, event handler, foreignObject, `javascript:` URL, DOCTYPE/ENTITY,
    `@import` or external reference (`art_source`).
<!-- lane H (w3/hardening) rule 18: end -->
<!-- lane E (wave 3) rules 19–21: begin -->
19. Keyed mechanisms (§5.18): `keys` appear only on `hinge`, `rotate`, `leaf`, `translate` and
    `slide`, as ≥ 2 number pairs with strictly increasing control values; `translate` outputs lie
    within ±`travel` and `slide` outputs within [0, `travel`]; `period` > 0, only with `keys`, and
    the keys span at most one period; `ride` names a `hinge`, `rotate` or `translate` mechanism,
    appears only on those types, and rides form no cycle.
20. Step-activated joins (§5.19): `active_from` appears only on `glue`, `pivot`, `string` and
    `pin` joins of a document with a fold program, and names a step id or a step index of it.
21. Untying (§5.20): every `release_joins` entry names an existing `glue`, `pivot`, `string` or
    `pin` join; no join is released twice; a join with `active_from` is released only by a later
    step.
<!-- lane E (wave 3) rules 19–21: end -->
<!-- lane X (w3/trace-finish) rule 30: begin -->
30. Paper circuits (§5.30), checked by `pliego.press.circuit(finishes, closed=…)` — wired into
    `Document.verify()`, which checks the circuit with every fold switch open and then closed
    and leaves traces that rule 13 refuses to rule 13 <!-- lane FL3 (w4/fold-robustness) item
    7: was "not yet wired into `Document.verify()`" -->: every trace finish passes §5.30 (rule 13 already applies
    its record checks); traces on the same sheet and side whose conductors overlap form one
    net, and a fold switch named closed joins its contact pads. With exactly one cell, whose
    `plus` and `minus` pads sit on different nets (else `short`), the circuit is **closed**
    when a path runs from `plus` to `minus` through LEDs, each crossed from `anode` to
    `cathode`; a loop that closes only through an LED crossed backwards is `reversed`. A part
    missing a pin (`part`), a pin given twice (`pin_twice`), a switch with fewer than two
    contacts (`switch`) or not exactly one cell (`cell`) is an error; an LED with both pins on
    one net (`led_shorted`) and more than one LED in series on the loop (`series_leds`: their
    forward voltages add up) are warnings. `pliego.press.fold_switch_closes` checks the
    geometry of a fold switch: folding the sheet by 180° on the line brings its two contacts
    face to face on the side that folds inward.
<!-- lane X (w3/trace-finish) rule 30: end -->
<!-- lane T3 (geo-stab, RFC 0045 phase 2) rules 40–41: begin -->
40. Laminate stocks (§5.40): a stock with a `laminate` block has `derived_basis`
    `pliego.laminate v1` (and only such a stock does); every layer is exactly one of `stock`,
    `material_ref`; the layers' `thickness_mm` add up to `caliper_mm` and `derived.thickness`;
    `A`, `B` and `D` are 3 × 3 numbers; `coupled` is true exactly when `B` has a non-zero
    entry; `governing_layer` indexes a Pliego stock layer.
41. Hardware references (§5.42): every join's `hardware_ref` resolves name-level in the
    vendored Yantra4D snapshot — the slug exists, `mode` is one of its modes, every
    `params_map` key is one of its parameters and every value is a safe expression.
<!-- lane T3 (geo-stab, RFC 0045 phase 2) rules 40–41: end -->

The kernel prints a read-proof line for every document it verifies:
`verify: sheets=N vertices=V edges=E faces=F joins=J errors=0 warnings=W` — `sheets=0` is a failure.
