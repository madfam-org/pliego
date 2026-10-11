"""Cut-fold block trees: slit-and-fold pop-ups cut from a sheet itself, on any straight fold.

A **block** is two slits across a fold (the *corner*) and three folds between them, A, F and B,
parallel to the corner: A at distance ``a`` on the corner's minus side, B at distance ``b`` on its
plus side, F = A + B − corner. The strip between the slits stands up as a parallelogram (panel
A–F of length b, panel F–B of length a) whenever the corner opens. Blocks nest: a child block is
cut into one of its parent's three folds (``at`` = "a", "f" or "b"), narrower than the parent, so
the parent's fold keeps two uncut ends. Nested in F it notches the parent (the steps of a
staircase); nested in A or B it stands in the concave corner the parent makes with the material
beside it (a box on a box: the tiers of an altar, a candle on a tread).

**Kinematics (Tier R, exact).** Every block is a parallelogram four-bar in the cross-section and
every corner it can be cut into opens by the same angle as the root corner, so every fold of the
tree turns by the same magnitude γ as the root fold: A and B with the sign of their corner, F with
the opposite sign. Any γ in [0, 180] is a rigid state (flat at 0, folded flat at 180, never
locked) and a plain linear blend of the angles is exact — `CutFold.angles(γ)`.

**Pop-outs (crests).** A block may carry one silhouette that continues one of its panels past its
outline — a roof gable or a chimney past a slit (``crest_side`` "hi" / "lo"), a flame or a dome
past the middle fold F into the other panel (``crest_side`` "fold"). The slit (or F) is replaced by
the crest's outline there, so the silhouette turns with its panel and leaves its own shape as a
hole in the material it was cut from.

Coordinates: the corner is the line through ``origin`` with unit direction ``along``; ``across``
(unit, perpendicular) points from the minus side to the plus side. A local point (s, y) is the
sheet point origin + s·across + y·along. Geometry is validated before anything is added to the
sheet (fail loud): blocks fit the material beside their corner, children lie inside their
parent's extent, siblings and cousins do not overlap, crests stay on their panel.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

from .geometry import PointLike, Vec2, as_vec
from .sheet import Mark, Sheet

V2 = tuple[float, float]
FOLD_WORD = {"en": "fold", "es": "pliegue", "fr": "pli", "pt": "dobra"}
CORNERS = ("a", "f", "b")
CREST_SIDES = ("hi", "lo", "fold")


@dataclass
class Block:
    """One cut-fold block (see the module docstring). ``lo`` < ``hi`` is its extent along the
    corner; ``crest`` is a polyline of local points whose first and last points lie on the
    outline it replaces (second coordinate 0):

    * ``crest_side`` "hi" / "lo": points (t, h), t along panel ``crest_panel`` from its minus-side
      fold (0 ≤ t ≤ panel length), h ≥ 0 beyond the slit at ``hi`` (or below ``lo``);
    * ``crest_side`` "fold": points (y, h), y along the corner (lo < y < hi), h ≥ 0 past F into
      the other panel.
    """

    a: float
    b: float
    lo: float
    hi: float
    at: str = "f"
    children: list[Block] = field(default_factory=list)
    crest: Sequence[V2] | None = None
    crest_panel: int = 1
    crest_side: str = "hi"
    name: str | None = None
    label: dict | None = None


@dataclass
class Placed:
    """A block laid out on the sheet: local fold positions, corner sign and tree links."""

    block: Block
    index: int
    parent: int | None
    depth: int
    corner: float
    sign: int
    s_a: float
    s_f: float
    s_b: float
    reach_minus: float
    reach_plus: float
    marks: list[Mark] = field(default_factory=list)

    def panel(self, k: int) -> tuple[float, float]:
        """Local s-range of panel 1 (A–F) or panel 2 (F–B)."""
        if k not in (1, 2):
            raise ValueError("panel must be 1 (A–F) or 2 (F–B)")
        return (self.s_a, self.s_f) if k == 1 else (self.s_f, self.s_b)


@dataclass
class CutFold:
    """The result of `cut_fold`: every fold (with its turn sign) and the placed blocks."""

    sheet: Sheet
    origin: Vec2
    along: Vec2
    across: Vec2
    marks: list[tuple[Mark, int]]
    blocks: list[Placed]
    gutter_marks: list[Mark]

    def point(self, s: float, y: float) -> Vec2:
        """Sheet point of local (s, y)."""
        return Vec2(self.origin.x + s * self.across.x + y * self.along.x,
                    self.origin.y + s * self.across.y + y * self.along.y)

    def panel_point(self, block: int, panel: int, t: float, y: float) -> Vec2:
        """Sheet point at distance t along a block's panel (from its minus-side fold), at y."""
        p0, p1 = self.blocks[block].panel(panel)
        if not -1e-9 <= t <= p1 - p0 + 1e-9:
            raise ValueError(f"t = {t} is off panel {panel} (length {p1 - p0:g})")
        return self.point(p0 + t, y)

    def angles(self, gamma: float) -> dict[Mark, float]:
        """{mark: deg} with the root fold turned by γ — exact for every γ in [0, 180]."""
        return {m: sg * gamma for m, sg in self.marks}

    def edge_angles(self, gamma: float) -> dict[int, float]:
        """The same state per sheet-local edge index (for `pliego.kinematics`)."""
        out: dict[int, float] = {}
        for m, sg in self.marks:
            for e in m.edges():
                out[e] = sg * gamma
        return out

    def footprints(self) -> list[list[Vec2]]:
        """Sheet-frame rectangles of every block and crest (material that moves when the
        corner opens) — for callers placing other cuts beside the tree."""
        out = []
        for r in _rects(self.blocks):
            s0, s1, y0, y1 = r[0]
            out.append([self.point(s0, y0), self.point(s1, y0), self.point(s1, y1),
                        self.point(s0, y1)])
        return out

    def residual(self, gammas: Sequence[float], root: PointLike | None = None) -> float:
        """Largest loop-closure residual (mm, `pliego.kinematics.closure_residual`) over the
        given root angles — 0 up to rounding for a consistent tree."""
        from .kinematics import closure_residual

        arr = self.sheet.build()
        r = None if root is None else as_vec(root)
        return max(closure_residual(arr, self.edge_angles(g), r) for g in gammas)


