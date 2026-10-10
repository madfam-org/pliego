"""`pliego.unfold` stage 3–4: cut numbers, glue tabs, edge labels and page packing."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .mesh import MeshError, ear_clip
from .unfold_geom import (
    Pt,
    Rigid2,
    apply,
    area,
    compose,
    convex_hull,
    edge_map,
    orientations,
    point_in_polygon,
    rotated_size,
    rotation,
)

PAGE_GAP_MM = 20.0          # gap between pages in the layout frame
MIN_TAB_MM = 1.2            # tabs lower than this are not worth gluing
TAB_SHRINK = (1.0, 0.7, 0.5, 0.35)
LABEL_MIN_MM = 1.0
EXTRA_TURNS = tuple(range(0, 180, 15))   # rotations tried besides the hull-edge ones


@dataclass
class NetTab:
    """A glue tab on one side of a cut: hinge a→b of `face` (island frame polygon, CCW)."""

    cut: int
    island: int
    face: int
    a: int
    b: int
    poly: list[Pt]
    fold: float
    under: int            # the face it is glued under (the cut's other side)
    under_map: Rigid2     # that face's local frame → this island's frame (unfolded across)


@dataclass
class NetLabel:
    """An edge number printed inside `face`, centred at `at`, baseline along `angle` (deg)."""

    text: str
    island: int
    face: int
    at: Pt
    angle: float
    size: float


def number_cuts(net) -> list:
    """Number every cut edge in island order (faces in BFS order, edges in face order)."""
    from .unfold import Cut

    owner = {f: isl.index for isl in net.islands for f in isl.faces}
    tree = {(min(a, b), max(a, b)) for isl in net.islands for _f, _g, a, b in isl.tree}
    edges = net.mesh.edges()
    cuts: list = []
    seen: set[tuple[int, int]] = set()
    for isl in net.islands:
        for f in isl.faces:
            face = net.mesh.faces[f]
            for k in range(len(face)):
                a, b = face[k], face[(k + 1) % len(face)]
                key = (min(a, b), max(a, b))
                if key in tree or key in seen or len(edges[key]) != 2:
                    continue
                seen.add(key)
                sides = []
                for g, m in [(f, k)] + [u for u in edges[key] if u != (f, k)]:
                    gf = net.mesh.faces[g]
                    sides.append((owner[g], g, gf[m], gf[(m + 1) % len(gf)]))
                cuts.append(Cut(len(cuts) + 1, key, sides, net.fold[key]))
    return cuts


def _tri_work(poly: list[Pt]):
    from .unfold import _work_for

    return _work_for([0], {0: poly}, [ear_clip(poly)], [])


def tab_shapes(p: Pt, q: Pt, style: str, h0: float, alpha_deg: float) -> list[list[Pt]]:
    """Candidate tab polygons (CCW) outside the hinge p→q, best first."""
    length = math.dist(p, q)
    d = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
    out = (d[1], -d[0])
    ta = math.tan(math.radians(alpha_deg))
    shapes: list[list[Pt]] = []
    heights = [h0 * k for k in TAB_SHRINK if h0 * k >= MIN_TAB_MM]
    if style == "trapezoid":
        for h in heights:
            inset = h / ta
            if 2 * inset < length - 1.0:
                shapes.append([p, (p[0] + out[0] * h + d[0] * inset, p[1] + out[1] * h
                                   + d[1] * inset),
                               (q[0] + out[0] * h - d[0] * inset, q[1] + out[1] * h
                                - d[1] * inset), q])
    for h in heights:
        ht = min(h, ta * length / 2.0 * 0.999)
        if ht >= MIN_TAB_MM:
            mid = ((p[0] + q[0]) / 2.0 + out[0] * ht, (p[1] + q[1]) / 2.0 + out[1] * ht)
            shapes.append([p, mid, q])
    return [s if area(s) > 0 else list(reversed(s)) for s in shapes]


def _inside_footprint(tab: list[Pt], foot: list[Pt]) -> bool:
    return (all(point_in_polygon(t, foot, 1e-6) >= 0 for t in tab)
            and not any(point_in_polygon(v, tab, 1e-6) == 1 for v in foot))


def place_tabs(net) -> list[int]:
    """One glue tab per cut, alternating sides by number; returns the cuts left untabbed."""
    from .unfold import _work_for, conflict

    style, h0 = net.options["tabs"], net.options["tab_height"]
    alpha = net.options["tab_angle"]
    if style == "none":
        return []
    tri_idx = [ear_clip(loc) for loc in net.local]
    works = {isl.index: _work_for(isl.faces, isl.pos, tri_idx, []) for isl in net.islands}
    placed: dict[int, list] = {isl.index: [] for isl in net.islands}
    untabbed = []
    for cut in net.cuts:
        prefer = (0, 1) if cut.number % 2 else (1, 0)
        done = False
        for s in prefer:
            i, f, a, b = cut.sides[s]
            g = cut.sides[1 - s][1]
            isl = net.islands[i]
            face = net.mesh.faces[f]
            p, q = isl.pos[f][face.index(a)], isl.pos[f][face.index(b)]
            gface = net.mesh.faces[g]
            gl = net.local[g]
            under_map = edge_map(gl[gface.index(a)], gl[gface.index(b)], p, q)
            foot = [apply(under_map, x) for x in gl]
            for shape in tab_shapes(p, q, style, h0, alpha):
                if not _inside_footprint(shape, foot):
                    continue
                tw = _tri_work(shape)
                if conflict(works[i], tw, (p, q)):
                    continue
                if any(conflict(o, tw, (p, q)) for o in placed[i]):
                    continue
                isl.tabs.append(NetTab(cut.number, i, f, a, b, shape, cut.fold, g, under_map))
                placed[i].append(tw)
                cut.tab_side = s
                done = True
                break
            if done:
                break
        if not done:
            untabbed.append(cut.number)
    return untabbed


def place_labels(net) -> None:
    """The cut's number inside each of its two faces, along the edge."""
    size0 = net.options["label_size"]
    for cut in net.cuts:
        for i, f, a, b in cut.sides:
            isl = net.islands[i]
            face = net.mesh.faces[f]
            poly = isl.pos[f]
            p, q = poly[face.index(a)], poly[face.index(b)]
            length = math.dist(p, q)
            d = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
            left = (-d[1], d[0])
            depth = 2.0 * area(poly) / length
            size = max(LABEL_MIN_MM, min(size0, 0.4 * length, 0.45 * depth))
            mid = ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)
            at = None
            for off in (0.5 * size + 0.6, 0.35 * size + 0.3, 0.2 * size):
                c = (mid[0] + left[0] * off, mid[1] + left[1] * off)
                if point_in_polygon(c, poly, 1e-9) == 1:
                    at = c
                    break
            if at is None:
                at = (sum(x for x, _ in poly) / len(poly), sum(y for _, y in poly) / len(poly))
            angle = math.degrees(math.atan2(d[1], d[0]))
            isl.labels.append(NetLabel(str(cut.number), i, f, at, angle, round(size, 3)))


