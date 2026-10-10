"""Compound folding moves on layer-ordered flat states (`pliego.flatcompound`).

Moves of several rigid face groups at once, each returning a checked `pliego.flatops.Move`
(re-exported by `pliego.flatops`); lines and points in the folded frame of the input state:

- `reverse_fold(state, line, at=, kind="inside" | "outside")`: every layer of the flap beyond
  the line turns back about it, its two halves reversing between (inside) or around (outside)
  the rest of the flap;
- `squash(state, hinge, at=)`: the top flap stands up on its hinge, opens and is pressed flat
  symmetric about the hinge;
- `petal(state, (K1, K2), tip)`: the top layer's petal turns up about the hinge K1–K2 while
  its sides fold in along the kite lines Kᵢ–tip;
- `rabbit_ear(state, (A, B, C), at=)`: the triangle's corners A and C fold in along their
  angle bisectors and the corner B stands up as an ear, laid flat towards side A–B.

Layer orders between groups come from the side each face arrives from in the move's own rigid
motion, completed and checked by `pliego.flatcheck` (parity constraints, transitivity).
"""

from __future__ import annotations

import math

from . import flatmotion
from .flatops import (
    Move,
    _move,
    _on_line,
    _other,
    _require_top,
    _side_of,
    _stack_at,
    flood,
    halves,
    subdivide,
)
from .flatstate import (
    TOL,
    Affine,
    FlatState,
    FlatStateError,
    Pt,
    as_line,
    centroid,
    inside_convex,
    pt,
    reflect_xf,
    side,
    xf_compose,
)

# ── reverse folds ────────────────────────────────────────────────────────────

def reverse_fold(state: FlatState, line, *, at, kind: str = "inside", gap: int | None = None
                 ) -> Move:
    """Inside or outside reverse fold of the flap at `at` (a folded point on the flap's tip):
    every layer of the flap beyond the line turns back about it, its two halves reversing between
    (inside) or around (outside) the rest of the flap."""
    if kind not in ("inside", "outside"):
        raise FlatStateError("kind must be inside or outside")
    what = f"{kind} reverse fold"
    p, d = as_line(line)
    q = pt(at)
    sgn = 1.0 if side(p, d, q) > 0 else -1.0
    tent, par0 = subdivide(state, (p, (p[0] + d[0], p[1] + d[1])), strict=False)
    on_side = {f for f in range(len(tent.faces)) if _side_of(tent, f, p, d) * sgn > 0}
    seeds = set(_stack_at(tent, q, on_side))
    tip = flood(tent, seeds, lambda f: f in on_side,
                lambda f, a, b: _on_line(tent.faces[f].xf, tent.points[a], tent.points[b], p, d))
    split = {par0[i] for i in tip}
    st1, par1 = subdivide(state, (p, (p[0] + d[0], p[1] + d[1])), split)
    mv = {i for i in range(len(st1.faces)) if par1[i] in split and _side_of(st1, i, p, d) * sgn > 0}
    front, back, sp = halves(st1, mv, q, gap, what)
    # the layers left behind must not sit inside the flap's tip region
    for s in range(len(st1.faces)):
        if s in mv:
            continue
        rel = {st1.above(s, m) for m in mv} - {None}
        if kind == "inside" and len(rel) > 1:
            c = centroid(st1.image(s))
            raise FlatStateError(f"{what}: a layer not joined to the flap's tip (around "
                                 f"({c[0]:.1f}, {c[1]:.1f})) lies between the tip's layers; "
                                 "move the line or fold that layer with the flap first")
        if kind == "outside":
            for m in mv:
                up = st1.above(m, s)
                if up is not None and up != (m in front):
                    raise FlatStateError(f"{what}: face {s} covers the flap's "
                                         f"{'front' if m in front else 'back'} half")
    refl = reflect_xf(p, d)
    group = {i: ("f" if i in front else "b") for i in mv}
    partners: dict[int, str] = {}
    for c in st1.creases():
        for x, y in ((c.f, c.g), (c.g, c.f)):
            if x in mv and y not in mv:
                partners[y] = group[x]

    def rule(i: int, j: int) -> int | None:
        gi, gj = group.get(i), group.get(j)
        if gi is not None and gj is not None:
            return 0
        if kind == "outside":
            m = i if gi is not None else j
            up = group[m] == "f"
            return (1 if up else -1) * (1 if m == i else -1)
        return None

    def hint(i: int, j: int) -> int:
        m, s = (i, j) if group.get(i) is not None else (j, i)
        upper = _upper_side(st1, s, partners, mv, front)
        r = -1 if upper else 1   # the tip goes under the upper layers, over the lower ones
        return r if m == i else -r
    new = _move(st1, group, {"f": refl, "b": refl}, rule, hint, what)
    # the front half must end inside (under) its base layer, or outside (over) it
    for c in new.creases():
        for x, y in ((c.f, c.g), (c.g, c.f)):
            if group.get(x) == "f" and y not in group:
                if new.above(y, x) != (kind == "inside"):
                    raise FlatStateError(
                        f"{what}: the tip cannot turn {kind} here — it would cross the flap's "
                        "folded edge; use an " + ("outside" if kind == "inside" else "inside")
                        + " reverse fold or another line")
    probe = centroid(st1.image(min(back)))
    variants = [flatmotion.reverse(sorted(front), sorted(back), p, d, sgn > 0, kind, sp, probe,
                                   drv) for drv in ("front", "back", "mirror", "stack")]
    return Move("reverse", state, new, par1, variants[0], [i / 8 for i in range(1, 9)],
                {"line": (p, d), "kind": kind, "front": sorted(front), "back": sorted(back),
                 "spine": sp, "variants": variants})


