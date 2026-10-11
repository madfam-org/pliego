"""Cut-fold block trees: exact rigid states, nesting at every corner, crests, fail-loud checks."""

from __future__ import annotations

import math

import pytest

import pliego
from pliego import kinematics as K
from pliego.popup import Block, cut_fold

W, H = 170.0, 160.0


def _card() -> pliego.Sheet:
    return pliego.Sheet("card", [(0, 0), (W, 0), (W, 2 * H), (0, 2 * H)], stock="cardstock-160")


def _world(cf, gamma: float):
    """(depth from the first page, height above the second page, along) of a sheet point when
    the corner (v = H, the first page v < H held still) turns by γ = 90."""
    arr = cf.sheet.build()
    tr = K.face_transforms(arr, cf.edge_angles(gamma), K.root_face(arr, pliego.P(1, 1)))

    def at(p):
        rot, t = tr[K.root_face(arr, p)]
        q = (p.x, 0.0, -p.y)
        w = [sum(rot[i][j] * q[j] for j in range(3)) + t[i] for i in range(3)]
        return (w[1], H + w[2], w[0])
    return at


def _altar(r: float = 20.0):
    flame = [(0.0, 0.0), (1.0, 3.0), (2.0, 6.0), (3.0, 3.0), (4.0, 0.0)]

    def candle(y):
        return Block(a=14, b=9, lo=y, hi=y + 8, at="b", crest_side="fold", crest_panel=2,
                     crest=[(y + 2 + t, h) for t, h in flame])

    t3 = Block(a=r, b=20, lo=55, hi=115, at="a", name="tier-3",
               children=[Block(a=34, b=5, lo=72, hi=98, at="a", name="frame")])
    t2 = Block(a=r, b=40, lo=40, hi=130, at="a", name="tier-2", children=[t3, candle(45)])
    t3.children += [candle(62), candle(102)]
    t1 = Block(a=r, b=60, lo=25, hi=145, name="tier-1", children=[t2, candle(30), candle(133)])
    return t1


def test_nested_steps_match_the_step_fold_law():
    """Steps nested in F (the step-popup staircase): every state is rigid, the card lies flat
    open and folds flat shut."""
    s = _card()
    n, t, r = 3, 18.0, 18.0
    blocks, cur = [], None
    for k in range(n):
        m = n - k
        a, b = (m * t, m * r) if k % 2 == 0 else (m * r, m * t)
        blk = Block(a=a, b=b, lo=40 + 10 * k, hi=130 - 10 * k, at="f")
        if cur is None:
            blocks.append(blk)
        else:
            cur.children.append(blk)
        cur = blk
    cf = cut_fold(s, (0, H), (1, 0), (0, 1), blocks, reach=(H, H), span=(0, W))
    assert cf.residual([0, 15, 45, 90, 135, 170, 180], root=(1, 1)) < 1e-9
    arr = s.build()
    pts = K.pose_arrangement(arr, cf.edge_angles(180.0), pliego.P(1, 1))
    assert max(abs(p[1]) for p in pts) < 1e-6           # folded flat onto the first page
    assert len(cf.gutter_marks) == 2 and all(sg in (1, -1) for _, sg in cf.marks)


def test_altar_tiers_candles_and_frame_stand_where_designed():
    s = _card()
    cf = cut_fold(s, (0, H), (1, 0), (0, 1), [_altar()], reach=(H, H), span=(0, W), margin=2.0)
    assert cf.residual([0, 30, 90, 150, 179], root=(1, 1)) < 1e-9
    at = _world(cf, 90.0)
    names = {p.block.name: p for p in cf.blocks if p.block.name}
    for k, name in enumerate(("tier-1", "tier-2", "tier-3"), 1):
        p = names[name]
        y = p.block.lo + 1.0                       # beside its children, on its own top
        d, h, _ = at(cf.point(p.s_a + 1.0, y))
        assert abs(h - 20.0 * k) < 1e-6 and abs(d - 1.0) < 1e-6
        d, h, _ = at(cf.point(p.s_b - 1.0, y))     # the riser, one mm above its foot
        assert abs(d - p.block.b) < 1e-6 and abs(h - (20.0 * (k - 1) + 1.0)) < 1e-6
    frame = names["frame"]
    d, h, _ = at(cf.point(frame.s_f + 0.5, frame.block.lo + 1))
    assert abs(d - 5.0) < 1e-6 and abs(h - (60.0 + 34.0 - 0.5)) < 1e-6
    # a candle's flame continues the candle's front face upward, past its top
    candle = cf.blocks[-1]
    y_mid = candle.block.lo + 4.0
    d, h, _ = at(cf.point(candle.s_f - 4.0, y_mid))     # flame tip region (panel-2 crest)
    d0, _h0, _ = at(cf.point(candle.s_f + 1.0, y_mid))  # the candle's front face
    assert abs(d - d0) < 1e-6 and h > candle.block.a


