"""`pliego.reveal` — reveal blocks: a scene sliced into a stack of pre-cut sheets.

A reveal block (a memo-block sculpture) is a pad of identical sheets. Every sheet is cut along
its layer's cross-section of a 3-D scene; as the sheets are torn away from the top, the cut-out
material of each layer stays behind and the scene appears as a stepped relief. `slice_block`
does the slicing:

1. the scene (a heightfield or a CSG of `sphere` / `box` / `cylinder` / `cone`, see
   `pliego.reveal_scene`) is sampled per layer on a grid at mid-layer height;
2. the inside mask is opened and closed with a structuring element of the minimum feature size
   (thin spikes, necks, slits and specks below it disappear), and kept at least `margin` mm from
   the block's edge, so the excess always forms a tearable frame;
3. marching squares (saddles resolved by the cell centre) traces the cross-section contours,
   which are simplified, checked simple and cut into the sheet (`cut`, `perforation` or
   `halfcut`);
4. tear lines (a perforated grid, `tear_grid` chunks per side) split the excess so every chunk
   can slide out even under an overhang;
5. every separable region becomes a `keep` or `excess` piece (spec §5.8), the sheets form a
   `stack` at `represents × caliper` pitch, and the fold program tears the excess away layer by
   layer from the top (one `remove` step per layer).

A preview keeps documents small by letting each sheet stand for `represents` real sheets; the
fabrication setting slices every real sheet (`represents = 1`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .assembly import Assembly, Sequence, Step, sequence_control
from .geometry import (
    Vec2,
    dist_point_segment,
    is_simple_polygon,
    point_in_polygon,
    polygon_area,
    segments_touch,
)
from .geometry import simplify as _dp
from .pieces import arrangement_regions, interior_point, piece, stack
from .reveal_scene import (  # noqa: F401 - re-exported: pliego.reveal.sphere(...)
    Heightfield,
    Scene,
    _union_value,
    box,
    cone,
    cylinder,
    heightfield,
    intersect,
    sphere,
    subtract,
    union,
)
from .sheet import Placement, Sheet

CUT_KINDS = ("cut", "perforation", "halfcut")
TEAR_KINDS = ("perforation", "cut")
L4 = ("en", "es", "fr", "pt")
LAYOUT_GAP_MM = 10.0
REVEAL_LABEL = {"en": "Reveal", "es": "Revelar", "fr": "Révéler", "pt": "Revelar"}


@dataclass
class RevealBlock:
    """The sliced block: `assembly` (the document's Assembly), per-layer info and a report."""

    assembly: Assembly
    sheets: list[Sheet]
    layers: list[dict] = field(default_factory=list)
    report: dict = field(default_factory=dict)


# ── grid sampling and morphology ─────────────────────────────────────────────


def _axis(length: float, step: float) -> list[float]:
    n = max(2, math.ceil(length / step))
    return [length * k / n for k in range(n + 1)]


def _shift(rows: list[int], full: int, grow: bool) -> list[int]:
    """One dilation (grow) or erosion of a bit-row mask by a 3 × 3 square of nodes (a square
    keeps the corners of axis-aligned shapes — towers, terraces — instead of chamfering them)."""
    if grow:
        h = [(m | (m << 1) | (m >> 1)) & full for m in rows]
    else:
        h = [m & (m << 1) & (m >> 1) & full for m in rows]
    out = []
    n = len(h)
    for r, m in enumerate(h):
        up = h[r + 1] if r + 1 < n else 0
        dn = h[r - 1] if r > 0 else 0
        out.append((m | up | dn) if grow else (m & up & dn))
    return out


def _clean(rows: list[int], full: int, k: int) -> list[int]:
    """Opening then closing by a square of 2k + 1 nodes (removes features under ~2k nodes)."""
    for grow_first in (False, True):
        for _ in range(k):
            rows = _shift(rows, full, grow_first)
        for _ in range(k):
            rows = _shift(rows, full, not grow_first)
    return rows


# ── marching squares ─────────────────────────────────────────────────────────


def _contours(xs: list[float], ys: list[float], val: list[list[float]], rows: list[int]
              ) -> list[list[Vec2]]:
    """Closed contours of the mask (inside on the left: keep boundaries CCW, holes CW)."""
    nx = len(xs) - 1
    cell_bits = (1 << nx) - 1
    cache: dict[tuple, Vec2] = {}

    def crossing(key: tuple) -> Vec2:
        p = cache.get(key)
        if p is None:
            kind, r, c = key
            r2, c2 = (r, c + 1) if kind == "h" else (r + 1, c)
            v0, v1 = val[r][c], val[r2][c2]
            t = min(0.999, max(0.001, v0 / (v0 - v1)))
            p = Vec2(xs[c] + (xs[c2] - xs[c]) * t, ys[r] + (ys[r2] - ys[r]) * t)
            cache[key] = p
        return p

    nxt: dict[tuple, tuple] = {}
    for r in range(len(ys) - 1):
        a, b = rows[r], rows[r + 1]
        mixed = ((a ^ (a >> 1)) | (b ^ (b >> 1)) | (a ^ b)) & cell_bits
        while mixed:
            low = mixed & -mixed
            c = low.bit_length() - 1
            mixed ^= low
            corner = [(c, r), (c + 1, r), (c + 1, r + 1), (c, r + 1)]
            ins = [bool((rows[rr] >> cc) & 1) for cc, rr in corner]
            edges = [("h", r, c), ("v", r, c + 1), ("h", r + 1, c), ("v", r, c)]
            crossed = [k for k in range(4) if ins[k] != ins[(k + 1) % 4]]
            if len(crossed) == 2:
                pairs = [(crossed[0], crossed[1], next(k for k in range(4) if ins[k]), True)]
            else:  # saddle: cut off the corners not joined through the centre
                centre = sum(val[rr][cc] for cc, rr in corner) / 4.0
                cut = [k for k in range(4) if ins[k] != (centre < 0)]
                pairs = [((k - 1) % 4, k, k, ins[k]) for k in cut]
            for e1, e2, ref, ref_inside in pairs:
                p, q = crossing(edges[e1]), crossing(edges[e2])
                cc, rr = corner[ref]
                left = (q.x - p.x) * (ys[rr] - p.y) - (q.y - p.y) * (xs[cc] - p.x) > 0
                k1, k2 = edges[e1], edges[e2]
                if left != ref_inside:
                    k1, k2 = k2, k1
                nxt[k1] = k2
    loops: list[list[Vec2]] = []
    seen: set = set()
    for start in nxt:
        if start in seen:
            continue
        ring, k = [], start
        while k not in seen:
            seen.add(k)
            ring.append(cache[k])
            k = nxt[k]
        if len(ring) >= 3:
            loops.append(ring)
    return loops


def _simplify_ring(ring: list[Vec2], tol: float) -> list[Vec2]:
    if tol <= 0 or len(ring) < 8:
        return ring
    far = max(range(len(ring)), key=lambda i: ring[i].distance(ring[0]))
    a = _dp(ring[: far + 1], tol)
    b = _dp(ring[far:] + [ring[0]], tol)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 and is_simple_polygon(out) else ring


def _loops_touch(a: list[Vec2], b: list[Vec2]) -> bool:
    ax0, ax1 = min(p.x for p in a), max(p.x for p in a)
    bx0, bx1 = min(p.x for p in b), max(p.x for p in b)
    ay0, ay1 = min(p.y for p in a), max(p.y for p in a)
    by0, by1 = min(p.y for p in b), max(p.y for p in b)
    if ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0:
        return False
    return any(segments_touch(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)])
               for i in range(len(a)) for j in range(len(b)))


