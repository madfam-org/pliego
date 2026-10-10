"""Huzita–Justin single-fold axioms O1–O7 as constructions returning fold lines (`Line`).

Each function returns a list of solutions (possibly empty), in a deterministic order. Lines are
infinite in meaning; the returned `Line` carries two points on it (unit-ish spacing where the
construction has no natural pair). Authoring helpers: "fold this point to that line through that
point" without hand trigonometry.
"""

from __future__ import annotations

import math

from .geometry import EPS, Line, PointLike, Vec2, as_vec

LineLike = Line | tuple[PointLike, PointLike]


def _line(ln: LineLike) -> Line:
    return ln if isinstance(ln, Line) else Line(ln[0], ln[1])


def _from_normal(n: Vec2, c: float) -> Line:
    """Line {x : n·x = c} for a unit normal n."""
    p = n * c
    d = n.perp()
    return Line(p, p + d)


def o1(p1: PointLike, p2: PointLike) -> list[Line]:
    """O1: the fold line through two points."""
    a, b = as_vec(p1), as_vec(p2)
    if a.distance(b) <= EPS:
        return []
    return [Line(a, b)]


def o2(p1: PointLike, p2: PointLike) -> list[Line]:
    """O2: fold p1 onto p2 (the perpendicular bisector)."""
    a, b = as_vec(p1), as_vec(p2)
    if a.distance(b) <= EPS:
        return []
    m = a.lerp(b, 0.5)
    return [Line(m, m + (b - a).perp())]


def o3(l1: LineLike, l2: LineLike) -> list[Line]:
    """O3: fold line l1 onto line l2 (both angle bisectors, or the mid-parallel)."""
    a, b = _line(l1), _line(l2)
    d1, d2 = a.direction(), b.direction()
    if abs(d1.cross(d2)) < 1e-12:
        n = d1.perp()
        c1, c2 = n.dot(a.p0), n.dot(b.p0)
        if abs(c1 - c2) <= EPS:
            return []
        return [_from_normal(n, (c1 + c2) / 2.0)]
    # intersection point
    t = (b.p0 - a.p0).cross(d2) / d1.cross(d2)
    x = a.p0 + d1 * t
    out = []
    for d in ((d1 + d2), (d1 - d2)):
        if d.length() > 1e-12:
            out.append(Line(x, x + d.normalized()))
    return out


def o4(p: PointLike, line: LineLike) -> list[Line]:
    """O4: the fold through p perpendicular to l."""
    q = as_vec(p)
    d = _line(line).direction()
    return [Line(q, q + d.perp())]


def o5(p1: PointLike, line: LineLike, p2: PointLike) -> list[Line]:
    """O5: fold p1 onto l with the fold passing through p2 (0, 1 or 2 solutions)."""
    a, c = as_vec(p1), as_vec(p2)
    ln = _line(line)
    d = ln.direction()
    r = a.distance(c)
    # circle(c, r) ∩ line
    foot = ln.p0 + d * (c - ln.p0).dot(d)
    h2 = r * r - c.distance(foot) ** 2
    if h2 < -EPS * EPS or r <= EPS:
        return []
    h = math.sqrt(max(h2, 0.0))
    pts = [foot - d * h, foot + d * h] if h > EPS else [foot]
    out = []
    for q in pts:
        if q.distance(a) <= EPS:
            continue  # p1 already on l through p2: the fold would be degenerate
        out.extend(o2(a, q))
    return out


def _reflect_condition(n: Vec2, p: Vec2, line: Line) -> float | None:
    """c such that reflecting p across {n·x = c} lands on l, or None if parallel."""
    m = line.direction().perp()
    mn = m.dot(n)
    if abs(mn) < 1e-12:
        return None
    return (2.0 * n.dot(p) * mn - m.dot(p) + m.dot(line.p0)) / (2.0 * mn)


def o6(p1: PointLike, l1: LineLike, p2: PointLike, l2: LineLike, samples: int = 7200
       ) -> list[Line]:
    """O6: fold p1 onto l1 and p2 onto l2 at once (common tangents of two parabolas; ≤ 3).

    Solved by a deterministic scan of the normal angle with bisection refinement.
    """
    a, b = as_vec(p1), as_vec(p2)
    la, lb = _line(l1), _line(l2)
    mb = lb.direction().perp()

    def g(phi: float) -> float | None:
        n = Vec2(math.cos(phi), math.sin(phi))
        c = _reflect_condition(n, a, la)
        if c is None:
            return None
        img = b - n * (2.0 * (n.dot(b) - c))
        return mb.dot(img - lb.p0)

    roots: list[float] = []
    prev_phi, prev = 0.0, g(0.0)
    for i in range(1, samples + 1):
        phi = math.pi * i / samples
        cur = g(phi)
        if prev is not None and cur is not None and abs(prev) < 1e6 and abs(cur) < 1e6:
            if prev == 0.0:
                roots.append(prev_phi)
            elif prev * cur < 0:
                lo, hi, glo = prev_phi, phi, prev
                for _ in range(80):
                    mid = (lo + hi) / 2.0
                    gm = g(mid)
                    if gm is None:
                        break
                    if glo * gm <= 0:
                        hi = mid
                    else:
                        lo, glo = mid, gm
                roots.append((lo + hi) / 2.0)
        prev_phi, prev = phi, cur
    out: list[Line] = []
    for phi in roots:
        n = Vec2(math.cos(phi), math.sin(phi))
        c = _reflect_condition(n, a, la)
        if c is None:
            continue
        cand = _from_normal(n, c)
        img = b.reflected(cand.p0, cand.p1)
        if abs(mb.dot(img - lb.p0)) > 1e-6:
            continue  # pole crossing, not a root
        if not any(abs(cand.direction().cross(o.direction())) < 1e-9
                   and abs(o.side(cand.p0)) < 1e-6 for o in out):
            out.append(cand)
    return out


def o7(p: PointLike, l1: LineLike, l2: LineLike) -> list[Line]:
    """O7: fold p onto l1 with the fold perpendicular to l2."""
    q = as_vec(p)
    n = _line(l2).direction()  # the fold is ⟂ l2, so its normal runs along l2
    c = _reflect_condition(n, q, _line(l1))
    if c is None:
        return []
    return [_from_normal(n, c)]
