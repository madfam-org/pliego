# Pliego

> Boundary: public repository. It carries the platform mechanism and sanitized context only;
> operational detail lives in MADFAM's private ops repository. See
> [`docs/PUBLIC_REPO_BOUNDARY.md`](docs/PUBLIC_REPO_BOUNDARY.md).

**Status: incubating** — built in the open, not yet deployed.

*Pliego* (Spanish): a sheet of paper folded in the middle — the printer's sheet that, folded and
cut, becomes a book's signature.

Pliego is MADFAM's platform for **sheet hyperobjects**: origami, kirigami, papercut, pop-up and
paper engineering, book structures and interactive paper dioramas — parametric, fabricable (cut,
score and fold files for laser cutters, plotters and print), and simulated with **real paper
physics**: the stiffness, grain, crease memory and springback of the actual paper stock.

- **Kernel** (`packages/kernel`, Python, standard library only) — authors and verifies flat sheets,
  crease patterns, cuts, pop-up mechanisms and fold programs.
- **Engine** (`packages/engine`, JavaScript, zero dependencies) — rigid kinematics plus compliant
  XPBD physics, in the browser and in Node.
- **Commons** — [`sheet-hyperobjects`](https://github.com/madfam-org/sheet-hyperobjects), mounted at
  `projects/`: from turning a page to whole interactive dioramas.

Start with [`docs/strategy/architecture.md`](docs/strategy/architecture.md) and the contract
[`docs/spec/v1/sheet-document.md`](docs/spec/v1/sheet-document.md).

Licence: platform code AGPL-3.0-only © Innovaciones MADFAM S.A.S. de C.V.
