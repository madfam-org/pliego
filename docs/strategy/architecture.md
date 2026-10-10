# Pliego — platform architecture

> Last Updated: 2026-10-10
> Boundary: public-safe architecture overview; operational detail lives in MADFAM's private ops
> repository. Policy: [`../PUBLIC_REPO_BOUNDARY.md`](../PUBLIC_REPO_BOUNDARY.md).

**Pliego** — Spanish: a sheet of paper folded in the middle; the printer's sheet that, folded and
cut, becomes a book's signature — is MADFAM's platform for **sheet hyperobjects**: origami, kirigami,
papercut, pop-up and paper engineering, book structures and whole interactive paper dioramas, with
real paper physics. It is the third sibling of the hyperobject platforms:

| Platform | Kernel | Commons | What it makes |
|---|---|---|---|
| Yantra4D | solid (B-Rep/CSG/SDF) | `solid-hyperobjects` | rigid parts → STL/STEP/3MF |
| Fashion Cabinet | drafted 2-D pattern | `soft-hyperobjects` | garments → patterns, DXF-AAMA |
| **Pliego** | **developable sheet: crease pattern + cut graph + fold program** | **`sheet-hyperobjects`** | **paper objects → cut/score/fold files, folded and animated 3-D, interactive simulations** |

## 1. The decision that shapes everything: the crease pattern is the source, the fold is the product

A sheet object's native representation is its **flat sheet** — outline, cuts, creases (mountain,
valley, score, perforation), glue tabs — plus its **fold program**. Everything 3-D is derived from it,
exactly as Fashion Cabinet derives the worn garment from the flat pieces. Unlike garments, the
*motion* is the product here: the page turn, the pop-up rising as the book opens, the papel picado
banner moving in the wind. So the physics engine is a first-class, verified package, not a preview.

- **Kernel** (Python, pure stdlib): authors and verifies flat sheets, assemblies and fold programs;
  writes sheet documents (FOLD 1.2 + `pliego:`) and fabrication files. See [`kernel.md`](kernel.md).
- **Engine** (JS ES modules, zero deps): loads sheet documents and simulates them — rigid kinematics
  plus XPBD with the paper's real stiffness. See [`engine.md`](engine.md).
- **Contract** between them: [`../spec/v1/sheet-document.md`](../spec/v1/sheet-document.md); paper
  materials: [`../spec/v1/stock-card.md`](../spec/v1/stock-card.md).

## 2. Federate everything that is not sheet geometry

| Capability | Owner | Pliego's role |
|---|---|---|
| Solid hardware: brads/split pins, eyelets, rivets, magnets, display stands, scoring jigs | **Yantra4D** (`solid-hyperobjects`) | reference by slug + params through `hardware_ref` (bridge contract); never model a solid here |
| Textiles: book cloth, ribbons, thread for binding | **Fashion Cabinet** (`soft-hyperobjects`) | `material_ref` to a fabric card (new bridge, keystone change) |
| Validation of every commons object | **hyperobjects-spec** (keystone) | `pliego-spec` package + `sheet-manifest` schema + lexicon terms |
| Identity | **Janua** (OIDC, RS256/JWKS) | OIDC client only; claim `pliego_tier` when tiers exist |
| Catalog, checkout, entitlements | **Dhanam** | later, after Tulana evidence; no prices in this repo |
| Pricing | **Tulana** | evidence-forged; never ad hoc |
| CFDI | **Karafiel** | SKU mapping before any sale |
| AI (crease-pattern assistant, diagram text) | **Selva** gateway | inert seam until enabled; fail closed |
| Quotes for printed / laser-cut / die-cut runs | **Cotiza** | send cut files + BOM; never price locally |
| Fabrication dispatch (laser cutters, drag-knife plotters, die-cutting) | **Pravara MES** | dispatch through its protocol matrix; never drive machines directly |
| Generative printed art for sheets | **ceq** | texture passes for sheet `art` (coverage contract like y4d/FC) |
| Deploy, domains, secrets, status | **Enclii** | `enclii.yaml`; flat hosts; secrets by name only |
| Messaging / email | **Angelia Courier** | never direct |
| Analytics | **Plausible** (`plausible.madfam.io`) | only |

New "own once, query everywhere" row: **sheet domain data — crease patterns, cut graphs, fold
programs, pop-up mechanisms, paper stock cards, papercut motif libraries — owner: Pliego; everyone
else queries, never forks.**

## 3. Repository layout

