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

**Conductive traces** (``kind: "trace"``, spec §5.30, lane X draft): copper tape or conductive
ink laid along a centre line ``path`` with a ``width_mm``, and ``pads`` where a part's pin (a coin
cell's ``plus``/``minus``, an LED's ``anode``/``cathode``) or a fold switch's ``contact`` touches
the trace. ``region`` is the conductor's outline (the path stroked by its width, square ends),
so rule 13 and the plates see it like any finish. Plates: the conductor's outline (to cut tape or
fill ink), its centre line (to lay tape or plot ink) and the pads, on their own layers.
:func:`circuit` is the continuity check (rule 30): a closed path from a cell's ``plus`` through
forward-biased LEDs back to its ``minus``, crossing a fold switch only when it is closed;
:func:`fold_switch_closes` checks that a switch's contacts meet when the sheet folds on a line.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any

from .geometry import Vec2, polygon_area
from .sheet import Sheet, check_slug

KINDS = ("emboss", "deboss", "foil", "varnish", "letterpress", "burn", "trace")
TRACE_MATERIALS = ("copper-tape", "conductive-ink")
PINS = {"plus": "cell", "minus": "cell", "anode": "led", "cathode": "led", "contact": "switch"}
MAX_TRACE_WIDTH_MM = 50.0
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


# ── conductive traces (spec §5.30, lane X draft) ─────────────────────────────

def pad(id: str, at: tuple[float, float], size: float = 8.0, *, part: str | None = None,
        pin: str | None = None) -> dict:
    """A square contact pad on a trace: where a part's pin (``plus``/``minus`` of a coin cell,
    ``anode``/``cathode`` of an LED, ``contact`` of a fold switch named by ``part``) sits."""
    p = {"id": check_slug(id, "pad id"), "at": [round(float(at[0]), 6), round(float(at[1]), 6)],
         "size_mm": float(size)}
    if part is not None or pin is not None:
        if part is None or pin not in PINS:
            raise ValueError(f"pad '{id}': a part needs a pin in {tuple(PINS)}, and a pin a part")
        p["part"], p["pin"] = check_slug(part, "part id"), pin
    return p


def trace(id: str, sheet: Sheet | str, path: Sequence[tuple[float, float]], width: float = 5.0,
          *, material: str = "copper-tape", pads: Sequence[dict] = (),
          side: str = "front") -> dict:
    """A conductive trace: copper tape or conductive ink laid along ``path`` (sheet-local mm),
    ``width`` mm wide, with its ``pads``. ``region`` is computed: the path stroked by the width."""
    pts = [[round(float(x), 6), round(float(y), 6)] for x, y in path]
    return _finish("trace", id, sheet, [_stroke(pts, float(width))], side, depth_mm=0.0,
                   material=material, width_mm=float(width), path=pts,
                   pads=[dict(p) for p in pads])


def _stroke(pts: list[list[float]], w: float) -> list[list[float]]:
    """The outline of a polyline stroked by width ``w``: square ends (the tape runs half a
    width past each end), mitred joins. Fails loud when a turn is too sharp for one outline."""
    if len(pts) < 2 or not 0 < w <= MAX_TRACE_WIDTH_MM:
        raise ValueError("a trace needs ≥ 2 path points and a width in (0, 50] mm")
    d = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:], strict=False):
        ln = math.hypot(bx - ax, by - ay)
        if ln < 1e-6:
            raise ValueError("trace path has a zero-length segment")
        d.append(((bx - ax) / ln, (by - ay) / ln))
    r = w / 2.0
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        if i == 0 or i == len(pts) - 1:
            ux, uy = d[0] if i == 0 else d[-1]
            sx, sy = (-ux * r, -uy * r) if i == 0 else (ux * r, uy * r)
            for out, sgn in ((left, 1.0), (right, -1.0)):
                out.append((x + sx - sgn * uy * r, y + sy + sgn * ux * r))
            continue
        (ux, uy), (vx, vy) = d[i - 1], d[i]
        nx, ny = -uy - vy, ux + vx                      # sum of the two left normals
        dot = (nx * -uy + ny * ux)
        if dot < 0.5:                                    # turn sharper than 120°
            raise ValueError("trace path turns too sharply for one outline; split the trace")
        k = r / dot
        left.append((x + nx * k, y + ny * k))
        right.append((x - nx * k, y - ny * k))
    ring = left + right[::-1]
    n = len(ring)
    for i in range(n):
        for j in range(i + 2, n):
            if (i == 0 and j == n - 1) or not _cross(ring[i], ring[(i + 1) % n], ring[j],
                                                       ring[(j + 1) % n]):
                continue
            raise ValueError("trace path crosses itself; split it into several traces")
    if polygon_area([Vec2(x, y) for x, y in ring]) < 0:
        ring = ring[::-1]                                # counter-clockwise, like the outline
    return [[round(x, 6), round(y, 6)] for x, y in ring]


