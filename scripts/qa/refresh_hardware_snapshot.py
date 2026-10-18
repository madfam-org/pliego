#!/usr/bin/env python3
"""Refresh Pliego's vendored Yantra4D hardware snapshot (spec §5.42; bridge handshake rule 1).

``packages/kernel/src/pliego/data/yantra4d-hardware.snapshot.json`` is a version-pinned slice of
Yantra4D's published ``docs/commons-catalog.json``: the parts sheet cartridges name by
``hardware_ref``. The kernel checks every reference against it, name-level, offline. Refreshing
is a deliberate, reviewable commit that records the upstream commit (Fashion Cabinet's
``refresh_hardware_snapshot.py`` convention).

What is vendored is derived, not curated: every ``project_slug`` the mounted commons claims
(``projects/*/project.json`` top-level ``hardware_ref``), plus the slugs already in the snapshot,
plus any ``--slug`` given (a claim made ahead of its cartridge landing). A claimed slug missing
upstream is a hard error.

    gh api repos/madfam-org/yantra4d/commits/main --jq .sha           # the commit to pin
    gh api "repos/madfam-org/yantra4d/contents/docs/commons-catalog.json?ref=<sha>" \\
        -H "Accept: application/vnd.github.raw" > /tmp/y4d.json
    python3 scripts/qa/refresh_hardware_snapshot.py --from-path /tmp/y4d.json --pin-commit <sha>

``--check`` (no catalog needed) verifies the snapshot's shape and that every commons claim is in
it. Read-proof line: ``hardware-snapshot: parts=N claims=C missing=M upstream=<sha12>``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "packages/kernel/src/pliego/data/yantra4d-hardware.snapshot.json"
SCHEMA = "commons_catalog_v1"
KEEP = ("slug", "name", "domain", "mode_ids", "parameter_ids", "parameter_contracts",
        "commons_license")
COMMENT = ("Pinned slice of yantra4d's docs/commons-catalog.json that Pliego hardware_ref blocks "
           "resolve against, name-level (spec §5.42). The slug set is DERIVED from the commons' "
           "own claims plus the slugs already here; refresh with "
           "scripts/qa/refresh_hardware_snapshot.py and record the upstream commit. Do NOT "
           "hand-edit an entry. Data from an AGPL-3.0 platform repository; the parts themselves "
           "are commons objects under the licence each entry states.")


def claims(root: Path = ROOT / "projects") -> set[str]:
    out = set()
    for manifest in sorted(root.glob("*/project.json")):
        try:
            ref = json.loads(manifest.read_text(encoding="utf-8")).get("hardware_ref")
        except ValueError:
            continue
        if isinstance(ref, dict) and isinstance(ref.get("project_slug"), str):
            out.add(ref["project_slug"])
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--from-path", help="yantra4d docs/commons-catalog.json")
    ap.add_argument("--pin-commit", help="the yantra4d commit that file was read at")
    ap.add_argument("--slug", action="append", default=[], help="also vendor this slug")
    ap.add_argument("--check", action="store_true", help="verify without refreshing")
    args = ap.parse_args(argv)
    old = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.is_file() else {}
    wanted = claims() | set(old.get("cartridges") or {}) | set(args.slug)
    if args.check:
        parts = old.get("cartridges") or {}
        missing = sorted(wanted - set(parts))
        bad = [s for s, e in parts.items() if not isinstance(e, dict) or e.get("slug") != s
               or not isinstance(e.get("parameter_ids"), list)]
        print(f"hardware-snapshot: parts={len(parts)} claims={len(claims())} "
              f"missing={len(missing)} upstream={str(old.get('upstream_commit'))[:12]}")
        for s in missing:
            print(f"hardware-snapshot: claimed slug {s!r} is not vendored", file=sys.stderr)
        for s in bad:
            print(f"hardware-snapshot: entry {s!r} is malformed", file=sys.stderr)
        ok = (old.get("catalog_schema_version") == SCHEMA and parts and not missing and not bad
              and re.fullmatch(r"[0-9a-f]{40}", str(old.get("upstream_commit", ""))))
        return 0 if ok else 1
    if not args.from_path or not re.fullmatch(r"[0-9a-f]{40}", args.pin_commit or ""):
        ap.error("--from-path and a full 40-hex --pin-commit are required to refresh")
    catalog = json.loads(Path(args.from_path).read_text(encoding="utf-8"))
    if catalog.get("schema_version") != SCHEMA:
        print(f"hardware-snapshot: FAIL catalog is not {SCHEMA}", file=sys.stderr)
        return 1
    upstream = {c["slug"]: c for c in catalog.get("cartridges") or [] if isinstance(c, dict)}
    missing = sorted(wanted - set(upstream))
    if missing:
        print(f"hardware-snapshot: FAIL claimed slugs missing upstream: {missing}",
              file=sys.stderr)
        return 1
    data = {"_comment": COMMENT, "upstream_repo": "https://github.com/madfam-org/yantra4d",
            "upstream_commit": args.pin_commit, "catalog_schema_version": SCHEMA,
            "cartridges": {s: {k: upstream[s][k] for k in KEEP if k in upstream[s]}
                           for s in sorted(wanted)}}
    SNAPSHOT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"hardware-snapshot: parts={len(wanted)} claims={len(claims())} missing=0 "
          f"upstream={args.pin_commit[:12]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
