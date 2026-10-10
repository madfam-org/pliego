from __future__ import annotations

import math
import random

import pytest
from conftest import KAMI

import pliego
from pliego.arrangement import SegmentInput, build_arrangement
from pliego.geometry import Vec2, circle, is_simple_polygon, polygon_area, square


def _check(arr):
    lhs, rhs = arr.euler()
    assert lhs == rhs
    v = arr.vertices
    for f in arr.faces:
        ring = [v[i] for i in f]
        assert polygon_area(ring) > 0
        assert is_simple_polygon(ring)


@pytest.mark.parametrize("seed", range(8))
def test_euler_on_random_arrangements(seed):
    rnd = random.Random(seed)
    segs = []
    for k in range(12):
        a = Vec2(rnd.uniform(-20, 120), rnd.uniform(-20, 120))
        b = Vec2(rnd.uniform(-20, 120), rnd.uniform(-20, 120))
        segs.append(SegmentInput(a, b, "V" if k % 2 else "M", 90.0 if k % 2 else -90.0,
                                 "crease", k))
    _check(build_arrangement(square(100), [], segs))


def test_hole_bridging_yields_simple_faces():
    arr = build_arrangement(square(100), [list(reversed(circle((50, 50), 10, 16))),
                                          list(reversed(circle((20, 20), 5, 8)))], [])
    _check(arr)
    assert arr.hole_faces == 2
    assert arr.assignment.count("J") >= 3  # each hole needs two bridges; one may be shared


def test_slits_and_floating_lines_are_split_with_j_edges():
    s = pliego.Sheet("k", pliego.square(100))
    s.cut([(0, 50), (40, 50)])
    s.valley((60, 20), (60, 80), angle=90)
    arr = s.build()
    _check(arr)
    assert "J" in arr.assignment and "C" in arr.assignment


def test_overlap_priority_and_t_junction_snapping():
    segs = [
        SegmentInput(Vec2(0, 50), Vec2(100, 50), "F", 0.0, "score", 0),
        SegmentInput(Vec2(20, 50), Vec2(80, 50), "V", 180.0, "crease", 1),
        SegmentInput(Vec2(50, 50.00005), Vec2(50, 100), "M", -180.0, "crease", 2),  # T, 5e-5 off
    ]
    arr = build_arrangement(square(100), [], segs)
    _check(arr)
    mid = [e for e, (a, b) in enumerate(arr.edges)
           if all(abs(arr.grid[v][1] - 50_000_000) <= 100 for v in (a, b))]
    kinds = sorted((arr.assignment[e], arr.treatment[e]) for e in mid)
    assert kinds.count(("V", "crease")) == 2  # the crease wins over the score where they overlap
    assert kinds.count(("F", "score")) == 2
    t = next(i for i, g in enumerate(arr.grid) if g == (50_000_000, 50_000_050))
    assert sum(t in e for e in arr.edges) == 3  # the T endpoint splits the line (no gap)
    assert not arr.warnings


def test_coincident_conflict_warns():
    segs = [SegmentInput(Vec2(0, 50), Vec2(100, 50), "V", 180.0, "crease", 0),
            SegmentInput(Vec2(0, 50), Vec2(100, 50), "M", -180.0, "crease", 1)]
    arr = build_arrangement(square(100), [], segs)
    assert arr.warnings and arr.warnings[0]["kind"] == "overlap_conflict"


def test_canonical_under_shuffled_authoring():
    lines = [((0, 0), (100, 100), "valley"), ((100, 0), (0, 100), "mountain"),
             ((0, 50), (100, 50), "valley"), ((50, 0), (50, 100), "mountain")]

    def build(order):
        s = pliego.Sheet("s", pliego.square(100))
        for i in order:
            a, b, k = lines[i]
            s.crease(a, b, k)
        arr = s.build()
        return (arr.grid, arr.edges, arr.assignment, arr.fold_angle, arr.faces)

    assert build([0, 1, 2, 3]) == build([3, 1, 0, 2]) == build([2, 3, 1, 0])


# ── J-edge bridging (kernel 0.2): batched, two bridges per hole, no slivers ──


def _close_holes(gap: float, n: int = 3, size: float = 10.0) -> pliego.Sheet:
    s = pliego.Sheet("holes", pliego.rectangle(80, 60))
    x = 10.0
    for k in range(n):
        s.hole(pliego.square(size, (x, 20 + (k % 2) * 0.7)))
        x += size + gap
    return s


@pytest.mark.parametrize("gap", [0.6, 1.0, 1.5, 3.0])
def test_closely_spaced_holes_bridge_without_slivers(gap):
    """Holes attach to the host or to holes already attached, two bridges each, so the J edges
    never form thin pieces between neighbouring holes (kernel 0.1 left 6–30 mm² slivers)."""
    arr = _close_holes(gap).build()
    areas = [pliego.polygon_area([arr.vertices[v] for v in f]) for f in arr.faces]
    assert len(arr.faces) == 4 and min(areas) > 100.0
    assert arr.assignment.count("J") == 6
    doc = pliego.Assembly([_close_holes(gap)]).build(stocks={"kami": KAMI})
    assert doc.verify() == []


