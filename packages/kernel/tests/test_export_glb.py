"""GLB exporter: golden bytes and a structural parse (header, chunks, accessors, materials)."""

from __future__ import annotations

import json
import os
import struct
from pathlib import Path

import pytest

from pliego.export.glb import flat_state, to_glb

GOLDEN = Path(__file__).parent / "golden_export"


def sample() -> dict:
    return json.loads((GOLDEN / "sample.fold.json").read_text(encoding="utf-8"))


def parse(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert (magic, version, length) == (0x46546C67, 2, len(data))
    jlen, jtype = struct.unpack_from("<II", data, 12)
    assert jtype == 0x4E4F534A and jlen % 4 == 0
    gltf = json.loads(data[20:20 + jlen])
    blen, btype = struct.unpack_from("<II", data, 20 + jlen)
    assert btype == 0x004E4942 and blen % 4 == 0
    binary = data[28 + jlen:28 + jlen + blen]
    assert len(binary) == blen == gltf["buffers"][0]["byteLength"]
    return gltf, binary


def read_accessor(gltf: dict, binary: bytes, k: int) -> list:
    acc = gltf["accessors"][k]
    view = gltf["bufferViews"][acc["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3}[acc["type"]]
    fmt = {5126: "f", 5125: "I"}[acc["componentType"]]
    n = acc["count"] * width
    assert view["byteOffset"] % 4 == 0 and view["byteLength"] == 4 * n
    assert view["byteOffset"] + view["byteLength"] <= len(binary)
    return list(struct.unpack_from(f"<{n}{fmt}", binary, view["byteOffset"]))


def test_golden():
    data = to_glb(sample())
    path = GOLDEN / "sample.glb"
    if os.environ.get("PLIEGO_UPDATE_GOLDEN") == "1":
        path.write_bytes(data)
    assert path.read_bytes() == data


def test_parse_two_sided_sheets():
    gltf, binary = parse(to_glb(sample()))
    assert gltf["asset"]["version"] == "2.0"
    assert [m["name"] for m in gltf["meshes"]] == ["panel", "tab"]
    assert [m["name"] for m in gltf["materials"]] == ["panel-front", "panel-back", "tab-front",
                                                      "tab-back"]
    for mesh in gltf["meshes"]:
        front, back = mesh["primitives"]
        for prim in (front, back):
            pos = read_accessor(gltf, binary, prim["attributes"]["POSITION"])
            acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            for k in range(3):
                assert min(pos[k::3]) == acc["min"][k] and max(pos[k::3]) == acc["max"][k]
            idx = read_accessor(gltf, binary, prim["indices"])
            assert len(idx) % 3 == 0 and max(idx) < acc["count"]
        nf = read_accessor(gltf, binary, front["attributes"]["NORMAL"])
        nb = read_accessor(gltf, binary, back["attributes"]["NORMAL"])
        assert nf[:3] == [0.0, 1.0, 0.0] and nb[:3] == [0.0, -1.0, 0.0]   # flat initial frame
        fi = read_accessor(gltf, binary, front["indices"])
        bi = read_accessor(gltf, binary, back["indices"])
        assert bi[:3] == [fi[0], fi[2], fi[1]]                           # reversed winding


def test_initial_frame_is_used_and_scaled_to_metres():
    gltf, binary = parse(to_glb(sample()))
    tab_front = gltf["meshes"][1]["primitives"][0]
    acc = gltf["accessors"][tab_front["attributes"]["POSITION"]]
    assert acc["max"][1] == pytest.approx(0.0001)         # tab lies 0.1 mm above the panel
    assert gltf["asset"]["extras"]["pliego:unit_scale"] == 0.001


def test_morph_targets():
    d = sample()
    gltf, binary = parse(to_glb(d, morph=[flat_state(d)]))
    for mesh in gltf["meshes"]:
        assert mesh["weights"] == [0.0]
        for prim in mesh["primitives"]:
            (target,) = prim["targets"]
            acc = gltf["accessors"][target["POSITION"]]
            assert acc["count"] == gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
            read_accessor(gltf, binary, target["POSITION"])


def test_bad_state_fails_closed():
    with pytest.raises(ValueError):
        to_glb(sample(), state=[[0, 0, 0]])
    with pytest.raises(ValueError):
        to_glb(sample(), morph=["target:missing"])
