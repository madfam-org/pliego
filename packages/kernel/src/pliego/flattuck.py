"""Tucks: a flap folded into a pocket, between two layers (`pliego.flattuck`).

`tuck(state, line, direction, pocket=(q, n), at=, layers=, faces=, sheet_points=)` folds a flap
like `pliego.flatops.fold` — the same selection, the same line — but the flap does not land on
top of everything (valley) or under everything (mountain): at the folded point `q` of the area
it lands on, it slides under the top `n` layers there (valley) or over the bottom `n` (mountain).
Those layers and the paper continuing flat from them form the pocket's near wall; every other
order between the flap and the rest is solved from the parity constraints and checked by
`pliego.flatcheck` (layer order, taco / tortilla, Kawasaki, Maekawa) — layers joined to the
wall by a folded edge may end over the flap too (the pocket is under the whole flap that forms
it).

**The 3-D path.** While the pocket stays closed no rigid motion gets the flap inside: in the
hand the pocket's wall is lifted, or the flap bends. The move's motion is the simple fold's
rotation about the line — the best rigid path, exact in the preview. With paper of no thickness
it crosses nothing on the way down (`penetration_mm`, the longest crossing of a moving face
through a still face at the sampled states, is reported on the step) but it arrives on the near
side of the pocket's wall and ends behind it: the move's info lists those wall faces
(`crossed`), and the fold program reports their count (`pocket_crossings`). Both are reported,
not refused.
"""

from __future__ import annotations

from collections.abc import Iterable

from . import flatmotion
from .flatops import (
    Move,
    _move,
    _on_line,
    _require_top,
    _select,
    _side_of,
    _stack_at,
    flood,
    subdivide,
)
from .flatstate import FlatState, FlatStateError, as_line, pt, reflect_xf, side, xf_apply


def tuck(state: FlatState, line, direction: str = "valley", *, pocket, at=None,
         layers: int | None = None, faces: Iterable[int] | None = None,
         sheet_points: Iterable | None = None, from_: str | None = None) -> Move:
    """Fold the selected flap about the folded line into the pocket `pocket` = (q, n): at the
    folded point q, under the top n layers (valley) or over the bottom n (mountain). See the
    module docstring."""
    if direction not in ("valley", "mountain"):
        raise FlatStateError("direction must be valley or mountain")
    what = f"{direction} tuck"
    p, d = as_line(line)
    q, n = pt(pocket[0]), int(pocket[1])
    sgn = 1.0 if at is None else (1.0 if side(p, d, pt(at)) > 0 else -1.0)
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
    # the pocket's near wall: the top (valley) / bottom (mountain) n layers at q that stay, and
    # the paper continuing flat from them
    still = [f for f in range(len(st1.faces)) if f not in mv]
    stack = _stack_at(st1, q, still)
    if not 1 <= n < len(stack) + 1:
        raise FlatStateError(f"{what}: {n} layers over the pocket asked, {len(stack)} at the "
                             "point")
    wall0 = set(stack[-n:] if up else stack[:n])
    wall = flood(st1, wall0, lambda f: f not in mv,
                 lambda f, a, b: st1.crease_angle(f, st1.half_edges()[(b, a)]) != 0.0)
    landing = [f for f in mv if _covers(st1, f, refl, q)]
    if not landing:
        raise FlatStateError(f"{what}: the flap does not land on the pocket point")

    def rule(i: int, j: int) -> int | None:
        mi = i in mv
        other = j if mi else i
        if other in wall:
            r = -1 if up else 1
        else:
            return None
        return r if mi else -r

    def hint(i: int, j: int) -> int:
        mi = i in mv
        return (1 if mi else -1) * (1 if up else -1)
    group = {i: "m" for i in mv}
    sense = sgn * (1.0 if up else -1.0)
    motion = flatmotion.simple(sorted(mv), p, d, sense)
    new = _move(st1, group, {"m": refl}, rule, hint, what)
    # the rigid path arrives on the far side of the wall: the wall layers the flap ends behind
    crossed = sorted({j for j in wall for i in mv if new.above(i, j) is not None})
    return Move("tuck", state, new, par1, motion, [0.25, 0.5, 0.75, 1.0],
                {"line": (p, d), "direction": direction, "moving": sorted(mv),
                 "wall": sorted(wall), "split": st1, "crossed": crossed,
                 "pocket": (q, n)})


def _covers(state: FlatState, f: int, refl, q) -> bool:
    """Does face f, reflected by the fold, cover the folded point q?"""
    from .flatstate import inside_convex

    img = [xf_apply(refl, x) for x in state.image(f)]
    if len(img) >= 3:
        a = sum(img[i - 1][0] * img[i][1] - img[i][0] * img[i - 1][1] for i in range(len(img)))
        if a < 0:
            img.reverse()
    return inside_convex(q, img, -1e-6)


__all__ = ["tuck"]