def _unit(p: PointLike, what: str) -> Vec2:
    v = as_vec(p)
    n = math.hypot(v.x, v.y)
    if not (math.isfinite(n) and abs(n - 1.0) < 1e-9):
        raise ValueError(f"cut_fold: {what} must be a unit vector, got ({v.x}, {v.y})")
    return v


def _place(blocks: Sequence[Block], reach: tuple[float, float], span: tuple[float, float],
           sign: int, margin: float) -> list[Placed]:
    out: list[Placed] = []

    def visit(blk: Block, parent: Placed | None, corner: float, sg: int, rm: float, rp: float,
              lim: tuple[float, float], depth: int) -> None:
        tag = blk.name or f"block {len(out) + 1}"
        for k, v in (("a", blk.a), ("b", blk.b), ("lo", blk.lo), ("hi", blk.hi)):
            if not (isinstance(v, int | float) and math.isfinite(v)):
                raise ValueError(f"cut_fold: {tag}: {k} must be a finite number, got {v!r}")
        if blk.a <= 0 or blk.b <= 0:
            raise ValueError(f"cut_fold: {tag}: a and b must be positive")
        if blk.a > rm - margin or blk.b > rp - margin:
            raise ValueError(f"cut_fold: {tag}: a = {blk.a:g}, b = {blk.b:g} do not fit the "
                             f"{rm:g} / {rp:g} mm beside its corner (keep {margin:g} mm)")
        if blk.lo < lim[0] + margin - 1e-9 or blk.hi > lim[1] - margin + 1e-9 \
                or blk.hi - blk.lo < margin:
            raise ValueError(f"cut_fold: {tag}: extent [{blk.lo:g}, {blk.hi:g}] must lie inside "
                             f"[{lim[0]:g}, {lim[1]:g}] with {margin:g} mm uncut at each end")
        p = Placed(blk, len(out), None if parent is None else parent.index, depth, corner, sg,
                   corner - blk.a, corner - blk.a + blk.b, corner + blk.b, rm, rp)
        out.append(p)
        for child in blk.children:
            if child.at not in CORNERS:
                raise ValueError(f"cut_fold: child of {tag}: at must be one of {CORNERS}")
            if child.at == "a":
                visit(child, p, p.s_a, sg, rm - blk.a, blk.b, (blk.lo, blk.hi), depth + 1)
            elif child.at == "f":
                visit(child, p, p.s_f, -sg, blk.b, blk.a, (blk.lo, blk.hi), depth + 1)
            else:
                visit(child, p, p.s_b, sg, blk.a, rp - blk.b, (blk.lo, blk.hi), depth + 1)

    for blk in blocks:
        visit(blk, None, 0.0, sign, reach[0], reach[1], span, 0)
    return out


