# The launch catalog — from turning a page to a diorama

> Last Updated: 2026-10-10
> Boundary: public-safe planning document. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

The commons `sheet-hyperobjects` launches with a catalog that climbs the ladder the owner set for
the mission: *"something as simple as turning a page, to creating entire interactable dioramas made
of a combination of paper-manipulation techniques."* Every rung is a real cartridge (generator +
manifest + article), verified by the kernel, the keystone (`pliego-spec`) and an engine smoke run.

**Index discipline (Fashion Cabinet lesson).** The machine index (`docs/catalog/launch.json`) is
claimed by the coordinator only in the same change that lands a cartridge that passes; a slot is
never claimed ahead of a passing object.

**Provenance discipline.** Every object is authored by MADFAM from geometry it generates. Traditional
models and techniques (the crane, the masu box, papel picado) are credited to their tradition with
cited sources and **no copied diagram or crease-pattern file**; modern designers' crease patterns are
never used (they are copyrighted works). Heritage objects credit their communities (papel picado: San
Salvador Huixcolotla, Puebla; amate: the Otomí of San Pablito, Pahuatlán, Puebla) and make no claim
the cited sources do not support.

Tier: **R** rigid/kinematic, **C** compliant physics, **R+C** both (kinematic drive, physical paper).

## Rung 1 — Techniques (the atoms)

| slug | object | demonstrates | needs | tier | interfaces |
|---|---|---|---|---|---|
| `page-turn` | one leaf on a spine | the simplest sheet hyperobject: a page that bends as it turns | `book.leaf`, `leaf` mechanism | C | `spine`, `page_edge` |
| `valley-fold` | a square folded once | valley fold, sequence step, crease set after release | sheet, sequence | C | — |
| `mountain-fold` | the same, mountain | sign convention, front/back colours | sheet, sequence | C | — |
| `crease-and-unfold` | fold, unfold | crease memory (rest angle ≠ 0) | plasticity | C | — |
| `inside-reverse-fold` | reverse fold on a folded strip | degree-4 vertex motion | kinematics (closed form) | R+C | — |
| `outside-reverse-fold` | ditto, outside | the other mode of the same vertex | kinematics | R+C | — |
| `squash-fold` | squash a flap | multi-vertex collapse | kinematics (loop closure) | R | — |
| `petal-fold` | petal fold on a preliminary base | the bird-base move | kinematics | R | — |
| `rabbit-ear` | rabbit-ear a triangle | three creases meeting | kinematics | R | — |
| `pleat-and-crimp` | pleat, crimp | parallel M/V pairs | sheet, sequence | R+C | — |
| `tab-and-slot` | two cards locked by a tab | interlocking joins | `slider`/contact | C | `tab`, `slot` |
| `glue-flap` | a box side closed with a glued tab | glue welds, tab geometry | `glue` join | C | `glue_flap`, `glue_zone` |
| `score-vs-crease` | 300 g/m² card folded scored and unscored | why cardstock is scored | `score` treatment, stock | C | — |
| `perforated-tear` | a perforated tear-off strip | perforation treatment | `perforation` | C | — |

## Rung 2 — Bases

`preliminary-base`, `waterbomb-base`, `kite-base`, `fish-base`, `bird-base`, `frog-base` —
flat-foldable crease patterns (Maekawa/Kawasaki pass exactly), collapse programs (tier R; tier C for
the final settle), flat-folded target frames for validation. Interfaces: none (bases are inputs to
models).

## Rung 3 — Traditional models (attributed to tradition)

`paper-crane` (orizuru), `flapping-bird`, `jumping-frog` (bounces on the ground plane: tier C
spring energy in the pleats), `paper-dart`, `fortune-teller` (*comecocos*, operable: an `open`
control on its four pockets), `paper-boat` (*barquito*), `paper-cup`, `masu-box`. Each ships its
crease pattern, the diagram sequence (step labels in en/es/fr/pt) and the folded state. Honest
limit: multi-layer collapses run kinematically; physics settles the final form.

