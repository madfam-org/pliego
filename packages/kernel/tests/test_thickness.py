"""Tier R board thickness (pliego.thickness): offset hinge axes, slab interference, inside
dimensions of a raised tray, the report formulas and the face-tree guard."""

from __future__ import annotations

import math

import pytest
from patterns import miura

import pliego
from pliego import kinematics as K
from pliego import thickness as T
from pliego.dieline import Dieline
from pliego.geometry import Vec2

TC = 1.5  # greyboard caliper used throughout (mm)


def _two_panels(kind: str = "valley"):
    """200 × 100 sheet, one crease at u = 100; returns (arr, crease edge, root face, child face)."""
    s = pliego.Sheet("two", pliego.rectangle(200, 100))
    (s.valley if kind == "valley" else s.mountain)((100, 0), (100, 100))
    arr = s.build()
    edge = next(i for i, a in enumerate(arr.assignment) if a in ("M", "V"))
    root = K.root_face(arr, Vec2(50, 50))
    child = K.root_face(arr, Vec2(150, 50))
    return arr, edge, root, child


def _child_penetration(arr, edge, root, child, angle, hinge, n=60):
    """Deepest reach (mm, along the root panel from the hinge line) of the child slab into the
    root slab, sampled on the cross-section through the middle of the crease."""
    tr = T.face_transforms(arr, {edge: angle}, TC, hinge, root)[child]
    deepest = 0.0
    for i in range(n + 1):
        for j in range(n + 1):
            u = 100.0 + 4.0 * TC * i / n             # the child's first 4t beyond the crease
            y = -TC / 2.0 + TC * j / n
            x, wy, _z = K._apply(tr, (u, y, -50.0))
            if x < 100.0 - 1e-9 and abs(wy) < TC / 2.0 - 1e-9:
                deepest = max(deepest, 100.0 - x)
    return deepest


def test_mid_is_the_zero_thickness_pose():
    arr = miura().build()
    angles = {e: (37.0 if a == "V" else -53.0) for e, a in enumerate(arr.assignment)
              if a in ("M", "V")}
    assert T.face_transforms(arr, angles, TC, "mid") == K.face_transforms(arr, angles)
    assert T.face_transforms(arr, angles, 0.0, "inner") == K.face_transforms(arr, angles)


def test_closed_loops_are_refused_for_offset_hinges():
    arr = miura().build()
    assert T.fold_loops(arr) > 0
    with pytest.raises(T.ThicknessError, match="face trees"):
        T.face_transforms(arr, {}, TC, "inner")


@pytest.mark.parametrize(("hinge", "expected"), [("mid", TC / 2.0), ("inner", 0.0),
                                                   ("outer", TC)])
def test_slab_overlap_at_90_matches_the_report(hinge, expected):
    arr, edge, root, child = _two_panels()
    reach = _child_penetration(arr, edge, root, child, 90.0, hinge)
    assert reach == pytest.approx(expected, abs=TC / 30.0)
    assert T.hinge_report(90.0, TC, hinge)["overlap_mm"] == pytest.approx(expected)


@pytest.mark.parametrize("angle", [30.0, 60.0, 120.0, 150.0, 179.0])
def test_inner_hinge_never_interpenetrates(angle):
    arr, edge, root, child = _two_panels()
    assert _child_penetration(arr, edge, root, child, angle, "inner") == 0.0


def test_inner_hinge_at_180_stacks_flush_mid_and_outer_cannot():
    arr, edge, root, child = _two_panels()
    faces = T.pose_faces(arr, {edge: 180.0}, TC, "inner", Vec2(50, 50))
    ys = {round(p[1], 9) for p in faces[child]}
    assert ys == {round(TC, 9)}                  # mid-surfaces exactly t apart, child on top
    assert all(p[0] <= 100.0 + 1e-9 for p in faces[child])    # folded back over the root
    assert T.hinge_report(180.0, TC, "inner")["foldable"]
    for hinge in ("mid", "outer"):
        r = T.hinge_report(180.0, TC, hinge)
        assert not r["foldable"] and math.isinf(r["overlap_mm"])
    with pytest.raises(T.ThicknessError):
        T.groove(TC, 180.0)