def _ancestors(placed: list[Placed], i: int) -> set[int]:
    out, j = set(), placed[i].parent
    while j is not None:
        out.add(j)
        j = placed[j].parent
    return out


def _crest_rect(p: Placed) -> tuple[float, float, float, float] | None:
    blk = p.block
    if blk.crest is None:
        return None
    pts = list(blk.crest)
    if blk.crest_side == "fold":
        ys = [q[0] for q in pts]
        h = max(q[1] for q in pts)
        sgn = 1.0 if blk.crest_panel == 1 else -1.0
        s0, s1 = sorted((p.s_f, p.s_f + sgn * h))
        return (s0, s1, min(ys), max(ys))
    p0, _ = p.panel(blk.crest_panel)
    ts = [q[0] for q in pts]
    h = max(q[1] for q in pts)
    y0, y1 = (blk.hi, blk.hi + h) if blk.crest_side == "hi" else (blk.lo - h, blk.lo)
    return (p0 + min(ts), p0 + max(ts), y0, y1)


def _rects(placed: list[Placed]) -> list[tuple[tuple[float, float, float, float], int, str]]:
    out = []
    for p in placed:
        out.append(((p.s_a, p.s_b, p.block.lo, p.block.hi), p.index, "block"))
        cr = _crest_rect(p)
        if cr is not None:
            out.append((cr, p.index, "crest"))
    return out