## Rung 4 — Tessellations and engineering origami

`miura-ori` (1-DOF, Poisson ratio benchmark), `yoshimura`, `kresling-tower` (bistable — tier C
only, tier R reports 0 DOF and the article explains why), `waterbomb-tessellation`, `square-twist`,
`hexagonal-twist`, `pleated-hypar` (the Bauhaus hyperbolic paraboloid from concentric squares —
attributed to the Bauhaus preliminary course), `accordion-fan`.

## Rung 5 — Kirigami

`rotating-squares` (auxetic, ν = −1, pulled open with a `translate` driver), `lattice-kirigami`
(expanding mesh of parallel slits), `kirigami-spring` (spiral cut), `kirigami-cube` (pop-up cube
from one cut sheet), `oa-stairs` (an original 90° origamic-architecture card: parallel cuts and
folds from one sheet).

## Rung 6 — Papercut traditions

`papel-picado-banner` (tissue `papel-de-china`, fold-and-cut motifs, flags pinned along a line,
wind control — the flagship heritage object), `paper-snowflake` (six-fold fold-and-cut),
`jianzhi-window-flower` (radial fold-and-cut; UNESCO 2009 inscription cited), `mirror-silhouette`
(bilateral fold-and-cut, the general technique behind several European silhouette traditions —
named traditions only with primary sources), `stack-cut-panel` (a cut through N stacked sheets, as
papel picado artisans cut 40–50 sheets at once).

## Rung 7 — Paper engineering

`v-fold-popup`, `parallel-fold-popup`, `floating-layer-popup`, `tent-popup`, `step-popup`,
`pull-tab-slider`, `volvelle` (rotating wheel on a pivot — a y4d brad through `hardware_ref` when
one exists), `lift-the-flap`, `dissolve-scene` (sliding venetian-blind picture change). All are
mechanisms driven by the spread's `open` control or their own control; tier R closure checks (flat
at 0° and 180°) plus tier C paper.

## Rung 8 — Book structures

`codex-signatures` (folded *pliegos* gathered and sewn — the platform's namesake), `saddle-stitch`,
`leporello`, `screenfold-codex` (amate stock, accordion pages, gesso-white panels — credit and
sources per the research; no reproduction of any historical codex's imagery), `tunnel-book`,
`carousel-book`, `flip-book` (thumbing pages: page stack contact).

## Rung 9 — Flexagons and toys

`trihexaflexagon` (pinch-flex cycle, tier R), `kaleidocycle` (rotating ring of tetrahedra, tier R
loop closure), `paper-helicopter` (falls and spins: tier C air drag on pitched blades),
`paper-spinner`.

## Rung 10 — Dioramas (compositions through interfaces)

| slug | composition | interfaces exercised |
|---|---|---|
| `ofrenda-popup` | Día de Muertos ofrenda: step-fold tiers on a spread + `papel-picado-banner` strung across + kirigami marigold flowers + candle tent folds | `gutter`, `glue_flap`/`glue_zone`, pins on a line |
| `tunnel-book-forest` | leporello walls + four layered cut frames of trees, open by pulling the cover | `spine`, `page_edge`, `glue_zone` |
| `carousel-village` | a carousel book whose six chambers are parallel-fold houses | `spine`, `gutter` |

## Wave plan

| Wave | Content | Gate |
|---|---|---|
| W2a | Rung 1 (14) + `miura-ori`, `v-fold-popup`, `parallel-fold-popup`, `papel-picado-banner`, `paper-snowflake`, `leporello`, `rotating-squares` | kernel core + generators merged; keystone `pliego-spec` draft installable; engine smoke passes |
| W2b | Rungs 2–9 remainder | W2a landed |
| W2c | Rung 10 dioramas | the interfaces they compose are verified |
