#!/usr/bin/env python3
"""The build-deploy change filter must match what the image actually contains.

`.github/workflows/build-deploy.yml` passes Enclii's build-publish a `services` JSON whose `paths`
decide when a push rebuilds the image. If a Dockerfile COPY source is missing from `paths`, a change
to it ships nothing (a silent missed deploy); if `paths` names something the image never copies,
pushes rebuild for nothing. So for every service:

* every COPY source in its Dockerfile (build stage and final stage, `--from=` copies excluded) is
  covered by a `paths` entry (directory prefix or exact file), and
* every `paths` entry covers at least one COPY source, or is the Dockerfile / `.dockerignore`.

Read-proof: prints the services, COPY sources and paths it compared; zero of any is a failure.
"""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

import yaml

ALWAYS_OK = {".dockerignore"}


def dockerfile_copy_sources(text: str) -> list[str]:
    """COPY/ADD sources from a Dockerfile, normalised (no leading ./, no trailing /)."""
    sources: list[str] = []
    logical: list[str] = []
    buf = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        logical.append(buf + line)
        buf = ""
    for line in logical:
        parts = line.split(None, 1)
        if len(parts) < 2 or parts[0].upper() not in {"COPY", "ADD"}:
            continue
        rest = parts[1].strip()
        if rest.startswith("["):
            tokens = json.loads(rest)
        else:
            tokens = shlex.split(rest)
        flags = [t for t in tokens if t.startswith("--")]
        args = [t for t in tokens if not t.startswith("--")]
        if any(f.startswith("--from") for f in flags) or len(args) < 2:
            continue
        for src in args[:-1]:
            src = src.removeprefix("./").rstrip("/")
            if src and src != ".":
                sources.append(src)
    return sources


def covers(entry: str, path: str) -> bool:
    entry = entry.removeprefix("./").rstrip("/")
    return path == entry or path.startswith(entry + "/")


def workflow_services(workflow: dict) -> list[dict]:
    for job in (workflow.get("jobs") or {}).values():
        uses = str(job.get("uses", ""))
        if "build-publish.yml" in uses:
            raw = (job.get("with") or {}).get("services", "[]")
            return json.loads(raw)
    return []


def compare(root: Path, workflow_path: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8")) or {}
    services = workflow_services(workflow)
    counts = {"services": len(services), "copy_sources": 0, "paths": 0}
    if not services:
        errors.append(f"{workflow_path.name}: no build-publish `services` found")
    for svc in services:
        name = svc.get("name", "?")
        dockerfile = svc.get("dockerfile", "Dockerfile")
        context = svc.get("context", ".").rstrip("/") or "."
        df_path = root / dockerfile
        if not df_path.is_file():
            errors.append(f"{name}: Dockerfile {dockerfile} does not exist")
            continue
        prefix = "" if context == "." else context + "/"
        sources = [prefix + s for s in dockerfile_copy_sources(df_path.read_text(encoding="utf-8"))]
        paths = str(svc.get("paths", "")).split()
        counts["copy_sources"] += len(sources)
        counts["paths"] += len(paths)
        if not sources:
            errors.append(f"{name}: {dockerfile} has no COPY sources")
        if not paths:
            errors.append(f"{name}: no `paths` (the reusable workflow would rebuild on every push)")
        for src in sources:
            if not any(covers(entry, src) for entry in paths):
                errors.append(f"{name}: COPY source `{src}` is not in paths (a change to it would deploy nothing)")
        for entry in paths:
            norm = entry.removeprefix("./").rstrip("/")
            if norm in ALWAYS_OK or norm == dockerfile:
                continue
            if not any(covers(entry, src) or covers(src, norm) for src in sources):
                errors.append(f"{name}: paths entry `{entry}` matches no COPY source (rebuilds for nothing)")
    if counts["copy_sources"] == 0 or counts["paths"] == 0:
        errors.append("compared 0 COPY sources or 0 paths — refusing to pass on an empty read")
    return errors, counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--workflow", default=".github/workflows/build-deploy.yml")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    errors, counts = compare(root, root / args.workflow)
    print("deploy-paths: " + " ".join(f"{k}={v}" for k, v in counts.items()) + f" errors={len(errors)}")
    for err in errors:
        print(f"  FAIL {err}")
    print("deploy-paths: " + ("FAIL" if errors else "OK"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
