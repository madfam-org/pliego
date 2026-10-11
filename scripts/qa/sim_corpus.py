#!/usr/bin/env python3
"""Simulation corpus: every commons cartridge's sheet documents, every mode and preset.

Runs `python -m pliego.cartridge <slug> --out <out>/<slug>` (the kernel's own CLI, BRIEF pattern)
for every `<commons>/*/project.json`, in parallel, with this checkout's kernel and materials. The
engine's simulation matrix (`scripts/qa/sim-matrix.mjs`) then reads `<out>/*/*.fold`.

    python scripts/qa/sim_corpus.py --out /tmp/corpus                    # commons = projects/
    python scripts/qa/sim_corpus.py --commons ../sheet-hyperobjects --out /tmp/corpus --jobs 6
    python scripts/qa/sim_corpus.py --out /tmp/corpus --only valley-fold,paper-crane

Read-proof output: one line per cartridge (`sim-corpus: <slug> documents=… verify-errors=… rc=…`)
and a summary line (`sim-corpus: cartridges=… documents=… verify-errors=… failed=…`). It also writes
`<out>/corpus.json` with the same counts. Exit 1 when any cartridge fails or reports an error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERIFY = re.compile(r"^verify: cartridge=(\S+) mode=(\S+) .*errors=(\d+)")


def run_one(slug: str, commons: Path, out: Path, env: dict, timeout: int) -> dict:
    dest = out / slug
    dest.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "pliego.cartridge", slug, "--out", str(dest)]
    try:
        p = subprocess.run(cmd, cwd=commons, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                           text=True, timeout=timeout, check=False)
        rc, text = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        rc, text = -1, f"timeout after {timeout}s"
    (out / f"{slug}.log").write_text(text, encoding="utf-8")
    runs = [m.groups() for m in map(VERIFY.match, text.splitlines()) if m]
    errors = sum(int(e) for _, _, e in runs)
    folds = sorted(f.name for f in dest.glob("*.fold"))
    return {"slug": slug, "rc": rc, "runs": len(runs), "documents": len(folds), "verify_errors": errors}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commons", default=str(ROOT / "projects"), help="sheet-hyperobjects checkout")
    ap.add_argument("--out", required=True, help="output root (one sub-directory per cartridge)")
    ap.add_argument("--kernel", default=str(ROOT / "packages" / "kernel" / "src"))
    ap.add_argument("--materials", default=str(ROOT / "materials"))
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--only", default="", help="comma-separated slugs")
    ap.add_argument("--timeout", type=int, default=600, help="seconds per cartridge")
    a = ap.parse_args(argv)
    commons, out = Path(a.commons).resolve(), Path(a.out).resolve()
    slugs = sorted(p.parent.name for p in commons.glob("*/project.json"))
    if a.only:
        keep = {s.strip() for s in a.only.split(",") if s.strip()}
        slugs = [s for s in slugs if s in keep]
    if not slugs:
        print(f"sim-corpus: FAIL no cartridges under {commons}")
        return 1
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": a.kernel, "PLIEGO_MATERIALS": a.materials}
    with ThreadPoolExecutor(max_workers=a.jobs) as pool:
        rows = list(pool.map(lambda s: run_one(s, commons, out, env, a.timeout), slugs))
    failed = [r["slug"] for r in rows if r["rc"] != 0 or r["verify_errors"] or r["documents"] != r["runs"]]
    for r in rows:
        print(f"sim-corpus: {r['slug']} documents={r['documents']} runs={r['runs']} "
              f"verify-errors={r['verify_errors']} rc={r['rc']}")
    summary = {"cartridges": len(rows), "documents": sum(r["documents"] for r in rows),
               "verify_errors": sum(r["verify_errors"] for r in rows), "failed": failed, "rows": rows}
    (out / "corpus.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(f"sim-corpus: cartridges={summary['cartridges']} documents={summary['documents']} "
          f"verify-errors={summary['verify_errors']} failed={len(failed)}{' ' + ','.join(failed) if failed else ''}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
