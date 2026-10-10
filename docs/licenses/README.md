# Licences

> Last Updated: 2026-10-10
> Boundary: public. This file reports licence rulings; it does not make any.
> No agent and no maintainer chooses a licence — licences are owner rulings.

| What | Paths | Licence | State |
|---|---|---|---|
| Platform code | `packages/`, `apps/`, `scripts/`, `infra/`, workflows | **AGPL-3.0-only** ([`../../LICENSE`](../../LICENSE)) | ruled |
| Documentation | `docs/`, `README.md` and the other Markdown files | **MIT** ([`MIT-docs.txt`](MIT-docs.txt)), ruling R72 | ruled |
| Commons objects | `materials/*` (stock cards); `projects/*` (the `sheet-hyperobjects` commons) | **CERN-OHL-W-2.0** ([`CERN-OHL-W-2.0.txt`](CERN-OHL-W-2.0.txt)) | ruled 2026-10-10 |
| Schemas consumed from the keystone | `hyperobjects-spec` | Apache-2.0 (in that repository) | ruled there |

Copyright holder for everything MADFAM-authored: Innovaciones MADFAM S.A.S. de C.V., Cuernavaca,
Morelos, México.

## The commons licence (ruled 2026-10-10)

The owner ruled on 2026-10-10 that sheet commons objects — Pliego's `materials/*` stock cards and
every cartridge in `sheet-hyperobjects` — are **CERN-OHL-W-2.0**, the same licence the sibling
commons carry. The dated decision record is kept in MADFAM's private ops repository. Any deviation
for a single object requires its own owner ruling, recorded as a carve-out below.

Still pending: how third-party contributions are signed off (CLA vs DCO). Until that is ruled, the
commons does not merge third-party objects.

The text in [`CERN-OHL-W-2.0.txt`](CERN-OHL-W-2.0.txt) is the canonical CERN text as published
in GitHub's licence catalogue (the text GitHub's detector matches), checked word for word against
the SPDX license-list-data copy. Its preamble reads "this licence, CERN-OHL-W (weakly
reciprocal)". Do not substitute a copy from another repository: one sibling commons ships the
strongly reciprocal preamble under a weakly reciprocal title.

## How an object declares it

Every manifest carries the SPDX identifier in **two** fields that must both be present and agree:

```json
{
  "project":     { "attribution": { "license": "CERN-OHL-W-2.0", "lineage": [] } },
  "hyperobject": { "commons_license": "CERN-OHL-W-2.0" }
}
```

`attribution.lineage[]` is required from object number one (an empty list means "original work";
heritage objects list their sources and communities). Objects do not ship a per-directory
`LICENSE` or `COPYING`. `scripts/qa/verify_compliance.py` enforces both rules on every manifest
it can read and on every stock card.

## Carve-outs

An object genuinely derived from a third-party source whose licence CERN-OHL-W-2.0 cannot satisfy
needs an owner-ruled entry in [`CARVE-OUTS.md`](CARVE-OUTS.md). A manifest whose licence differs
and whose slug is not registered there is a hard error. The registry is empty, which is the
correct state.
