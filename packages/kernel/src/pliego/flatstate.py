"""Layer-ordered flat-folded states (`pliego.flatstate`).

A `FlatState` is one flat-folded state of a single convex sheet:

- **faces**: convex polygons of the sheet (sheet frame, counter-clockwise, vertex indices into a
  shared point list) — the faces of the crease pattern made so far; every edge two faces share is
  a crease;
- **placement**: per face, the isometry of the plane (``Affine``, det ±1) that puts it into the
  folded frame (x, y, with +z towards the viewer); det −1 means the face shows its back;
- **layer order**: for every pair of faces whose folded images overlap with positive area, which
  one lies above (+z) — FOLD ``faceOrders`` semantics, complete for overlapping pairs.

A crease between two faces is flat (0°) when both have the same orientation and folded (±180°)
otherwise; the sign follows from the layer order (valley = the other face lies on this face's
front side). States are immutable: every operation (`pliego.flatops`) returns a new state, which is
checked by `pliego.flatcheck` (taco-taco, taco-tortilla, tortilla-tortilla, transitivity,
Kawasaki, Maekawa) before it is handed back. `unfold()` returns the crease pattern on the flat
sheet as a `pliego.Sheet`.

Units mm, folded frame y-up like the sheet frame; the world embedding follows the spec:
folded (x, y) ↦ world (x, 0, −y), front normal +Y.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

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


# ── the state ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Face:
    verts: tuple[int, ...]   # indices into the state's points, CCW in the sheet frame
    xf: Affine               # sheet frame → folded frame

    @property
    def flipped(self) -> bool:
        return xf_det(self.xf) < 0


@dataclass(frozen=True)
class Crease:
    """An interior edge: sheet-frame end points a → b (face `f` on its left, `g` on its right),
    and its fold angle in this state: 0 (flat), +180 (valley) or −180 (mountain)."""

    a: int
    b: int
    f: int
    g: int
    angle: float


class FlatState:
    """One flat-folded state (see the module docstring). Build with `FlatState.of(outline)`."""

    def __init__(self, outline: Sequence[Pt], points: Sequence[Pt], faces: Sequence[Face],
                 order: dict[tuple[int, int], int]):
        self.outline = tuple(outline)
        self.points = tuple(points)
        self.faces = tuple(faces)
        self.order = dict(order)       # (i, j), i < j, overlapping: +1 → i above j, −1 → below
        self._img: list[list[Pt] | None] = [None] * len(self.faces)
        self._half: dict[tuple[int, int], int] | None = None

    # ── construction ──
    @classmethod
    def of(cls, outline) -> FlatState:
        """The flat, unfolded sheet: a convex outline (points, a `pliego.Sheet` or its outline)."""
        if hasattr(outline, "outline") and not isinstance(outline, list | tuple):
            outline = outline.outline
        ring = [pt(p) for p in outline]
        if area(ring) < 0:
            ring.reverse()
        n = len(ring)
        if n < 3 or abs(area(ring)) < 1e-6:
            raise FlatStateError("a flat state needs a polygon with area")
        for i in range(n):
            a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
            if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9:
                raise FlatStateError("layer folding needs a convex outline")
        return cls(ring, ring, [Face(tuple(range(n)), IDENTITY)], {})

    # ── per-face geometry ──
    def poly(self, f: int) -> list[Pt]:
        return [self.points[v] for v in self.faces[f].verts]

    def image(self, f: int) -> list[Pt]:
        """The face's folded image, counter-clockwise."""
        im = self._img[f]
        if im is None:
            xf = self.faces[f].xf
            im = [xf_apply(xf, self.points[v]) for v in self.faces[f].verts]
            if xf_det(xf) < 0:
                im.reverse()
            self._img[f] = im
        return im

    def flipped(self, f: int) -> bool:
        return self.faces[f].flipped

    def face_at(self, sheet_point) -> int:
        """The face containing a sheet-frame point (interior, or the nearest on an edge)."""
        q = pt(sheet_point)
        for tol in (TOL, -TOL, -1e-4):
            for f in range(len(self.faces)):
                if inside_convex(q, self.poly(f), tol):
                    return f
        raise FlatStateError(f"sheet point ({q[0]:.4f}, {q[1]:.4f}) is not on the sheet")

    def to_folded(self, sheet_point) -> Pt:
        return xf_apply(self.faces[self.face_at(sheet_point)].xf, pt(sheet_point))

    def above(self, i: int, j: int) -> bool | None:
        """True when face i lies above face j (they overlap), None when they do not overlap."""
        if i == j:
            raise FlatStateError("a face is not above itself")
        s = self.order.get((i, j) if i < j else (j, i))
        if s is None:
            return None
        return (s > 0) == (i < j)

    def vertex_near(self, q, tol: float = 0.05) -> Pt:
        """The exact folded position of the vertex nearest the folded point q (within `tol` mm):
        aim fold lines through it, so they meet existing creases exactly."""
        q = pt(q)
        best, bd = None, tol
        for f in range(len(self.faces)):
            for p in self.image(f):
                dd = math.hypot(p[0] - q[0], p[1] - q[1])
                if dd <= bd:
                    best, bd = p, dd
        if best is None:
            raise FlatStateError(f"no vertex within {tol} mm of ({q[0]:.3f}, {q[1]:.3f})")
        return best

    def faces_at(self, q) -> list[int]:
        """Faces whose image contains the folded point q, bottom → top."""
        q = pt(q)
        hit = [f for f in range(len(self.faces)) if inside_convex(q, self.image(f))]
        return sort_stack(self, hit)

    def bbox(self) -> tuple[float, float, float, float]:
        return bbox([p for f in range(len(self.faces)) for p in self.image(f)])

    # ── creases ──
    def half_edges(self) -> dict[tuple[int, int], int]:
        """(a, b) → face with a → b on its CCW boundary."""
        if self._half is None:
            half: dict[tuple[int, int], int] = {}
            for fi, f in enumerate(self.faces):
                vs = f.verts
                for k in range(len(vs)):
                    half[(vs[k], vs[(k + 1) % len(vs)])] = fi
            self._half = half
        return self._half

    def crease_angle(self, f: int, g: int) -> float:
        """Fold angle of the crease between adjacent faces f and g (seen from f)."""
        if self.faces[f].flipped == self.faces[g].flipped:
            return 0.0
        up = self.above(g, f)
        if up is None:
            raise FlatStateError(f"faces {f} and {g} are folded onto each other but unordered")
        return 180.0 if up == (not self.faces[f].flipped) else -180.0

    def creases(self) -> list[Crease]:
        out: list[Crease] = []
        half = self.half_edges()
        for (a, b), f in half.items():
            g = half.get((b, a))
            if g is None or (a, b) > (b, a):
                continue
            out.append(Crease(a, b, f, g, self.crease_angle(f, g)))
        return out

    def boundary_edges(self) -> list[tuple[int, int, int]]:
        half = self.half_edges()
        return [(a, b, f) for (a, b), f in half.items() if (b, a) not in half]

    def segment_image(self, f: int, a: int, b: int) -> tuple[Pt, Pt]:
        xf = self.faces[f].xf
        return xf_apply(xf, self.points[a]), xf_apply(xf, self.points[b])

    # ── whole-state operations (thin wrappers; see pliego.flatops) ──
    def turn_over(self) -> FlatState:
        """The same folding seen from behind: mirrored across the vertical line through the
        middle of its folded bounding box; every layer order flips. No crease moves."""
        x0, _, x1, _ = self.bbox()
        m = mirror_x((x0 + x1) / 2.0)
        faces = [Face(f.verts, xf_compose(m, f.xf)) for f in self.faces]
        return FlatState(self.outline, self.points, faces, {k: -s for k, s in self.order.items()})

    def rotate(self, deg: float, center=(0.0, 0.0)) -> FlatState:
        """Rotate the folded model in its plane (diagram convenience; no crease moves)."""
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        cx, cy = pt(center)
        m = (c, -s, s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy))
        faces = [Face(f.verts, xf_compose(m, f.xf)) for f in self.faces]
        return FlatState(self.outline, self.points, faces, self.order)

    def fold(self, line, direction: str = "valley", **kw) -> FlatState:
        from .flatops import fold
        return fold(self, line, direction, **kw).state

    def check(self, *, local: bool = True) -> list[dict]:
        from .flatcheck import check
        return check(self, local=local)

    def unfold(self, id: str = "folded", *, folded_only: bool = False, **sheet_kwargs):
        """The crease pattern on the flat sheet: a `pliego.Sheet` with every crease of this
        state, valley/mountain from the state (±180°) and flat (`F`) for creases left open."""
        from .sheet import Sheet

        sheet = Sheet(id, [list(p) for p in self.outline], **sheet_kwargs)
        for seg, ang in self.crease_segments():
            if ang == 0.0:
                if not folded_only:
                    sheet.crease(seg[0], seg[1], "flat", 0.0)
            else:
                sheet.crease(seg[0], seg[1], "valley" if ang > 0 else "mountain", 180.0)
        return sheet

    crease_pattern = unfold

    def crease_segments(self) -> list[tuple[tuple[Pt, Pt], float]]:
        """Maximal straight crease segments with one fold angle, sheet frame, authored order."""
        cr = self.creases()
        lines: dict[tuple[int, int, float], list[tuple[float, float, Pt, Pt]]] = {}
        for c in cr:
            a, b = self.points[c.a], self.points[c.b]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            ux, uy = dx / ln, dy / ln
            if ux < -1e-9 or (abs(ux) <= 1e-9 and uy < 0):
                ux, uy = -ux, -uy
            off = ux * a[1] - uy * a[0]
            key = (round(math.atan2(uy, ux) * 1e6), round(off * 1e4), c.angle)
            ta, tb = ux * a[0] + uy * a[1], ux * b[0] + uy * b[1]
            lines.setdefault(key, []).append((min(ta, tb), max(ta, tb),
                                              a if ta <= tb else b, b if ta <= tb else a))
        out: list[tuple[tuple[Pt, Pt], float]] = []
        for key in sorted(lines):
            segs = sorted(lines[key])
            lo, hi, pa, pb = segs[0]
            for s in segs[1:]:
                if s[0] <= hi + TOL:
                    if s[1] > hi:
                        hi, pb = s[1], s[3]
                else:
                    out.append(((pa, pb), float(key[2])))
                    lo, hi, pa, pb = s
            out.append(((pa, pb), float(key[2])))
        return out

    def summary(self) -> str:
        cr = self.creases()
        folded = sum(1 for c in cr if c.angle != 0.0)
        return (f"flatstate: faces={len(self.faces)} creases={len(cr)} folded={folded} "
                f"ordered_pairs={len(self.order)}")


