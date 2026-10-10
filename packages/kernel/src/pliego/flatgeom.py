"""Plane geometry for layer-ordered flat states (`pliego.flatgeom`): isometries of the folded
frame, convex-polygon helpers and sheet-frame segment sets. Re-exported by `pliego.flatstate`."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

TOL = 1e-6           # mm: points closer than this are one vertex; side tests use it
LINE_TOL = 1e-5      # mm: an edge lies on a line when both end images are this close to it

Pt = tuple[float, float]
Affine = tuple[float, float, float, float, float, float]  # x' = a x + b y + tx, y' = c x + d y + ty
IDENTITY: Affine = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


class FlatStateError(ValueError):
    """An operation or a state that is not a valid flat folding (fail loud)."""


# ── plane isometries ─────────────────────────────────────────────────────────

def xf_apply(m: Affine, p: Sequence[float]) -> Pt:
    return (m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5])


def xf_compose(m: Affine, n: Affine) -> Affine:
    """m ∘ n."""
    return (m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[0] * n[4] + m[1] * n[5] + m[4], m[2] * n[4] + m[3] * n[5] + m[5])


def xf_invert(m: Affine) -> Affine:
    det = m[0] * m[3] - m[1] * m[2]
    a, b, c, d = m[3] / det, -m[1] / det, -m[2] / det, m[0] / det
    return (a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5]))


def xf_det(m: Affine) -> float:
    return m[0] * m[3] - m[1] * m[2]


def reflect_xf(p: Sequence[float], d: Sequence[float]) -> Affine:
    """Reflection across the line through p with unit direction d."""
    c2, s2 = d[0] * d[0] - d[1] * d[1], 2.0 * d[0] * d[1]
    return (c2, s2, s2, -c2, p[0] - (c2 * p[0] + s2 * p[1]), p[1] - (s2 * p[0] - c2 * p[1]))


def mirror_x(cx: float) -> Affine:
    """Mirror of the folded frame across the vertical line x = cx (turning the model over)."""
    return (-1.0, 0.0, 0.0, 1.0, 2.0 * cx, 0.0)


# ── small planar helpers ─────────────────────────────────────────────────────

def area(poly: Sequence[Pt]) -> float:
    n = len(poly)
    return 0.5 * math.fsum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1]
                           for i in range(n))


def centroid(poly: Sequence[Pt]) -> Pt:
    a = area(poly)
    if abs(a) < 1e-12:
        n = len(poly)
        return (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)
    cx = cy = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        w = x0 * y1 - x1 * y0
        cx += (x0 + x1) * w
        cy += (y0 + y1) * w
    return (cx / (6.0 * a), cy / (6.0 * a))


def inside_convex(q: Sequence[float], poly: Sequence[Pt], tol: float = TOL) -> bool:
    """Strictly inside a CCW convex polygon, by at least `tol` (negative tol: closed, padded)."""
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        if ln < 1e-12:
            continue
        if (dx * (q[1] - a[1]) - dy * (q[0] - a[0])) / ln < tol:
            return False
    return True


def bbox(poly: Iterable[Pt]) -> tuple[float, float, float, float]:
    xs, ys = zip(*poly, strict=True)
    return (min(xs), min(ys), max(xs), max(ys))


def overlap(p: Sequence[Pt], q: Sequence[Pt], tol: float = TOL) -> bool:
    """Positive-area overlap of two convex polygons (separating-axis test with a margin)."""
    for poly in (p, q):
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            nx, ny = a[1] - b[1], b[0] - a[0]
            ln = math.hypot(nx, ny)
            if ln < 1e-12:
                continue
            nx, ny = nx / ln, ny / ln
            pa = [nx * x + ny * y for x, y in p]
            pb = [nx * x + ny * y for x, y in q]
            if max(pa) <= min(pb) + tol or max(pb) <= min(pa) + tol:
                return False
    return True


def side(p: Sequence[float], d: Sequence[float], q: Sequence[float]) -> float:
    """Signed distance of q from the directed line (p, d); > 0 on the left."""
    return d[0] * (q[1] - p[1]) - d[1] * (q[0] - p[0])


def as_line(line) -> tuple[Pt, Pt]:
    """(point, unit direction) of a line given as two points (or a pliego `Line`)."""
    if hasattr(line, "p0") and hasattr(line, "p1"):
        a, b = (line.p0.x, line.p0.y), (line.p1.x, line.p1.y)
    else:
        a, b = (float(line[0][0]), float(line[0][1])), (float(line[1][0]), float(line[1][1]))
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-9:
        raise FlatStateError("a fold line needs two distinct points")
    return a, (dx / ln, dy / ln)


def pt(p) -> Pt:
    if hasattr(p, "x"):
        return (float(p.x), float(p.y))
    return (float(p[0]), float(p[1]))


def on_segments(a: Pt, b: Pt, segs: Sequence[tuple[Pt, Pt]], tol: float = 10 * TOL) -> bool:
    """Does the segment a–b lie on one of `segs` (both end points on it, within `tol`)?"""
    for p, q in segs:
        dx, dy = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(dx, dy)
        if ln < 1e-12:
            continue
        ok = True
        for r in (a, b):
            t = ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / ln
            if abs(dx * (r[1] - p[1]) - dy * (r[0] - p[0])) / ln > tol or not \
                    -tol <= t <= ln + tol:
                ok = False
                break
        if ok:
            return True
    return False


def merge_segments(segs: Iterable[tuple[Pt, Pt]]) -> list[tuple[Pt, Pt]]:
    """Collinear overlapping or touching segments merged, in a deterministic order."""
    lines: dict[tuple[int, int], list[tuple[float, float, Pt, Pt]]] = {}
    for a, b in segs:
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        if ln < TOL:
            continue
        ux, uy = dx / ln, dy / ln
        if ux < -1e-9 or (abs(ux) <= 1e-9 and uy < 0):
            ux, uy = -ux, -uy
        key = (round(math.atan2(uy, ux) * 1e6), round((ux * a[1] - uy * a[0]) * 1e4))
        ta, tb = ux * a[0] + uy * a[1], ux * b[0] + uy * b[1]
        lines.setdefault(key, []).append((min(ta, tb), max(ta, tb),
                                          a if ta <= tb else b, b if ta <= tb else a))
    out: list[tuple[Pt, Pt]] = []
    for key in sorted(lines):
        segs_ = sorted(lines[key])
        lo, hi, pa, pb = segs_[0]
        for sg in segs_[1:]:
            if sg[0] <= hi + 10 * TOL:
                if sg[1] > hi:
                    hi, pb = sg[1], sg[3]
            else:
                out.append((pa, pb))
                lo, hi, pa, pb = sg
        out.append((pa, pb))
    return out
