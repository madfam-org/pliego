"""`pliego.unfold` stage 5: a `Net` as an `Assembly` — sheets, fold program, joins, pages.

One sheet per island, laid out on its page (`pliego:pages`), with its edge numbers as sheet
annotations (`pliego:annotations`). The island's fold lines are the tree edges (mountain/valley
from the 3-D dihedral) and the tab hinges (folded to the same angle as their cut edge, so a tab
ends up in the plane of the face it is glued under).

Placement: the preview and the kernel's face-tree pose hold the arrangement's face 0 still while
the program folds the rest; each sheet's placement maps face 0's flat position onto its pose in
the model, so folding every crease to its target rebuilds the model exactly (tested).
"""

from __future__ import annotations

import math
from typing import Any

from .assembly import Assembly, Sequence, Step, control, glue, sequence_control, translate
from .mesh import newell
from .sheet import Placement, Sheet
from .space import Vec3, add, cross, norm, scale, sub, unit
from .unfold_geom import Pt, Rigid2, apply, compose, edge_map, inverse
from .unfold_layout import page_origins

MODES = ("fold", "glued")
FOLD_LINES = ("auto", "score", "crease")
EXPLODE_FRACTION = 0.6
GLUE_INSET_MM = 0.1   # the glued area stops short of the tab's outline (and of its hinge)

ASSEMBLE = {"en": "Assemble", "es": "Armar", "fr": "Monter", "pt": "Montar"}
EXPLODE = {"en": "Pull the pieces apart", "es": "Separar las piezas",
           "fr": "Écarter les pièces", "pt": "Afastar as peças"}
TABS_STEP = {"en": "Fold the glue tabs in", "es": "Dobla las pestañas hacia dentro",
             "fr": "Rabattez les languettes de collage", "pt": "Dobre as abas para dentro"}
LET_GO = {"en": "Let go: the glue holds the model",
          "es": "Suelta: el pegamento sostiene el modelo",
          "fr": "Lâchez : la colle tient le modèle",
          "pt": "Solte: a cola segura o modelo"}


def piece_label(n: int) -> dict:
    return {"en": f"Piece {n}", "es": f"Pieza {n}", "fr": f"Pièce {n}", "pt": f"Peça {n}"}


def fold_step_label(n: int) -> dict:
    return {"en": f"Fold piece {n} into shape", "es": f"Dobla la pieza {n} hasta darle forma",
            "fr": f"Pliez la pièce {n} en volume", "pt": f"Dobre a peça {n} até ganhar forma"}


def glue_note(numbers: list[int]) -> dict:
    s = ", ".join(str(k) for k in numbers)
    return {"en": f"Glue each tab under the edge with the same number: {s}.",
            "es": f"Pega cada pestaña bajo la arista con el mismo número: {s}.",
            "fr": f"Collez chaque languette sous l'arête portant le même numéro : {s}.",
            "pt": f"Cole cada aba sob a aresta com o mesmo número: {s}."}


# ── 2-D ↔ 3-D ────────────────────────────────────────────────────────────────


def _frame3(net, f: int) -> tuple[Vec3, Vec3, Vec3]:
    pts = net.mesh.face_points(f)
    n = unit(newell(pts))
    e1 = unit(sub(pts[1], pts[0]))
    return pts[0], e1, cross(n, e1)


def _local_to_3d(net, f: int, p: Pt) -> Vec3:
    o, e1, e2 = _frame3(net, f)
    return add(o, add(scale(e1, p[0]), scale(e2, p[1])))


def _polys(net, isl) -> list[tuple[list[Pt], int, Rigid2]]:
    """Every polygon of an island in sheet-local coordinates, with the face whose plane it lies
    in and the map sheet-local → that face's local frame."""
    s_inv = inverse(isl.sheet_map)
    out = []
    for f in isl.faces:
        to_isl = edge_map(net.local[f][0], net.local[f][1], isl.pos[f][0], isl.pos[f][1])
        out.append(([apply(isl.sheet_map, p) for p in isl.pos[f]], f,
                    compose(inverse(to_isl), s_inv)))
    for t in isl.tabs:
        out.append(([apply(isl.sheet_map, p) for p in t.poly], t.under,
                    compose(inverse(t.under_map), s_inv)))
    return out


