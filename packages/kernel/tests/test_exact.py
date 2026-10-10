from __future__ import annotations

from fractions import Fraction

from pliego import exact


def test_orientation_and_crossing():
    assert exact.orient((0, 0), (10, 0), (5, 1)) == 1
    assert exact.orient((0, 0), (10, 0), (5, -1)) == -1
    assert exact.orient((0, 0), (10, 0), (20, 0)) == 0
    assert exact.segments_cross((0, 0), (10, 10), (0, 10), (10, 0))
    assert not exact.segments_cross((0, 0), (10, 0), (10, 0), (20, 5))  # touching only
    assert exact.crossing_point((0, 0), (10, 10), (0, 10), (10, 0)) == (5, 5)
    assert exact.crossing_point((0, 0), (3, 0), (1, 1), (1, -2)) == (Fraction(1), Fraction(0))


def test_exact_kawasaki():
    # degree 4 with sectors 90/90/90/90 and a rational twist vertex (90, 26.57, 90, 153.43)
    assert exact.kawasaki_exact([(1, 0), (0, 1), (-1, 0), (0, -1)])
    assert exact.kawasaki_exact([(1, 0), (0, 1), (-1, 2), (-2, -1)])
    assert not exact.kawasaki_exact([(1, 0), (0, 1), (-1, 2), (-2, -1 + 0)][:3])
    assert not exact.kawasaki_exact([(1, 0), (0, 1), (-1, 2), (-200, -101)])


def test_reflection_is_involution():
    r = exact.reflection((3, 4))
    assert exact.mat_mul(r, r) == exact.IDENTITY
    assert exact.fold_by_reflection((5, 0), [(3, 4)]) == (Fraction(-7, 5), Fraction(24, 5))
