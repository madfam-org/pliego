# Fixed-24 panel bending capture evidence

All selected original reports, receipts and reviewers are preserved losslessly.
`manifest.json` records stored and decoded SHA-256 and length. The three large raw
reports use deterministic gzip (level 6, empty filename, mtime 0); other selected
files keep their exact original bytes. Durable originals remain outside the repo.

Verify: `python3 tools/restore-bending-matrix-archive.py --archive ARCHIVE`.
Restore: append `--out FRESH_DIR`; original identities are restored beneath it.
The manifest needs an external publication hash because it cannot hash itself.

The fixed bending matrix has 24 trajectories, 7200 judged poststeps and 50400
declared Newton iterations per capture, plus 24 separate restore-control calls
(168 declared iterations). Candidate, repeat and plain are separate runs. Process
wall receipts are untimed research bookkeeping.

Selected endpoint and Newton proofs certify only their stated samples. Public
force, latent force, time, material, booklet and interaction gates keep their
original meanings and all failures. No all-event real-Armijo, calibrated paper
stock, full-booklet or performance acceptance follows from this archive.

The frozen runner and plan live under `run/`. The selected-Newton reviewer and its
source wrappers live under `independent-review/`; it supports
`--repo REPO --input CANDIDATE_JSON --out FRESH_DURABLE_PROOF`. The builder and
restorer preserve bytes and execute no physics or oracle. Optional supplements are
listed explicitly; this archive does not claim every development file was selected.
