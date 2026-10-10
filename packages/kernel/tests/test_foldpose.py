"""3-D steps that keep folding afterwards (`pliego.foldpose`): hinge poses, a rigid step on the
whole pattern and flat folds inside a coplanar group; the masu box (`tests/flat_models.py`)."""

from __future__ import annotations

import math

import flat_models as fm
import pytest

import pliego
from pliego import flatmotion, foldpose
from pliego.flatstate import FlatStateError

STRIP = [(0, 0), (400, 0), (400, 60), (0, 60)]


def test_masu_box_walls_gussets_and_flaps():
    fp, g = fm.masu_box()
    q, h = g["q"], g["h"]
    b = fp.build()
    rows = {r["id"]: r for r in b.report["rows"]}
    assert rows["end-top"]["kind"] == rows["end-bottom"]["kind"] == "kinematic"
    for sid in ("walls", "end-top", "flap-top", "end-bottom", "flap-bottom"):
        assert rows[sid]["tear_mm"] < 1e-6 and rows[sid]["deviation_mm"] < 1e-6
    for sid in ("end-top", "flap-top", "end-bottom", "flap-bottom"):
        assert rows[sid]["penetration_mm"] <= foldpose.PENETRATION_MM
    # the finished box: every bit of paper inside the walls, on or above the floor
    st, w = fp.state, fp.pose.world
    pts = [flatmotion.apply(w[f], (st.points[v][0], 0.0, -st.points[v][1]))
           for f in range(len(st.faces)) for v in st.faces[f].verts]
    assert min(p[0] for p in pts) == pytest.approx(h - q)
    assert max(p[0] for p in pts) == pytest.approx(h + q)
    assert min(p[2] for p in pts) == pytest.approx(-h - q)
    assert max(p[2] for p in pts) == pytest.approx(-h + q)
    assert min(p[1] for p in pts) == pytest.approx(0.0, abs=1e-9)
    assert max(p[1] for p in pts) == pytest.approx(q)
    asm = pliego.Assembly([b.sheet], controls=[pliego.sequence_control()], sequence=b.sequence,
                          targets={"folded": b.target(pose=True)})
    doc = asm.build(cartridge="test", mode="box")
    assert [i for i in doc.verify() if i["level"] == "error"] == []


def lifted_strip():
    fp = pliego.FoldProgram(STRIP)
    for x in (150.0, 250.0):
        fp.crease_and_unfold(f"c{x:.0f}", "c", ((x, -1.0), (x, 61.0)), "valley")
    fp.hinge("raise", "raise", ((250.0, -1.0), (250.0, 61.0)), 90.0, at=(300.0, 30.0))
    return fp


def test_a_rigid_step_that_would_cross_still_paper_fails():
    fp = lifted_strip()
    fp.kinematic("over", "over", [(((150.0, 0.0), (150.0, 60.0)), 120.0)], fixed=(200.0, 30.0))
    b = fp.build()
    assert b.report["rows"][-1]["penetration_mm"] == 0.0
    fp = lifted_strip()
    fp.kinematic("over", "over", [(((150.0, 0.0), (150.0, 60.0)), 160.0)], fixed=(200.0, 30.0))
    with pytest.raises(FlatStateError, match="passes"):
        fp.build()


def test_flat_fold_inside_a_raised_group():
    fp = lifted_strip()
    fp.fold("tip", "tip", ((340.0, 61.0), (340.0, -1.0)), "valley", within=(300.0, 30.0),
            sheet_points=[(380.0, 30.0)])
    b = fp.build()
    row = b.report["rows"][-1]
    assert row["tear_mm"] < 1e-6 and row["penetration_mm"] == 0.0
    st, w = fp.state, fp.pose.world
    tip = st.face_at((380.0, 30.0))
    far = flatmotion.apply(w[tip], (400.0, 0.0, -30.0))
    assert far[0] == pytest.approx(250.0) and far[1] == pytest.approx(30.0)   # folded down


def test_flat_moves_after_3d_steps_need_a_group():
    fp = lifted_strip()
    with pytest.raises(FlatStateError, match="before hinge"):
        fp.fold("x", "x", ((0.0, 30.0), (400.0, 30.0)), "valley")
    with pytest.raises(FlatStateError, match="before hinge"):
        fp.crease_and_unfold("y", "y", ((100.0, -1.0), (100.0, 61.0)), "valley")


def test_penetration_measures_a_crossing():
    sh = pliego.Sheet("s", [(0, 0), (100, 0), (100, 100), (0, 100)])
    sh.crease((30, 0), (30, 100), "flat", 0.0)
    sh.crease((70, 0), (70, 100), "flat", 0.0)
    arr = sh.build()
    right = next(i for i, f in enumerate(arr.faces) if all(arr.vertices[v].x >= 70 for v in f))
    flat = [flatmotion.ID_RIGID] * len(arr.faces)
    stand = flatmotion.compose(
        (((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (-55.0, -15.0, 0.0)),
        flatmotion.rot_line((70.0, 0.0, 0.0), (0.0, 0.0, 1.0), math.pi / 2))
    poses = list(flat)
    poses[right] = stand            # stood up through the left panel along x = 15
    assert foldpose.penetration(arr, poses, {right}) == pytest.approx(100.0)
    assert foldpose.penetration(arr, flat, {right}) == 0.0
