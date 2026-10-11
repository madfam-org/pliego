"""Fold-and-cut by pre-image mapping (papel picado, jianzhi, snowflakes, kirigami cards).

After simple folds (`simplefold.FoldedState`), `cut(state, regions)` removes every point of the
sheet whose folded image lies inside any region (folded frame). The region boundaries are mapped
back through every layer (clipped to that layer), added to the sheet's arrangement together with
the fold creases, and each face is classified kept/removed by mapping an interior point forward.
The kept region's boundary becomes the new outline and holes. Exact for polygonal regions (up to
the 1e-6 mm grid).

`papel_picado(...)` is the panel builder for tissue flags: fold in half (or quarters), cut the
caller's motif through every layer, check the result (one piece, every bridge at least the
stock's minimum feature, no face below the spec's area floor), iron it flat and add the top hem
that folds over the string. Papel picado is the papercut tradition credited to San Salvador
Huixcolotla, Puebla; cartridges cite it and draw their own motifs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .arrangement import SegmentInput, build_arrangement
from .exact import GRID
from .geometry import (
    EPS,
    PointLike,
    Vec2,
    as_vec,
    point_in_polygon,
    polygon_area,
    polygon_centroid,
)
from .sheet import Mark, Placement, Sheet
from .simplefold import FoldedState, apply, invert


@dataclass
class FoldCutResult:
    sheet: Sheet
    removed_area: float
    kept_area: float
    islands: list[list[Vec2]] = field(default_factory=list)  # kept pieces that fell away

    @property
    def connected(self) -> bool:
        return not self.islands


def interior_point(ring: list[Vec2]) -> Vec2:
    """A point strictly inside a simple polygon (centroid, else an ear-triangle centroid)."""
    c = polygon_centroid(ring)
    if point_in_polygon(c, ring) == 1:
        return c
    n = len(ring)
    for i in range(n):
        a, b, cc = ring[i - 1], ring[i], ring[(i + 1) % n]
        if (b - a).cross(cc - b) <= 0:
            continue
        t = Vec2((a.x + b.x + cc.x) / 3, (a.y + b.y + cc.y) / 3)
        if point_in_polygon(t, ring, eps=1e-7) == 1:
            return t
    for i in range(n):  # fall back: a point just left of an edge midpoint
        a, b = ring[i], ring[(i + 1) % n]
        m = a.lerp(b, 0.5) + (b - a).perp().normalized() * 1e-4
        if point_in_polygon(m, ring, eps=1e-7) == 1:
            return m
    raise ValueError("cannot find an interior point")


def _clip_segment(p: Vec2, q: Vec2, poly: list[Vec2]) -> tuple[Vec2, Vec2] | None:
    """Cyrus–Beck clip of segment pq to a convex CCW polygon."""
    t0, t1 = 0.0, 1.0
    d = q - p
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        e = b - a
        num = e.cross(p - a)  # ≥ 0 inside (left of a→b)
        den = e.cross(d)
        if abs(den) < 1e-15:
            if num < -1e-12:
                return None
            continue
        t = -num / den
        if den > 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    if (t1 - t0) * d.length() <= EPS:
        return None
    return (p + d * t0, p + d * t1)


def cut(state: FoldedState, regions: list[list[PointLike]] | list[PointLike],
        id: str = "cut", **sheet_kwargs) -> FoldCutResult:
    """Cut `regions` (polygons in the folded frame) through every layer and unfold."""
    regs = _regions(regions)
    segs: list[SegmentInput] = []
    for a, b, asg in state.creases:
        segs.append(SegmentInput(a, b, asg, 180.0 if asg == "V" else -180.0, "crease", 0))
    for lay in state.layers:
        inv = invert(lay.xf)
        for reg in regs:
            pre = [apply(inv, p) for p in reg]
            for i in range(len(pre)):
                hit = _clip_segment(pre[i], pre[(i + 1) % len(pre)], lay.poly)
                if hit is not None:
                    segs.append(SegmentInput(hit[0], hit[1], "U", 0.0, "none", 1))
    arr = build_arrangement(list(state.outline), [], segs)
    verts = arr.vertices
    removed = set()
    kept_area = removed_area = 0.0
    for fi, f in enumerate(arr.faces):
        ring = [verts[v] for v in f]
        pt = interior_point(ring)
        img = state.to_folded(pt)
        gone = img is not None and any(point_in_polygon(img, r) == 1 for r in regs)
        if gone:
            removed.add(fi)
            removed_area += polygon_area(ring)
        else:
            kept_area += polygon_area(ring)
    if not removed:
        raise ValueError("the cut regions remove nothing from the sheet")
    if len(removed) == len(arr.faces):
        raise ValueError("the cut regions remove the whole sheet")
    cycles = _kept_boundary(arr, removed)
    outers = sorted((c for c in cycles if polygon_area(c) > 0), key=lambda c: -polygon_area(c))
    holes = [c for c in cycles if polygon_area(c) < 0]
    outline = outers[0]
    sheet = Sheet(id, outline, **sheet_kwargs)
    for h in holes:
        probe = interior_point(list(reversed(h)))
        if point_in_polygon(probe, outline) == 1:
            sheet.hole(list(reversed(h)))
    for a, b, asg in state.creases:
        sheet.crease(a, b, "valley" if asg == "V" else "mountain", 180.0)
    return FoldCutResult(sheet, removed_area, kept_area, outers[1:])


def _regions(regions) -> list[list[Vec2]]:
    if regions and not isinstance(regions[0], list | tuple) or (
            regions and isinstance(regions[0], tuple) and len(regions[0]) == 2
            and isinstance(regions[0][0], int | float)):
        regions = [regions]
    out = []
    for r in regions:
        ring = [as_vec(p) for p in r]
        if len(ring) < 3 or abs(polygon_area(ring)) < EPS * EPS:
            raise ValueError("a cut region needs at least 3 points and some area")
        out.append(ring if polygon_area(ring) > 0 else ring[::-1])
    return out


def _kept_boundary(arr, removed: set[int]) -> list[list[Vec2]]:
    """Boundary cycles of the kept faces (kept region on the left)."""
    from functools import cmp_to_key


    kept_half: set[tuple[int, int]] = set()
    for fi, f in enumerate(arr.faces):
        if fi in removed:
            continue
        for k in range(len(f)):
            kept_half.add((f[k], f[(k + 1) % len(f)]))
    bnd = sorted(h for h in kept_half if (h[1], h[0]) not in kept_half)
    out_by: dict[int, list[int]] = {}
    for a, b in bnd:
        out_by.setdefault(a, []).append(b)
    g = arr.grid
    used: set[tuple[int, int]] = set()
    cycles: list[list[Vec2]] = []
    for start in bnd:
        if start in used:
            continue
        cyc: list[int] = []
        h = start
        while h not in used:
            used.add(h)
            cyc.append(h[0])
            a, b = h
            options = [w for w in out_by.get(b, []) if (b, w) not in used]
            if not options:
                break
            if len(options) > 1:
                back = (g[a][0] - g[b][0], g[a][1] - g[b][1])

                options.sort(key=cmp_to_key(lambda u, w, b=b, back=back: _cw_cmp(
                    back, (g[u][0] - g[b][0], g[u][1] - g[b][1]),
                    (g[w][0] - g[b][0], g[w][1] - g[b][1]))))
            h = (b, options[0])
        cycles.append([Vec2(g[i][0] / GRID, g[i][1] / GRID) for i in cyc])
    return cycles


def _cw_cmp(back: tuple[int, int], u: tuple[int, int], w: tuple[int, int]) -> int:
    """Order candidate directions clockwise starting just after `back` (tightest left turn)."""
    import math

    def key(d: tuple[int, int]) -> float:
        a = math.atan2(back[1], back[0]) - math.atan2(d[1], d[0])
        return a % (2 * math.pi) or 2 * math.pi

    ku, kw = key(u), key(w)
    return -1 if ku < kw else (1 if ku > kw else 0)


# ── papel picado panels ──────────────────────────────────────────────────────


@dataclass
class Picado:
    """A cut papel picado panel: the ironed-flat sheet, its hem fold and the papercut report."""

    sheet: Sheet
    hem: Mark | None
    hem_y: float
    report: object
    min_face_mm2: float

    def hem_glue(self, id: str, inset: float = 0.5) -> dict:
        """Glue join of the hem folded over the string onto the panel's own back (spec §5.3):
        the hem strip, mirrored about its fold, welds to the back face below it."""
        from .assembly import glue

        if self.hem is None:
            raise ValueError("papel_picado: this panel has no hem")
        xs = [p.x for p in self.sheet.outline]
        top = max(p.y for p in self.sheet.outline)
        x0, x1 = min(xs) + inset, max(xs) - inset
        y0, y1 = self.hem_y + inset, top - inset
        if x1 - x0 <= 0 or y1 - y0 <= 0:
            raise ValueError("papel_picado: the hem is too narrow to glue")
        region = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        return glue(id, self.sheet, region, self.sheet, (1.0, 0.0, 0.0, -1.0, 0.0,
                                                         2.0 * self.hem_y), "back")


def papel_picado(id: str, width: float, height: float, motif: list[list[PointLike]], *,
                 hem: float = 12.0, symmetry: int = 1, stock: str = "papel-de-china",
                 min_feature: float = 1.5, front: str | None = None, back: str | None = None,
                 label: str | dict | None = None, placement: Placement | None = None,
                 hem_name: str = "hem") -> Picado:
    """A papel picado panel ``width`` × ``height`` cut by fold-and-cut.

    The sheet is folded in half about x = width/2 (``symmetry`` 1), or then again about the
    middle of the cut field y = (height − 2·hem)/2 (``symmetry`` 2, quarters). ``motif`` lists
    the regions to remove, in the folded frame — the half x ≥ width/2 (and, for quarters, the
    upper half of the cut field); every region must reach that part and stay below the folded
    hem (y ≤ height − 2·hem − min_feature) so the hem lies on uncut paper. The cut sheet is
    checked with `papercut.analyze` (one piece, bridges ≥ ``min_feature``) and the face-area
    floor ``min_feature``² (spec §8.3), then ironed flat (the fold creases are not kept) and
    given a mountain hem fold at y = height − hem (the strip that folds back over the string;
    ``hem`` = 0 for none). Fails loud.
    """
    from .papercut import analyze

    if not (width > 0 and height > 0 and hem >= 0 and min_feature > 0):
        raise ValueError("papel_picado: width, height and min_feature must be positive, hem ≥ 0")
    if symmetry not in (1, 2):
        raise ValueError("papel_picado: symmetry must be 1 (half) or 2 (quarters)")
    field_top = height - 2.0 * hem - (min_feature if hem > 0 else 0.0)
    if field_top < 0.25 * height:
        raise ValueError("papel_picado: the hem leaves too little paper to cut")
    cx, cy = width / 2.0, (height - 2.0 * hem) / 2.0
    regions = _regions(motif)
    for k, reg in enumerate(regions):
        if any(p.y > field_top + 1e-9 for p in reg):
            raise ValueError(f"papel_picado: motif region {k} reaches the hem "
                             f"(keep y ≤ {field_top:g})")
        if not any(p.x > cx + 1e-6 and (symmetry == 1 or p.y > cy + 1e-6) for p in reg):
            raise ValueError(f"papel_picado: motif region {k} lies outside the folded part "
                             "(x > width/2" + (", y above the middle)" if symmetry == 2
                                               else ")"))
    state = FoldedState([Vec2(0, 0), Vec2(width, 0), Vec2(width, height), Vec2(0, height)])
    state.fold(((cx, 0.0), (cx, height)), "valley")
    if symmetry == 2:
        state.fold(((width, cy), (cx, cy)), "valley")
    res = cut(state, regions, id=f"{id}-cut", stock=stock)
    if not res.connected:
        raise ValueError(f"papel_picado: the cut leaves {len(res.islands)} loose piece(s)")
    flat = Sheet(id, list(res.sheet.outline), stock=stock, grain_deg=90.0, label=label,
                 front=front, back=back if back is not None else front, placement=placement)
    for h in res.sheet.holes:
        flat.hole(list(reversed(h)))
    rep = analyze(flat, min_feature_mm=min_feature)
    if not rep.ok:
        raise ValueError("papel_picado: " + "; ".join(i["detail"] for i in rep.issues
                                                       if i["level"] == "error"))
    hem_mark = None
    if hem > 0:
        hem_mark = flat.mountain((0.0, height - hem), (width, height - hem), 180.0,
                                 name=hem_name)
    smallest = material_min_area(flat.build())
    floor = max(1.0, min_feature ** 2)
    if smallest < floor:
        raise ValueError(f"papel_picado: a face of {smallest:.2f} mm² is below the "
                         f"{floor:.2f} mm² floor (spec §8.3); enlarge the panel or the motif")
    return Picado(flat, hem_mark, height - hem, rep, smallest)


def material_min_area(arr) -> float:
    """Smallest material face area (mm²): faces joined across `J` edges (hole bridges, spec §2)
    count as one region, as in the document's area floor (spec §8.3)."""
    jset = {frozenset(e) for e, asg in zip(arr.edges, arr.assignment, strict=True) if asg == "J"}
    parent = list(range(len(arr.faces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner: dict[frozenset, int] = {}
    for i, f in enumerate(arr.faces):
        for k in range(len(f)):
            side = frozenset((f[k], f[(k + 1) % len(f)]))
            if side in jset:
                g = owner.setdefault(side, i)
                ri, rg = find(i), find(g)
                if ri != rg:
                    parent[max(ri, rg)] = min(ri, rg)
    area: dict[int, float] = {}
    for i, f in enumerate(arr.faces):
        r = find(i)
        area[r] = area.get(r, 0.0) + abs(polygon_area([arr.vertices[v] for v in f]))
    return min(area.values())
