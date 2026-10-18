"""POST /api/v1/documents and /api/v1/exports: the request guard, strict payloads, and end-to-end
renders through the sandbox runner with the real kernel."""

from __future__ import annotations

import json
import re
import struct

import pytest
from conftest import API, HAS_KERNEL, needs_kernel

DOC = "/api/v1/documents"
EXP = "/api/v1/exports"


def post(client, path, body, **kw):
    return client.post(path, json=body, base_url=API, **kw)


# ── the request guard (every POST) ───────────────────────────────────────────
def test_post_requires_json_content_type(client):
    resp = client.post(DOC, data="slug=valley-fold", base_url=API,
                       content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 415


@pytest.mark.parametrize("raw,needle", [
    ("{not json", "not valid JSON"),
    ("[1, 2]", "JSON object"),
    ('"valley-fold"', "JSON object"),
    ('{"slug": "valley-fold", "params": {"size": NaN}}', "non-finite"),
    ('{"slug": "valley-fold", "slug": "x", "params": {}}', "duplicate key"),
    ("", "not valid JSON"),
])
def test_post_body_must_be_a_strict_json_object(client, raw, needle):
    resp = client.post(DOC, data=raw, base_url=API, content_type="application/json")
    assert resp.status_code == 400
    assert needle in resp.get_json()["error"]


def test_post_body_size_limit(client):
    big = json.dumps({"slug": "valley-fold", "params": {}, "pad": "x" * (300 * 1024)})
    resp = client.post(DOC, data=big, base_url=API, content_type="application/json")
    assert resp.status_code == 413
    assert resp.get_json()["status"] == 413


def test_authorization_is_refused_until_janua_lands(client):
    resp = post(client, DOC, {"slug": "valley-fold", "params": {}},
                headers={"Authorization": "Bearer abc"})
    assert resp.status_code == 401


# ── strict payloads ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("body,status,needle", [
    ({"params": {}}, 400, "'slug'"),
    ({"slug": 5, "params": {}}, 400, "'slug'"),
    ({"slug": "valley-fold"}, 400, "'params'"),
    ({"slug": "valley-fold", "params": {}, "extra": 1}, 400, "unknown key"),
    ({"slug": "valley-fold", "params": {}, "format": "svg"}, 400, "unknown key"),
    ({"slug": "valley-fold", "params": [], "mode": "default"}, 400, "'params' must be an object"),
    ({"slug": "valley-fold", "params": {}, "mode": "fancy"}, 400, "unknown mode"),
    ({"slug": "valley-fold", "params": {}, "mode": 1}, 400, "'mode' must be a string"),
    ({"slug": "valley-fold", "params": {"sise": 100}}, 400, "unknown parameter"),
    ({"slug": "valley-fold", "params": {"size": 10}}, 400, "outside"),
    ({"slug": "valley-fold", "params": {"size": 9999}}, 400, "outside"),
    ({"slug": "valley-fold", "params": {"size": 100.5}}, 400, "not on step"),
    ({"slug": "valley-fold", "params": {"size": "100"}}, 400, "finite number"),
    ({"slug": "valley-fold", "params": {"size": True}}, 400, "finite number"),
    ({"slug": "valley-fold", "params": {"stock": "cardboard"}}, 400, "must be one of"),
    ({"slug": "valley-fold", "params": {"stock": 1}}, 400, "must be one of"),
    ({"slug": "no-such-object", "params": {}}, 404, "unknown object"),
    ({"slug": "../etc", "params": {}}, 404, "unknown object"),
])
def test_document_payload_rejections(client, body, status, needle):
    resp = post(client, DOC, body)
    assert resp.status_code == status, resp.get_json()
    assert needle in resp.get_json()["error"]


@pytest.mark.parametrize("body,needle", [
    ({"slug": "valley-fold", "params": {}}, "'format'"),
    ({"slug": "valley-fold", "params": {}, "format": "stl"}, "'format'"),
    ({"slug": "valley-fold", "params": {}, "format": 3}, "'format'"),
    ({"slug": "valley-fold", "params": {}, "format": "svg", "bundle": True}, "unknown key"),
])
def test_export_payload_rejections(client, body, needle):
    resp = post(client, EXP, body)
    assert resp.status_code == 400
    assert needle in resp.get_json()["error"]


