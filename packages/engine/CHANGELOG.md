# Changelog — `@pliego/engine`

> Boundary: public package (AGPL-3.0-only). Format: newest first; versions follow semver, and while the major is 0 a
> minor bump may break the API or the simulated numbers (see README «Package»).

## 0.1.0 — unreleased (first published version)

First version published to MADFAM's registry (`npm.madfam.io`, scope `@pliego`), after the owner ruled on
2026-10-22 that the engine is a package other platforms consume rather than copy. The code is the engine as it
runs in the studio at this commit; nothing in `src/` changed for publishing.

- Public API: `loadDocument`, `DocumentError`, `buildMesh`, `defaultMeshEdge`, `locatePoint`, the `HINGE_*`
  constants, `World`, `dihedral`, and the namespaces `kinematics`, `materials` and `constants`;
  `ENGINE_KIND` / `ENGINE_VERSION` (equal to this file's version; test `package`).
- TypeScript declarations generated from the JSDoc (`types/`), shipped with the tarball.
- Zero runtime dependencies; plain ES modules for Node 20+ and browsers.
