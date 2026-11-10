# Reproducing the recovered state experiment

Use a clean checkout of source `92d15aa1c6fcb9527e36fc85562e8dbb99fe3755`,
Node >=20 and Python3. The evidence bundle lives in the later publication commit;
keep its files outside the clean source checkout used by the capture guards.
Choose fresh persistent output paths, outside that checkout. These commands
produce new records; they cannot restore the missing original proof JSON.

The four source wrappers below contain exact program bytes and their complete
SHA256/length. Decode only these tools into a fresh directory; the other source
wrappers include alternative versions of the same module and should not be
blindly extracted over one another.

```python
# Run as: python3 decode_tools.py EVIDENCE_DIRECTORY FRESH_TOOLS_DIRECTORY
import base64, hashlib, json, sys
from pathlib import Path
bundle, tools = map(Path, sys.argv[1:])
tools.mkdir(mode=0o700)
for name in ["capture-pipeline-source.json", "independent-recovery-review-source.json",
             "reconstruct-source-v2-source.json", "restore-reconstruction-review-source.json"]:
    wrapper = json.loads((bundle / name).read_bytes())
    raw = base64.b64decode(wrapper["base64"], validate=True)
    assert len(raw) == wrapper["bytes"]
    assert hashlib.sha256(raw).hexdigest() == wrapper["sha256"]
    identity = wrapper["identity"]
    assert identity == Path(identity).name
    with (tools / identity).open("xb") as output:
        output.write(raw)
```

The capture driver and independent reviewer use Python argparse. The inverse
reconstruction uses positional arguments, and the corruption reproducer is a
Node ES module. Only the argparse programs provide `--help`.

```bash
PLIEGO_REPO=/path/to/clean/pliego
PLIEGO_TOOLS=/persistent/decoded-reviewers
PLIEGO_CAPTURES="$PLIEGO_TOOLS/captures"
PLIEGO_RECONSTRUCTION="$PLIEGO_TOOLS/reconstruction"

python3 "$PLIEGO_TOOLS/run-recovery-captures.py" "$PLIEGO_REPO" "$PLIEGO_CAPTURES"
python3 "$PLIEGO_TOOLS/review-recovered-state.py" --repo "$PLIEGO_REPO" --captures "$PLIEGO_CAPTURES" --out "$PLIEGO_TOOLS/review-proof.json"
python3 "$PLIEGO_TOOLS/reconstruct-source-v2.py" "$PLIEGO_REPO" "$PLIEGO_RECONSTRUCTION"
node "$PLIEGO_TOOLS/prove-restore-reconstruction.mjs" "$PLIEGO_RECONSTRUCTION"
```

Keep the driver beside the captures directory, as shown: the reviewer verifies
its exact bytes through that parent-directory relationship.

The capture driver writes two raw probe reports, both oracle precisions, all six
command terminal records, a 108-case historical comparison and its final terminal
manifest. It refuses a non-clean/non-pinned source or existing capture directory.
The independent reviewer reads those files and does not rerun physics. The inverse
program verifies the full previously recorded old source hash before generating
isolated reconstructed/fixed runtime trees. The new corruption control calls
restore/snapshot only; it never steps the physics solver. Original whole-runtime
context and original old proof/reproducer bytes remain unavailable.

The [archive manifest](evidence/membrane-state-2026-11-10/archive-manifest.json)
binds all published bytes and gzip reconstruction. The
[missing-original ledger](evidence/membrane-state-2026-11-10/missing-originals.json)
separates unknown originals from exact recovered source and new executions.
See the [results and retained failed gates](membrane-state-results.md) before
interpreting a successful integrity review as physical or interactive acceptance.
