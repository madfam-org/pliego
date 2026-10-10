"""Fabrication plan: a sheet document reduced to layered polylines (shared by every 2-D exporter).

Input is the sheet-document contract (``docs/spec/v1/sheet-document.md``): a dict, a JSON string,
or any object with ``to_json()``. Lines are classified by assignment + treatment (spec §4):

| layer         | edges                                                                  |
|---------------|------------------------------------------------------------------------|
| ``cut``       | ``B`` outline (outer / holes) and ``cut`` treatment (``C``)            |
| ``mountain``  | ``M`` with ``crease`` treatment                                        |
| ``valley``    | ``V`` with ``crease`` treatment                                        |
| ``score``     | ``score`` treatment (any assignment), ``F`` creases, ``halfcut``       |
| ``perforation`` | ``perforation`` treatment; dashes from the stock's ``perf_factor``  |

``J``/``U`` and treatment ``none`` are never drawn. Edges of one sheet, layer and kind are chained
into polylines through vertices of degree two, in authored order (byte-deterministic).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

Point = tuple[float, float]

LAYERS = ("cut", "mountain", "valley", "score", "perforation")
PERF_PITCH_MM = 4.0          # one cut + one bridge; bridge = pitch × perf_factor
DEFAULT_PERF_FACTOR = 0.25
LABEL_DROP_MM = 6.0          # sheet labels sit this far below the sheet
REG_OFFSET_MM = 7.0          # registration frame = drawing bounds grown by this
REG_SQUARE_MM = 5.0
REG_ARM_MM = 10.0
CANVAS_PAD_MM = 8.0         # page canvas = registration frame grown by this


@dataclass(frozen=True)
class Stroke:
    layer: str
    sheet: int
    points: tuple[Point, ...]
    closed: bool
    kind: str                # "B", "C", "M", "V", "F", "halfcut", "score", "perforation"
    inner: bool = False      # cut layer: hole or interior cut (cut before the outer outline)


@dataclass(frozen=True)
class Glue:
    join: str
    sheet: int
    points: tuple[Point, ...]


@dataclass(frozen=True)
class Label:
    sheet: int
    at: Point
    text: str


@dataclass(frozen=True)
class Art:
    sheet: int
    href: str
    lo: Point
    hi: Point


@dataclass
class Plan:
    title: str
    strokes: list[Stroke] = field(default_factory=list)
    glue: list[Glue] = field(default_factory=list)
    labels: list[Label] = field(default_factory=list)
    art: list[Art] = field(default_factory=list)
    perf_factor: dict[int, float] = field(default_factory=dict)
    bounds: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)

    def layer(self, name: str) -> list[Stroke]:
        return [s for s in self.strokes if s.layer == name]

    def registration_frame(self) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = self.bounds
        return (x0 - REG_OFFSET_MM, y0 - REG_OFFSET_MM, x1 + REG_OFFSET_MM, y1 + REG_OFFSET_MM)

    def canvas(self) -> tuple[float, float, float, float]:
        """(origin x, origin y, width, height) of the drawing canvas in layout mm."""
        x0, y0, x1, y1 = self.registration_frame()
        pad = CANVAS_PAD_MM
        return (x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)


def as_document(doc: Any) -> dict[str, Any]:
    """Accept a document dict, JSON text/bytes, or an object with ``to_json()``."""
    if hasattr(doc, "to_json") and not isinstance(doc, (dict, str, bytes)):
        doc = doc.to_json()
    if isinstance(doc, (str, bytes)):
        doc = json.loads(doc)
    if not isinstance(doc, dict) or "vertices_coords" not in doc:
        raise ValueError("not a sheet document (vertices_coords missing)")
    return doc


def classify(assignment: str, treatment: str) -> tuple[str, str] | None:
    """(layer, kind) of an edge, or None when it is not drawn."""
    if assignment == "B":
        return ("cut", "B")
    if treatment == "cut" or assignment == "C" and treatment != "perforation":
        return ("cut", "C")
    if treatment == "perforation":
        return ("perforation", "perforation")
    if treatment == "score":
        return ("score", "score")
    if treatment == "halfcut":
        return ("score", "halfcut")
    if treatment == "crease":
        if assignment == "M":
            return ("mountain", "M")
        if assignment == "V":
            return ("valley", "V")
        return ("score", "F")
    return None


def signed_area(pts: tuple[Point, ...] | list[Point]) -> float:
    n = len(pts)
    return 0.5 * math.fsum(
        pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)
    )


def _chains(edge_ids: list[int], ev: list[list[int]]) -> list[tuple[list[int], bool]]:
    """Chain edges through degree-2 vertices; returns (vertex path, closed) in authored order."""
    incident: dict[int, list[int]] = {}
    for e in edge_ids:
        for v in ev[e]:
            incident.setdefault(v, []).append(e)
    used: set[int] = set()

    def walk(path: list[int], last_edge: int) -> None:
        while True:
            tip = path[-1]
            nxt = [e for e in incident[tip] if e != last_edge]
            if len(incident[tip]) != 2 or not nxt or nxt[0] in used:
                return
            last_edge = nxt[0]
            used.add(last_edge)
            a, b = ev[last_edge]
            path.append(b if a == tip else a)
            if path[-1] == path[0]:
                return

    out: list[tuple[list[int], bool]] = []
    for e in edge_ids:
        if e in used:
            continue
        used.add(e)
        a, b = ev[e]
        fwd = [a, b]
        walk(fwd, e)
        if len(fwd) > 2 and fwd[-1] == fwd[0]:
            out.append((fwd[:-1], True))
            continue
        back = [b, a]                       # extend from the start vertex, away from e
        walk(back, e)
        out.append((back[:1:-1] + fwd, False))
    return out


def _inside(p: Point, ring: tuple[Point, ...]) -> bool:
    """Even-odd point-in-polygon (boundary points count as outside)."""
    x, y = p
    hit = False
    n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xc = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if abs(xc - x) < 1e-9:
                return False
            if xc > x:
                hit = not hit
    return hit


def _dedupe_coincident(edge_ids: list[int], ev: list[list[int]],
                       coords: list[Point], tol: float = 1e-6) -> list[int]:
    """Drop cut edges already covered by earlier collinear cut edges (both sides of a split).

    A cut separates the sheet, so FOLD carries its line once per side; the cutter must pass once.
    """
    kept: list[int] = []
    for e in edge_ids:
        a, b = coords[ev[e][0]], coords[ev[e][1]]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln2 = dx * dx + dy * dy
        if ln2 <= tol * tol:
            continue
        spans: list[tuple[float, float]] = []
        for k in kept:
            c, d = coords[ev[k][0]], coords[ev[k][1]]
            off_c = abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / math.sqrt(ln2)
            off_d = abs((d[0] - a[0]) * dy - (d[1] - a[1]) * dx) / math.sqrt(ln2)
            if off_c > tol or off_d > tol:
                continue
            tc = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / ln2
            td = ((d[0] - a[0]) * dx + (d[1] - a[1]) * dy) / ln2
            spans.append((min(tc, td), max(tc, td)))
        reach = 0.0
        for lo, hi in sorted(spans):
            if lo > reach + tol:
                break
            reach = max(reach, hi)
        if reach < 1.0 - tol:
            kept.append(e)
    return kept


def perforation_dashes(points: tuple[Point, ...], closed: bool, perf_factor: float,
                       pitch: float = PERF_PITCH_MM) -> list[tuple[Point, Point]]:
    """Cut dashes along a polyline: each pitch is ½ bridge · cut · ½ bridge (ends stay bridged)."""
    pts = list(points) + ([points[0]] if closed else [])
    segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    lengths = [math.dist(a, b) for a, b in segs]
    total = math.fsum(lengths)
    if total <= 0:
        return []
    n = max(1, round(total / pitch))
    p = total / n
    bridge = p * min(max(perf_factor, 0.05), 0.95)
    cut = p - bridge

    def at(s: float) -> Point:
        acc = 0.0
        for (a, b), ln in zip(segs, lengths, strict=True):
            if ln > 0 and s <= acc + ln:
                t = (s - acc) / ln
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            acc += ln
        return pts[-1]

    return [(at(k * p + bridge / 2), at(k * p + bridge / 2 + cut)) for k in range(n)]


def build_plan(doc: Any) -> Plan:
    """Reduce a sheet document to a :class:`Plan` (layout frame, mm, y-up)."""
    d = as_document(doc)
    coords: list[Point] = [(float(x), float(y)) for x, y, *_ in d["vertices_coords"]]
    ev: list[list[int]] = d["edges_vertices"]
    assign: list[str] = d["edges_assignment"]
    treat: list[str] = d.get("pliego:edges_treatment") or [
        "crease" if a in "MV" else "cut" if a == "C" else "none" for a in assign
    ]
    edge_sheet: list[int] = d.get("pliego:edges_sheet") or [0] * len(ev)
    sheets: list[dict[str, Any]] = d.get("pliego:sheets") or [
        {"id": "sheet-0", "label": {"en": "sheet-0"}, "stock": "kami", "offset": [0, 0]}
    ]
    stocks: dict[str, Any] = d.get("pliego:stocks") or {}
    plan = Plan(title=str(d.get("file_title") or (d.get("pliego:meta") or {}).get(
        "cartridge") or "pliego"))
    for i, sheet in enumerate(sheets):
        derived = (stocks.get(sheet.get("stock")) or {}).get("derived") or {}
        plan.perf_factor[i] = float(derived.get("perf_factor", DEFAULT_PERF_FACTOR))

    groups: dict[tuple[int, str, str], list[int]] = {}
    for e, (a, t) in enumerate(zip(assign, treat, strict=True)):
        cls = classify(a, t)
        if cls is not None:
            groups.setdefault((edge_sheet[e], cls[0], cls[1]), []).append(e)
    for (sheet, layer, kind), edge_ids in groups.items():
        if kind == "C":
            edge_ids = _dedupe_coincident(edge_ids, ev, coords)
        chains = _chains(edge_ids, ev)
        loops = [tuple(coords[v] for v in path) for path, closed in chains if closed]
        for path, closed in chains:
            pts = tuple(coords[v] for v in path)
            inner = kind == "C" or (kind == "B" and closed and any(
                other is not pts and _inside(pts[0], other) for other in loops))
            plan.strokes.append(Stroke(layer, sheet, pts, closed, kind, inner))

    sheet_index = {s["id"]: i for i, s in enumerate(sheets)}
    for join in d.get("pliego:joins") or []:
        if join.get("type") != "glue":
            continue
        i = sheet_index[join["a"]["sheet"]]
        ox, oy = sheets[i].get("offset", [0, 0])
        plan.glue.append(Glue(join["id"], i, tuple((u + ox, v + oy)
                                                   for u, v in join["a"]["region"])))

    vert_sheet: list[int] = d.get("pliego:vertices_sheet") or [0] * len(coords)
    xs_all = [p[0] for p in coords]
    ys_all = [p[1] for p in coords]
    for i, sheet in enumerate(sheets):
        pts = [coords[v] for v in range(len(coords)) if vert_sheet[v] == i]
        if not pts:
            continue
        lo = (min(p[0] for p in pts), min(p[1] for p in pts))
        hi = (max(p[0] for p in pts), max(p[1] for p in pts))
        label = sheet.get("label") or {}
        plan.labels.append(Label(i, (lo[0], lo[1] - LABEL_DROP_MM),
                                 str(label.get("en") or sheet["id"])))
        art = (sheet.get("front") or {}).get("art")
        if art:
            plan.art.append(Art(i, str(art), lo, hi))
    if plan.labels:
        ys_all.append(min(lb.at[1] for lb in plan.labels) - 1.0)
    for g in plan.glue:
        xs_all += [p[0] for p in g.points]
        ys_all += [p[1] for p in g.points]
    plan.bounds = (min(xs_all), min(ys_all), max(xs_all), max(ys_all))
    return plan


def registration_marks(plan: Plan) -> tuple[list[tuple[Point, ...]], list[tuple[Point, ...]]]:
    """Print-then-cut marks: (filled squares, L-shaped polylines) around the drawing.

    A filled square at the top-left corner of the registration frame and L corners at the
    other three — the common layout of desktop print-then-cut systems. These are generic marks
    for manual or vision alignment; vendor software usually adds its own (no compatibility claim).
    """
    x0, y0, x1, y1 = plan.registration_frame()
    s, a = REG_SQUARE_MM, REG_ARM_MM
    squares = [((x0, y1), (x0 + s, y1), (x0 + s, y1 - s), (x0, y1 - s))]
    ls = [
        ((x1 - a, y1), (x1, y1), (x1, y1 - a)),
        ((x0, y0 + a), (x0, y0), (x0 + a, y0)),
        ((x1 - a, y0), (x1, y0), (x1, y0 + a)),
    ]
    return squares, ls


def fmt(x: float, digits: int = 3) -> str:
    """Fixed-precision number with trailing zeros stripped and no negative zero."""
    s = f"{x:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s