def _parity(p: Vec2, loops: list[list[Vec2]]) -> bool:
    return sum(1 for lp in loops if point_in_polygon(p, lp) == 1) % 2 == 1


# ── tear lines ───────────────────────────────────────────────────────────────


def _tear_segments(loops: list[list[Vec2]], w: float, d: float, grid: int, dx: float,
                   min_len: float) -> list[tuple[Vec2, Vec2]]:
    """Excess-only intervals of a `grid` × `grid` line pattern (shifted off contour vertices)."""
    segs: list[tuple[Vec2, Vec2]] = []
    pts = [p for lp in loops for p in lp]
    for vertical in (True, False):
        length, other = (w, d) if vertical else (d, w)
        for k in range(1, grid):
            base = length * k / grid
            cands = [base + s * dx * 0.5 for s in (0, 1, -1, 2, -2, 3, -3, 4, -4)]
            c = max(cands, key=lambda cc: min((abs((p.x if vertical else p.y) - cc)
                                               for p in pts), default=length))
            ts = []
            for lp in loops:
                for i in range(len(lp)):
                    a, b = lp[i], lp[(i + 1) % len(lp)]
                    ua, ub = (a.x, b.x) if vertical else (a.y, b.y)
                    if (ua < c) != (ub < c):
                        va, vb = (a.y, b.y) if vertical else (a.x, b.x)
                        ts.append(va + (c - ua) * (vb - va) / (ub - ua))
            ts = [0.0, *sorted(ts), other]
            for i in range(0, len(ts) - 1, 2):  # even intervals lie in the excess
                t0, t1 = ts[i], ts[i + 1]
                if t1 - t0 < min_len:
                    continue
                segs.append((Vec2(c, t0), Vec2(c, t1)) if vertical
                            else (Vec2(t0, c), Vec2(t1, c)))
    return segs


