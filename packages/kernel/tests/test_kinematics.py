from __future__ import annotations

import math

import pytest
from patterns import degree4, miura

from pliego import kinematics as K
from pliego.space import dist


def test_e5_degree4_closed_forms():
    m1 = K.degree4_mode1(70, 80, 90)
    m2 = K.degree4_mode2(70, 80, 90)
    assert abs(abs(m1[1]) - 29.13) < 0.005
    assert abs(abs(m2[0]) - 10.31) < 0.005
    a1, a2 = math.radians(70), math.radians(80)
    assert abs(-math.cos((a1 + a2) / 2) / math.cos((a1 - a2) / 2) - (-0.2598)) < 1e-4
    assert abs(math.sin((a1 - a2) / 2) / math.sin((a1 + a2) / 2) - (-0.0902)) < 1e-4


@pytest.mark.parametrize("mode", [1, 2])
def test_closed_forms_close_the_vertex_loop(mode):
    sheet, marks = degree4()
    arr = sheet.build()
    edges = [m.edges()[0] for m in marks]
    for drive in (15.0, 45.0, 90.0, 150.0):
        rho = K.degree4_mode1(70, 80, drive) if mode == 1 else K.degree4_mode2(70, 80, drive)
        angles = dict(zip(edges, rho, strict=True))
        assert K.closure_residual(arr, angles) < 1e-5  # grid-snapped directions
        wrong = dict(zip(edges, (rho[0], -rho[1], rho[2], rho[3]), strict=True))
        if abs(rho[1]) > 1:
            assert K.closure_residual(arr, wrong) > 1e-2


def test_degree4_has_one_dof():
    sheet, marks = degree4()
    arr = sheet.build()
    edges = [m.edges()[0] for m in marks]
    angles = dict(zip(edges, K.degree4_mode1(70, 80, 40), strict=True))
    assert K.dof(arr, angles) == 1


@pytest.mark.parametrize(("gamma", "theta", "nu"), [(60, 60, -0.75), (45, 45, -0.50),
                                                      (60, 30, -2.25)])
def test_e6_miura_poisson(gamma, theta, nu):
    assert abs(K.miura_poisson(gamma, theta) - nu) < 1e-12
    h = 1e-6
    c0, c1 = K.miura_cell(1, 1, gamma, theta), K.miura_cell(1, 1, gamma, theta + h)
    e_s = (c1["S"] - c0["S"]) / c0["S"]
    e_l = (c1["L"] - c0["L"]) / c0["L"]
    assert abs(-e_l / e_s - nu) < 1e-5  # ν_SL from the cell geometry


def test_face_tree_pose_is_developable():
    arr = miura().build()
    angles = {e: (37.0 if a == "V" else -53.0) for e, a in enumerate(arr.assignment)
              if a in ("M", "V")}
    pose = K.pose_arrangement(arr, angles)
    v = arr.vertices
    tr = K.face_transforms(arr, angles)
    assert all(t is not None for t in tr)
    for f, t in zip(arr.faces, tr, strict=True):
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            pa = K._apply(t, (v[a].x, 0.0, -v[a].y))
            pb = K._apply(t, (v[b].x, 0.0, -v[b].y))
            assert abs(dist(pa, pb) - v[a].distance(v[b])) < 1e-9
    assert len(pose) == len(v)


def test_valley_lifts_toward_front():
    import pliego

    s = pliego.Sheet("fold", pliego.rectangle(100, 50))
    m = s.valley((50, 0), (50, 50), angle=90)
    arr = s.build()
    pose = K.pose_arrangement(arr, {m.edges()[0]: 90.0}, root=pliego.Vec2(10, 10))
    ys = [p[1] for p in pose]
    assert max(ys) > 49.0 and min(ys) > -1e-9  # the free half rises to +Y


def test_singular_values_and_rank():
    sv = K.singular_values([[3.0, 0.0], [0.0, 4.0], [0.0, 0.0]])
    assert [round(x, 12) for x in sv] == [4.0, 3.0]
    assert K.rank([[1.0, 2.0], [2.0, 4.0]]) == 1
