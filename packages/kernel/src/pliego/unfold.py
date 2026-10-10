"""`pliego.unfold` — a polygon mesh unfolded into printable papercraft nets (mode J2).

`net(mesh, size=…, page=…)` returns a `Net`:

1. **Scale.** The mesh is scaled uniformly so its largest extent is `size` mm, centred on the
   Y axis and standing on the ground (y = 0). Faces that are not planar are triangulated.
2. **Cut tree, greedily, with overlap checks.** Interior edges are candidate folds, ordered by a
   heuristic — `min-perimeter` (long edges first: the cut perimeter, and so the gluing, is kept
   short) or `steepest-edge` (Schlickenrieder's steepest-edge cut tree: at every vertex the edge
   climbing most steeply toward a fixed direction is cut; the other edges are folds). Kruskal
   joins the two pieces an edge separates by unfolding one onto the other about that edge — only
   when the joined piece does not overlap itself (inset-triangle separating-axis test plus a pinch
   test) and still fits the printable page. Edges never joined are cuts, so a net that would
   overlap is split into islands.
3. **Tabs, numbers, folds** (`unfold_layout`): every cut edge gets a matching number printed on
   both sides; a glue tab goes on one side, alternating by number, a trapezoid (or triangle)
   within the side-angle limit that never overlaps its own net, its other tabs, or leaves the
   footprint of the face it is glued under. Mountain/valley comes from the sign of the 3-D
   dihedral (printed side = outside, so convex edges are mountain folds).
4. **Pages.** Islands are rotated to fit and shelf-packed onto A4 or US Letter pages with margins.
5. `Net.assembly(mode)` (`unfold_build`) writes one sheet per island. Mode `fold`: a kinematic
   program folds every island from flat into its 3-D pose (tab hinges first, then one step per
   piece); an `explode` control pulls the pieces apart. Mode `glued`: the assembled model as the
   initial frame with a glue join under every tab, for the physics engine.

Every island's crease pattern is a tree of hinges with no interior vertex (each mesh vertex inside
an island keeps at least one cut), so any fold-angle state is rigid and the kinematic program is
exact. Deterministic throughout: authored order, explicit tie-breaks, no randomness.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .mesh import Mesh, MeshError, newell
from .space import cross, dot, norm, sub, unit
from .unfold_geom import (
    JOINT_MM,
    PINCH_MM,
    Pt,
    Rigid2,
    apply,
    bbox,
    boxes_meet,
    convex_hull,
    dist_point_segment,
    edge_map,
    fits,
    inset_triangle,
    triangles_overlap,
)

PAGE_SIZES_MM = {"a4": (210.0, 297.0), "letter": (215.9, 279.4)}
METHODS = ("min-perimeter", "steepest-edge")
TAB_STYLES = ("trapezoid", "triangle", "none")
LABEL_FOOT_MM = 8.0     # room below each piece for its printed name
PIECE_GAP_MM = 2.0      # clearance around each piece on the page
STEEPEST_DIR = (0.08, 1.0, 0.05)   # slightly off-axis so no two edges tie
MIN_FACE_MM2 = 1.0


@dataclass
class Island:
    """One connected piece of the net (one sheet)."""

    index: int
    faces: list[int]                          # mesh faces, root first, then BFS order
    pos: dict[int, list[Pt]]                  # face → 2-D points (mesh face order)
    tree: list[tuple[int, int, int, int]]     # (parent face, child face, a, b): fold edge a–b
    root: int
    tabs: list[Any] = field(default_factory=list)
    labels: list[Any] = field(default_factory=list)
    sheet_map: Rigid2 = (1.0, 0.0, 0.0, 0.0)   # island frame → sheet-local
    page: int = 0
    offset: Pt = (0.0, 0.0)                    # layout-frame offset of the sheet


@dataclass
class Cut:
    """A cut edge: number k, mesh edge (lo, hi), its two sides and fold angle (deg)."""

    number: int
    key: tuple[int, int]
    sides: list[tuple[int, int, int, int]]    # (island, face, a, b) with a→b CCW on face
    fold: float
    tab_side: int | None = None


@dataclass
class Net:
    """The unfolded model: scaled mesh, islands, cuts, pages and a report."""

    mesh: Mesh
    local: list[list[Pt]]                     # face-local 2-D coordinates
    fold: dict[tuple[int, int], float]        # interior edge → fold angle (deg)
    islands: list[Island]
    cuts: list[Cut]
    page: str
    page_size: tuple[float, float]
    margin: float
    pages: int = 0
    options: dict = field(default_factory=dict)
    report: dict = field(default_factory=dict)

    def assembly(self, mode: str = "fold", **kw: Any):
        """The `pliego.Assembly` of this net — mode `fold` (kinematic fold-up program, explode
        control) or `glued` (assembled initial frame, glue joins, physical release)."""
        from .unfold_build import build_assembly

        return build_assembly(self, mode, **kw)

    def summary(self) -> str:
        r = self.report
        return (f"unfold: faces={r['faces']} islands={r['islands']} cuts={r['cuts']} "
                f"tabs={r['tabs']} untabbed={len(r['untabbed'])} pages={r['pages']} "
                f"size={r['size_mm']}mm method={r['method']}")


# ── the face geometry ────────────────────────────────────────────────────────


def face_frame(mesh: Mesh, f: int) -> list[Pt]:
    """Face f in its own plane: first edge on +x, counter-clockwise (outside = front)."""
    pts = mesh.face_points(f)
    n = unit(newell(pts))
    e1 = unit(sub(pts[1], pts[0]))
    e2 = cross(n, e1)
    return [(dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)) for p in pts]


def fold_angle(mesh: Mesh, f: int, g: int, a: int, b: int) -> float:
    """Signed fold angle (deg, FOLD convention, printed side = outside) of edge a→b of face f
    shared with face g: negative (mountain) on a convex edge, positive (valley) on a concave
    one, 0 between coplanar faces."""
    nf, ng = mesh.normal(f), mesh.normal(g)
    t = unit(sub(mesh.vertices[b], mesh.vertices[a]))
    return math.degrees(math.atan2(dot(cross(t, ng), nf), dot(nf, ng)))


def prepare(mesh: Mesh, size: float) -> Mesh:
    """Scaled to `size` mm (largest extent), centred on the Y axis, standing on y = 0;
    non-planar faces triangulated. Fails loud on a broken or inside-out mesh."""
    mesh.check()
    lo, hi = mesh.bounds()
    ext = max(hi[i] - lo[i] for i in range(3))
    if ext <= 0:
        raise MeshError("the mesh has no extent")
    k = size / ext
    cx, cz = (lo[0] + hi[0]) / 2.0, (lo[2] + hi[2]) / 2.0
    m = mesh.mapped(lambda p: ((p[0] - cx) * k, (p[1] - lo[1]) * k, (p[2] - cz) * k))
    m = m.triangulated().check()
    if m.is_closed() and m.signed_volume() <= 0:
        raise MeshError("the mesh is inside out (faces must be counter-clockwise from outside)")
    for f in range(len(m.faces)):
        if m.area(f) < MIN_FACE_MM2:
            raise MeshError(f"face {f} would be {m.area(f):.2f} mm² at {size} mm (< 1 mm²): "
                            "enlarge the model or use fewer faces")
    return m


# ── greedy cut tree with overlap checks ─────────────────────────────────────


@dataclass
class _Work:
    faces: list[int]
    pos: dict[int, list[Pt]]
    tris: list[tuple[tuple[Pt, Pt, Pt], tuple[float, float, float, float]]]
    verts: list[Pt]
    segs: list[tuple[Pt, Pt]]
    box: tuple[float, float, float, float]
    tree: list[tuple[int, int, int, int]]
    zones: list[tuple[tuple[int, int], tuple[Pt, Pt, Pt], tuple]] = field(default_factory=list)


def _work_for(faces: list[int], pos: dict[int, list[Pt]], tri_idx: list[list[tuple]],
              tree: list, zones: dict | None = None, local: list | None = None) -> _Work:
    """Overlap-test data of a piece: inset triangles, vertices, edges and, when given, the
    reserved tab zones of its open edges (face-local `zones` mapped through `local`)."""
    tris, verts, segs, zs = [], [], [], []
    seen: set[tuple[float, float]] = set()
    joined = {(min(a, b), max(a, b)) for _f, _g, a, b in tree}
    for f in faces:
        pts = pos[f]
        for i, j, k in tri_idx[f]:
            t = inset_triangle((pts[i], pts[j], pts[k]))
            if t is not None:
                tris.append((t, bbox(t)))
        for i, p in enumerate(pts):
            key = (round(p[0], 6), round(p[1], 6))
            if key not in seen:
                seen.add(key)
                verts.append(p)
            segs.append((p, pts[(i + 1) % len(pts)]))
        if zones and local is not None:
            to_island = edge_map(local[f][0], local[f][1], pts[0], pts[1])
            for key, tri in zones.get(f, ()):
                if key in joined:
                    continue
                t = inset_triangle(tuple(apply(to_island, p) for p in tri))
                if t is not None:
                    zs.append((key, t, bbox(t)))
    allp = [p for f in faces for p in pos[f]]
    return _Work(faces, pos, tris, verts, segs, bbox(allp), tree, zs)


def conflict(a: _Work, b: _Work, joint: tuple[Pt, ...] = (),
             joint_key: tuple[int, int] | None = None) -> bool:
    """True when piece b overlaps or pinches piece a (both in one frame), or covers a tab zone
    the other keeps free. Points within `JOINT_MM` of a `joint` point (the hinge ends) are
    exempt from the pinch test; the zones of the hinge edge `joint_key` are dropped."""
    if not boxes_meet(a.box, b.box, PINCH_MM):
        return False
    for tb, bb in b.tris:
        if not boxes_meet(bb, a.box):
            continue
        for ta, ba in a.tris:
            if boxes_meet(ba, bb) and triangles_overlap(ta, tb):
                return True
    for x, y in ((a, b), (b, a)):
        for key, tz, bz in x.zones:
            if key == joint_key or not boxes_meet(bz, y.box):
                continue
            for ty, by in y.tris:
                if boxes_meet(by, bz) and triangles_overlap(ty, tz):
                    return True

    def free(p: Pt) -> bool:
        return all(math.dist(p, j) > JOINT_MM for j in joint)

    for x, y in ((a, b), (b, a)):
        for p in y.verts:
            if not free(p) or not boxes_meet((p[0], p[1], p[0], p[1]), x.box, PINCH_MM):
                continue
            for q in x.verts:
                if free(q) and math.dist(p, q) < PINCH_MM:
                    return True
            for s0, s1 in x.segs:
                if dist_point_segment(p, s0, s1) < PINCH_MM and not (
                        math.dist(p, s0) < PINCH_MM or math.dist(p, s1) < PINCH_MM):
                    return True
    return False


def tab_zones(mesh: Mesh, local: list[list[Pt]], height: float, angle: float) -> dict:
    """face → [(edge key, triangle)]: the room each interior edge keeps free outside the face
    for a tab (face-local frame) — a triangle within the side-angle limit and inside the
    neighbour's footprint unfolded across the edge."""
    from .unfold_layout import _inside_footprint, tab_shapes

    out: dict[int, list] = {}
    for key, uses in mesh.edges().items():
        if len(uses) != 2:
            continue
        for (f, k), (g, _m) in (tuple(uses), tuple(reversed(uses))):
            face, gface = mesh.faces[f], mesh.faces[g]
            a, b = face[k], face[(k + 1) % len(face)]
            p, q = local[f][k], local[f][(k + 1) % len(face)]
            to_f = edge_map(local[g][gface.index(a)], local[g][gface.index(b)], p, q)
            foot = [apply(to_f, x) for x in local[g]]
            for shape in tab_shapes(p, q, "triangle", height, angle):
                if _inside_footprint(shape, foot):
                    out.setdefault(f, []).append((key, tuple(shape)))
                    break
    return out