# ── page packing ─────────────────────────────────────────────────────────────


def island_polygons(isl) -> list[list[Pt]]:
    return [isl.pos[f] for f in isl.faces] + [t.poly for t in isl.tabs]


def _grid(p: Pt) -> tuple[int, int]:
    return (round(p[0] * 1e6), round(p[1] * 1e6))


def root_first(polys: list[list[Pt]], root_index: int, turn: float) -> bool:
    """Would the arrangement list polygon `root_index` first after rotating by `turn`?

    The kernel's arrangement sorts vertices lexicographically on its grid and faces by their
    vertex-id cycles (started at their smallest id); emulating that lets the net choose an
    orientation whose root face is face 0 — the face the fold program holds still."""
    t = rotation(turn)
    rp = [[_grid(apply(t, p)) for p in poly] for poly in polys]
    ranks = {v: k for k, v in enumerate(sorted({v for poly in rp for v in poly}))}
    cycles = []
    for k, poly in enumerate(rp):
        ids = [ranks[v] for v in poly]
        m = ids.index(min(ids))
        cycles.append((ids[m:] + ids[:m], k))
    return min(cycles)[1] == root_index


def choose_turn(isl, w: float, h: float, pad: float, foot: float) -> float | None:
    polys = island_polygons(isl)
    hull = convex_hull([p for poly in polys for p in poly])
    best = None
    turns = sorted({a + e for a in orientations(hull) for e in (0.0, 90.0)}
                   | {float(e) for e in EXTRA_TURNS} | {e + 180.0 for e in EXTRA_TURNS})
    for turn in turns:
        bw, bh = rotated_size(hull, turn)
        if bw + 2 * pad > w + 1e-9 or bh + 2 * pad + foot > h + 1e-9:
            continue
        key = (0 if root_first(polys, 0, turn) else 1, round(bw * bh, 6), turn)
        if best is None or key < best:
            best = key
    return None if best is None else best[2]


