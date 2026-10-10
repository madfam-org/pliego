"""World placement of un-placed multi-sheet documents (spec §5.14, hardening item 6)."""

from __future__ import annotations

import pliego

L4 = {"en": "Base", "es": "Base", "fr": "Base", "pt": "Base"}


def test_unplaced_sheets_lie_side_by_side_in_the_world(stocks):
    """Hardening item 6: un-placed sheets of a multi-sheet document take their layout offsets
    in the world instead of stacking at the origin; a cartridge that places or joins sheets
    keeps its own placements."""
    a = pliego.Sheet("a", pliego.rectangle(60, 40), label=L4)
    b = pliego.Sheet("b", pliego.rectangle(50, 30), label=L4)
    d = pliego.Assembly([a, b]).build(stocks=stocks)
    assert d.verify() == []
    origins = [s["placement"]["origin"] for s in d.sheets]
    assert origins[0] == [0.0, 0.0, 0.0] and origins[1] == [70.0, 0.0, 0.0]
    init = d.frame("initial")["vertices_coords"]
    vs = d.data["pliego:vertices_sheet"]
    xa = [p[0] for p, s in zip(init, vs, strict=True) if s == 0]
    xb = [p[0] for p, s in zip(init, vs, strict=True) if s == 1]
    assert max(xa) < min(xb)                                   # no overlap in the world
    placed = pliego.Sheet("c", pliego.rectangle(50, 30), label=L4,
                          placement=pliego.Placement((0.0, 5.0, 0.0)))
    d2 = pliego.Assembly([pliego.Sheet("a", pliego.rectangle(60, 40), label=L4), placed]).build(
        stocks=stocks)
    assert [s["placement"]["origin"] for s in d2.sheets] == [[0.0, 0.0, 0.0], [0.0, 5.0, 0.0]]
    single = pliego.Assembly([pliego.Sheet("a", pliego.rectangle(60, 40), label=L4)]).build(
        stocks=stocks)
    assert "file_frames" not in single.data
