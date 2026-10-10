"""Papercraft unfolding (`pliego.mesh`, `pliego.unfold`): nets, tabs, numbers, folds, pages."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from test_stock import schema_errors

from pliego import mesh as M
from pliego import unfold as U
from pliego.export import to_dxf, to_pdf, to_svg
from pliego.kinematics import pose_arrangement
from pliego.space import add, quat_rotate
from pliego.unfold_build import _local_to_3d, _polys
from pliego.unfold_geom import apply, point_in_polygon

SCHEMA = json.loads((Path(__file__).resolve().parents[3] / "packages" / "schemas"
                     / "sheet-document.schema.json").read_text(encoding="utf-8"))


def saddle_fan() -> M.Mesh:
    """Eight equilateral triangles round one vertex (480° of angle): no single flat piece
    holds them all, so the unfolder must split the net into islands."""
    s = math.sin(math.radians(22.5))
    r = math.sqrt(3.0 / (4.0 * (1.0 - s * s)))
    h = math.sqrt(1.0 - r * r)
    ring = [(r * math.cos(math.pi * k / 4), h if k % 2 else -h, -r * math.sin(math.pi * k / 4))
            for k in range(8)]
    return M.Mesh([(0.0, 0.0, 0.0)] + ring, [[0, 1 + k, 1 + (k + 1) % 8] for k in range(8)])


MODELS = {
    "cube": (lambda: M.box(), 50.0),
    "icosahedron": (lambda: M.icosahedron(), 80.0),
    "torus": (lambda: M.torus(1.0, 0.4, 12, 6), 140.0),
    "saddle": (saddle_fan, 90.0),
}


def _segments_cross(p1, p2, q1, q2) -> bool:
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)

    o1, o2 = orient(p1, p2, q1), orient(p1, p2, q2)
    o3, o4 = orient(q1, q2, p1), orient(q1, q2, p2)
    return o1 * o2 < 0 and o3 * o4 < 0


def _overlap_free(polys: list[list[tuple[float, float]]]) -> bool:
    """Independent check: no two edges cross properly, no centroid lies inside another polygon."""
    for i, a in enumerate(polys):
        ca = (sum(p[0] for p in a) / len(a), sum(p[1] for p in a) / len(a))
        for j, b in enumerate(polys):
            if i == j:
                continue
            if point_in_polygon(ca, b, 1e-7) == 1:
                return False
            if j < i:
                continue
            for k in range(len(a)):
                for m in range(len(b)):
                    if _segments_cross(a[k], a[(k + 1) % len(a)], b[m], b[(m + 1) % len(b)]):
                        return False
    return True


@pytest.fixture(scope="module", params=sorted(MODELS))
def model(request, stocks):
    make, size = MODELS[request.param]
    return request.param, U.net(make(), size=size)


@pytest.fixture(scope="module")
def stocks():
    from conftest import STOCKS

    return {"cardstock-250": STOCKS["card"]}


def test_every_face_is_in_exactly_one_island(model):
    _name, net = model
    faces = [f for isl in net.islands for f in isl.faces]
    assert sorted(faces) == list(range(len(net.mesh.faces)))


def test_islands_are_flat_isometries_and_overlap_free(model):
    _name, net = model
    for isl in net.islands:
        for f in isl.faces:   # every face keeps its true edge lengths in the net
            pts3 = net.mesh.face_points(f)
            for k in range(len(pts3)):
                l3 = math.dist(pts3[k], pts3[(k + 1) % len(pts3)])
                l2 = math.dist(isl.pos[f][k], isl.pos[f][(k + 1) % len(pts3)])
                assert abs(l3 - l2) < 1e-9
        polys = [isl.pos[f] for f in isl.faces] + [t.poly for t in isl.tabs]
        assert _overlap_free(polys)


def test_cuts_are_numbered_once_and_labelled_on_both_sides(model):
    _name, net = model
    interior = {k for k, uses in net.mesh.edges().items() if len(uses) == 2}
    tree = {(min(a, b), max(a, b)) for isl in net.islands for *_x, a, b in isl.tree}
    assert {c.key for c in net.cuts} == interior - tree
    assert [c.number for c in net.cuts] == list(range(1, len(net.cuts) + 1))
    labels = [lb.text for isl in net.islands for lb in isl.labels]
    for c in net.cuts:
        assert labels.count(str(c.number)) == 2


def test_tabs_alternate_and_sit_under_the_matching_face(model):
    _name, net = model
    assert net.report["untabbed"] == []
    for isl in net.islands:
        for t in isl.tabs:
            cut = net.cuts[t.cut - 1]
            assert cut.tab_side is not None and cut.sides[cut.tab_side][1] == t.face
            foot = [apply(t.under_map, p) for p in net.local[t.under]]
            assert all(point_in_polygon(p, foot, 1e-6) >= 0 for p in t.poly)
    sides = [c.tab_side for c in net.cuts]
    assert 0 in sides and 1 in sides


def test_steepest_edge_also_unfolds_cleanly():
    net = U.net(M.icosphere(1), size=100, method="steepest-edge")
    assert net.report["untabbed"] == [] and len(net.islands) >= 1
    assert sorted(f for i in net.islands for f in i.faces) == list(range(80))


def test_saddle_forces_islands():
    net = U.net(saddle_fan(), size=90)
    assert len(net.islands) >= 2


def test_torus_has_mountain_and_valley_folds():
    net = U.net(M.torus(1.0, 0.4, 12, 6), size=140)
    assert min(net.fold.values()) < -1 and max(net.fold.values()) > 1


def test_cube_folds_are_right_angle_mountains():
    net = U.net(M.box(), size=50)
    assert all(abs(a + 90.0) < 1e-9 for a in net.fold.values())


@pytest.mark.parametrize("mode", ["fold", "glued"])
def test_assembly_documents_verify_and_match_the_schema(model, stocks, mode):
    _name, net = model
    doc = net.assembly(mode).build(stocks=stocks)
    issues = doc.verify()
    assert issues == [], doc.summary(issues)
    data = doc.data
    assert schema_errors(data, SCHEMA, SCHEMA) == []
    assert len(data["pliego:sheets"]) == len(net.islands)
    assert len(data["pliego:annotations"]) == 2 * len(net.cuts)
    assert len(data["pliego:pages"]["pages"]) == net.pages
    if mode == "glued":
        assert len(data["pliego:joins"]) == net.report["tabs"]
        assert data["pliego:sequence"]["mode"] == "physical"
    else:
        assert data["pliego:sequence"]["mode"] == "kinematic"
        ids = [c["id"] for c in data["pliego:controls"]]
        assert ids == (["sequence", "explode"] if len(net.islands) > 1 else ["sequence"])
    assert doc.to_bytes() == net.assembly(mode).build(stocks=stocks).to_bytes()


def test_folding_every_crease_rebuilds_the_model(model):
    """The fold program's end state (face-tree pose from face 0, then the placement) puts every
    vertex of every piece where it belongs on the scaled model."""
    _name, net = model
    asm = net.assembly("fold")
    worst = 0.0
    for isl, sheet in zip(net.islands, asm.sheets, strict=True):
        arr = sheet.build()
        angles = {e: arr.fold_angle[e] for e in range(len(arr.edges))
                  if arr.assignment[e] in ("M", "V")}
        posed = pose_arrangement(arr, angles)
        polys = _polys(net, isl)
        for v, p in zip(arr.vertices, posed, strict=True):
            got = add(quat_rotate(sheet.placement.rotation, p), sheet.placement.origin)
            poly, face, to_local = next(x for x in polys
                                        if point_in_polygon((v.x, v.y), x[0], 1e-6) >= 0)
            worst = max(worst, math.dist(got, _local_to_3d(net, face, apply(to_local,
                                                                            (v.x, v.y)))))
    assert worst < 1e-4


def test_pieces_lie_inside_their_pages(model):
    _name, net = model
    pw, ph = net.page_size
    for isl in net.islands:
        pts = [apply(isl.sheet_map, p) for f in isl.faces for p in isl.pos[f]]
        pts += [apply(isl.sheet_map, p) for t in isl.tabs for p in t.poly]
        x0 = isl.page * (pw + 20.0)
        for x, y in pts:
            gx, gy = x + isl.offset[0], y + isl.offset[1]
            assert x0 + net.margin - 1e-6 <= gx <= x0 + pw - net.margin + 1e-6
            assert net.margin - 1e-6 <= gy <= ph - net.margin + 1e-6


def test_exports_print_pages_numbers_and_frames(stocks):
    net = U.net(M.icosahedron(), size=80, page="letter")
    doc = net.assembly("fold").build(stocks=stocks)
    pdf = to_pdf(doc)
    assert f"/Count {net.pages}".encode() in pdf
    assert b"/MediaBox [0 0 612.00 792.00]" in pdf
    assert b" Tm (1) Tj" in pdf
    svg = to_svg(doc)
    assert '<g id="pages"' in svg and 'text-anchor="middle"' in svg
    dxf = to_dxf(doc)
    assert dxf.count("0\nTEXT\n8\nTEXT\n") == len(net.cuts) * 2 + len(net.islands)


def test_open_mesh_and_options():
    vase = M.lathe([(0.0, 0.0), (0.6, 0.05), (0.8, 0.6), (0.4, 1.2), (0.5, 1.5)], 8,
                   cap_top=False)
    net = U.net(vase, size=120, tabs="triangle", tab_height=5, tab_angle=40)
    assert not net.report["closed"] and net.report["untabbed"] == []
    assert all(len(t.poly) == 3 for i in net.islands for t in i.tabs)
    bare = U.net(vase, size=120, tabs="none")
    assert bare.report["tabs"] == 0


def test_bad_meshes_fail_loud():
    with pytest.raises(M.MeshError):
        U.net(M.Mesh([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [[0, 1, 2], [0, 1, 2]]))
    inside_out = M.box().scaled(1.0)
    inside_out.faces = [list(reversed(f)) for f in inside_out.faces]
    with pytest.raises(M.MeshError, match="inside out"):
        U.net(inside_out)
    with pytest.raises(M.MeshError, match="does not fit"):
        U.net(M.box(1, 1, 0.05), size=400)
    with pytest.raises(ValueError):
        U.net(M.box(), method="random")


def test_mesh_primitives_are_closed_outward_and_planar():
    for m in (M.box(1, 2, 3), M.icosphere(2), M.uv_sphere(8, 4), M.torus(), M.prism(
            [(0, 0), (4, 0), (4, 1), (2, 2), (0, 1)], 2), M.extrude(M.box(), 1, 0.5, 0.0),
            M.lathe([(0, 0), (1, 0.2), (1.2, 1), (0, 1.6)], 7)):
        m.check()
        assert m.is_closed() and m.signed_volume() > 0
        assert max(m.planarity(f) for f in range(len(m.faces))) < 1e-9
    bent = M.box().mapped(lambda p: (p[0], p[1] + 0.3 * p[0] * p[2], p[2]))
    assert len(bent.triangulated().faces) > 6
