"""Exact rational predicates (``fractions.Fraction`` / Python ints) for the Pliego kernel.

The arrangement works on an integer grid (1 unit = 1e-6 mm, the emit grid of spec §1), so every
orientation and intersection test is exact. The **exact local Kawasaki test** (rsE §a6): with
rational crease directions (a, b) the reflection matrix

    R = 1/(a² + b²) · [[a² − b², 2ab], [2ab, b² − a²]]

is rational, and a vertex is locally flat-foldable (Kawasaki–Justin) iff the product of the
reflections across its creases in cyclic order is the identity — no trigonometry involved.
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction

GRID = 1_000_000  # grid units per mm (1e-6 mm resolution)

IPoint = tuple[int, int]
Rational = Fraction | int
Mat2 = tuple[Fraction, Fraction, Fraction, Fraction]  # row-major [[a, b], [c, d]]


def to_grid(value: float) -> int:
    """Snap a coordinate in mm to the integer grid (round half to even, deterministic)."""
    return int(round(float(value) * GRID))


def grid_point(x: float, y: float) -> IPoint:
    return (to_grid(x), to_grid(y))


def from_grid(p: IPoint) -> tuple[float, float]:
    return (p[0] / GRID, p[1] / GRID)


def orient(a: Sequence[Rational], b: Sequence[Rational], c: Sequence[Rational]) -> int:
    """Sign of the cross product (b − a) × (c − a): +1 left turn, −1 right turn, 0 collinear."""
    v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return (v > 0) - (v < 0)


def on_segment(p: Sequence[Rational], a: Sequence[Rational], b: Sequence[Rational]) -> bool:
    """True when p lies on the closed segment ab (exact)."""
    if orient(a, b, p) != 0:
        return False
    return (min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
            and min(a[1], b[1]) <= p[1] <= max(a[1], b[1]))


def segments_cross(a: IPoint, b: IPoint, c: IPoint, d: IPoint) -> bool:
    """Proper crossing: the open segments intersect in exactly one interior point."""
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return o1 * o2 < 0 and o3 * o4 < 0


def segments_intersect(a: IPoint, b: IPoint, c: IPoint, d: IPoint) -> bool:
    """Closed segments share at least one point (touching and collinear overlap included)."""
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    return (on_segment(c, a, b) or on_segment(d, a, b) or on_segment(a, c, d)
            or on_segment(b, c, d))


def crossing_point(a: IPoint, b: IPoint, c: IPoint, d: IPoint) -> tuple[Fraction, Fraction] | None:
    """Exact intersection of two non-parallel segments' supporting lines, if inside both."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if den == 0:
        return None
    qx, qy = c[0] - a[0], c[1] - a[1]
    t = Fraction(qx * sy - qy * sx, den)
    u = Fraction(qx * ry - qy * rx, den)
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (a[0] + t * rx, a[1] + t * ry)
    return None


def round_point(p: tuple[Fraction, Fraction]) -> IPoint:
    """Round an exact rational point to the integer grid (half to even)."""
    return (round(p[0]), round(p[1]))


def polygon_area2(ring: Sequence[IPoint]) -> int:
    """Twice the signed area of an integer ring (exact; > 0 counter-clockwise)."""
    n = len(ring)
    return sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1]
               for i in range(n))


def angle_cmp(u: IPoint, v: IPoint) -> int:
    """Exact comparison of direction angles in [0, 2π) measured from +x (for sorting)."""
    def half(w: IPoint) -> int:
        return 0 if (w[1] > 0 or (w[1] == 0 and w[0] > 0)) else 1

    hu, hv = half(u), half(v)
    if hu != hv:
        return -1 if hu < hv else 1
    c = u[0] * v[1] - u[1] * v[0]
    return -1 if c > 0 else (1 if c < 0 else 0)


# ── reflections and the exact Kawasaki test ──────────────────────────────────


def reflection(direction: Sequence[Rational]) -> Mat2:
    """Rational reflection matrix across the line through the origin with this direction."""
    a, b = Fraction(direction[0]), Fraction(direction[1])
    n = a * a + b * b
    if n == 0:
        raise ValueError("reflection: zero direction")
    return ((a * a - b * b) / n, 2 * a * b / n, 2 * a * b / n, (b * b - a * a) / n)


def mat_mul(m: Mat2, n: Mat2) -> Mat2:
    return (m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3])


IDENTITY: Mat2 = (Fraction(1), Fraction(0), Fraction(0), Fraction(1))


def reflection_product(directions: Sequence[Sequence[Rational]]) -> Mat2:
    """Product R_k ⋯ R_2 R_1 of the reflections across the given directions (cyclic order)."""
    m = IDENTITY
    for d in directions:
        m = mat_mul(reflection(d), m)
    return m


def sort_ccw(directions: Sequence[IPoint]) -> list[IPoint]:
    """Directions sorted counter-clockwise from +x (exact)."""
    from functools import cmp_to_key

    return sorted(directions, key=cmp_to_key(angle_cmp))


def kawasaki_exact(directions: Sequence[IPoint], *, interior: bool = True) -> bool:
    """Exact Kawasaki–Justin test for one interior vertex.

    `directions` are the crease vectors leaving the vertex (any order; integer or rational).
    An interior vertex is flat-foldable locally iff its degree is even and the product of the
    reflections across its creases, taken in cyclic order, is the identity.
    """
    if not interior:
        raise ValueError("kawasaki_exact applies to interior vertices only")
    if len(directions) % 2 or len(directions) < 2:
        return False
    ordered = sort_ccw([(int(d[0]), int(d[1])) for d in directions]) \
        if all(isinstance(c, int) for d in directions for c in d) else list(directions)
    return reflection_product(ordered) == IDENTITY


def fold_by_reflection(point: Sequence[Rational], directions: Sequence[Sequence[Rational]]
                       ) -> tuple[Fraction, Fraction]:
    """Image of a point (relative to the vertex) after reflecting across each direction in turn."""
    m = reflection_product(directions)
    x, y = Fraction(point[0]), Fraction(point[1])
    return (m[0] * x + m[1] * y, m[2] * x + m[3] * y)