# ── the slicer ───────────────────────────────────────────────────────────────


def _labels(i: int, n: int, rep: int) -> tuple[dict, dict]:
    sheet = {"en": f"Layer {i + 1} of {n}", "es": f"Capa {i + 1} de {n}",
             "fr": f"Couche {i + 1} sur {n}", "pt": f"Camada {i + 1} de {n}"}
    top = (n - 1 - i) * rep + 1          # real sheets counted from the top of the pad
    if rep == 1:
        step = {"en": f"Tear away sheet {top}", "es": f"Arranca la hoja {top}",
                "fr": f"Arrachez la feuille {top}", "pt": f"Destaque a folha {top}"}
    else:
        last = top + rep - 1
        step = {"en": f"Tear away sheets {top}–{last}", "es": f"Arranca las hojas {top}–{last}",
                "fr": f"Arrachez les feuilles {top} à {last}",
                "pt": f"Destaque as folhas {top}–{last}"}
    return sheet, step


def _layer_sheet(sid: str, label: dict, size: tuple[float, float], stock: str, y: float,
                 loops: list[list[Vec2]], tears: list[tuple[Vec2, Vec2]], contour: str,
                 tear: str) -> Sheet:
    w, d = size
    sheet = Sheet(sid, [(0.0, 0.0), (w, 0.0), (w, d), (0.0, d)], stock=stock, label=label,
                  placement=Placement(origin=(0.0, y, 0.0)))
    for ring in loops:
        closed = ring + [ring[0]]
        if contour == "cut":
            sheet.cut(closed)
        elif contour == "perforation":
            sheet.path(closed, kind="cut", treatment="perforation")
        else:
            sheet.halfcut(closed)
    for p, q in tears:
        if tear == "perforation":
            sheet.perforate(p, q, kind="cut")
        else:
            sheet.cut([p, q])
    return sheet


def _caliper(stock: str) -> float:
    from .document_build import resolve_stock

    snap = resolve_stock(stock, None)
    cal = snap.get("caliper_mm")
    if not isinstance(cal, int | float) or cal <= 0:
        raise ValueError(f"stock '{stock}' has no caliper_mm")
    return float(cal)


