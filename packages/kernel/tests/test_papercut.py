from __future__ import annotations

import pliego
from pliego import papercut


def test_lattice_bridges_and_connectivity():
    s = pliego.Sheet("lattice", pliego.square(100))
    papercut.cut_holes(s, papercut.lattice((10, 10), 4, 4, 20, 16))
    rep = papercut.analyze(s, min_feature_mm=1.0)
    assert rep.components == 1
    assert abs(rep.min_bridge_mm - 4.0) < 1e-6
    assert rep.ok
    thin = papercut.analyze(s, min_feature_mm=5.0)
    assert any(i["kind"] == "bridge_too_thin" for i in thin.issues)


def test_closed_cut_makes_an_island():
    s = pliego.Sheet("island", pliego.square(100))
    s.cut(pliego.square(20, (40, 40)), closed=True)
    rep = papercut.analyze(s)
    assert rep.components == 2
    assert any(i["kind"] == "islands" for i in rep.issues)


def test_motifs_and_symmetry():
    petal = papercut.petal((50, 50), 20, 8, 90)
    assert pliego.polygon_area(petal) > 0
    rosette = papercut.wedge(petal, 6, (50, 50))
    assert len(rosette) == 6
    for ring in rosette:
        assert abs(pliego.polygon_area(ring) - pliego.polygon_area(petal)) < 1e-9
    d6 = papercut.dihedral(papercut.diamond((70, 50), 6, 10), 6, (50, 50))
    assert len(d6) == 12
    assert len(papercut.accordion(papercut.disc((5, 5), 2), 10, 5)) == 5
    border = papercut.scallop_border((0, 0), (100, 0), 5, 10)
    assert border[0] == pliego.Vec2(0, 0) and abs(border[-1].x - 100) < 1e-9
    assert len(papercut.zigzag_border((0, 0), (100, 0), 5, 10)) == 21
