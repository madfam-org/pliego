"""Paper stock cards: load, validate and derive engine physics.

A stock card (``materials/<slug>/stock.json``, spec ``docs/spec/v1/stock-card.md``) describes one
sheet material. :func:`derive` is the **only** implementation of the measurement → physics mapping
(spec ``docs/spec/v1/sheet-document.md`` §5.2). Every value it returns is in engine units:

- lengths in mm, mass in g, time in s;
- ``E_md``/``E_cd`` in g/(mm·s²)  (1 GPa = 1e9);
- ``D_md``/``D_cd`` in g·mm²/s²   (1 mN·m = 1e6, 1 N·m = 1e9);
- ``crease_k`` in g·mm/s² per rad per mm of crease: ``D / L*`` with
  ``L* = crease_length_scale_t · t``.

Formulas and defaults come from the rsE research memo §a3–§b:

- plate bending ``D = E·t³ / (12·(1 − ν12·ν21))`` with ``√(ν12·ν21) = 0.293`` for paper
  (Baum, Habeger & Fleischman 1981), so the card's ``nu`` is that geometric mean;
- a measured ``bending_stiffness_mNm`` overrides the plate formula (measured values win);
- crease hinge ``κ = D / L*``, ``L* ≈ 200·t`` for a hand crease (Lechenault, Thiria & Adda-Bedia
  2014, measured on Mylar; unmeasured for paper); the hinge uses the direction-averaged
  ``√(D_md·D_cd)`` because one crease constant serves every crease direction;
- crease yield 35° (rest opening 27–43°, Lechenault 2014);
- ``perf_factor`` = bridge fraction of the perforation pitch (material left between cuts);
- ``collision_thickness = max(t, 0.05 mm)`` (numerical floor, rsE §a3).

CLI (drift gate, read-proof line ``stock: cards=N drift=D``)::

    python -m pliego.stock --check materials    # exit 1 if any committed derived block drifts
    python -m pliego.stock --write materials    # rewrite derived blocks from derive()
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

DERIVE_BASIS = "pliego.stock.derive v1"

DERIVED_KEYS: tuple[str, ...] = (
    "areal_density", "thickness", "E_md", "E_cd", "nu", "D_md", "D_cd",
    "crease_k", "crease_yield_deg", "crease_set_rate", "score_factor", "perf_factor",
    "tear_strain", "friction", "collision_thickness",
)

STATUSES = ("measured", "nominal", "estimated")
CLASSES = (
    "text", "origami", "cover", "cardstock", "kraft", "tissue", "washi", "bark", "foil",
    "vellum", "corrugated", "chipboard", "synthetic",
)
GRAINS = ("long", "short", "none")
LANGS = ("en", "es", "fr", "pt")

# Physical fields every card carries as {value, status, source|basis[, method]}.
REQUIRED_VALUES = (
    "gsm", "caliper_um", "E_md_gpa", "E_cd_gpa", "nu",
    "crease_length_scale_t", "crease_yield_deg", "tear_strain", "friction",
)
OPTIONAL_VALUES = ("crease_set_rate", "score_factor")
# Mechanical values: a ``measured`` status must name the test method too.
MECHANICAL = (
    "E_md_gpa", "E_cd_gpa", "nu", "crease_length_scale_t", "crease_yield_deg",
    "tear_strain", "friction", "crease_set_rate", "score_factor",
)

# Documented defaults for the optional inputs (rsE §a3, engineering estimates [E]).
DEFAULT_CREASE_SET_RATE = 0.5
DEFAULT_SCORE_FACTOR = 0.35
DEFAULT_PERF_CUT_MM = 3.0
DEFAULT_PERF_BRIDGE_MM = 1.0
MIN_COLLISION_MM = 0.05

GPA = 1e9          # GPa → g/(mm·s²)
MNM = 1e6          # mN·m → g·mm²/s²
SIG_DIGITS = 6

_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class StockError(ValueError):
    """A stock card failed validation (the message lists every error)."""


def _sig(x: float) -> float:
    """Round to SIG_DIGITS significant digits (byte-stable JSON, kills float noise)."""
    if x == 0 or not math.isfinite(x):
        return float(x)
    return float(f"{x:.{SIG_DIGITS}g}")


def _issue(level: str, kind: str, detail: str) -> dict[str, str]:
    return {"level": level, "kind": kind, "detail": detail}


# ---------------------------------------------------------------- validation


def _check_value(name: str, entry: Any, issues: list[dict[str, str]]) -> None:
    if not isinstance(entry, dict):
        issues.append(_issue("error", "physical_value", f"{name}: expected an object"))
        return
    value, status = entry.get("value"), entry.get("status")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        issues.append(_issue("error", "physical_value", f"{name}: value must be a finite number"))
    elif value < 0:
        issues.append(_issue("error", "physical_value", f"{name}: value must be ≥ 0"))
    if status not in STATUSES:
        issues.append(_issue("error", "physical_status", f"{name}: status {status!r}"))
        return
    if status in ("measured", "nominal") and not entry.get("source"):
        issues.append(_issue("error", "physical_source", f"{name}: {status} needs a source"))
    if status == "measured" and name in MECHANICAL and not entry.get("method"):
        issues.append(_issue("error", "physical_method", f"{name}: measured needs a method"))
    if status == "estimated" and not entry.get("basis"):
        issues.append(_issue("error", "physical_basis", f"{name}: estimated needs a basis"))


def _check_i18n(where: str, obj: Any, issues: list[dict[str, str]],
                langs: tuple[str, ...] = LANGS) -> None:
    if not isinstance(obj, dict):
        issues.append(_issue("error", "i18n", f"{where}: expected an i18n object"))
        return
    for lang in langs:
        if not isinstance(obj.get(lang), str) or not obj[lang].strip():
            issues.append(_issue("error", "i18n", f"{where}: missing '{lang}'"))


def validate(card: dict[str, Any], slug: str | None = None) -> list[dict[str, str]]:
    """Verify-style issues ``{level, kind, detail}`` for a stock card (spec stock-card.md)."""
    issues: list[dict[str, str]] = []
    stock = card.get("stock")
    if not isinstance(stock, dict):
        return [_issue("error", "stock", "missing 'stock' block")]
    card_slug = stock.get("slug")
    if not isinstance(card_slug, str) or not _SLUG.match(card_slug):
        issues.append(_issue("error", "slug", f"invalid slug {card_slug!r}"))
    elif slug is not None and card_slug != slug:
        issues.append(_issue("error", "slug", f"slug {card_slug!r} != directory {slug!r}"))
    _check_i18n("stock.name", stock.get("name"), issues)
    if stock.get("class") not in CLASSES:
        issues.append(_issue("error", "class", f"class {stock.get('class')!r}"))
    if stock.get("grain") not in GRAINS:
        issues.append(_issue("error", "grain", f"grain {stock.get('grain')!r}"))
    if not isinstance(stock.get("color"), str) or not _COLOR.match(stock["color"]):
        issues.append(_issue("error", "color", f"color {stock.get('color')!r}"))
    fiber = stock.get("fiber")
    if not isinstance(fiber, list) or not fiber or not all(
        isinstance(f, str) and _SLUG.match(f) for f in fiber
    ):
        issues.append(_issue("error", "fiber", "fiber must be a non-empty list of slugs"))

    physical = card.get("physical")
    if not isinstance(physical, dict):
        issues.append(_issue("error", "physical", "missing 'physical' block"))
        physical = {}
    for name in REQUIRED_VALUES:
        if name not in physical:
            issues.append(_issue("error", "physical_missing", f"missing physical.{name}"))
        else:
            _check_value(name, physical[name], issues)
    for name in OPTIONAL_VALUES:
        if name in physical:
            _check_value(name, physical[name], issues)
    if any(physical.get(k, {}).get("value") == 0 for k in ("gsm", "caliper_um")):
        issues.append(_issue("error", "physical_value", "gsm and caliper must be > 0"))
    nu = physical.get("nu", {}).get("value")
    if isinstance(nu, (int, float)) and not 0 <= nu < 0.5:
        issues.append(_issue("error", "physical_value", f"nu {nu} outside [0, 0.5)"))
    bend = physical.get("bending_stiffness_mNm")
    if bend is not None:
        if not isinstance(bend, dict):
            issues.append(_issue("error", "bending", "bending_stiffness_mNm must be an object"))
        elif bend.get("md") is not None or bend.get("cd") is not None:
            for axis in ("md", "cd"):
                v = bend.get(axis)
                if not isinstance(v, (int, float)) or v <= 0:
                    issues.append(_issue("error", "bending", f"bending {axis} must be > 0"))
            if not bend.get("method") or not bend.get("source"):
                issues.append(_issue("error", "bending", "measured bending needs method+source"))

    fab = card.get("fabrication")
    if not isinstance(fab, dict) or not isinstance(fab.get("min_feature_mm"), (int, float)):
        issues.append(_issue("error", "fabrication", "fabrication.min_feature_mm required"))
    elif isinstance(fab.get("perforation"), dict):
        perf = fab["perforation"]
        if not all(isinstance(perf.get(k), (int, float)) and perf[k] > 0
                   for k in ("cut_mm", "bridge_mm")):
            issues.append(_issue("error", "fabrication", "perforation cut_mm/bridge_mm > 0"))

    prov = card.get("provenance")
    if not isinstance(prov, dict) or not prov.get("license") or not prov.get("sources"):
        issues.append(_issue("error", "provenance", "provenance needs license and sources"))
    elif isinstance(prov.get("heritage"), dict):
        heritage = prov["heritage"]
        claims = heritage.get("claims")
        if not isinstance(claims, list) or not claims:
            issues.append(_issue("error", "heritage", "heritage needs cited claims"))
        else:
            for k, claim in enumerate(claims):
                _check_i18n(f"heritage.claims[{k}]", claim, issues, ("en", "es"))
                if not isinstance(claim, dict) or not str(claim.get("source", "")).startswith(
                    "http"
                ):
                    issues.append(_issue("error", "heritage", f"claims[{k}] needs a source URL"))

    if card.get("derived_basis") not in (None, DERIVE_BASIS):
        issues.append(_issue("error", "derived_basis", f"unknown {card.get('derived_basis')!r}"))
    return issues


# ---------------------------------------------------------------- derivation


def _value(physical: dict[str, Any], name: str, default: float | None = None) -> float:
    entry = physical.get(name)
    if isinstance(entry, dict) and isinstance(entry.get("value"), (int, float)):
        return float(entry["value"])
    if default is None:
        raise StockError(f"missing physical.{name}")
    return default


def derive(card: dict[str, Any]) -> dict[str, float]:
    """Map a stock card's measurements to engine physics (spec §5.2 keys, engine units)."""
    physical = card.get("physical") or {}
    fab = card.get("fabrication") or {}
    gsm = _value(physical, "gsm")
    t = _value(physical, "caliper_um") / 1000.0                    # mm
    e_md = _value(physical, "E_md_gpa") * GPA                       # g/(mm·s²)
    e_cd = _value(physical, "E_cd_gpa") * GPA
    nu = _value(physical, "nu")
    plate = t ** 3 / (12.0 * (1.0 - nu * nu))
    d_md, d_cd = e_md * plate, e_cd * plate                         # g·mm²/s²
    bend = physical.get("bending_stiffness_mNm") or {}
    if isinstance(bend.get("md"), (int, float)) and isinstance(bend.get("cd"), (int, float)):
        d_md, d_cd = float(bend["md"]) * MNM, float(bend["cd"]) * MNM   # measured wins
    l_star = _value(physical, "crease_length_scale_t") * t          # mm
    perf = fab.get("perforation") or {}
    cut = float(perf.get("cut_mm", DEFAULT_PERF_CUT_MM))
    bridge = float(perf.get("bridge_mm", DEFAULT_PERF_BRIDGE_MM))
    derived = {
        "areal_density": gsm * 1e-6,                                # g/mm²
        "thickness": t,
        "E_md": e_md,
        "E_cd": e_cd,
        "nu": nu,
        "D_md": d_md,
        "D_cd": d_cd,
        "crease_k": math.sqrt(d_md * d_cd) / l_star,
        "crease_yield_deg": _value(physical, "crease_yield_deg"),
        "crease_set_rate": _value(physical, "crease_set_rate", DEFAULT_CREASE_SET_RATE),
        "score_factor": _value(physical, "score_factor", DEFAULT_SCORE_FACTOR),
        "perf_factor": bridge / (cut + bridge),
        "tear_strain": _value(physical, "tear_strain"),
        "friction": _value(physical, "friction"),
        "collision_thickness": max(t, MIN_COLLISION_MM),
    }
    return {k: _sig(derived[k]) for k in DERIVED_KEYS}


