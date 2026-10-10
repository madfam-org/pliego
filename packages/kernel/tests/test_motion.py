"""Tier R motion solver (kernel 0.2): closure-manifold paths, branches, closed forms, the c2
commons programs reproduced, `vertex_folds`, residual forms and `Sequence.kinematic_path`."""

from __future__ import annotations

import math

import pytest
from conftest import KAMI
from patterns import degree4

import pliego
from pliego import kinematics as K
from pliego import tessellate as T

TOL_DEG = 1e-4      # closed forms use unsnapped directions; the sheet's are grid-snapped


def _vertex4():
    sheet, marks = degree4()
    return sheet, sheet.build(), [m.edges()[0] for m in marks]


def test_degree4_mode1_from_flat_stays_on_the_manifold_and_matches_the_closed_form():
    _, arr, e = _vertex4()
    path = K.solve(arr, {}, {e[0]: 150.0}, steps=10)
    assert len(path) == 10 and path.dof == 1 and path.free_dof == 0
    assert path.max_residual_rad < 1e-9 and path.branch_steps == [1]
    for state in path:
        assert max(K.vertex_residuals(arr, state).values()) < 1e-9
        want = K.degree4_mode1(70, 80, state[e[0]])
        assert max(abs(state[x] - w) for x, w in zip(e, want, strict=True)) < TOL_DEG


def test_degree4_mode2_is_chosen_when_its_crease_is_driven():
    _, arr, e = _vertex4()
    path = K.solve(arr, {}, {e[1]: 150.0}, steps=10)
    for state in path:
        want = K.degree4_mode2(70, 80, state[e[1]])
        assert max(abs(state[x] - w) for x, w in zip(e, want, strict=True)) < TOL_DEG


def test_branch_selection_follows_the_drive_sign_and_assignment():
    """Mode 1 or 2 from the same flat vertex, picked by the M/V assignment (Maekawa 3:1)."""
    def vertex(kinds):
        s = pliego.Sheet("v", pliego.regular_polygon(36, 100, (0, 0), 5))
        th = 0.0
        marks = []
        for a, k in zip((70, 80, 110, 100), kinds, strict=True):
            marks.append(s.crease((0, 0), (150 * math.cos(math.radians(th)),
                                           150 * math.sin(math.radians(th))), k))
            th += a
        return s, marks

    s, m = vertex(("valley", "mountain", "valley", "valley"))      # mode 1 signs (+ − + +)
    st = K.solve(s, {}, {m[0]: 120.0}, steps=6)[-1]
    want = K.degree4_mode1(70, 80, 120.0)
    assert max(abs(st[x.edges()[0]] - w) for x, w in zip(m, want, strict=True)) < TOL_DEG
    s, m = vertex(("valley", "mountain", "mountain", "mountain"))  # mode 2 signs (+ − − −)
    st = K.solve(s, {}, {m[0]: 30.0}, steps=6)[-1]
    want = K.degree4_mode2(70, 80, st[m[1].edges()[0]])
    assert max(abs(st[x.edges()[0]] - w) for x, w in zip(m, want, strict=True)) < TOL_DEG
    assert st[m[2].edges()[0]] < 0                                   # the mountains fold


def test_unfolding_back_through_the_path_retraces_it():
    _, arr, e = _vertex4()
    out = K.solve(arr, {}, {e[0]: 120.0}, steps=8)[-1]
    back = K.solve(arr, out, {e[0]: 30.0}, steps=6)[-1]
    want = K.degree4_mode1(70, 80, 30.0)
    assert max(abs(back[x] - w) for x, w in zip(e, want, strict=True)) < TOL_DEG


def test_miura_from_flat_matches_the_closed_form():
    t = T.miura(nx=4, ny=4, gamma=60.0)
    col = t.groups["columns"][0]
    rho_row, rho_col = T.miura_fold_angles(60.0, 40.0)
    path = K.solve(t.sheet, {}, {col: math.copysign(rho_col, col.fold_angle)}, steps=12)
    assert path.dof == 1 and path.max_residual_rad < 1e-9
    final = path[-1]
    for group, mag in (("rows", rho_row), ("columns", rho_col)):
        for m in t.groups[group]:
            for x in m.edges():
                assert abs(abs(final[x]) - mag) < 1e-5
                assert (final[x] > 0) == (m.fold_angle > 0)      # the designed M/V pattern
    assert K.closure_residual(t.sheet.build(), final) < 1e-9


def test_drive_beyond_the_configuration_space_fails_loud():
    _, arr, e = _vertex4()
    with pytest.raises(K.KinematicsError, match="rigid configuration space|beyond"):
        K.solve(arr, {}, {e[0]: 100.0, e[1]: 100.0, e[2]: -100.0}, steps=4)
    with pytest.raises(K.KinematicsError, match="does not close"):
        K.solve(arr, {e[0]: 40.0, e[1]: 40.0, e[2]: 40.0, e[3]: 40.0}, {e[0]: 50.0},
                fixed=[e[1], e[2], e[3]])
    with pytest.raises(K.KinematicsError, match="not a crease"):
        K.solve(arr, {}, {next(i for i, a in enumerate(arr.assignment) if a == "B"): 10.0})


