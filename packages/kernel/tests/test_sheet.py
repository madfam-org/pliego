from __future__ import annotations

import pytest

import pliego


def test_square_valley_builds_two_faces():
    s = pliego.Sheet("square", pliego.square(150))
    m = s.valley((0, 0), (150, 150))
    arr = s.build()
    assert len(arr.faces) == 2
    assert m.edges() and all(arr.assignment[e] == "V" for e in m.edges())
    assert arr.fold_angle[m.edges()[0]] == 180


def test_mountain_sign_and_outline_ccw():
    s = pliego.Sheet("cw", list(reversed(pliego.square(100))))
    m = s.mountain((0, 50), (100, 50), angle=90)
    assert m.fold_angle == -90
    assert pliego.polygon_area(s.outline) > 0


def test_fail_loud_construction():
    with pytest.raises(ValueError):
        pliego.Sheet("Bad_Id", pliego.square(10))
    with pytest.raises(ValueError):
        pliego.Sheet("bow", [(0, 0), (10, 10), (10, 0), (0, 10)])
    s = pliego.Sheet("ok", pliego.square(10))
    with pytest.raises(ValueError):
        s.crease((0, 0), (10, 10), treatment="cut")
    with pytest.raises(ValueError):
        s.hole(pliego.square(20, (-5, -5)))


def test_tab_adds_region_and_hinge():
    s = pliego.Sheet("t", pliego.rectangle(60, 40))
    tab = s.tab(0, width=8, taper=45)
    assert len(s.outline) == 6
    assert pliego.polygon_area(tab.region) > 0
    arr = s.build()
    assert any(arr.assignment[e] == "V" for e in tab.mark.edges())
