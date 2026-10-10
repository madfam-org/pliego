"""Compound moves (`pliego.flatcompound`): squash, petal, reverse folds, rabbit ear; and the bird
base, the crane and the frog base folded by operations (`tests/flat_models.py`)."""

from __future__ import annotations

import math

import flat_models as fm
import pytest

from pliego import flatfold, flatops
from pliego.flatcheck import check
from pliego.flatstate import FlatState, FlatStateError

S = 150.0
SQUARE = [(0, 0), (S, 0), (S, S), (0, S)]


def test_squash_makes_half_a_preliminary_base():
    st = FlatState.of(SQUARE)
    st = flatops.fold(st, ((S, 0), (0, S)), "valley", at=(10, 10)).state
    st = flatops.fold(st, ((S / 2, S / 2), (S, S)), "valley", at=(S * 0.9, S * 0.6)).state
    m = flatops.squash(st, ((S / 2, S / 2), (S, S)), at=(S * 0.45, S * 0.85))
    out = m.state
    assert check(out) == []
    assert m.info["corner"] == pytest.approx((S / 2, S / 2))
    # the flap is now the square standing on its diagonal, symmetric about the hinge
    flap = set(m.info["groups"]["a_h"]) | set(m.info["groups"]["a_s"])
    pts = [p for f in flap for p in out.image(f)]
    assert max(p[0] for p in pts) == pytest.approx(S)
    assert min(p[1] for p in pts) == pytest.approx(S / 2)


def test_preliminary_base_by_operations():
    fp = fm.preliminary()
    st = fp.state
    assert check(st) == []
    o, b, lft, rgt = fm.corners(fp)
    assert math.dist(o, b) == pytest.approx(S * math.sqrt(2) / 2)
    assert math.dist(lft, rgt) == pytest.approx(S * math.sqrt(2) / 2)
    assert len(st.faces_at((rgt[0] - 5, rgt[1]))) == 4      # four layers each side


def test_bird_base_layer_order_and_crease_parity():
    fp, (o, b, lft, rgt, kl, kr) = fm.bird_base()
    st = fp.state
    assert check(st) == []
    # sheet regions of the petal facing the viewer (the second one, corner (S, 0)): the petal,
    # one kite side, the base's top triangle under the petal
    k = S * (2 - math.sqrt(2)) / 2
    c, k1, k2 = (S, 0.0), (S / 2 + k, S / 2), (S / 2, S / 2 - k)
    mid = ((k1[0] + k2[0]) / 2, (k1[1] + k2[1]) / 2)   # the hinge meets the petal's diagonal
    petal = st.face_at(((c[0] + k1[0] + mid[0]) / 3, (c[1] + k1[1] + mid[1]) / 3))
    side = st.face_at(((2 * S + k1[0]) / 3, (S / 2 + k1[1] + 0) / 3))
    top = st.face_at(((S / 2 + k1[0] + mid[0]) / 3, (S / 2 + k1[1] + mid[1]) / 3))
    assert st.above(side, petal) is True          # the kite flaps lie over the petal (the seam)
    assert st.above(petal, top) is True           # the petal lies over the base's top triangle
    assert st.above(side, top) is True
    # crease parity (the traditional bird base): kites, kite creases of the inner layers and the
    # inner book folds share one sign; the leg diagonal and the petal hinges the other
    seg = {tuple(round(c, 3) for p in s for c in p): a for s, a in st.crease_segments()}

    def sign(a, b):
        for key in (tuple(round(c, 3) for c in (*a, *b)), tuple(round(c, 3) for c in (*b, *a))):
            if key in seg:
                return math.copysign(1, seg[key]) if seg[key] else 0
        raise AssertionError(f"no crease {a}–{b}")
    kite = sign(c, k1)
    assert kite != 0
    assert sign(c, k2) == kite
    assert sign((S, S), k1) == kite                  # inner layer's kite crease (to a leg)
    assert sign(k1, (S - k1[0], S / 2)) == kite      # inner book fold
    assert sign(k1, k2) == -kite                     # petal hinge
    assert sign((0, 0), (S, S)) == -kite             # leg diagonal
    reports, issues = flatfold.check(st.unfold("bird").build())
    assert not [i for i in issues if i["level"] == "error"]
    assert all(r.flat_foldable for r in reports)


def test_crane_is_a_valid_flat_folding():
    fp, _ = fm.crane()
    st = fp.state
    assert check(st) == []
    reports, issues = flatfold.check(st.unfold("crane").build())
    assert not [i for i in issues if i["level"] == "error"]
    assert len(reports) > 40 and all(r.maekawa and r.flat_foldable for r in reports)


def test_reverse_fold_inside_and_outside_on_a_folded_strip():
    st = FlatState.of([(0, 0), (200, 0), (200, 60), (0, 60)])
    st = flatops.fold(st, ((0, 30), (200, 30)), "valley", at=(100, 50)).state
    down = ((100, 30), (130, 0))      # the tip turns down, through the open edges
    up = ((100, 0), (130, 30))        # the tip turns up, over the folded edge
    inside = flatops.reverse_fold(st, down, at=(180, 20), kind="inside")
    outside = flatops.reverse_fold(st, up, at=(180, 20), kind="outside")
    for m in (inside, outside):
        assert check(m.state) == []
        assert len(m.info["front"]) == len(m.info["back"]) == 1
    f_in, b_in = inside.info["front"][0], inside.info["back"][0]
    others = [f for f in range(len(inside.state.faces)) if f not in (f_in, b_in)]
    # inside: the reversed halves lie between the base's two layers
    rel = {f: inside.state.above(f, f_in) for f in others}
    assert sorted(v for v in rel.values() if v is not None) == [False, True]
    f_out = outside.info["front"][0]
    assert all(outside.state.above(f_out, f) for f in range(len(outside.state.faces))
               if f != f_out and outside.state.above(f_out, f) is not None)
    with pytest.raises(FlatStateError, match="cannot turn inside"):
        flatops.reverse_fold(st, up, at=(180, 20), kind="inside")


def test_reverse_fold_rejects_a_single_layer():
    st = FlatState.of([(0, 0), (200, 0), (200, 60), (0, 60)])
    with pytest.raises(FlatStateError, match="one layer"):
        flatops.reverse_fold(st, ((100, 0), (130, 60)), at=(180, 20))


def test_squash_rejects_a_flap_without_halves():
    st = flatops.fold(FlatState.of(SQUARE), ((S, 0), (0, S)), "valley", at=(10, 10)).state
    with pytest.raises(FlatStateError):
        flatops.squash(st, ((S, 0), (S, S)), at=(S * 0.8, S * 0.6), layers=2)


def test_petal_rejects_a_missing_side():
    fp = fm.preliminary()
    o, b, lft, rgt = fm.corners(fp)
    with pytest.raises(FlatStateError):
        flatops.petal(fp.state, (lft, rgt), (b[0], b[1] + 1.0))


def test_rabbit_ear_on_a_folded_triangle():
    st = flatops.fold(FlatState.of(SQUARE), ((S, 0), (0, S)), "valley", at=(10, 10)).state
    m = flatops.rabbit_ear(st, ((S, 0), (S, S), (0, S)))
    assert check(m.state) == []
    inc = m.info["incentre"]
    r = S * (2 - math.sqrt(2)) / 2
    assert inc == pytest.approx((S - r, S - r))


def test_rabbit_ear_rejects_a_triangle_off_the_paper():
    st = FlatState.of(SQUARE)
    with pytest.raises(FlatStateError):
        flatops.rabbit_ear(st, ((200, 0), (300, 0), (250, 80)))
