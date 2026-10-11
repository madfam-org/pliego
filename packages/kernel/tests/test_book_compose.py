"""Book composition builders: the carousel strip (with cut-fold scenes) and the pleated tunnel."""

from __future__ import annotations

import math

import pytest

import pliego
from pliego import book
from pliego import kinematics as K
from pliego.popup import Block, cut_fold


def _strip_with_houses(n: int = 6):
    st = book.carousel_strip(n, 100.0, 140.0, spines=False)
    gable = [(0.0, 0.0), (13.0, 10.0), (26.0, 0.0)]
    cfs = [cut_fold(st.sheet, **st.spine_frame(k), angle=st.open_angle,
                    blocks=[Block(a=44, b=26, lo=10, hi=60, crest=gable, name=f"house-{k + 1}")])
           for k in range(n)]
    return st, cfs


def _edge_angles(st, cfs, spine: float) -> dict[int, float]:
    out = {e: a for m, a in st.angles(spine).items() for e in m.edges()}
    for cf in cfs:
        out.update(cf.edge_angles(spine))
    return out


def test_carousel_strip_is_rigid_with_a_house_in_every_chamber():
    st, cfs = _strip_with_houses()
    arr = st.sheet.build()
    assert abs(st.alpha - 358.0 / 6) < 1e-12 and abs(st.open_angle - (180 - st.alpha)) < 1e-12
    for g in (0.0, 45.0, st.open_angle, 178.0):
        assert K.closure_residual(arr, _edge_angles(st, cfs, g)) < 1e-9
    assert len(st.spine_marks) == 0 and len(st.fore_marks) == 5
    assert [cf.gutter_marks[0].name for cf in cfs] == ["gutter"] * 6


def test_carousel_ribbons_tie_the_covers_at_their_open_distance():
    st, cfs = _strip_with_houses()
    arr = st.sheet.build()
    tr = K.face_transforms(arr, _edge_angles(st, cfs, st.open_angle),
                           K.root_face(arr, pliego.P(50, 70)))

    def w(u, v):
        rot, t = tr[K.root_face(arr, pliego.P(u, v))]
        p = (u, 0.0, -v)
        return [sum(rot[i][j] * p[j] for j in range(3)) + t[i] for i in range(3)]

    for rib in st.ribbons(slack=0.5):
        a, b = rib["a"]["at"], rib["b"]["at"]
        assert abs(math.dist(w(*a), w(*b)) + 0.5 - rib["length"]) < 1e-3
    doc = pliego.Assembly([st.sheet], joins=st.ribbons(),
                          initial={"angles": {m: a for cf in cfs for m, a in
                                              cf.angles(st.open_angle).items()}
                                   | st.angles(st.open_angle), "root": (50, 70)}).build()
    assert doc.verify() == [], doc.summary(doc.verify())


def test_lined_carousel_hides_the_covers_and_its_linings_hold():
    st = book.carousel_strip(6, 100.0, 140.0, spines=False, lined=True)
    gable = [(0.0, 0.0), (13.0, 10.0), (26.0, 0.0)]
    cfs = [cut_fold(st.sheet, **st.spine_frame(k), angle=st.open_angle, gutter_name="spine",
                    blocks=[Block(a=44, b=26, lo=10, hi=60, crest=gable)]) for k in range(6)]
    assert st.offset == 100.0 and st.spine_u(0) == 200.0 and len(st.lining_marks) == 2
    arr = st.sheet.build()
    for g in (0.0, st.open_angle, 178.0):
        assert K.closure_residual(arr, _edge_angles(st, cfs, g)) < 1e-9
    init = {m: a for cf in cfs for m, a in cf.angles(st.open_angle).items()}
    init.update(st.angles(st.open_angle))
    doc = pliego.Assembly([st.sheet], joins=st.ribbons() + st.lining_glue(),
                          initial={"angles": init, "root": (150, 70)}).build()
    assert doc.verify() == [], doc.summary(doc.verify())
    names = set(doc.data["pliego:edges_name"]) - {None}
    assert {"cover-front-edge", "cover-back-edge", "spine", "fore-edge"} <= names