def _check_crest(p: Placed, placed: list[Placed], lim: tuple[float, float],
                 margin: float) -> None:
    blk = p.block
    tag = blk.name or f"block {p.index + 1}"
    if blk.crest_side not in CREST_SIDES:
        raise ValueError(f"cut_fold: {tag}: crest_side must be one of {CREST_SIDES}")
    if blk.crest_panel not in (1, 2):
        raise ValueError(f"cut_fold: {tag}: crest_panel must be 1 or 2")
    pts = [(float(q[0]), float(q[1])) for q in blk.crest]  # type: ignore[union-attr]
    if len(pts) < 3 or abs(pts[0][1]) > 1e-9 or abs(pts[-1][1]) > 1e-9:
        raise ValueError(f"cut_fold: {tag}: a crest needs ≥ 3 points, starting and ending on "
                         "its outline (second coordinate 0)")
    if any(q[1] <= 1e-9 for q in pts[1:-1]) or pts[-1][0] <= pts[0][0]:
        raise ValueError(f"cut_fold: {tag}: crest points between its ends must lie beyond the "
                         "outline (h > 0), and it must run in increasing t (or y)")
    if blk.crest_side == "fold":
        other = blk.a if blk.crest_panel == 1 else blk.b
        if max(q[1] for q in pts) > other - margin:
            raise ValueError(f"cut_fold: {tag}: the crest reaches past the other panel "
                             f"({other:g} mm, keep {margin:g})")
        if pts[0][0] < blk.lo + margin or pts[-1][0] > blk.hi - margin:
            raise ValueError(f"cut_fold: {tag}: the crest must leave {margin:g} mm of F uncut "
                             "at each end")
        for c in placed:
            if c.parent == p.index and c.block.at == "f" and \
                    c.block.lo - margin < pts[-1][0] and pts[0][0] < c.block.hi + margin:
                raise ValueError(f"cut_fold: {tag}: the crest overlaps a block cut into F")
        return
    p0, p1 = p.panel(blk.crest_panel)
    if pts[0][0] < -1e-9 or pts[-1][0] > p1 - p0 + 1e-9 or \
            any(not -1e-9 <= q[0] <= p1 - p0 + 1e-9 for q in pts):
        raise ValueError(f"cut_fold: {tag}: the crest leaves panel {blk.crest_panel} "
                         f"(length {p1 - p0:g})")
    lo_s, hi_s = p0 + min(q[0] for q in pts), p0 + max(q[0] for q in pts)
    if lo_s - margin < p.corner < hi_s + margin:
        raise ValueError(f"cut_fold: {tag}: the crest would cut the fold its block is cut "
                         f"into (keep it {margin:g} mm off the corner line)")
    h = max(q[1] for q in pts)
    if (blk.crest_side == "hi" and blk.hi + h > lim[1] - margin) or \
            (blk.crest_side == "lo" and blk.lo - h < lim[0] + margin):
        raise ValueError(f"cut_fold: {tag}: the crest runs past its parent's extent")


def _overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float],
              gap: float) -> bool:
    return (a[0] < b[1] + gap and b[0] < a[1] + gap and a[2] < b[3] + gap and b[2] < a[3] + gap)