def _candidates(mesh: Mesh, edges: dict, method: str) -> list[tuple[int, int, int, int, int]]:
    """Interior edges as (f, g, a, b, key-order) in heuristic order; a→b runs CCW on f."""
    items = []
    preferred_cut: set[tuple[int, int]] = set()
    if method == "steepest-edge":
        c = unit(STEEPEST_DIR)
        nbr: dict[int, list[int]] = {}
        boundary = {v for (lo, hi), uses in edges.items() if len(uses) == 1 for v in (lo, hi)}
        for lo, hi in edges:
            nbr.setdefault(lo, []).append(hi)
            nbr.setdefault(hi, []).append(lo)
        top = max(range(len(mesh.vertices)), key=lambda v: (dot(mesh.vertices[v], c), -v))
        for v in sorted(nbr):
            if v == top or v in boundary:
                continue
            best = max(nbr[v], key=lambda w: (dot(sub(mesh.vertices[w], mesh.vertices[v]), c)
                                              / norm(sub(mesh.vertices[w], mesh.vertices[v])),
                                              -w))
            if dot(sub(mesh.vertices[best], mesh.vertices[v]), c) > 0:
                preferred_cut.add((min(v, best), max(v, best)))
    for (lo, hi), uses in edges.items():
        if len(uses) != 2:
            continue
        (f, k), (g, _m) = sorted(uses)
        a, b = mesh.faces[f][k], mesh.faces[f][(k + 1) % len(mesh.faces[f])]
        length = norm(sub(mesh.vertices[a], mesh.vertices[b]))
        rank = 1 if (lo, hi) in preferred_cut else 0
        items.append(((rank, -round(length, 9), lo, hi), (f, g, a, b)))
    items.sort()
    return [t for _key, t in items]


