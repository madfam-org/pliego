"""Tessellation generators: valid documents, Miura angle law, Kawasaki/Maekawa, determinism."""

from __future__ import annotations

import math

import pytest

from pliego import exact
from pliego import tessellate as T

FLAT_FOLDABLE = ("miura-ori", "yoshimura", "waterbomb", "square-twist", "hex-twist")


def _interior_vertex_checks(doc) -> tuple[int, list[str]]:
    """Float Kawasaki (alternating sector sum = 0) and Maekawa (|M − V| = 2) on every interior
    vertex that carries creases. Returns (vertices checked, failures)."""
    d = doc.data
    coords = d["vertices_coords"]
    boundary = {v for e, a in zip(d["edges_vertices"], d["edges_assignment"], strict=True)
                if a == "B" for v in e}
    star: dict[int, list[tuple[float, str]]] = {}
    for (a, b), asg in zip(d["edges_vertices"], d["edges_assignment"], strict=True):
        if asg not in "MV":
            continue
        for v, w in ((a, b), (b, a)):
            ang = math.atan2(coords[w][1] - coords[v][1], coords[w][0] - coords[v][0])
            star.setdefault(v, []).append((ang, asg))
    checked, failures = 0, []
    for v, rays in star.items():
        if v in boundary or len(rays) < 3:
            continue
        rays.sort()
        sectors = [(rays[(k + 1) % len(rays)][0] - rays[k][0]) % (2 * math.pi)
                   for k in range(len(rays))]
        alt = math.degrees(math.fsum(s if k % 2 == 0 else -s for k, s in enumerate(sectors)))
        m = sum(1 for _, a in rays if a == "M")
        checked += 1
        if len(rays) % 2 or abs(alt) > 1e-5:
            failures.append(f"vertex {v}: Kawasaki alternating sum {alt:.6f}°")
        if abs(m - (len(rays) - m)) != 2:
            failures.append(f"vertex {v}: Maekawa M={m} V={len(rays) - m}")
    return checked, failures


@pytest.mark.parametrize("name", sorted(T.GENERATORS))
def test_every_generator_emits_a_valid_document(name):
    doc = T.GENERATORS[name]().document()
    issues = doc.verify()
    assert [i for i in issues if i["level"] == "error"] == [], doc.summary(issues)
    assert doc.summary(issues).startswith("verify: sheets=1 ")
    assert doc.to_bytes() == T.GENERATORS[name]().document().to_bytes()   # byte-stable


@pytest.mark.parametrize("name", FLAT_FOLDABLE)
def test_kawasaki_and_maekawa_hold_on_flat_foldable_patterns(name):
    checked, failures = _interior_vertex_checks(T.GENERATORS[name]().document())
    assert checked > 0, "scanned zero interior vertices"
    assert failures == []


@pytest.mark.parametrize("name", ("waterbomb", "yoshimura"))
def test_exact_kawasaki_on_rational_patterns(name):
    tess = T.GENERATORS[name]()
    arr = tess.sheet.build()
    star: dict[int, list[tuple[int, int]]] = {}
    boundary = {v for e, a in zip(arr.edges, arr.assignment, strict=True) if a == "B" for v in e}
    for (a, b), asg in zip(arr.edges, arr.assignment, strict=True):
        if asg in "MV":
            for v, w in ((a, b), (b, a)):
                star.setdefault(v, []).append((arr.grid[w][0] - arr.grid[v][0],
                                               arr.grid[w][1] - arr.grid[v][1]))
    interior = [v for v, dirs in star.items() if v not in boundary and len(dirs) >= 4]
    assert interior
    assert all(exact.kawasaki_exact(star[v]) for v in interior)


def test_resch_is_honestly_not_flat_foldable():
    tess = T.resch()
    assert tess.flat_foldable is False
    _checked, failures = _interior_vertex_checks(tess.document())
    assert any("Maekawa" in f for f in failures)


def test_miura_law_endpoints_and_degenerate_case():
    assert T.miura_fold_angles(60, 0) == pytest.approx((0.0, 0.0), abs=1e-9)
    assert T.miura_fold_angles(60, 60) == pytest.approx((180.0, 180.0), abs=1e-6)
    row, col = T.miura_fold_angles(89.999999, 30)
    assert row == pytest.approx(0.0, abs=1e-3) and col == pytest.approx(60.0, abs=1e-3)
    prev = (0.0, 0.0)
    for k in range(1, 60):                                   # monotone along the motion
        cur = T.miura_fold_angles(60, k)
        assert cur[0] > prev[0] and cur[1] > prev[1]
        prev = cur
    with pytest.raises(ValueError):
        T.miura_fold_angles(60, 61)


@pytest.mark.parametrize("gamma", (45.0, 60.0, 75.0))
def test_miura_closed_form_frame_matches_the_angle_law(gamma):
    tess = T.miura(nx=4, ny=4, gamma=gamma, fold=0.5)
    doc = tess.document()
    issues = doc.verify()
    assert issues == [], issues                              # half-folded frame is developable
    measured = T.document_fold_angles(doc, "target:half-folded")
    row, col = T.miura_fold_angles(gamma, gamma / 2)
    d = doc.data
    rows = {e for m in tess.groups["rows"] for e in m.edges()}
    cols = {e for m in tess.groups["columns"] for e in m.edges()}
    assert rows and cols and rows | cols == set(measured)
    for e, ang in measured.items():
        want = row if e in rows else col
        assert abs(ang) == pytest.approx(want, abs=1e-4)
        assert ang == pytest.approx(d["edges_foldAngle"][e], abs=1e-4)   # fold = 0.5 targets
        assert (ang > 0) == (d["edges_assignment"][e] == "V")


def test_miura_frame_preserves_every_edge_length():
    doc = T.miura(nx=3, ny=5, a=17.0, b=23.0, gamma=55.0).document()
    vc = doc.frame("target:half-folded")["vertices_coords"]
    for a, b in doc.data["edges_vertices"]:
        flat = math.dist(doc.data["vertices_coords"][a], doc.data["vertices_coords"][b])
        assert math.dist(vc[a], vc[b]) == pytest.approx(flat, abs=1e-5)


def test_accordion_pleats_run_edge_to_edge_and_alternate():
    tess = T.accordion(panels=6)
    kinds = [m.assignment for m in tess.groups["pleats"]]
    assert kinds == ["V", "M", "V", "M", "V"]
    assert all(m.points[0].y == 0 and m.points[1].y == 80 for m in tess.groups["pleats"])
    assert tess.flat_foldable and tess.mode == "kinematic"


def test_twist_rejects_bad_params():
    from pliego.geometry import Vec2

    assert T._segments_cross(Vec2(0, 0), Vec2(10, 10), Vec2(0, 10), Vec2(10, 0))
    assert not T._segments_cross(Vec2(0, 0), Vec2(10, 0), Vec2(0, 1), Vec2(10, 1))
    with pytest.raises(ValueError):
        T.twist(2)
    with pytest.raises(ValueError):
        T.twist(4, inner=140, sheet_size=150)
    with pytest.raises(ValueError):
        T.miura(gamma=90)
    with pytest.raises(ValueError):
        T.accordion(panels=0)


def test_fold_program_targets_every_crease():
    doc = T.square_twist().document()
    seq = doc.data["pliego:sequence"]
    mv = [e for e, a in enumerate(doc.data["edges_assignment"]) if a in "MV"]
    assert sorted(e for e, _ in seq["steps"][0]["targets"]) == mv
    assert {c["kind"] for c in doc.data["pliego:controls"]} == {"sequence"}
