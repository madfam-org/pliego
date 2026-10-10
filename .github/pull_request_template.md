## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Boundary checklist

This is a public repository (docs/PUBLIC_REPO_BOUNDARY.md). Tick each line or explain below why it does not apply.

- [ ] No secret values, tokens, client-id literals or credentials anywhere in the diff, the PR body or CI logs.
- [ ] No cluster topology: no node names, IP addresses, hardware, tunnel ids, secret-store paths or private runbook content.
- [ ] No prices, tiers or quotes; no client identities; no people's names beyond public maintainer handles.
- [ ] No raw links into MADFAM's private ops repository.
- [ ] Ecosystem seams are consumed, not rebuilt (Janua, Dhanam, Selva, Cotiza, Pravara MES, Angelia Courier, Enclii).
- [ ] No solid-modeling dependency; hardware stays a `hardware_ref` to Yantra4D.
- [ ] The sheet-document contract (`docs/spec/**`) is unchanged, or the coordinator approved the change.
- [ ] `docs/HONEST_STATUS.md` still tells the truth after this change; AGENTS.md is updated if a rule changed.

## Tests

- [ ] New or changed behaviour has tests, and the CI jobs that cover the touched paths are green (a printed `skip:` is not green for code this PR adds).
- [ ] Workflows, manifests or `scripts/qa` changed: `python -m unittest discover -s scripts/qa/tests` passes.

## Notes for the reviewer

<!-- Anything surprising, anything skipped and why, follow-ups. -->
