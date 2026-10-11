# Honest status

> Last Updated: 2026-10-10
> Boundary: public. The single truth for what works today. Keep it true when you change behaviour.

**Lifecycle: incubating, first deploy live.** `https://pliego.madfam.io/` serves the landing and
studio (answering 200 on 2026-10-10, including `/health`). Production changes only when a build is
dispatched; merges do not auto-deploy.

| Area | State on 2026-10-10 |
|---|---|
| Contract (`docs/spec/v1`, sheet-document schema) | v1 in force; changes go through the coordinator. Spec §5.1–§5.17 and rules 1–18 (§5.13–§5.17 and rules 15–18 from the hardening wave: split cuts, initial-state conventions, canonical serialisation for `meta.digest`, presentation, data-URI art) |
| Kernel (`packages/kernel`) | built and tested (stdlib only; `pytest packages/kernel/tests`): authoring, planar arrangement with clearance-checked hole bridging and split cuts, fold programs (Tier R motion solver, layer-ordered `FoldProgram`), generators (tessellations, pop-ups, books, papercuts, reveal blocks, boards and corrugation, dielines, envelopes, finishes, papercraft nets), exporters (SVG, DXF, PDF, HPGL, GLB, FOLD) and `verify()` for every §8 rule. Rules 15 (mechanisms move only rigid sheets) and 16 (closed `pliego:meta`) are warnings until the commons is clean |
| Engine (`packages/engine`) | merged: XPBD paper physics in plain JavaScript (`node --test packages/engine/test`), loads and verifies documents (fail closed). Not yet: glue zones as welds, local stiffness from finishes, tearing and peel, stack contact, `represents` multiplicity, speed targets on large physical sheets (50–300 ms per step under load). It still requires every cut edge to border two faces, so it rejects the split cuts the kernel now writes (spec §5.13) until it is updated; it checks only the format of `meta.digest`, not its value (§5.15) |
| Studio and landing (`apps/web`) | built: catalog (with the previews), parameters, controls, fold-program scrubber, WebGL2 and Canvas 2D 3-D views, SVG crease-pattern view, exports, share links, four languages. The kinematic preview (`engine-stub.js`) is used when no engine is mounted; it honours §5.16 presentation and keeps paper above the table. Printed art, placed artwork and annotations render in the WebGL view (verified by node tests only, no browser run yet); joins and slides stay disabled in the preview; relief and sheen of finishes are not rendered |
| API (`apps/api`) | built and tested: one Flask app serving the landing, studio, engine modules, schemas, `llms.txt`, robots/sitemap and `/api/v1` (catalog, documents, exports) with a sandboxed, killable cartridge runner, CORS allowlist, rate limits and a separate Prometheus `/metrics` listener; documented in `openapi.json`. Catalog previews: one crease-pattern SVG per cartridge (default mode, kernel SVG exporter, diagram palette) built at image build time and served at `/projects/<slug>.svg`; the strict build in CI is the coverage check (134 of 134 locally, 2026-10-10) |
| Commons (`sheet-hyperobjects`, mounted at `projects/`) | `projects/` is pinned at 0ab3237: 134 cartridges, each one hyperobject family with modes and presets, four languages and an article |
| Exporters and printed art | the SVG export places front art; PDF, DXF and HPGL ignore printed art (export parity is open) |
| CI (`.github/workflows/ci.yml`) | lanes run on every PR: guards, compliance, kernel, stocks, engine, web, API |
| Deploy (`build-deploy.yml`, `enclii.yaml`, `infra/k8s/production`) | dispatch-only builds through Enclii; the build checks out the commons (enclii#714); first deploy done (see the lifecycle line and docs/DEPLOYMENT.md) |
| Identity (Janua client `pliego-web`) | declared in `janua.client.yaml`; not provisioned |
| AI (Selva) | inert: no AI route is served |
| Commerce | none. No tiers, no prices, no checkout |

Rulings in force: commons object licence CERN-OHL-W-2.0 and hosts `pliego.madfam.io`,
`pliego-app.madfam.io`, `pliego-api.madfam.io` (owner, 2026-10-10). Pending: CLA vs DCO, the brand,
tiers.

Deployment detail and the remaining onboarding steps: docs/DEPLOYMENT.md.