def test_solve_is_deterministic_and_accepts_documents():
    s, marks = degree4()
    doc = pliego.Assembly([s]).build(stocks={"kami": KAMI})
    e = [m.edges()[0] for m in marks]
    a = K.solve(doc, {}, {e[0]: 90.0}, steps=5)
    b = K.solve(s, {}, {marks[0]: 90.0}, steps=5)
    assert list(b) == list(K.solve(s, {}, {marks[0]: 90.0}, steps=5))   # bit-reproducible
    for sa, sb in zip(a, b, strict=True):                                 # layout offset only
        assert sa.keys() == sb.keys()
        assert max(abs(sa[x] - sb[x]) for x in sa) < 1e-9


# ── the c2 commons programs, reproduced ──────────────────────────────────────


def _reverse_fold(angle=45.0, length=200.0, width=60.0, position=0.5):
    half = width / 2.0
    vx = position * length
    s = pliego.Sheet("strip", pliego.rectangle(length, width))
    up = (vx + half / math.tan(math.radians(angle)), width)
    down = (vx + half / math.tan(math.radians(angle)), 0.0)
    marks = [s.mountain((vx, half), (length, half)), s.valley((vx, half), up),
             s.valley((0.0, half), (vx, half)), s.valley((vx, half), down)]
    return s, marks


def test_inside_reverse_fold_rigid_program_is_reproduced():
    """The c2 `inside-reverse-fold` (mode `rigid`): fold in half, precrease, unfold, open flat,
    collapse along mode 2 — every substep exact and on the cartridge's closed-form branch."""
    s, m = _reverse_fold()
    keys = [
        ("fold-in-half", (180.0, 0.0, 180.0, 0.0)),
        ("precrease", (180.0, 180.0, 180.0, -180.0)),
        ("unfold-precrease", (180.0, 0.0, 180.0, 0.0)),
        ("open-flat", (0.0, 0.0, 0.0, 0.0)),
        ("collapse", K.degree4_mode2(45.0, 135.0, 180.0)),
    ]
    steps = [pliego.Step(sid, sid, list(zip(m, rho, strict=True))) for sid, rho in keys]
    seq = pliego.Sequence.kinematic_path(s, steps, substeps=8)
    assert seq.mode == "kinematic" and len(seq.steps) == 40
    assert seq.report["max_residual_rad"] < 1e-9
    doc = pliego.Assembly([s], sequence=seq).build(stocks={"kami": KAMI})
    assert doc.verify() == []
    arr = s.build()
    e = [x.edges()[0] for x in m]
    state = {x: 0.0 for x in e}
    for st in doc.data["pliego:sequence"]["steps"][32:]:              # the collapse
        state.update({t[0]: t[1] for t in st["targets"]})
        assert K.closure_residual(arr, state) < 1e-5     # 1e-6° emit rounding × 200 mm
        want = K.degree4_mode2(45.0, 135.0, state[e[1]])
        assert max(abs(state[x] - w) for x, w in zip(e, want, strict=True)) < TOL_DEG
    assert [round(state[x], 6) for x in e] == [-180.0, 180.0, 180.0, 180.0]


def _rabbit_ear(base=200.0, angle_a=45.0, angle_c=45.0):
    ta, tc = math.tan(math.radians(angle_a)), math.tan(math.radians(angle_c))
    ax = base * tc / (ta + tc)
    a, c, b = (0.0, 0.0), (base, 0.0), (ax, ax * ta)
    la, lb, lc = math.dist(b, c), math.dist(a, c), math.dist(a, b)
    per = la + lb + lc
    i = ((la * a[0] + lb * b[0] + lc * c[0]) / per, (la * a[1] + lb * b[1] + lc * c[1]) / per)
    bc = (c[0] - b[0], c[1] - b[1])
    t = ((i[0] - b[0]) * bc[0] + (i[1] - b[1]) * bc[1]) / (bc[0] ** 2 + bc[1] ** 2)
    e = (b[0] + t * bc[0], b[1] + t * bc[1])
    s = pliego.Sheet("triangle", [a, c, b])
    marks = [s.valley(i, e), s.mountain(i, b), s.valley(i, a), s.valley(i, c)]
    angle_b = 180.0 - angle_a - angle_c
    return s, marks, (90.0 - angle_b / 2.0, 90.0 + angle_c / 2.0)


