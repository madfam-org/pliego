# Paper-engineering modes — the coverage matrix

> Last Updated: 2026-10-10
> Boundary: public-safe planning document. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

The owner's direction (2026-10-10): *"We have to make sure our entire roadmap of pliego covers all
possible modes of paper engineering."* This page enumerates the modes and assigns each one to the
platform layers that serve it:

- the **contract** (`docs/spec/v1/sheet-document.md`);
- the **kernel** (`packages/kernel`);
- the **engine** (`docs/strategy/engine.md`);
- the **studio**;
- **export**.

It also names the hyperobjects that demonstrate each mode in the
[launch catalog](./launch-catalog.md). A mode counts as covered when a landed cartridge
demonstrates it. Until then, its row names the wave that will.

**Legend.**

- Status: ✅ landed · 🟡 planned in a wave · 🔬 needs the physics engine (W3) · ⛔ out of scope (with
  the boundary stated).
- Layers: **C** contract · **K** kernel · **E** engine · **S** studio · **X** export.

## A. Folding

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| A1 | Flat folding: bases and traditional models | C K E S | rung 1 techniques; `preliminary-base` … `windmill-base`; `paper-crane`, `lily`, `tulip`, … | ✅ landed |
| A2 | Rigid folding (rigid origami, kinematics, loop closure) | K (motion solver) S | `miura-ori`, `squash-fold`, `petal-fold`, `rabbit-ear`, reverse folds | ✅ landed |
| A3 | Curved-crease folding | K (polyline curves) E | `curved-crease-sculpture`, `pleated-hypar` (circular) | ✅ landed |
| A4 | Tessellations and twists | K (`tessellate`) | `square-twist`, `hexagonal-twist`, `waterbomb-tessellation`, `yoshimura`, `kresling-tower` | ✅ landed |
| A5 | Modular origami: interlocking units | C (multi-sheet, contact) K | `ninja-star`, `kusudama`, `modular-origami` | ✅ landed |
| A6 | Action models: flapping, jumping, snapping | C (controls) E | `flapping-bird`, `jumping-frog`, `paper-popper`, `fortune-teller` | ✅ landed · 🔬 bounce and snap |
| A7 | Pleating, crimping, accordion | K | `pleat-and-crimp`, `accordion-fan`, `leporello` | ✅ landed |
| A8 | Fold-and-cut | K (`foldcut`) | `paper-snowflake`, `papel-picado-banner`, `jianzhi-window-flower`, `paper-doll-chain`, `paper-doily` | ✅ landed |
| A9 | Wet-folding: moisture-softened stock, sculptural curves | C (moisture state) E (moisture → stiffness, drying sets rest) | `wet-folded-sculpture` | 🔬 W3 |
| A10 | Engineering and deployable origami: stents, deployable arrays, metamaterials | K E | `miura-ori`, `kresling-tower`, `waterbomb-tessellation` (tube), `rotating-squares` | ✅ landed |
| A11 | Actuated and self-folding sheets: heat-shrink pre-stress, 4-D prints, pneumatic | C (laminate B-term, trigger) E | `self-folding-sheet` (cross-commons with Yantra4D, RFC 0045) | 🔬 W3 |

## B. Cutting

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| B1 | Papercut: knife and scissors, negative space, bridges | K (`papercut.analyze`, min feature) X | `papel-picado-banner`, `stencil`, `mirror-silhouette` | ✅ landed |
| B2 | Kirigami: cut plus fold | K E | `rotating-squares`, `lattice-kirigami`, `kirigami-spring`, `kirigami-cube`, `origamic-architecture`, `paper-lantern` | ✅ landed |
| B3 | Fabrication cutting: die, laser, plotter, cut/crease rules | X (SVG/DXF/PDF/HPGL, dieline profile) | every cut object; `corrugated-shipper`, `folding-carton` | ✅ landed |
| B4 | Perforation, kiss-cut, half-cut, slits | C (treatments) K E (tear) | `perforated-tear`, `reveal-block`, dielines | ✅ landed · 🔬 tear |
| B5 | Stack cutting (N sheets, one cut) | K | `stack-cut-panel` | ✅ landed |
| B6 | Tearing and deckle edges | K (procedural deckle outline) E (fracture) | `deckle-tear` | ✅ landed · 🔬 |