def test_mountain_mirrors_valley():
    arr_v, ev, rv, cv = _two_panels("valley")
    arr_m, em, rm, cm = _two_panels("mountain")
    pv = T.pose_faces(arr_v, {ev: 90.0}, TC, "inner", Vec2(50, 50))[cv]
    pm = T.pose_faces(arr_m, {em: -90.0}, TC, "inner", Vec2(50, 50))[cm]
    assert sorted((round(x, 9), round(-y, 9)) for x, y, _ in pv) == \
        sorted((round(x, 9), round(y, 9)) for x, y, _ in pm)
    assert _child_penetration(arr_m, em, rm, cm, -90.0, "inner") == 0.0


def test_pose_is_continuous_through_zero():
    arr, edge, root, child = _two_panels()
    for hinge in T.HINGES:
        flat = T.pose_faces(arr, {edge: 0.0}, TC, hinge, Vec2(50, 50))[child]
        for eps in (1e-7, -1e-7):
            near = T.pose_faces(arr, {edge: eps}, TC, hinge, Vec2(50, 50))[child]
            assert max(abs(a - b) for p, q in zip(flat, near, strict=True)
                       for a, b in zip(p, q, strict=True)) < 1e-6


def test_report_formulas():
    r = math.radians
    mid, inner, outer = (T.hinge_report(90.0, TC, h) for h in T.HINGES)
    assert mid["liner_arc_mm"] == pytest.approx(TC / 2 * r(90))
    assert inner["liner_arc_mm"] == pytest.approx(TC * r(90))
    assert outer["liner_arc_mm"] == 0.0
    assert outer["groove_mm"] == pytest.approx(2 * TC) == pytest.approx(T.groove(TC, 90.0))
    assert mid["groove_mm"] is None and inner["groove_mm"] is None
    zero = T.hinge_report(180.0, 0.0, "outer")
    assert zero["foldable"] and zero["overlap_mm"] == 0.0
    assert [T.panel_allowance(TC, h) for h in T.HINGES] == [TC, 0.0, 2 * TC]


def test_bad_inputs():
    with pytest.raises(T.ThicknessError):
        T.axis_offset(10.0, TC, "hinge")
    with pytest.raises(T.ThicknessError):
        T.axis_offset(10.0, -1.0, "inner")
    with pytest.raises(T.ThicknessError):
        T.hinge_report(10.0, float("nan"), "inner")


def _tray(P: float = 120.0, Q: float = 80.0, H: float = 30.0):
    """An open tray dieline (base + four walls, open corners): a face tree."""
    d = Dieline("tray", "test tray", "rigid", {"length": P, "width": Q, "depth": H},
                "greyboard-1500", TC)
    d.rect("base", 0, 0, P, Q, "bottom")
    d.rect("front", 0, -H, P, 0)
    d.rect("back", 0, Q, P, Q + H)
    d.rect("left", -H, 0, 0, Q)
    d.rect("right", P, 0, P + H, Q)
    for w in ("front", "back", "left", "right"):
        d.hinge("base", w, -90.0)
    packed = d.build(rest_on="base")
    arr = packed.sheet.build()
    angles = {e: a for m, a in packed.final_angles().items() for e in m.edges()}
    return arr, angles


@pytest.mark.parametrize("hinge", T.HINGES)
def test_raised_tray_inside_length_follows_the_allowance(hinge):
    P, Q = 120.0, 80.0
    arr, angles = _tray(P, Q)
    assert T.fold_loops(arr) == 0
    centre = Vec2(P / 2, Q / 2)
    faces = T.pose_faces(arr, angles, TC, hinge, centre)
    root = K.root_face(arr, centre)
    mid = (P / 2, -Q / 2)                       # base centre in the un-placed (u, 0, −v) frame
    walls = []
    for fi, pts in enumerate(faces):
        if fi == root:
            continue
        xs = {round(p[0], 9) for p in pts}
        if len(xs) == 1:                        # an end wall: a vertical plane x = const
            walls.append(xs.pop())
    assert len(walls) == 2
    inner = [x + TC / 2 if x < mid[0] else x - TC / 2 for x in walls]
    assert abs(inner[0] - inner[1]) == pytest.approx(P - T.panel_allowance(TC, hinge))
    for fi, pts in enumerate(faces):            # walls hang below the base (mountain folds)
        if fi != root:
            assert max(p[1] for p in pts) <= TC / 2 + 1e-9


def test_sheet_report_lists_every_folded_edge():
    arr, angles = _tray()
    rows = T.sheet_report(arr, angles, TC, "outer")
    assert len(rows) == len(angles) == 4
    assert all(r["groove_mm"] == pytest.approx(2 * TC) for r in rows)
    assert sorted(r["edge"] for r in rows) == sorted(angles)