def slice_block(scene: Scene, *, size: tuple[float, float] = (70.0, 70.0),
                height: float = 50.0, layers: int = 40, stock: str = "copy-80",
                caliper: float | None = None, fabrication: bool = False,
                min_feature: float = 2.0, resolution: float | None = None,
                margin: float = 4.0, tear_grid: int = 2, contour: str = "cut",
                tear: str = "perforation", spine: bool = True, prefix: str = "layer",
                step_ms: int = 400, title: str | None = None) -> RevealBlock:
    """Slice `scene` (block mm, z up from the bottom) into a reveal block of `size` × `height`.

    `layers`: document sheets in a preview (each stands for `represents` real sheets);
    `fabrication=True` slices every real sheet (height / caliper of `stock`). `min_feature` (mm)
    is the smallest kept bridge or removed slit; the grid step defaults to half of it.
    `tear_grid`: excess chunks per side (1 = no tear lines). `contour`: cut | perforation |
    halfcut; `tear`: perforation | cut. `spine`: pad the back edge (v = depth)."""
    w, d = float(size[0]), float(size[1])
    if not (w > 0 and d > 0 and height > 0 and math.isfinite(w + d + height)):
        raise ValueError("block size and height must be positive")
    if contour not in CUT_KINDS or tear not in TEAR_KINDS:
        raise ValueError(f"contour must be one of {CUT_KINDS}, tear one of {TEAR_KINDS}")
    if not 1 <= int(tear_grid) <= 8:
        raise ValueError("tear_grid must be 1…8")
    mf = float(min_feature)
    if not mf > 0:
        raise ValueError("min_feature must be > 0")
    cal = float(caliper) if caliper is not None else _caliper(stock)
    real = max(2, round(height / cal))
    if fabrication:
        n, rep = real, 1
    else:
        n = max(2, min(int(layers), real))
        rep = max(1, round(real / n))
    pitch = rep * cal
    z_scale = height / (n * pitch)       # sample the scene over the requested height
    dx = float(resolution) if resolution is not None else mf / 2.0
    margin = max(float(margin), 2.0 * mf)
    xs, ys = _axis(w, dx), _axis(d, dx)
    nx, step = len(xs) - 1, min(xs[1], ys[1])
    full = (1 << (nx + 1)) - 1
    k_morph = max(1, round(mf / (2.0 * step)))
    edge_room = [[margin - min(x, w - x, y, d - y) for x in xs] for y in ys]
    hf = [[scene.height(x, y) for x in xs] for y in ys] if isinstance(scene, Heightfield) else None
    # far from every part a node is simply outside; within `pad` of a part it is evaluated
    # exactly, so every crossing next to material is interpolated from true values
    pad, far = 2.0 * step, 2.0 * step
    parts = scene.parts if getattr(scene, "op", None) == "union" else None
    b = scene.bounds
    tol = 0.2 * step
    cols = max(1, math.ceil(math.sqrt(n)))
    sheets: list[Sheet] = []
    pieces: list[dict] = []
    removals: list[list[str]] = []
    info: list[dict] = []
    prev_rows: list[int] | None = None
    overhang = dropped_loops = dropped_tears = small_regions = 0
    for i in range(n):
        z = (i + 0.5) * pitch * z_scale
        empty = b is not None and not (b[2] - pad <= z <= b[5] + pad)
        active = None if parts is None else [p for p in parts if p.bounds is None or (
            p.bounds[2] - pad <= z <= p.bounds[5] + pad)]
        val: list[list[float]] = []
        rows: list[int] = []
        for r, y in enumerate(ys):
            row_v, bits = [], 0
            room = edge_room[r]
            near = None if active is None else [p for p in active if p.bounds is None or (
                p.bounds[1] - pad <= y <= p.bounds[4] + pad)]
            for c, x in enumerate(xs):
                if empty or (b is not None and not (b[0] - pad <= x <= b[3] + pad
                                                    and b[1] - pad <= y <= b[4] + pad)):
                    v = far
                elif hf is not None:
                    v = z - hf[r][c]
                elif near is not None:
                    here = [p for p in near if p.bounds is None or (
                        p.bounds[0] - pad <= x <= p.bounds[3] + pad)]
                    v = _union_value(here, x, y, z) if here else far
                else:
                    v = scene.value(x, y, z)
                v = max(v, room[c])
                if v < 0:
                    bits |= 1 << c
                elif v == 0:
                    v = 1e-9
                row_v.append(v)
            val.append(row_v)
            rows.append(bits)
        clean = _clean(rows, full, k_morph) if any(rows) else rows
        for r in range(len(ys)):
            changed = clean[r] ^ rows[r]
            while changed:
                low = changed & -changed
                c = low.bit_length() - 1
                changed ^= low
                val[r][c] = -0.25 * step if (clean[r] >> c) & 1 else 0.25 * step
        if prev_rows is not None and any(cr & ~pr for cr, pr in zip(clean, prev_rows,
                                                                    strict=True)):
            overhang += 1
        prev_rows = clean
        raw = _contours(xs, ys, val, clean) if any(clean) else []
        loops = []
        for ring in raw:
            simple = _simplify_ring(ring, tol)
            # specks at the minimum feature: a little room over mf² so no face lands under the
            # document's area floor (spec §8.3) after simplification
            if min(abs(polygon_area(ring)), abs(polygon_area(simple))) < 1.5 * mf * mf:
                dropped_loops += 1
                continue
            loops.append((ring, simple))
        final = [s for _, s in loops]
        for a in range(len(final)):
            for c2 in range(a + 1, len(final)):
                if _loops_touch(final[a], final[c2]):
                    final[a], final[c2] = loops[a][0], loops[c2][0]
        s_label = _labels(i, n, rep)[0]
        tears = (_tear_segments(final, w, d, int(tear_grid), step, 2.0 * mf)
                 if final and tear_grid > 1 else [])
        for _attempt in range(3):
            sheet = _layer_sheet(f"{prefix}-{i + 1:03d}", s_label, (w, d), stock,
                                 (i + 0.5) * pitch, final, tears, contour, tear)
            arr = sheet.build()
            verts = arr.vertices
            regs = arrangement_regions(arr)
            small = [reg for reg in regs if math.fsum(
                polygon_area([verts[v] for v in arr.faces[f]]) for f in reg) < mf * mf]
            if not small or not tears:
                break
            near = [verts[v] for reg in small for f in reg for v in arr.faces[f]]
            bad = {k for k, (p, q) in enumerate(tears)
                   if any(dist_point_segment(sp, p, q) < 1e-5 for sp in near)}
            if not bad:
                break
            dropped_tears += len(bad)
            tears = [t for k, t in enumerate(tears) if k not in bad]
        small_regions += len(small)
        keep_n = exc_n = 0
        layer_removals: list[str] = []
        for reg in regs:
            ring = [verts[v] for v in arr.faces[reg[0]]]
            keep = bool(final) and _parity(interior_point(ring), final)
            if keep:
                keep_n += 1
                pid = f"{sheet.id}-keep-{keep_n}"
            else:
                exc_n += 1
                pid = f"{sheet.id}-excess-{exc_n}"
                layer_removals.append(pid)
            pieces.append(piece(pid, sheet, faces=reg, role="keep" if keep else "excess"))
        sheets.append(sheet)
        removals.append(layer_removals)
        info.append({"sheet": sheet.id, "z_mm": (i + 0.5) * pitch, "loops": len(final),
                     "tears": len(tears), "keep": keep_n, "excess": exc_n,
                     "vertices": len(verts)})
    steps = []
    for i in range(n - 1, -1, -1):
        if removals[i]:
            steps.append(Step(f"tear-{sheets[i].id}", _labels(i, n, rep)[1],
                              duration_ms=int(step_ms), remove=removals[i]))
    layout = {s.id: ((k % cols) * (w + LAYOUT_GAP_MM), (k // cols) * (d + LAYOUT_GAP_MM))
              for k, s in enumerate(sheets)}
    stk = stack("block", sheets, pitch, represents=rep, bond="keep",
                binding=((0.0, d), (w, d)) if spine else None)
    assembly = Assembly(sheets, controls=[sequence_control("reveal", REVEAL_LABEL)],
                        sequence=Sequence(steps) if steps else None, layout=layout,
                        title=title, min_feature_mm=mf, pieces=pieces, stacks=[stk])
    report = {"layers": n, "represents": rep, "real_sheets": n * rep, "caliper_mm": cal,
              "pitch_mm": pitch, "height_mm": n * pitch, "grid_mm": step,
              "min_feature_mm": mf, "margin_mm": margin,
              "keep_pieces": sum(x["keep"] for x in info),
              "excess_pieces": sum(x["excess"] for x in info),
              "vertices": sum(x["vertices"] for x in info), "overhang_layers": overhang,
              "dropped_loops": dropped_loops, "dropped_tears": dropped_tears,
              "small_regions": small_regions,
              "steps": len(steps)}
    return RevealBlock(assembly, sheets, info, report)


def bridge_report(block: RevealBlock, sample: int = 8) -> dict:
    """Narrowest kept bridge and removed slit over up to `sample` evenly spaced layers
    (`pliego.papercut.analyze`; its island count is expected — the pieces are separate)."""
    from .papercut import analyze

    sheets = [s for s in block.sheets if s.marks]
    if not sheets:
        return {"layers_checked": 0, "min_bridge_mm": None, "min_gap_mm": None}
    k = max(1, len(sheets) // max(1, sample))
    bridge = gap = None
    checked = 0
    mf = block.report.get("min_feature_mm", 1.0)
    for s in sheets[::k][:sample]:
        rep = analyze(s, mf)
        checked += 1
        if rep.min_bridge_mm is not None:
            bridge = rep.min_bridge_mm if bridge is None else min(bridge, rep.min_bridge_mm)
        if rep.min_gap_mm is not None:
            gap = rep.min_gap_mm if gap is None else min(gap, rep.min_gap_mm)
    return {"layers_checked": checked, "min_bridge_mm": bridge, "min_gap_mm": gap}


__all__ = ["RevealBlock", "bridge_report", "box", "cone", "cylinder", "heightfield",
           "intersect", "slice_block", "sphere", "subtract", "union"]

