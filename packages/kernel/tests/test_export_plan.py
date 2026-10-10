"""Fabrication plan shared by the 2-D exporters: classification, chaining, holes, dashes."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from pliego.export import plan as P

SAMPLE = Path(__file__).parent / "golden_export" / "sample.fold.json"


def sample() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("assignment,treatment,expected", [
    ("B", "none", ("cut", "B")),
    ("C", "cut", ("cut", "C")),
    ("M", "crease", ("mountain", "M")),
    ("V", "crease", ("valley", "V")),
    ("F", "crease", ("score", "F")),
    ("V", "score", ("score", "score")),
    ("F", "halfcut", ("score", "halfcut")),
    ("C", "perforation", ("perforation", "perforation")),
    ("M", "perforation", ("perforation", "perforation")),
    ("J", "none", None),
    ("U", "none", None),
    ("F", "none", None),
])
def test_classify(assignment, treatment, expected):
    assert P.classify(assignment, treatment) == expected


def test_sample_plan_layers_and_chains():
    plan = P.build_plan(sample())
    layers = [(s.layer, s.kind, s.inner, s.closed, len(s.points)) for s in plan.strokes]
    assert ("cut", "B", False, True, 8) in layers          # panel outline, one closed loop
    assert ("mountain", "M", False, False, 2) in layers
    assert ("valley", "V", False, False, 2) in layers
    # both sides of the split carry the cut line; the plan keeps it once (3 points, 2 edges)
    cuts_c = [s for s in plan.strokes if s.kind == "C"]
    assert len(cuts_c) == 1 and cuts_c[0].inner and len(cuts_c[0].points) == 3
    assert plan.perf_factor == {0: 0.25, 1: 0.25}
    assert [g.points[0] for g in plan.glue] == [(85, 25)]   # sheet-local + offset (80, 0)
    assert [lb.text for lb in plan.labels] == ["Panel", "Tab"]


def test_hole_is_inner_and_outline_outer():
    outer = [(0, 0), (50, 0), (50, 50), (0, 50)]
    hole = [(20, 20), (20, 30), (30, 30), (30, 20)]
    coords = [list(p) for p in outer + hole]
    ev = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]]
    doc = {"vertices_coords": coords, "edges_vertices": ev, "edges_assignment": ["B"] * 8}
    plan = P.build_plan(doc)
    flags = [(s.closed, s.inner) for s in plan.strokes]
    assert flags == [(True, False), (True, True)]


def test_as_document_accepts_text_and_objects():
    d = sample()

    class Doc:
        def to_json(self) -> str:
            return json.dumps(d)

    assert P.as_document(json.dumps(d)) == d
    assert P.as_document(Doc()) == d
    with pytest.raises(ValueError):
        P.as_document({"nope": 1})


def test_perforation_dashes_follow_perf_factor():
    dashes = P.perforation_dashes(((0.0, 0.0), (40.0, 0.0)), False, 0.25)
    assert len(dashes) == 10
    assert all(math.isclose(b[0] - a[0], 3.0) for a, b in dashes)
    assert math.isclose(dashes[0][0][0], 0.5) and math.isclose(dashes[-1][1][0], 39.5)
    loop = P.perforation_dashes(((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)), True, 0.5)
    assert len(loop) == 10
    assert P.perforation_dashes(((1.0, 1.0), (1.0, 1.0)), False, 0.25) == []


def test_fmt_has_no_negative_zero():
    assert P.fmt(-0.0001) == "0" and P.fmt(12.5) == "12.5" and P.fmt(3.0) == "3"