def _cross(a, b, c, e) -> bool:
    def o(p, q, s):
        v = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)
    return o(a, b, c) * o(a, b, e) < 0 and o(c, e, a) * o(c, e, b) < 0


def _seg_dist(p, a, b) -> float:
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1.0)))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def _path_dist(p, path) -> float:
    return min(_seg_dist(p, a, b) for a, b in zip(path, path[1:], strict=False))


def _check_trace(f: dict) -> list[str]:
    p = []
    if f.get("material") not in TRACE_MATERIALS:
        p.append(f"trace material must be one of {TRACE_MATERIALS}")
    w = f.get("width_mm")
    if not isinstance(w, (int, float)) or isinstance(w, bool) or not 0 < w <= MAX_TRACE_WIDTH_MM:
        p.append(f"trace width_mm must be in (0, {MAX_TRACE_WIDTH_MM}]")
        w = 1.0
    path = f.get("path")
    if not (isinstance(path, list) and len(path) >= 2 and all(
            isinstance(q, list) and len(q) == 2 and all(
                isinstance(c, (int, float)) and math.isfinite(c) for c in q) for q in path)):
        return p + ["trace path must be a list of ≥ 2 [u, v] points"]
    if (f.get("depth_mm") or 0) != 0:
        p.append("trace has no relief (depth_mm 0)")
    try:
        if f.get("region") != [_stroke(path, float(w))]:
            p.append("trace region is not its path stroked by its width")
    except ValueError as exc:
        p.append(f"trace path: {exc}")
    pads, seen = f.get("pads"), set()
    if not isinstance(pads, list):
        return p + ["trace pads must be a list"]
    for k, pd in enumerate(pads):
        at = pd.get("at") if isinstance(pd, dict) else None
        size = pd.get("size_mm") if isinstance(pd, dict) else None
        if not (isinstance(at, list) and len(at) == 2 and all(
                isinstance(c, (int, float)) and math.isfinite(c) for c in at)
                and isinstance(size, (int, float)) and size > 0):
            p.append(f"pad {k}: needs at [u, v] and size_mm > 0")
            continue
        if pd.get("id") in seen or not isinstance(pd.get("id"), str):
            p.append(f"pad {k}: id missing or repeated")
        seen.add(pd.get("id"))
        if ("part" in pd or "pin" in pd) and (pd.get("pin") not in PINS
                                               or not isinstance(pd.get("part"), str)):
            p.append(f"pad {pd.get('id')}: pin must be one of {tuple(PINS)} with a part id")
        if _path_dist(at, path) > w / 2.0 + size / 2.0 + 1e-6:
            p.append(f"pad {pd.get('id')}: does not touch its trace")
    return p


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
    if kind == "trace":
        p += _check_trace(f)
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
    """The plate layers of one finish: (layer name, polygons, mode) with mode ``outline``,
    ``raster`` (a filled area the laser engraves line by line) or ``path`` (an open polyline: a
    trace's centre line, which a plotter follows to lay tape or ink)."""
    region = f["region"]
    kind = f["kind"]
    t = max(float(caliper_mm), 0.05)
    if kind == "trace":
        name = "Copper tape" if f["material"] == "copper-tape" else "Conductive ink"
        return [(f"{name} (outline)", region, "outline"),
                (f"{name} (centre line)", [f["path"]], "path"),
                ("Contact pads", [_pad_square(p) for p in f.get("pads") or []], "outline")]
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


