# Ecosystem roles

> Last Updated: 2026-10-10
>
> Boundary checkpoint (2026-10-10): roles only. MADFAM's private ops repository owns topology,
> operator procedures and secret handling; see the repo-boundary contract summarised in
> [docs/PUBLIC_REPO_BOUNDARY.md](docs/PUBLIC_REPO_BOUNDARY.md).

Pliego is one product in the MADFAM ecosystem. It **owns** sheet domain data — crease patterns,
cut graphs, fold programs, pop-up mechanisms, paper stock cards and papercut motif libraries —
and the physics that animates them. Everyone else queries it; nobody forks it.

It **consumes** everything else and never re-implements it:

| Capability | Owner | How Pliego uses it |
|---|---|---|
| Solid hardware (brads, eyelets, rivets, magnets, stands, scoring jigs) | Yantra4D (`solid-hyperobjects`) | `hardware_ref` by slug and params; never modelled here |
| Textiles (book cloth, ribbons, binding thread) | Fashion Cabinet (`soft-hyperobjects`) | `material_ref` to a fabric card (keystone change pending) |
| Validation of commons objects | hyperobjects-spec | `pliego-spec check` at a pinned SHA |
| Sign-in, sessions | Janua (`auth.madfam.io`) | OIDC authorization code with PKCE; RS256 tokens verified through JWKS |
| Catalog, checkout, entitlements | Dhanam | Later, after pricing evidence; no payment keys or prices here |
| Pricing | Tulana | Evidence-forged; never ad hoc |
| CFDI | Karafiel | SKU mapping before any sale |
| LLM text (crease-pattern assistant, diagram text) | Selva | OpenAI-compatible `/v1` gateway only; inert until configured, fail closed |
| Quotes for printed, laser-cut and die-cut runs | Cotiza | Cut files and BOM sent for a quote; never priced locally |
| Fabrication dispatch (laser cutters, drag-knife plotters, die-cutting) | Pravara MES | Dispatch through its protocol matrix; never drive a machine directly |
| Generative printed art | ceq | Texture passes for a sheet's `art` layer |
| Messaging and email | Angelia Courier | Never direct |
| Deploy, DNS, secrets, status | Enclii | Everything runtime (`enclii.yaml`) |
| Analytics | Self-hosted Plausible | Cookieless |
