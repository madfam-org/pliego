"""The prerendered tier: the image-build render of every mode and preset, served first under the exact
runtime key; corrupt or foreign entries fall through; a kernel or commons change misses."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from conftest import API, FIXTURES, needs_kernel

from apps.api import prerender, render_cache
from apps.api.config import Settings
from apps.api.render import Renderer

DOC = "/api/v1/documents"
EXP = "/api/v1/exports"
LABEL = {"en": "x", "es": "x", "fr": "x", "pt": "x"}


def _presets(tree: Path) -> None:
    path = tree / "projects" / "valley-fold" / "project.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["presets"] = [
        {"id": "big", "label": LABEL, "values": {"size": 200}},
        {"id": "same", "label": LABEL, "values": {"size": 150}},       # = the defaults
        {"id": "alien", "label": LABEL, "values": {"flaps": 3}},       # not a parameter here
    ]
    path.write_text(json.dumps(manifest), encoding="utf-8")


def _build(tree: Path):
    settings = Settings(root=tree, cors_origins_raw="https://pliego-app.madfam.io")
    return prerender.build(settings, tree / "build" / "prerender", tree / "build" / "thumbnails",
                           jobs=2)


@pytest.fixture
def built(tree):
    needs_kernel()
    _presets(tree)
    report, thumbs = _build(tree)
    print(report.line(2))
    return tree, report, thumbs


def _post(client, path, body):
    return client.post(path, json=body, base_url=API)


def _spy(monkeypatch) -> list:
    calls: list = []
    real = Renderer.run

    def counting(self, *args, **kwargs):
        calls.append(args[2])
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Renderer, "run", counting)
    return calls


def test_build_renders_every_mode_and_applicable_preset(built):
    tree, report, thumbs = built
    assert (report.defaults, report.presets, report.inapplicable, report.duplicates) == (1, 1, 1, 1)
    assert sorted(report.rendered) == ["valley-fold/default", "valley-fold/default@big"]
    assert not report.failed
    assert report.entries == 2 * (1 + len(prerender.PRERENDER_FORMATS))   # document + svg/dxf/hpgl
    assert thumbs.produced == ["valley-fold"]                            # drawn from the same pass
    assert (tree / "build" / "thumbnails" / "valley-fold.svg").read_text().startswith("<?xml")
    index = json.loads((tree / "build" / "prerender" / "index.json").read_text())
    assert index["format"] == "pliego.prerender" and index["kernel"]


def test_identical_requests_hit_the_prerendered_tier(built, make_app, monkeypatch):
    tree, _report, _thumbs = built
    calls = _spy(monkeypatch)
    client = make_app().test_client()
    for body, path in (({"slug": "valley-fold", "params": {}}, DOC),
                       ({"slug": "valley-fold", "mode": "default", "params": {"size": 150}}, DOC),
                       ({"slug": "valley-fold", "params": {"size": 200}}, DOC),
                       ({"slug": "valley-fold", "params": {}, "format": "svg"}, EXP),
                       ({"slug": "valley-fold", "params": {"size": 200}, "format": "dxf"}, EXP)):
        resp = _post(client, path, body)
        assert resp.status_code == 200, resp.get_json()
        assert resp.headers["X-Pliego-Cache"] == "hit-prerendered", body
        assert resp.headers["X-Pliego-Verify"].startswith("verify: sheets=1 ")
        assert resp.headers["X-Generator-Instance-Id"]
    assert calls == []                                            # not one sandbox render
    cold = make_app(prerender_dir=tree / "nowhere", render_cache_mb=0,
                    render_cache_disk_mb=0).test_client()
    for body, path in (({"slug": "valley-fold", "params": {}}, DOC),
                       ({"slug": "valley-fold", "params": {}, "format": "svg"}, EXP)):
        warm, fresh = _post(client, path, body), _post(cold, path, body)
        assert fresh.headers["X-Pliego-Cache"] == "off"
        assert warm.data == fresh.data                            # the exact bytes of a render
    # not prerendered: other parameters, PDF, GLB, the bundle
    for body, path in (({"slug": "valley-fold", "params": {"size": 120}}, DOC),
                       ({"slug": "valley-fold", "params": {}, "format": "pdf"}, EXP),
                       ({"slug": "valley-fold", "params": {}, "format": "bundle"}, EXP)):
        assert _post(client, path, body).headers["X-Pliego-Cache"] == "miss", body


def test_a_hit_skips_the_render_slot(built, make_app):
    app = make_app()
    with app.extensions["pliego"]["slot"].acquire():
        resp = _post(app.test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 200 and resp.headers["X-Pliego-Cache"] == "hit-prerendered"


def _entry(tree: Path, app, params=None, formats=()):
    cache = app.extensions["pliego"]["render_cache"]
    cart = app.extensions["pliego"]["catalog"].get("valley-fold")
    from apps.api.manifest import resolve_request

    mode, effective = resolve_request(cart, None, params or {})
    key = cache.key(cart, mode, effective, formats)
    return tree / "build" / "prerender" / "keys" / f"{key}.json"


@pytest.mark.parametrize("damage", ["blob", "truncated-blob", "missing-blob", "entry", "foreign"])
def test_a_corrupt_entry_falls_through(built, make_app, damage):
    tree, _report, _thumbs = built
    app = make_app()
    entry = _entry(tree, app)
    head = json.loads(entry.read_text())
    blob = tree / "build" / "prerender" / "blobs" / head["parts"][0][1]
    if damage == "blob":
        data = bytearray(blob.read_bytes())
        data[10] ^= 0xFF
        blob.write_bytes(bytes(data))
    elif damage == "truncated-blob":
        blob.write_bytes(blob.read_bytes()[:-5])
    elif damage == "missing-blob":
        blob.unlink()
    elif damage == "entry":
        entry.write_text("{not json")
    else:
        entry.write_text(json.dumps(dict(head, key="0" * 64)))
    client = app.test_client()
    resp = _post(client, DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 200 and resp.headers["X-Pliego-Cache"] == "miss"
    again = _post(client, DOC, {"slug": "valley-fold", "params": {}})
    assert again.headers["X-Pliego-Cache"] == "hit-memory"        # the normal path took over
    metrics = app.extensions["pliego"]["metrics"]
    assert metrics._counters[("pliego_render_cache_prerendered_invalid_total", ())] == 1


def test_a_kernel_bump_or_another_commons_misses(built, make_app, monkeypatch):
    monkeypatch.setattr(render_cache, "kernel_identity", lambda _s: "9.9.9+0000000000000000")
    resp = _post(make_app().test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.headers["X-Pliego-Cache"] == "miss"
    monkeypatch.undo()
    monkeypatch.setenv("PLIEGO_COMMONS_SHA", "c" * 40)            # built without a known pin
    resp = _post(make_app().test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.headers["X-Pliego-Cache"] == "miss"


def test_an_edited_cartridge_misses(built, make_app):
    tree, _report, _thumbs = built
    script = tree / "projects" / "valley-fold" / "main.py"
    script.write_text(script.read_text() + "\n# edited\n")
    resp = _post(make_app().test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.headers["X-Pliego-Cache"] == "miss"


def test_cli_strict_reports_what_cannot_prerender(tree, monkeypatch, capsys):
    needs_kernel()
    broken = tree / "projects" / "broken-fold"
    shutil.copytree(FIXTURES / "projects" / "valley-fold", broken)
    manifest = json.loads((broken / "project.json").read_text())
    manifest["project"]["slug"] = "broken-fold"
    (broken / "project.json").write_text(json.dumps(manifest))
    (broken / "main.py").write_text("raise ValueError('no paper today')\n")
    monkeypatch.setenv("PLIEGO_ROOT", str(tree))
    args = ["build", "--out", str(tree / "p"), "--thumbnails", str(tree / "t"), "--jobs", "2"]
    assert prerender.main(args) == 0                                     # the image: report-only
    out = capsys.readouterr().out
    assert "prerender: cartridges=2 variants=2" in out and "failed=1" in out
    assert "  FAIL broken-fold/default:" in out
    assert "thumbnails: cartridges=2 produced=1 failed=1" in out
    assert prerender.main([*args, "--strict"]) == 1                      # CI
    assert prerender.main([*args, "--strict", "--only", "valley-fold"]) == 0
