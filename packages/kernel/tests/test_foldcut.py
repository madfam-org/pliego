from __future__ import annotations

import math

import pliego
from pliego import foldcut, papercut
from pliego.geometry import Vec2, circle, point_in_polygon, polygon_area, polygon_centroid
from pliego.simplefold import FoldedState


def quarter() -> FoldedState:
    st = FoldedState(pliego.square(100))
    st.fold(((50, 0), (50, 100)), "valley")
    st.fold(((100, 50), (50, 50)), "valley")
    return st


def test_disc_at_the_folded_corner_is_one_centred_hole():
    r = foldcut.cut(quarter(), circle((50, 50), 10, 32), id="centre")
    assert len(r.sheet.holes) == 1
    assert abs(r.removed_area - polygon_area(circle((0, 0), 10, 32))) < 1e-4  # 1e-6 mm grid
    c = polygon_centroid(list(reversed(r.sheet.holes[0])))
    assert abs(c.x - 50) < 1e-6 and abs(c.y - 50) < 1e-6
    assert r.connected


def test_disc_inside_the_quarter_gives_four_symmetric_holes():
    r = foldcut.cut(quarter(), circle((75, 75), 8, 24), id="four")
    holes = [list(reversed(h)) for h in r.sheet.holes]
    assert len(holes) == 4
    cents = sorted((round(polygon_centroid(h).x, 6), round(polygon_centroid(h).y, 6))
                   for h in holes)
    assert cents == [(25, 25), (25, 75), (75, 25), (75, 75)]
    areas = {round(polygon_area(h), 6) for h in holes}
    assert len(areas) == 1  # mirror images have equal area
    arr = r.sheet.build()
    lhs, rhs = arr.euler()
    assert lhs == rhs


def test_wedge_symmetry_is_exact_and_kept_region_connected():
    # fold a square into an 8-fold wedge: halves, quarters, then the diagonal
    st = FoldedState(pliego.square(120))
    st.fold(((60, 0), (60, 120)), "valley")
    st.fold(((120, 60), (60, 60)), "valley")
    st.fold(((120, 120), (60, 60)), "valley")
    notch = [(66, 85), (66, 95), (76, 90)]  # the wedge lies above the diagonal
    r = foldcut.cut(st, notch, id="wedge")
    holes = [list(reversed(h)) for h in r.sheet.holes]
    assert len(holes) == 8
    centre = Vec2(60, 60)
    rings = sorted(holes, key=lambda h: math.atan2(polygon_centroid(h).y - 60,
                                                   polygon_centroid(h).x - 60))
    radii = {round(polygon_centroid(h).distance(centre), 6) for h in rings}
    assert len(radii) == 1
    # each hole maps onto another under the 90° rotation about the centre
    for h in holes:
        rot = [p.rotated(90, centre) for p in h]
        c = polygon_centroid(rot)
        assert any(point_in_polygon(c, other) == 1 for other in holes)
    report = papercut.analyze(r.sheet, min_feature_mm=1.0)
    assert report.components == 1 and r.connected
