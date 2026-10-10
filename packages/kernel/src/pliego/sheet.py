# Adapted from Fashion Cabinet fc/piece.py (madfam-org/fashion-cabinet, AGPL-3.0, same owner).
"""`Sheet` — the authoring API for one flat sheet (outline, holes, lines, tabs, art).

Coordinates are sheet-local mm, y-up; the outline is normalised to counter-clockwise and holes to
clockwise. Every authoring call returns a `Mark` handle that fold programs (`Sequence` targets)
reference; `build()` runs the planar subdivision and maps each mark to its edges.

Fold angles follow FOLD: positive = valley, negative = mountain (spec §1). `angle` and `rest`
arguments are magnitudes for valley/mountain lines; the sign comes from `kind`.

Stable edge names (spec §3 `pliego:edges_name`): `name=` on any authored line names every edge it
produces; `label_edge(name, a, b)` names whichever edges lie on the segment a–b (outline edges
included); `tab(..., name=)` names the tab's hinge and its free outline edges. Several edges may
share a name; an edge given two different names fails the build.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from .arrangement import Arrangement, SegmentInput, build_arrangement
from .geometry import (
    EPS,
    Arc,
    Bezier,
    Line,
    PointLike,
    Vec2,
    as_vec,
    ensure_ccw,
    flatten_path,
    is_simple_polygon,
    point_in_polygon,
    polygon_area,
)

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
KINDS = {"valley": "V", "mountain": "M", "flat": "F", "unassigned": "U", "cut": "C"}
ALLOWED = {  # spec §4: treatment → allowed assignments (B and J are never authored)
    "none": {"F", "U"},
    "crease": {"M", "V", "F"},
    "score": {"M", "V", "F"},
    "perforation": {"M", "V", "F", "C"},
    "cut": {"C"},
    "halfcut": {"F"},
}
FLATTEN_TOL = 0.05  # mm, chord tolerance when flattening curves
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_FACE_COLOR = "#f4efe6"  # when neither the sheet nor its stock's appearance says otherwise

Label = dict[str, str]


def i18n(value: str | dict[str, str] | None, fallback: str) -> Label:
    """Normalise a label to an i18n object with `en` (strings become {"en": s})."""
    if value is None:
        return {"en": fallback}
    if isinstance(value, str):
        if not value:
            raise ValueError("label must not be empty")
        return {"en": value}
    if not isinstance(value, dict) or not value.get("en"):
        raise ValueError(f"label needs an 'en' entry, got {value!r}")
    bad = set(value) - {"en", "es", "fr", "pt"}
    if bad:
        raise ValueError(f"label has unknown languages {sorted(bad)}")
    return {k: str(value[k]) for k in ("en", "es", "fr", "pt") if k in value}


def check_slug(value: str, what: str) -> str:
    if not isinstance(value, str) or not SLUG.match(value) or len(value) > 80:
        raise ValueError(f"{what} {value!r} must be strict kebab case (a-z, 0-9, '-')")
    return value


def _opt_name(name: str | None) -> str | None:
    return None if name is None else check_slug(name, "edge name")


@dataclass(eq=False)
class Mark:
    """A handle on one authored line (crease, score, perforation, cut, slit, tab hinge)."""

    sheet: Sheet = field(repr=False)
    index: int
    assignment: str
    fold_angle: float
    treatment: str
    points: list[Vec2]
    label: Label | None = None
    name: str | None = None          # stable edge name (pliego:edges_name)
    rest: float | None = None        # plastic rest angle, signed deg (pliego:edges_restAngle)

    def edges(self) -> list[int]:
        """Sheet-local edge indices of this mark after subdivision (build on demand)."""
        return self.sheet.build().edges_of_tag(self.index)

    def __hash__(self) -> int:
        return hash((id(self.sheet), self.index))

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Mark) and other.sheet is self.sheet and other.index == self.index


@dataclass
class Tab:
    """A glue tab added to the outline: its hinge mark and its region (sheet-local polygon)."""

    mark: Mark
    region: list[Vec2]
    name: str | None = None


@dataclass
class Face:
    """Render appearance of one side. `color=None` inherits the stock's appearance (spec §5.2)."""

    color: str | None = None
    art: str | None = None

    def to_dict(self, inherit: str | None = None) -> dict:
        return {"color": self.color or inherit or DEFAULT_FACE_COLOR, "art": self.art}