def snapshot(card: dict[str, Any] | str, root: Path | str | None = None) -> dict[str, Any]:
    """The sheet-document stock snapshot (spec §5.2): name, gsm, caliper, derived.

    ``card`` is a stock card dict or a committed stock slug (loaded from ``materials/``; this is
    the hook ``pliego.document_build.resolve_stock`` calls).
    """
    if isinstance(card, str):
        card = load_card(card, root)
    physical = card["physical"]
    return {
        "name": dict(card["stock"]["name"]),
        "gsm": _sig(_value(physical, "gsm")),
        "caliper_mm": _sig(_value(physical, "caliper_um") / 1000.0),
        "derived": derive(card),
        "derived_basis": DERIVE_BASIS,
    }


# ---------------------------------------------------------------- loading


def materials_dir() -> Path:
    """Locate ``materials/``: ``$PLIEGO_MATERIALS``, else the nearest ancestor of this module
    that has one (source checkout), else ``./materials`` (installed package run from the repo or
    an image whose working directory holds it)."""
    env = os.environ.get("PLIEGO_MATERIALS")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "materials"
        if candidate.is_dir():
            return candidate
    if (Path.cwd() / "materials").is_dir():
        return Path.cwd() / "materials"
    raise StockError("materials/ not found (set PLIEGO_MATERIALS)")


