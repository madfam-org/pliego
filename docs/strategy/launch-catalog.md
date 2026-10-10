# The launch catalog — from turning a page to a diorama

> Last Updated: 2026-10-10
> Boundary: public-safe planning document. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

The commons `sheet-hyperobjects` launches with a catalog that climbs the ladder the owner set for
the mission: *"something as simple as turning a page, to creating entire interactable dioramas made
of a combination of paper-manipulation techniques."* Every rung is a real cartridge (generator +
manifest + article), verified by the kernel, the keystone (`pliego-spec`) and an engine smoke run.

**Owner directives (2026-10-10, in session).**

1. **At least 100 sheet hyperobjects**, covering the most commonly folded, pre-cut, cut, bent and
   combined paper and board objects.
2. **One hyperobject per object family.** All of a family's variants and 3-D forms live inside one
   cartridge: *"paper airplanes should be one hyperobject with all sorts of creatable and foldable
   versions/3d manifestations."*
3. **Cardboard, dielines and envelopes**, **sheet pressing and branding**, and **sheet corrugation**
   are in scope for the engine and the commons.
4. **Reveal blocks**: paper blocks whose layers are pre-cut so that the excess can be torn away,
   usually top to bottom, to reveal a scene.
5. The overlap between paper and board sheets, single- or few-layer 3-D prints, and fabric must
   stay **separate in concerns yet seamlessly integrated**. That is an ecosystem decision, routed
   as an RFC to the owner (see "Cross-commons sheets" below). This catalog does not take it.