@dataclass
class Placement:
    """Rigid transform after the (u, v) → (u, 0, −v) map: quaternion [x, y, z, w], then origin."""

    origin: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)

    def is_identity(self) -> bool:
        return (all(abs(c) < 1e-12 for c in self.origin)
                and all(abs(c) < 1e-12 for c in self.rotation[:3]))


@dataclass(eq=False)
class Sheet:
    """One flat sheet of a document (spec §5.1), authored in sheet-local mm."""

    id: str
    outline: Sequence[PointLike | Line | Bezier | Arc]
    stock: str = "kami"
    grain_deg: float = 90.0
    label: str | dict[str, str] | None = None
    front: Face | dict | str | None = None
    back: Face | dict | str | None = None
    placement: Placement | None = None
    kinematic: str | None = None  # mechanism id driving this rigid sheet
    marks: list[Mark] = field(default_factory=list, init=False)
    holes: list[list[Vec2]] = field(default_factory=list, init=False)
    tabs: list[Tab] = field(default_factory=list, init=False)
    edge_labels: list[tuple[str, Vec2, Vec2]] = field(default_factory=list, init=False)
    annotations: list[dict] = field(default_factory=list, init=False)
    _hole_boxes: list[tuple[float, float, float, float]] = field(default_factory=list,
                                                                 init=False, repr=False)
    _built: Arrangement | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        check_slug(self.id, "sheet id")
        check_slug(self.stock, "stock")
        ring = flatten_path(self.outline, FLATTEN_TOL)
        if len(ring) > 3 and ring[0].distance(ring[-1]) <= EPS:
            ring = ring[:-1]
        self.outline = self._check_ring(ring, "outline")
        self.label = i18n(self.label, self.id)
        self.front = _face(self.front)
        self.back = _face(self.back)
        self.placement = self.placement or Placement()
        if not math.isfinite(self.grain_deg):
            raise ValueError("grain_deg must be finite")
        if self.kinematic is not None:
            check_slug(self.kinematic, "kinematic mechanism")

    def __hash__(self) -> int:
        return id(self)

    # ── validation helpers ──────────────────────────────────────────────────

    def _check_ring(self, ring: list[Vec2], what: str) -> list[Vec2]:
        if len(ring) < 3:
            raise ValueError(f"sheet '{self.id}': {what} needs at least 3 points")
        if abs(polygon_area(ring)) < 1e-6:
            raise ValueError(f"sheet '{self.id}': {what} has zero area")
        if not is_simple_polygon(ring):
            raise ValueError(f"sheet '{self.id}': {what} is not a simple polygon")
        return ensure_ccw(ring)

    def _inside(self, p: Vec2) -> bool:
        return point_in_polygon(p, self.outline) >= 0  # type: ignore[arg-type]

    def _touch(self) -> None:
        self._built = None

    # ── authoring ───────────────────────────────────────────────────────────

    def _add(self, points: Sequence[PointLike], assignment: str, angle: float, treatment: str,
             label: str | dict | None, name: str | None = None,
             rest: float | None = None) -> Mark:
        pts = [as_vec(p) for p in points]
        if len(pts) < 2:
            raise ValueError(f"sheet '{self.id}': a line needs at least 2 points")
        for p, q in zip(pts, pts[1:], strict=False):
            if p.distance(q) <= EPS:
                raise ValueError(f"sheet '{self.id}': zero-length segment at ({p.x}, {p.y})")
        if treatment not in ALLOWED:
            raise ValueError(f"unknown treatment {treatment!r} (allowed {sorted(ALLOWED)})")
        if assignment not in ALLOWED[treatment]:
            raise ValueError(f"treatment {treatment!r} does not allow assignment {assignment!r}")
        if not math.isfinite(angle) or abs(angle) > 180:
            raise ValueError(f"fold angle {angle} outside [−180, 180]")
        if assignment == "V":
            fa = abs(angle)
        elif assignment == "M":
            fa = -abs(angle)
        else:
            fa = 0.0
        rest_deg = None
        if rest is not None:
            if not math.isfinite(rest) or abs(rest) > 180:
                raise ValueError(f"rest angle {rest} outside [−180, 180]")
            if assignment == "C":
                raise ValueError(f"sheet '{self.id}': a cut has no rest angle")
            rest_deg = abs(rest) if assignment == "V" else (-abs(rest) if assignment == "M"
                                                          else float(rest))
        mark = Mark(self, len(self.marks), assignment, fa, treatment, pts,
                    None if label is None else i18n(label, ""), _opt_name(name), rest_deg)
        self.marks.append(mark)
        self._touch()
        return mark

    def crease(self, a: PointLike, b: PointLike, kind: str = "valley", angle: float = 180.0,
               treatment: str = "crease", label: str | dict | None = None, *,
               name: str | None = None, rest: float | None = None) -> Mark:
        """A fold line from a to b. `kind` ∈ valley | mountain | flat | unassigned.

        `rest` pre-creases it: the plastic rest angle at t = 0 (a magnitude for valley/mountain,
        signed as given for flat/unassigned). `name` is its stable edge name."""
        if kind not in KINDS or kind == "cut":
            raise ValueError(f"unknown crease kind {kind!r}")
        return self._add([a, b], KINDS[kind], angle, treatment, label, name, rest)

    def valley(self, a: PointLike, b: PointLike, angle: float = 180.0,
               treatment: str = "crease", label: str | dict | None = None, *,
               name: str | None = None, rest: float | None = None) -> Mark:
        return self.crease(a, b, "valley", angle, treatment, label, name=name, rest=rest)

    def mountain(self, a: PointLike, b: PointLike, angle: float = 180.0,
                 treatment: str = "crease", label: str | dict | None = None, *,
                 name: str | None = None, rest: float | None = None) -> Mark:
        return self.crease(a, b, "mountain", angle, treatment, label, name=name, rest=rest)

    def path(self, points: Sequence[PointLike], kind: str = "valley", angle: float = 180.0,
             treatment: str = "crease", label: str | dict | None = None, *,
             name: str | None = None, rest: float | None = None) -> Mark:
        """A polyline of lines with one assignment (curved creases: pass flattened points)."""
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")
        return self._add(points, KINDS[kind], angle, treatment, label, name, rest)

    def score(self, a: PointLike, b: PointLike, kind: str = "flat", angle: float = 0.0,
              label: str | dict | None = None, *, name: str | None = None,
              rest: float | None = None) -> Mark:
        """A scored line (blade/laser at reduced power); folds if `kind` is valley/mountain."""
        return self.crease(a, b, kind, angle, "score", label, name=name, rest=rest)

    def bend(self, a: PointLike, b: PointLike, label: str | dict | None = None, *,
             name: str | None = None) -> Mark:
        """An untreated facet line (spec §4: `F` + treatment `none`): plain paper that bends
        smoothly — the rulings of a rolled cone or cylinder, the facets of a curved surface.
        It splits faces so a fold program can target it, but nothing scores or creases it, so
        exporters never draw it. Polylines: `path(points, "flat", treatment="none")`."""
        return self.crease(a, b, "flat", 0.0, "none", label, name=name)

    def perforate(self, a: PointLike, b: PointLike, kind: str = "flat", angle: float = 0.0,
                  label: str | dict | None = None, *, name: str | None = None,
                  rest: float | None = None) -> Mark:
        """A perforated line; `kind="cut"` makes a tear-off perforation (assignment C)."""
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")
        return self._add([a, b], KINDS[kind], angle, "perforation", label, name, rest)

    def cut(self, polyline: Sequence[PointLike | Line | Bezier | Arc], closed: bool = False,
            label: str | dict | None = None, *, name: str | None = None) -> Mark:
        """A through cut / slit (assignment C). A closed cut leaves the island in place."""
        pts = flatten_path(polyline, FLATTEN_TOL)
        if closed:
            pts = pts + [pts[0]]
        return self._add(pts, "C", 0.0, "cut", label, name)

    def halfcut(self, polyline: Sequence[PointLike], label: str | dict | None = None, *,
                name: str | None = None) -> Mark:
        """A kiss cut (does not change bending; assignment F)."""
        return self._add(flatten_path(polyline, FLATTEN_TOL), "F", 0.0, "halfcut", label, name)

    def label_edge(self, name: str, a: PointLike, b: PointLike) -> Sheet:
        """Name every edge lying on the segment a–b (within `EPS`), outline edges included —
        `spine`, `gutter`, `fore-edge`… Resolved at document build; matching nothing fails."""
        pa, pb = as_vec(a), as_vec(b)
        if pa.distance(pb) <= EPS:
            raise ValueError(f"sheet '{self.id}': label_edge needs two distinct points")
        self.edge_labels.append((check_slug(name, "edge name"), pa, pb))
        return self

    def hole(self, polygon: Sequence[PointLike | Line | Bezier | Arc]) -> list[Vec2]:
        """Remove a region (its boundary becomes outline `B`); must lie strictly inside."""
        ring = flatten_path(polygon, FLATTEN_TOL)
        if len(ring) > 3 and ring[0].distance(ring[-1]) <= EPS:
            ring = ring[:-1]
        ring = self._check_ring(ring, "hole")
        for p in ring:
            if point_in_polygon(p, self.outline) != 1:  # type: ignore[arg-type]
                raise ValueError(f"sheet '{self.id}': hole point ({p.x}, {p.y}) not inside")
        box = _box(ring, EPS)
        for other, obox in zip(self.holes, self._hole_boxes, strict=True):
            if not _boxes_meet(box, obox):
                continue  # disjoint boxes: no point of one can be in or on the other
            for p in ring:
                if point_in_polygon(p, other) != -1:
                    raise ValueError(f"sheet '{self.id}': holes overlap at ({p.x}, {p.y})")
        cw = list(reversed(ring))
        self.holes.append(cw)
        self._hole_boxes.append(box)
        self._touch()
        return cw

    def tab(self, edge: int | tuple[PointLike, PointLike], width: float = 8.0,
            taper: float = 45.0, kind: str = "valley", angle: float = 90.0,
            treatment: str = "score", *, name: str | None = None) -> Tab:
        """Add a glue tab outside an outline edge (index into the current outline, or its two
        end points). The edge becomes a hinge line; `taper` is the side angle in degrees.
        `name` names the glue tab's edges: its hinge and its three free outline edges."""
        ring: list[Vec2] = list(self.outline)  # type: ignore[arg-type]
        n = len(ring)
        if isinstance(edge, int):
            if not 0 <= edge < n:
                raise ValueError(f"sheet '{self.id}': outline has no edge {edge}")
            i = edge
        else:
            a, b = as_vec(edge[0]), as_vec(edge[1])
            hits = [k for k in range(n) if ring[k].distance(a) <= EPS
                    and ring[(k + 1) % n].distance(b) <= EPS]
            hits += [k for k in range(n) if ring[k].distance(b) <= EPS
                     and ring[(k + 1) % n].distance(a) <= EPS]
            if not hits:
                raise ValueError(f"sheet '{self.id}': ({a.x}, {a.y})–({b.x}, {b.y}) is not an "
                                 "outline edge")
            i = hits[0]
        if width <= 0 or not 0 < taper <= 90:
            raise ValueError("tab needs width > 0 and 0 < taper ≤ 90")
        a, b = ring[i], ring[(i + 1) % n]
        d = (b - a).normalized()
        out = Vec2(d.y, -d.x)
        inset = 0.0 if taper >= 90 else width / math.tan(math.radians(taper))
        if 2 * inset >= a.distance(b) - EPS:
            raise ValueError(f"sheet '{self.id}': tab taper too shallow for a "
                             f"{a.distance(b):.2f} mm edge")
        a2 = a + out * width + d * inset
        b2 = b + out * width - d * inset
        new_ring = ring[: i + 1] + [a2, b2] + ring[i + 1:]
        if not is_simple_polygon(new_ring):
            raise ValueError(f"sheet '{self.id}': tab on edge {i} self-intersects the outline")
        self.outline = new_ring
        mark = self.crease(a, b, kind, angle, treatment, name=name)
        tab = Tab(mark, [a, b, b2, a2][::-1] if polygon_area([a, b, b2, a2]) < 0
                  else [a, b, b2, a2], _opt_name(name))
        if name is not None:
            for p, q in ((b, b2), (b2, a2), (a2, a)):
                self.label_edge(name, p, q)
        self.tabs.append(tab)
        self._touch()
        return tab

    def text(self, at: PointLike, text: str, angle: float = 0.0, size: float = 3.0) -> Sheet:
        """Print a short text on the front, centred at `at` (sheet-local), its baseline
        `angle`° from +u, `size` mm tall — edge numbers, part names (spec §5.12,
        `pliego:annotations`). Print only: no physics."""
        p = as_vec(at)
        if not isinstance(text, str) or not 1 <= len(text) <= 32 or not text.isprintable():
            raise ValueError(f"sheet '{self.id}': annotation text must be 1–32 printable "
                             "characters")
        if not (math.isfinite(angle) and math.isfinite(size) and 0.5 <= size <= 50.0):
            raise ValueError(f"sheet '{self.id}': annotation size must be 0.5–50 mm")
        if not self.region_contains(p):
            raise ValueError(f"sheet '{self.id}': annotation at ({p.x}, {p.y}) is off the sheet")
        self.annotations.append({"at": p, "text": text, "angle": float(angle),
                                 "size": float(size)})
        return self

    def art(self, front: str | None = None, back: str | None = None) -> Sheet:
        """Attach printed art (relative image paths covering the local bounding box)."""
        if front is not None:
            self.front = Face(self.front.color, front)  # type: ignore[union-attr]
        if back is not None:
            self.back = Face(self.back.color, back)  # type: ignore[union-attr]
        return self

    # ── build ───────────────────────────────────────────────────────────────

    def build(self) -> Arrangement:
        """Planar subdivision of this sheet (cached until the next authoring call, and shared
        by sheets with identical geometry — see `arrangement_cache`)."""
        if self._built is None:
            segs = [SegmentInput(p, q, m.assignment, m.fold_angle, m.treatment, m.index)
                    for m in self.marks for p, q in zip(m.points, m.points[1:], strict=False)]
            self._built = cached_arrangement(list(self.outline), list(self.holes), segs)  # type: ignore[arg-type]
        return self._built

    def region_contains(self, p: PointLike) -> bool:
        """True when a sheet-local point lies on the sheet material (outline minus holes)."""
        q = as_vec(p)
        if not self._inside(q):
            return False
        return all(point_in_polygon(q, h) != 1 for h, (x0, y0, x1, y1)
                   in zip(self.holes, self._hole_boxes, strict=True)
                   if x0 <= q.x <= x1 and y0 <= q.y <= y1)

    def copy(self, new_id: str, *, label: str | dict | None = None,
             placement: Placement | None = None) -> Sheet:
        """An identical sheet under a new id (outline, holes, marks, tabs, names, faces, stock).

        The copy reuses this sheet's built arrangement (no second subdivision): a banner of
        identical flags builds one. Marks are re-bound to the copy, so `copy_mark.edges()` and
        sequence targets refer to the new sheet."""
        out = Sheet(new_id, list(self.outline), stock=self.stock,  # type: ignore[arg-type]
                    grain_deg=self.grain_deg,
                    label=self.label if label is None else label,  # type: ignore[arg-type]
                    front=Face(self.front.color, self.front.art),  # type: ignore[union-attr]
                    back=Face(self.back.color, self.back.art),  # type: ignore[union-attr]
                    placement=placement or self.placement, kinematic=self.kinematic)
        out.outline = list(self.outline)  # type: ignore[arg-type]
        out.holes = [list(h) for h in self.holes]
        out._hole_boxes = list(self._hole_boxes)
        out.marks = [Mark(out, m.index, m.assignment, m.fold_angle, m.treatment, list(m.points),
                          None if m.label is None else dict(m.label), m.name, m.rest)
                     for m in self.marks]
        out.tabs = [Tab(out.marks[t.mark.index], list(t.region), t.name) for t in self.tabs]
        out.edge_labels = list(self.edge_labels)
        out.annotations = [dict(a) for a in self.annotations]
        out._built = self._built
        return out

    # ── per-edge attributes beyond the arrangement (names, rest angles) ───────

    def edge_names(self, arr: Arrangement | None = None) -> list[str | None]:
        """`pliego:edges_name` of this sheet's edges (None = unnamed); fails on conflicts and on
        a `label_edge` segment that matches no edge."""
        arr = arr or self.build()
        names: list[str | None] = [None] * len(arr.edges)

        def put(e: int, name: str, why: str) -> None:
            if names[e] not in (None, name):
                raise ValueError(f"sheet '{self.id}': edge {e} is named both "
                                 f"'{names[e]}' and '{name}' ({why})")
            names[e] = name

        for e, tags in enumerate(arr.tags):
            for t in tags:
                if self.marks[t].name is not None:
                    put(e, self.marks[t].name, f"mark {t}")  # type: ignore[arg-type]
        verts = arr.vertices
        for name, a, b in self.edge_labels:
            hits = [e for e, (i, j) in enumerate(arr.edges)
                    if _on_segment(verts[i], a, b) and _on_segment(verts[j], a, b)]
            if not hits:
                raise ValueError(f"sheet '{self.id}': label_edge '{name}' ({a.x}, {a.y})–"
                                 f"({b.x}, {b.y}) matches no edge")
            for e in hits:
                put(e, name, "label_edge")
        return names

    def edge_rest_angles(self, arr: Arrangement | None = None) -> list[float]:
        """`pliego:edges_restAngle` (deg): an edge takes the rest angle of its first authored
        mark that sets one (0 otherwise, and always 0 on B/C/J edges)."""
        arr = arr or self.build()
        out = [0.0] * len(arr.edges)
        for e, tags in enumerate(arr.tags):
            if arr.assignment[e] in ("B", "C", "J"):
                continue
            for t in tags:
                if self.marks[t].rest is not None:
                    out[e] = float(self.marks[t].rest)  # type: ignore[arg-type]
                    break
        return out


