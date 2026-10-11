"""Catalog thumbnails: the build (kernel SVG exporter, diagram palette), the coverage check, the
same-origin route and the catalog record."""

from __future__ import annotations

import json
import shutil

from conftest import APP, FIXTURES, needs_kernel

from apps.api import thumbnails
from apps.api.config import Settings


def _settings(tree) -> Settings:
    return Settings(root=tree, cors_origins_raw="https://pliego-app.madfam.io")


def _add_broken(tree, slug="broken-fold"):
    dest = tree / "projects" / slug
    shutil.copytree(FIXTURES / "projects" / "valley-fold", dest)
    manifest = json.loads((dest / "project.json").read_text(encoding="utf-8"))
    manifest["project"]["slug"] = slug
    (dest / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
    (dest / "main.py").write_text("raise ValueError('no paper today')\n", encoding="utf-8")


def test_build_draws_the_default_crease_pattern_in_the_diagram_palette(tree):
    needs_kernel()
    out = tree / "build" / "thumbnails"
    (out).mkdir(parents=True)
    (out / "gone.svg").write_text("<svg/>", encoding="utf-8")  # a cartridge that left the commons
    report = thumbnails.build(_settings(tree), out, jobs=1)
    print(report.line(1))
    assert report.cartridges == 1 and report.produced == ["valley-fold"] and not report.failed
    svg = (out / "valley-fold.svg").read_text(encoding="utf-8")
    assert svg.startswith("<?xml") and 'data-palette="diagram"' in svg
    assert 'id="valley"' in svg and 'stroke-dasharray="3 1.5"' in svg  # the diagonal, dashed
    assert 'id="registration"' not in svg and 'id="label"' not in svg
    assert not (out / "gone.svg").exists()
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert index["format"] == "pliego.thumbnails" and index["produced"] == ["valley-fold"]
    assert index["failed"] == {} and index["svg"]["palette"] == "diagram"


def test_build_reports_a_cartridge_whose_thumbnail_cannot_be_produced(tree):
    needs_kernel()
    _add_broken(tree)
    report = thumbnails.build(_settings(tree), tree / "out", jobs=2)
    assert report.cartridges == 2 and report.produced == ["valley-fold"]
    assert "no paper today" in report.failed["broken-fold"]
    index = json.loads((tree / "out" / "index.json").read_text(encoding="utf-8"))
    assert "broken-fold" in index["failed"]


def test_cli_exit_codes(tree, monkeypatch, capsys):
    needs_kernel()
    _add_broken(tree)
    monkeypatch.setenv("PLIEGO_ROOT", str(tree))
    assert thumbnails.main(["build", str(tree / "a"), "--jobs", "1"]) == 0   # report-only
    out = capsys.readouterr().out
    assert "thumbnails: cartridges=2 produced=1 failed=1" in out
    assert "  FAIL broken-fold:" in out
    assert thumbnails.main(["build", str(tree / "b"), "--strict"]) == 1     # CI
    assert thumbnails.main(["build", str(tree / "c"), "--only", "valley-fold", "--strict"]) == 0
    shutil.rmtree(tree / "projects")
    (tree / "projects").mkdir()
    assert thumbnails.main(["build", str(tree / "d")]) == 1                   # empty read
    assert "FAIL 0 cartridges" in capsys.readouterr().out


def _built(tree):
    out = tree / "build" / "thumbnails"
    out.mkdir(parents=True)
    (out / "valley-fold.svg").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>\n',
        encoding="utf-8")
    return out


def test_route_serves_the_built_file_same_origin(make_app, tree):
    _built(tree)
    client = make_app().test_client()
    resp = client.get("/projects/valley-fold.svg", base_url=APP)
    assert resp.status_code == 200
    assert resp.mimetype == "image/svg+xml"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "img-src 'self'" in resp.headers["Content-Security-Policy"]
    assert resp.headers.get("ETag")
    again = client.get("/projects/valley-fold.svg", base_url=APP,
                       headers={"If-None-Match": resp.headers["ETag"]})
    assert again.status_code == 304


def test_route_refuses_anything_else(make_app, tree):
    out = _built(tree)
    (out / "linked.svg").symlink_to(out / "valley-fold.svg")
    client = make_app().test_client()
    for path in ("/projects/unknown.svg", "/projects/Valley-Fold.svg", "/projects/linked.svg",
                 "/projects/valley-fold.png", "/projects/index.json", "/projects/..%2Fx.svg",
                 "/projects/valley-fold/main.py", "/projects/valley-fold/project.json"):
        assert client.get(path, base_url=APP).status_code == 404, path


def test_catalog_record_and_health_carry_the_thumbnail(make_app, tree):
    client = make_app().test_client()
    item = client.get("/api/v1/catalog", base_url=APP).get_json()["items"][0]
    assert item["thumbnail"] is None                    # not built: no URL that would 404
    assert client.get("/health").get_json()["thumbnails"] == 0
    _built(tree)
    item = client.get("/api/v1/catalog", base_url=APP).get_json()["items"][0]
    assert item["thumbnail"] == "/projects/valley-fold.svg"
    assert client.get("/health").get_json()["thumbnails"] == 1
