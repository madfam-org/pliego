"""Tier R board thickness: hinge axes off the mid-surface for thick sheets (kernel reference).

:func:`pliego.kinematics.face_transforms` poses a sheet as zero-thickness faces turning about
their creases on the mid-surface. Board (greyboard, folding boxboard, corrugated) is 0.3–7 mm
thick, and a hinge on the mid-surface makes the two panels interpenetrate on the inside of the
fold. This module poses a thick sheet with each crease's rotation axis moved to where board of
caliper ``t`` actually turns, for three hinge models of a fold of magnitude ρ:

========  ===========================================  =============  ==========  ===========
hinge     axis                                          inside overlap  liner arc   V-groove
========  ===========================================  =============  ==========  ===========
``mid``   the mid-surface (the zero-thickness pose)     (t/2)·tan(ρ/2)  (t/2)·ρ     —
``inner`` the inside face of the fold (a crushed score)  0               t·ρ         —
``outer`` the outside face (a V-groove or mitre cut)    t·tan(ρ/2)      0           2·t·tan(ρ/2)
========  ===========================================  =============  ==========  ===========

*Inside overlap* is how far each panel would run into the other, measured along the panel from
the hinge line, if the board were not crushed or cut; *liner arc* is the length the outside
liner must span round the hinge; the *V-groove* is the width at the inside face (depth t) an
outer hinge must cut away to close to ρ without overlap. At ρ = 180° a mid or outer hinge cannot
fold (unbounded overlap); an inner hinge stacks the two panels flush, mid-surfaces exactly t
apart.

**Inside dimensions.** Between two parallel walls raised to 90° from one panel of length P, the
inside length is ``P − panel_allowance(t, hinge)``: t for ``mid`` (the allowance the dieline
generators use), 0 for ``inner``, 2t for ``outer``.

**Scope.** The offset pose is exact on a *face tree*, where every fold line separates the sheet
(every dieline is one: flaps are parted by slots and slits). At a closed vertex the offset axes
no longer meet in one point, so a rigid thick pose generally does not exist (the offset-panel
technique of Edmondson et al., 2014, solves it for chosen patterns only); :func:`face_transforms`
refuses a sheet whose folds close a loop unless the hinge is ``mid``. The pose is continuous in
each angle: the axis changes side where ρ changes sign, and there the rotation is the identity.
Faces become separate slabs, so :func:`pose_faces` gives every face its own vertex positions
(mid-surface, the un-placed frame of ``kinematics``). The engine's Tier R does not read this
yet; the zero-thickness pose stays the default everywhere.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from . import kinematics
from .arrangement import Arrangement
from .geometry import Vec2
from .space import IDENTITY3, Vec3, unplaced

HINGES = ("mid", "inner", "outer")


class ThicknessError(ValueError):
    """A thickness request the model cannot answer (bad caliper or hinge, or a closed loop)."""


def _check(caliper_mm: float, hinge: str) -> float:
    if hinge not in HINGES:
        raise ThicknessError(f"hinge must be one of {HINGES}, got {hinge!r}")
    t = float(caliper_mm)
    if not (math.isfinite(t) and t >= 0.0):
        raise ThicknessError(f"caliper must be a finite non-negative mm value, got {caliper_mm!r}")
    return t


def axis_offset(angle_deg: float, caliper_mm: float, hinge: str = "inner") -> float:
    """Signed offset (mm) of a crease's rotation axis along the flat sheet's front normal (+Y).

    A positive (valley) angle folds toward +Y, so the inside of the fold is +Y: ``inner`` moves
    the axis +t/2, ``outer`` −t/2; a mountain mirrors both; ``mid`` and ρ = 0 give 0."""
    t = _check(caliper_mm, hinge)
    side = (angle_deg > 0) - (angle_deg < 0)
    if hinge == "mid" or side == 0:
        return 0.0
    return side * t / 2.0 if hinge == "inner" else -side * t / 2.0


def panel_allowance(caliper_mm: float, hinge: str = "inner") -> float:
    """How much longer a panel is than the inside length between the two walls raised to 90°
    from its opposite edges: t (mid), 0 (inner), 2t (outer)."""
    t = _check(caliper_mm, hinge)
    return {"mid": t, "inner": 0.0, "outer": 2.0 * t}[hinge]


def fold_loops(arr: Arrangement) -> int:
    """Independent closed loops of the face graph across foldable edges (0 for a face tree).

    Several collinear edges between the same two faces (a crease split at a T-junction) count
    once: they are one hinge."""
    adj = kinematics.face_adjacency(arr)
    pairs = {frozenset((f, g)) for f, nb in adj.items() for g, _e, _a, _b in nb if f != g}
    seen: set[int] = set()
    components = 0
    for start in adj:
        if start in seen or not adj[start]:
            continue
        components += 1
        stack = [start]
        while stack:
            f = stack.pop()
            if f in seen:
                continue
            seen.add(f)
            stack.extend(g for g, _e, _a, _b in adj[f] if g not in seen)
    return len(pairs) - len(seen) + components


def face_transforms(arr: Arrangement, angles: dict[int, float], caliper_mm: float,
                    hinge: str = "inner", root: int = 0) -> list[kinematics.Rigid | None]:
    """Rigid transform of every face of a thick sheet (BFS from `root`, un-placed frame)."""
    t = _check(caliper_mm, hinge)
    if hinge != "mid" and t > 0.0:
        loops = fold_loops(arr)
        if loops:
            raise ThicknessError(f"thick hinges are exact on face trees only; this sheet's folds "
                                 f"close {loops} loop(s) (use hinge='mid' or cut the loop)")
    return kinematics.face_transforms(arr, angles, root,
                                      axis_offset=lambda _e, deg: axis_offset(deg, t, hinge))


def pose_faces(arr: Arrangement, angles: dict[int, float], caliper_mm: float,
               hinge: str = "inner", root: Vec2 | None = None) -> list[list[Vec3]]:
    """Mid-surface vertex positions of every face, face by face (a thick hinge separates the
    two faces' copies of a shared crease vertex). Faces cut off from the root stay flat."""
    tr = face_transforms(arr, angles, caliper_mm, hinge, kinematics.root_face(arr, root))
    pts = [unplaced(v.x, v.y) for v in arr.vertices]
    flat = (IDENTITY3, (0.0, 0.0, 0.0))
    return [[kinematics._apply(tr[fi] or flat, pts[v]) for v in face]
            for fi, face in enumerate(arr.faces)]


def groove(caliper_mm: float, fold_deg: float) -> float:
    """Width (mm) of the V-groove at the inside face, depth t, that lets an outer hinge close
    to `fold_deg` with the two cut faces meeting: 2·t·tan(ρ/2)."""
    t = _check(caliper_mm, "outer")
    rho = abs(float(fold_deg))
    if not rho < 180.0:
        raise ThicknessError("an outer hinge cannot fold to 180°: the groove would be unbounded")
    return 2.0 * t * math.tan(math.radians(rho) / 2.0)


def hinge_report(angle_deg: float, caliper_mm: float, hinge: str = "inner") -> dict:
    """What a fold of `angle_deg` asks of board of `caliper_mm` under each hinge model.

    ``overlap_mm`` is per panel along the panel from the hinge line (``math.inf`` when the fold
    cannot close), ``liner_arc_mm`` the outside liner's span round the hinge, ``groove_mm`` the
    V-groove an outer hinge needs (``None`` for the other models); ``foldable`` is False when
    the model cannot reach the angle at all."""
    t = _check(caliper_mm, hinge)
    rho = math.radians(min(abs(float(angle_deg)), 180.0))
    closes = rho < math.pi
    half_tan = math.tan(rho / 2.0) if closes else math.inf
    out = {"hinge": hinge, "angle_deg": float(angle_deg), "caliper_mm": t}
    if t == 0.0:                       # paper of no thickness: every model is the same fold
        return dict(out, overlap_mm=0.0, liner_arc_mm=0.0,
                    groove_mm=0.0 if hinge == "outer" else None, foldable=True)
    if hinge == "mid":
        overlap, arc, cut = (t / 2.0) * half_tan, (t / 2.0) * rho, None
    elif hinge == "inner":
        overlap, arc, cut = 0.0, t * rho, None
    else:
        overlap, arc, cut = t * half_tan, 0.0, 2.0 * t * half_tan
    return dict(out, overlap_mm=overlap, liner_arc_mm=arc, groove_mm=cut,
                foldable=hinge == "inner" or closes)


def sheet_report(arr: Arrangement, angles: dict[int, float], caliper_mm: float,
                 hinge: str = "inner", edges: Iterable[int] | None = None) -> list[dict]:
    """:func:`hinge_report` for every folded edge (non-zero angle) of `angles`, by edge index."""
    _check(caliper_mm, hinge)
    wanted = sorted(angles if edges is None else edges)
    return [dict(hinge_report(angles[e], caliper_mm, hinge), edge=e)
            for e in wanted if e in angles and angles[e] != 0.0]