def _upper_side(state: FlatState, s: int, partners: dict[int, str], mv: set[int],
                front: set[int]) -> bool:
    """Is layer s above the flap's opening (on the front half's side)?"""
    if s in partners:
        return partners[s] == "f"
    for m in mv:
        up = state.above(s, m)
        if up is None:
            continue
        if up and m in front:
            return True
        if not up and m not in front:
            return False
    for t, g in partners.items():
        up = state.above(s, t)
        if up is None:
            continue
        if g == "f" and up:
            return True
        if g == "b" and not up:
            return False
    return True


# ── squash ───────────────────────────────────────────────────────────────────

def squash(state: FlatState, hinge, *, at, layers: int = 1, gap: int | None = None) -> Move:
    """Squash the top flap at `at`, hinged on the folded line `hinge`: the flap stands up, opens
    and is pressed flat symmetric about the hinge — its spine lands on the hinge line, its top
    half turns across, its bottom half's spine part folds back onto its own hinge part."""
    what = "squash fold"
    p, d = as_line(hinge)
    q = pt(at)
    sgn = 1.0 if side(p, d, q) > 0 else -1.0
    on_side = {f for f in range(len(state.faces)) if _side_of(state, f, p, d) * sgn > 0}
    seeds = set(_stack_at(state, q, on_side)[-int(layers):])
    flap = flood(state, seeds, lambda f: f in on_side,
                 lambda f, a, b: _on_line(state.faces[f].xf, state.points[a], state.points[b],
                                          p, d))
    _require_top(state, flap, True, what)
    top, bottom, (sp, sd) = halves(state, flap, q, gap, what)
    o = _meet(p, d, sp, sd, what)
    u_h = _ray_towards(o, d, [state.segment_image(c.f, c.a, c.b) for c in state.creases()
                              if (c.f in flap) != (c.g in flap)
                              and _on_line(state.faces[c.f].xf, state.points[c.a],
                                           state.points[c.b], p, d)], what + " hinge")
    u_s = _ray_towards(o, sd, [state.segment_image(c.f, c.a, c.b) for c in state.creases()
                               if c.f in flap and c.g in flap and c.angle != 0.0
                               and _on_line(state.faces[c.f].xf, state.points[c.a],
                                            state.points[c.b], sp, sd)], what + " spine")
    bis = (u_h[0] + u_s[0], u_h[1] + u_s[1])
    ln = math.hypot(*bis)
    if ln < 1e-6:
        raise FlatStateError(f"{what}: hinge and spine are opposite rays")
    bd = (bis[0] / ln, bis[1] / ln)
    st1, par1 = subdivide(state, (o, (o[0] + bd[0], o[1] + bd[1])), flap)
    hside = side(o, bd, (o[0] + u_h[0], o[1] + u_h[1]))
    group: dict[int, str] = {}
    for i in range(len(st1.faces)):
        if par1[i] not in flap:
            continue
        near_h = _side_of(st1, i, o, bd) * hside > 0
        half = "a" if par1[i] in top else "b"
        group[i] = f"{half}_{'h' if near_h else 's'}"
    rh, rb = reflect_xf(p, d), reflect_xf(o, bd)
    xf = {"a_h": rh, "a_s": xf_compose(rh, rb), "b_s": rb,
          "b_h": (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)}
    groups = {k: sorted(i for i, g in group.items() if g == k) for k in xf}
    motion = flatmotion.squash(groups, o, u_h, u_s)
    rank = {"a_s": 3, "b_s": 3, "a_h": 2, "b_h": 1}

    def rule(i: int, j: int) -> int | None:
        gi, gj = group.get(i), group.get(j)
        if "b_h" in (gi, gj) and None in (gi, gj):
            return 0          # the bottom half's hinge part ends where it started
        return None

    def hint(i: int, j: int) -> int:
        ri, rj = rank.get(group.get(i), 0), rank.get(group.get(j), 0)
        return 1 if ri >= rj else -1
    new = _move(st1, group, xf, rule, hint, what, motion)
    return Move("squash", state, new, par1, motion,
                [0.125, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0],
                {"hinge": (p, d), "corner": o, "spine": (sp, sd), "groups": groups})