def sort_stack(state: FlatState, faces: Iterable[int]) -> list[int]:
    """Faces that share a point, bottom → top (fails loud on an incomplete or cyclic order)."""
    fs = list(faces)
    below = {f: 0 for f in fs}
    for i, f in enumerate(fs):
        for g in fs[i + 1:]:
            up = state.above(f, g)
            if up is None:
                raise FlatStateError(f"faces {f} and {g} share a point but are unordered")
            below[f if up else g] += 1
    out = sorted(fs, key=lambda f: below[f])
    if [below[f] for f in out] != list(range(len(out))):
        raise FlatStateError(f"layer order of faces {sorted(fs)} is cyclic")
    return out


class PointPool:
    """Append-only sheet-frame points with snapping (points within TOL merge)."""

    def __init__(self, points: Sequence[Pt]):
        self.points = list(points)
        self._grid: dict[tuple[int, int], list[int]] = {}
        for i, p in enumerate(self.points):
            self._grid.setdefault(self._key(p), []).append(i)

    @staticmethod
    def _key(p: Pt) -> tuple[int, int]:
        return (math.floor(p[0] / (8 * TOL)), math.floor(p[1] / (8 * TOL)))

    def add(self, p: Pt) -> int:
        kx, ky = self._key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in self._grid.get((kx + dx, ky + dy), ()):
                    q = self.points[i]
                    if abs(q[0] - p[0]) <= TOL and abs(q[1] - p[1]) <= TOL:
                        return i
        self.points.append(p)
        self._grid.setdefault((kx, ky), []).append(len(self.points) - 1)
        return len(self.points) - 1


def embed3(xf: Affine):
    """The world rigid motion ((3×3 rows), translation) of a flat face placement: sheet
    (u, 0, −v) ↦ folded (x, 0, −y); a det −1 placement turns the face over (Y ↦ −Y)."""
    a, b, c, d, tx, ty = xf
    s = 1.0 if xf_det(xf) > 0 else -1.0
    return (((a, 0.0, -b), (0.0, s, 0.0), (-c, 0.0, d)), (tx, 0.0, -ty))