## C. Pop-ups and movables (paper engineering proper)

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| C1 | V-fold, parallel fold, tent, step, floating layer, spiral, mouth | C (joins, mechanisms) K (closure) E | `v-fold-popup`, `parallel-fold-popup`, `tent-popup`, `step-popup`, `floating-layer-popup`, `spiral-popup`, `mouth-popup` | ✅ landed |
| C2 | Rotation: volvelles, wheels | C (`rotate`) | `volvelle` | ✅ landed |
| C3 | Sliding: pull tabs, sliders | C (`translate`, `slide`) | `pull-tab-slider` | ✅ landed |
| C4 | Flaps, gatefolds, lift-the-flap | C (`hinge`, `leaf`) | `lift-the-flap`, `greeting-card`, `print-folds` | ✅ landed |
| C5 | Transformations: dissolves, venetian blinds | C K | `dissolve-scene` | ✅ landed |
| C6 | Linkages and levers: four-bar, scissor and lazy-tongs extenders | C (pivots) K (closure) | `card-linkages` | ✅ landed |
| C7 | Automata: cams, cranks, followers, gears in card | C (rotate + follower) K E | `paper-automaton` | ✅ landed |
| C8 | Tunnel, carousel and peepshow structures | C (spine, gutter) | `tunnel-book`, `carousel-book`, `tunnel-book-forest`, `carousel-village` | ✅ partly (2/4) · 🟡 W2c |

## D. Bending, rolling, curling, twisting

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| D1 | Rolling: cones, tubes, beads, coils | K (developable rolls) E | `party-hat`, `paper-beads`, `quilling`, `paper-rose`, `paper-chain` | ✅ landed |
| D2 | Curved scoring and curling | K (curved score) E | `pillow-box`, `quilling` (curl) | ✅ partly (1/2) · 🟡 W2c |
| D3 | Bending-active structures: strip gridshells, bent plates | E (large deflection) | `bending-active-shell` | 🔬 W3 |
| D4 | Crumpling | E (contact, plasticity) | `crumpled-sheet` | 🔬 W3 |
| D5 | Springs and twisting: witch's ladder, paper yarn and rope | K E | `paper-spring`, `paper-yarn` (paper textiles link to Fashion Cabinet, RFC 0045) | ✅ landed |

## E. Corrugation and structural board

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| E1 | Corrugation: fluted medium between liners (A/B/C/E/F; single face to triple wall) | K (`pliego.corrugate`) stock (corrugation model) E (orthotropy, caliper) | `corrugated-board` | ✅ landed |
| E2 | Paper honeycomb: decorative and structural cores | K E | `honeycomb-decoration`, `honeycomb-panel` | ✅ partly (1/2) · 🟡 W2b L4 · W2c |
| E3 | Slotted and interlocking structures: dividers, furniture | C (slot contact) K | `slotted-dividers`, `cardboard-furniture`, `tab-and-slot` | ✅ partly (1/3) · ✅ · 🟡 W2c |
| E4 | Load-bearing paper: bridges, columns, box compression | E (load, buckling) | `paper-bridge`, `corrugated-shipper` (stacking) | ✅ partly (1/2) · 🔬 W3 |

## F. Packaging and print finishing

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| F1 | Dielines and box styles, thickness-compensated | K (`pliego.dieline`) X (dieline profile) | `corrugated-shipper`, `folding-carton`, `mailer-box`, `pillow-box`, `gable-box`, `sleeve-and-tray`, `presentation-folder`, `display-stand`, `paper-bag` | ✅ partly (4/9) · 🟡 W2b P · W2c |
| F2 | Envelopes | K (`pliego.envelope`) | `envelope` | ✅ landed |
| F3 | Print folds and imposition | K | `print-folds`, `codex-signatures`, `pocket-zine` | ✅ landed |
| F4 | Pressing: emboss, deboss, foil, letterpress | C (finish regions) X (plates) S (relief) | `embossed-stationery` | ✅ landed |
| F5 | Branding: artwork on dielines, pressed marks, heat and burn branding (RFC 0045 S4) | C X S | `embossed-stationery`, `branded-tag`, `folding-carton` (artwork preset) | ✅ partly (2/3) · 🟡 W2b P · W2c |
| F6 | Coatings and laminates: varnish, spot UV, film, bookcloth | C (finishes, laminates; RFC 0045 §5.3) | `case-binding`, `embossed-stationery` | ✅ partly (1/2) · 🟡 W2c |
| F7 | Wrapping a solid: gift wrap, furoshiki-like paper wraps | E (contact with a body) | `gift-wrap` | ✅ landed |