```
pliego/                         (public, AGPL-3.0-only; docs MIT per ruling R72)
├── packages/
│   ├── kernel/                 pliego-kernel (Python, stdlib only)
│   ├── engine/                 @pliego/engine (JS ESM + JSDoc, zero deps; node --test)
│   └── schemas/                sheet-document, stock-card (manifest schema lives in hyperobjects-spec)
├── apps/
│   ├── api/                    Flask 3 service: /api/v1 (catalog, documents, exports), /health, /ready
│   └── web/                    static landing + studio (vanilla ES modules, self-contained WebGL2)
├── materials/<slug>/stock.json paper stock cards (commons licence)
├── projects/                   git submodule → madfam-org/sheet-hyperobjects (pinned)
├── docs/                       spec/v1, strategy, interfaces, licenses, rulings
├── scripts/qa/                 fail-closed CI lanes (read-proof lines)
├── infra/k8s/production/       kustomization (digest pins), deployment, service, network policy
└── .github/workflows/          ci.yml, build-deploy.yml (dispatch-only until onboarded), bump-commons-pin.yml
```

One container serves everything (Fashion Cabinet's shape): landing at `/`, studio at `/studio/`,
engine modules at `/engine/`, API at `/api/v1/`. Hosts (proposed, pending the operator's word):
`pliego.madfam.io` (landing), `pliego-app.madfam.io` (studio), `pliego-api.madfam.io` (API) — flat
labels, one Service. Container: Python 3.12 slim (digest-pinned), gunicorn, port 8000, metrics on
9090 (internal), uid 1001, read-only root filesystem, drop ALL, seccomp RuntimeDefault.

## 4. The commons: `sheet-hyperobjects`

One `<slug>/` per object at the repo root (`main.py`, `project.json`, `docs/README.md`), strict
kebab-case slugs, mounted by Pliego at `projects/`. Classes:

1. **Techniques** — the atoms: valley/mountain fold, crease-and-unfold, reverse folds, squash, petal,
   rabbit ear, sink, crimp, pleat, swivel; cut, slit, score, perforation, tab-and-slot, glue flap,
   hinge; **page turn** (one leaf on a spine — the simplest object).
2. **Bases** — preliminary, waterbomb, kite, fish, bird, frog, blintz, windmill.
3. **Traditional models** — crane, jumping frog, dart, fortune teller (*comecocos*), boat, cup,
   masu box, flapping bird — traditional, attributed to tradition with sources, never copied from a
   modern designer's crease pattern.
4. **Tessellations and engineering origami** — Miura-ori, Yoshimura, Kresling, waterbomb, twists,
   Resch-type, curved-crease hypar (Bauhaus).
5. **Kirigami** — rotating-square auxetic, lattice kirigami, kirigami spring, origamic architecture.
6. **Papercut traditions** — papel picado (with credit to San Salvador Huixcolotla, Puebla), jianzhi,
   wycinanki, kirie, scherenschnitte, sanjhi — fold-and-cut generators, cited sources, community
   attribution.
7. **Paper engineering** — V-fold, parallel fold, floating layer, step, tent, pull-tab slider,
   volvelle, pivot, lift-the-flap, sliding scene.
8. **Book structures** — codex, saddle stitch, accordion/leporello, screenfold codex (amate), tunnel
   book, carousel, flip book, flag book.
9. **Flexagons and toys** — trihexaflexagon, hexahexaflexagon, tetraflexagon, kaleidocycle, paper
   helicopter.
10. **Dioramas** — compositions of the above through their interfaces (a Día de Muertos ofrenda pop-up
    with papel picado banners; a tunnel-book forest; a carousel village).

**Interfaces are the moat** (as garment interfaces are for FC): `spine`/`gutter`, `glue_flap` ↔
`glue_zone`, `tab` ↔ `slot`, `hinge`, `page_edge`, `pivot` (diameter-matched to a y4d brad), `track`.
A pop-up piece declaring `gutter` mounts on any spread exposing it, checked before anything is cut.

## 5. Day-one lessons adopted (from the sibling audits)

Fail-closed lanes with read-proof lines; the commons pin guard runs first in every job; derived
artifacts are generated with `--check`; licence ruled before object #1 (two agreeing fields);
strict payload validation and scope enforcement from day one; a real CSP header and no inline
scripts; `llms.txt` served; rate limits keyed on the trusted proxy header; file-size gate (warn > 600,
fail > 800 lines); SHA-pinned actions on `ubuntu-24.04`; deterministic physics with pinned dt.