**Families, mapped onto the manifest.** A variant that needs different sheets or a different
script is a `mode`. Variants that share one generator are a `design`/`style` select parameter.
Named parameter bundles, such as sizes (A4, US Letter, C5, #10) and classic configurations, are
`presets`. The studio shows the mode selector and the parameters. A family counts once, however many
variants it carries.

**Technique classes.** fold · cut · pre-cut (die-cut, perforated, kiss-cut, pre-ripped) · bend/roll
· press (emboss, deboss, foil) · corrugate · combination.

**Counting.** A hyperobject counts when its cartridge lands passing (index discipline below), not
when it is planned. The plan below carries more than 100 so that the count survives objects that
prove infeasible.

**Index discipline (Fashion Cabinet lesson).** The machine index (`docs/catalog/launch.json`) is
claimed by the coordinator only in the same change that lands a cartridge that passes; a slot is
never claimed ahead of a passing object.

**Provenance discipline.** Every object is authored by MADFAM from geometry it generates. Traditional
models and techniques (the crane, the masu box, papel picado) are credited to their tradition with
cited sources and **no copied diagram or crease-pattern file**; modern designers' crease patterns are
never used (they are copyrighted works). Heritage objects credit their communities (papel picado: San
Salvador Huixcolotla, Puebla; amate: the Otomí of San Pablito, Pahuatlán, Puebla) and make no claim
the cited sources do not support. Industry box styles are generated from their geometry. FEFCO and
ECMA style codes may be cited as identifiers, but their catalogues' drawings are never reproduced.

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

## Rung 2 — Bases (fold)

Flat-foldable crease patterns: Maekawa and Kawasaki pass exactly. Each base has a collapse program
(tier R, with tier C for the final settle) and flat-folded target frames for validation. Bases are
inputs to models, so they have no interfaces.

| slug | object | variants (modes · design · presets) | tier | wave |
|---|---|---|---|---|
| `preliminary-base` | square base | coloured side out or in | R | W2b·L1 |
| `waterbomb-base` | waterbomb base | — | R | W2b·L1 |
| `kite-base` | kite base | — | R | W2b·L1 |
| `fish-base` | fish base | — | R | W2b·L1 |
| `bird-base` | bird base | stretched bird base | R | W2b·L1 |
| `frog-base` | frog base | — | R | W2b·L1 |
| `blintz-base` | blintzed square | single, double blintz | R | W2b·L1 |
| `windmill-base` | windmill base | — | R | W2b·L1 |

## Rung 3 — Traditional models (fold; attributed to tradition)

Each ships its crease pattern, the diagram sequence (step labels in en/es/fr/pt) and the folded
state. Honest limit: multi-layer collapses run kinematically, and physics settles the final form.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `paper-crane` | orizuru | classic; neck and tail angles; spread or flat wings | R+C | W2b·L1 |
| `flapping-bird` | the flapping bird | operable wings (control) | R+C | W2b·L1 |
| `lily` | lily from the frog base | lily, iris | R | W2b·L1 |
| `tulip` | blossom and stem (two sheets) | — | R | W2b·L1 |
| `paper-airplane` | **one family, every common plane** | designs: classic dart, glider, delta, flat-nose square plane, canard (original), ring wing (cut strip); 3-D forms: dihedral, winglets, elevator trim, nose-weight folds | R (flight: C, W3) | W2b·L2 |
| `jumping-frog` | the index-card jumping frog | spring pleat; bounce (C) | R+C | W2b·L2 |
| `fortune-teller` | *comecocos*, salt cellar | operable `open` control | R | W2b·L2 |
| `paper-boat` | *barquito* and kin | hat boat, sailboat, sampan | R | W2b·L2 |
| `paper-cup` | traditional cup | cup, drinking cone | R | W2b·L2 |
| `masu-box` | masu box | box, lid (a few mm larger) | R | W2b·L2 |
| `samurai-helmet` | kabuto | — | R | W2b·L2 |
| `paper-hat` | folded hats | newspaper hat, pirate hat, sailor hat | R | W2b·L2 |
| `waterbomb-balloon` | the water bomb | folded; inflated (air, W3) | R(+C) | W2b·L2 |
| `paper-popper` | the banger | snap (C) | R+C | W2b·L2 |
| `fox-puppet` | finger puppet | — | R | W2b·L2 |
| `ninja-star` | two-unit shuriken (modular) | — | R | W2b·L2 |

## Rung 4 — Tessellations and curved folding (fold)

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `yoshimura` | cylinder buckling pattern | ring count, sides | C | W2b·L3 |
| `kresling-tower` | bistable twist tower | sides, storeys (tier R reports 0 DOF and the article says why) | C | W2b·L3 |
| `waterbomb-tessellation` | waterbomb grid | flat, curled tube | R+C | W2b·L3 |
| `square-twist` | square twist | single, tiled | R | W2b·L3 |
| `hexagonal-twist` | hexagon and triangle twists | hexagon, triangle | R | W2b·L3 |
| `pleated-hypar` | Bauhaus hyperbolic paraboloid | square, circular (concentric) | C | W2b·L3 |
| `accordion-fan` | fans | hand fan, ribbed folding fan | R+C | W2b·L3 |
| `curved-crease-sculpture` | curved folding | concentric arcs, spiral | C | W2b·L3 |
| `paper-spring` | witch's ladder | two strips, square or triangular section | C | W2b·L3 |

## Rung 5 — Kirigami (cut + fold)

`rotating-squares` landed in W2a.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `lattice-kirigami` | expanding mesh of staggered slits | slit length, spacing, stock | C | W2b·L4 |
| `kirigami-spring` | spiral cut that extends into a helix | turns, width | C | W2b·L4 |
| `kirigami-cube` | pop-up cube from one cut sheet | — | R+C | W2b·L4 |
| `origamic-architecture` | 90° cut-and-fold cards | stairs, arch, buildings (original designs) | R+C | W2b·L4 |
| `paper-lantern` | slit lantern rolled into a cylinder | slit count, height | C | W2b·L4 |
| `honeycomb-decoration` | tissue honeycomb ball and fan | ball, fan, bell | C | W2b·L4 |

## Rung 6 — Papercut (cut)

`papel-picado-banner` and `paper-snowflake` landed in W2a.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `jianzhi-window-flower` | radial fold-and-cut (UNESCO 2009 inscription cited) | 4-, 6-, 8-fold | R | W2b·L4 |
| `mirror-silhouette` | bilateral fold-and-cut | motif set | R | W2b·L4 |
| `stack-cut-panel` | one cut through N stacked sheets | sheets, motif | C | W2b·L4 |
| `paper-doll-chain` | accordion fold-and-cut chain | figures, panels | R | W2b·L4 |
| `paper-doily` | radial lace | folds, lace density | R | W2b·L4 |
| `stencil` | cut stencil with bridges (islands kept) | letters, motif | R | W2b·L4 |

## Rung 7 — Paper engineering and cards (cut + fold + glue)

`v-fold-popup` and `parallel-fold-popup` landed in W2a.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `floating-layer-popup` | a layer floating on supports | — | R+C | W2b·L5 |
| `tent-popup` | tent fold | — | R+C | W2b·L5 |
| `step-popup` | stairs from a step fold | steps | R+C | W2b·L5 |
| `pull-tab-slider` | pull tab moving a part | straight, pivoting | R+C | W2b·L5 |
| `volvelle` | rotating wheel on a pivot | windows, rings | R | W2b·L5 |
| `lift-the-flap` | hinged flap | — | R | W2b·L5 |
| `dissolve-scene` | venetian-blind picture change | slat count | R | W2b·L5 |
| `spiral-popup` | spiral springing from the gutter | turns | C | W2b·L5 |
| `mouth-popup` | the talking mouth | — | R+C | W2b·L5 |
| `greeting-card` | **one family, every common card** | single fold, tent, gatefold, z-fold, tri-fold, with insert; A6, A5, US sizes | R | W2b·L5 |

## Rung 8 — Books and print finishing (fold + bind)

`leporello` landed in W2a.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `codex-signatures` | folded *pliegos* gathered and sewn (the platform's namesake) | folio, quarto, octavo imposition | C | W2c |
| `saddle-stitch` | stapled booklet | pages, creep | C | W2c |
| `screenfold-codex` | amate accordion codex (no historical imagery reproduced) | panels | C | W2c |
| `tunnel-book` | tunnel book | layers | R+C | W2c |
| `carousel-book` | carousel book | chambers | R+C | W2c |
| `flip-book` | thumbed page stack | pages | C | W2c |
| `pocket-zine` | eight-page one-sheet zine (one cut) | — | R | W2c |
| `stab-binding` | Japanese stab binding | four-hole, tortoise-shell, noble | C | W2c |
| `print-folds` | **one family, every commercial print fold** | letter (tri-fold), z-fold, gatefold, French fold, roll fold, double parallel, accordion, cross fold, map fold | R | W2c |

## Rung 9 — Flexagons, toys and flight

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `flexagon` | flexagons | tri-hexa, hexa-hexa, tetra | R | W2c |
| `kaleidocycle` | rotating ring of tetrahedra | 6, 8, 10 links | R | W2c |
| `paper-helicopter` | falling spinner | blade pitch (air, W3) | C | W2c |
| `pinwheel` | cut-and-fold windmill toy | 4, 8 blades (air, W3) | R+C | W2c |
| `thaumatrope` | two-sided spinning card | — | R | W2c |
| `zoetrope` | slotted drum and strip | slots, frames | R | W2c |
| `card-boomerang` | three-blade card boomerang | (air, W3) | C | W2c |
| `paper-top` | card disc top | — | C | W2c |
| `lucky-star` | strip-folded puffy star | — | R+C | W2c |

## Rung 10 — Packaging: cardboard, corrugation, dielines, envelopes, pressing, branding

The board stocks and the dieline/pressing/branding toolchain these objects need are platform work
(capabilities below). Every box is **thickness-compensated**: inside dimensions are given, and panel
and flap sizes include the board caliper.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `corrugated-board` | **corrugation itself**: fluted medium between liners | single face, single wall, double wall, triple wall; A/B/C/E/F flute profiles; craft corrugated paper | C | W2b·P |
| `corrugated-shipper` | slotted shipping cases | regular slotted (FEFCO 0201 style), half-slotted, full-overlap, telescope; E/B/C/BC board | R+C | W2b·P |
| `folding-carton` | **one family, the folding cartons** | straight tuck end, reverse tuck end, seal end, crash-lock (auto) bottom, 1-2-3 bottom (ECMA style families) | R+C | W2b·P |
| `envelope` | **one family, every common envelope** | commercial, baronial, square, wallet, catalog, pocket, diamond flap, window; ISO 269 C4/C5/C6/DL, US #10/A2/A7 | R | W2b·P |
| `mailer-box` | roll-end tuck-front mailer (FEFCO 0427 style) | mailer, pizza style | R+C | W2b·P |
| `pillow-box` | curved-score pillow pack | — | C | W2c |
| `gable-box` | gable-top handle box | — | R+C | W2c |
| `sleeve-and-tray` | matchbox style | — | R+C | W2c |
| `presentation-folder` | pocket folder | pockets, card slits, capacity spine | R | W2c |
| `slotted-dividers` | interlocking partitions | cells | R | W2c |
| `display-stand` | counter display and easel back | — | R+C | W2c |
| `paper-bag` | flat-bottom (SOS) bag with gussets | — | R+C | W2c |
| `gift-wrap` | wrapping a box | standard, diagonal (Japanese) wrap | C | W2c |
| `embossed-stationery` | **pressing**: emboss, deboss, foil and letterpress on a card | blind emboss, registered emboss, deboss, hot foil, letterpress | R | W2b·P |

## Rung 11 — Paper models, nets and rolled paper

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `platonic-solids` | the five solids as tabbed nets | tetra, cube, octa, dodeca, icosa | R | W2c |
| `paper-globe` | gores and the sphere | 12, 24 gores | C | W2c |
| `paper-house` | cut-out house model with tabs (original) | — | R | W2c |
| `papercraft-unfold` | any low-poly mesh unfolded to a tabbed net (bridge to yantra4d solids) | — | R | W2c |
| `quilling` | rolled strip shapes | tight and loose coil, teardrop, marquise, scroll | C | W2c |
| `paper-beads` | rolled tapered strips | — | C | W2c |
| `party-hat` | cone from a sector | — | C | W2c |
| `paper-rose` | spiral cut, rolled | — | C | W2c |
| `paper-chain` | looped, glued strips | — | C | W2c |
| `paper-crown` | zigzag band | — | C | W2c |
| `kusudama` | traditional glued flower ball (modular) | — | R | W2c |

## Rung 12 — Celebration paper (heritage-aware)

`papel-picado-banner` landed in W2a.

| slug | object | variants | tier | wave |
|---|---|---|---|---|
| `tissue-pom-pom` | *pompón de papel de china*: accordion stack, tied, fanned | — | C | W2c |
| `paper-flowers` | *flores de papel* | tissue, crepe | C | W2c |

## Rung 13 — Reveal blocks and dioramas (compositions)

| slug | composition | interfaces exercised | wave |
|---|---|---|---|
| `reveal-block` | **pre-cut memo-block sculpture**: each layer of a paper block is die-cut (or perforated) along the scene's contour, and the excess is torn away top to bottom to reveal it. Scenes (original): stepped pyramid, volcano, landscape, sphere, city skyline | stack, tear-away removal | W2b·R |
| `shadow-box` | layered papercut frames with spacers | `glue_zone` | W2c |
| `paper-theater` | proscenium, flats and backdrop | `tab`, `slot` | W2c |
| `ofrenda-popup` | Día de Muertos ofrenda: step-fold tiers on a spread + `papel-picado-banner` strung across + kirigami marigold flowers + candle tent folds | `gutter`, `glue_flap`/`glue_zone`, pins on a line | W2c |
| `tunnel-book-forest` | leporello walls + four layered cut frames of trees, opened by pulling the cover | `spine`, `page_edge`, `glue_zone` | W2c |
| `carousel-village` | a carousel book whose six chambers are parallel-fold houses | `spine`, `gutter` | W2c |

**Count.** W2a landed 21. W2b plans 62 more (rungs 2–7, six packaging and pressing objects, and the
reveal block), and W2c plans 44. That makes 127 planned, against the owner's floor of 100.

## Platform capabilities the catalog needs

| capability | what | owner (wave) |
|---|---|---|
| Board stocks | stock cards for corrugated board (single face, E/B/C/F single wall, BC double wall, triple wall), folding boxboard (SBS/FBB), greyboard, kraft liner. They are derived from a **corrugation model** (liner and medium grammage, flute pitch, height and take-up) into orthotropic membrane and bending stiffness. Score creases use L* = 50–100 t. | P (W2b) |
| Corrugation generator | `pliego.corrugate`: fluted medium geometry (A/B/C/E/F profiles), liners, cross-sections and craft corrugated sheets | P (W2b) |
| Dielines | `pliego.dieline`: thickness-compensated box-style generators, plus a dieline export profile. Its named layers and spot colours are Cut (CutContour), Crease, Perforation, Half-cut (kiss cut), Glue, Bleed, Safe area, Dimensions, Panel labels and Grain/flute arrows. Export targets are PDF, SVG and DXF. | P (W2b) |
| Envelopes | `pliego.envelope`: styles × ISO 269 / US sizes, windows, gummed and peel-and-seal flap zones | P (W2b) |
| Pressing | finish regions on a sheet: emboss, deboss, foil, varnish/spot UV and letterpress impression, each with depth, profile and colour. They are exported as separate plates (emboss die male/female, foil plate) and rendered as relief and sheen. Locally stiffer embossed areas are noted for the engine. | P (W2b) |
| Branding | brand artwork mapped onto dieline panels (front/back, bleed and safe area, spot colours), previewed on the folded object in the studio. Heat branding (burn marks) waits for confirmation. | P (W2b) |
| Reveal blocks | contract: removable pieces and tear-away steps. Kernel: stack slicer, from a heightfield or implicit scene to N layers of contours to die-cut or perforated layers. Studio preview: pieces removed top to bottom. Engine tearing comes in W3. | R (W2b) |
| Nets / papercraft unfolder | polyhedron and mesh unfolding with tabs (the yantra4d bridge) | W2c |
| Air | flight, falling spinners, wind toys: the engine's air model | W3 |

## Cross-commons sheets (routed to the owner, not ruled here)

Paper and board (Pliego, `sheet-hyperobjects`), single- or few-layer 3-D prints (yantra4d,
`solid-hyperobjects`) and fabric (Fashion Cabinet, `soft-hyperobjects`) are all thin sheets. They
meet in real objects: prints made onto stretched fabric that curl when released, printed hinges in
paper pop-ups, bookcloth over board, sewing patterns on paper. The owner asked for them to stay
**separate in concerns yet seamlessly integrated**. The options and a recommendation go to the owner
as an internal-devops RFC. Until it is ruled, Pliego's stock cards stay Pliego-owned, and nothing
here moves code or contracts across the commons.

## Wave plan

| Wave | Content | Gate |
|---|---|---|
| W2a | Rung 1 (14) + `miura-ori`, `v-fold-popup`, `parallel-fold-popup`, `papel-picado-banner`, `paper-snowflake`, `leporello`, `rotating-squares` — **landed (21)** | kernel core + generators merged; keystone `pliego-spec` draft installable; engine smoke passes |
| W2b | Lanes L1 (bases + crane family, 12), L2 (traditional toys and `paper-airplane`, 12), L3 (tessellations, 9), L4 (kirigami + papercut, 12), L5 (paper engineering + `greeting-card`, 10), P (board/corrugation/dielines/envelopes/pressing/branding platform + 6 objects), R (reveal-block platform + `reveal-block`) | kernel 0.2.0 on Pliego main (madfam-org/pliego#2) and the commons `PLIEGO_PIN` bumped to it |
| W2c | Rungs 8, 9, 11, 12, the rest of rung 10 and the rung-13 compositions | W2b landed; the interfaces the dioramas compose are verified |
| W3 | Physics showcases that need the engine: flight, wind, tearing, pop-up physics, board crush | engine merged and benchmarked |
