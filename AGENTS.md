# Pliego — agent operating guide

> Last Updated: 2026-10-18

<!-- MADFAM-AGENTS-CANONICAL v1 -->

> **Boundary checkpoint (2026-10-10, platform ops):** public repository. Operational detail
> (cluster topology, secret paths, break-glass procedures, operator runbooks, people) lives in
> MADFAM's private ops repository and is only pointed to from here — the rules are the
> repo-boundary contract, summarised in [`docs/PUBLIC_REPO_BOUNDARY.md`](docs/PUBLIC_REPO_BOUNDARY.md).
> Never copy that detail in.

This is the canonical instruction file for Claude, Codex and any other LLM agent working in this
repository. `CLAUDE.md` is only a compatibility redirect. Public repository: follow the
repo-boundary contract summarised in [`docs/PUBLIC_REPO_BOUNDARY.md`](docs/PUBLIC_REPO_BOUNDARY.md) —
no secrets, no node or network identity, no private runbooks, no prices, no client identities.

## What Pliego is

The platform for **sheet hyperobjects** — origami, kirigami, papercut, pop-up and paper engineering,
book structures and interactive paper dioramas — with real paper physics. Sibling of Yantra4D
(solids) and Fashion Cabinet (garments). Commons: `madfam-org/sheet-hyperobjects`, mounted at
`projects/`. Status: **incubating, first deploy live** (landing `pliego.madfam.io`, studio
`pliego-app.madfam.io`, API `pliego-api.madfam.io`; builds are dispatched, merges do not deploy).
[`docs/HONEST_STATUS.md`](docs/HONEST_STATUS.md)
says what works today; keep it true when you change behaviour.

Read first: [`docs/strategy/architecture.md`](docs/strategy/architecture.md) →
[`docs/spec/v1/sheet-document.md`](docs/spec/v1/sheet-document.md) (the contract every component
speaks) → [`docs/strategy/kernel.md`](docs/strategy/kernel.md) /
[`docs/strategy/engine.md`](docs/strategy/engine.md).

## Required operating doctrine

- Production operations are **Enclii-first** (web, API or CLI). This public repository carries no
  break-glass procedure.
- Secrets reach production only through the Enclii secret intake; this repo holds secret *names*.
- Never take a ruling (name, hosts, licence, prices, tiers): prepare to the ruling point and list it.
- Units are mm, degrees, grams, seconds. Coordinates are y-up in sheet space, Y-up in the world.
- Determinism is a contract: the kernel emits byte-stable documents; the engine replays bit-exactly.
- No solid-modeling kernel in this repo (no OCCT/CadQuery/trimesh): solids live in Yantra4D and are
  referenced through `hardware_ref`.
- AI only through the Selva gateway (inert until configured); money only through Dhanam; quotes only
  through Cotiza; machine dispatch only through Pravara MES; messaging only through Angelia Courier.
- File size: warn above 600 lines, refactor before 800 (CI gate).
- Every check prints a read-proof line; "scanned zero" is a failure.

## Layout and ownership (build waves)

| Path | Owner lane (wave 1) |
|---|---|
| `packages/engine/**` | engine |
| `packages/kernel/**` core modules (geometry, exact, arrangement, sheet, assembly, document, foldfile, flatfold, kinematics, axioms, simplefold, foldcut, papercut, cartridge, `__init__`) | kernel-core |
| `packages/kernel/**` generators and IO (stock, tessellate, popup, book, `export/*`), `materials/**`, `packages/schemas/stock-card.schema.json` | kernel-gen |
| `apps/web/**` | web |
| `apps/api/**` | api (wave 2) |
| root docs, `.github/**`, `infra/**`, `enclii.yaml`, `janua.client.yaml`, `docs/licenses/**`, `docs/PUBLIC_REPO_BOUNDARY.md`, `scripts/qa/**` (compliance lanes) | scaffold |
| `docs/spec/**`, `docs/strategy/**`, `packages/schemas/sheet-document.schema.json` | coordinator (contract changes go through the coordinator) |

Lane rules: work only in your own clone and branch (`lane/<name>`); commit and push early and after
every milestone; never edit a path you do not own (report the needed change instead); never merge;
never run git in another lane's clone.

## Commands

