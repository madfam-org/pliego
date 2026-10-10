"""The simple-fold model: a folded state is a stack of layers.

Each layer is a convex polygon of the original sheet (sheet frame) plus the affine map that puts
it into the folded frame, ordered bottom → top. `fold(line, direction, layers)` splits the
selected layers along the fold line, reflects the part left of the directed line onto the right
and restacks it (valley: on top, mountain: underneath, order reversed — the moving part flips).
Every fold records its crease segments in the sheet frame, so the state yields step-by-step
diagram frames and the crease pattern (`crease_pattern()`).

Convex sheets only (squares, rectangles, regular polygons): convexity is preserved by straight
folds, so half-plane clipping is exact.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .geometry import EPS, Line, PointLike, Vec2, as_vec, is_simple_polygon, polygon_area
from .sheet import Sheet

Affine = tuple[float, float, float, float, float, float]  # x' = a x + b y + tx, y' = c x + d y + ty
IDENTITY: Affine = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def apply(m: Affine, p: Vec2) -> Vec2:
    return Vec2(m[0] * p.x + m[1] * p.y + m[4], m[2] * p.x + m[3] * p.y + m[5])


def compose(m: Affine, n: Affine) -> Affine:
    """m ∘ n."""
    return (m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[0] * n[4] + m[1] * n[5] + m[4], m[2] * n[4] + m[3] * n[5] + m[5])


def invert(m: Affine) -> Affine:
    det = m[0] * m[3] - m[1] * m[2]
    if abs(det) < 1e-15:
        raise ValueError("singular affine map")
    a, b, c, d = m[3] / det, -m[1] / det, -m[2] / det, m[0] / det
    return (a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5]))


def reflection(line: Line) -> Affine:
    """Affine reflection across the infinite line."""
    d = line.direction()
    c2, s2 = d.x * d.x - d.y * d.y, 2 * d.x * d.y
    p = line.p0
    tx = p.x - (c2 * p.x + s2 * p.y)
    ty = p.y - (s2 * p.x - c2 * p.y)
    return (c2, s2, s2, -c2, tx, ty)


def det(m: Affine) -> float:
    return m[0] * m[3] - m[1] * m[2]


@dataclass
class Layer:
    poly: list[Vec2]  # sheet frame, CCW, convex
    xf: Affine = IDENTITY

    def image(self) -> list[Vec2]:
        pts = [apply(self.xf, p) for p in self.poly]
        return pts if polygon_area(pts) >= 0 else pts[::-1]

    @property
    def flipped(self) -> bool:
        return det(self.xf) < 0


@dataclass
class Frame:
    """A diagram frame: the stack after one step (folded-frame polygons, bottom → top)."""

    step: int
    line: Line | None
    direction: str | None
    layers: list[list[Vec2]]
    flipped: list[bool]


def _clip(poly: list[Vec2], line: Line, keep_left: bool) -> list[Vec2]:
    out: list[Vec2] = []
    n = len(poly)
    d = line.p1 - line.p0
    ln = d.length()

    def s(p: Vec2) -> float:
        v = d.cross(p - line.p0) / ln
        return v if keep_left else -v

    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        sa, sb = s(a), s(b)
        if sa >= -EPS:
            out.append(a)
        if (sa > EPS and sb < -EPS) or (sa < -EPS and sb > EPS):
            out.append(a.lerp(b, sa / (sa - sb)))
    dedup: list[Vec2] = []
    for p in out:
        if not dedup or dedup[-1].distance(p) > EPS:
            dedup.append(p)
    if len(dedup) > 1 and dedup[0].distance(dedup[-1]) <= EPS:
        dedup.pop()
    return dedup if len(dedup) >= 3 and abs(polygon_area(dedup)) > EPS * EPS else []


def _chord(poly: list[Vec2], line: Line) -> tuple[Vec2, Vec2] | None:
    """The segment of the line inside a convex polygon (None if it only touches)."""
    d = line.p1 - line.p0
    ln = d.length()
    pts: list[Vec2] = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        sa, sb = d.cross(a - line.p0) / ln, d.cross(b - line.p0) / ln
        if abs(sa) <= EPS:
            pts.append(a)
        elif (sa > EPS and sb < -EPS) or (sa < -EPS and sb > EPS):
            pts.append(a.lerp(b, sa / (sa - sb)))
    if len(pts) < 2:
        return None
    u = d * (1.0 / ln)
    pts.sort(key=lambda p: u.dot(p))
    a, b = pts[0], pts[-1]
    return (a, b) if a.distance(b) > EPS else None


@dataclass
class FoldedState:
    """A sheet folded by simple folds. Start from a convex outline (sheet frame)."""

    outline: list[Vec2]
    layers: list[Layer] = field(default_factory=list)
    creases: list[tuple[Vec2, Vec2, str]] = field(default_factory=list)  # sheet frame, M/V
    frames: list[Frame] = field(default_factory=list)

    def __post_init__(self) -> None:
        ring = [as_vec(p) for p in self.outline]
        if polygon_area(ring) < 0:
            ring.reverse()
        if not is_simple_polygon(ring):
            raise ValueError("simple folds need a simple outline")
        n = len(ring)
        for i in range(n):
            a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
            if (b - a).cross(c - b) < -1e-9:
                raise ValueError("simple folds need a convex outline")
        self.outline = ring
        if not self.layers:
            self.layers = [Layer(list(ring))]
        self.frames.append(self._frame(None, None))

    @classmethod
    def of(cls, sheet_or_outline: Sheet | list[PointLike]) -> FoldedState:
        if isinstance(sheet_or_outline, Sheet):
            return cls(list(sheet_or_outline.outline))  # type: ignore[arg-type]
        return cls([as_vec(p) for p in sheet_or_outline])

    def _frame(self, line: Line | None, direction: str | None) -> Frame:
        return Frame(len(self.frames), line, direction, [lay.image() for lay in self.layers],
                     [lay.flipped for lay in self.layers])

    def fold(self, line: Line | tuple[PointLike, PointLike], direction: str = "valley",
             layers: str | int = "all") -> FoldedState:
        """Fold the part left of the directed line over to the right.

        `direction`: valley (moving part comes up, onto the top) or mountain (goes under).
        `layers`: "all", "top" (the top layer only) or n (the top n layers).
        """
        ln = line if isinstance(line, Line) else Line(line[0], line[1])
        if direction not in ("valley", "mountain"):
            raise ValueError("direction must be valley or mountain")
        n_layers = len(self.layers)
        if layers == "all":
            k = n_layers
        elif layers == "top":
            k = 1
        elif isinstance(layers, int) and 1 <= layers <= n_layers:
            k = layers
        else:
            raise ValueError(f"layers must be 'all', 'top' or 1..{n_layers}")
        first_sel = n_layers - k
        refl = reflection(ln)
        stay: list[tuple[int, Layer]] = []
        moving: list[Layer] = []
        for idx, lay in enumerate(self.layers):
            if idx < first_sel:
                stay.append((idx, lay))
                continue
            img = lay.image()
            left, right = _clip(img, ln, True), _clip(img, ln, False)
            inv = invert(lay.xf)
            if left and right:
                chord = _chord(img, ln)
                if chord is not None:
                    a, b = apply(inv, chord[0]), apply(inv, chord[1])
                    asg = "V" if (direction == "valley") != lay.flipped else "M"
                    self.creases.append((a, b, asg))
            if right:
                stay.append((idx, Layer(_ccw([apply(inv, p) for p in right]), lay.xf)))
            if left:
                moving.append(Layer(_ccw([apply(inv, p) for p in left]), compose(refl, lay.xf)))
        if not moving:
            raise ValueError("the fold line does not cross the selected layers' left side")
        stay_layers = [lay for _, lay in sorted(stay, key=lambda t: t[0])]
        moved = list(reversed(moving))
        if direction == "valley":
            new = stay_layers + moved
        else:
            below = sum(1 for i, _ in stay if i < first_sel)
            new = stay_layers[:below] + moved + stay_layers[below:]
        self.layers = new
        self.frames.append(self._frame(ln, direction))
        return self

    def layer_at(self, sheet_point: PointLike) -> Layer | None:
        """The layer whose sheet-frame polygon contains the point (interior points only)."""
        from .geometry import point_in_polygon

        p = as_vec(sheet_point)
        for lay in self.layers:
            if point_in_polygon(p, lay.poly) >= 0:
                return lay
        return None

    def to_folded(self, sheet_point: PointLike) -> Vec2 | None:
        lay = self.layer_at(sheet_point)
        return None if lay is None else apply(lay.xf, as_vec(sheet_point))

    def crease_pattern(self, id: str = "folded", **sheet_kwargs) -> Sheet:
        """The unfolded sheet with every fold made (valley/mountain ±180°)."""
        sheet = Sheet(id, list(self.outline), **sheet_kwargs)
        for a, b, asg in self.creases:
            sheet.crease(a, b, "valley" if asg == "V" else "mountain", 180.0)
        return sheet

    unfold = crease_pattern


def _ccw(pts: list[Vec2]) -> list[Vec2]:
    return pts if polygon_area(pts) >= 0 else pts[::-1]
