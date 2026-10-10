"""Layer-ordered flat states (`pliego.flatstate`, `pliego.flatcheck`) and the basic operations."""

from __future__ import annotations

import math

import pytest

import pliego
from pliego import flatops
from pliego.flatcheck import check, solve
from pliego.flatstate import FlatState, FlatStateError

S = 150.0
SQUARE = [(0, 0), (S, 0), (S, S), (0, S)]


def halved_twice() -> FlatState:
    st = FlatState.of(SQUARE)
    st = flatops.fold(st, ((S, 0), (0, S)), "valley", at=(10, 10)).state
    return flatops.fold(st, ((S / 2, S / 2), (S, S)), "valley", at=(S * 0.9, S * 0.6)).state


def test_flat_sheet_is_valid_and_convex_only():
    st = FlatState.of(SQUARE)
    assert check(st) == []
    assert len(st.faces) == 1 and not st.creases()
    with pytest.raises(FlatStateError, match="convex"):
        FlatState.of([(0, 0), (10, 0), (5, 2), (10, 10), (0, 10)])


def test_valley_fold_through_all_layers():
    m = flatops.fold(FlatState.of(SQUARE), ((S, 0), (0, S)), "valley", at=(10, 10))
    st = m.state
    assert check(st) == []
    (c,) = st.creases()
    assert c.angle == 180.0
    moved = m.info["moving"][0]
    other = 1 - moved
    assert st.above(moved, other) is True        # a valley lands on top
    m2 = flatops.fold(FlatState.of(SQUARE), ((S, 0), (0, S)), "mountain", at=(10, 10))
    assert m2.state.creases()[0].angle == -180.0


def test_two_folds_stack_four_layers_in_order():
    st = halved_twice()
    assert check(st) == []
    stack = st.faces_at((S * 0.6, S * 0.7))
    assert len(stack) == 4
    # every fold is a valley seen from the front, Maekawa-consistent at the centre
    issues = check(st)
    assert not issues
    assert sorted(c.angle for c in st.creases()).count(180.0) >= 2


def test_turn_over_keeps_crease_angles_and_reverses_the_stack():
    st = halved_twice()
    before = sorted((c.a, c.b, c.angle) for c in st.creases())
    q = (S * 0.6, S * 0.7)
    stack = st.faces_at(q)
    tv = st.turn_over()
    x0, _, x1, _ = st.bbox()
    q2 = (x0 + x1 - q[0], q[1])
    assert sorted((c.a, c.b, c.angle) for c in tv.creases()) == before
    assert tv.faces_at(q2) == list(reversed(stack))
    assert check(tv) == []


def test_unfold_gives_the_crease_pattern():
    st = halved_twice()
    sheet = st.unfold("cp", stock="kami")
    assert isinstance(sheet, pliego.Sheet)
    kinds = sorted(m.assignment for m in sheet.marks)
    assert kinds and set(kinds) <= {"M", "V", "F"}
    arr = sheet.build()
    reports, issues = pliego.flatfold.check(arr)
    assert not [i for i in issues if i["level"] == "error"]


def test_check_catches_a_broken_layer_order():
    st = halved_twice()
    key = sorted(st.order)[0]
    bad = FlatState(st.outline, st.points, st.faces, {**st.order, key: -st.order[key]})
    issues = check(bad)
    assert issues and all(i["level"] == "error" for i in issues)


def test_check_catches_a_misplaced_face():
    st = halved_twice()
    f0 = st.faces[0]
    a, b, c, d, tx, ty = f0.xf
    moved = type(f0)(f0.verts, (a, b, c, d, tx + 1.0, ty))
    bad = FlatState(st.outline, st.points, [moved, *st.faces[1:]], st.order)
    assert any(i["kind"] == "placement" for i in check(bad))


def test_solver_recovers_a_dropped_order():
    st = halved_twice()
    key = sorted(st.order)[-1]
    partial = FlatState(st.outline, st.points, st.faces,
                        {k: v for k, v in st.order.items() if k != key})
    solved = solve(partial, {key: -st.order[key]})
    assert solved.order[key] == st.order[key]       # the constraints override the hint


def pt_centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def test_vertex_near_snaps_exactly():
    st = halved_twice()
    p = st.vertex_near((S / 2 + 0.01, S / 2 - 0.01))
    assert math.dist(p, (S / 2, S / 2)) < 1e-9
    with pytest.raises(FlatStateError):
        st.vertex_near((3.0, 50.0), 0.1)


def test_flap_selection_by_sheet_points_matches_layers():
    st = halved_twice()
    line = ((0, 120), (S, 120))
    by_layers = flatops.fold(st, line, "valley", at=(60, 135), layers=1)
    top = by_layers.before.faces_at((60, 135))[-1]
    pt_on_top = by_layers.before.poly(top)
    seed = by_layers.before.points[by_layers.before.faces[top].verts[0]]
    seed = tuple(0.9 * a + 0.1 * b for a, b in zip(seed, pt_centroid(pt_on_top), strict=True))
    by_points = flatops.fold(st, line, "valley", at=(60, 135), sheet_points=[seed])
    assert sorted(by_layers.info["moving"]) == sorted(by_points.info["moving"])


@pytest.mark.parametrize("kwargs, match", [
    ({"at": (S / 2, S / 2 + 10.0), "layers": 1}, "on the fold line"),
    ({"at": (40, 130), "layers": 9}, "layers asked"),
    ({"at": (40, 130), "layers": 1, "from_": "bottom"}, "pass through"),
])
def test_fold_rejects_invalid_selections(kwargs, match):
    st = halved_twice()
    line = ((S / 2, S / 2), (S / 2, S))
    with pytest.raises(FlatStateError, match=match):
        flatops.fold(st, line, "valley", **kwargs)


def test_fold_rejects_a_line_grazing_a_vertex():
    st = FlatState.of(SQUARE)
    with pytest.raises(FlatStateError, match="from the vertex"):
        flatops.fold(st, ((0.01, 0), (S, S)), "valley", at=(10, 100))


def test_fold_rejects_an_unknown_direction():
    with pytest.raises(FlatStateError, match="valley or mountain"):
        flatops.fold(FlatState.of(SQUARE), ((0, 0), (S, S)), "sideways")


def test_crease_and_unfold_adds_flat_creases_only():
    st = FlatState.of(SQUARE)
    fold, back = flatops.crease_and_unfold(st, ((0, S / 2), (S, S / 2)), "valley", at=(10, 10))
    assert fold.state.creases()[0].angle == 180.0
    out = back.state
    assert check(out) == []
    assert [c.angle for c in out.creases()] == [0.0]
    assert all(not out.flipped(f) for f in range(len(out.faces)))
