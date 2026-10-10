"""Folding operations on layer-ordered flat states (`pliego.flatops`).

Each operation takes a `FlatState`, returns a `Move` — the new, checked state plus what the
fold program needs (the face each new face came from, the step motion) — and fails loud with
`FlatStateError` on any selection or result that is not a physical flat folding. Lines and
points are in the **folded frame** of the state they act on (what a diagram shows).

- `fold(state, line, "valley" | "mountain", at=, layers=, faces=, sheet_points=)`: through all
  layers on one side of the line, or through a selected flap — the layers picked by a point and a
  count (top layers for a valley, bottom layers for a mountain) or by face ids / sheet points,
  plus all paper connected to them on that side without crossing the line;
- `crease_and_unfold(...)`: the same selection, folded and opened again (new creases only);
  `crease(...)` adds those creases without the motion;
- `reverse_fold`, `squash`, `petal`, `rabbit_ear` (`pliego.flatcompound`, re-exported here):
  moves of several rigid groups at once;
- `FlatState.turn_over()` turns the model over (no crease moves).

New creases take valley/mountain from layer parity (`FlatState.crease_angle`).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

from . import flatmotion
from .flatcheck import cells, check, overlap_pairs, solve
from .flatstate import (
    LINE_TOL,
    TOL,
    Affine,
    Face,
    FlatState,
    FlatStateError,
    PointPool,
    Pt,
    as_line,
    centroid,
    embed3,
    inside_convex,
    overlap,
    pt,
    reflect_xf,
    side,
    sort_stack,
    xf_apply,
    xf_compose,
    xf_det,
)


@dataclass
class Move:
    """One operation: `before` → `state`; `parent[i]` is the face of `before` that new face i
    came from; `motion(t)` the world rigid motion of each moving new face (on top of its
    placement in `before`); `samples` the t values a fold program shows."""

    kind: str
    before: FlatState
    state: FlatState
    parent: list[int]
    motion: flatmotion.Motion
    samples: list[float]
    info: dict = field(default_factory=dict)

    def reversed(self) -> Move:
        """The move back (unfolding what this move folded)."""
        fwd = self.motion
        g1 = fwd(1.0)

        def back(t: float) -> dict[int, flatmotion.Rigid]:
            gt = fwd(1.0 - t)
            return {f: flatmotion.compose(gt.get(f, flatmotion.ID_RIGID), flatmotion.invert(g))
                    for f, g in g1.items()}
        opened = self.before_split()
        opened = opened.derive(memory=opened.memory + remember(self.state, opened))
        return Move(self.kind + "-back", self.state, opened,
                    list(range(len(self.state.faces))), back, list(self.samples), self.info)

    def before_split(self) -> FlatState:
        """`before` subdivided by this move's creases: the new faces at their old placements."""
        st = self.state
        faces = [Face(f.verts, self.before.faces[self.parent[i]].xf)
                 for i, f in enumerate(st.faces)]
        out = st.derive(faces=faces, order={})
        return _inherit(out, self.before, self.parent, "unfold")


# ── splitting and flooding ───────────────────────────────────────────────────

NEAR_MISS = 0.05   # mm: a fold line cutting a layer this close to its vertex is an error
ON_LINE = LINE_TOL  # mm: a vertex this close to a fold line lies on it (accumulated rounding)

