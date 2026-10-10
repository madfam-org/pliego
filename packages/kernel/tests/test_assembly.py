from __future__ import annotations

import pytest

import pliego

L4 = {"en": "Leaf", "es": "Hoja", "fr": "Feuille", "pt": "Folha"}


def test_builders_normalise_references():
    a = pliego.Sheet("a", pliego.square(20))
    j = pliego.pivot("brad", (a, (5, 5)), ("b", (5, 5)),
                     hardware_ref={"platform": "yantra4d", "project_slug": "split-pin"})
    assert j["a"] == {"sheet": "a", "at": [5.0, 5.0]} and j["b"]["sheet"] == "b"
    p = pliego.pin("hold", along=(a, [(0, 0), (20, 0)]), mechanism="lift")
    assert p["a"]["along"] == [[0.0, 0.0], [20.0, 0.0]] and p["mechanism"] == "lift"
    t = pliego.translate("lift", "pull", (0, 0, 1), 15, sheets_moving=[a])
    assert t == {"id": "lift", "type": "translate", "control": "pull",
                 "direction": [0.0, 0.0, 1.0], "travel": 15.0, "sheets_moving": ["a"]}
    with pytest.raises(ValueError):
        pliego.translate("lift", "pull", (0, 0, 0), 15)
    with pytest.raises(ValueError):
        pliego.pin("both", (a, (1, 1)), along=(a, [(0, 0), (1, 0)]))
    with pytest.raises(ValueError):
        pliego.Assembly([a, pliego.Sheet("a", pliego.square(5))])


def test_row_layout_separates_sheets(stocks):
    a = pliego.Sheet("a", pliego.square(30, (-10, -10)))
    b = pliego.Sheet("b", pliego.rectangle(20, 50))
    d = pliego.Assembly([a, b]).build(stocks=stocks)
    assert d.sheets[0]["offset"] == [10, 10]
    assert d.sheets[1]["offset"] == [40, 0]
    assert d.verify() == []


def test_leaf_mechanism_and_kinematic_sheet(stocks):
    leaf = pliego.Sheet("page", pliego.rectangle(100, 140), label=L4, kinematic="turn")
    d = pliego.Assembly(
        [leaf], mechanisms=[pliego.leaf("turn", leaf, ((0, 0), (0, 140)), "page-turn")],
        controls=[pliego.angle_control("page-turn", L4, 0)]).build(stocks=stocks)
    assert d.verify() == []
    assert d.sheets[0]["kinematic"] == {"mechanism": "turn"}


def test_initial_pose_from_angles_is_developable(stocks):
    s = pliego.Sheet("card", pliego.rectangle(100, 60))
    gutter = s.valley((50, 0), (50, 60), angle=180)
    a = pliego.Assembly([s], initial={"card": {"angles": {gutter: 90}, "root": (10, 10)}},
                        targets={"closed": {"card": {"angles": {gutter: 180},
                                                     "root": (10, 10)}}})
    d = a.build(stocks=stocks)
    assert d.verify() == []
    init = d.frame("initial")["vertices_coords"]
    assert max(p[1] for p in init) == pytest.approx(50.0)  # the free half stands up
    assert d.frame("target:closed") is not None


def test_initial_callable_and_placement(stocks):
    s = pliego.Sheet("plate", pliego.square(10),
                     placement=pliego.Placement((0, 5, 0), (0, 0, 0, 1)))
    d = pliego.Assembly([s]).build(stocks=stocks)
    assert all(p[1] == 5 for p in d.frame("initial")["vertices_coords"])
    d2 = pliego.Assembly([pliego.Sheet("p", pliego.square(10))],
                         initial=lambda sid, uv: (uv[0], 1.0, -uv[1])).build(stocks=stocks)
    assert all(p[1] == 1 for p in d2.frame("initial")["vertices_coords"])


def test_stock_resolution_fails_loud():
    s = pliego.Sheet("x", pliego.square(10), stock="no-such-stock")
    with pytest.raises((pliego.StockUnavailable, LookupError, KeyError, ValueError, OSError)):
        pliego.Assembly([s]).build()
