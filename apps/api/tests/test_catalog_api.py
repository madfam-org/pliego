"""Catalog (stat-signature memo, facets, fail-closed manifests), objects, stocks, health/ready and
the metrics listener."""

from __future__ import annotations

import json
import shutil

import pytest
from conftest import API, HAS_KERNEL, LANDING

from apps.api.manifest import ManifestError, parse_cartridge


def _add_cartridge(tree, slug, *, cls="base", tags=("base",), difficulty="intermediate",
                   manifest=None):
    src = tree / "projects" / "valley-fold"
    dest = tree / "projects" / slug
    shutil.copytree(src, dest)
    doc = json.loads((dest / "project.json").read_text())
    doc["project"]["slug"] = slug
    doc["project"]["name"]["en"] = slug.replace("-", " ").title()
    doc["project"]["tags"] = list(tags)
    doc["project"]["description"] = {"en": f"{slug} (fixture copy)"}
    doc["project"]["difficulty"] = difficulty
    doc["hyperobject"]["class"] = cls
    if manifest is not None:
        doc = manifest(doc)
    (dest / "project.json").write_text(json.dumps(doc))
    return dest


def test_catalog_lists_fixture(client):
    body = client.get("/api/v1/catalog", base_url=API).get_json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["slug"] == "valley-fold"
    assert item["class"] == "technique" and item["domain"] == "sheet"
    assert item["modes"] == ["default"] and item["parameters"] == 2
    assert body["facets"]["class"] == {"technique": 1}
    assert body["facets"]["tag"]["valley"] == 1


def test_catalog_empty_and_missing_projects(make_app, tree):
    shutil.rmtree(tree / "projects")
    c = make_app().test_client()
    assert c.get("/api/v1/catalog").get_json()["total"] == 0
    assert c.get("/health").get_json()["commons"] == 0
    ready = c.get("/ready")
    assert ready.status_code == 503
    assert any("commons is empty" in r for r in ready.get_json()["reasons"])
    (tree / "projects").mkdir()
    (tree / "projects" / "not-a-cartridge").mkdir()  # no project.json: ignored, not counted
    assert c.get("/health").get_json()["commons"] == 0
    assert c.get("/health").get_json()["commons_invalid"] == 0


def test_require_commons_off_allows_empty_ready(make_app, tree):
    shutil.rmtree(tree / "projects")
    resp = make_app(require_commons=False).test_client().get("/ready")
    if HAS_KERNEL:
        assert resp.status_code == 200 and resp.get_json()["commons"] == 0
    else:
        assert resp.status_code == 503


def test_memo_picks_up_changes(client, tree):
    assert client.get("/api/v1/catalog").get_json()["total"] == 1
    _add_cartridge(tree, "preliminary-base")
    body = client.get("/api/v1/catalog").get_json()
    assert body["total"] == 2
    assert body["facets"]["class"] == {"base": 1, "technique": 1}


@pytest.mark.parametrize("breakage", [
    lambda d: "{not json",
    lambda d: json.dumps({**d, "project": {**d["project"], "slug": "other-slug"}}),
    lambda d: json.dumps({**d, "parameters": [{"id": "size", "type": "slider", "default": 999,
                                               "min": 1, "max": 10}]}),
    lambda d: json.dumps({**d, "modes": [{"id": "default", "script_file": "../escape.py"}]}),
    lambda d: json.dumps({**d, "modes": [{"id": "default", "script_file": "missing.py"}]}),
    lambda d: json.dumps({**d, "parameters": [{"id": "pliego", "type": "checkbox",
                                               "default": True}]}),
    lambda d: '{"project": {"slug": "broken", "name": {"en": "x"}}, "a": 1, "a": 2}',
    lambda d: json.dumps({**d, "parameters": [{"id": "size", "type": "slider",
                                               "default": float("nan")}]}),
])
def test_invalid_manifest_fails_closed(make_app, tree, breakage):
    dest = _add_cartridge(tree, "broken")
    doc = json.loads((dest / "project.json").read_text())
    (dest / "project.json").write_text(breakage(doc))
    c = make_app().test_client()
    health = c.get("/health").get_json()
    assert health["commons"] == 1 and health["commons_invalid"] == 1
    assert [i["slug"] for i in c.get("/api/v1/catalog").get_json()["items"]] == ["valley-fold"]
    assert c.get("/api/v1/objects/broken").status_code == 404


