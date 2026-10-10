"""Pop-up generators: valid documents, closure (flat at 0° / 180°), locks, welds, fold signs."""

from __future__ import annotations

import math

import pytest

from pliego import popup as PU
from pliego.geometry import Vec2, point_in_polygon
from pliego.tessellate import document_fold_angles

FLAT_BOTH = ("v-fold", "parallel-fold", "floating-layer", "step-fold", "cut-fold")


def _weld_gaps(pu: PU.PopUp, phi: float) -> list[float]:
    """Distance between every glued vertex (inside a glue region) and its weld point at φ."""
    pose = pu.pose(phi)
    assert pose is not None
    sheets = {s.id: s for s in pu.sheets}
    gaps = []
    for j in pu.joins:
        a = sheets[j["a"]["sheet"]]
        region = [tuple(p) for p in j["a"]["region"]]
        ring = [Vec2(*p) for p in region]
        m = j["map"]
        for v in a.build().vertices:
            if point_in_polygon(v, ring) < 0:
                continue
            q = (m[0] * v.x + m[1] * v.y + m[4], m[2] * v.x + m[3] * v.y + m[5])
            gaps.append(math.dist(pose[a.id](v.x, v.y), pose[j["b"]["sheet"]](*q)))
        for p in region:                                              # the corners too
            q = (m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5])
            gaps.append(math.dist(pose[a.id](*p), pose[j["b"]["sheet"]](*q)))
    return gaps


@pytest.mark.parametrize("name", sorted(PU.GENERATORS))
def test_every_popup_emits_a_valid_document(name):
    pu = PU.GENERATORS[name]()
    doc = pu.document()
    issues = doc.verify()
    assert issues == [], doc.summary(issues)
    d = doc.data
    assert [c["id"] for c in d["pliego:controls"]] == ["open"]
    (mech,) = d["pliego:mechanisms"]
    assert mech["type"] == "hinge" and mech["sheets_moving"] == ["page-right"]
    kinematic = [s["id"] for s in d["pliego:sheets"] if s["kinematic"]]
    assert kinematic == ["page-left", "page-right"]
    assert doc.to_bytes() == PU.GENERATORS[name]().document().to_bytes()


@pytest.mark.parametrize("name", FLAT_BOTH)
def test_popups_close_flat_at_both_extremes(name):
    report = PU.GENERATORS[name]().closure()
    assert report == {"flat_at_0": True, "flat_at_180": True, "locked_at": [], "ok": True}


def test_tent_is_a_180_degree_mechanism():
    report = PU.tent().closure()
    assert report["flat_at_0"] and not report["flat_at_180"] and report["locked_at"] == []
    flat_tent = PU.tent(p=35.0, s=35.0).closure()       # degenerate kite: flat at 180° too
    assert flat_tent["flat_at_180"]


@pytest.mark.parametrize("name", sorted(PU.GENERATORS))
def test_glue_welds_hold_through_the_motion(name):
    pu = PU.GENERATORS[name]()
    for phi in (0.0, 30.0, 90.0, 150.0, 180.0):
        gaps = _weld_gaps(pu, phi)
        assert gaps and max(gaps) < 1e-6, (phi, max(gaps))


@pytest.mark.parametrize("name", ("v-fold", "parallel-fold", "floating-layer", "tent"))
def test_initial_frame_fold_angles_match_the_assignment(name):
    doc = PU.GENERATORS[name]().document()
    measured = document_fold_angles(doc, "initial")
    assert measured
    for e, ang in measured.items():
        assert ang == pytest.approx(doc.data["edges_foldAngle"][e], abs=1e-5)   # emit grid


def test_cut_fold_design_angles_match_the_90_degree_pose():
    pu = PU.oa_cut_fold()
    doc = pu.document()
    assert doc.data["pliego:controls"][0]["default"] == 180      # starts flat (contract gap)
    pose = pu.pose(90.0)
    sheet = pu.sheets[-1]
    arr = sheet.build()
    xs = {round(v.x, 6) for v in arr.vertices}
    assert {110.0, 150.0, 160.0, 200.0} <= xs                     # A, gutter, F, B
    a = pose[sheet.id](110.0, 100.0)
    f = pose[sheet.id](160.0, 100.0)
    b = pose[sheet.id](200.0, 100.0)
    assert math.dist(a, (-40.0, 0.0, -100.0)) < 1e-9             # A on the left page
    assert math.dist(f, (-40.0, 50.0, -100.0)) < 1e-9            # box corner F
    assert math.dist(b, (0.0, 50.0, -100.0)) < 1e-9              # B on the (vertical) right page


def test_locks_are_detected():
    bad = PU.parallel_fold(p=40, q=50, s1=30, s2=40)              # AF + FB < |AB| when flat
    report = bad.closure()
    assert report["locked_at"] and not report["ok"]
    v = PU.v_fold(alpha=40, beta=35)                              # β < α cannot open flat
    assert 180.0 in v.closure()["locked_at"]
    stand = PU.v_fold(alpha=40, beta=50).closure()                # β > α stands at 180°
    assert stand["flat_at_0"] and not stand["flat_at_180"] and not stand["locked_at"]


def test_parallel_fold_is_a_parallelogram():
    pu = PU.parallel_fold()
    for phi in (20.0, 90.0, 160.0):
        pose = pu.pose(phi)
        piece = pose["parallel-fold"]
        a, f, b = piece(12.0, 0), piece(62.0, 0), piece(102.0, 0)
        assert math.dist(a, f) == pytest.approx(50.0) and math.dist(f, b) == pytest.approx(40.0)
        g = (0.0, 0.0, -70.0)
        # opposite sides parallel: F − A == B − G
        assert all(abs((f[k] - a[k]) - (b[k] - g[k])) < 1e-9 for k in range(3))


def test_bad_parameters_fail_loud():
    with pytest.raises(ValueError):
        PU.parallel_fold(p=200)
    with pytest.raises(ValueError):
        PU.v_fold(apex=10)
    with pytest.raises(ValueError):
        PU.oa_cut_fold(blocks=((50, 40, 10, 10),))
    with pytest.raises(ValueError):
        PU.step_fold(steps=9)
