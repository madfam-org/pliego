from __future__ import annotations

import math

from pliego.geometry import (
    Arc,
    Bezier,
    Vec2,
    emit,
    is_simple_polygon,
    offset_ring,
    point_in_polygon,
    polygon_area,
    rectangle,
    segment_intersection,
    simplify,
    square,
)


def test_segment_intersection_with_tolerance():
    hit = segment_intersection(Vec2(0, 0), Vec2(10, 0), Vec2(5, -5), Vec2(5, 5))
    assert hit == Vec2(5, 0)
    # a T that stops 5e-5 mm short still touches within EPS
    assert segment_intersection(Vec2(0, 0), Vec2(10, 0), Vec2(5, 5), Vec2(5, 5e-5)) is not None
    assert segment_intersection(Vec2(0, 0), Vec2(10, 0), Vec2(5, 5), Vec2(5, 1e-2)) is None
    assert segment_intersection(Vec2(0, 0), Vec2(10, 0), Vec2(0, 1), Vec2(10, 1)) is None


def test_polygon_basics():
    sq = square(10)
    assert polygon_area(sq) == 100
    assert polygon_area(list(reversed(sq))) == -100
    assert point_in_polygon(Vec2(5, 5), sq) == 1
    assert point_in_polygon(Vec2(10, 5), sq) == 0
    assert point_in_polygon(Vec2(11, 5), sq) == -1
    assert is_simple_polygon(sq)
    assert not is_simple_polygon([Vec2(0, 0), Vec2(1, 1), Vec2(1, 0), Vec2(0, 1)])


def test_offset_ring_per_segment():
    ring = offset_ring(rectangle(20, 10), [0.0, 5.0, 0.0, 0.0])
    assert abs(polygon_area(ring) - 250.0) < 1e-9


def test_curves_flatten_within_tolerance():
    arc = Arc((0, 0), 10, 0, 90)
    pts = arc.flatten(0.01)
    for p, q in zip(pts, pts[1:], strict=False):
        mid = p.lerp(q, 0.5)
        assert 10 - mid.length() <= 0.01 + 1e-12
    bz = Bezier((0, 0), (0, 10), (10, 10), (10, 0))
    assert len(bz.flatten(0.01)) > 8
    assert abs(arc.length() - math.pi * 5) < 1e-12


def test_simplify_and_emit():
    line = [Vec2(i, 0.0) for i in range(10)]
    assert simplify(line, 0.01) == [line[0], line[-1]]
    assert emit(1.0000004) == 1 and emit(-0.0000001) == 0 and emit(0.1234567) == 0.123457