def test_parse_cartridge_rejects_non_kebab_directory(tree):
    bad = tree / "projects" / "Bad_Slug"
    bad.mkdir()
    with pytest.raises(ManifestError):
        parse_cartridge(bad, {"project": {"slug": "Bad_Slug", "name": {"en": "x"}}})


def test_catalog_filters_and_search(client, tree):
    _add_cartridge(tree, "preliminary-base", cls="base", tags=("base", "collapse"))
    _add_cartridge(tree, "paper-crane", cls="traditional", tags=("bird",), difficulty="advanced")

    def slugs(query: str) -> list[str]:
        resp = client.get(f"/api/v1/catalog?{query}", base_url=API)
        assert resp.status_code == 200, resp.get_json()
        return [i["slug"] for i in resp.get_json()["items"]]

    assert slugs("class=base") == ["preliminary-base"]
    assert slugs("tag=bird") == ["paper-crane"]
    assert slugs("difficulty=advanced") == ["paper-crane"]
    assert slugs("domain=sheet") == ["paper-crane", "preliminary-base", "valley-fold"]
    assert slugs("q=crane") == ["paper-crane"]
    assert slugs("q=diagonal") == ["valley-fold"]  # description text
    assert slugs("q=nothing-matches") == []
    facets = client.get("/api/v1/catalog?class=base").get_json()["facets"]
    assert facets["class"] == {"base": 1}


@pytest.mark.parametrize("query", ["", "q=crane", "class=base", "tag=bird&q=paper"])
def test_catalog_walks_the_files_once_per_request(client, tree, monkeypatch, query):
    """One state snapshot per request: before, matches() re-ran the stat walk for every record
    (139 cartridges → 140 walks and 4.6 s per live request)."""
    for slug in ("preliminary-base", "paper-crane", "water-bomb", "square-base"):
        _add_cartridge(tree, slug, tags=("bird",) if slug == "paper-crane" else ("base",))
    client.get("/api/v1/catalog", base_url=API)  # first parse
    memo = client.application.extensions["pliego"]["catalog"]._memo
    walks = []
    original = memo._files
    monkeypatch.setattr(memo, "_files", lambda: walks.append(1) or original())
    resp = client.get(f"/api/v1/catalog?{query}", base_url=API)
    assert resp.status_code == 200, resp.get_json()
    assert len(walks) <= 1, f"{len(walks)} file walks for one catalog request"


@pytest.mark.parametrize("query", ["limit=5", "sort=name", "q=a&evil=1"])
def test_catalog_unknown_query_is_400(client, query):
    resp = client.get(f"/api/v1/catalog?{query}", base_url=API)
    assert resp.status_code == 400
    assert "unknown query parameter" in resp.get_json()["error"]


def test_object_detail(client):
    resp = client.get("/api/v1/objects/valley-fold", base_url=API)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["manifest"]["project"]["slug"] == "valley-fold"
    assert body["modes"] == ["default"]
    if HAS_KERNEL:
        assert body["export_formats"] == ["fold", "svg", "dxf", "pdf", "hpgl", "glb"]
    for bad in ("nope", "Valley-Fold", "..", "valley_fold"):
        assert client.get(f"/api/v1/objects/{bad}").status_code == 404


def test_stocks(client):
    body = client.get("/api/v1/stocks", base_url=API).get_json()
    slugs = [c["stock"]["slug"] for c in body["items"]]
    assert body["total"] == len(slugs)
    if slugs:
        card = client.get(f"/api/v1/stocks/{slugs[0]}").get_json()
        assert "derived" in card and "derived_basis" in card
    assert client.get("/api/v1/stocks/nope").status_code == 404
    assert client.get("/api/v1/stocks?x=1").status_code == 400


