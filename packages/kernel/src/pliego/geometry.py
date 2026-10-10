# Adapted from Fashion Cabinet fc/geometry.py (madfam-org/fashion-cabinet, AGPL-3.0, same owner).
"""2-D sheet primitives for the Pliego kernel.

Units are millimetres throughout. Angles are degrees. The coordinate system is y-up (sheet-local
frame of the sheet-document spec §1); exporters flip as their format requires.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

# Geometric tolerance for chain continuity, vertex merging and point-on-segment, in mm.
EPS = 1e-4
# Emit grid (spec §1 determinism): coordinates are rounded to 1e-6 mm, angles to 1e-6 degrees.
EMIT_DIGITS = 6


@dataclass(frozen=True)
class Vec2:
    """An immutable 2-D point / vector in mm."""

    x: float
    y: float

    def __add__(self, other: Vec2) -> Vec2:
        return Vec2(self.x + other.x, self.y + other.y)

    def __sub__(self, other: Vec2) -> Vec2:
        return Vec2(self.x - other.x, self.y - other.y)

    def __mul__(self, k: float) -> Vec2:
        return Vec2(self.x * k, self.y * k)

    __rmul__ = __mul__

    def __neg__(self) -> Vec2:
        return Vec2(-self.x, -self.y)

    def __iter__(self):
        yield self.x
        yield self.y

    def dot(self, other: Vec2) -> float:
        return self.x * other.x + self.y * other.y

    def cross(self, other: Vec2) -> float:
        return self.x * other.y - self.y * other.x

    def length(self) -> float:
        return math.hypot(self.x, self.y)

    def distance(self, other: Vec2) -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def normalized(self) -> Vec2:
        n = self.length()
        if n < EPS * EPS:
            raise ValueError("cannot normalize a near-zero vector")
        return Vec2(self.x / n, self.y / n)

    def perp(self) -> Vec2:
        """Rotate +90° (counter-clockwise)."""
        return Vec2(-self.y, self.x)

    def lerp(self, other: Vec2, t: float) -> Vec2:
        return Vec2(self.x + (other.x - self.x) * t, self.y + (other.y - self.y) * t)

    def rotated(self, angle_deg: float, about: Vec2 | None = None) -> Vec2:
        o = about or Vec2(0.0, 0.0)
        a = math.radians(angle_deg)
        dx, dy = self.x - o.x, self.y - o.y
        c, s = math.cos(a), math.sin(a)
        return Vec2(o.x + dx * c - dy * s, o.y + dx * s + dy * c)

    def mirrored_x(self, axis_x: float = 0.0) -> Vec2:
        """Mirror across the vertical line x = axis_x."""
        return Vec2(2.0 * axis_x - self.x, self.y)

    def mirrored_y(self, axis_y: float = 0.0) -> Vec2:
        """Mirror across the horizontal line y = axis_y."""
        return Vec2(self.x, 2.0 * axis_y - self.y)

    def reflected(self, a: Vec2, b: Vec2) -> Vec2:
        """Mirror across the infinite line through a and b."""
        d = b - a
        dd = d.dot(d)
        if dd < EPS * EPS:
            raise ValueError("reflection line is degenerate")
        t = (self - a).dot(d) / dd
        foot = a + d * t
        return foot * 2.0 - self

    def as_list(self) -> list[float]:
        return [self.x, self.y]


PointLike = Vec2 | Sequence[float]


def P(x: float, y: float) -> Vec2:
    """Shorthand point constructor for cartridge scripts."""
    return Vec2(float(x), float(y))


def as_vec(p: PointLike) -> Vec2:
    """Coerce a tuple/list/Vec2 into a Vec2 (fail loud on anything else)."""
    if isinstance(p, Vec2):
        return p
    try:
        x, y = p  # type: ignore[misc]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"expected a 2-D point, got {p!r}") from exc
    x, y = float(x), float(y)
    if not (math.isfinite(x) and math.isfinite(y)):
        raise ValueError(f"point {p!r} is not finite")
    return Vec2(x, y)


def as_vecs(points: Iterable[PointLike]) -> list[Vec2]:
    return [as_vec(p) for p in points]


def emit(value: float, digits: int = EMIT_DIGITS) -> float | int:
    """Round a number to the emit grid; integral values become ints and -0 becomes 0."""
    r = round(float(value), digits)
    if r == 0:
        return 0
    if r == int(r) and abs(r) < 1e15:
        return int(r)
    return r


def dist_point_segment(p: Vec2, a: Vec2, b: Vec2) -> float:
    ab = b - a
    denom = ab.dot(ab)
    if denom < EPS * EPS:
        return p.distance(a)
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return p.distance(a.lerp(b, t))


class Line:
    """Straight segment."""

    def __init__(self, p0: PointLike, p1: PointLike):
        self.p0 = as_vec(p0)
        self.p1 = as_vec(p1)

    def length(self, tol: float = 0.1) -> float:
        return self.p0.distance(self.p1)

    def point_at(self, t: float) -> Vec2:
        return self.p0.lerp(self.p1, t)

    def direction(self) -> Vec2:
        return (self.p1 - self.p0).normalized()

    def flatten(self, tol: float = 0.1) -> list[Vec2]:
        return [self.p0, self.p1]

    def reversed(self) -> Line:
        return Line(self.p1, self.p0)

    def translated(self, d: Vec2) -> Line:
        return Line(self.p0 + d, self.p1 + d)

    def side(self, p: PointLike) -> float:
        """Signed area: > 0 when p is left of p0→p1."""
        q = as_vec(p)
        return (self.p1 - self.p0).cross(q - self.p0)

    def reflect(self, p: PointLike) -> Vec2:
        return as_vec(p).reflected(self.p0, self.p1)

    def __repr__(self) -> str:
        return f"Line(({self.p0.x:.4f}, {self.p0.y:.4f}), ({self.p1.x:.4f}, {self.p1.y:.4f}))"


class Bezier:
    """Cubic Bézier segment."""

    def __init__(self, p0: PointLike, c0: PointLike, c1: PointLike, p1: PointLike):
        self.p0, self.c0, self.c1, self.p1 = as_vec(p0), as_vec(c0), as_vec(c1), as_vec(p1)

    def point_at(self, t: float) -> Vec2:
        a = self.p0.lerp(self.c0, t)
        b = self.c0.lerp(self.c1, t)
        c = self.c1.lerp(self.p1, t)
        d = a.lerp(b, t)
        e = b.lerp(c, t)
        return d.lerp(e, t)

    def _split(self) -> tuple[Bezier, Bezier]:
        a = self.p0.lerp(self.c0, 0.5)
        b = self.c0.lerp(self.c1, 0.5)
        c = self.c1.lerp(self.p1, 0.5)
        d = a.lerp(b, 0.5)
        e = b.lerp(c, 0.5)
        m = d.lerp(e, 0.5)
        return Bezier(self.p0, a, d, m), Bezier(m, e, c, self.p1)

    def flatten(self, tol: float = 0.1, _depth: int = 0) -> list[Vec2]:
        flat = max(
            dist_point_segment(self.c0, self.p0, self.p1),
            dist_point_segment(self.c1, self.p0, self.p1),
        )
        if flat <= tol or _depth >= 16:
            return [self.p0, self.p1]
        left, right = self._split()
        pts = left.flatten(tol, _depth + 1)
        return pts[:-1] + right.flatten(tol, _depth + 1)

    def length(self, tol: float = 0.1) -> float:
        return polyline_length(self.flatten(tol))

    def reversed(self) -> Bezier:
        return Bezier(self.p1, self.c1, self.c0, self.p0)

    def translated(self, d: Vec2) -> Bezier:
        return Bezier(self.p0 + d, self.c0 + d, self.c1 + d, self.p1 + d)


class Arc:
    """Circular arc: centre, radius, start and sweep in degrees (positive = counter-clockwise)."""

    def __init__(self, center: PointLike, radius: float, start_deg: float, sweep_deg: float):
        if radius <= 0:
            raise ValueError(f"arc radius must be positive, got {radius}")
        self.center = as_vec(center)
        self.radius = float(radius)
        self.start_deg = float(start_deg)
        self.sweep_deg = float(sweep_deg)

    def point_at(self, t: float) -> Vec2:
        a = math.radians(self.start_deg + self.sweep_deg * t)
        return Vec2(self.center.x + self.radius * math.cos(a),
                    self.center.y + self.radius * math.sin(a))

    @property
    def p0(self) -> Vec2:
        return self.point_at(0.0)

    @property
    def p1(self) -> Vec2:
        return self.point_at(1.0)

    def segments_for(self, tol: float) -> int:
        """Chord count so the sagitta stays ≤ tol (deterministic, at least 1)."""
        sweep = abs(math.radians(self.sweep_deg))
        if tol >= self.radius:
            return max(1, math.ceil(sweep / (math.pi / 2)))
        step = 2.0 * math.acos(1.0 - tol / self.radius)
        return max(1, math.ceil(sweep / step - 1e-9))

    def flatten(self, tol: float = 0.1) -> list[Vec2]:
        n = self.segments_for(tol)
        return [self.point_at(i / n) for i in range(n + 1)]

    def length(self, tol: float = 0.1) -> float:
        return abs(math.radians(self.sweep_deg)) * self.radius

    def reversed(self) -> Arc:
        return Arc(self.center, self.radius, self.start_deg + self.sweep_deg, -self.sweep_deg)


Segment = Line | Bezier | Arc


def curve_through(p0: PointLike, p1: PointLike, bulge: float = 0.25, side: float = 1.0) -> Bezier:
    """A gentle symmetric curve between two points (`side` +1 bows left of p0→p1)."""
    a, b = as_vec(p0), as_vec(p1)
    chord = b - a
    n = chord.perp().normalized() * (chord.length() * bulge * side)
    return Bezier(a, a.lerp(b, 1.0 / 3.0) + n, a.lerp(b, 2.0 / 3.0) + n, b)


def flatten_path(items: Iterable[PointLike | Segment], tol: float = 0.1) -> list[Vec2]:
    """Flatten a mixed list of points and segments into a polyline (consecutive dupes removed)."""
    out: list[Vec2] = []
    for item in items:
        pts = item.flatten(tol) if isinstance(item, Line | Bezier | Arc) else [as_vec(item)]
        for p in pts:
            if not out or out[-1].distance(p) > EPS:
                out.append(p)
    return out


# ── shapes ───────────────────────────────────────────────────────────────────


def square(size: float, origin: PointLike = (0.0, 0.0)) -> list[Vec2]:
    """CCW square with its lower-left corner at `origin`."""
    return rectangle(size, size, origin)


def rectangle(width: float, height: float, origin: PointLike = (0.0, 0.0)) -> list[Vec2]:
    """CCW rectangle with its lower-left corner at `origin`."""
    if width <= 0 or height <= 0:
        raise ValueError(f"rectangle needs positive size, got {width} x {height}")
    o = as_vec(origin)
    return [o, Vec2(o.x + width, o.y), Vec2(o.x + width, o.y + height), Vec2(o.x, o.y + height)]


def regular_polygon(n: int, radius: float, center: PointLike = (0.0, 0.0),
                    start_deg: float = 90.0) -> list[Vec2]:
    """CCW regular n-gon inscribed in a circle of `radius`."""
    if n < 3:
        raise ValueError("a polygon needs at least 3 sides")
    c = as_vec(center)
    return [Vec2(c.x + radius * math.cos(math.radians(start_deg + 360.0 * i / n)),
                 c.y + radius * math.sin(math.radians(start_deg + 360.0 * i / n)))
            for i in range(n)]


def circle(center: PointLike, radius: float, segments: int = 48) -> list[Vec2]:
    """CCW polygonal circle with `segments` vertices (first vertex at angle 0)."""
    return regular_polygon(segments, radius, center, start_deg=0.0)


# ── polygons ─────────────────────────────────────────────────────────────────


def polyline_length(pts: Sequence[Vec2]) -> float:
    return math.fsum(pts[i].distance(pts[i + 1]) for i in range(len(pts) - 1))


def polygon_area(pts: Sequence[Vec2]) -> float:
    """Signed area (shoelace, math.fsum). Positive for counter-clockwise open rings."""
    n = len(pts)
    return math.fsum(pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y
                     for i in range(n)) / 2.0


def polygon_centroid(pts: Sequence[Vec2]) -> Vec2:
    a = polygon_area(pts)
    n = len(pts)
    if abs(a) < EPS * EPS:
        return Vec2(math.fsum(p.x for p in pts) / n, math.fsum(p.y for p in pts) / n)
    cx = math.fsum((pts[i].x + pts[(i + 1) % n].x)
                   * (pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y)
                   for i in range(n))
    cy = math.fsum((pts[i].y + pts[(i + 1) % n].y)
                   * (pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y)
                   for i in range(n))
    return Vec2(cx / (6.0 * a), cy / (6.0 * a))


def ensure_ccw(pts: Sequence[Vec2]) -> list[Vec2]:
    return list(pts) if polygon_area(pts) >= 0 else list(reversed(pts))


def bbox(pts: Iterable[Vec2]) -> tuple[Vec2, Vec2]:
    pl = list(pts)
    if not pl:
        raise ValueError("bbox of an empty point set")
    return (Vec2(min(p.x for p in pl), min(p.y for p in pl)),
            Vec2(max(p.x for p in pl), max(p.y for p in pl)))


def point_in_polygon(p: Vec2, ring: Sequence[Vec2], eps: float = EPS) -> int:
    """+1 strictly inside, 0 on the boundary (within eps), −1 outside. Works for either winding.

    One pass over plain floats; the boundary distance (same formula as `dist_point_segment`) is
    only evaluated for edges whose eps-padded bounding box contains the point."""
    px, py = p.x, p.y
    n = len(ring)
    inside = False
    on_edge = False
    eps2 = EPS * EPS
    b = ring[n - 1]
    bx, by = b.x, b.y
    for i in range(n):
        a = ring[i]
        ax, ay = a.x, a.y
        # edge (b → a) is ring[i−1] → ring[i]; the crossing parity is direction-independent
        if not on_edge and (min(ax, bx) - eps <= px <= max(ax, bx) + eps
                            and min(ay, by) - eps <= py <= max(ay, by) + eps):
            dx, dy = ax - bx, ay - by
            denom = dx * dx + dy * dy
            if denom < eps2:
                d = math.hypot(px - bx, py - by)
            else:
                t = max(0.0, min(1.0, ((px - bx) * dx + (py - by) * dy) / denom))
                d = math.hypot(px - (bx + dx * t), py - (by + dy * t))
            if d <= eps:
                on_edge = True
        if (ay > py) != (by > py):
            x = ax + (py - ay) * (bx - ax) / (by - ay)
            if x > px:
                inside = not inside
        bx, by = ax, ay
    if on_edge:
        return 0
    return 1 if inside else -1


def is_simple_polygon(ring: Sequence[Vec2], eps: float = EPS) -> bool:
    """No repeated vertices (within eps) and no two non-adjacent edges touching.

    Sweep over x: only vertex / edge pairs whose eps-padded x ranges overlap are compared, with
    the same predicates as the all-pairs definition (identical result, ~n log n on sheets)."""
    n = len(ring)
    if n < 3:
        return False
    xs = sorted(range(n), key=lambda k: ring[k].x)
    for oi, i in enumerate(xs):
        pi = ring[i]
        for j in xs[oi + 1:]:
            pj = ring[j]
            if pj.x - pi.x > eps:
                break
            if pi.distance(pj) <= eps:
                return False
    boxes = []
    for i in range(n):
        a0, a1 = ring[i], ring[(i + 1) % n]
        boxes.append((min(a0.x, a1.x) - eps, max(a0.x, a1.x) + eps,
                      min(a0.y, a1.y) - eps, max(a0.y, a1.y) + eps))
    order = sorted(range(n), key=lambda k: boxes[k][0])
    for oi, i in enumerate(order):
        _, hx_i, ly_i, hy_i = boxes[i]
        a0, a1 = ring[i], ring[(i + 1) % n]
        for j in order[oi + 1:]:
            lx_j, _, ly_j, hy_j = boxes[j]
            if lx_j > hx_i:
                break
            if ly_j > hy_i or ly_i > hy_j:
                continue
            if (j + 1) % n == i or (i + 1) % n == j:
                continue
            if segments_touch(a0, a1, ring[j], ring[(j + 1) % n], eps):
                return False
    return True


def segment_intersection(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2,
                         eps: float = EPS) -> Vec2 | None:
    """Proper or touching intersection point of two segments (None if disjoint or collinear)."""
    r, s = a1 - a0, b1 - b0
    denom = r.cross(s)
    if abs(denom) < 1e-12 * max(1.0, r.length() * s.length()):
        return None
    t = (b0 - a0).cross(s) / denom
    u = (b0 - a0).cross(r) / denom
    lr, ls = max(r.length(), EPS), max(s.length(), EPS)
    if -eps / lr <= t <= 1 + eps / lr and -eps / ls <= u <= 1 + eps / ls:
        return a0 + r * t
    return None


def segments_touch(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, eps: float = EPS) -> bool:
    """True when the two closed segments come within eps of each other."""
    if segment_intersection(a0, a1, b0, b1, eps) is not None:
        return True
    return min(dist_point_segment(a0, b0, b1), dist_point_segment(a1, b0, b1),
               dist_point_segment(b0, a0, a1), dist_point_segment(b1, a0, a1)) <= eps


def simplify(pts: Sequence[Vec2], tol: float) -> list[Vec2]:
    """Ramer–Douglas–Peucker polyline simplification (endpoints kept, deterministic)."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            d = dist_point_segment(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if idx >= 0 and best > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(pts, keep, strict=True) if k]


