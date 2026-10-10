"""`pliego.reveal`: scenes, the stack slicer and the reveal program (spec §5.8)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from test_stock import schema_errors

import pliego
from pliego.geometry import polygon_area

R = pliego.reveal
SCHEMA = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                     / "sheet-document.schema.json").read_text(encoding="utf-8"))


def keep_area(block, doc, layer: int) -> float:
    """Kept material area (mm²) of one layer, from the document's keep pieces."""
    sid = block.sheets[layer].id
    coords = doc.data["vertices_coords"]
    area = 0.0
    for p in doc.data["pliego:pieces"]:
        if p["sheet"] == sid and p["role"] == "keep":
            for f in p["faces"]:
                ring = [pliego.Vec2(*coords[v]) for v in doc.data["faces_vertices"][f]]
                area += polygon_area(ring)
    return area


def build(scene, **kw):
    block = R.slice_block(scene, **kw)
    doc = block.assembly.build()
    errs = [i for i in doc.verify() if i["level"] == "error"]
    assert errs == [], errs[:3]
    return block, doc


def test_scene_values_sign():
    s = R.sphere((0, 0, 0), 10)
    assert s.value(0, 0, 0) == -10 and s.value(20, 0, 0) == 10
    b = R.box((0, 0, 0), (10, 10, 10))
    assert b.value(5, 5, 5) < 0 < b.value(15, 5, 5)
    c = R.cone((0, 0), 10, 0, 10)
    assert c.value(0, 0, 5) < 0 < c.value(6, 0, 5)
    u = R.subtract(R.cylinder((0, 0), 10, 0, 5), R.cylinder((0, 0), 4, -1, 6))
    assert u.value(7, 0, 2) < 0 < u.value(0, 0, 2)
    assert (b | s).value(-5, 0, 0) < 0 and (b & s).value(-5, 0, 0) > 0
    with pytest.raises(ValueError):
        R.box((0, 0, 0), (0, 1, 1))
    with pytest.raises(ValueError):
        R.sphere((0, 0, 0), -1)


def test_sphere_on_a_pedestal_slices_into_a_valid_stack():
    scene = R.union(R.cylinder((35, 35), 14, 0, 8), R.cylinder((35, 35), 5, 0, 22),
                    R.sphere((35, 35, 34), 15))
    block, doc = build(scene, size=(70, 70), height=50, layers=40, stock="copy-80")
    rep = block.report
    assert rep["layers"] == 40 and rep["represents"] == 12 and rep["real_sheets"] == 480
    st = doc.data["pliego:stacks"][0]
    assert st["represents"] == 12 and abs(st["pitch_mm"] - 1.2) < 1e-9
    assert st["binding"] == {"kind": "padding", "edge": [[0, 70], [70, 70]]}
    steps = doc.data["pliego:sequence"]["steps"]
    assert steps[0]["id"] == "tear-layer-040" and steps[-1]["id"] == "tear-layer-001"
    assert steps[0]["label"]["es"] == "Arranca las hojas 1–12"
    removed = [r for s in steps for r in s["remove"]]
    excess = [p["id"] for p in doc.data["pliego:pieces"] if p["role"] == "excess"]
    assert sorted(removed) == sorted(excess) and len(set(removed)) == len(removed)
    assert rep["overhang_layers"] > 0          # the lower half of the sphere overhangs
    assert rep["vertices"] < 60000
    controls = doc.data["pliego:controls"]
    assert controls[0]["id"] == "reveal" and controls[0]["max"] == len(steps)
    assert schema_errors(doc.data, SCHEMA, SCHEMA) == []


def test_cross_section_area_matches_the_scene():
    # z of layer 30 of 40 (pitch 1.25 mm for a 50 mm block): sampled at 36.875 × 50/48.
    block, doc = build(R.sphere((35, 35, 30), 18), size=(70, 70), height=50, layers=40)
    z = (29 + 0.5) * block.report["pitch_mm"] * 50.0 / block.report["height_mm"]
    r2 = 18 ** 2 - (z - 30) ** 2
    want = math.pi * r2
    got = keep_area(block, doc, 29)
    assert abs(got - want) / want < 0.03, (got, want)


