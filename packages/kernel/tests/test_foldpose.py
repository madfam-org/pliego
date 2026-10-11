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


# ── spec §5.35: a rigid step drives every layer, signed by its orientation ──

def frog_pleat(kinematic: bool):
    """The jumping frog's spring pleat opened by 35°: its two creases run through the body strip
    and through both side flaps, which are turned over."""
    fp, g = fm.jumping_frog()
    w, yb = 76.2, g["yb"]
    low = ((w / 4.0, yb / 2.0), (3.0 * w / 4.0, yb / 2.0))
    top = ((w / 4.0, 3.0 * yb / 4.0), (3.0 * w / 4.0, 3.0 * yb / 4.0))
    if kinematic:
        fp.kinematic("spring", "spring", [(low, 145.0), (top, 145.0)], fixed=g["o"],
                     frame="folded")
    else:
        on = (5.0 * w / 8.0, 0.6 * yb)
        fp.hinge("spring", "spring", low, 35.0, at=on, layers=1)
        fp.hinge("spring-2", "spring", top, 35.0, at=on, layers=1)
    return fp, g, low


def worst_dev(a, b) -> float:
    return max(foldpose.rigid_dev(x, y) for x, y in zip(a.pose.world, b.pose.world, strict=True))


def test_layer_signs_turn_the_turned_over_layers_the_other_way():
    fp, g, low = frog_pleat(kinematic=False)
    st = fp.recs[-1].state
    signs = foldpose.layer_signs(st, low, st.face_at(g["o"]))
    by_x = sorted((min(a[0], b[0]), sg) for (a, b), sg in signs)
    # the side flaps (x < W/4 and x > 3W/4 on the sheet) show their back: −1; the body: +1
    assert [sg for _, sg in by_x] == [-1, 1, -1]


def test_the_sheet_frame_points_turned_over_layers_to_the_folded_frame():
    fp, g = fm.jumping_frog()
    w, yb = 76.2, g["yb"]
    low = ((w / 4.0, yb / 2.0), (3.0 * w / 4.0, yb / 2.0))
    with pytest.raises(FlatStateError, match="frame='folded'"):
        fp.kinematic("spring", "spring", [(low, 145.0)], fixed=g["o"])
    with pytest.raises(FlatStateError, match="frame must be"):
        fp.kinematic("spring", "spring", [(low, 145.0)], fixed=g["o"], frame="world")


def test_kinematic_opens_the_frog_pleat_through_every_layer():
    kin, _, _ = frog_pleat(kinematic=True)
    hin, _, _ = frog_pleat(kinematic=False)
    assert worst_dev(kin, hin) < 1e-9
    row = kin.build("card").report["rows"][-1]
    assert row["kind"] == "kinematic" and row["tear_mm"] < 1e-6 and row["deviation_mm"] < 1e-6


def test_kinematic_opens_the_canard_fuselage_with_its_nose_roll():
    kin, hin = fm.canard_plane(kinematic_open=True)[0], fm.canard_plane()[0]
    assert worst_dev(kin, hin) < 1e-9
    rows = {r["id"]: r for r in kin.build().report["rows"]}
    assert rows["open-fuselage"]["kind"] == "kinematic"
    assert rows["open-fuselage"]["tear_mm"] < 1e-6


def test_kinematic_rolls_the_ring_wing_with_its_folded_leading_edge():
    kin, hin = fm.ring_wing(n=8), fm.ring_wing(n=8, kinematic=False)
    assert worst_dev(kin, hin) < 1e-9
    row = kin.build("strip").report["rows"][-1]
    assert row["kind"] == "kinematic" and row["tear_mm"] < 1e-6


# ── spec §5.36: the branch of a rigid step does not depend on its sampling ──

def masu_inside(fp, g) -> float:
    """How far the finished masu's paper reaches outside its walls (mm; 0 = a box)."""
    q, h = g["q"], g["h"]
    st, w = fp.state, fp.pose.world
    pts = [flatmotion.apply(w[f], (st.points[v][0], 0.0, -st.points[v][1]))
           for f in range(len(st.faces)) for v in st.faces[f].verts]
    return max(max(abs(p[0] - h), abs(p[2] + h)) for p in pts) - q


def test_masu_gussets_fold_in_at_any_substep_count(monkeypatch):
    paths = {}
    orig = foldpose.solve_step

    def spy(arr, cur, drive, free, steps, hints=None):
        out = orig(arr, cur, drive, free, steps, hints)
        paths.setdefault(steps, []).append(out)
        return out
    monkeypatch.setattr(foldpose, "solve_step", spy)
    for n in (5, 10):    # 5 folded a gusset of the bottom wall outward before
        fp, g = fm.masu_box(substeps=n)
        assert masu_inside(fp, g) < 1e-6
    # the same closed states at the fractions both samplings share (after the hint's nudge)
    for a, b in zip(paths[20], paths[40], strict=True):
        for k in range(1, 21):
            sa, sb = a[1 + k], b[1 + 2 * k]
            assert max(abs(sa[e] - sb[e]) for e in sa) < 1e-6


def test_branch_jump_names_the_crease():
    cur = {1: 0.0, 2: 0.0}
    assert foldpose.branch_jump([{1: 2.0, 2: -1.0}, {1: -3.0, 2: -2.0}], cur, [1, 2], {}) == \
        "free crease 1 flipped from + at substep 2"
    assert "against its hint" in foldpose.branch_jump([{1: -2.0, 2: 0.0}], cur, [1, 2], {1: 1})
    assert foldpose.branch_jump([{1: 2.0, 2: 180.0}, {1: 5.0, 2: -180.0}], cur, [1, 2], {}) \
        is None
