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

from .flatgeom import (  # noqa: F401 - re-exported: the flat modules import them from here
    IDENTITY,
    LINE_TOL,
    TOL,
    Affine,
    FlatStateError,
    Pt,
    area,
    as_line,
    bbox,
    centroid,
    inside_convex,
    merge_segments,
    mirror_x,
    on_segments,
    overlap,
    pt,
    reflect_xf,
    side,
    xf_apply,
    xf_compose,
    xf_det,
    xf_invert,
)

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
                 order: dict[tuple[int, int], int], *, cuts: Sequence[tuple[Pt, Pt]] = (),
                 seams: Sequence[tuple[Pt, Pt]] = (), creased: Sequence[tuple[Pt, Pt]] = (),
                 partial: bool = False):
        self.outline = tuple(outline)
        self.points = tuple(points)
        self.faces = tuple(faces)
        self.order = dict(order)       # (i, j), i < j, overlapping: +1 → i above j, −1 → below
        # sheet-frame segments: slits (the faces either side are not joined there), seams (faces
        # joined flat where a slit's line was extended to keep faces convex — not a crease), and
        # the parts of seams that have been folded since (creases after all)
        self.cuts = tuple(cuts)
        self.seams = tuple(seams)
        self.creased = tuple(creased)
        # a group of faces taken out of a larger folding (`pliego.foldpose`): vertices on its
        # rim meet creases it does not hold, so the local Kawasaki / Maekawa test does not apply
        self.partial = partial
        self._img: list[list[Pt] | None] = [None] * len(self.faces)
        self._half: dict[tuple[int, int], int] | None = None
        self._cut: set[tuple[int, int]] | None = None

    def derive(self, *, points: Sequence[Pt] | None = None, faces: Sequence[Face] | None = None,
               order: dict[tuple[int, int], int] | None = None, **extra) -> FlatState:
        """A state with the same sheet (outline, slits, seams) and the given changes."""
        kw = {"cuts": self.cuts, "seams": self.seams, "creased": self.creased,
              "partial": self.partial, **extra}
        return FlatState(self.outline, self.points if points is None else points,
                         self.faces if faces is None else faces,
                         self.order if order is None else order, **kw)

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

    def layers_at(self, q, faces: Iterable[int] | None = None) -> list[tuple[int, Pt]]:
        """The layers of paper at the folded point q, bottom → top: (face, sheet point) — where
        each layer's paper lies on the flat sheet. A point on a crease or a face edge counts each
        layer once (the faces of one layer meeting there map it to one sheet point). `faces`
        limits the stack to those faces (e.g. one flap)."""
        q = pt(q)
        cand = range(len(self.faces)) if faces is None else sorted(set(faces))
        hit = [f for f in cand if inside_convex(q, self.image(f))]
        if hit:
            st = sort_stack(self, hit)
            return [(f, xf_apply(xf_invert(self.faces[f].xf), q)) for f in st]
        # on an edge or a vertex: group the faces touching q by the sheet point they map it to
        groups: list[tuple[list[int], Pt]] = []
        for f in cand:
            if not inside_convex(q, self.image(f), -TOL):
                continue
            s = xf_apply(xf_invert(self.faces[f].xf), q)
            for fs, s0 in groups:
                if abs(s[0] - s0[0]) <= 10 * TOL and abs(s[1] - s0[1]) <= 10 * TOL:
                    fs.append(f)
                    break
            else:
                groups.append(([f], s))
        if not groups:
            raise FlatStateError(f"no layer at folded point ({q[0]:.3f}, {q[1]:.3f})")

        def rel(a: list[int], b: list[int]) -> bool | None:
            for f in a:
                for g in b:
                    up = self.above(f, g)
                    if up is not None:
                        return up
            return None
        below = [0] * len(groups)
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                up = rel(groups[i][0], groups[j][0])
                if up is None:
                    raise FlatStateError(f"layers touching ({q[0]:.3f}, {q[1]:.3f}) are not "
                                         "ordered there: pick a point inside the paper")
                below[i if up else j] += 1
        order = sorted(range(len(groups)), key=lambda k: below[k])
        if [below[k] for k in order] != list(range(len(groups))):
            raise FlatStateError(f"layer order at ({q[0]:.3f}, {q[1]:.3f}) is cyclic")
        return [(min(groups[k][0]), groups[k][1]) for k in order]

    def preimage(self, q, layer: str | int = "top", faces: Iterable[int] | None = None) -> Pt:
        """The sheet point (flat-sheet coordinates) that lies at the folded point q on the chosen
        layer: "top" (nearest the viewer), "bottom", or an index into the stack bottom → top
        (negative indices count from the top, as in Python). `faces` limits the stack to those
        faces. The inverse of `to_folded` for that layer: cartridges compute crease seeds and
        `sheet_points` selections with it."""
        stack = self.layers_at(q, faces)
        if layer == "top":
            k = len(stack) - 1
        elif layer == "bottom":
            k = 0
        elif isinstance(layer, int) and -len(stack) <= layer < len(stack):
            k = layer % len(stack)
        else:
            raise FlatStateError(f"layer {layer!r} asked, {len(stack)} layer(s) at "
                                 f"({pt(q)[0]:.3f}, {pt(q)[1]:.3f})")
        return stack[k][1]

    def layer_index(self, sheet_point, q=None) -> int:
        """The index (bottom → top, from 0) of the layer a sheet point's paper occupies in the
        stack at the folded point q (default: its own folded image)."""
        f = self.face_at(sheet_point)
        img = xf_apply(self.faces[f].xf, pt(sheet_point)) if q is None else pt(q)
        s = pt(sheet_point)
        for k, (g, p) in enumerate(self.layers_at(img)):
            if g == f or (self.faces[g].xf == self.faces[f].xf
                          and math.hypot(p[0] - s[0], p[1] - s[1]) <= 10 * TOL):
                return k
        raise FlatStateError(f"sheet point ({s[0]:.3f}, {s[1]:.3f}) is not in the stack at "
                             f"({img[0]:.3f}, {img[1]:.3f})")

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

    def cut_edges(self) -> set[tuple[int, int]]:
        """Interior edges (a, b), a < b, that lie on a slit: their faces are not joined."""
        if self._cut is None:
            out: set[tuple[int, int]] = set()
            if self.cuts:
                half = self.half_edges()
                for (a, b) in half:
                    if a < b and (b, a) in half and on_segments(self.points[a], self.points[b],
                                                                self.cuts):
                        out.add((a, b))
            self._cut = out
        return self._cut

    def joined(self, a: int, b: int) -> bool:
        """Is the interior edge a–b a crease (not a slit)?"""
        return (min(a, b), max(a, b)) not in self.cut_edges()

    def creases(self) -> list[Crease]:
        out: list[Crease] = []
        half = self.half_edges()
        cut = self.cut_edges()
        for (a, b), f in half.items():
            g = half.get((b, a))
            if g is None or (a, b) > (b, a) or (min(a, b), max(a, b)) in cut:
                continue
            out.append(Crease(a, b, f, g, self.crease_angle(f, g)))
        return out

    def boundary_edges(self) -> list[tuple[int, int, int]]:
        """Edges with paper on one side only: the outline and both sides of every slit."""
        half = self.half_edges()
        cut = self.cut_edges()
        return [(a, b, f) for (a, b), f in half.items()
                if (b, a) not in half or (min(a, b), max(a, b)) in cut]

    def seam_only(self, a: int, b: int) -> bool:
        """Is the edge a–b a seam that has never been folded (no crease on the flat sheet)?"""
        pa, pb = self.points[a], self.points[b]
        return bool(self.seams) and on_segments(pa, pb, self.seams) \
            and not on_segments(pa, pb, self.creased)

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
        return self.derive(faces=faces, order={k: -s for k, s in self.order.items()})

    def rotate(self, deg: float, center=(0.0, 0.0)) -> FlatState:
        """Rotate the folded model in its plane (diagram convenience; no crease moves)."""
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        cx, cy = pt(center)
        m = (c, -s, s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy))
        faces = [Face(f.verts, xf_compose(m, f.xf)) for f in self.faces]
        return self.derive(faces=faces)

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
        for a, b in merge_segments(self.cuts):
            sheet.cut([a, b])
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
        cr = [c for c in self.creases() if c.angle != 0.0 or not self.seam_only(c.a, c.b)]
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
