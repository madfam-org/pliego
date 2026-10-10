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
| `arrangement.py` | planar subdivision of a sheet: outline + holes + crease/score/perforation segments + slits → split at intersections with snapping (grid 1e-6 mm), merge overlaps by priority (cut > crease > score > perforation > flat), DCEL, faces, hole bridging with `J` edges so every face is simple; Euler check V − E + F = 1 + components. |
| `sheet.py` | the authoring API: `Sheet(id, outline, stock, grain_deg, label, front, back)` with `.crease(a, b, kind="valley", angle=180, treatment="crease")`, `.mountain(...)`, `.valley(...)`, `.score(...)`, `.perforate(...)`, `.cut(polyline)`, `.hole(polygon)`, `.tab(edge, width, taper)`, `.art(front=..., back=...)`; `.build()` → arrangement → per-sheet FOLD arrays. |
| `assembly.py` | `Assembly(sheets, joins, mechanisms, controls, sequence, initial_frame)`; join builders `glue(...)`, `pivot(...)`, `string(...)`, `pin(...)`, `slider(...)`; mechanism builders `hinge(...)`, `slide(...)`, `rotate(...)`, `leaf(...)`; layout of sheets side by side in the layout frame. |
| `document.py` | `Document` — the in-memory sheet document; `to_json()` (canonical, byte-stable), `from_json()`, `digest()` (GOC-1 compatible sha256), `verify()` implementing spec §8, `summary()` (read-proof line + counts). |
| `foldfile.py` | FOLD 1.2 import/export: plain FOLD files (Origami Simulator, ORIPA exports, flat-folder) load with spec §7 defaults; export strips nothing (pliego: fields are legal FOLD custom fields). |
| `flatfold.py` | local flat-foldability: Maekawa (|M − V| = 2), Kawasaki–Justin (exact via `exact.py` when slopes are rational, else float with tolerance), big-little-big lemma; flat-folded vertex positions via the face tree (reflections); local layer-order constraints (taco/tortilla) → `faceOrders` for small patterns; issues as verify dicts. |
| `kinematics.py` | Tier R reference (float64): face-tree pose from fold angles; degree-4 closed forms (Foschi–Hull–Ku); Miura-ori closed form; loop-closure residuals; DOF via a small dense SVD in stdlib. This is the **arbiter** the engine's Tier R tests compare against. |
| `axioms.py` | Huzita–Justin axioms O1–O7 as constructions returning `Line`s (authoring helpers: "fold this point to that line through that point"). |
| `simplefold.py` | the simple-fold model: a folded state = stack of layers (polygon of the original sheet + affine transform + order). `fold(line, direction, layers="all"|"top"|n)` splits layers by the fold line's pre-image, reflects the moving part and restacks it; `unfold()`. Produces step-by-step diagram frames and the crease pattern of the folds made. |
| `foldcut.py` | **fold-and-cut**: after simple folds, `cut(region_in_folded_frame)` removes every point of the sheet whose folded image lies inside the region — computed by mapping the region's boundary back through every layer into the arrangement and classifying faces (kept/removed) by mapping their centroids forward. Exact for polygonal regions. Powers papel picado, jianzhi, snowflakes, kirigami cards. |
| `papercut.py` | papercut validation: kept regions are connected (or intentionally separate), minimum bridge width ≥ the stock's `min_feature_mm`, no slivers below the cutter's minimum, island report; motif primitives (petal, circle, diamond, scallop, zig-zag border, lattice) and symmetry generators (n-fold wedge, mirror, accordion repeat). |
| `tessellate.py` | generators: Miura-ori, Yoshimura, Kresling, waterbomb, square twist, hexagonal twist, Resch-type, accordion — each returns a sheet with M/V assignment and target angles, plus the closed-form 1-DOF angle law where one exists. All original geometry (no copied third-party crease patterns). |
| `popup.py` | paper-engineering generators: V-fold, parallel (box) fold, floating layer, step fold, tent, 90° origamic-architecture cut-fold; each returns an `Assembly` (base spread with gutter + pieces + glue joins + `hinge` mechanism on the spread + `open` control) and its kinematic initial frame; closure checks (lies flat at 0° and 180°, no lock). |
| `book.py` | book structures: leaf (one page hinged at a spine — the simplest object in the commons), codex of N leaves, accordion/leporello, screenfold codex, tunnel book (two leporello walls + layered frames), carousel; `leaf` mechanisms and page-turn controls. |
| `stock.py` | paper stock cards: load `materials/<slug>/stock.json`, validate, and `derive(card) -> dict` — the **only** implementation of the measurement → physics mapping (spec §5.2 keys, engine units). Measured values win; documented estimates otherwise (rsE §b formulas: Baum relations, `D = E t³/12(1−ν²)`, `L* = 200 t` hand crease / 50–100 t scored, yield 35°). `derived_basis` names the version. |
| `export/svg.py` | layered SVG: `cut` (outline + cuts), `mountain`, `valley`, `score`, `perforation` (dash = cut length / bridge), `glue` (tab hatching), `art`, `registration` (print-then-cut corner marks), `label`; laser-friendly colour convention selectable (`--palette lightburn|cricut|diagram`); mm units, viewBox in mm. |
| `export/dxf.py` | DXF R12, named layers `CUT`, `MOUNTAIN`, `VALLEY`, `SCORE`, `PERF`, `GLUE`, `TEXT`, `$INSUNITS = 4`. Adapted from FC `export/dxf.py`. |
| `export/pdf.py` | hand-written PDF 1.4 (adapted from FC): 1:1 tiling on A4/Letter/A3/A0 with alignment crosses and tile ids, plus print-then-cut registration marks; mountain/valley line styles per origami diagram convention. |
| `export/hpgl.py` | HPGL for plotters/cutters: `SP` pen per pass (score pass before cut pass), `PU`/`PD` in plotter units (40 units/mm), path ordering inside-out (cut inner features before outer). |
| `export/glb.py` | glTF 2.0 binary of a 3-D state (the `initial` frame or a kernel-computed folded state): two-sided materials (front/back colours), per-sheet meshes; optional morph targets for a kinematic fold program. Stdlib only (struct + json). |
| `export/fold.py` | `.fold` writer (thin wrapper over `document.to_json`). |
| `cartridge.py` | helpers for cartridge scripts (the sandbox injects `pliego` and `math`): `PARAM`-style accessor docs, `result` contract checks. |

