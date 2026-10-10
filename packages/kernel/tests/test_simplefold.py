from __future__ import annotations

import pytest

import pliego
from pliego import flatfold
from pliego.simplefold import FoldedState


def quarter(size: float = 100.0) -> FoldedState:
    st = FoldedState(pliego.square(size))
    h = size / 2
    st.fold(((h, 0), (h, size)), "valley")       # left half over onto the right
    st.fold(((size, h), (h, h)), "valley")       # lower half up onto the upper
    return st


def test_layers_and_frames():
    st = quarter()
    assert len(st.layers) == 4
    assert len(st.frames) == 3
    for img in st.frames[-1].layers:  # every layer now covers the upper-right quarter
        xs, ys = [p.x for p in img], [p.y for p in img]
        assert (min(xs), max(xs), min(ys), max(ys)) == pytest.approx((50, 100, 50, 100))
    assert st.frames[-1].flipped.count(True) == 2


def test_crease_pattern_is_flat_foldable():
    st = quarter()
    cp = st.crease_pattern("quarter")
    arr = cp.build()
    reports, issues = flatfold.check(arr)
    assert reports and issues == []
    asg = sorted(a for a in arr.assignment if a in "MV")
    assert asg == ["M", "V", "V", "V"]  # the second fold shows as a mountain on flipped layers


def test_mountain_goes_under_and_unfold_alias():
    st = FoldedState(pliego.square(100))
    st.fold(((50, 0), (50, 100)), "mountain")
    assert st.layers[0].flipped and not st.layers[-1].flipped
    assert st.unfold("m").marks[0].assignment == "M"


def test_top_layer_only_and_errors():
    st = FoldedState(pliego.rectangle(100, 50))
    st.fold(((50, 0), (50, 50)), "valley")
    st.fold(((100, 25), (50, 25)), "valley", layers="top")
    assert len(st.layers) == 3
    with pytest.raises(ValueError):
        st.fold(((0, 0), (1, 0)), "sideways")
    with pytest.raises(ValueError):
        FoldedState([(0, 0), (10, 0), (5, 2), (10, 10), (0, 10)])  # not convex
