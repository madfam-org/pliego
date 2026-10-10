"""2-D helpers for `pliego.unfold`: rigid transforms, triangle overlap, hulls and rectangles.

Rigid transforms are tuples (c, s, tx, ty): p ↦ (c·x − s·y + tx, s·x + c·y + ty) with c² + s² = 1
(rotation then translation; nets are never mirrored, so the printed side stays the outside).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

Pt = tuple[float, float]
Rigid2 = tuple[float, float, float, float]
IDENT2: Rigid2 = (1.0, 0.0, 0.0, 0.0)
INSET_MM = 0.01      # triangles are shrunk by this before the overlap test (touching ≠ overlap)
PINCH_MM = 0.05      # vertices closer than this to another piece's vertex or edge conflict
JOINT_MM = 1e-6      # copies of the hinge's end points (they coincide by construction)


def apply(t: Rigid2, p: Sequence[float]) -> Pt:
    c, s, tx, ty = t
    return (c * p[0] - s * p[1] + tx, s * p[0] + c * p[1] + ty)


def compose(a: Rigid2, b: Rigid2) -> Rigid2:
    """a ∘ b (apply b first)."""
    c1, s1, x1, y1 = a
    c2, s2, x2, y2 = b
    tx, ty = apply(a, (x2, y2))
    return (c1 * c2 - s1 * s2, s1 * c2 + c1 * s2, tx, ty)


def inverse(t: Rigid2) -> Rigid2:
    c, s, tx, ty = t
    return (c, -s, -(c * tx + s * ty), -(-s * tx + c * ty))


def rotation(deg: float) -> Rigid2:
    r = math.radians(deg)
    return (math.cos(r), math.sin(r), 0.0, 0.0)


def edge_map(qa: Pt, qb: Pt, pa: Pt, pb: Pt) -> Rigid2:
    """The rigid map sending segment qa→qb onto pa→pb (equal lengths)."""
    ang = (math.atan2(pb[1] - pa[1], pb[0] - pa[0])
           - math.atan2(qb[1] - qa[1], qb[0] - qa[0]))
    c, s = math.cos(ang), math.sin(ang)
    rx, ry = c * qa[0] - s * qa[1], s * qa[0] + c * qa[1]
    return (c, s, pa[0] - rx, pa[1] - ry)


def bbox(pts: Sequence[Pt]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def boxes_meet(a, b, pad: float = 0.0) -> bool:
    return (a[0] - pad <= b[2] and b[0] - pad <= a[2] and a[1] - pad <= b[3]
            and b[1] - pad <= a[3])


def cross(o: Pt, a: Pt, b: Pt) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def area(poly: Sequence[Pt]) -> float:
    return 0.5 * math.fsum(poly[i][0] * poly[(i + 1) % len(poly)][1]
                           - poly[(i + 1) % len(poly)][0] * poly[i][1]
                           for i in range(len(poly)))


def inset_triangle(t: Sequence[Pt], d: float = INSET_MM) -> tuple[Pt, Pt, Pt] | None:
    """The triangle shrunk by `d` toward its incentre (its exact inward offset); None when
    the triangle is thinner than 2·d."""
    a, b, c = t
    la = math.dist(b, c)
    lb = math.dist(c, a)
    lc = math.dist(a, b)
    per = la + lb + lc
    if per <= 0:
        return None
    ix = (la * a[0] + lb * b[0] + lc * c[0]) / per
    iy = (la * a[1] + lb * b[1] + lc * c[1]) / per
    r = 2.0 * abs(cross(a, b, c)) / 2.0 / per
    if r <= d:
        return None
    k = (r - d) / r
    return tuple((ix + (p[0] - ix) * k, iy + (p[1] - iy) * k) for p in t)  # type: ignore[return-value]


def triangles_overlap(t1: Sequence[Pt], t2: Sequence[Pt]) -> bool:
    """Separating-axis test for two triangles; touching counts as separated."""
    for tri in (t1, t2):
        for i in range(3):
            p, q = tri[i], tri[(i + 1) % 3]
            nx, ny = q[1] - p[1], p[0] - q[0]
            a = [nx * v[0] + ny * v[1] for v in t1]
            b = [nx * v[0] + ny * v[1] for v in t2]
            if max(a) <= min(b) or max(b) <= min(a):
                return False
    return True


def dist_point_segment(p: Pt, a: Pt, b: Pt) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    ll = dx * dx + dy * dy
    if ll <= 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def point_in_polygon(p: Pt, poly: Sequence[Pt], tol: float = 1e-9) -> int:
    """1 inside, 0 on the boundary (within tol), −1 outside."""
    n = len(poly)
    for i in range(n):
        if dist_point_segment(p, poly[i], poly[(i + 1) % n]) <= tol:
            return 0
    inside = False
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x > p[0]:
                inside = not inside
    return 1 if inside else -1


def convex_hull(pts: Sequence[Pt]) -> list[Pt]:
    """Andrew's monotone chain, counter-clockwise, no collinear points."""
    s = sorted(set(pts))
    if len(s) <= 2:
        return list(s)
    lo: list[Pt] = []
    for p in s:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    hi: list[Pt] = []
    for p in reversed(s):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def orientations(hull: Sequence[Pt]) -> list[float]:
    """Candidate rotations (deg, in [0, 90)) that put a hull edge on an axis, plus 0."""
    out = {0.0}
    for i in range(len(hull)):
        p, q = hull[i], hull[(i + 1) % len(hull)]
        a = -math.degrees(math.atan2(q[1] - p[1], q[0] - p[0])) % 90.0
        out.add(round(a, 9) % 90.0)
    return sorted(out)


def rotated_size(hull: Sequence[Pt], deg: float) -> tuple[float, float]:
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    xs = [c * p[0] - s * p[1] for p in hull]
    ys = [s * p[0] + c * p[1] for p in hull]
    return (max(xs) - min(xs), max(ys) - min(ys))


def fits(hull: Sequence[Pt], w: float, h: float, pad: float, foot: float) -> float | None:
    """A rotation (deg) at which the hull, grown by `pad` all round and `foot` below, fits a
    w × h box — the one with the smallest bounding area — or None."""
    best: tuple[float, float] | None = None
    for a in orientations(hull):
        for extra in (0.0, 90.0):
            bw, bh = rotated_size(hull, a + extra)
            if bw + 2 * pad <= w + 1e-9 and bh + 2 * pad + foot <= h + 1e-9:
                key = (bw * bh, a + extra)
                if best is None or key < best:
                    best = key
    return None if best is None else best[1]
