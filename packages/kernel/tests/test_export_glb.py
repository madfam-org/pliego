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


# ── animate=True: the fold program and mechanism sweeps as morph-target animations ──────────────
def check_structure(gltf: dict, binary: bytes) -> None:
    """glTF 2.0 structure an animated file must keep (core spec §3.6–§3.11): every accessor inside
    its view, vertex views targeted and animation views not, one target count per mesh, sampler
    inputs strictly increasing with min/max, outputs = inputs × weights."""
    width = {"SCALAR": 1, "VEC3": 3}
    for acc in gltf["accessors"]:
        view = gltf["bufferViews"][acc["bufferView"]]
        assert view["byteOffset"] % 4 == 0
        assert view["byteLength"] == 4 * acc["count"] * width[acc["type"]]
        assert view["byteOffset"] + view["byteLength"] <= len(binary)
    anim_accessors = {s[k] for a in gltf.get("animations", []) for s in a["samplers"]
                      for k in ("input", "output")}
    for k, acc in enumerate(gltf["accessors"]):
        view = gltf["bufferViews"][acc["bufferView"]]
        assert ("target" in view) == (k not in anim_accessors)
    for mesh in gltf["meshes"]:
        n = len(mesh.get("weights", []))
        assert len(mesh.get("extras", {}).get("targetNames", [])) in (0, n)
        for prim in mesh["primitives"]:
            count = gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
            assert len(prim.get("targets", [])) == n
            for tgt in prim.get("targets", []):
                pos = gltf["accessors"][tgt["POSITION"]]
                assert pos["count"] == count and "min" in pos and "max" in pos
                if "NORMAL" in tgt:
                    assert gltf["accessors"][tgt["NORMAL"]]["count"] == count
    for anim in gltf.get("animations", []):
        assert anim["channels"]
        for ch in anim["channels"]:
            sampler = anim["samplers"][ch["sampler"]]
            assert sampler["interpolation"] == "LINEAR" and ch["target"]["path"] == "weights"
            mesh = gltf["meshes"][gltf["nodes"][ch["target"]["node"]]["mesh"]]
            times = read_accessor(gltf, binary, sampler["input"])
            acc = gltf["accessors"][sampler["input"]]
            assert all(b > a for a, b in zip(times, times[1:], strict=False))
            assert acc["min"] == [times[0]] and acc["max"] == [times[-1]]
            weights = read_accessor(gltf, binary, sampler["output"])
            assert len(weights) == len(times) * len(mesh["weights"])
            assert all(w in (0.0, 1.0) for w in weights)


def positions(gltf, binary, prim, target=None):
    pos = read_accessor(gltf, binary, prim["attributes"]["POSITION"])
    if target is None:
        return pos
    delta = read_accessor(gltf, binary, prim["targets"][target]["POSITION"])
    return [a + b for a, b in zip(pos, delta, strict=True)]


def test_animate_plays_the_fold_program_and_ends_folded():
    d = sample()
    gltf, binary = parse(to_glb(d, animate=True))
    check_structure(gltf, binary)
    (anim,) = gltf["animations"]
    assert anim["name"] == "fold-program"
    extras = gltf["asset"]["extras"]["pliego:animation"]
    assert extras["clips"] == ["fold-program"] and not extras["reduced"]
    sampler = anim["samplers"][0]
    times = read_accessor(gltf, binary, sampler["input"])
    assert times[0] == 0.0 and times[-1] == pytest.approx(2.0)   # two steps of 1000 ms
    n = extras["targets"]
    weights = read_accessor(gltf, binary, sampler["output"])
    last = weights[-n:]
    assert last.count(1.0) == 1
    final = last.index(1.0)
    panel_front = gltf["meshes"][0]["primitives"][0]
    flat = positions(gltf, binary, panel_front)
    folded = positions(gltf, binary, panel_front, final)
    moved = max(abs(a - b) for a, b in zip(flat, folded, strict=True))
    assert moved > 0.01                                            # the panel moved (metres)
    # the 3-D extent of the folded panel: a 90° valley then a 90° mountain lift it off the table
    assert max(folded[1::3]) > max(flat[1::3]) + 0.01
    assert min(folded[1::3]) >= -1e-6                              # the ground clamp


def test_animate_without_a_program_or_mechanism_is_the_static_file():
    d = sample()
    d.pop("pliego:sequence")
    d["pliego:controls"] = []
    assert to_glb(d, animate=True) == to_glb(d)


def test_animate_sweeps_a_hinge_mechanism_there_and_back():
    d = sample()
    d.pop("pliego:sequence")
    d["pliego:controls"] = [{"id": "open", "kind": "angle", "min": 0, "max": 90, "default": 0}]
    d["pliego:mechanisms"] = [{"type": "hinge", "id": "lid", "angle_control": "open", "rest": 0,
                               "axis": {"origin": [80, 0, 0], "direction": [0, 0, -1]},
                               "sheets_moving": ["tab"]}]
    gltf, binary = parse(to_glb(d, animate=True))
    check_structure(gltf, binary)
    (anim,) = gltf["animations"]
    assert anim["name"] == "control:open"
    sampler = anim["samplers"][0]
    times = read_accessor(gltf, binary, sampler["input"])
    n = len(gltf["meshes"][0]["weights"])
    weights = read_accessor(gltf, binary, sampler["output"])
    keys = [weights[k * n:(k + 1) * n].index(1.0) for k in range(len(times))]
    assert keys == keys[::-1]                          # 0 → 90 → 0 reuses its keyframes
    tab = gltf["meshes"][1]["primitives"][0]
    open_ = positions(gltf, binary, tab, keys[len(keys) // 2])
    shut = positions(gltf, binary, tab, keys[0])
    assert max(open_[1::3]) > max(shut[1::3]) + 0.01   # the tab swings up off the panel


def test_animate_respects_the_morph_budget(monkeypatch):
    import pliego.export.glb as glb

    monkeypatch.setattr(glb, "MORPH_BUDGET", 1)
    gltf, _binary = parse(to_glb(sample(), animate=True))
    assert "animations" not in gltf
    assert "skipped" in gltf["asset"]["extras"]["pliego:animation"]
    with pytest.raises(ValueError):
        to_glb(sample(), animate=True, morph=[flat_state(sample())])