def test_many_holes_need_few_bridging_passes():
    s = pliego.Sheet("grid", pliego.rectangle(200, 200))
    for i in range(7):
        for j in range(7):
            s.hole(pliego.square(12, (10 + 26 * i, 10 + 26 * j)))
    arr = s.build()
    assert arr.assignment.count("J") == 2 * 49 and len(arr.faces) == 50
    assert all(pliego.polygon_area([arr.vertices[v] for v in f]) > 0 for f in arr.faces)


def test_j_joined_faces_share_one_area_floor():
    """verify(): a thin J-bounded piece counts with the faces across its J edges."""
    s = pliego.Sheet("j", pliego.rectangle(60, 40))
    s.hole(pliego.square(10, (20, 15)))
    doc = pliego.Assembly([s]).build(stocks={"kami": KAMI})
    assert doc.verify(min_face_area_mm2=1500.0) == []          # union 2400 − 100 = 2300 mm²
    kinds = [i["kind"] for i in doc.verify(min_face_area_mm2=2400.0)]
    assert kinds == ["face_degenerate"]


# ── J-edge clearance (hardening item 1): a bridge must not graze a corner ───────────────


def _hole16(cx, cy, r=1.0, turn=0.5):
    rr = r / math.cos(math.pi / 16)
    return [(cx + rr * math.cos(2 * math.pi * (k + turn) / 16),
             cy + rr * math.sin(2 * math.pi * (k + turn) / 16)) for k in range(16)]


def _grazing_sheet():
    """Minimal case from a stab-bound cover (hemp-leaf, H = 210 mm): exact visibility accepts a
    J edge that passes 8e-5 mm from a corner of its own hole, below the emit tolerance."""
    left = [(0.0, v) for v in (196.875, 183.75, 157.5, 131.25, 105.0, 78.75, 52.5, 26.25,
                               13.125)]
    s = pliego.Sheet("cover", [(0.0, 0.0), (150.0, 0.0), (150.0, 210.0), (0.0, 210.0)] + left)
    s.hole(_hole16(10.0, 78.75))
    s.hole(_hole16(20.0, 52.5))
    return s


def _faces_simple(arr):
    v = arr.vertices
    return all(len(set(f)) == len(f) and is_simple_polygon([v[i] for i in f]) for f in arr.faces)


def test_bridges_keep_clear_of_corners(monkeypatch):
    from pliego import arrangement_dcel

    s = _grazing_sheet()
    arr = s.build()
    _check(arr)
    assert _faces_simple(arr)
    # the fixture really exercises the graze: exact visibility alone leaves a non-simple face
    monkeypatch.setattr(arrangement_dcel, "CLEARANCE", 0)
    old = build_arrangement(list(s.outline), list(s.holes), [])
    assert not _faces_simple(old)


def test_bridge_clearance_document_verifies(stocks):
    s = _grazing_sheet()
    s.label = {"en": "Cover", "es": "Tapa", "fr": "Couverture", "pt": "Capa"}
    doc = pliego.Assembly([s]).build(stocks=stocks)
    issues = doc.verify()
    assert not [i for i in issues if i["level"] == "error"], issues


# Three octagonal lace holes of a 6-fold doily (density 5, 200 mm), their facing sides collinear on
# one radial line: exact visibility bridged along that line, 5e-7 mm from two hole corners.
_LACE = [
    [(11.725406, 103.492961), (11.845287, 104.403544), (12.573935, 104.962655),
     (13.484517, 104.842775), (14.043628, 104.114127), (13.923748, 103.203544),
     (13.1951, 102.644433), (12.284517, 102.764314)],
    [(12.388408, 111.071102), (12.508288, 111.981685), (13.236936, 112.540796),
     (14.147519, 112.420916), (14.70663, 111.692268), (14.586749, 110.781685),
     (13.858102, 110.222574), (12.947519, 110.342455)],
    [(13.709365, 118.562622), (13.829245, 119.473205), (14.557893, 120.032316),
     (15.468476, 119.912435), (16.027587, 119.183787), (15.907706, 118.273205),
     (15.179059, 117.714094), (14.268476, 117.833974)],
]


def test_collinear_lace_holes_bridge_clear(monkeypatch):
    from pliego import arrangement_dcel

    disc = [(100 + 94 * math.cos(2 * math.pi * k / 96), 100 + 94 * math.sin(2 * math.pi * k / 96))
            for k in range(96)]
    s = pliego.Sheet("doily", disc)
    for h in _LACE:
        s.hole(h)
    arr = s.build()
    _check(arr)
    assert _faces_simple(arr)
    monkeypatch.setattr(arrangement_dcel, "CLEARANCE", 0)
    assert not _faces_simple(build_arrangement(list(s.outline), list(s.holes), []))