def test_invalid_stock_card_excluded(make_app, tree):
    bad = tree / "materials" / "bad-card"
    bad.mkdir(parents=True)
    (bad / "stock.json").write_text('{"stock": {"slug": "other"}, "derived": {}}')
    c = make_app().test_client()
    health = c.get("/health").get_json()
    assert health["stocks_invalid"] == 1
    assert c.get("/api/v1/stocks/bad-card").status_code == 404


def test_health_contract(client):
    resp = client.get("/health", base_url=LANDING)
    assert resp.status_code == 200
    text = resp.get_data(as_text=True)
    assert '"status": "ok"' in text  # the Enclii status probes assert this literal
    assert "localhost:" not in text
    body = resp.get_json()
    for key in ("version", "commons", "kernel", "stocks", "commons_invalid", "stocks_invalid",
                "thumbnails", "prerendered", "revision"):
        assert key in body
    assert body["commons"] == 1
    assert body["revision"] is None  # no PLIEGO_REVISION: a source checkout or a local build


def test_health_reports_the_build_revision(make_app):
    sha = "43e1c757857171099a75acdbace5ec0f1694adef"
    body = make_app(revision=sha).test_client().get("/health").get_json()
    assert body["revision"] == sha


@pytest.mark.parametrize("raw,expected", [
    (None, None), ("", None), ("  ", None),
    ("43e1c75", "43e1c75"),
    ("43e1c757857171099a75acdbace5ec0f1694adef", "43e1c757857171099a75acdbace5ec0f1694adef"),
])
def test_revision_from_env(raw, expected):
    from apps.api.config import Settings

    env = {} if raw is None else {"PLIEGO_REVISION": raw}
    assert Settings.from_env(env).revision == expected


@pytest.mark.parametrize("raw", ["main", "43E1C75", "abc", "43e1c75 ; rm", "g" * 40, "a" * 41])
def test_revision_that_is_not_a_commit_fails_the_boot(raw):
    from apps.api.config import Settings

    with pytest.raises(RuntimeError, match="PLIEGO_REVISION"):
        Settings.from_env({"PLIEGO_REVISION": raw})


def test_ready_contract(client):
    resp = client.get("/ready", base_url=API)
    if HAS_KERNEL:
        assert resp.status_code == 200
        assert '"status": "ok"' in resp.get_data(as_text=True)
        assert resp.get_json()["kernel"]
    else:
        assert resp.status_code == 503


def test_ready_reports_kernel_failure(make_app, monkeypatch):
    import apps.api.api_v1 as api_v1

    monkeypatch.setattr(api_v1, "kernel_status", lambda: (False, None, "kernel import failed"))
    resp = make_app().test_client().get("/ready")
    assert resp.status_code == 503
    assert "kernel import failed" in resp.get_json()["reasons"]


# ── metrics listener ─────────────────────────────────────────────────────────
def test_metrics_only_on_metrics_port(client):
    client.get("/health", base_url=API)
    assert client.get("/metrics", base_url="http://pliego-api.madfam.io:8000").status_code == 404
    # the Host header cannot pick the listener: SERVER_PORT comes from the bound socket
    spoof = client.get("/metrics", base_url="http://localhost:8000",
                       headers={"Host": "localhost:9090"})
    assert spoof.status_code == 404
    resp = client.get("/metrics", environ_overrides={"SERVER_PORT": "9090"})
    assert resp.status_code == 200
    assert resp.headers["Content-Type"].startswith("text/plain; version=0.0.4")
    text = resp.get_data(as_text=True)
    assert "# TYPE pliego_http_requests_total counter" in text
    assert 'route="/health"' in text and 'worker="' in text
    assert "per worker process" in text


def test_metrics_listener_serves_nothing_else(client):
    for path in ("/health", "/", "/api/v1/catalog", "/llms.txt"):
        resp = client.get(path, environ_overrides={"SERVER_PORT": "9090"})
        assert resp.status_code == 404, path