def _pad_square(p: dict) -> list[list[float]]:
    (x, y), r = p["at"], p["size_mm"] / 2.0
    return [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]


# ── continuity (spec §8 rule 30, lane X draft) ───────────────────────────────

def circuit(finishes: Sequence[dict], closed: Sequence[str] = ()) -> dict:
    """Continuity of the paper circuit the trace finishes draw, with the fold switches named
    in `closed` closed. Nets: every trace is one conductor; traces on the same sheet and side
    whose conductors overlap join; a closed switch joins all its ``contact`` pads. Parts are
    read from the pads' ``part``/``pin``: a cell (``plus``, ``minus``), LEDs (``anode``,
    ``cathode``). The loop is closed when a path runs from a cell's ``plus`` net to its
    ``minus`` net through forward-biased LEDs only. Returns ``{"closed", "lit", "loop",
    "nets", "issues"}``; issues are verify dicts (``level``, ``kind``, ``detail``)."""
    traces = [f for f in finishes if isinstance(f, dict) and f.get("kind") == "trace"]
    issues: list[dict] = []

    def issue(level: str, kind: str, detail: str) -> None:
        issues.append({"level": level, "kind": kind, "detail": detail})
    up = list(range(len(traces)))

    def find(i: int) -> int:
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i

    def join(i: int, j: int) -> None:
        up[find(i)] = find(j)
    for i, a in enumerate(traces):
        for j in range(i + 1, len(traces)):
            b = traces[j]
            if (a["sheet"], a["side"]) == (b["sheet"], b["side"]) and _paths_touch(a, b):
                join(i, j)
    pins: dict[str, dict[str, int]] = {}
    contacts: dict[str, list[int]] = {}
    for i, f in enumerate(traces):
        for pd in f.get("pads") or []:
            if "pin" not in pd:
                continue
            part, pin = pd["part"], pd["pin"]
            if pin == "contact":
                contacts.setdefault(part, []).append(i)
            elif pin in pins.setdefault(part, {}):
                issue("error", "pin_twice", f"part '{part}' has two '{pin}' pads")
            else:
                pins[part][pin] = i
    for sw in closed:
        ends = contacts.get(sw, [])
        if len(ends) < 2:
            issue("error", "switch", f"switch '{sw}' needs two contact pads, has {len(ends)}")
        for i in ends[1:]:
            join(ends[0], i)
    cells, leds = [], []
    for part, have in sorted(pins.items()):
        kinds = {PINS[p] for p in have}
        need = ("plus", "minus") if kinds == {"cell"} else ("anode", "cathode")
        if len(kinds) > 1 or any(p not in have for p in need):
            issue("error", "part", f"part '{part}' needs exactly the pins {need}")
            continue
        (cells if kinds == {"cell"} else leds).append(
            (part, find(have[need[0]]), find(have[need[1]])))
    if len(cells) != 1:
        issue("error", "cell", f"a circuit needs exactly one cell, has {len(cells)}")
    lit: list[str] = []
    loop: list[str] = []
    for part, a, k in leds:
        if a == k:
            issue("warning", "led_shorted", f"LED '{part}': anode and cathode on one net")
    for part, plus, minus in cells[:1]:
        if plus == minus:
            issue("error", "short", f"cell '{part}': plus and minus on one net (short circuit)")
            continue
        loop = _led_path(plus, minus, leds)
        if loop:
            lit = sorted({p for p, a, k in leds if _reach(plus, a, leds) and _reach(k, minus,
                                                                                     leds)})
            if len(loop) > 1:
                issue("warning", "series_leds", f"{len(loop)} LEDs in series: their forward "
                      "voltages add up, more than one coin cell can drive")
        elif _led_path(plus, minus, leds + [(p, k, a) for p, a, k in leds]):
            issue("error", "reversed", "the loop closes only through an LED wired backwards "
                  "(anode and cathode swapped)")
    return {"closed": bool(loop), "lit": lit, "loop": loop,
            "nets": len({find(i) for i in range(len(traces))}), "issues": issues}


