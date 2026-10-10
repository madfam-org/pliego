"""Kinematic fold programs: key-pose `Step`s → exact rigid in-between steps (spec §5.6).

Used by `Sequence.kinematic_path`. Step semantics follow the spec: a step lists only the creases
it moves and every crease it does not list holds its current angle; `release` hands a crease
back (in kinematic mode it is then free to follow closure in later steps); the program starts
from the given start angles (the initial frame's) or from flat.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from . import motion

ARRIVE_TOL_DEG = 1e-5   # a listed crease must end this close to its target
MOVE_TOL_DEG = 1e-9


def kinematic_steps(system: Any, steps: list, start: Any, substeps: int | Mapping[str, int]
                    ) -> tuple[list, dict]:
    from .assembly import EdgeRef, Step
    from .document import Document
    from .sheet import Mark, Sheet

    if isinstance(system, Document):
        if len(system.data.get("pliego:sheets") or []) != 1:
            raise ValueError("kinematic_path needs a Sheet or a single-sheet Document")
        sheet = None
        design = list(system.data["edges_foldAngle"])
    elif isinstance(system, Sheet):
        sheet = system
        design = list(system.build().fold_angle)
    else:
        raise TypeError(f"kinematic_path needs a Sheet or a Document, not {type(system).__name__}")
    _, edges, asg, _ = motion._arrays(system)

    def edges_of(t: Any) -> list[int]:
        if isinstance(t, Mark):
            if t.sheet is not sheet:
                raise ValueError(f"mark {t.index} does not belong to the program's sheet")
            return t.edges()
        if isinstance(t, EdgeRef):
            if t.sheet is not sheet:
                raise ValueError(f"edge reference {t.edge} does not belong to the program's sheet")
            return [t.edge]
        if isinstance(t, int) and not isinstance(t, bool) and 0 <= t < len(edges):
            return [t]
        raise ValueError(f"step target {t!r} is not a Mark, EdgeRef or edge index")

    def ref(e: int) -> Any:
        return e if sheet is None else EdgeRef(sheet, e)

    if isinstance(start, Mapping) and isinstance(start.get("angles"), Mapping):
        start = start["angles"]
    cur: dict[int, float] = {e: float(a) for e, a in motion._expand(start or {}, sheet).items()}
    released: set[int] = set()
    out: list = []
    worst, dof, branch_steps = 0.0, 0, []
    for st in steps:
        if not isinstance(st, Step):
            raise TypeError("kinematic_path takes pliego.Step key poses")
        targets: dict[int, float] = {}
        for t, ang in st.targets:
            for e in edges_of(t):
                targets[e] = float(design[e] if ang is None else ang)
        freed = [e for r in st.release for e in edges_of(r)]
        n = int(substeps.get(st.id, 8) if isinstance(substeps, Mapping) else substeps)
        moving = {e: a for e, a in targets.items() if abs(a - cur.get(e, 0.0)) > MOVE_TOL_DEG}
        if not moving or n < 1:
            out.append(Step(st.id, st.label, [(ref(e), a) for e, a in targets.items()],
                            [ref(e) for e in freed], st.duration_ms, st.note,
                            list(st.remove)))
        else:
            var = [e for e, a in enumerate(asg) if a in ("M", "V", "U")]
            fixed = [e for e in var if e not in targets and e not in released]
            path = motion.solve(system, cur, targets, fixed, n, along="chord")
            final = path[-1]
            for e, a in targets.items():
                if abs(final[e] - a) > ARRIVE_TOL_DEG:
                    raise motion.KinematicsError(
                        f"step '{st.id}': the rigid motion brings edge {e} to {final[e]:.6f}°, "
                        f"not its target {a:.6f}° (the targets are not on one rigid branch)")
            worst = max(worst, path.max_residual_rad)
            dof = max(dof, path.dof)
            prev = dict(cur)
            for k, state in enumerate(path, 1):
                moved = [e for e in path.edges if e in targets
                         or abs(state[e] - prev.get(e, 0.0)) > MOVE_TOL_DEG]
                label = {lang: f"{text} ({k}/{n})" for lang, text in st.label.items()}
                sid = st.id if n == 1 else f"{st.id}-{k}"
                out.append(Step(sid, label,
                                [(ref(e), targets[e] if k == n and e in targets else state[e])
                                 for e in moved],
                                [ref(e) for e in freed] if k == 1 else [],
                                max(100, round(st.duration_ms / n)),
                                st.note if k == 1 else None,
                                list(st.remove) if k == n else []))
                prev = state
            if path.branch_steps:
                branch_steps.append(st.id)
            cur.update({e: (targets[e] if e in targets else a) for e, a in final.items()})
        for e, a in targets.items():
            cur[e] = a
        released |= set(freed)
        released -= set(targets)
    report = {"steps": len(out), "dof": dof, "max_residual_rad": worst,
              "branch_steps": branch_steps}
    if not math.isfinite(worst):
        raise motion.KinematicsError("non-finite residual in the kinematic program")
    return out, report