def _meet(p: Pt, d: Pt, q: Pt, e: Pt, what: str) -> Pt:
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-9:
        raise FlatStateError(f"{what}: hinge and spine are parallel")
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def _ray_towards(o: Pt, d: Pt, segs: list[tuple[Pt, Pt]], what: str) -> Pt:
    if not segs:
        raise FlatStateError(f"{what}: no crease of the flap lies on it")
    tot = 0.0
    for a, b in segs:
        tot += d[0] * ((a[0] + b[0]) / 2 - o[0]) + d[1] * ((a[1] + b[1]) / 2 - o[1])
    return d if tot > 0 else (-d[0], -d[1])


# ── petal ────────────────────────────────────────────────────────────────────

def _refine(st: FlatState, par: list[int], line, faces: set[int]) -> tuple[FlatState, list[int]]:
    """Subdivide the given faces of `st` by a line, composing the parent map to the origin."""
    st2, p2 = subdivide(st, line, faces)
    return st2, [par[j] for j in p2]


def petal(state: FlatState, hinge, tip, *, at=None) -> Move:
    """Petal fold of the top layer: its petal (the triangle K1–K2–tip) turns up about the hinge
    K1–K2 while each side folds in along the kite line Kᵢ–tip, the layer beneath the side
    (joined to it at the flap edge through Kᵢ) opening flat with it."""
    what = "petal fold"
    k1, k2, t = pt(hinge[0]), pt(hinge[1]), pt(tip)
    tri = [k1, k2, t] if (k2[0] - k1[0]) * (t[1] - k1[1]) - (k2[1] - k1[1]) * (t[0] - k1[0]) > 0 \
        else [k2, k1, t]
    q = pt(at) if at is not None else ((2 * k1[0] + k2[0] + t[0]) / 4,
                                       (2 * k1[1] + k2[1] + t[1]) / 4)
    top0 = _stack_at(state, q)[-1]
    layer = flood(state, [top0], lambda f: True,
                  lambda f, a, b: state.crease_angle(f, _other(state, f, a, b)) != 0.0)
    _require_top(state, layer, True, what)
    hp, hd = as_line((k1, k2))
    tside = side(hp, hd, t)
    st, par = state, list(range(len(state.faces)))
    for line in ((k1, k2), (k1, t), (k2, t)):
        st, par = _refine(st, par, line, {i for i in range(len(st.faces)) if par[i] in layer})
    kites = []
    for k, other in ((k1, k2), (k2, k1)):
        kp, kd = as_line((k, t))
        kites.append((k, kp, kd, side(kp, kd, other)))

    def sides(st: FlatState, par: list[int], n: int) -> set[int]:
        _, kp, kd, oside = kites[n]
        return {i for i in range(len(st.faces)) if par[i] in layer
                and side(hp, hd, centroid(st.image(i))) * tside > 0
                and side(kp, kd, centroid(st.image(i))) * oside < 0}

    edges = []
    for n in range(2):
        sf = sides(st, par, n)
        if not sf:
            raise FlatStateError(f"{what}: no side beyond the kite line at hinge end {n + 1}")
        kk = kites[n][0]
        cr = [c for c in st.creases() if c.angle != 0.0 and ((c.f in sf) != (c.g in sf))
              and ((par[c.f] in layer) != (par[c.g] in layer))
              and abs(side(*as_line(st.segment_image(c.f, c.a, c.b)), kk)) < 1e-4]
        if not cr:
            raise FlatStateError(f"{what}: the side at hinge end {n + 1} has no folded flap edge "
                                 "through the hinge end")
        ep, ed = as_line(st.segment_image(cr[0].f, cr[0].a, cr[0].b))
        seeds_par = {par[c.g if c.f in sf else c.f] for c in cr}
        st, par = _refine(st, par, (kites[n][0], t),
                          {i for i in range(len(st.faces)) if par[i] in seeds_par})
        edges.append((ep, ed, seeds_par))
    group: dict[int, str] = {}
    xf: dict[str, Affine] = {"p": reflect_xf(hp, hd)}
    for i in range(len(st.faces)):
        if par[i] in layer and inside_convex(centroid(st.image(i)), tri, -TOL):
            group[i] = "p"
    msides = []
    for n, (ep, ed, seeds_par) in enumerate(edges):
        k, kp, kd, oside = kites[n]
        sf = sides(st, par, n)

        def beyond(f: int, st=st, kp=kp, kd=kd, oside=oside) -> bool:
            c = centroid(st.image(f))
            return side(kp, kd, c) * oside < 0 and side(hp, hd, c) * tside > 0
        seeds = {i for i in range(len(st.faces)) if par[i] in seeds_par and beyond(i)}
        inner = flood(st, seeds, lambda f, st=st, beyond=beyond: par[f] not in layer
                      and beyond(f),
                      lambda f, a, b, st=st: st.crease_angle(f, _other(st, f, a, b)) != 0.0)
        xf[f"s{n}"] = xf_compose(xf["p"], reflect_xf(kp, kd))
        xf[f"i{n}"] = xf_compose(xf[f"s{n}"], reflect_xf(ep, ed))
        group.update({i: f"s{n}" for i in sf})
        group.update({i: f"i{n}" for i in inner})
        tdir = (t[0] - k[0], t[1] - k[1])
        ln = math.hypot(*tdir)
        tdir = (tdir[0] / ln, tdir[1] / ln)
        cs_ = centroid([c for i in sf for c in st.image(i)])
        ev = ed if ed[0] * (cs_[0] - k[0]) + ed[1] * (cs_[1] - k[1]) > 0 else (-ed[0], -ed[1])
        msides.append({"corner": k, "k": tdir, "e": ev, "kin": tdir, "side": sorted(sf),
                       "inner": sorted(inner)})
    pet = sorted(i for i, g in group.items() if g == "p")
    motion = flatmotion.petal(pet, msides, k1, k2)
    new = _move(st, group, xf, lambda i, j: None, lambda i, j: 1 if j not in group else -1,
                what, motion)
    return Move("petal", state, new, par, motion, [i / 10 for i in range(1, 11)],
                {"hinge": (k1, k2), "tip": t, "petal": pet})