```bash
python3 -m pytest packages/kernel/tests -q          # kernel
node --test packages/engine/test/*.test.js                    # engine (Node ≥ 20, no install step)
node --test apps/web/test/*.test.mjs                           # web (static studio, no install step)
python3 -m pytest apps/api/tests -q                  # api (once apps/api exists)
python3 -m pliego.stock --check materials            # stock cards: derived physics is up to date
python3 scripts/qa/verify_commons_pin.py             # projects/ is a populated, pinned commons
python3 scripts/qa/verify_compliance.py              # doctrine gates (AST level)
python3 scripts/qa/verify_deploy_paths.py            # deploy path filter == Dockerfile COPYs
python3 scripts/qa/verify_canonical_host.py          # enclii.yaml hosts == CORS / host env
python3 -m unittest discover -s scripts/qa/tests -v  # tests for the lanes above
```

## CI lanes (`.github/workflows/ci.yml`)

GitHub-hosted `ubuntu-24.04` only (fork PRs must never reach self-hosted runners), top-level
`permissions: contents: read`, every action pinned to a full 40-hex commit SHA with its tag in a
comment, no `secrets: inherit`. A lane whose code does not exist yet prints `skip: <reason>` and
exits 0 — that line is the read-proof, never a silent pass. Jobs: `agent-docs`, `quality-gates`
(byte gate + file-size gate 600/800 against `scripts/size-limit-baseline.json`), `guards` (the
`scripts/qa` tests and lanes), `kernel`, `engine`, `web`, `api`, `stocks`, `secrets` (gitleaks over
the full history). `codeql.yml` scans Python and JavaScript. Any job that reads `projects/` runs
`verify_commons_pin.py --require` first.

`image.yml` runs on pull requests that touch any Dockerfile COPY source, the Dockerfile or itself:
it builds the production image with the commons and the build-time prerender (`push: false`), then
boots it read-only as uid 1001 and requires `/health` (commons, stocks, prerendered, thumbnails,
`revision` equal to the built SHA) and `/ready` 200. `verify_deploy_paths.py` fails when its paths
miss a COPY source.

`nightly.yml` (daily 10:23Z and on dispatch; no deploys, no build dispatch): job `corpus` builds
every cartridge in every mode and preset (`scripts/qa/sim_corpus.py`) and runs `pliego-spec check
sheet-document` at its `SPEC_PIN` (the same keystone SHA as the commons' `ci.yml`; move both
together) over every document, and FAILS on any error. Job `sim-matrix` runs
`scripts/qa/sim-matrix.mjs` on every third document of the C-sorted corpus (244 of 732) and writes
loads / stable / interactive / falls back / rejected / unstable / errors to the job summary and the
`sim-matrix` artifact. It is informational: no physics status fails it until a CI baseline exists to
set a threshold against. It is red only when the harness breaks or the subset does not finish in
its 50-minute budget (the summary then says INCOMPLETE and how many documents finished).

`build-deploy.yml` is **dispatch-only** until the project is onboarded to Enclii; it calls Enclii's
reusable `build-publish.yml` pinned to a full commit SHA on Enclii `main`, with named secrets only.

## Runtime contract

One container (root `Dockerfile`) serves everything: landing at `/`, studio at `/studio/`, engine
modules at `/engine/`, API at `/api/v1/`, `llms.txt` at `/llms.txt`. gunicorn `apps.api.app:app` on
8000; liveness `/health`, readiness `/ready`; `/metrics` on 9090, internal only. uid 1001, read-only
root filesystem (only `/tmp` is writable), drop ALL, seccomp RuntimeDefault. Hosts (owner ruling
2026-10-10; live since the first deploy): `pliego.madfam.io`, `pliego-app.madfam.io`,
`pliego-api.madfam.io`.
Env names are in [`.env.example`](.env.example) and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Licences

Platform code AGPL-3.0-only; docs MIT (ruling R72); commons objects (`materials/*`, `projects/*`)
CERN-OHL-W-2.0 (owner ruling, 2026-10-10) — declared in two agreeing fields, exceptions
only through [`docs/licenses/CARVE-OUTS.md`](docs/licenses/CARVE-OUTS.md). See
[`docs/licenses/README.md`](docs/licenses/README.md).

## Rulings

Ruled 2026-10-10 by the owner (records kept in MADFAM's private ops repository): the platform name
**Pliego**; the commons **`sheet-hyperobjects`** — a third commons beside the solid and soft commons,
split by kernel; commons object licence CERN-OHL-W-2.0 for `materials/*` and the commons cartridges;
hosts `pliego.madfam.io`, `pliego-app.madfam.io`, `pliego-api.madfam.io` on one service.

### Still pending

Agents prepare to these points and stop: CLA vs DCO for third-party contributions; tiers and prices
(none in this repo until ruled through Tulana and Dhanam); an apex domain; the trademark screen.
