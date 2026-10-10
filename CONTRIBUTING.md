# Contributing

> Boundary checkpoint (2026-10-10): public guide. Operational detail stays out of this repository
> per the repo-boundary contract ([docs/PUBLIC_REPO_BOUNDARY.md](docs/PUBLIC_REPO_BOUNDARY.md)).

Thank you for helping paper move. Before you open a pull request:

1. **Read [AGENTS.md](./AGENTS.md)** for the doctrine, the ownership table and the CI lanes.
2. **Objects go to the commons.** A new fold, pop-up mechanism or diorama is a cartridge in
   [`sheet-hyperobjects`](https://github.com/madfam-org/sheet-hyperobjects), not code here.
   This repository is the platform: kernel, engine, studio, API and their lanes.
3. **Keep the contract.** Changes to `docs/spec/**` or the sheet-document schema go through the
   coordinator; propose them in an issue first.
4. **Run the checks** that apply to what you changed (AGENTS.md, "Commands"). Keep every source file
   under 600 lines.
5. **No prices, no client names, no secrets,** and no solid-modeling dependency.
6. **One concern per pull request,** with a clear English title and a body that says why.

**Licence.** Contributions are accepted under the project licence (AGPL-3.0-only for code, MIT for
docs): inbound equals outbound. How third-party contributions are signed off (CLA or DCO) is a
pending owner ruling; until it is made, third-party merges wait.