def cut_tree(mesh: Mesh, local: list[list[Pt]], method: str, page_wh: tuple[float, float],
             pad: float, zones: dict | None = None) -> list[_Work]:
    """Greedy Kruskal over the dual graph with overlap and page-fit checks → pieces."""
    tri_idx = []
    from .mesh import ear_clip

    for f in range(len(mesh.faces)):
        tri_idx.append(ear_clip(local[f]))
    owner = list(range(len(mesh.faces)))
    works: dict[int, _Work] = {
        f: _work_for([f], {f: list(local[f])}, tri_idx, [], zones, local)
        for f in range(len(mesh.faces))}
    w, h = page_wh
    for f in range(len(mesh.faces)):
        if fits(convex_hull(local[f]), w, h, pad, LABEL_FOOT_MM) is None:
            raise MeshError(f"face {f} does not fit the printable page at this size: "
                            "reduce the size or use a larger page")
    for f, g, a, b in _candidates(mesh, mesh.edges(), method):
        ia, ib = owner[f], owner[g]
        if ia == ib:
            continue
        A, B = works[ia], works[ib]
        fixed_face, move_face = f, g
        if len(B.faces) > len(A.faces) or (len(B.faces) == len(A.faces) and ib < ia):
            A, B, ia, ib, fixed_face, move_face = B, A, ib, ia, g, f
        fa, ma = mesh.faces[fixed_face], mesh.faces[move_face]
        pa, pb = A.pos[fixed_face][fa.index(a)], A.pos[fixed_face][fa.index(b)]
        qa, qb = B.pos[move_face][ma.index(a)], B.pos[move_face][ma.index(b)]
        t = edge_map(qa, qb, pa, pb)
        moved = {k: [apply(t, p) for p in v] for k, v in B.pos.items()}
        Bt = _work_for(B.faces, moved, tri_idx, B.tree, zones, local)
        key = (min(a, b), max(a, b))
        if conflict(A, Bt, (pa, pb), key):
            continue
        hull = convex_hull([p for v in list(A.pos.values()) + list(moved.values()) for p in v])
        if fits(hull, w, h, pad, LABEL_FOOT_MM) is None:
            continue
        merged_pos = {**A.pos, **moved}
        tree = A.tree + B.tree + [(f, g, a, b)]
        works[ia] = _Work(A.faces + B.faces, merged_pos, A.tris + Bt.tris, A.verts + Bt.verts,
                          A.segs + Bt.segs, bbox([A.box[:2], A.box[2:], Bt.box[:2], Bt.box[2:]]),
                          tree, [z for z in A.zones + Bt.zones if z[0] != key])
        for k in B.faces:
            owner[k] = ia
        del works[ib]
    return [works[k] for k in sorted(works)]


