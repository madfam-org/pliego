#!/usr/bin/env python3
"""Sheet-behaviour drift gate (RFC 0045 phase 2; spec §5.40–§5.41).

Pliego's kernel is stdlib-only and never imports the keystone (``hyperobjects-spec``). The
cross-platform physics it reads therefore enters as committed **data**, and this script is the
one place that data is checked against the keystone's own code:

1. every stock card that carries a ``sheet_behaviour`` block (``materials/<slug>/stock.json``)
   must equal the keystone rule ``pliego-stock/1`` applied to the card without it;
2. every entry of the vendored snapshot ``packages/kernel/src/pliego/data/
   sheet-behaviour.snapshot.json`` must equal the keystone rule named in it (``fc-fabric/1``)
   applied to the vendored source card (``scripts/qa/fixtures/sheet-behaviour/<platform>/
   <slug>/``), whose sha-256 the entry records;
3. every laminate golden in ``packages/kernel/tests/fixtures/laminates/`` must equal the
   keystone's laminate calculator (``laminate_behaviour``) on the same layers: the numbers the
   kernel's ``tests/test_laminate.py`` checks ``pliego.laminate`` against.

It needs the keystone installed (CI installs it at ``SPEC_PIN``); without it, it fails — a drift
gate that cannot see the keystone has checked nothing. ``--write`` regenerates all three from the
installed keystone (review the diff: the engine reads these numbers).

Read-proof line: ``sheet-behaviour: cards=N carried=C vendored=V laminates=L drift=D
keystone=<version>``. Exit 1 on any drift or problem, or when a count is zero.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MATERIALS = ROOT / "materials"
SNAPSHOT = ROOT / "packages/kernel/src/pliego/data/sheet-behaviour.snapshot.json"
SOURCES = ROOT / "scripts/qa/fixtures/sheet-behaviour"
LAMINATES = ROOT / "packages/kernel/tests/fixtures/laminates"
SNAPSHOT_VERSION = "pliego.sheet-behaviour-snapshot v1"
CARD_FILE = {"fashion-cabinet": "material.json"}
RULES = {"fashion-cabinet": "fc-fabric/1"}


def dump(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def keystone():
    try:
        from importlib.metadata import version

        import hyperobjects_sheet as hs
    except ImportError as exc:
        print(f"sheet-behaviour: FAIL the keystone is not importable ({exc}); install "
              "hyperobjects-spec at SPEC_PIN", file=sys.stderr)
        return None, None
    try:
        ver = version("hyperobjects-spec")
    except Exception:  # noqa: BLE001 — an editable checkout without metadata
        ver = "unknown"
    return hs, ver


def check_cards(hs, write: bool, problems: list[str]) -> tuple[int, int, int]:
    cards = carried = drift = 0
    for path in sorted(MATERIALS.glob("*/stock.json")):
        cards += 1
        slug = path.parent.name
        card = json.loads(path.read_text(encoding="utf-8"))
        bare = copy.deepcopy(card)
        held = bare.pop("sheet_behaviour", None)
        fresh = hs.map_pliego_stock(bare)
        check = hs.validate(fresh)
        if not check.ok:
            problems.append(f"{slug}: keystone mapping invalid: {'; '.join(check.errors[:2])}")
            continue
        if write:
            card["sheet_behaviour"] = fresh
            path.write_text(dump(card), encoding="utf-8")
            carried += 1
        elif held is not None:
            carried += 1
            if held != fresh:
                drift += 1
                keys = sorted(k for k in set(held) | set(fresh) if held.get(k) != fresh.get(k))
                problems.append(f"{slug}: carried sheet_behaviour drifts from pliego-stock/1 in "
                                f"{', '.join(keys)}")
    return cards, carried, drift


def check_snapshot(hs, ver: str, write: bool, problems: list[str]) -> tuple[int, int]:
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.is_file() else None
    if write:
        entries = {}
        for platform, filename in CARD_FILE.items():
            for card_path in sorted((SOURCES / platform).glob(f"*/{filename}")):
                slug = card_path.parent.name
                old = ((data or {}).get("materials") or {}).get(f"{platform}/{slug}") or {}
                card = json.loads(card_path.read_text(encoding="utf-8"))
                doc = hs.map_fc_fabric(card)
                entries[f"{platform}/{slug}"] = {
                    "material_ref": {"platform": platform, "material_slug": slug,
                                     "behaviour": "sheet"},
                    "rule": RULES[platform],
                    "keystone": os.environ.get("SPEC_PIN") or old.get("keystone", ""),
                    "keystone_version": ver,
                    "card": {**(old.get("card") or {}),
                             "vendored": str(card_path.relative_to(ROOT)),
                             "sha256": sha256(card_path)},
                    "sheet_behaviour": doc,
                }
        data = {**(data or {}), "snapshot": SNAPSHOT_VERSION, "materials": entries}
        SNAPSHOT.write_text(dump(data), encoding="utf-8")
        return len(entries), 0
    if not data or data.get("snapshot") != SNAPSHOT_VERSION:
        problems.append(f"{SNAPSHOT.relative_to(ROOT)}: missing or not {SNAPSHOT_VERSION!r}")
        return 0, 1
    drift = 0
    for key, entry in sorted(data["materials"].items()):
        platform, _, slug = key.partition("/")
        card_path = SOURCES / platform / slug / CARD_FILE.get(platform, "?")
        if not card_path.is_file():
            problems.append(f"{key}: vendored source card missing at {card_path}")
            drift += 1
            continue
        if entry.get("card", {}).get("sha256") != sha256(card_path):
            problems.append(f"{key}: source card sha-256 differs from the recorded one")
            drift += 1
        if entry.get("rule") != RULES.get(platform):
            problems.append(f"{key}: rule {entry.get('rule')!r} is not {RULES.get(platform)!r}")
            drift += 1
        fresh = hs.map_fc_fabric(json.loads(card_path.read_text(encoding="utf-8")))
        if fresh != entry.get("sheet_behaviour"):
            problems.append(f"{key}: vendored sheet_behaviour drifts from {entry.get('rule')}")
            drift += 1
        elif not hs.validate(fresh).ok:
            problems.append(f"{key}: vendored sheet_behaviour is not valid")
            drift += 1
    return len(data["materials"]), drift


def check_laminates(hs, write: bool, problems: list[str]) -> tuple[int, int]:
    from hyperobjects_sheet import resolver_for

    resolve = resolver_for({"pliego": MATERIALS,
                            "fashion-cabinet": SOURCES / "fashion-cabinet"})
    count = drift = 0
    for path in sorted(LAMINATES.glob("*.json")):
        if path.name.endswith(".golden.json"):
            continue
        count += 1
        doc = json.loads(path.read_text(encoding="utf-8"))
        fresh = hs.laminate_behaviour(doc, resolve)
        golden = path.with_name(path.stem + ".golden.json")
        if write:
            golden.write_text(dump(fresh), encoding="utf-8")
        elif not golden.is_file() or json.loads(golden.read_text(encoding="utf-8")) != fresh:
            drift += 1
            problems.append(f"{golden.relative_to(ROOT)}: differs from the keystone calculator")
    return count, drift


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true",
                    help="regenerate carried blocks, the snapshot and the laminate goldens")
    args = ap.parse_args(argv)
    hs, ver = keystone()
    if hs is None:
        print("sheet-behaviour: cards=0 carried=0 vendored=0 laminates=0 drift=0 keystone=none")
        return 1
    problems: list[str] = []
    cards, carried, d1 = check_cards(hs, args.write, problems)
    vendored, d2 = check_snapshot(hs, ver, args.write, problems)
    laminates, d3 = check_laminates(hs, args.write, problems)
    for line in problems:
        print(f"sheet-behaviour: {line}", file=sys.stderr)
    print(f"sheet-behaviour: cards={cards} carried={carried} vendored={vendored} "
          f"laminates={laminates} drift={d1 + d2 + d3} keystone={ver}")
    if 0 in (cards, carried, vendored, laminates):
        print("sheet-behaviour: FAIL a count is zero (scanned nothing)", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