## G. Joining and assembly

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| G1 | Glue: flaps, zones, lamination | C (`glue` join) E | `glue-flap` and most assemblies | ✅ landed |
| G2 | Tabs, slots, friction and crash locks | C (contact) | `tab-and-slot`, `folding-carton` (tuck, crash lock) | ✅ landed |
| G3 | Mechanical fasteners: brads, eyelets, rivets, staples, split pins | C (`pin`, hardware via the keystone's standard parts) | `fastener-joins`, `volvelle` | ✅ landed |
| G4 | Sewing and binding: pamphlet, stab, Coptic, case binding | C (string joins) K | `saddle-stitch`, `stab-binding`, `codex-signatures`, `case-binding` | ✅ partly (3/4) · 🟡 W2c |
| G5 | Weaving and lacing: strip weaving, woven heart baskets, paper basketry | C (contact) K | `paper-weaving` | ✅ landed |
| G6 | String, thread and balance: mobiles, hanging works | C (`string`) E (balance) | `paper-mobile`, `papel-picado-banner` | ✅ landed |

## H. Layering and stacking

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| H1 | Layered scenes: shadow boxes, tunnel books, theatres | C (offsets, spacers) | `shadow-box`, `paper-theater`, `tunnel-book` | ✅ landed |
| H2 | Reveal blocks: pre-cut layers torn away top-down | C (pieces, tear-away) K (stack slicer) S | `reveal-block` | ✅ landed |
| H3 | Pads, stacks and flip-books | C (stack contact) | `flip-book`, `stack-cut-panel` | ✅ landed |
| H4 | Laminated composites across materials | C (laminates, `material_ref`; RFC 0045) | `case-binding`, `self-folding-sheet` | 🟡 W2c · 🔬 |

## I. Forming (3-D shape without creases)

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| I1 | Papier-mâché: laminating strips over a form | C (form contact, laminate) E (wet conform, dry set) | `papier-mache-shell` | 🔬 W3 |
| I2 | Wet-forming and moulding paper relief | E (moisture) | `wet-folded-sculpture` | 🔬 W3 |
| I3 | Heat-forming foam (EVA): armour, inserts | stock (foam, RFC 0045 S2) E (thermal plasticity) | `foam-armor-piece` (cross-commons with Fashion Cabinet) | 🔬 W3 |
| I4 | Pulp moulding and papermaking | — | — | ⛔ fibre slurry is not a sheet process. Formed pulp parts are solids (a Yantra4D question); handmade papers enter Pliego only as stock cards |

## J. Nets and papercraft

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| J1 | Polyhedral nets with glue tabs | K (unfolder) | `platonic-solids` | 🟡 W2c |
| J2 | **Low-poly papercraft**: any mesh unfolded into tabbed, numbered nets laid out on pages, with an assembly program that folds the net into the model | K (`pliego.unfold`: cut tree, overlap splitting, tabs, edge numbers, page layout) C (cartridge mesh assets) S (net-to-model animation) X | `low-poly-papercraft` (original models), `papercraft-unfold` (any mesh, including Yantra4D solids) | ✅ landed |
| J3 | Gores: globes and balloons | K | `paper-globe` | ✅ landed |
| J4 | Paper models: architecture and vehicles | K | `paper-house`, `low-poly-papercraft` (designs) | ✅ partly (1/2) · 🟡 W2c |

## K. Paper electronics and interaction

| # | Mode | Layers | Hyperobjects | Status |
|---|---|---|---|---|
| K1 | Paper circuits: copper-tape and conductive-ink traces, fold switches, LEDs on cards and pop-ups | C (trace finish layer) X (trace plate) BOM (keystone standard parts) | `paper-circuit-card` | 🟡 W2c |

## L. Physics phenomena (the engine's showcase, all 🔬 W3)

Flight (`paper-airplane`, `paper-helicopter`, `card-boomerang`) · wind (`pinwheel`,
`papel-picado-banner`) · tearing (`perforated-tear`, `deckle-tear`, `reveal-block`) · crumpling ·
buckling (`yoshimura`) · bistability (`kresling-tower`) · snap-through (`paper-popper`) · friction
locks (`folding-carton`) · tissue drape (`honeycomb-decoration`) · moisture (`wet-folded-sculpture`)
· heat (`foam-armor-piece`, burn branding) · load (`paper-bridge`, `corrugated-shipper`).

## Boundaries (named so nothing falls through)

| Not Pliego | Where it lives |
|---|---|
| Surface decoration as such (marbling, painting) | out of engineering scope. Printed artwork enters only as branding (F5) |
| Pulp moulding and papermaking | ⛔ (I4) |
| Fabric garments, felt sewing | Fashion Cabinet, used by reference (RFC 0045 S2) |
| Printed solids and thin prints | Yantra4D, with a sheet card (RFC 0045 S3) |
| Machine-level manufacturing (corrugators, folder-gluers, spiral tube winders) | equipment, not objects. Pliego exports what such machines consume (dielines, plates) |

## How this page is kept honest

When a cartridge lands, the coordinator flips its row's status in the same change, as the index
discipline already requires. A mode with no planned hyperobject is a gap. Gaps are added to the
catalog, never left implicit.
