# Pliego — agent operating guide

> Last Updated: 2026-10-10

<!-- MADFAM-AGENTS-CANONICAL v1 -->

This is the canonical instruction file for Claude, Codex and any other LLM agent working in this
repository. `CLAUDE.md` is only a compatibility redirect. Public repository: follow the
repo-boundary contract summarised in [`docs/PUBLIC_REPO_BOUNDARY.md`](docs/PUBLIC_REPO_BOUNDARY.md) —
no secrets, no node or network identity, no private runbooks, no prices, no client identities.

## What Pliego is

The platform for **sheet hyperobjects** — origami, kirigami, papercut, pop-up and paper engineering,
book structures and interactive paper dioramas — with real paper physics. Sibling of Yantra4D
(solids) and Fashion Cabinet (garments). Commons: `madfam-org/sheet-hyperobjects`, mounted at
`projects/`. Status: **incubating** (built, not deployed).

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
node --test packages/engine/test/                    # engine (Node ≥ 20, no install step)
```