def _paths_touch(a: dict, b: dict) -> bool:
    gap = (a["width_mm"] + b["width_mm"]) / 2.0
    pa, pb = a["path"], b["path"]
    sa = list(zip(pa, pa[1:], strict=False))
    sb = list(zip(pb, pb[1:], strict=False))
    return any(_seg_dist(p, b0, b1) <= gap for p in pa for b0, b1 in sb) \
        or any(_seg_dist(p, a0, a1) <= gap for p in pb for a0, a1 in sa) \
        or any(_cross(a0, a1, b0, b1) for a0, a1 in sa for b0, b1 in sb)


def _reach(src: int, dst: int, leds) -> bool:
    seen, todo = {src}, [src]
    while todo:
        n = todo.pop()
        if n == dst:
            return True
        for _, a, k in leds:
            if a == n and k not in seen:
                seen.add(k)
                todo.append(k)
    return False


def _led_path(src: int, dst: int, leds) -> list[str]:
    """The LEDs on a shortest forward path from net `src` to net `dst` (breadth first)."""
    prev: dict[int, tuple[int, str] | None] = {src: None}
    todo = [src]
    while todo:
        nxt = []
        for n in todo:
            for part, a, k in leds:
                if a == n and k not in prev:
                    prev[k] = (n, part)
                    nxt.append(k)
        todo = nxt
    if dst not in prev:
        return []
    out, n = [], dst
    while prev[n] is not None:
        n, part = prev[n]
        out.append(part)
    return out[::-1]


def fold_switch_closes(finishes: Sequence[dict], switch: str, line, direction: str = "valley",
                       tol: float | None = None) -> list[str]:
    """Problems with a fold switch (empty = it closes): folding the sheet along the sheet-local
    `line` ((a, b)) by 180° must bring the switch's two ``contact`` pads face to face — on the
    same sheet, on the side that folds inward (the front for a valley fold, the back for a
    mountain fold), on opposite sides of the line, one pad's mirror image overlapping the other
    by at least half the smaller pad in each direction (plus ``tol`` mm of slack)."""
    pads = [(f, pd) for f in finishes if isinstance(f, dict) and f.get("kind") == "trace"
            for pd in f.get("pads") or [] if pd.get("part") == switch and pd.get("pin") ==
            "contact"]
    if len(pads) != 2:
        return [f"switch '{switch}' needs two contact pads, has {len(pads)}"]
    (fa, a), (fb, b) = pads
    p = []
    inward = "front" if direction == "valley" else "back"
    if fa["sheet"] != fb["sheet"]:
        p.append("the contacts lie on different sheets")
    if fa["side"] != inward or fb["side"] != inward:
        p.append(f"a {direction} fold brings the {inward} faces together; a contact is on the "
                 "other side")
    (x0, y0), (x1, y1) = line
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy)
    if ln < 1e-9:
        return p + ["the fold line has no length"]
    ux, uy = dx / ln, dy / ln

    def side_of(q):
        return (q[0] - x0) * uy - (q[1] - y0) * ux
    sa, sb = side_of(a["at"]), side_of(b["at"])
    if sa * sb >= 0:
        p.append("the contacts are not on opposite sides of the fold line")
    t = (a["at"][0] - x0) * ux + (a["at"][1] - y0) * uy
    mx = 2.0 * (x0 + t * ux) - a["at"][0]
    my = 2.0 * (y0 + t * uy) - a["at"][1]
    reach = min(a["size_mm"], b["size_mm"]) / 2.0 + (0.0 if tol is None else float(tol))
    off = max(abs(mx - b["at"][0]), abs(my - b["at"][1]))
    if off > reach + 1e-9:
        p.append(f"folded, contact '{a['id']}' lands {off:.2f} mm off contact '{b['id']}' "
                 f"(at most {reach:.2f} mm)")
    return p
