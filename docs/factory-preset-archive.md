# Offline native factory preset archive (draft)

`scripts/qa/factory_preset_archive.py` is an opt-in producer/checker for the
consumer exchange `factory-preset-archive/0.1`. This is a draft adapter, not a
ratified keystone contract, GOC-equivalence claim, API endpoint or deployed feed.
It evaluates trusted commons source with Pliego's native kernel and exporters.
It does not generate geometry in a gallery consumer.

Run with Python 3.11+; the kernel has no third-party dependencies. No install is
needed when running from a populated platform checkout. Provide exact full
40-character commits for both the commons and platform runtime:

```sh
python scripts/qa/factory_preset_archive.py \
  --commons /path/to/sheet-hyperobjects --pin FULL_COMMONS_COMMIT \
  --runtime-pin FULL_PLATFORM_COMMIT \
  --slug retention-insert --preset atari-2600-envelope --mode insert \
  --params '{"clearance": 1.5}' --out /path/to/empty-archive

python scripts/qa/factory_preset_archive.py \
  --check /path/to/empty-archive --commons /path/to/sheet-hyperobjects \
  --pin FULL_COMMONS_COMMIT --replay
```

The explicit source commit is read through Git, not the commons working tree.
The current kernel, vendored data, material cards and kernel project metadata
must match the claimed runtime commit byte for byte. The producer copies that
closure and the entire selected cartridge directory into the archive. Closure
records retain repository-relative `path`, `sha256`, and an archive-relative
`archive_path`; assets use archive-relative `path`, `sha256`, and `bytes`.
Archive paths cannot escape the output directory. Existing nonempty output
directories are rejected so previous assets cannot silently survive.

Each entry carries source identity, mode/preset, actual native sheet IDs in
`parts`, resolved parameters, native document digest, runtime closure and a
runtime fingerprint. Python implementation/version is recorded. This is not a
hermetic interpreter/stdlib image; the runtime scope says so explicitly.
`entry_digest` is an unsigned cache content hash, not authentication.

`source.params` is the **effective requested tuple**: selected `preset.values`
merged with explicit caller overrides, before native normalization. An explicit
override wins and its raw JSON type is preserved. `source.caller_params` retains
only caller overrides. `source.preset` identifies the selected preset. For the
reserved `default` selection, requested values are just caller overrides;
manifest defaults are separate. `resolved_parameters` contains manifest
defaults, preset and requested values, then the named parameter globals after
the native generator normalizes/clamps them. The document records those values
too. Generator-internal derived geometry is not a parameter-resolution claim.
Cartridges that conceal normalization in unrelated local aliases need a native
resolution hook before those aliases can be represented as resolved inputs.

The archive provides:

- `assets.fold`: authoritative native **flat** FOLD document, mm, layout y-up,
  plus its fold program and native provenance. No closed mesh replaces it.
- `assets.glb`: native animated GLB, metres, world Y-up, right-handed. The native
  exporter uses scale `.001` from source mm, recorded in GLB asset extras and
  inspected by the checker. Animation clip names and morph-target counts are
  inspected from the actual GLB, not inferred from a preset name.
- `assets.svg`: native fabrication/diagram fallback in mm, y-down SVG canvas.
  It is presentation, not a world-space 3D part or a physical-fit measurement.

Ordinary cartridge CLI GLB output is static; this adapter explicitly requests
native `animate=True`. Construction clips are not automatically opening clips.
A `control:slide` clip can expose sleeve travel; a booklet's native
nest/staple/shut sequence is not an authored page-reading phase. No retail
package measurements, collision-checked physical fit, artwork or SKU/experience
bindings are inferred here. Those consumer bindings stay outside the factory.

`--check` verifies nonempty entries, content hashes, effective request metadata,
native part/parameter identity, unit/frame declarations, GLB scale/animation
claims, coverage and closure integrity. `--commons` additionally compares the
captured source bytes to the exact Git commit. `--replay` requires the captured
runtime revision and Python version, reruns the native generator, and requires
byte-identical FOLD/GLB/SVG plus matching resolved parameters. Self-contained
hash validation alone authenticates neither a claimed Git pin nor its author.

Every successful run prints an entry count; empty reads fail. Tests in
`scripts/qa/tests/test_factory_preset_archive.py` exercise wrong commits, stale
assets/closure, wrong frames, unscaled GLB, named-preset request separation,
requested versus resolved values and output path traversal.
