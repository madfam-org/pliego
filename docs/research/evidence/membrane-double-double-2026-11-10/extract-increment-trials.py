"""Extract every retained incrementTrial from a complete source-clean modal report.

No engine imports, simulations, event interpolation or unretained-state inference.
Deduplicate only within a trajectory by actual iteration; preserve every case value.
Output directory must not exist; parent must exist. Files use exclusive creation.
"""

import argparse
import hashlib
import json
import os
from collections import Counter
from pathlib import Path


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode() + b"\n"


def extract(report):
    if report.get("schema") != "pliego-membrane-modal-audit/0.1" or report["source"]["dirty"] is not False:
        raise ValueError("complete source-clean modal audit required")
    cases, selections, role_count = [], [], 0
    for geometry in report["results"]:
        for trajectory in geometry["trajectories"]:
            iterations = {}
            for role, record in trajectory["solveObservation"]["snapshots"].items():
                trial = record.get("incrementTrial")
                if trial is None:
                    continue
                role_count += 1
                iteration = record["iteration"]
                case = {**{key: geometry[key] for key in
                            ("vertices", "triangles", "material", "referenceCoefficients")},
                        "grain": geometry["geometry"]["grain"], **trial}
                if iteration in iterations:
                    index = iterations[iteration]
                    if cases[index] != case:
                        raise ValueError("same trajectory/iteration has inconsistent captured trial")
                    selections[index]["roles"].append(role)
                    continue
                iterations[iteration] = len(cases)
                cases.append(case)
                selections.append({**geometry["geometry"],
                                   **{key: trajectory[key] for key in ("level", "budget", "seed", "amplitude")},
                                   "iteration": iteration, "substepsRun": record["substepsRun"],
                                   "roles": [role], "runtimeDecision": trial["runtime"]["decision"]})
    if not cases:
        raise ValueError("no retained actual incrementTrial captures found")
    return cases, selections, role_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    source = Path(args.input)
    raw = source.read_bytes()
    report = json.loads(raw)
    cases, selections, roles = extract(report)
    payload = encode({"cases": cases})
    output = Path(args.out_dir)
    output.mkdir(mode=0o700)  # Atomic fresh directory: no parents/reuse/symlink following.

    def write(name, data):
        descriptor = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)

    write("captured-trials-input.json", payload)
    manifest = {
        "schema": "pliego-increment-captured-trial-extraction/1",
        "producerSHA256": sha(Path(__file__).read_bytes()),
        "inputReport": {"file": source.name, "sha256": sha(raw), "bytes": len(raw),
                        "sourceGit": report["source"]["git"], "sourceDirty": report["source"]["dirty"]},
        "output": {"file": "captured-trials-input.json", "sha256": sha(payload), "bytes": len(payload)},
        "capturedRoleOccurrences": roles, "distinctCapturedEvents": len(cases),
        "sampledDecisions": dict(Counter(value["runtimeDecision"] for value in selections)),
        "selectionPolicy": "ALL retained full incrementTrial event snapshots; deduplicate only by trajectory+iteration; no reconstruction of unsaved endpoint vectors",
        "selections": selections,
        "scope": "lossless extraction from existing captured states, not a simulation or all-search-event acceptance audit",
    }
    write("extraction-manifest.json", encode(manifest))
    print(json.dumps({"distinctCapturedEvents": len(cases), "capturedRoleOccurrences": roles,
                      "captureInputSHA256": sha(payload), "producerSHA256": manifest["producerSHA256"]}))


if __name__ == "__main__":
    main()
