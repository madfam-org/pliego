from __future__ import annotations

import pytest

from pliego import axioms
from pliego.geometry import Line, Vec2


def on(line: Line, p: Vec2) -> bool:
    return abs(line.side(p)) / line.p0.distance(line.p1) < 1e-9


def test_o1_o2_o4():
    (l1,) = axioms.o1((0, 0), (10, 10))
    assert on(l1, Vec2(5, 5))
    (l2,) = axioms.o2((0, 0), (10, 0))
    assert on(l2, Vec2(5, 3))
    (l4,) = axioms.o4((3, 3), ((0, 0), (10, 0)))
    assert on(l4, Vec2(3, 99))


def test_o3_bisectors_and_parallel():
    res = axioms.o3(((0, 0), (1, 0)), ((0, 0), (0, 1)))
    assert len(res) == 2 and any(on(r, Vec2(5, 5)) for r in res)
    (mid,) = axioms.o3(((0, 0), (1, 0)), ((0, 4), (1, 4)))
    assert on(mid, Vec2(7, 2))


def test_o5_and_o7_place_the_point_on_the_line():
    p, line = Vec2(0, 0), Line(Vec2(-10, 5), Vec2(10, 5))
    res = axioms.o5(p, line, (0, 3))
    assert len(res) == 2
    for r in res:
        assert on(r, Vec2(0, 3))
        assert abs(line.side(p.reflected(r.p0, r.p1))) < 1e-9
    (r7,) = axioms.o7(p, line, ((0, 0), (1, 1)))
    assert abs(line.side(p.reflected(r7.p0, r7.p1))) < 1e-9
    assert abs(r7.direction().dot(Vec2(1, 1).normalized())) < 1e-9


def test_o6_solutions_satisfy_both_conditions():
    p1, l1 = Vec2(0, 1), Line(Vec2(-10, -1), Vec2(10, -1))
    p2, l2 = Vec2(1, 0), Line(Vec2(-1, -10), Vec2(-1, 10))
    res = axioms.o6(p1, l1, p2, l2)
    assert 1 <= len(res) <= 3
    for r in res:
        assert abs(l1.side(p1.reflected(r.p0, r.p1))) < 1e-6 * 20
        assert abs(l2.side(p2.reflected(r.p0, r.p1))) < 1e-6 * 20


def test_degenerate_inputs():
    assert axioms.o1((1, 1), (1, 1)) == []
    assert axioms.o5((0, 0), ((0, 100), (1, 100)), (0, 1)) == []
    with pytest.raises(ValueError):
        axioms.o4((0, 0), ((1, 1), (1, 1)))