def test_mode_is_required_when_ambiguous(make_app, tree):
    manifest = tree / "projects" / "valley-fold" / "project.json"
    doc = json.loads(manifest.read_text())
    doc["modes"].append({"id": "half", "script_file": "main.py"})
    doc["parameters"][1]["modes"] = ["default"]
    manifest.write_text(json.dumps(doc))
    c = make_app().test_client()
    resp = post(c, DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 400 and "'mode' is required" in resp.get_json()["error"]
    resp = post(c, DOC, {"slug": "valley-fold", "mode": "half", "params": {"stock": "kami"}})
    assert resp.status_code == 400 and "does not apply" in resp.get_json()["error"]


def test_unclaimed_format_is_refused(make_app, tree):
    manifest = tree / "projects" / "valley-fold" / "project.json"
    doc = json.loads(manifest.read_text())
    doc["export_formats"] = ["svg"]
    manifest.write_text(json.dumps(doc))
    resp = post(make_app().test_client(), EXP,
                {"slug": "valley-fold", "params": {}, "format": "dxf"})
    assert resp.status_code == 400
    assert "does not publish format 'dxf'" in resp.get_json()["error"]


def test_manifest_without_export_formats_publishes_none(make_app, tree):
    manifest = tree / "projects" / "valley-fold" / "project.json"
    doc = json.loads(manifest.read_text())
    del doc["export_formats"]
    manifest.write_text(json.dumps(doc))
    c = make_app().test_client()
    assert c.get("/api/v1/objects/valley-fold").get_json()["export_formats"] == []
    resp = post(c, EXP, {"slug": "valley-fold", "params": {}, "format": "svg"})
    assert resp.status_code == 400


def test_transport_table_matches_kernel_exporters():
    needs_kernel()
    from apps.api.render import TRANSPORT
    from pliego.export import EXPORTERS

    for fmt, (_func, ext, media) in EXPORTERS.items():
        assert TRANSPORT[fmt] == (media, ext.lstrip(".")), fmt


# ── end to end with the real kernel ──────────────────────────────────────────
def test_document_end_to_end(client):
    needs_kernel()
    resp = post(client, DOC, {"slug": "valley-fold", "params": {"size": 120}})
    assert resp.status_code == 200, resp.get_json()
    assert resp.headers["Content-Type"] == "application/json"
    verify = resp.headers["X-Pliego-Verify"]
    assert verify.startswith("verify: sheets=1 ") and "errors=0" in verify
    doc = json.loads(resp.data)
    assert doc["file_spec"] == 1.2
    assert doc["pliego:meta"]["cartridge"] == "valley-fold"
    assert doc["pliego:meta"]["mode"] == "default"
    assert doc["pliego:meta"]["params"] == {"size": 120, "stock": "kami"}  # defaults explicit
    assert doc["pliego:meta"]["digest"].startswith("sha256:")
    assert "kami" in doc["pliego:stocks"]
    # byte-determinism through the whole stack
    again = post(client, DOC, {"slug": "valley-fold", "params": {"size": 120}})
    assert again.data == resp.data
    # the kernel agrees the document is valid
    import pliego

    assert [i for i in pliego.Document.from_json(resp.data).verify()
            if i["level"] == "error"] == []


def test_document_uses_requested_stock(client):
    needs_kernel()
    resp = post(client, DOC, {"slug": "valley-fold", "params": {"stock": "copy-80"}})
    assert resp.status_code == 200, resp.get_json()
    doc = json.loads(resp.data)
    assert set(doc["pliego:stocks"]) == {"copy-80"}


@pytest.mark.parametrize("fmt,ctype,ext,magic", [
    ("svg", "image/svg+xml", "svg", b"<?xml"),
    ("dxf", "image/vnd.dxf", "dxf", b"0\n"),
    ("pdf", "application/pdf", "pdf", b"%PDF-"),
    ("hpgl", "application/vnd.hp-hpgl", "plt", b"IN;"),
    ("glb", "model/gltf-binary", "glb", b"glTF"),
    ("fold", "application/json", "fold", b"{"),
])
def test_export_end_to_end(client, fmt, ctype, ext, magic):
    needs_kernel()
    resp = post(client, EXP, {"slug": "valley-fold", "params": {}, "format": fmt})
    assert resp.status_code == 200, resp.get_json()
    assert resp.headers["Content-Type"].split(";")[0] == ctype
    assert resp.headers["Content-Disposition"] == \
        f'attachment; filename="valley-fold-default.{ext}"'
    assert resp.headers["X-Pliego-Verify"].startswith("verify: sheets=1 ")
    assert resp.data.lstrip().startswith(magic), resp.data[:20]
    if fmt == "glb":
        assert struct.unpack("<I", resp.data[8:12])[0] == len(resp.data)
        jlen = struct.unpack("<I", resp.data[12:16])[0]
        gltf = json.loads(resp.data[20:20 + jlen])
        # the runner exports the fold program as a morph-target animation, not a static frame
        assert [a["name"] for a in gltf["animations"]] == ["fold-program"]
        assert gltf["asset"]["extras"]["pliego:animation"]["targets"] >= 2


def test_failing_cartridge_is_422_with_verify_line(make_app, tree):
    needs_kernel()
    (tree / "projects" / "valley-fold" / "main.py").write_text(
        "result = pliego.Sheet('s', pliego.square(size), stock='no-such-stock')\n")
    resp = post(make_app().test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 422
    body = resp.get_json()
    assert body["verify"].startswith("verify: sheets=0 ") and "errors=1" in body["verify"]
    assert any(i["kind"] == "stock" for i in body["issues"])
    assert body["code"] == "render_invalid"
    assert re.fullmatch(r"[0-9a-f]{32}", body["request_id"])


CRASHING_RUNNER = """import sys
sys.stderr.write(
    "Traceback (most recent call last):\\n"
    '  File "/app/apps/api/services/engine/pliego_runner.py", line 1, in <module>\\n'
    "RuntimeError: STDERR-MARKER-7f3a at /srv/private/path\\n")
sys.exit(3)
"""


@pytest.mark.parametrize("path,extra", [(DOC, {}), (EXP, {"format": "fold"})])
def test_runner_crash_never_sends_stderr_to_the_client(make_app, tree, monkeypatch, caplog,
                                                       path, extra):
    """A runner that fails without issues (crash, limits, policy) answers a stable code and a
    request id; its stderr (paths, tracebacks) is logged server-side under that id only."""
    import apps.api.render as render

    crash = tree / "crashing_runner.py"
    crash.write_text(CRASHING_RUNNER, encoding="utf-8")
    monkeypatch.setattr(render, "RUNNER", crash)
    app = make_app(render_cache_mb=0.0, render_cache_disk_mb=0.0)
    monkeypatch.setattr(app.extensions["pliego"]["renderer"], "published_formats",
                        lambda _cart: ["fold"])
    with caplog.at_level("ERROR", logger="pliego.api.v1"):
        resp = post(app.test_client(), path, {"slug": "valley-fold", "params": {}, **extra})
    assert 400 <= resp.status_code < 600
    text = resp.get_data(as_text=True)
    for leaked in ("STDERR-MARKER", "Traceback", "/srv/private", "pliego_runner.py", "/app/"):
        assert leaked not in text, f"{leaked!r} reached the client: {text}"
    body = resp.get_json()
    assert body["error"] == "render failed"
    assert body["code"] == "render_failed"
    assert re.fullmatch(r"[0-9a-f]{32}", body["request_id"])
    logged = [r.getMessage() for r in caplog.records if body["request_id"] in r.getMessage()]
    assert logged and "STDERR-MARKER-7f3a" in logged[0]


def test_render_timeout_is_504(make_app, tree):
    needs_kernel()
    (tree / "projects" / "valley-fold" / "main.py").write_text(
        "x = 0\nwhile True:\n    x += 1\n")
    resp = post(make_app(render_timeout_s=1.0).test_client(), DOC,
                {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 504
    assert "timed out" in resp.get_json()["error"]
    assert resp.get_json()["code"] == "render_timeout"


@pytest.mark.skipif(HAS_KERNEL, reason="only meaningful without the kernel")
def test_without_kernel_render_fails_visibly(client):
    resp = post(client, DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 422