def test_rabbit_ear_collapse_is_reproduced():
    s, m, (a1, a2) = _rabbit_ear()
    final = K.degree4_mode1(a1, a2, 180.0)
    seq = pliego.Sequence.kinematic_path(
        s, [pliego.Step("rabbit-ear", "Rabbit ear", list(zip(m, final, strict=True)))],
        substeps=8)
    assert len(seq.steps) == 8 and seq.report["dof"] == 1
    e = [x.edges()[0] for x in m]
    for st in seq.steps:
        state = {t.edge: a for t, a in st.targets}
        want = K.degree4_mode1(a1, a2, state[e[0]])
        assert max(abs(state[x] - w) for x, w in zip(e, want, strict=True)) < TOL_DEG


def test_squash_fold_states_are_reproduced_by_solve():
    """The c2 `squash-fold` squash: a degree-6 vertex (3 DOF). Holding the diagonal at 180°
    and driving the spine and one book fold to each sampled state reproduces the cartridge's
    spherical-construction states (built here with `vertex_folds`)."""
    size, h = 150.0, 75.0
    o = (h, h)
    s = pliego.Sheet("square", pliego.square(size))
    marks = [s.valley(o, (size, size)), s.mountain(o, (0.0, size)), s.valley(o, (0.0, h)),
             s.valley(o, (0.0, 0.0)), s.valley(o, (h, 0.0)), s.valley(o, (size, 0.0))]
    e = [x.edges()[0] for x in marks]

    def sd(deg):
        return (math.cos(math.radians(deg)), 0.0, -math.sin(math.radians(deg)))

    d, p, c45 = sd(315.0), sd(45.0), math.cos(math.radians(45.0))

    def comb(*terms):
        return tuple(math.fsum(k * v[i] for k, v in terms) for i in range(3))

    def rays(phi):
        sp = comb((math.cos(math.radians(phi)), d), (math.sin(math.radians(phi)), (0, 1, 0)))
        c = c45 * math.tan(math.radians(phi) / 2.0)
        b = math.sqrt(max(0.0, 0.5 - c * c))
        return (p, d, comb((c45, d), (b, p), (c, (0, 1, 0))), sp,
                comb((c45, d), (-b, p), (c, (0, 1, 0))), d)

    upright = (180.0, -90.0, 0.0, 180.0, 0.0, 90.0)
    prev = dict(zip(e, upright, strict=True))
    prev_t = upright
    for k in range(1, 9):
        want = K.vertex_folds(rays(90.0 * (1 - k / 8)), prev_t)
        got = K.solve(s, prev, {e[3]: want[3], e[2]: want[2]}, fixed=[e[0]], steps=1)
        assert max(abs(got[-1][x] - w) for x, w in zip(e, want, strict=True)) < 1e-6
        prev, prev_t = got[-1], want


# ── vertex_folds, residual forms, grid constant ──────────────────────────────


def test_vertex_folds_inverts_the_pose():
    sheet, arr, e = _vertex4()
    rho = K.degree4_mode1(70, 80, 70.0)
    pose = K.pose_arrangement(arr, dict(zip(e, rho, strict=True)))
    centre = next(i for i, v in enumerate(arr.vertices) if v.x == 0 and v.y == 0)
    rays = []
    for x in e:
        a, b = arr.edges[x]
        w = b if a == centre else a
        rays.append(tuple(pose[w][k] - pose[centre][k] for k in range(3)))
    got = K.vertex_folds(rays)
    assert max(abs(g - r) for g, r in zip(got, rho, strict=True)) < 1e-4
    assert K.vertex_folds(rays, sectors=(70, 80, 110, 100)) == got
    flat = K.vertex_folds([(1, 0, 0), (0, 0, -1), (-1, 0, 0), (0, 0, 1)])
    assert flat == (0.0, 0.0, 0.0, 0.0)
    with pytest.raises(ValueError):
        K.vertex_folds([(1, 0, 0), (-1, 0, 0), (0, 0, 1)])


def test_residual_forms_and_snap_floor():
    sheet, arr, e = _vertex4()
    good = dict(zip(e, K.degree4_mode1(70, 80, 60.0), strict=True))
    bad = dict(good)
    bad[e[1]] += 1.0
    vr = K.vertex_residuals(arr, good)
    assert list(vr) == [next(i for i, v in enumerate(arr.vertices) if v.x == 0 and v.y == 0)]
    assert max(vr.values()) < 1e-8 < max(K.vertex_residuals(arr, bad).values())
    rel = K.closure_residual(arr, bad, relative=True)
    assert math.isclose(rel * math.hypot(200, 200) / 1.0, K.closure_residual(arr, bad),
                        rel_tol=0.05)
    assert pliego.arrangement.GRID_MM == 1e-6
    floor = K.snap_angle_rad(arr)
    assert 0 < floor < 1e-7
    assert max(vr.values()) < 100 * floor


def test_flatfold_tolerance_comes_from_the_grid():
    from pliego import flatfold

    reports, issues = flatfold.check(T.hex_twist().sheet.build())
    assert reports and not [i for i in issues if i["level"] == "error"]
    assert all(r.flat_foldable for r in reports)
    assert flatfold.KAWASAKI_TOL_RAD == 1e-6
