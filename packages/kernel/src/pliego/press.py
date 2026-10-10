"""Pressing, burning and brand artwork on a sheet (spec §5.10–§5.11, lane P draft).

**Finish regions** (``pliego:finishes``) describe what a press, a die or a hot tool does to an
area of one side of a sheet. Each is a dict built here and checked by :func:`check_finish`:

| kind | depth_mm | other fields |
|---|---|---|
| ``emboss`` | relief height (> 0) | ``profile`` (flat · dome · bevel · sculpted), ``registered`` |
| ``deboss`` | recess depth (> 0) | ``profile`` |
| ``foil`` | 0 (hot foil) | ``color``, ``finish`` (metallic · matte · gloss · holographic) |
| ``varnish`` | 0 | ``finish`` (gloss · matte · soft-touch · spot-uv) |
| ``letterpress`` | impression depth (> 0) | ``color`` (ink) |
| ``burn`` | char depth (≥ 0) | ``process`` (iron · laser), ``char`` (0–1 darkness), ``color`` |

Regions are lists of polygons in sheet-local mm (even-odd: a polygon inside another is a hole).

**Plates** (:func:`plates`) are what the dieline export profile draws, each on its own layer and
right-reading as seen on the face the finish is applied to (platemakers mirror the die face):
emboss die (female, the region) and counter (male, the region offset inward by the caliper —
the counter must leave room for the board [E]); deboss die (male) and counter (female, offset
outward); foil plate; varnish plate; letterpress plate; burn: the branding-iron face or the
laser engrave vector outline, plus a raster fill hatch for laser engraving.

**Engine effects (documented limits).** Embossed and debossed areas are locally stiffer
(the relief adds second moment of area) and burned areas are thinner and more brittle; the
sheet document records the regions, but the engine does not yet change local stiffness or
thickness from them. Relief and sheen rendering in the studio is a follow-up.

**Brand artwork** (``pliego:artwork``): an image asset inside the cartridge directory placed on
one side of a sheet — ``at`` (lower-left, sheet-local mm), ``size``, ``rotation_deg`` — clipped to
a panel's bleed (``clip: "bleed"``) when the dieline names one. Exports place it on the art layer;
the studio's texture preview on the folded object is a follow-up.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any

from .geometry import Vec2, polygon_area
from .sheet import Sheet, check_slug

KINDS = ("emboss", "deboss", "foil", "varnish", "letterpress", "burn")
PROFILES = ("flat", "dome", "bevel", "sculpted")
FOIL_FINISHES = ("metallic", "matte", "gloss", "holographic")
VARNISH_FINISHES = ("gloss", "matte", "soft-touch", "spot-uv")
PROCESSES = ("iron", "laser")
SIDES = ("front", "back")
CLIPS = ("panel", "bleed", "none")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_ASSET = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(svg|png|jpg|jpeg|webp)$")
MAX_DEPTH_MM = 5.0
HATCH_PITCH_MM = 0.3            # raster engrave line pitch drawn by the export profile [E]

Region = Sequence[Sequence[tuple[float, float]]]


def _sid(sheet: Sheet | str) -> str:
    return sheet.id if isinstance(sheet, Sheet) else check_slug(sheet, "sheet id")


def _region(region: Region) -> list[list[list[float]]]:
    out = []
    for poly in region:
        pts = [[float(x), float(y)] for x, y in poly]
        if len(pts) < 3 or abs(polygon_area([Vec2(x, y) for x, y in pts])) < 1e-6:
            raise ValueError("finish region polygons need ≥ 3 points and non-zero area")
        out.append(pts)
    if not out:
        raise ValueError("a finish region needs at least one polygon")
    return out


def _finish(kind: str, id: str, sheet: Sheet | str, region: Region, side: str,
            **fields: Any) -> dict:
    f = {"id": check_slug(id, "finish id"), "kind": kind, "sheet": _sid(sheet), "side": side,
         "region": _region(region), **fields}
    problems = check_finish(f)
    if problems:
        raise ValueError(f"finish '{id}': " + "; ".join(problems))
    return f


def emboss(id: str, sheet: Sheet | str, region: Region, depth: float = 0.4, *,
           profile: str = "dome", side: str = "front", registered: bool = False) -> dict:
    """Raised relief (blind emboss, or ``registered`` to printed art)."""
    return _finish("emboss", id, sheet, region, side, depth_mm=float(depth), profile=profile,
                   registered=bool(registered))


def deboss(id: str, sheet: Sheet | str, region: Region, depth: float = 0.3, *,
           profile: str = "flat", side: str = "front") -> dict:
    return _finish("deboss", id, sheet, region, side, depth_mm=float(depth), profile=profile)


def foil(id: str, sheet: Sheet | str, region: Region, color: str = "#c9a227", *,
         finish: str = "metallic", side: str = "front") -> dict:
    """Hot-foil stamping (no relief: depth 0)."""
    return _finish("foil", id, sheet, region, side, depth_mm=0.0, color=color, finish=finish)


def varnish(id: str, sheet: Sheet | str, region: Region, finish: str = "spot-uv", *,
            side: str = "front") -> dict:
    return _finish("varnish", id, sheet, region, side, depth_mm=0.0, finish=finish)


def letterpress(id: str, sheet: Sheet | str, region: Region, depth: float = 0.15, *,
                color: str = "#1d2a44", side: str = "front") -> dict:
    """Inked relief printing pressed into the sheet (impression depth)."""
    return _finish("letterpress", id, sheet, region, side, depth_mm=float(depth), color=color)


def burn(id: str, sheet: Sheet | str, region: Region, depth: float = 0.2, *,
         process: str = "laser", char: float = 0.7, color: str = "#3b2416",
         side: str = "front") -> dict:
    """Heat branding: a branding iron or a laser chars the surface (``char`` = darkness)."""
    return _finish("burn", id, sheet, region, side, depth_mm=float(depth), process=process,
                   char=float(char), color=color)


def check_finish(f: Any) -> list[str]:
    """Problems with one finish record (empty = valid)."""
    if not isinstance(f, dict):
        return ["a finish must be an object"]
    p: list[str] = []
    kind = f.get("kind")
    if kind not in KINDS:
        return [f"kind {kind!r} not in {KINDS}"]
    if f.get("side") not in SIDES:
        p.append(f"side must be one of {SIDES}")
    depth = f.get("depth_mm")
    if not isinstance(depth, (int, float)) or isinstance(depth, bool) or not math.isfinite(depth):
        p.append("depth_mm must be a number")
        depth = 0.0
    if kind in ("emboss", "deboss", "letterpress") and not 0 < depth <= MAX_DEPTH_MM:
        p.append(f"{kind} depth_mm must be in (0, {MAX_DEPTH_MM}]")
    if kind in ("foil", "varnish") and depth != 0:
        p.append(f"{kind} has no relief (depth_mm 0)")
    if kind == "burn" and not 0 <= depth <= MAX_DEPTH_MM:
        p.append(f"burn depth_mm must be in [0, {MAX_DEPTH_MM}]")
    if kind in ("emboss", "deboss") and f.get("profile") not in PROFILES:
        p.append(f"profile must be one of {PROFILES}")
    if kind in ("foil", "letterpress", "burn") and not _HEX.match(str(f.get("color", ""))):
        p.append("color must be #rrggbb")
    if kind == "foil" and f.get("finish") not in FOIL_FINISHES:
        p.append(f"foil finish must be one of {FOIL_FINISHES}")
    if kind == "varnish" and f.get("finish") not in VARNISH_FINISHES:
        p.append(f"varnish finish must be one of {VARNISH_FINISHES}")
    if kind == "burn":
        if f.get("process") not in PROCESSES:
            p.append(f"burn process must be one of {PROCESSES}")
        char = f.get("char")
        if not isinstance(char, (int, float)) or not 0 <= char <= 1:
            p.append("burn char must be in [0, 1]")
    region = f.get("region")
    if not isinstance(region, list) or not region:
        p.append("region must be a non-empty list of polygons")
    else:
        for poly in region:
            if not (isinstance(poly, list) and len(poly) >= 3 and all(
                    isinstance(q, list) and len(q) == 2
                    and all(isinstance(c, (int, float)) and math.isfinite(c) for c in q)
                    for q in poly)):
                p.append("each region polygon is a list of ≥ 3 [u, v] points")
                break
    return p


def artwork(id: str, sheet: Sheet | str, asset: str, at: tuple[float, float],
            size: tuple[float, float], *, side: str = "front", rotation_deg: float = 0.0,
            panel: str | None = None, clip: str = "bleed") -> dict:
    """Brand artwork placed on one side of a sheet (spec §5.11)."""
    a = {"id": check_slug(id, "artwork id"), "sheet": _sid(sheet), "side": side,
         "asset": asset, "at": [float(at[0]), float(at[1])],
         "size": [float(size[0]), float(size[1])], "rotation_deg": float(rotation_deg),
         "clip": clip}
    if panel is not None:
        a["panel"] = check_slug(panel, "panel name")
    problems = check_artwork(a)
    if problems:
        raise ValueError(f"artwork '{id}': " + "; ".join(problems))
    return a


def check_artwork(a: Any) -> list[str]:
    if not isinstance(a, dict):
        return ["artwork must be an object"]
    p = []
    asset = str(a.get("asset", ""))
    if not _ASSET.match(asset) or ".." in asset.split("/") or "//" in asset:
        p.append("asset must be a relative path inside the cartridge (svg/png/jpg/webp, no '..')")
    if a.get("side") not in SIDES:
        p.append(f"side must be one of {SIDES}")
    if a.get("clip") not in CLIPS:
        p.append(f"clip must be one of {CLIPS}")
    size = a.get("size")
    if not (isinstance(size, list) and len(size) == 2 and all(
            isinstance(v, (int, float)) and v > 0 for v in size)):
        p.append("size must be two positive numbers")
    return p


def _offset_poly(poly: list[list[float]], d: float) -> list[list[float]]:
    from .dieline import _ccw, mitre_offset

    ring = _ccw([(x, y) for x, y in poly])
    return [[round(x, 6), round(y, 6)] for x, y in mitre_offset(ring, [d] * len(ring))]


def plates(f: dict, caliper_mm: float) -> list[tuple[str, list[list[list[float]]], str]]:
    """The plate layers of one finish: (layer name, polygons, mode) with mode ``outline`` or
    ``raster`` (a filled area the laser engraves line by line)."""
    region = f["region"]
    kind = f["kind"]
    t = max(float(caliper_mm), 0.05)
    if kind == "emboss":
        return [("Emboss die (female)", region, "outline"),
                ("Emboss counter (male)", [_offset_poly(p, -t) for p in region], "outline")]
    if kind == "deboss":
        return [("Deboss die (male)", region, "outline"),
                ("Deboss counter (female)", [_offset_poly(p, t) for p in region], "outline")]
    if kind == "foil":
        return [("Foil plate", region, "outline")]
    if kind == "varnish":
        return [("Varnish plate", region, "outline")]
    if kind == "letterpress":
        return [("Letterpress plate", region, "outline")]
    if f.get("process") == "iron":
        return [("Branding iron face", region, "outline")]
    return [("Engrave (vector)", region, "outline"), ("Engrave (raster)", region, "raster")]


def hatch(region: list[list[list[float]]], pitch: float = HATCH_PITCH_MM
          ) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Horizontal scan lines filling a region (even-odd), the raster engrave preview."""
    ys = [q[1] for poly in region for q in poly]
    if not ys:
        return []
    y0, y1 = min(ys), max(ys)
    out = []
    n = max(1, int((y1 - y0) / pitch))
    for k in range(1, n):
        y = y0 + k * (y1 - y0) / n
        xs = []
        for poly in region:
            m = len(poly)
            for i in range(m):
                (ax, ay), (bx, by) = poly[i], poly[(i + 1) % m]
                if (ay > y) != (by > y):
                    xs.append(ax + (y - ay) * (bx - ax) / (by - ay))
        xs.sort()
        out += [((xs[i], y), (xs[i + 1], y)) for i in range(0, len(xs) - 1, 2)]
    return out
