# Honest status

> Last Updated: 2026-10-10
> Boundary: public. The single truth for what works today. Keep it true when you change behaviour.

**Lifecycle: incubating.** Built in the open; **nothing is deployed** and no host serves Pliego yet.

| Area | State on 2026-10-10 |
|---|---|
| Contract (`docs/spec/v1`, sheet-document schema) | written; changes go through the coordinator |
| Kernel (`packages/kernel`) | wave-1 build in progress (kernel-core, kernel-gen lanes) |
| Engine (`packages/engine`) | wave-1 build in progress (engine lane) |
| Studio and landing (`apps/web`) | wave-1 build in progress (web lane) |
| API (`apps/api`) | not started (wave 2); the image's `CMD` expects `apps.api.app:app` |
| Packaging (lane P, wave 2b) | board and EVA foam stock cards (corrugation model, estimates [E]), `pliego.corrugate`, `pliego.dieline` (box and carton styles), `pliego.envelope`, `pliego.press` (finishes, artwork) and the dieline export profile are built and tested; spec §5.9–§5.11 / rule 13 are drafts awaiting the coordinator; the engine does not yet use finish regions, and the studio does not render relief or placed artwork |
| Commons (`sheet-hyperobjects`, mounted at `projects/`) | repository created, empty of cartridges; not yet mounted here |
| CI (`.github/workflows/ci.yml`) | lanes written; lanes for code that does not exist print `skip:` |
| Deploy (`build-deploy.yml`, `enclii.yaml`, `infra/k8s/production`) | written, dispatch-only; Enclii onboarding not done |
| Identity (Janua client `pliego-web`) | declared in `janua.client.yaml`; not provisioned |
| AI (Selva) | inert: `SELVA_BASE_URL` unset, every AI route answers 503 |
| Commerce | none. No tiers, no prices, no checkout |

Rulings in force: commons object licence CERN-OHL-W-2.0 and hosts `pliego.madfam.io`,
`pliego-app.madfam.io`, `pliego-api.madfam.io` (owner, 2026-10-10). Pending: CLA vs DCO, the brand,
tiers.

Known gaps before the first deploy (docs/DEPLOYMENT.md): Enclii's reusable build checks out
without submodules, so the image build fails closed on an empty `projects/`; the API and its
`/metrics` listener do not exist yet.