def _intervals(lo: float, hi: float, cuts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out, cur = [], lo
    for c0, c1 in sorted(cuts):
        if c0 > cur + 1e-9:
            out.append((cur, c0))
        cur = max(cur, c1)
    if hi > cur + 1e-9:
        out.append((cur, hi))
    return out


def _dedupe(pts: list[Vec2]) -> list[Vec2]:
    out = [pts[0]]
    for q in pts[1:]:
        if q.distance(out[-1]) > 1e-6:
            out.append(q)
    return out


def cut_fold(sheet: Sheet, origin: PointLike, along: PointLike, across: PointLike,
             blocks: Sequence[Block], *, reach: tuple[float, float],
             span: tuple[float, float], gutter: str = "valley", angle: float = 90.0,
             treatment: str = "score", margin: float = 3.0, gutter_name: str | None = "gutter",
             gutter_label: dict | None = None, prefix: str = "block") -> CutFold:
    """Cut a tree of blocks into `sheet` across the corner fold through `origin` (see the
    module docstring) and add the corner fold itself over ``span`` = (y0, y1), minus the blocks
    cut into it.

    ``reach`` = (minus, plus): how far the plain material runs on each side of the corner (to
    the sheet edge or the next fold). ``gutter`` is the corner's kind ("valley" | "mountain"),
    ``angle`` the design fold angle written on every fold (the displayed opening as a turn),
    ``margin`` the smallest uncut fold end and the clearance between features (mm).
    Returns a `CutFold`; fold turn signs are relative to the corner (+1 turns with it).
    """
    if gutter not in ("valley", "mountain"):
        raise ValueError("cut_fold: gutter must be valley or mountain")
    if not (math.isfinite(angle) and 0.0 < angle <= 180.0):
        raise ValueError("cut_fold: angle must be in (0, 180]")
    if not (math.isfinite(margin) and margin > 0):
        raise ValueError("cut_fold: margin must be positive")
    o = as_vec(origin)
    al, ac = _unit(along, "along"), _unit(across, "across")
    if abs(al.x * ac.x + al.y * ac.y) > 1e-9:
        raise ValueError("cut_fold: along and across must be perpendicular")
    if not (span[1] - span[0] > 2 * margin and reach[0] > 0 and reach[1] > 0):
        raise ValueError("cut_fold: span must be longer than 2·margin and reach positive")
    sign = 1 if gutter == "valley" else -1
    placed = _place(blocks, reach, span, sign, margin)
    for p in placed:
        if p.block.crest is not None:
            par = placed[p.parent].block if p.parent is not None else None
            lim = span if par is None else (par.lo, par.hi)
            _check_crest(p, placed, lim, margin)
    rects = _rects(placed)
    anc = [_ancestors(placed, i) for i in range(len(placed))]
    for i, (ra, oa, ka) in enumerate(rects):
        for rb, ob, kb in rects[i + 1:]:
            if oa == ob:
                continue
            if ka == kb == "block" and (oa in anc[ob] or ob in anc[oa]):
                continue
            if ka == "crest" and kb == "block" and ob in anc[oa]:
                continue
            if kb == "crest" and ka == "block" and oa in anc[ob]:
                continue
            if _overlaps(ra, rb, margin - 1e-9):
                na = placed[oa].block.name or f"block {oa + 1}"
                nb = placed[ob].block.name or f"block {ob + 1}"
                raise ValueError(f"cut_fold: {na} ({ka}) and {nb} ({kb}) overlap on the sheet "
                                 f"(keep {margin:g} mm between them)")
    cf = CutFold(sheet, o, al, ac, [], placed, [])

    def kind(sg: int) -> str:
        return "valley" if sg > 0 else "mountain"

    # the corner fold, minus the root blocks
    for y0, y1 in _intervals(span[0], span[1], [(p.block.lo, p.block.hi) for p in placed
                                                if p.parent is None]):
        m = sheet.crease(cf.point(0.0, y0), cf.point(0.0, y1), kind(sign), angle,
                         treatment=treatment, label=gutter_label, name=gutter_name)
        cf.marks.append((m, sign))
        cf.gutter_marks.append(m)
    for p in placed:
        blk = p.block
        name = blk.name or f"{prefix}-{p.index + 1}"
        # slits, with a crest replacing part of one
        for side, y in (("lo", blk.lo), ("hi", blk.hi)):
            pts = [cf.point(p.s_a, y)]
            if blk.crest is not None and blk.crest_side == side:
                p0, _ = p.panel(blk.crest_panel)
                d = 1.0 if side == "hi" else -1.0
                pts += [cf.point(p0 + t, y + d * h) for t, h in blk.crest]
            pts.append(cf.point(p.s_b, y))
            sheet.cut(_dedupe(pts), name=f"{name}-slit")
        # folds, minus children cut into them (and a fold crest on F)
        for role, s, sg in (("a", p.s_a, p.sign), ("f", p.s_f, -p.sign), ("b", p.s_b, p.sign)):
            cuts = [(c.block.lo, c.block.hi) for c in placed
                    if c.parent == p.index and c.block.at == role]
            if role == "f" and blk.crest is not None and blk.crest_side == "fold":
                cuts.append((blk.crest[0][0], blk.crest[-1][0]))
                pts = [cf.point(p.s_f + (h if blk.crest_panel == 1 else -h), y)
                       for y, h in blk.crest]
                sheet.cut(_dedupe(pts), name=f"{name}-crest")
            num = {"a": "1", "f": "2", "b": "3"}[role]
            lab = None if blk.label is None else {
                k: f"{blk.label[k]}: {FOLD_WORD[k]} {num}" for k in FOLD_WORD}
            for y0, y1 in _intervals(blk.lo, blk.hi, cuts):
                m = sheet.crease(cf.point(s, y0), cf.point(s, y1), kind(sg), angle,
                                 treatment=treatment, label=lab, name=f"{name}-{role}")
                cf.marks.append((m, sg))
                p.marks.append(m)
    return cf