---

## 2. Cartridge contract (as in the commons)

`<slug>/main.py`, `<slug>/project.json`, `<slug>/docs/README.md`. The runner (in `apps/api`, built
on the shared `commons_sandbox`) injects `pliego` and `math` as the only importable modules, injects
parameters and `mode` (the mode id) as bare globals, executes the script, and reads `result` — a `pliego.Sheet`,
`pliego.Assembly` or `pliego.Document`. Scripts read parameters through a local accessor with a
default so they also run standalone:

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

## 3. Tests (`pytest packages/kernel/tests`)

- **Geometry and arrangement:** intersections with tolerance; Euler characteristic on random
  arrangements; hole bridging yields simple faces; overlap priority.
- **Flat-foldability:** Maekawa/Kawasaki/BLB on known flat-foldable vertices (square twist,
  waterbomb base, preliminary base, Miura) and on perturbed non-flat-foldable ones; exact rational
  Kawasaki agrees with the float version.
- **Kinematics:** degree-4 closed forms — vertex α = (70, 80, 110, 100)°: mode 1 at ρ1 = 90° gives
  |ρ2| = 29.13°, mode 2 at ρ2 = 90° gives |ρ1| = 10.31° (rsE E5); Miura Poisson ratio
  ν = −cos²θ·tan²γ (E6); face-tree pose preserves edge lengths (developability) to 1e-9.
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