def _islands(mesh: Mesh, works: list[_Work]) -> list[Island]:
    def root_key(f: int) -> tuple:
        n = mesh.normal(f)
        return (round(n[1], 9), -round(mesh.area(f), 9), mesh.centroid(f)[1], f)

    order = sorted(works, key=lambda w: (-len(w.faces), min(w.faces)))
    out = []
    for i, w in enumerate(order):
        root = min(w.faces, key=root_key)
        adj: dict[int, list[tuple[int, int, int]]] = {f: [] for f in w.faces}
        for f, g, a, b in w.tree:
            adj[f].append((g, a, b))
            adj[g].append((f, a, b))
        seen, faces, tree = {root}, [root], []
        k = 0
        while k < len(faces):
            f = faces[k]
            k += 1
            for g, a, b in sorted(adj[f]):
                if g not in seen:
                    seen.add(g)
                    faces.append(g)
                    tree.append((f, g, a, b))
        out.append(Island(i, faces, w.pos, tree, root))
    return out


def net(mesh: Mesh, size: float = 120.0, page: str = "a4", margin: float = 10.0,
        method: str = "min-perimeter", tabs: str = "trapezoid", tab_height: float = 6.0,
        tab_angle: float = 45.0, label_size: float = 3.0) -> Net:
    """Unfold `mesh` into tabbed, numbered nets on pages (see the module docstring)."""
    from .unfold_layout import number_cuts, pack, place_labels, place_tabs

    if page not in PAGE_SIZES_MM:
        raise ValueError(f"page must be one of {sorted(PAGE_SIZES_MM)}")
    if method not in METHODS:
        raise ValueError(f"method must be one of {METHODS}")
    if tabs not in TAB_STYLES:
        raise ValueError(f"tabs must be one of {TAB_STYLES}")
    if not (10.0 <= size <= 2000.0 and 5.0 <= margin <= 30.0 and 0.0 < tab_height <= 20.0
            and 15.0 <= tab_angle <= 80.0 and 1.0 <= label_size <= 8.0):
        raise ValueError("size 10–2000 mm, margin 5–30 mm, tab height 0–20 mm, tab angle "
                         "15–80°, label size 1–8 mm")
    m = prepare(mesh, size)
    local = [face_frame(m, f) for f in range(len(m.faces))]
    edges = m.edges()
    fold: dict[tuple[int, int], float] = {}
    for key, uses in edges.items():
        if len(uses) == 2:
            (f, k), (g, _m) = sorted(uses)
            a, b = m.faces[f][k], m.faces[f][(k + 1) % len(m.faces[f])]
            fold[key] = fold_angle(m, f, g, a, b)
    pw, ph = PAGE_SIZES_MM[page]
    printable = (pw - 2 * margin, ph - 2 * margin)
    pad = (tab_height if tabs != "none" else 0.0) + PIECE_GAP_MM
    zones = (tab_zones(m, local, max(1.5, 0.5 * tab_height), tab_angle)
             if tabs != "none" else None)
    works = cut_tree(m, local, method, printable, pad, zones)
    islands = _islands(m, works)
    the_net = Net(m, local, fold, islands, [], page, (pw, ph), margin,
                  options={"size": size, "method": method, "tabs": tabs,
                           "tab_height": tab_height, "tab_angle": tab_angle,
                           "label_size": label_size})
    the_net.cuts = number_cuts(the_net)
    untabbed = place_tabs(the_net)
    place_labels(the_net)
    pack(the_net)
    the_net.report = {
        "faces": len(m.faces), "islands": len(islands), "cuts": len(the_net.cuts),
        "tabs": sum(len(i.tabs) for i in islands), "untabbed": untabbed,
        "pages": the_net.pages, "size_mm": round(size, 3), "method": method,
        "closed": m.is_closed(),
    }
    return the_net