def test_holes_and_islands():
    ring = R.subtract(R.cylinder((25, 30), 12, 0, 20), R.cylinder((25, 30), 6, -1, 21))
    towers = R.union(ring, R.box((44, 10, 0), (54, 50, 20)))
    block, doc = build(towers, size=(64, 60), height=20, layers=10, tear_grid=1)
    mid = block.layers[5]
    assert mid["keep"] == 2                      # the ring and the bar
    assert mid["excess"] == 2                    # the frame and the ring's core
    want = math.pi * (12 ** 2 - 6 ** 2) + 10 * 40
    got = keep_area(block, doc, 5)
    assert abs(got - want) / want < 0.03, (got, want)


def test_features_under_the_minimum_disappear():
    wall = R.box((10, 10, 0), (11.2, 50, 20))              # 1.2 mm thick: under 2 mm
    slab = R.subtract(R.box((20, 10, 0), (50, 50, 20)), R.box((34.4, 5, -1), (35.6, 55, 21)))
    block, _ = build(R.union(wall, slab), size=(60, 60), height=20, layers=6, min_feature=2.0,
                     tear_grid=1)
    for info in block.layers:
        assert info["keep"] == 1, info            # the wall is gone, the slit is closed


def test_tear_lines_split_the_frame_into_chunks():
    scene = R.cylinder((35, 35), 15, 0, 30)
    block, doc = build(scene, size=(70, 70), height=30, layers=5, tear_grid=2)
    assert all(x["excess"] == 4 and x["tears"] == 4 for x in block.layers)
    perforations = [t for t, a in zip(doc.data["pliego:edges_treatment"],
                                      doc.data["edges_assignment"], strict=True)
                    if t == "perforation" and a == "C"]
    assert perforations
    one, _ = build(scene, size=(70, 70), height=30, layers=5, tear_grid=1)
    assert all(x["excess"] == 1 and x["tears"] == 0 for x in one.layers)


@pytest.mark.parametrize("contour", ["cut", "perforation", "halfcut"])
def test_contour_treatments(contour):
    _, doc = build(R.cylinder((20, 20), 8, 0, 10), size=(40, 40), height=10, layers=4,
                   contour=contour)
    trt = set(doc.data["pliego:edges_treatment"])
    assert {"cut": "cut", "perforation": "perforation", "halfcut": "halfcut"}[contour] in trt


def test_fabrication_slices_every_real_sheet():
    block, doc = build(R.cone((12, 12), 8, 0, 2.0), size=(24, 24), height=2.0, layers=4,
                       fabrication=True, stock="copy-80")
    assert block.report["represents"] == 1 and block.report["layers"] == 20
    assert doc.data["pliego:stacks"][0]["pitch_mm"] == 0.1
    assert len(doc.data["pliego:sheets"]) == 20


def test_heightfield_terraces_and_determinism():
    def h(x, y):
        r = max(abs(x - 30), abs(y - 30))
        return 0.0 if r > 24 else 6.0 * (1 + math.floor((24 - r) / 6))

    a = R.slice_block(R.heightfield(h), size=(60, 60), height=30, layers=12)
    b = R.slice_block(R.heightfield(h), size=(60, 60), height=30, layers=12)
    da, db = a.assembly.build(), b.assembly.build()
    assert da.to_bytes() == db.to_bytes()
    assert [x["keep"] for x in a.layers][:4] == [1, 1, 1, 1]
    assert a.layers[-1]["keep"] == 0 and a.layers[-1]["excess"] == 1   # above the summit
    assert R.bridge_report(a)["layers_checked"] > 0


def test_slicer_fails_loud():
    s = R.sphere((10, 10, 10), 5)
    with pytest.raises(ValueError):
        R.slice_block(s, size=(0, 20))
    with pytest.raises(ValueError):
        R.slice_block(s, contour="laser")
    with pytest.raises(ValueError):
        R.slice_block(s, tear_grid=0)
    with pytest.raises(TypeError):
        R.heightfield(3)


def test_union_of_towers_is_evaluated_exactly_near_every_part():
    towers = R.union(R.box((8, 8, 0), (20, 20, 10)), R.box((26, 8, 0), (38, 22, 16)),
                     R.box((8, 28, 0), (24, 40, 6)))
    block, doc = build(towers, size=(46, 48), height=16, layers=8, tear_grid=1)
    for layer in range(8):
        z = (layer + 0.5) * block.report["pitch_mm"] * 16 / block.report["height_mm"]
        want = sum(a for top, a in ((10, 144), (16, 168), (6, 192)) if z < top)
        got = keep_area(block, doc, layer)
        assert abs(got - want) <= 0.03 * want + 1e-9, (layer, got, want)