def _face(value: Face | dict | str | None) -> Face:
    """A face; an unauthored colour (None) inherits the stock's appearance at build time."""
    if value is None:
        return Face()
    if isinstance(value, Face):
        face = value
    elif isinstance(value, str):
        face = Face(value)
    elif isinstance(value, dict):
        face = Face(value.get("color"), value.get("art"))
    else:
        raise ValueError(f"face must be a colour, dict or Face, got {value!r}")
    if face.color is not None and not HEX.match(face.color):
        raise ValueError(f"face colour {face.color!r} must be #rrggbb")
    return face


def _box(ring: Sequence[Vec2], pad: float) -> tuple[float, float, float, float]:
    return (min(p.x for p in ring) - pad, min(p.y for p in ring) - pad,
            max(p.x for p in ring) + pad, max(p.y for p in ring) + pad)


def _boxes_meet(a: tuple[float, float, float, float], b: tuple[float, float, float, float]
                ) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def _on_segment(p: Vec2, a: Vec2, b: Vec2) -> bool:
    from .geometry import dist_point_segment

    return dist_point_segment(p, a, b) <= EPS


# ── arrangement cache: identical sheets share one subdivision ────────────────

_ARR_CACHE: dict[tuple, Arrangement] = {}
ARR_CACHE_SIZE = 64


def cached_arrangement(outline: list[Vec2], holes: list[list[Vec2]],
                       segs: list[SegmentInput]) -> Arrangement:
    """`build_arrangement`, memoised on the exact input geometry and attributes (the result is
    a pure function of them, so sharing it never changes a document's bytes). Bounded FIFO."""
    key = (tuple((p.x, p.y) for p in outline),
           tuple(tuple((p.x, p.y) for p in h) for h in holes),
           tuple((s.a.x, s.a.y, s.b.x, s.b.y, s.assignment, s.fold_angle, s.treatment, s.tag)
                 for s in segs))
    hit = _ARR_CACHE.get(key)
    if hit is None:
        hit = build_arrangement(outline, holes, segs)
        if len(_ARR_CACHE) >= ARR_CACHE_SIZE:
            del _ARR_CACHE[next(iter(_ARR_CACHE))]
        _ARR_CACHE[key] = hit
    return hit
