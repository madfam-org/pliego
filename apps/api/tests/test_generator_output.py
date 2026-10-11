"""GOC-1: the keystone's golden vectors, Pliego's variables, the X-Generator-* headers on every render
and the digest-stamped bundle export."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from pathlib import Path

from conftest import API, APP, needs_kernel

from apps.api import generator
from apps.api.generator import goc

DOC = "/api/v1/documents"
EXP = "/api/v1/exports"

# hyperobjects-spec tests/test_generator_output.py (GOC-1 §3): pinned there on purpose; a digest
# that moves here forks the fleet.
CONTRACT_VARIABLES = [
    {"id": "clearance", "value": 0.3, "type": "number", "source": "request"},
    {"id": "mode_flag", "value": True, "type": "boolean", "source": "manifest_default"},
    {"id": "wall", "value": None, "type": "number", "source": "source_default"},
]
GOLDEN_VARIABLES_SHA256 = "c00f4dbbfbafc08f6a1866035db2d755919396e58aacaace0446f7160009fb45"
GOLDEN_INSTANCE_ID = "a54c274af5b200faf28cff7f3cbbfe56201fe499690c9adf3dc0558a55c4bbc5"
GOLDEN_INSTANCE_ID_NO_PART = "9de127dfbe91c0bf7abcc31f840f193f86003eb3d5143d46b65a5892da46ef83"
GOLDEN_TREE_SHA256 = "cd14807f3f30138087008e987ef3c9e7c0dab82ac70c73cec420b7c71f0669ce"


def test_golden_variables_and_instance_id():
    assert goc.variables_sha256(CONTRACT_VARIABLES) == GOLDEN_VARIABLES_SHA256
    assert goc.variables_sha256(CONTRACT_VARIABLES[::-1]) == GOLDEN_VARIABLES_SHA256
    tree = "0" * 64
    assert goc.instance_id("demo", "m", "p", tree, GOLDEN_VARIABLES_SHA256) == GOLDEN_INSTANCE_ID
    assert goc.instance_id("demo", "m", None, tree, GOLDEN_VARIABLES_SHA256) == \
        GOLDEN_INSTANCE_ID_NO_PART


def test_integral_floats_hash_as_ints():
    as_float = [{"id": "size", "value": 150.0}]
    as_int = [{"id": "size", "value": 150}]
    assert goc.variables_sha256(as_float) == goc.variables_sha256(as_int)
    assert goc.canonical_json([True, 1.5, -0.0]) == b"[true,1.5,0]"


def test_golden_tree_sha256(tmp_path: Path):
    root = tmp_path
    for d in ("sub/docs", "docs", "__pycache__", "node_modules/x", ".git"):
        (root / d).mkdir(parents=True)
    files = {
        "project.json": b'{"project":{"slug":"demo"}}\n', "main.py": b"result = None\n",
        "sub/part.scad": b"cube(1);\n", "sub/docs/kept.json": b"{}\n",
        "LICENSE": b"CERN-OHL-W-2.0\n", "README.md": b"# demo\n",
        "notes.TXT": b"upper-case suffix\n", "thumb.PNG": b"\x89PNG", "docs/spec.json": b"{}\n",
        "__pycache__/main.cpython-313.pyc": b"\x00", "node_modules/x/index.js": b"0\n",
        ".git/HEAD": b"ref: refs/heads/main\n",
    }
    for rel, data in files.items():
        (root / rel).write_bytes(data)
    assert goc.tree_sha256(root) == GOLDEN_TREE_SHA256


def test_variables_record_every_declared_parameter():
    params = (
        {"id": "size", "type": "slider", "default": 150, "unit": "mm"},
        {"id": "stock", "type": "select", "default": "kami", "options": [{"value": "kami"}]},
        {"id": "flaps", "type": "integer", "default": 4, "modes": ["other"]},
        {"id": "infill", "type": "slider", "default": 20},
    )
    variables, legacy = goc.variables_for(params, {"size": 120}, {"size": 120, "stock": "kami",
                                                                   "infill": 20})
    assert [v["id"] for v in variables] == ["flaps", "size", "stock"]   # sorted, physical out
    by_id = {v["id"]: v for v in variables}
    assert by_id["size"] == {"id": "size", "value": 120, "type": "number", "source": "request",
                             "unit": "mm"}
    assert by_id["stock"]["source"] == "manifest_default"
    assert by_id["flaps"] == {"id": "flaps", "value": None, "type": "number",
                              "source": "source_default"}
    assert legacy == {"infill": 20}
    doc = goc.build_document(cartridge="demo", mode="default", variables=variables,
                             tree_sha="0" * 64, geometry=[], legacy=legacy)
    assert doc["complete"] is False and doc["kind"] == "sheet"
    assert doc["generator"]["platform"] == doc["generator"]["engine"] == "pliego"
    assert doc["generator"]["commons"] == {"repo": "sheet-hyperobjects"}


def test_dropped_and_clamped_headers_seam():
    doc = {"instance_id": "a" * 64, "variables_sha256": "b" * 64, "complete": True}
    assert set(generator.headers(doc)) == {"X-Generator-Instance-Id",
                                           "X-Generator-Variables-Sha256", "X-Generator-Complete"}
    out = generator.headers(doc, {"z": "unknown", "a b": "invalid"}, ("size",))
    assert out["X-Generator-Dropped-Params"] == "a%20b=invalid,z=unknown"
    assert out["X-Generator-Clamped-Params"] == "size"


# ── through the API ──────────────────────────────────────────────────────────
def _post(client, path, body, **kw):
    return client.post(path, json=body, base_url=API, **kw)


def _expected_instance(tree: Path, size) -> tuple[str, str]:
    variables = [{"id": "size", "value": size}, {"id": "stock", "value": "kami"}]
    var_sha = goc.variables_sha256(variables)
    tree_sha = goc.tree_sha256(tree / "projects" / "valley-fold")
    return goc.instance_id("valley-fold", "default", None, tree_sha, var_sha), var_sha


def test_every_render_carries_the_generator_headers(client, tree):
    needs_kernel()
    instance, var_sha = _expected_instance(tree, 120)
    doc = _post(client, DOC, {"slug": "valley-fold", "params": {"size": 120}},
                headers={"Origin": APP})
    svg = _post(client, EXP, {"slug": "valley-fold", "params": {"size": 120.0}, "format": "svg"})
    for resp in (doc, svg):
        assert resp.status_code == 200
        assert resp.headers["X-Generator-Instance-Id"] == instance   # 120 and 120.0: one instance
        assert resp.headers["X-Generator-Variables-Sha256"] == var_sha
        assert resp.headers["X-Generator-Complete"] == "true"
        assert "X-Generator-Dropped-Params" not in resp.headers      # strict API: 400, never drop
    exposed = doc.headers["Access-Control-Expose-Headers"]
    for name in generator.GENERATOR_HEADERS + ("X-Pliego-Cache", "Repr-Digest"):
        assert name in exposed


def _bundle(client, **extra):
    return _post(client, EXP, {"slug": "valley-fold", "params": {"size": 120}, "format": "bundle",
                               **extra})


def test_bundle_holds_the_document_the_cut_files_and_variables(client, tree):
    needs_kernel()
    resp = _bundle(client)
    assert resp.status_code == 200, resp.get_json()
    assert resp.mimetype == "application/zip"
    instance, _ = _expected_instance(tree, 120)
    assert resp.headers["X-Generator-Instance-Id"] == instance
    assert resp.headers["Content-Disposition"] == \
        f'attachment; filename="valley-fold-default-{instance[:12]}.zip"'
    digest = base64.b64encode(hashlib.sha256(resp.data).digest()).decode()
    assert resp.headers["Repr-Digest"] == f"sha-256=:{digest}:"
    zf = zipfile.ZipFile(io.BytesIO(resp.data))
    names = zf.namelist()
    assert names == ["valley-fold-default.fold", "valley-fold-default.svg",
                     "valley-fold-default.dxf", "valley-fold-default.pdf",
                     "valley-fold-default.plt", "variables.json"]
    doc = json.loads(zf.read("variables.json"))
    assert doc["format"] == "hyperobjects.generator-output" and doc["instance_id"] == instance
    assert doc["generator"]["source"]["entry"] == "main.py"
    assert doc["generator"]["kernel"].startswith("pliego-kernel ")
    assert [g["path"] for g in doc["geometry"]] == names[:-1]
    for entry in doc["geometry"]:
        data = zf.read(entry["path"])
        assert entry["sha256"] == hashlib.sha256(data).hexdigest() and entry["bytes"] == len(data)
        assert entry["units"] == "mm"
    assert [g["role"] for g in doc["geometry"]] == ["primary"] + ["auxiliary"] * 4
    plain = _post(client, DOC, {"slug": "valley-fold", "params": {"size": 120}})
    assert zf.read("valley-fold-default.fold") == plain.data


def test_bundle_is_deterministic_with_or_without_the_cache(make_app):
    needs_kernel()
    cached = make_app().test_client()
    uncached = make_app(render_cache_mb=0, render_cache_disk_mb=0).test_client()
    a, b, c = _bundle(cached), _bundle(cached), _bundle(uncached)
    assert b.headers["X-Pliego-Cache"] == "hit-memory" and c.headers["X-Pliego-Cache"] == "off"
    assert a.data == b.data == c.data


def test_bundle_formats(client):
    needs_kernel()
    resp = _bundle(client, bundle_formats=["glb", "svg", "svg", "fold"])
    assert resp.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(resp.data))
    assert zf.namelist() == ["valley-fold-default.fold", "valley-fold-default.glb",
                             "valley-fold-default.svg", "variables.json"]
    roles = [g["role"] for g in json.loads(zf.read("variables.json"))["geometry"]]
    assert roles == ["primary", "viewer", "auxiliary"]


def test_bundle_rejections(client):
    for extra, needle in (({"bundle_formats": ["stl"]}, "cannot bundle"),
                          ({"bundle_formats": []}, "non-empty"),
                          ({"bundle_formats": "svg"}, "non-empty"),
                          ({"bundle_formats": ["fold"]}, "no file besides")):
        resp = _bundle(client, **extra)
        assert resp.status_code == 400 and needle in resp.get_json()["error"], extra
    resp = _post(client, EXP, {"slug": "valley-fold", "params": {}, "format": "svg",
                               "bundle_formats": ["svg"]})
    assert resp.status_code == 400 and "only to format 'bundle'" in resp.get_json()["error"]
    resp = _post(client, EXP, {"slug": "nope", "params": {}, "format": "bundle"})
    assert resp.status_code == 404
    resp = _post(client, EXP, {"slug": "valley-fold", "params": {}, "format": "zip"})
    assert resp.status_code == 400 and "'bundle'" in resp.get_json()["error"]
