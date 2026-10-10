#!/usr/bin/env python3
"""Commons pin guard: `projects/` must be the pinned, populated sheet-hyperobjects submodule.

Why this runs FIRST in every job that reads `projects/`: an uninitialised git submodule is an
empty directory, and an empty directory makes every glob-based lane green ("checked 0 cartridges,
0 errors"). This guard turns that silent pass into a visible failure.

States, each printed as one read-proof line:

* ``mounted``      — `.gitmodules` maps `projects` to the commons, the index holds a gitlink
                     (mode 160000) at a full SHA, and the checked-out commons HEAD equals it.
* ``empty``        — the gitlink exists but `projects/` holds no checkout: ALWAYS a failure.
* ``unmounted``    — no gitlink yet (the commons is not mounted in this repository): a printed
                     ``skip:`` in report mode, a failure with ``--require``.
* ``drift``        — the checked-out commons HEAD differs from the pinned SHA: a failure.

``--min-cartridges N`` additionally fails when fewer than N ``projects/*/project.json`` exist
(scoped glob, never recursive). Exit 0 only when every requested property holds.
"""

from __future__ import annotations

import argparse
import configparser
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

COMMONS_REPO = "sheet-hyperobjects"
MOUNT = "projects"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


@dataclass
class PinState:
    state: str
    detail: str
    pinned_sha: str | None = None
    cartridges: int = 0


def _git(root: Path, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), *args], check=True, capture_output=True, text=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout


def gitmodules_url(root: Path) -> str | None:
    """URL `.gitmodules` assigns to the `projects` path, or None."""
    path = root / ".gitmodules"
    if not path.is_file():
        return None
    parser = configparser.ConfigParser()
    try:
        parser.read(path, encoding="utf-8")
    except configparser.Error:
        return None
    for section in parser.sections():
        if parser.get(section, "path", fallback="").strip() == MOUNT:
            return parser.get(section, "url", fallback="").strip() or None
    return None


def gitlink_sha(root: Path) -> str | None:
    """SHA recorded in the index for `projects` when it is a gitlink (mode 160000)."""
    out = _git(root, "ls-files", "--stage", "--", MOUNT)
    if not out:
        return None
    for line in out.splitlines():
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if path == MOUNT and len(parts) >= 2 and parts[0] == "160000":
            return parts[1]
    return None


def count_cartridges(root: Path) -> int:
    base = root / MOUNT
    if not base.is_dir():
        return 0
    return sum(1 for p in base.glob("*/project.json") if p.is_file())


def has_checkout(root: Path) -> bool:
    base = root / MOUNT
    if not base.is_dir():
        return False
    # A checked-out submodule always carries its `.git` file; an uninitialised one is a bare dir.
    return (base / ".git").exists()


def inspect(root: Path) -> PinState:
    url = gitmodules_url(root)
    sha = gitlink_sha(root)
    if sha is None:
        if url:
            return PinState("unmounted", f".gitmodules names {MOUNT} ({url}) but the index holds no gitlink")
        return PinState("unmounted", f"no gitlink at {MOUNT}/ (commons not mounted in this repository)")
    if not url:
        return PinState("drift", f"gitlink {sha[:12]} at {MOUNT}/ but .gitmodules does not map it", sha)
    if not url.rstrip("/").removesuffix(".git").endswith(COMMONS_REPO):
        return PinState("drift", f"{MOUNT}/ points at {url}, not the {COMMONS_REPO} commons", sha)
    if not FULL_SHA.match(sha):
        return PinState("drift", f"gitlink {sha!r} is not a full 40-hex SHA", sha)
    if not has_checkout(root):
        return PinState(
            "empty",
            f"{MOUNT}/ is an EMPTY gitlink dir (pinned {sha[:12]}); check out with submodules "
            f"(actions/checkout `submodules: true`, or `git submodule update --init {MOUNT}`)",
            sha,
        )
    head = _git(root / MOUNT, "rev-parse", "HEAD")
    head = head.strip() if head else None
    cartridges = count_cartridges(root)
    if head != sha:
        return PinState("drift", f"{MOUNT}/ HEAD {head!r} != pinned {sha}", sha, cartridges)
    return PinState("mounted", f"{MOUNT}/ at pinned {sha[:12]}", sha, cartridges)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".", help="repository root (default: .)")
    ap.add_argument("--require", action="store_true", help="fail when the commons is not mounted")
    ap.add_argument("--min-cartridges", type=int, default=0, help="fail below this many cartridges")
    args = ap.parse_args(argv)

    st = inspect(Path(args.root).resolve())
    print(f"commons-pin: state={st.state} cartridges={st.cartridges} pinned={st.pinned_sha or '-'}")
    print(f"  {st.detail}")
    if st.state == "unmounted" and not args.require:
        print(f"skip: {MOUNT}/ is not mounted yet; nothing in this job reads the commons")
        return 0
    if st.state != "mounted":
        print(f"commons-pin: FAIL ({st.state})")
        return 1
    if st.cartridges < args.min_cartridges:
        print(f"commons-pin: FAIL cartridges={st.cartridges} < required {args.min_cartridges}")
        return 1
    print("commons-pin: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
