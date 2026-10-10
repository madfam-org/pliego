#!/usr/bin/env python3
"""Workflow supply-chain rules for this public repository.

For every `.github/workflows/*.yml`:

* top-level `permissions` is exactly `contents: read` (a job may widen it for itself);
* every job that runs steps has `runs-on: ubuntu-24.04` (GitHub-hosted only: fork pull requests must
  never reach self-hosted runners, and `ubuntu-latest` moves images) and a `timeout-minutes`;
* every `uses:` (step or reusable workflow) is pinned to a full 40-hex commit SHA, or is a local
  `./` path or a `docker://...@sha256:` image;
* no job passes `secrets: inherit`.

Read-proof: prints the workflows, jobs and `uses:` it checked; zero workflows is a failure.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

PINNED = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$")
RUNNER = "ubuntu-24.04"


def check_uses(ref: str) -> bool:
    return ref.startswith("./") or bool(PINNED.match(ref)) or (ref.startswith("docker://") and "@sha256:" in ref)


def check_workflow(path: Path) -> tuple[list[str], int, int]:
    errors: list[str] = []
    name = path.name
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if data.get("permissions") != {"contents": "read"}:
        errors.append(f"{name}: top-level permissions must be exactly `contents: read` (got {data.get('permissions')!r})")
    jobs = data.get("jobs") or {}
    uses_count = 0
    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            continue
        if job.get("secrets") == "inherit":
            errors.append(f"{name}:{job_id}: `secrets: inherit` is banned; pass named secrets")
        if "uses" in job:
            uses_count += 1
            if not check_uses(str(job["uses"])):
                errors.append(f"{name}:{job_id}: reusable workflow `{job['uses']}` is not pinned to a full SHA")
            continue
        if job.get("runs-on") != RUNNER:
            errors.append(f"{name}:{job_id}: runs-on must be `{RUNNER}` (got {job.get('runs-on')!r})")
        if "timeout-minutes" not in job:
            errors.append(f"{name}:{job_id}: missing timeout-minutes")
        for step in job.get("steps") or []:
            if isinstance(step, dict) and "uses" in step:
                uses_count += 1
                if not check_uses(str(step["uses"])):
                    errors.append(f"{name}:{job_id}: action `{step['uses']}` is not pinned to a full commit SHA")
    return errors, len(jobs), uses_count


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)
    wf_dir = Path(args.root).resolve() / ".github" / "workflows"
    files = sorted(list(wf_dir.glob("*.yml")) + list(wf_dir.glob("*.yaml")))
    errors: list[str] = []
    jobs = uses = 0
    for path in files:
        errs, j, u = check_workflow(path)
        errors += errs
        jobs += j
        uses += u
    if not files:
        errors.append("0 workflows read — refusing to pass on an empty read")
    print(f"supply-chain: workflows={len(files)} jobs={jobs} uses={uses} errors={len(errors)}")
    for err in errors:
        print(f"  FAIL {err}")
    print("supply-chain: " + ("FAIL" if errors else "OK"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