def _line_intersection(p: Vec2, d1: Vec2, q: Vec2, d2: Vec2) -> Vec2 | None:
    """Intersection of infinite lines p+t*d1 and q+s*d2; None if near-parallel."""
    denom = d1.cross(d2)
    if abs(denom) < 1e-9:
        return None
    t = (q - p).cross(d2) / denom
    return p + d1 * t


def offset_ring(pts: Sequence[Vec2], dists: Sequence[float],
                miter_limit: float = 4.0) -> list[Vec2]:
    """Offset a CCW closed ring outward with a per-SEGMENT distance (glue tabs, bleed, kerf).

    Segment i runs pts[i] → pts[(i+1) % n] and moves dists[i] along its outward normal
    ((dy, −dx) for CCW rings). Vertices are mitered; near-parallel or over-long miters fall back
    to the averaged-normal offset. A distance of 0 (fold edges) is legal.
    """
    n = len(pts)
    if len(dists) != n:
        raise ValueError("offset_ring: need one distance per segment")
    dirs: list[Vec2] = []
    normals: list[Vec2] = []
    for i in range(n):
        d = pts[(i + 1) % n] - pts[i]
        if d.length() < EPS:
            d = dirs[-1] if dirs else Vec2(1.0, 0.0)
        d = d.normalized()
        dirs.append(d)
        normals.append(Vec2(d.y, -d.x))
    out: list[Vec2] = []
    for i in range(n):
        prev = (i - 1) % n
        a = pts[prev] + normals[prev] * dists[prev]
        b = pts[i] + normals[i] * dists[i]
        hit = _line_intersection(a, dirs[prev], b, dirs[i])
        max_d = max(dists[prev], dists[i])
        if hit is not None and (hit - pts[i]).length() <= max(max_d * miter_limit, max_d + 1.0):
            out.append(hit)
            continue
        avg = normals[prev] + normals[i]
        if avg.length() < EPS:
            avg = normals[i]
        out.append(pts[i] + avg.normalized() * ((dists[prev] + dists[i]) / 2.0))
    return out