def test_carousel_strip_with_its_own_spines_and_bad_counts():
    st = book.carousel_strip(5, 80.0, 120.0)
    assert len(st.spine_marks) == 5 and len(st.fore_marks) == 4
    arr = st.sheet.build()
    ang = {e: a for m, a in st.angles(st.open_angle).items() for e in m.edges()}
    assert K.closure_residual(arr, ang) < 1e-9
    with pytest.raises(ValueError):
        book.carousel_strip(2)
    with pytest.raises(ValueError):
        st.spine_u(5)


WINDOWS = [
    [[(-40.0, 20.0), (40.0, 20.0), (40.0, 70.0), (-40.0, 70.0)]],         # across the seam
    [[(-50.0, 10.0), (-10.0, 10.0), (-10.0, 80.0), (-50.0, 80.0)],
     [(10.0, 10.0), (50.0, 10.0), (50.0, 80.0), (10.0, 80.0)]],           # one per side
    [],
    [[(-30.0, 30.0), (30.0, 30.0), (0.0, 60.0)]],                          # apex on the seam
]


def test_pleated_tunnel_angle_law_is_exact_and_welds_hold():
    t = book.pleated_tunnel(windows=WINDOWS)
    for phi in (0.0, 15.0, 30.0, 60.0, 85.0):
        assert t.pose_error(phi) < 1e-9
    for phi in (10.0, 30.0, 70.0):
        doc = pliego.Assembly(t.sheets, joins=t.joins, initial=t.initial(phi)).build()
        assert doc.verify() == [], doc.summary(doc.verify())
    # one hole per wall for the window across the seam, two per wall for a one-side window
    left, right = t.sheets[1], t.sheets[2]
    assert len(left.holes) == len(right.holes) == 1 + 2 + 1


def test_pleated_tunnel_frames_stand_parallel_and_the_cover_halves_meet():
    t = book.pleated_tunnel(frames=4)
    phi = 30.0
    for k in range(t.frames):
        u1, u2 = t.frame_u(k)
        for sid in ("wall-left", "wall-right"):
            rear = [t.world(sid, u, 40.0, phi) for u in (u1 + 1.0, u1 + 50.0)]
            front = [t.world(sid, u, 40.0, phi) for u in (u2 - 1.0, u2 - 50.0)]
            assert abs(rear[0][2] - rear[1][2]) < 1e-12 and abs(front[0][2] - front[1][2]) < 1e-12
            assert abs(front[0][2] - rear[0][2] - t.pleat) < 1e-12
    z = [t.world("wall-left", t.frame_u(k)[1] - 1.0, 40.0, phi)[2] for k in range(t.frames)]
    for k in range(t.frames - 1):
        assert abs(z[k] - z[k + 1] - t.spacing(phi)) < 1e-9
    u_seam = t.frame_u(0)[0] + t.width / 2 + t.pleat
    a = t.world("wall-left", u_seam, 30.0, phi)
    b = t.world("wall-right", u_seam, 30.0, phi)
    assert math.dist(a, b) < 1e-9 and abs(a[0]) < 1e-12


def test_pleated_tunnel_rejects_bad_windows():
    with pytest.raises(ValueError, match="edge"):
        book.pleated_tunnel(windows=[[[(-59.0, 20.0), (0.0, 20.0), (0.0, 40.0)]], [], [], []])
    zigzag = [(-20.0, 20.0), (20.0, 20.0), (20.0, 30.0), (-10.0, 30.0), (-10.0, 40.0),
              (20.0, 40.0), (20.0, 50.0), (-20.0, 50.0)]
    with pytest.raises(ValueError, match="more than once"):
        book.pleated_tunnel(windows=[[zigzag], [], [], []])
    with pytest.raises(ValueError, match="one list per frame"):
        book.pleated_tunnel(windows=[[]])
