# Public repository boundary

> Last Updated: 2026-10-10

Pliego is a **public** repository (AGPL-3.0-only code, MIT docs). It owns the sheet-hyperobject
platform: the kernel, the physics engine, the studio, the API, their schemas, specs and
compliance lanes. Authored objects live in the
[`sheet-hyperobjects`](https://github.com/madfam-org/sheet-hyperobjects) commons.

Keep here: reusable code, public schemas and specs, product documentation, synthetic test
fixtures, secret **names**, and deployment manifests with placeholder digests.

Never put here:

- secret values, tokens, `jnc_` client-id literals or credentials of any kind;
- node hostnames, IP addresses, hardware, cluster names or tunnel ids;
- secret-store paths or break-glass procedures (production operations are Enclii-first);
- raw links into MADFAM's private ops repository (name a document, never link it);
- hand-typed prices, tiers or quotes (pricing is ruled through Tulana and Dhanam; quotes come from Cotiza);
- client identities, people's names beyond the public maintainer handles, or private evidence;
- local packages named `@madfam/*` (use `@pliego/*`; only `@pliego/engine` is published, to MADFAM's registry
  per the owner ruling of 2026-10-22, and every other local package stays `"private": true`).

Enclii owns routine deployment, observability and secret intake. Record missing platform
capabilities privately; do not add a raw production-access fallback. Licensing, governance,
naming and access rulings remain with the owner. A test skip or an unavailable dependency is not
verification, and a pending CI run is not green.

Canonical policy: the MADFAM repository boundary contract, kept in MADFAM's private ops
repository. The [public ecosystem contract hub](https://github.com/madfam-org/solarpunk-foundry)
owns shared public ecosystem guidance.
