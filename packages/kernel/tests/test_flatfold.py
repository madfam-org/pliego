from __future__ import annotations

import pytest
from patterns import miura, preliminary_base, square_twist, waterbomb_base

from pliego import flatfold


@pytest.mark.parametrize("build", [preliminary_base, waterbomb_base, square_twist, miura])
def test_known_patterns_are_flat_foldable(build):
    arr = build().build()
    reports, issues = flatfold.check(arr)
    assert reports, "scanned zero vertices"
    assert issues == []
    for r in reports:
        assert r.kawasaki_exact and r.kawasaki_float and r.maekawa and r.flat_foldable
    assert flatfold.is_flat_foldable(arr)


@pytest.mark.parametrize("build", [
    lambda: square_twist(shift=(0.5, 0.0)),
    lambda: miura(perturb=(2, 2, 0.7)),
])
def test_perturbed_vertices_are_not(build):
    arr = build().build()
    reports, issues = flatfold.check(arr)
    bad = [r for r in reports if not r.flat_foldable]
    assert bad
    assert any(i["kind"] == "kawasaki" for i in issues)
    for r in reports:  # exact and float verdicts agree on rational input
        assert r.kawasaki_exact == r.kawasaki_float


def test_maekawa_and_blb_violations():
    s = preliminary_base()
    s.marks[2].assignment = "V"  # all valleys: |M − V| = 6
    s.marks[2].fold_angle = 180.0
    s._touch()
    _, issues = flatfold.check(s.build())
    assert any(i["kind"] == "maekawa" for i in issues)


def test_big_little_big():
    import pliego

    s = pliego.Sheet("blb", pliego.square(100))
    c = (50, 50)
    # sectors 60, 30, 120, 150 → Kawasaki 60 + 120 = 180; smallest sector (30) between
    # the creases at 60° and 90°; give them the same assignment → BLB violation
    import math

    dirs = [0, 60, 90, 210]
    kinds = ["mountain", "valley", "valley", "valley"]
    for d, k in zip(dirs, kinds, strict=True):
        s.crease(c, (50 + 80 * math.cos(math.radians(d)), 50 + 80 * math.sin(math.radians(d))), k)
    reports, issues = flatfold.check(s.build())
    assert reports[0].maekawa is True
    assert reports[0].big_little_big is False
    assert any(i["kind"] == "big_little_big" for i in issues)


def test_flat_folded_positions_and_face_orders():
    arr = waterbomb_base().build()
    pts = flatfold.flat_folded_coords(arr)
    assert len(pts) == len(arr.grid)
    # folding preserves distances from the centre vertex
    centre = next(i for i, g in enumerate(arr.grid) if g == (50_000_000, 50_000_000))
    v = arr.vertices
    for i in range(len(pts)):
        d_flat = v[i].distance(v[centre])
        d_fold = ((pts[i][0] - pts[centre][0]) ** 2 + (pts[i][1] - pts[centre][1]) ** 2) ** 0.5
        assert abs(d_flat - d_fold) < 1e-6
    orders = flatfold.face_orders_local(arr)
    assert orders and all(o[2] in (-1, 1) for o in orders)
    assert orders == sorted(orders)
