from __future__ import annotations

import random

import pytest

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