def test_slit_crest_is_a_gable_on_its_panel():
    s = pliego.Sheet("strip", [(0, 0), (200, 0), (200, 140), (0, 140)], stock="cardstock-250")
    gable = [(0.0, 0.0), (13.0, 10.0), (26.0, 0.0)]
    b = Block(a=44, b=26, lo=10, hi=60, crest=gable, crest_panel=1, crest_side="hi",
              name="house")
    cf = cut_fold(s, (100, 0), (0, 1), (1, 0), [b], reach=(100, 100), span=(0, 140),
                  angle=120.0)
    assert cf.residual([0, 60, 120, 178], root=(1, 1)) < 1e-9
    arr = s.build()
    tr = K.face_transforms(arr, cf.edge_angles(120.0), K.root_face(arr, pliego.P(1, 1)))
    apex = cf.panel_point(0, 1, 13.0, 69.0)
    base = cf.panel_point(0, 1, 13.0, 30.0)
    fa, fb = K.root_face(arr, apex), K.root_face(arr, base)
    assert fa == fb                                   # the gable is the facade's own face
    assert tr[fa] is not None


@pytest.mark.parametrize("bad, why", [
    (dict(blocks=[Block(a=10, b=10, lo=20, hi=60), Block(a=10, b=10, lo=61, hi=90)]),
     "overlap"),
    (dict(blocks=[Block(a=170, b=10, lo=20, hi=60)]), "do not fit"),
    (dict(blocks=[Block(a=20, b=20, lo=20, hi=60,
                        children=[Block(a=10, b=10, lo=10, hi=50)])]), "uncut"),
    (dict(blocks=[Block(a=20, b=40, lo=20, hi=60, crest=[(0, 0), (20, 8), (40, 0)])]),
     "corner"),
    (dict(blocks=[Block(a=40, b=20, lo=20, hi=60, crest=[(0, 0), (10, 150), (20, 0)])]),
     "extent"),
    (dict(blocks=[Block(a=20, b=20, lo=20, hi=60, children=[Block(a=5, b=5, lo=30, hi=40,
                                                                  at="x")])]), "at must"),
])
def test_bad_trees_fail_loud(bad, why):
    with pytest.raises(ValueError, match=why):
        cut_fold(_card(), (0, H), (1, 0), (0, 1), reach=(H, H), span=(0, W), **bad)


def test_frame_vectors_are_checked_and_documents_are_deterministic():
    with pytest.raises(ValueError, match="unit"):
        cut_fold(_card(), (0, H), (2, 0), (0, 1), [], reach=(H, H), span=(0, W))
    with pytest.raises(ValueError, match="perpendicular"):
        cut_fold(_card(), (0, H), (1, 0), (math.sqrt(0.5), math.sqrt(0.5)), [], reach=(H, H),
                 span=(0, W))

    def doc():
        s = _card()
        cf = cut_fold(s, (0, H), (1, 0), (0, 1), [_altar()], reach=(H, H), span=(0, W),
                      margin=2.0)
        a = pliego.Assembly([s], initial={"angles": cf.angles(90.0), "root": (1, 1)})
        return a.build()

    d = doc()
    assert d.verify() == [], d.summary(d.verify())
    assert d.to_bytes() == doc().to_bytes()
