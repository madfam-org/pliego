"""Optional independent component comparison; install ipctk==1.4.0 in an isolated venv.

This is not a full paper solver or an assertion that a floating-point reference
is exact. Exceptions/non-finite reference values remain visible in the report.
"""

import argparse
import hashlib
import importlib.metadata
import json
import math
import sys
from pathlib import Path

import ipctk
import numpy as np


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--install-report",
        type=Path,
        help="Optional pip --report JSON; retain only public wheel provenance",
    )
    args = parser.parse_args()
    payload = args.input.read_bytes()
    source = json.loads(payload)
    if source["schema"] != "pliego-contact-distance-input/0.1" or not source["cases"]:
        raise ValueError("Expected nonempty Pliego distance input")
    worst = 0.0
    failures = []
    nonfinite = []
    count = {"vertex-triangle": 0, "edge-edge": 0}
    for case in source["cases"]:
        points = np.asarray(case["coordinates"], dtype=np.float64).reshape(4, 3)
        fn = (
            ipctk.point_triangle_distance
            if case["kind"] == "vertex-triangle"
            else ipctk.edge_edge_distance
        )
        count[case["kind"]] += 1
        try:
            reference = float(fn(*points))
        except (RuntimeError, ValueError, TypeError, ArithmeticError) as error:
            nonfinite.append(
                {
                    "id": case["id"],
                    "nativeSquared": case["squared"],
                    "error": str(error),
                }
            )
            continue
        if not math.isfinite(reference):
            nonfinite.append(
                {
                    "id": case["id"],
                    "nativeSquared": case["squared"],
                    "error": "non-finite reference result",
                }
            )
            continue
        normalized = abs(case["squared"] - reference) / max(
            case["scaleSquared"], 1e-300
        )
        worst = max(worst, normalized)
        if normalized > 1e-10:
            failures.append(
                {
                    "id": case["id"],
                    "nativeSquared": case["squared"],
                    "referenceSquared": reference,
                    "normalizedError": normalized,
                }
            )
    report = {
        "schema": "pliego-contact-distance-reference/0.1",
        "source": source["source"],
        "inputSHA256": sha(payload),
        "referenceScriptSHA256": sha(Path(__file__).read_bytes()),
        "reference": {
            "package": "ipctk",
            "version": importlib.metadata.version("ipctk"),
            "numpy": np.__version__,
            "python": sys.version.split()[0],
            "binarySHA256": sha(Path(ipctk.__file__).read_bytes()),
            "upstream": "https://github.com/ipc-sim/ipc-toolkit",
        },
        "cases": count,
        "finiteComparisons": sum(count.values()) - len(nonfinite),
        "tolerance": "absolute squared-distance difference / stencil diameter squared <= 1e-10",
        "maximumNormalizedError": worst,
        "disagreements": failures,
        "referenceUnavailable": nonfinite,
        "scope": "distance components only; not CCD certification, physical calibration, full solver or equal-error performance",
    }
    if args.install_report:
        installs = json.loads(args.install_report.read_bytes())["install"]
        report["reference"]["wheels"] = [
            {
                "name": item["metadata"]["name"],
                "version": item["metadata"]["version"],
                "url": item["download_info"]["url"],
                "sha256": item["download_info"]["archive_info"]["hashes"]["sha256"],
            }
            for item in installs
        ]
    text = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        print(text, end="")
    print(
        f"contact-reference: queries={sum(count.values())} disagreements={len(failures)} "
        f"unavailable={len(nonfinite)} max-normalized-error={worst}",
        file=sys.stderr,
    )
    return 1 if failures or nonfinite else 0


if __name__ == "__main__":
    raise SystemExit(main())