def _cut_face(state: FlatState, f: int, p: Pt, d: Pt, pool: PointPool, strict: bool = True
              ) -> tuple[tuple[int, ...], tuple[int, ...]] | None:
    """(left, right) vertex cycles of face f cut by the folded line, or None if not crossed."""
    face = state.faces[f]
    vs = face.verts
    pts = [state.points[v] for v in vs]
    imgs = [xf_apply(face.xf, q) for q in pts]
    s = [side(p, d, q) for q in imgs]
    if max(s) <= ON_LINE or min(s) >= -ON_LINE:
        return None
    for q, sv in zip(imgs, s, strict=True):
        if strict and ON_LINE < abs(sv) < NEAR_MISS:
            raise FlatStateError(f"the fold line passes {abs(sv):.2g} mm from the vertex at "
                                 f"({q[0]:.4f}, {q[1]:.4f}) of a layer it cuts: aim it exactly "
                                 "through the vertex (FlatState.vertex_near) or clear of it")
    left: list[int] = []
    right: list[int] = []
    n = len(vs)
    for i in range(n):
        j = (i + 1) % n
        if s[i] >= -ON_LINE:
            left.append(vs[i])
        if s[i] <= ON_LINE:
            right.append(vs[i])
        if (s[i] > ON_LINE and s[j] < -ON_LINE) or (s[i] < -ON_LINE and s[j] > ON_LINE):
            t = s[i] / (s[i] - s[j])
            a, b = pts[i], pts[j]
            k = pool.add((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            left.append(k)
            right.append(k)
    return tuple(_dedup(left)), tuple(_dedup(right))


def _dedup(cyc: list[int]) -> list[int]:
    out: list[int] = []
    for v in cyc:
        if not out or out[-1] != v:
            out.append(v)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def _side_of(state: FlatState, f: int, p: Pt, d: Pt) -> float:
    c = centroid(state.image(f))
    return side(p, d, c)


def _on_line(state_xf: Affine, a: Pt, b: Pt, p: Pt, d: Pt) -> bool:
    return all(abs(side(p, d, xf_apply(state_xf, q))) <= LINE_TOL for q in (a, b))


def subdivide(state: FlatState, line, faces: Iterable[int] | None = None, *,
              strict: bool = True) -> tuple[FlatState, list[int]]:
    """Add the folded line as a crease to the given faces (all faces it crosses by default),
    leaving the folding as it is. Returns the new state and the parent of each new face.
    `strict=False` (a trial cut) tolerates near misses of vertices the move will not cut."""
    p, d = as_line(line)
    pool = PointPool(state.points)
    which = set(range(len(state.faces)) if faces is None else faces)
    new_faces: list[Face] = []
    parent: list[int] = []
    for f, face in enumerate(state.faces):
        cut = _cut_face(state, f, p, d, pool, strict) if f in which else None
        if cut is None:
            new_faces.append(face)
            parent.append(f)
            continue
        for cyc in cut:
            new_faces.append(Face(cyc, face.xf))
            parent.append(f)
    out = state.derive(points=pool.points, faces=_repair(new_faces, pool.points), order={})
    return _inherit(out, state, parent, "subdivide"), parent


def _repair(faces: list[Face], points: Sequence[Pt], extra: Iterable[int] = ()) -> list[Face]:
    """Insert into each face cycle the vertices that lie on its edges (no T-junctions); `extra`
    vertices (no face's corner yet, e.g. a slit's end inside a face) are inserted too."""
    used = sorted({v for f in faces for v in f.verts} | set(extra))
    out: list[Face] = []
    for face in faces:
        vs = list(face.verts)
        cyc: list[int] = []
        for i, a in enumerate(vs):
            b = vs[(i + 1) % len(vs)]
            cyc.append(a)
            pa, pb = points[a], points[b]
            dx, dy = pb[0] - pa[0], pb[1] - pa[1]
            ln2 = dx * dx + dy * dy
            mids = []
            for v in used:
                if v in (a, b):
                    continue
                q = points[v]
                tt = ((q[0] - pa[0]) * dx + (q[1] - pa[1]) * dy) / ln2
                if 0.0 < tt < 1.0 and abs(dx * (q[1] - pa[1]) - dy * (q[0] - pa[0])) \
                        <= TOL * math.sqrt(ln2):
                    mids.append((tt, v))
            cyc.extend(v for _, v in sorted(mids))
        out.append(Face(tuple(cyc), face.xf))
    return out


def _inherit(new: FlatState, old: FlatState, parent: list[int], what: str) -> FlatState:
    """Orders of a subdivision: each new face keeps its parent's order with every face it still
    overlaps (placements unchanged)."""
    by_parent: dict[int, list[int]] = {}
    for i, pa in enumerate(parent):
        by_parent.setdefault(pa, []).append(i)
    order: dict[tuple[int, int], int] = {}
    imgs = [new.image(i) for i in range(len(new.faces))]
    for (a, b), _ in old.order.items():
        up = old.above(a, b)
        for i in by_parent.get(a, ()):
            for j in by_parent.get(b, ()):
                if overlap(imgs[i], imgs[j]):
                    key = (i, j) if i < j else (j, i)
                    order[key] = (1 if up else -1) * (1 if i < j else -1)
    return new.derive(order=order)


def _adjacency(state: FlatState) -> dict[int, list[tuple[int, int, int]]]:
    """face → [(neighbour, a, b)] across creases (not across slits)."""
    half = state.half_edges()
    cut = state.cut_edges()
    adj: dict[int, list[tuple[int, int, int]]] = {f: [] for f in range(len(state.faces))}
    for (a, b), f in sorted(half.items()):
        g = half.get((b, a))
        if g is not None and (min(a, b), max(a, b)) not in cut:
            adj[f].append((g, a, b))
    return adj


def _fold_seams(state: FlatState, faces: Sequence[Face]) -> tuple:
    """`state.creased` plus every seam edge the move folds (it is a crease from now on)."""
    if not state.seams:
        return state.creased
    half = state.half_edges()
    out = list(state.creased)
    for (a, b), f in sorted(half.items()):
        g = half.get((b, a))
        if g is None or a > b or not state.seam_only(a, b):
            continue
        if (xf_det(faces[f].xf) < 0) != (xf_det(faces[g].xf) < 0):
            out.append((state.points[a], state.points[b]))
    return tuple(out)


def flood(state: FlatState, seeds: Iterable[int], allowed: Callable[[int], bool],
          blocked: Callable[[int, int, int], bool]) -> set[int]:
    """Faces connected to the seeds through edges not `blocked(face, a, b)`, among `allowed`."""
    adj = _adjacency(state)
    out = set(seeds)
    stack = sorted(out)
    while stack:
        f = stack.pop()
        for g, a, b in adj[f]:
            if g not in out and allowed(g) and not blocked(f, a, b):
                out.add(g)
                stack.append(g)
    return out


def _stack_at(state: FlatState, q: Pt, among: Iterable[int] | None = None) -> list[int]:
    cand = range(len(state.faces)) if among is None else among
    hit = [f for f in cand if inside_convex(q, state.image(f))]
    if not hit:
        raise FlatStateError(f"no layer at folded point ({q[0]:.3f}, {q[1]:.3f})")
    return sort_stack(state, hit)


# ── committing a move ────────────────────────────────────────────────────────

Rule = Callable[[int, int], "int | None"]


def _heights(state: FlatState, motion: flatmotion.Motion, t: float):
    """Height (world Y) of each face's plane over a folded point, at time t of a motion."""
    g = motion(t)
    planes = {}
    for i, f in enumerate(state.faces):
        pose = flatmotion.compose(g.get(i, flatmotion.ID_RIGID), embed3(f.xf))
        p0 = flatmotion.apply(pose, (state.points[f.verts[0]][0], 0.0,
                                     -state.points[f.verts[0]][1]))
        n = tuple(pose[0][k][1] for k in range(3))
        planes[i] = (p0, n)

    def at(i: int, q: Pt) -> float:
        p0, n = planes[i]
        if abs(n[1]) < 1e-9:
            return p0[1]
        return p0[1] - (n[0] * (q[0] - p0[0]) + n[2] * (-q[1] - p0[2])) / n[1]
    return at


def _move(state: FlatState, group: dict[int, str], xf: dict[str, Affine], rule: Rule,
          hint: Rule, what: str, motion: flatmotion.Motion | None = None) -> FlatState:
    """Apply group isometries; order: same group → kept (reversed when the group's isometry
    turns faces over), else `rule(i, j)` (+1 i above j, −1 below, 0 keep, None → solved from the
    parity constraints, preferring the side each face arrives from in `motion` just before it
    lands, else `hint`). Checked before it is returned."""
    faces = [Face(f.verts, xf_compose(xf[group[i]], f.xf) if i in group else f.xf)
             for i, f in enumerate(state.faces)]
    tmp = state.derive(faces=faces, order={})
    cs = cells(tmp)
    witness: dict[tuple[int, int], Pt] = {}
    for q, stack in cs:
        for a_, x in enumerate(stack):
            for y in stack[a_ + 1:]:
                witness.setdefault((x, y), q)
    height = _heights(state, motion, 0.95) if motion is not None else None
    order: dict[tuple[int, int], int] = {}
    hints: dict[tuple[int, int], int] = {}
    for i, j in sorted(overlap_pairs(cs)):
        gi, gj = group.get(i), group.get(j)
        if gi == gj or (gi is not None and gj is not None and rule(i, j) == 0) \
                or (gi is None and gj is None):
            up = state.above(i, j)
            if up is None:
                raise FlatStateError(f"{what}: faces {i} and {j} come to overlap without an "
                                     "order (the move is not rigid for them)")
            if gi is not None and gi == gj and xf_det(xf[gi]) < 0:
                up = not up
            order[(i, j)] = 1 if up else -1
            continue
        r = rule(i, j)
        if r == 0:
            up = state.above(i, j)
            if up is None:
                raise FlatStateError(f"{what}: faces {i} and {j} have no order to keep")
            order[(i, j)] = 1 if up else -1
        elif r is not None:
            order[(i, j)] = r
        else:
            h = None
            if height is not None:
                dy = height(i, witness[(i, j)]) - height(j, witness[(i, j)])
                h = (1 if dy > 0 else -1) if abs(dy) > 1e-7 else None
            if h is None:
                h = hint(i, j)
            hints[(i, j)] = 1 if (h or 1) > 0 else -1
    out = state.derive(faces=faces, order=order, creased=_fold_seams(state, faces))
    if hints:
        out = solve(out, hints, cs)
    issues = check(out, cs=cs)
    if issues:
        raise FlatStateError(f"{what}: the result is not a valid flat folding — "
                             + "; ".join(i["detail"] for i in issues[:4]))
    opened = remember(state, out)
    return out.derive(memory=out.memory + opened) if opened else out


def remember(before: FlatState, after: FlatState) -> tuple:
    """Memory entries for the creases folded in `before` and open in `after` (the same faces):
    each keeps the sign of its last fold."""
    was = {(min(c.a, c.b), max(c.a, c.b)): c.angle for c in before.creases() if c.angle}
    out = []
    for c in after.creases():
        a = was.get((min(c.a, c.b), max(c.a, c.b)))
        if a and c.angle == 0.0:
            out.append((after.points[c.a], after.points[c.b], 1 if a > 0 else -1))
    return tuple(out)


def _require_top(state: FlatState, moving: set[int], up: bool, what: str) -> None:
    """No face outside `moving` lies above (up) / below (not up) a moving face it overlaps."""
    for (a, b), _ in state.order.items():
        if (a in moving) == (b in moving):
            continue
        m, s = (a, b) if a in moving else (b, a)
        if state.above(s, m) == up:
            raise FlatStateError(f"{what}: face {s} lies {'over' if up else 'under'} the "
                                 f"selected layers (face {m}); it would have to pass through "
                                 "them — select it too, or fold from the other side")


# ── fold ─────────────────────────────────────────────────────────────────────

def _select(state: FlatState, p: Pt, d: Pt, sgn: float, at, layers, faces, sheet_points,
            from_top: bool, what: str) -> set[int]:
    """Seed faces on the moving side (state already subdivided by the line)."""
    on_side = {f for f in range(len(state.faces)) if _side_of(state, f, p, d) * sgn > 0}
    if faces is not None:
        seeds = {f for f in faces if f in on_side}
    elif sheet_points is not None:
        seeds = {state.face_at(q) for q in sheet_points}
        if not seeds <= on_side:
            raise FlatStateError(f"{what}: a selected sheet point is not on the moving side")
    elif layers is not None:
        q = pt(at)
        stack = _stack_at(state, q, on_side)
        if not 1 <= int(layers) <= len(stack):
            raise FlatStateError(f"{what}: {layers} layers asked, {len(stack)} at the point")
        seeds = set(stack[-int(layers):] if from_top else stack[:int(layers)])
    else:
        seeds = set(on_side)
    if not seeds:
        raise FlatStateError(f"{what}: the selection picks no layer on the moving side")
    return seeds


def fold(state: FlatState, line, direction: str = "valley", *, at=None, layers: int | None = None,
         faces: Iterable[int] | None = None, sheet_points: Iterable | None = None,
         from_: str | None = None) -> Move:
    """Valley (towards the viewer, landing on top) or mountain (away, landing underneath) fold
    of the paper on one side of the folded line: the side holding `at`, else the left of the
    directed line. Selection (see the module docstring); default every layer on that side."""
    if direction not in ("valley", "mountain"):
        raise FlatStateError("direction must be valley or mountain")
    what = f"{direction} fold"
    p, d = as_line(line)
    sgn = 1.0 if at is None else (1.0 if side(p, d, pt(at)) > 0 else -1.0)
    if at is not None and abs(side(p, d, pt(at))) <= TOL:
        raise FlatStateError(f"{what}: the selection point lies on the fold line")
    tent, par0 = subdivide(state, (p, (p[0] + d[0], p[1] + d[1])), strict=False)
    from_top = (from_ or ("top" if direction == "valley" else "bottom")) == "top"
    seeds = _select(tent, p, d, sgn, at, layers,
                    None if faces is None else [i for i, pa in enumerate(par0) if pa in set(faces)],
                    sheet_points, from_top, what)
    on_side = {f for f in range(len(tent.faces)) if _side_of(tent, f, p, d) * sgn > 0}
    moving = flood(tent, seeds, lambda f: f in on_side,
                   lambda f, a, b: _on_line(tent.faces[f].xf, tent.points[a], tent.points[b],
                                            p, d))
    split = {par0[i] for i in moving}
    st1, par1 = subdivide(state, (p, (p[0] + d[0], p[1] + d[1])), split)
    mv = {i for i in range(len(st1.faces)) if par1[i] in split
          and _side_of(st1, i, p, d) * sgn > 0}
    up = direction == "valley"
    _require_top(st1, mv, up, what)
    refl = reflect_xf(p, d)
    group = {i: "m" for i in mv}

    def rule(i: int, j: int) -> int:
        mi = i in mv
        return (1 if mi else -1) * (1 if up else -1)
    new = _move(st1, group, {"m": refl}, rule, rule, what)
    sense = sgn * (1.0 if up else -1.0)
    return Move("fold", state, new, par1, flatmotion.simple(sorted(mv), p, d, sense), [1.0],
                {"line": (p, d), "direction": direction, "moving": sorted(mv), "split": st1})


def crease(state: FlatState, line, direction: str = "valley", **select) -> Move:
    """Add creases without moving the paper: the creases the same `fold` would make (the same
    selection), the state left as it is (a line scored or marked; it folds later or never)."""
    m = fold(state, line, direction, **select)
    return Move("crease", state, m.before_split(), list(m.parent), lambda t: {}, [1.0],
                {"line": m.info["line"]})


def crease_and_unfold(state: FlatState, line, direction: str = "valley", **select) -> list[Move]:
    """Fold and open again: [the fold, the unfold]. The final state has the new creases and the
    old folding (the creases keep their sign as memory only in the fold step)."""
    m = fold(state, line, direction, **select)
    return [m, m.reversed()]


# ── halves of a flap ─────────────────────────────────────────────────────────

def halves(state: FlatState, faces: set[int], at=None, gap: int | None = None,
           what: str = "flap") -> tuple[set[int], set[int], tuple[Pt, Pt]]:
    """Split a flap into its front (upper) and back (lower) halves where it opens: the layers
    at `at` (a folded point on the flap; default the middle of a face) are cut between layer
    `gap` and `gap + 1` from the bottom (default: the cut nearest the middle that works), each
    half grows through the flap's own creases, and the creases joining the halves must lie on
    one line — the spine. Returns (front, back, (point, unit direction))."""
    q = pt(at) if at is not None else centroid(state.image(min(faces)))
    stack = _stack_at(state, q, faces)
    n = len(stack)
    if n < 2:
        raise FlatStateError(f"{what}: one layer only — nothing to open")
    gaps = [gap] if gap is not None else sorted(range(1, n), key=lambda g: (abs(2 * g - n), g))
    for g in gaps:
        if not 1 <= g < n:
            raise FlatStateError(f"{what}: gap {g} outside 1..{n - 1}")
        b0, f0 = set(stack[:g]), set(stack[g:])
        fr = flood(state, f0, lambda f, b0=b0: f in faces and f not in b0,
                   lambda f, a, b: False)
        bk = flood(state, b0, lambda f, fr=fr: f in faces and f not in fr,
                   lambda f, a, b: False)
        if fr & bk or (fr | bk) != faces:
            continue
        lines: list[tuple[Pt, Pt]] = []
        ok = True
        for c in state.creases():
            if not ((c.f in fr and c.g in bk) or (c.f in bk and c.g in fr)):
                continue
            if c.angle == 0.0:
                ok = False
                break
            a, b = state.segment_image(c.f, c.a, c.b)
            if not lines:
                lines.append(as_line((a, b)))
            elif any(abs(side(lines[0][0], lines[0][1], x)) > LINE_TOL for x in (a, b)):
                ok = False
                break
        if not ok or not lines:
            continue
        rel = [state.above(i, j) for i in fr for j in bk]
        rel = [x for x in rel if x is not None]
        if rel and all(rel):
            return fr, bk, lines[0]
    raise FlatStateError(f"{what}: the flap does not open into a front and a back half joined "
                         "along one spine" + ("" if gap is None else f" at gap {gap}"))


def _other(state: FlatState, f: int, a: int, b: int) -> int:
    return state.half_edges()[(b, a)]



from .flatcompound import petal, rabbit_ear, reverse_fold, squash  # noqa: E402

__all__ = ["Move", "crease", "crease_and_unfold", "flood", "fold", "halves", "petal", "rabbit_ear",
           "reverse_fold", "squash", "subdivide"]