def _quat(r: list[list[float]]) -> tuple[float, float, float, float]:
    """Unit quaternion [x, y, z, w] of a rotation matrix (Shepperd)."""
    tr = r[0][0] + r[1][1] + r[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = ((r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, s / 4)
    elif r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1.0 + r[0][0] - r[1][1] - r[2][2]) * 2
        q = (s / 4, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s)
    elif r[1][1] > r[2][2]:
        s = math.sqrt(1.0 + r[1][1] - r[0][0] - r[2][2]) * 2
        q = ((r[0][1] + r[1][0]) / s, s / 4, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s)
    else:
        s = math.sqrt(1.0 + r[2][2] - r[0][0] - r[1][1]) * 2
        q = ((r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, s / 4, (r[1][0] - r[0][1]) / s)
    n = math.sqrt(sum(c * c for c in q))
    q = tuple(c / n for c in q)
    return q if q[3] >= 0 else tuple(-c for c in q)  # type: ignore[return-value]


def _orthonormal(a: Vec3, b: Vec3, c: Vec3) -> list[Vec3]:
    e1 = unit(sub(b, a))
    e3 = unit(cross(e1, sub(c, a)))
    return [e1, cross(e3, e1), e3]


def placement_for(net, isl, sheet: Sheet) -> Placement:
    """The rigid placement that puts the arrangement's face 0 at its pose in the model."""
    from .geometry import Vec2, point_in_polygon
    from .mesh import ear_clip

    arr = sheet.build()
    verts = arr.vertices
    f0 = [verts[v] for v in arr.faces[0]]
    i, j, k = ear_clip([(p.x, p.y) for p in f0])[0]
    probe = Vec2((f0[i].x + f0[j].x + f0[k].x) / 3.0, (f0[i].y + f0[j].y + f0[k].y) / 3.0)
    owner = None
    for poly, face, to_local in _polys(net, isl):
        if point_in_polygon(probe, [Vec2(*p) for p in poly]) == 1:
            owner = (face, to_local)
            break
    if owner is None:
        raise ValueError(f"piece {isl.index + 1}: face 0 matches no face of the net")
    best = max(((a, b, c) for a in range(len(f0)) for b in range(a + 1, len(f0))
                for c in range(b + 1, len(f0))),
               key=lambda t: abs((f0[t[1]].x - f0[t[0]].x) * (f0[t[2]].y - f0[t[0]].y)
                                 - (f0[t[1]].y - f0[t[0]].y) * (f0[t[2]].x - f0[t[0]].x)))
    flat = [(f0[t].x, 0.0, -f0[t].y) for t in best]
    model = [_local_to_3d(net, owner[0], apply(owner[1], (f0[t].x, f0[t].y))) for t in best]
    fa, fb = _orthonormal(*flat), _orthonormal(*model)
    r = [[math.fsum(fb[c][row] * fa[c][col] for c in range(3)) for col in range(3)]
         for row in range(3)]
    ra0 = tuple(math.fsum(r[row][c] * flat[0][c] for c in range(3)) for row in range(3))
    origin = sub(model[0], ra0)
    return Placement(tuple(origin), _quat(r))  # type: ignore[arg-type]


# ── outline ──────────────────────────────────────────────────────────────────


def _key(p: Pt) -> tuple[int, int]:
    return (round(p[0] * 1e6), round(p[1] * 1e6))


def outline_of(net, isl) -> list[Pt]:
    """The island's outline: open face edges (not tree hinges), each tabbed edge replaced by
    its tab's outer path; counter-clockwise."""
    tree = {(min(a, b), max(a, b)) for _f, _g, a, b in isl.tree}
    tab_on = {(t.face, t.a, t.b): t for t in isl.tabs}
    nxt: dict[tuple[int, int], tuple[Pt, list[Pt]]] = {}
    for f in isl.faces:
        face = net.mesh.faces[f]
        pts = [apply(isl.sheet_map, p) for p in isl.pos[f]]
        for k in range(len(face)):
            a, b = face[k], face[(k + 1) % len(face)]
            if (min(a, b), max(a, b)) in tree:
                continue
            p, q = pts[k], pts[(k + 1) % len(face)]
            path: list[Pt] = []
            t = tab_on.get((f, a, b))
            if t is not None:
                poly = [apply(isl.sheet_map, x) for x in t.poly]
                ip = min(range(len(poly)), key=lambda m: math.dist(poly[m], p))
                m = (ip + 1) % len(poly)
                while math.dist(poly[m], q) > 1e-7:
                    path.append(poly[m])
                    m = (m + 1) % len(poly)
            if _key(p) in nxt:
                raise ValueError(f"piece {isl.index + 1}: the outline touches itself")
            nxt[_key(p)] = (q, path)
    start = min(nxt)
    ring: list[Pt] = []
    cur = start
    for _ in range(len(nxt)):
        q, path = nxt[cur]
        ring.append((cur[0] / 1e6, cur[1] / 1e6))
        ring.extend(path)
        cur = _key(q)
        if cur == start:
            break
    if cur != start or sum(1 for _ in ring) < 3 or len(nxt) != _count(nxt, start):
        raise ValueError(f"piece {isl.index + 1}: the outline is not a single loop")
    return ring


def _count(nxt: dict, start: tuple[int, int]) -> int:
    n, cur = 0, start
    while True:
        n += 1
        cur = _key(nxt[cur][0])
        if cur == start or n > len(nxt):
            return n


# ── the assembly ─────────────────────────────────────────────────────────────


def build_assembly(net, mode: str = "fold", *, stock: str = "cardstock-250",
                   fold_lines: str = "auto", front: Any = None, back: Any = None,
                   explode: bool = True, title: str | None = None) -> Assembly:
    """Sheets, fold program, controls, mechanisms, joins and pages for a `Net`."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if fold_lines not in FOLD_LINES:
        raise ValueError(f"fold_lines must be one of {FOLD_LINES}")
    treatment = ("score" if "card" in stock else "crease") if fold_lines == "auto" \
        else fold_lines
    sheets: list[Sheet] = []
    tree_marks: list[list] = []
    tab_marks: list[list] = []
    for isl in net.islands:
        n = isl.index + 1
        sheet = Sheet(f"piece-{n}", outline_of(net, isl), stock=stock, label=piece_label(n),
                      front=front, back=back)
        marks = []
        for f, _g, a, b in isl.tree:
            face = net.mesh.faces[f]
            p = apply(isl.sheet_map, isl.pos[f][face.index(a)])
            q = apply(isl.sheet_map, isl.pos[f][face.index(b)])
            marks.append(_crease(sheet, p, q, net.fold[(min(a, b), max(a, b))], treatment))
        tmarks = []
        tabbed = {(t.face, t.a, t.b) for t in isl.tabs}
        for t in isl.tabs:
            face = net.mesh.faces[t.face]
            p = apply(isl.sheet_map, isl.pos[t.face][face.index(t.a)])
            q = apply(isl.sheet_map, isl.pos[t.face][face.index(t.b)])
            tmarks.append(_crease(sheet, p, q, t.fold, treatment, name=f"edge-{t.cut}"))
        for cut in net.cuts:
            for i, f, a, b in cut.sides:
                if i == isl.index and (f, a, b) not in tabbed:
                    face = net.mesh.faces[f]
                    sheet.label_edge(f"edge-{cut.number}",
                                     apply(isl.sheet_map, isl.pos[f][face.index(a)]),
                                     apply(isl.sheet_map, isl.pos[f][face.index(b)]))
        turn = math.degrees(math.atan2(isl.sheet_map[1], isl.sheet_map[0]))
        for lb in isl.labels:
            sheet.text(apply(isl.sheet_map, lb.at), lb.text, angle=(lb.angle + turn + 180.0)
                       % 360.0 - 180.0, size=lb.size)
        sheet.placement = placement_for(net, isl, sheet)
        sheets.append(sheet)
        tree_marks.append(marks)
        tab_marks.append(tmarks)
    layout = {s.id: isl.offset for s, isl in zip(sheets, net.islands, strict=True)}
    pages = {"size": list(net.page_size), "margin": net.margin,
             "pages": [{"id": f"page-{k + 1}", "origin": list(o)}
                       for k, o in enumerate(page_origins(net))]}
    if mode == "fold":
        return _fold_assembly(net, sheets, tree_marks, tab_marks, layout, pages, explode, title)
    return _glued_assembly(net, sheets, tree_marks, tab_marks, layout, pages, title)


def _crease(sheet: Sheet, p: Pt, q: Pt, fold: float, treatment: str, name: str | None = None):
    if abs(fold) < 1e-9:
        return sheet.crease(p, q, "flat", 0.0, "crease", name=name)
    kind = "valley" if fold > 0 else "mountain"
    return sheet.crease(p, q, kind, abs(fold), treatment, name=name)


def _shrunk(poly: list[Pt], d: float) -> list[Pt]:
    """A convex polygon shrunk toward its centroid so its outline moves in by about d."""
    cx = math.fsum(p[0] for p in poly) / len(poly)
    cy = math.fsum(p[1] for p in poly) / len(poly)
    r = min(_dist_line((cx, cy), poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))
    k = max(0.0, 1.0 - d / r) if r > 0 else 1.0
    return [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k) for p in poly]


def _dist_line(p: Pt, a: Pt, b: Pt) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    return abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / math.hypot(dx, dy)


def _cuts_of(net, i: int) -> list[int]:
    return sorted({c.number for c in net.cuts if any(s[0] == i for s in c.sides)})


def _fold_assembly(net, sheets, tree_marks, tab_marks, layout, pages, explode, title):
    steps = []
    all_tabs = [m for ms in tab_marks for m in ms]
    if all_tabs:
        steps.append(Step("fold-tabs", TABS_STEP, [(m, None) for m in all_tabs],
                          duration_ms=1500))
    for isl, marks in zip(net.islands, tree_marks, strict=True):
        if marks:
            n = isl.index + 1
            cuts = _cuts_of(net, isl.index)
            steps.append(Step(f"fold-piece-{n}", fold_step_label(n), [(m, None) for m in marks],
                              duration_ms=2000, note=glue_note(cuts) if cuts else None))
    if not steps:
        raise ValueError("the net has no fold to program")
    controls = [sequence_control(label=ASSEMBLE)]
    mechanisms = []
    if explode and len(sheets) > 1:
        lo, hi = net.mesh.bounds()
        size = max(hi[i] - lo[i] for i in range(3))
        travel = round(EXPLODE_FRACTION * size, 3)
        centre = tuple((lo[i] + hi[i]) / 2.0 for i in range(3))
        controls.append(control("explode", "distance", EXPLODE, 0.0, 0.0, travel, "mm"))
        for s, isl in zip(sheets, net.islands, strict=True):
            c = [net.mesh.centroid(f) for f in isl.faces]
            mid = tuple(math.fsum(p[i] for p in c) / len(c) for i in range(3))
            d = sub(mid, centre)
            direction = unit(d) if norm(d) > 1e-9 else (0.0, 1.0, 0.0)
            mechanisms.append(translate(f"explode-{s.id}", "explode",
                                        [round(x, 9) for x in direction], travel, [s]))
    return Assembly(sheets, [], mechanisms, controls, Sequence(steps, mode="kinematic"),
                    layout=layout, title=title, pages=pages)


def _glued_assembly(net, sheets, tree_marks, tab_marks, layout, pages, title):
    joins = []
    for isl, s in zip(net.islands, sheets, strict=True):
        s_inv = inverse(isl.sheet_map)
        for t in isl.tabs:
            cut = net.cuts[t.cut - 1]
            other = next(side for side in cut.sides if side[1] == t.under)
            bisl = net.islands[other[0]]
            gl = net.local[t.under]
            g_to_b = edge_map(gl[0], gl[1], bisl.pos[t.under][0], bisl.pos[t.under][1])
            m = compose(bisl.sheet_map, compose(g_to_b, compose(inverse(t.under_map), s_inv)))
            c, sn, tx, ty = m
            region = _shrunk([apply(isl.sheet_map, p) for p in t.poly], GLUE_INSET_MM)
            joins.append(glue(f"glue-{t.cut}", s, region, sheets[other[0]],
                              (c, -sn, sn, c, tx, ty), side="back"))
    initial = {s.id: {"angles": {m: m.fold_angle for m in tm + bm}}
               for s, tm, bm in zip(sheets, tree_marks, tab_marks, strict=True)}
    every = [m for ms in tree_marks + tab_marks for m in ms]
    steps = [Step("let-go", LET_GO, [], release=every, duration_ms=2000)]
    return Assembly(sheets, joins, [], [sequence_control(label=ASSEMBLE)],
                    Sequence(steps, mode="physical"), initial=initial, layout=layout,
                    title=title, pages=pages)