def _oriented(isl, turn: float) -> tuple[float, float, Rigid2]:
    t = rotation(turn)
    pts = [apply(t, p) for poly in island_polygons(isl) for p in poly]
    x0, y0 = min(p[0] for p in pts), min(p[1] for p in pts)
    return (max(p[0] for p in pts) - x0, max(p[1] for p in pts) - y0,
            compose((1.0, 0.0, -x0, -y0), t))


def _skyline_spot(sky: list[list[float]], iw: float, ih: float, w: float, h: float):
    """Best (bottom, x, index) for an iw × ih box on a skyline [[x, depth, width], …] measured
    down from the top of the printable area, or None."""
    best = None
    for i, (x, _d, _sw) in enumerate(sky):
        if x + iw > w + 1e-9:
            break
        depth, j, reach = 0.0, i, x
        while reach < x + iw - 1e-9:
            depth = max(depth, sky[j][1])
            reach = sky[j][0] + sky[j][2]
            j += 1
        if depth + ih <= h + 1e-9 and (best is None or (depth + ih, x) < best[:2]):
            best = (depth + ih, x, depth)
    return best


def _skyline_add(sky: list[list[float]], x: float, iw: float, bottom: float) -> list[list[float]]:
    out: list[list[float]] = []
    for sx, sd, sw in sky:
        for a, b in ((sx, min(sx + sw, x)), (max(sx, x + iw), sx + sw)):
            if b - a > 1e-9:
                out.append([a, sd, b - a])
    out.append([x, bottom, iw])
    out.sort()
    merged: list[list[float]] = []
    for seg in out:
        if merged and abs(merged[-1][1] - seg[1]) < 1e-9 and \
                abs(merged[-1][0] + merged[-1][2] - seg[0]) < 1e-9:
            merged[-1][2] += seg[2]
        else:
            merged.append(seg)
    return merged


def pack(net) -> None:
    """Rotate each island to fit (its best turn or a quarter turn more) and skyline-pack the
    pieces onto pages: biggest first, each at the lowest, then leftmost, free spot."""
    from .unfold import LABEL_FOOT_MM, PIECE_GAP_MM

    pw, ph = net.page_size
    m = net.margin
    w, h = pw - 2 * m, ph - 2 * m
    items = []
    for isl in net.islands:
        turn = choose_turn(isl, w, h, PIECE_GAP_MM, LABEL_FOOT_MM)
        if turn is None:
            raise MeshError(f"piece {isl.index + 1} does not fit the printable page")
        options = []
        for t in (turn, turn + 90.0):
            bw, bh, smap = _oriented(isl, t)
            iw, ih = bw + 2 * PIECE_GAP_MM, bh + 2 * PIECE_GAP_MM + LABEL_FOOT_MM
            if iw <= w + 1e-9 and ih <= h + 1e-9:
                options.append((iw, ih, smap))
        items.append((max(o[0] * o[1] for o in options), isl, options))
    pages: list[list[list[float]]] = []
    for _area, isl, options in sorted(items, key=lambda it: (-it[0], it[1].index)):
        spot = None
        for pi, sky in enumerate(pages):
            for iw, ih, smap in options:
                found = _skyline_spot(sky, iw, ih, w, h)
                if found is not None and (spot is None or found[:2] < spot[0][:2]):
                    spot = (found, pi, iw, ih, smap)
            if spot is not None:
                break
        if spot is None:
            pages.append([[0.0, 0.0, w]])
            iw, ih, smap = options[0]
            spot = (_skyline_spot(pages[-1], iw, ih, w, h), len(pages) - 1, iw, ih, smap)
        (bottom, x, _depth), pi, iw, ih, smap = spot
        pages[pi] = _skyline_add(pages[pi], x, iw, bottom)
        isl.sheet_map = smap
        isl.page = pi
        isl.offset = (pi * (pw + PAGE_GAP_MM) + m + x + PIECE_GAP_MM,
                      m + (h - bottom) + PIECE_GAP_MM + LABEL_FOOT_MM)
    net.pages = len(pages)


def page_origins(net) -> list[Pt]:
    pw = net.page_size[0]
    return [(k * (pw + PAGE_GAP_MM), 0.0) for k in range(net.pages)]
