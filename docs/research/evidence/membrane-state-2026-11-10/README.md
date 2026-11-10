# Reference-displacement recovery evidence

Fresh captures at immutable source `92d15aa1c6fcb9527e36fc85562e8dbb99fe3755`, stored durably before
publication. These are **new recovery executions**, not recovered copies of the
unpublished original temporary capture and formal review files. See
[missing-originals.json](missing-originals.json) for known missing identities and
previously recorded digests. A partial prior report hash does not establish old
whole-file equality. Complete previously recorded typed endpoint hashes are
checked separately by the new pipeline/reviewer.

The [result and remaining limits](../../membrane-state-results.md) describe one
retained first-substep witness and an exact dyadic translation control. Both
native/public gates keep the same frozen tolerance. The full 24-trajectory state
matrix, time limit, material calibration, new-model booklet and device/8 ms gates
remain open. Reader/default arithmetic is unchanged.

| Fresh fixture | Native latent residual (microN) | Native public residual (microN) |
|---|---:|---:|
| Witness | 6.976770237088203e-07 | 0.005058552080299705 |
| Exact control | 0 | 0 |

The witness latent gate passes while the original public gate fails. Its public
x/xs/xt reproduce the old failed endpoint; velocity deliberately derives from
latent displacement and differs. The old absolute-position baseline separately
replays all historical x/xs/xt/v bytes. The accepted-update-with-unchanged-whole-
public-pose gate remains false.

All 32 retained final search events are present: [{"accepted":2,"precision-limited-zero-step":14},{"stationary-noop":16}].
The event review covers only these endpoints and the two actual accepted updates,
using native rounded C and real M/h² independently. It does not certify unrecorded
backtracks, a complete trajectory, booklet interaction or device performance.
No force tolerance or ULP allowance is changed.

## What is and is not recovered

The previous driver's exit 1 (mismatched affine/modal comparison reports) and its
comparison-only recovery were observed in the prior chat. Their original raw
terminal/driver/proof bytes are now unavailable. Fresh pipeline records use the
correct immutable legacy baseline and have separate identities; do not describe
that as “zero physics reruns” across the evidence-loss recovery.

The recovered old reference-state.js matches its full previously recorded SHA
`9bb01075fb6b3a1145d9fe65a2af8d0d4f22474490c7ee08185e2992f2b30e79`.
The new corruption control reproduces the oversized-gateOff partial restore; the
fixed source refuses before mutation. These separately labelled new executions
do not recover the old whole-runtime wrapper, original failed-proof JSON or
original reproducer. A new source-based regression is not an original preserved
capture. The initial failed inverse-source candidate and its hash ledger are
retained separately from the exact recovered source.

## Lossless layout and reproduction

[archive-manifest.json](archive-manifest.json) inventories every payload's stored
SHA/length and original-input SHA/length. Raw captures are byte copies. Gzip uses
an empty filename and mtime zero; decompression must match the recorded original
SHA and length. Source wrappers contain exact UTF-8 program bytes as canonical
base64 plus their original SHA/length. Decode them before running; do not execute
the JSON wrapper. The explicit public selection, archive builder and restore-helper sources are
included. This selection is not a full recovery-workspace inventory; local WIP
backups, duplicate module trees and generated caches are not archived inputs.

Use a clean checkout of the pinned source and fresh durable output directories.
The capture driver accepts positional REPO OUTPUT arguments. The scientific
reviewer accepts `--repo REPO --captures CAPTURES --out NEW_PROOF_JSON`.
Those argparse programs offer `--help`; the reconstruction and JS corruption
control below do not. The original committed physics producer and oracle are
available from Git at the pin; no reconstructed oracle or ideal trajectory is
substituted.

To reconstruct every selected raw/gzip/source input at its original relative
identity, first decode `restore-archive-source.json` to a fresh Python file,
checking its wrapper SHA and byte count. Run:

```sh
python3 restore-state-archive.py ARCHIVE FRESH_REPLAY_ROOT
```

This restores the driver beside `captures/`, as required by its independent
reviewer's source binding. It also recreates raw legacy JSON from gzip and all
portable source files. Then run the captured-data reviewer without new physics:

```sh
python3 FRESH_REPLAY_ROOT/independent-review/review-recovered-state.py --repo REPO --captures FRESH_REPLAY_ROOT/captures --out NEW_PROOF_JSON
```

The original observed proof is preserved; the command above produces a NEW
proof. To rerun the explicitly reconstructed snapshot corruption control, use
fresh output and redirect stdout to a fresh proof file:

```sh
python3 FRESH_REPLAY_ROOT/reconstructed-failure/reconstruct-source-v2.py REPO NEW_RECONSTRUCTION_DIR
node FRESH_REPLAY_ROOT/reconstructed-failure/prove-restore-reconstruction.mjs NEW_RECONSTRUCTION_DIR
```

The second command takes the exact reconstruction directory as its single
positional argument. Neither reconstruction command accepts `--help`.

Private raw files, if any, remain outside this public archive with exact digest
and byte-count omission records. They are distinct from artifacts whose original
bytes are missing. Source wrappers are scanned after decoding as well as at the
stored level. No merge, deployment or package publication is part of this phase.

The archive contains 40 selected input payloads, plus this README and its manifest.
