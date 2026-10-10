"""HPGL export of a sheet document for pen plotters and drag-knife cutters.

Plotter units: 40 units per mm (the HP-GL standard 0.025 mm unit), integer coordinates, origin at
the lower-left of the plotted lines, y-up (as the layout frame). One ``SP`` pen per pass, in
fabrication order:

1. ``SP1`` — score pass (``score`` treatment, flat creases, kiss cuts);
2. ``SP2`` — fold lines (mountain + valley creases; map the pen to a scoring tool, a pen or skip);
3. ``SP3`` — perforation pass (explicit cut dashes);
4. ``SP4`` — cut pass: inner features (holes, interior cuts) before outer outlines, so the part is
   still held by the sheet while its inside is cut.

Labels, glue zones and registration marks are not plotted (they belong to print, SVG or PDF).
"""

from __future__ import annotations

from typing import Any

from .plan import Point, build_plan, perforation_dashes

UNITS_PER_MM = 40
PEN_SCORE, PEN_FOLD, PEN_PERF, PEN_CUT = 1, 2, 3, 4


def to_hpgl(doc: Any) -> str:
    """Render a sheet document to HPGL text (score → fold → perforation → cut inner → outer)."""
    plan = build_plan(doc)
    plotted = [p for s in plan.strokes for p in s.points] or [(0.0, 0.0)]
    x0, y0 = min(p[0] for p in plotted), min(p[1] for p in plotted)

    def pu(p: Point) -> str:
        return f"{round((p[0] - x0) * UNITS_PER_MM)},{round((p[1] - y0) * UNITS_PER_MM)}"

    def stroke(pts: list[Point] | tuple[Point, ...], closed: bool) -> str:
        seq = list(pts) + ([pts[0]] if closed else [])
        return f"PU{pu(seq[0])};PD{','.join(pu(p) for p in seq[1:])};"

    out = ["IN;"]
    passes: list[tuple[int, list[str]]] = [
        (PEN_SCORE, [stroke(s.points, s.closed) for s in plan.layer("score")]),
        (PEN_FOLD, [stroke(s.points, s.closed)
                    for s in plan.layer("mountain") + plan.layer("valley")]),
        (PEN_PERF, [stroke([a, b], False) for s in plan.layer("perforation")
                    for a, b in perforation_dashes(s.points, s.closed,
                                                   plan.perf_factor[s.sheet])]),
    ]
    cuts = plan.layer("cut")
    passes.append((PEN_CUT, [stroke(s.points, s.closed)
                             for s in [c for c in cuts if c.inner] + [c for c in cuts
                                                                      if not c.inner]]))
    for pen, cmds in passes:
        if cmds:
            out.append(f"SP{pen};")
            out.extend(cmds)
    out.append("PU;SP0;")
    return "\n".join(out) + "\n"
