# Adapted from Fashion Cabinet fc/export/dxf.py (AGPL-3.0, Innovaciones MADFAM), for sheet layers.
"""DXF R12 (AC1009) export of a sheet document, layout frame in mm (y-up, as DXF).

Named layers: ``CUT``, ``MOUNTAIN``, ``VALLEY``, ``SCORE``, ``PERF``, ``GLUE``, ``TEXT``. MOUNTAIN
uses linetype ``DASHDOT`` and VALLEY ``DASHED`` (origami diagram convention) — CAD viewers show
them; cutters normally ignore linetypes and act per layer. Perforations are explicit ``LINE``
dashes on ``PERF`` so the cut pattern does not depend on linetype support. Cuts are written inner
features first (holes, interior cuts), then outer outlines.

``$INSUNITS = 4`` (mm) is written as FC does; strictly it is an R2000+ header variable that R12
readers ignore, so importers that assume inches still need the unit set by hand. Non-ASCII text
is escaped as ``\\U+XXXX`` (the AutoCAD convention) so the file stays 7-bit.
"""

from __future__ import annotations

from typing import Any

from .plan import Point, build_plan, perforation_dashes

# name → (ACI colour, linetype)
LAYERS: dict[str, tuple[int, str]] = {
    "CUT": (7, "CONTINUOUS"),
    "MOUNTAIN": (1, "DASHDOT"),
    "VALLEY": (5, "DASHED"),
    "SCORE": (3, "CONTINUOUS"),
    "PERF": (6, "CONTINUOUS"),
    "GLUE": (4, "CONTINUOUS"),
    "TEXT": (7, "CONTINUOUS"),
}
_PLAN_TO_DXF = {"cut": "CUT", "mountain": "MOUNTAIN", "valley": "VALLEY", "score": "SCORE",
                "perforation": "PERF"}
# linetype → (description, pattern elements in mm; negative = gap, 0 = dot)
LTYPES: dict[str, tuple[str, tuple[float, ...]]] = {
    "CONTINUOUS": ("Solid line", ()),
    "DASHED": ("Dashed __ __ __", (3.0, -1.5)),
    "DASHDOT": ("Dash dot __ . __ .", (6.0, -1.5, 0.0, -1.5)),
}
TEXT_HEIGHT_MM = 3.5


def _n(x: float) -> str:
    s = f"{x:.4f}"
    return "0.0000" if s == "-0.0000" else s


def _tag(code: int, value: object) -> str:
    return f"{code}\n{value}\n"


def _ascii(text: str) -> str:
    return "".join(ch if 32 <= ord(ch) < 127 else f"\\U+{ord(ch):04X}" for ch in text)


def _polyline(layer: str, pts: tuple[Point, ...], closed: bool) -> str:
    out = _tag(0, "POLYLINE") + _tag(8, layer) + _tag(66, 1) + _tag(10, _n(0)) + _tag(20, _n(0))
    out += _tag(30, _n(0)) + _tag(70, 1 if closed else 0)
    for x, y in pts:
        out += _tag(0, "VERTEX") + _tag(8, layer) + _tag(10, _n(x)) + _tag(20, _n(y))
        out += _tag(30, _n(0))
    return out + _tag(0, "SEQEND") + _tag(8, layer)


def _line(layer: str, a: Point, b: Point) -> str:
    return (_tag(0, "LINE") + _tag(8, layer) + _tag(10, _n(a[0])) + _tag(20, _n(a[1]))
            + _tag(30, _n(0)) + _tag(11, _n(b[0])) + _tag(21, _n(b[1])) + _tag(31, _n(0)))


def _text(layer: str, at: Point, value: str) -> str:
    return (_tag(0, "TEXT") + _tag(8, layer) + _tag(10, _n(at[0])) + _tag(20, _n(at[1]))
            + _tag(30, _n(0)) + _tag(40, _n(TEXT_HEIGHT_MM)) + _tag(1, _ascii(value)))


def _tables() -> str:
    ltypes = ""
    for name, (desc, pattern) in LTYPES.items():
        ltypes += (_tag(0, "LTYPE") + _tag(2, name) + _tag(70, 0) + _tag(3, desc) + _tag(72, 65)
                   + _tag(73, len(pattern)) + _tag(40, _n(sum(abs(p) for p in pattern))))
        for p in pattern:
            ltypes += _tag(49, _n(p))
    layers = "".join(
        _tag(0, "LAYER") + _tag(2, name) + _tag(70, 0) + _tag(62, color) + _tag(6, ltype)
        for name, (color, ltype) in LAYERS.items()
    )
    return (_tag(0, "SECTION") + _tag(2, "TABLES")
            + _tag(0, "TABLE") + _tag(2, "LTYPE") + _tag(70, len(LTYPES)) + ltypes
            + _tag(0, "ENDTAB")
            + _tag(0, "TABLE") + _tag(2, "LAYER") + _tag(70, len(LAYERS)) + layers
            + _tag(0, "ENDTAB") + _tag(0, "ENDSEC"))


def to_dxf(doc: Any, profile: str | None = None) -> str:
    """Render a sheet document to DXF R12 text (mm, layout frame); ``profile`` as in
    :func:`pliego.export.svg.to_svg` (dieline profile for packaging documents)."""
    from .dieline import resolve_profile

    if resolve_profile(doc, profile) == "dieline":
        from .dieline import to_dxf as dieline_dxf

        return dieline_dxf(doc)
    plan = build_plan(doc)
    x0, y0, x1, y1 = plan.bounds
    header = (_tag(0, "SECTION") + _tag(2, "HEADER")
              + _tag(9, "$ACADVER") + _tag(1, "AC1009")
              + _tag(9, "$INSUNITS") + _tag(70, 4)
              + _tag(9, "$EXTMIN") + _tag(10, _n(x0)) + _tag(20, _n(y0)) + _tag(30, _n(0))
              + _tag(9, "$EXTMAX") + _tag(10, _n(x1)) + _tag(20, _n(y1)) + _tag(30, _n(0))
              + _tag(0, "ENDSEC"))
    ents = _tag(0, "SECTION") + _tag(2, "ENTITIES")
    for layer in ("score", "mountain", "valley"):
        for s in plan.layer(layer):
            ents += _polyline(_PLAN_TO_DXF[layer], s.points, s.closed)
    for s in plan.layer("perforation"):
        for a, b in perforation_dashes(s.points, s.closed, plan.perf_factor[s.sheet]):
            ents += _line("PERF", a, b)
    cuts = plan.layer("cut")
    for s in [c for c in cuts if c.inner] + [c for c in cuts if not c.inner]:
        ents += _polyline("CUT", s.points, s.closed)
    for g in plan.glue:
        ents += _polyline("GLUE", g.points, True)
    for lb in plan.labels:
        ents += _text("TEXT", lb.at, lb.text)
    ents += _tag(0, "ENDSEC")
    return header + _tables() + ents + _tag(0, "EOF")
