"""Validity of a layer-ordered flat-folded state (`pliego.flatcheck`), and the layer-order solver.

A `FlatState` is a valid flat folding when (Demaine & O'Rourke, *Geometric Folding Algorithms*,
ch. 12; the constraint families of flat-folding layer order):

1. **placement**: the two faces of every crease put its end points at the same folded points;
2. **complete order**: every pair of faces whose images overlap with positive area is ordered;
3. **transitivity**: the faces covering any point of the folded frame are totally ordered — checked
   per cell of the overlay of all face images;
4. **taco-tortilla / tortilla-tortilla**: a face whose interior covers part of a crease's image
   lies on the same side (above or below) of both faces of that crease;
5. **taco-taco**: two folded creases whose images overlap on one line, with both tacos on the same
   side, nest or stay apart — never interleave; two flat creases there keep their faces in the
   same order on both sides; a flat crease's face never enters a folded crease's taco;
6. **Kawasaki and Maekawa** at every interior vertex of the folded creases (`pliego.flatfold`).

Families 4–5 are parity constraints (XOR of "a above b" literals = 0), the classical observation
that makes layer ordering a 2-SAT/GF(2) problem with transitivity on top. `solve()` uses them to
complete an order: Gaussian elimination over GF(2) on the unknown pairs, free variables taken from
the operation's hint, transitivity checked per cell (bounded search when the hint fails).

Issues use the verify-dict shape ``{level, kind, detail}``.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from .flatstate import (
    LINE_TOL,
    TOL,
    FlatState,
    FlatStateError,
    Pt,
    bbox,
    centroid,
    inside_convex,
    xf_apply,
)

SEARCH_LIMIT = 4096   # assignments tried when the hint breaks transitivity
PLACE_MM = 1e-4       # the two faces of a crease agree on its end points within this
CONTACT_MM = 1e-4     # a face covers a crease only by more than this (snapping noise is less)


# ── overlay cells ────────────────────────────────────────────────────────────

def _line_key(a: Pt, b: Pt) -> tuple[float, float, float, float] | None:
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    if ln < 1e-9:
        return None
    ux, uy = dx / ln, dy / ln
    if ux < -1e-12 or (abs(ux) <= 1e-12 and uy < 0):
        ux, uy = -ux, -uy
    return (ux, uy, ux * a[1] - uy * a[0], 0.0)


def _clip(poly: list[Pt], ux: float, uy: float, off: float, keep: float) -> list[Pt]:
    """Part of a convex polygon with keep·(ux·y − uy·x − off) ≥ 0."""
    out: list[Pt] = []
    n = len(poly)
    vals = [keep * (ux * p[1] - uy * p[0] - off) for p in poly]
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        sa, sb = vals[i], vals[(i + 1) % n]
        if sa >= 0:
            out.append(a)
        if (sa > 0 > sb) or (sa < 0 < sb):
            t = sa / (sa - sb)
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def _poly_area(poly: list[Pt]) -> float:
    n = len(poly)
    return 0.5 * sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(n))


def cells(state: FlatState) -> list[tuple[Pt, tuple[int, ...]]]:
    """One witness point per distinct overlap set of the folded overlay, with the faces covering
    it (sorted ids). Every overlapping pair and every triple sharing a region appears."""
    n = len(state.faces)
    imgs = [state.image(f) for f in range(n)]
    boxes = [bbox(im) for im in imgs]
    keys: list[list[tuple[float, float, float, float]]] = []
    for im in imgs:
        ks = []
        for i in range(len(im)):
            k = _line_key(im[i], im[(i + 1) % len(im)])
            if k is not None:
                ks.append(k)
        keys.append(ks)
    seen: dict[tuple[int, ...], Pt] = {}
    for f in range(n):
        x0, y0, x1, y1 = boxes[f]
        lines: list[tuple[float, float, float]] = []
        for g in range(n):
            if g == f:
                continue
            bx0, by0, bx1, by1 = boxes[g]
            if bx0 >= x1 - TOL or bx1 <= x0 + TOL or by0 >= y1 - TOL or by1 <= y0 + TOL:
                continue
            for ux, uy, off, _ in keys[g]:
                if not any(abs(ux - a) < 1e-9 and abs(uy - b) < 1e-9 and abs(off - c) < TOL
                           for a, b, c in lines):
                    lines.append((ux, uy, off))
        pieces = [imgs[f]]
        for ux, uy, off in lines:
            nxt = []
            for pc in pieces:
                vals = [ux * p[1] - uy * p[0] - off for p in pc]
                if max(vals) > TOL and min(vals) < -TOL:
                    for keep in (1.0, -1.0):
                        c = _clip(pc, ux, uy, off, keep)
                        if len(c) >= 3 and _poly_area(c) > TOL * TOL:
                            nxt.append(c)
                else:
                    nxt.append(pc)
            pieces = nxt
        for pc in pieces:
            q = centroid(pc)
            stack = tuple(g for g in range(n)
                          if boxes[g][0] < q[0] < boxes[g][2] and boxes[g][1] < q[1] < boxes[g][3]
                          and inside_convex(q, imgs[g], TOL))
            if f in stack and stack not in seen:
                seen[stack] = q
    return [(q, s) for s, q in seen.items()]


def overlap_pairs(cs: Iterable[tuple[Pt, tuple[int, ...]]]) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    for _, s in cs:
        for i, a in enumerate(s):
            for b in s[i + 1:]:
                out.add((a, b))
    return out


# ── parity constraints ───────────────────────────────────────────────────────

Lit = tuple[int, int]          # "face a above face b"


def _var(lit: Lit) -> tuple[tuple[int, int], int]:
    a, b = lit
    return ((a, b), 0) if a < b else ((b, a), 1)


def _seg_in_interior(p: Pt, q: Pt, poly: list[Pt]) -> bool:
    """A positive-length part of segment pq lies strictly inside the convex polygon."""
    lo, hi = 0.0, 1.0
    dx, dy = q[0] - p[0], q[1] - p[1]
    ln = math.hypot(dx, dy)
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        el = math.hypot(ex, ey)
        if el < 1e-12:
            continue
        s0 = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / el - CONTACT_MM
        s1 = (ex * (q[1] - a[1]) - ey * (q[0] - a[0])) / el - CONTACT_MM
        if s0 < 0 and s1 < 0:
            return False
        if s0 < 0 or s1 < 0:
            t = s0 / (s0 - s1)
            if s0 < 0:
                lo = max(lo, t)
            else:
                hi = min(hi, t)
    return (hi - lo) * ln > CONTACT_MM


def constraints(state: FlatState) -> list[tuple[tuple[Lit, ...], str]]:
    """Every parity constraint of the state: (literals whose XOR must be 0, kind)."""
    out: list[tuple[tuple[Lit, ...], str]] = []
    cr = state.creases()
    n = len(state.faces)
    imgs = [state.image(f) for f in range(n)]
    boxes = [bbox(im) for im in imgs]
    segs = []
    for c in cr:
        p, q = state.segment_image(c.f, c.a, c.b)
        cf, cg = centroid(imgs[c.f]), centroid(imgs[c.g])
        dx, dy = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        sf = 1 if ux * (cf[1] - p[1]) - uy * (cf[0] - p[0]) > 0 else -1
        sg = 1 if ux * (cg[1] - p[1]) - uy * (cg[0] - p[0]) > 0 else -1
        segs.append((c, p, q, sf, sg))
        # tortilla across the crease: any face covering part of it keeps one side of both faces
        sx0, sy0 = min(p[0], q[0]), min(p[1], q[1])
        sx1, sy1 = max(p[0], q[0]), max(p[1], q[1])
        for t in range(n):
            if t in (c.f, c.g):
                continue
            bx0, by0, bx1, by1 = boxes[t]
            if bx0 > sx1 + TOL or bx1 < sx0 - TOL or by0 > sy1 + TOL or by1 < sy0 - TOL:
                continue
            if _seg_in_interior(p, q, imgs[t]):
                out.append((((t, c.f), (t, c.g)),
                            "taco-tortilla" if c.angle else "tortilla-tortilla"))
    # creases sharing a line
    buckets: dict[tuple[int, int], list[int]] = {}
    for i, (_, p, q, _, _) in enumerate(segs):
        k = _line_key(p, q)
        buckets.setdefault((round(math.atan2(k[1], k[0]) * 1e4), round(k[2] * 1e2)), []).append(i)
    for (ka, kc), items in sorted(buckets.items()):
        near = sorted({j for da in (-1, 0, 1) for dc in (-1, 0, 1)
                       for j in buckets.get((ka + da, kc + dc), ())})
        for i in items:
            ci, pi, qi, sfi, sgi = segs[i]
            ux, uy = qi[0] - pi[0], qi[1] - pi[1]
            li = math.hypot(ux, uy)
            ux, uy = ux / li, uy / li
            for j in near:
                if j <= i:
                    continue
                cj, pj, qj, sfj, sgj = segs[j]
                if max(abs(ux * (r[1] - pi[1]) - uy * (r[0] - pi[0])) for r in (pj, qj)) > LINE_TOL:
                    continue
                tj = sorted((ux * (pj[0] - pi[0]) + uy * (pj[1] - pi[1]),
                             ux * (qj[0] - pi[0]) + uy * (qj[1] - pi[1])))
                if min(li, tj[1]) - max(0.0, tj[0]) <= TOL:
                    continue
                # orient j's sides in i's frame
                same = (ux * (qj[0] - pj[0]) + uy * (qj[1] - pj[1])) > 0
                sfj2, sgj2 = (sfj, sgj) if same else (-sfj, -sgj)
                f, g, h, k = ci.f, ci.g, cj.f, cj.g
                if len({f, g, h, k}) < 4:
                    continue
                if ci.angle and cj.angle:
                    if sfi == sfj2:
                        out.append((((f, h), (g, h), (f, k), (g, k)), "taco-taco"))
                elif ci.angle == 0.0 and cj.angle == 0.0:
                    a1, b1 = (f, g) if sfi > 0 else (g, f)
                    a2, b2 = (h, k) if sfj2 > 0 else (k, h)
                    out.append((((a1, a2), (b1, b2)), "tortilla-tortilla"))
                else:
                    (tf, tg, ts), (xf, xg, xs) = ((f, g, sfi), (h, k, sfj2)) if ci.angle \
                        else ((h, k, sfj2), (f, g, sfi))
                    # (xf, xg) is the flat pair, the taco (tf, tg) lies on side ts
                    x = xf if xs == ts else xg
                    out.append((((x, tf), (x, tg)), "taco-tortilla"))
    return out


# ── checking ─────────────────────────────────────────────────────────────────

def _transitive(state: FlatState, stack: tuple[int, ...]) -> tuple[bool, str]:
    below = {f: 0 for f in stack}
    for i, a in enumerate(stack):
        for b in stack[i + 1:]:
            up = state.above(a, b)
            if up is None:
                return False, f"faces {a} and {b} overlap but are unordered"
            below[a if up else b] += 1
    if sorted(below.values()) != list(range(len(stack))):
        return False, f"layer order of faces {list(stack)} is cyclic"
    return True, ""


def check(state: FlatState, *, local: bool = True, cs: list | None = None) -> list[dict]:
    """Every validity rule of the module docstring; [] when the state is a valid flat folding.
    `local=False` skips Kawasaki/Maekawa (they hold whenever 1–5 do; kept as a cross-check)."""
    issues: list[dict] = []
    pts = state.points
    for c in state.creases():
        fa, fb = state.faces[c.f].xf, state.faces[c.g].xf
        for v in (c.a, c.b):
            p, q = xf_apply(fa, pts[v]), xf_apply(fb, pts[v])
            if math.hypot(p[0] - q[0], p[1] - q[1]) > PLACE_MM:
                issues.append({"level": "error", "kind": "placement",
                               "detail": f"crease {c.a}–{c.b}: faces {c.f} and {c.g} place "
                               f"vertex {v} {math.hypot(p[0] - q[0], p[1] - q[1]):.3g} mm apart"})
    if issues:
        return issues
    cs = cells(state) if cs is None else cs
    for _, s in cs:
        ok, why = _transitive(state, s)
        if not ok:
            issues.append({"level": "error", "kind": "transitivity", "detail": why})
            if len(issues) > 20:
                return issues
    known = overlap_pairs(cs)
    stray = [k for k in state.order if k not in known]
    if stray:
        issues.append({"level": "error", "kind": "order",
                       "detail": f"{len(stray)} ordered pairs do not overlap, e.g. {stray[0]}"})
    if issues:
        return issues
    for lits, kind in constraints(state):
        par = 0
        for a, b in lits:
            up = state.above(a, b)
            if up is None:     # contact below the overlay's resolution: no layer passes there
                break
            par ^= int(up)
        else:
            if par:
                issues.append({"level": "error", "kind": kind,
                               "detail": f"{kind} violated by faces "
                               f"{sorted({x for lit in lits for x in lit})}"})
        if len(issues) > 20:
            break
    if local and not issues and not state.partial:
        issues.extend(local_check(state))
    return issues


def local_check(state: FlatState) -> list[dict]:
    """Kawasaki, Maekawa and big-little-big at every interior vertex of the folded creases."""
    from .flatfold import check as ff_check

    sheet = state.unfold("check", folded_only=True)
    if not sheet.marks:
        return []
    _, issues = ff_check(sheet.build())
    return [i for i in issues if i["level"] == "error"]


def require_valid(state: FlatState, what: str, cs: list | None = None) -> None:
    issues = check(state, cs=cs)
    if issues:
        raise FlatStateError(f"{what}: not a valid flat folding — "
                             + "; ".join(i["detail"] for i in issues[:4]))


# ── solving ──────────────────────────────────────────────────────────────────

def solve(state: FlatState, hint: dict[tuple[int, int], int],
          cs: list | None = None) -> FlatState:
    """Complete the layer order of `state`: pairs already in `state.order` are fixed; every
    other overlapping pair is solved from the parity constraints and transitivity, taking the
    hint (same encoding as `order`) wherever the constraints leave a choice. Fails loud when no
    valid order exists (within SEARCH_LIMIT assignments)."""
    cs = cells(state) if cs is None else cs
    pairs = sorted(overlap_pairs(cs))
    fixed = {k: s for k, s in state.order.items()}
    unknown = [k for k in pairs if k not in fixed]
    index = {k: i for i, k in enumerate(unknown)}
    rows: list[tuple[int, int]] = []   # (bitmask over unknowns, parity)
    for lits, kind in constraints(state.derive(order={**fixed, **{k: 1 for k in unknown}})):
        mask, par = 0, 0
        for lit in lits:
            key, neg = _var(lit)
            par ^= neg
            if key in index:
                mask ^= 1 << index[key]
            elif key in fixed:
                par ^= int(fixed[key] > 0)
            else:              # contact below the overlay's resolution
                mask, par = 0, 0
                break
        if mask:
            rows.append((mask, par))
        elif par:
            raise FlatStateError(f"no layer order exists: {kind} fixed by earlier layers fails")
    # Gaussian elimination
    pivots: dict[int, tuple[int, int]] = {}
    for mask, par in rows:
        for bit, (pm, pp) in pivots.items():
            if mask >> bit & 1:
                mask ^= pm
                par ^= pp
        if not mask:
            if par:
                raise FlatStateError("no layer order satisfies the taco/tortilla constraints")
            continue
        bit = mask.bit_length() - 1
        for b2, (pm, pp) in list(pivots.items()):
            if pm >> bit & 1:
                pivots[b2] = (pm ^ mask, pp ^ par)
        pivots[bit] = (mask, par)
    free = [i for i in range(len(unknown)) if i not in pivots]

    def assign(choice: dict[int, int]) -> dict[tuple[int, int], int]:
        val = dict(choice)
        for bit, (mask, par) in pivots.items():
            v = par
            m = mask & ~(1 << bit)
            while m:
                low = m & -m
                v ^= val[low.bit_length() - 1]
                m ^= low
            val[bit] = v
        return {unknown[i]: (1 if val[i] else -1) for i in range(len(unknown))}

    def default(i: int) -> int:
        return 1 if hint.get(unknown[i], 1) > 0 else 0

    base = {i: default(i) for i in free}
    tried = 0
    order_try = [base] + [{**base, i: 1 - base[i]} for i in free]
    queue = list(order_try)
    while queue and tried < SEARCH_LIMIT:
        choice = queue.pop(0)
        tried += 1
        cand = state.derive(order={**fixed, **assign(choice)})
        if all(_transitive(cand, s)[0] for _, s in cs):
            return cand
        if tried == len(order_try) and len(free) <= 12:
            queue = []
            for m in range(1 << len(free)):
                queue.append({i: (base[i] ^ (m >> k & 1)) for k, i in enumerate(free)})
    raise FlatStateError(f"no transitive layer order found ({len(free)} free choices, "
                         f"{tried} tried)")
