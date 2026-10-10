# Adapted from Fashion Cabinet fc/piece.py (madfam-org/fashion-cabinet, AGPL-3.0, same owner).
"""`Sheet` — the authoring API for one flat sheet (outline, holes, lines, tabs, art).

Coordinates are sheet-local mm, y-up; the outline is normalised to counter-clockwise and holes to
clockwise. Every authoring call returns a `Mark` handle that fold programs (`Sequence` targets)
reference; `build()` runs the planar subdivision and maps each mark to its edges.

Fold angles follow FOLD: positive = valley, negative = mountain (spec §1). `angle` arguments are
magnitudes; the sign comes from `kind`.
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
ALLOWED = {  # spec §4: treatment → allowed assignments
    "crease": {"M", "V", "F"},
    "score": {"M", "V", "F"},
    "perforation": {"M", "V", "F", "C"},
    "cut": {"C"},
    "halfcut": {"F"},
}
FLATTEN_TOL = 0.05  # mm, chord tolerance when flattening curves
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

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


@dataclass
class Face:
    color: str = "#f4efe6"
    art: str | None = None

    def to_dict(self) -> dict:
        return {"color": self.color, "art": self.art}


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
             label: str | dict | None) -> Mark:
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
        mark = Mark(self, len(self.marks), assignment, fa, treatment, pts,
                    None if label is None else i18n(label, ""))
        self.marks.append(mark)
        self._touch()
        return mark

    def crease(self, a: PointLike, b: PointLike, kind: str = "valley", angle: float = 180.0,
               treatment: str = "crease", label: str | dict | None = None) -> Mark:
        """A fold line from a to b. `kind` ∈ valley | mountain | flat | unassigned."""
        if kind not in KINDS or kind == "cut":
            raise ValueError(f"unknown crease kind {kind!r}")
        return self._add([a, b], KINDS[kind], angle, treatment, label)

    def valley(self, a: PointLike, b: PointLike, angle: float = 180.0,
               treatment: str = "crease", label: str | dict | None = None) -> Mark:
        return self.crease(a, b, "valley", angle, treatment, label)

    def mountain(self, a: PointLike, b: PointLike, angle: float = 180.0,
                 treatment: str = "crease", label: str | dict | None = None) -> Mark:
        return self.crease(a, b, "mountain", angle, treatment, label)

    def path(self, points: Sequence[PointLike], kind: str = "valley", angle: float = 180.0,
             treatment: str = "crease", label: str | dict | None = None) -> Mark:
        """A polyline of lines with one assignment (curved creases: pass flattened points)."""
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")
        return self._add(points, KINDS[kind], angle, treatment, label)

    def score(self, a: PointLike, b: PointLike, kind: str = "flat", angle: float = 0.0,
              label: str | dict | None = None) -> Mark:
        """A scored line (blade/laser at reduced power); folds if `kind` is valley/mountain."""
        return self.crease(a, b, kind, angle, "score", label)

    def perforate(self, a: PointLike, b: PointLike, kind: str = "flat", angle: float = 0.0,
                  label: str | dict | None = None) -> Mark:
        """A perforated line; `kind="cut"` makes a tear-off perforation (assignment C)."""
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")
        return self._add([a, b], KINDS[kind], angle, "perforation", label)

    def cut(self, polyline: Sequence[PointLike | Line | Bezier | Arc], closed: bool = False,
            label: str | dict | None = None) -> Mark:
        """A through cut / slit (assignment C). A closed cut leaves the island in place."""
        pts = flatten_path(polyline, FLATTEN_TOL)
        if closed:
            pts = pts + [pts[0]]
        return self._add(pts, "C", 0.0, "cut", label)

    def halfcut(self, polyline: Sequence[PointLike], label: str | dict | None = None) -> Mark:
        """A kiss cut (does not change bending; assignment F)."""
        return self._add(flatten_path(polyline, FLATTEN_TOL), "F", 0.0, "halfcut", label)

    def hole(self, polygon: Sequence[PointLike | Line | Bezier | Arc]) -> list[Vec2]:
        """Remove a region (its boundary becomes outline `B`); must lie strictly inside."""
        ring = flatten_path(polygon, FLATTEN_TOL)
        if len(ring) > 3 and ring[0].distance(ring[-1]) <= EPS:
            ring = ring[:-1]
        ring = self._check_ring(ring, "hole")
        for p in ring:
            if point_in_polygon(p, self.outline) != 1:  # type: ignore[arg-type]
                raise ValueError(f"sheet '{self.id}': hole point ({p.x}, {p.y}) not inside")
        for other in self.holes:
            for p in ring:
                if point_in_polygon(p, other) != -1:
                    raise ValueError(f"sheet '{self.id}': holes overlap at ({p.x}, {p.y})")
        cw = list(reversed(ring))
        self.holes.append(cw)
        self._touch()
        return cw

    def tab(self, edge: int | tuple[PointLike, PointLike], width: float = 8.0,
            taper: float = 45.0, kind: str = "valley", angle: float = 90.0,
            treatment: str = "score") -> Tab:
        """Add a glue tab outside an outline edge (index into the current outline, or its two
        end points). The edge becomes a hinge line; `taper` is the side angle in degrees."""
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
        mark = self.crease(a, b, kind, angle, treatment)
        tab = Tab(mark, [a, b, b2, a2][::-1] if polygon_area([a, b, b2, a2]) < 0
                  else [a, b, b2, a2])
        self.tabs.append(tab)
        self._touch()
        return tab

    def art(self, front: str | None = None, back: str | None = None) -> Sheet:
        """Attach printed art (relative image paths covering the local bounding box)."""
        if front is not None:
            self.front = Face(self.front.color, front)  # type: ignore[union-attr]
        if back is not None:
            self.back = Face(self.back.color, back)  # type: ignore[union-attr]
        return self

    # ── build ───────────────────────────────────────────────────────────────

    def build(self) -> Arrangement:
        """Planar subdivision of this sheet (cached until the next authoring call)."""
        if self._built is None:
            segs = [SegmentInput(p, q, m.assignment, m.fold_angle, m.treatment, m.index)
                    for m in self.marks for p, q in zip(m.points, m.points[1:], strict=False)]
            self._built = build_arrangement(list(self.outline), list(self.holes), segs)  # type: ignore[arg-type]
        return self._built

    def region_contains(self, p: PointLike) -> bool:
        """True when a sheet-local point lies on the sheet material (outline minus holes)."""
        q = as_vec(p)
        if not self._inside(q):
            return False
        return all(point_in_polygon(q, h) != 1 for h in self.holes)


def _face(value: Face | dict | str | None) -> Face:
    if value is None:
        return Face()
    if isinstance(value, Face):
        face = value
    elif isinstance(value, str):
        face = Face(value)
    elif isinstance(value, dict):
        face = Face(value.get("color", "#f4efe6"), value.get("art"))
    else:
        raise ValueError(f"face must be a colour, dict or Face, got {value!r}")
    if not HEX.match(face.color):
        raise ValueError(f"face colour {face.color!r} must be #rrggbb")
    return face