def load_card(slug: str, root: Path | str | None = None) -> dict[str, Any]:
    """Load and validate ``materials/<slug>/stock.json``; raise :class:`StockError` on errors."""
    if not _SLUG.match(slug):
        raise StockError(f"invalid stock slug {slug!r}")
    base = Path(root) if root is not None else materials_dir()
    path = base / slug / "stock.json"
    if not path.is_file():
        raise StockError(f"unknown stock {slug!r} ({path} missing)")
    card = json.loads(path.read_text(encoding="utf-8"))
    errors = [i for i in validate(card, slug) if i["level"] == "error"]
    if errors:
        raise StockError(f"{path}: " + "; ".join(i["detail"] for i in errors))
    return card


def load_snapshot(slug: str, root: Path | str | None = None) -> dict[str, Any]:
    """Snapshot of a committed stock for embedding in a sheet document (``pliego:stocks``)."""
    return snapshot(load_card(slug, root))


def list_slugs(root: Path | str | None = None) -> list[str]:
    base = Path(root) if root is not None else materials_dir()
    return sorted(p.parent.name for p in base.glob("*/stock.json"))


def dump_card(card: dict[str, Any]) -> str:
    """Canonical text of a card file: 2-space JSON, UTF-8, trailing newline."""
    return json.dumps(card, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------- CLI


def check(root: Path | str, write: bool = False) -> tuple[int, int, list[str]]:
    """Validate every card and compare committed ``derived`` with :func:`derive`.

    Returns ``(cards, drift, problems)``. With ``write=True`` drifting blocks are rewritten.
    """
    base = Path(root)
    problems: list[str] = []
    drift = 0
    slugs = list_slugs(base)
    for slug in slugs:
        path = base / slug / "stock.json"
        card = json.loads(path.read_text(encoding="utf-8"))
        for issue in validate(card, slug):
            if issue["level"] == "error":
                problems.append(f"{slug}: {issue['kind']}: {issue['detail']}")
        try:
            fresh = derive(card)
        except (StockError, ZeroDivisionError, ValueError) as exc:
            problems.append(f"{slug}: derive failed: {exc}")
            continue
        committed = card.get("derived")
        if committed != fresh or card.get("derived_basis") != DERIVE_BASIS:
            if write:
                card["derived"] = fresh
                card["derived_basis"] = DERIVE_BASIS
                path.write_text(dump_card(card), encoding="utf-8")
            else:
                drift += 1
                keys = sorted(k for k in DERIVED_KEYS
                              if not isinstance(committed, dict) or committed.get(k) != fresh[k])
                problems.append(f"{slug}: derived drift in {', '.join(keys) or 'derived_basis'}")
    return len(slugs), drift, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pliego.stock", description=__doc__.split(
        "\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", metavar="MATERIALS", help="fail on invalid cards or drift")
    mode.add_argument("--write", metavar="MATERIALS", help="rewrite derived blocks")
    args = parser.parse_args(argv)
    root = args.check or args.write
    cards, drift, problems = check(root, write=bool(args.write))
    for line in problems:
        print(f"stock: {line}", file=sys.stderr)
    print(f"stock: cards={cards} drift={drift}")
    if cards == 0:
        print("stock: scanned zero cards", file=sys.stderr)
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