# ── rabbit ear ───────────────────────────────────────────────────────────────

def rabbit_ear(state: FlatState, corners, *, at=None, layers: int | None = None) -> Move:
    """Rabbit ear of the triangle (A, B, C) (folded points, the flap's corners): the layers
    inside it (all at `at`, or the top `layers`, and everything joined to them inside the
    triangle) fold along the bisectors from A and C to the incentre I; the corner B rises as an
    ear (bisector I–B) and lies flat towards side A–B (perpendicular I–D, D on A–B). The part
    by side A–C stays."""
    what = "rabbit ear"
    a, b, c = (pt(x) for x in corners)
    la, lb, lc = math.dist(b, c), math.dist(a, c), math.dist(a, b)
    per = la + lb + lc
    inc = ((la * a[0] + lb * b[0] + lc * c[0]) / per, (la * a[1] + lb * b[1] + lc * c[1]) / per)
    ux, uy = (b[0] - a[0]) / lc, (b[1] - a[1]) / lc
    tt = (inc[0] - a[0]) * ux + (inc[1] - a[1]) * uy
    dpt = (a[0] + tt * ux, a[1] + tt * uy)
    tri = [a, b, c] if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0 \
        else [a, c, b]
    q = pt(at) if at is not None else ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)
    inside = {f for f in range(len(state.faces))
              if all(inside_convex(x, tri, -1e-5) for x in state.image(f))}
    stack = _stack_at(state, q, inside)
    seeds = set(stack if layers is None else stack[-int(layers):])
    flap = flood(state, seeds, lambda f: f in inside, lambda f, x, y: False)
    st, par = state, list(range(len(state.faces)))
    for ray_end in (a, c, b, dpt):
        st, par = _refine(st, par, (inc, ray_end), {i for i in range(len(st.faces))
                                                    if par[i] in flap})
    # sectors around the incentre: A–D (x1), D–B (x2), B–C (x3), C–A (stays)
    def sector(f: int) -> str | None:
        if par[f] not in flap:
            return None
        cq = centroid(st.image(f))
        ang = math.atan2(cq[1] - inc[1], cq[0] - inc[0])
        rays = {n: math.atan2(p[1] - inc[1], p[0] - inc[0])
                for n, p in (("a", a), ("d", dpt), ("b", b), ("c", c))}

        def between(r0: str, r1: str) -> bool:
            s0 = (ang - rays[r0]) % (2 * math.pi)
            s1 = (rays[r1] - rays[r0]) % (2 * math.pi)
            return 0 < s0 < s1
        cw = (rays["d"] - rays["a"]) % (2 * math.pi) < math.pi
        order = [("a", "d", "x1"), ("d", "b", "x2"), ("b", "c", "x3")]
        for r0, r1, name in order:
            if (between(r0, r1) if cw else between(r1, r0)):
                return name
        return None
    group = {i: g for i in range(len(st.faces)) if (g := sector(i)) is not None}
    ra, rc, rd = reflect_xf(inc, _unit(inc, a)), reflect_xf(inc, _unit(inc, c)), \
        reflect_xf(inc, _unit(inc, dpt))
    xf = {"x1": ra, "x2": xf_compose(ra, rd), "x3": rc}
    motion = flatmotion.rabbit(sorted(i for i, g in group.items() if g == "x1"),
                               sorted(i for i, g in group.items() if g == "x2"),
                               sorted(i for i, g in group.items() if g == "x3"),
                               inc, a, dpt, b, c)
    new = _move(st, group, xf, lambda i, j: None, lambda i, j: 1 if j not in group else -1,
                what, motion)
    return Move("rabbit-ear", state, new, par, motion, [i / 8 for i in range(1, 9)],
                {"incentre": inc, "corners": (a, b, c), "foot": dpt})


def _unit(o: Pt, p: Pt) -> Pt:
    dx, dy = p[0] - o[0], p[1] - o[1]
    ln = math.hypot(dx, dy)
    return (dx / ln, dy / ln)
