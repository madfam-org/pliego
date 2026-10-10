"""Static surfaces: host-aware root, studio, engine modules, cache-busting stamps, robots, sitemap,
llms files, schemas, and traversal attempts."""

from __future__ import annotations

import os
import re

import pytest
from conftest import API, APP, LANDING

from apps.api.static_routes import AI_CRAWLERS, asset_token, safe_file

STAMP = re.compile(r"\?v=[0-9a-f]{10}")


def test_landing_root_serves_landing_html(client):
    resp = client.get("/", base_url=LANDING)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "text/html; charset=utf-8"
    html = resp.get_data(as_text=True)
    assert '<a href="/studio/">' in html  # page links are not assets: never stamped
    assert STAMP.search(html)


def test_app_root_redirects_to_studio(client):
    resp = client.get("/", base_url=APP)
    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/studio/")


def test_api_root_is_a_json_index(client):
    resp = client.get("/", base_url=API)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["service"] == "pliego-api"
    assert "POST /api/v1/documents" in body["endpoints"]
    assert "GET /health" in body["endpoints"]


def test_unknown_host_root_falls_back_to_landing_page(client):
    resp = client.get("/", base_url="http://localhost:8000")
    assert resp.status_code == 200 and b"<a href=" in resp.data


def test_studio(client):
    assert client.get("/studio", base_url=APP).status_code == 308
    resp = client.get("/studio/", base_url=APP)
    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    # relative and absolute same-origin assets are stamped, resolved against /studio/
    assert re.search(r'href="studio\.css\?v=[0-9a-f]{10}"', html)
    assert re.search(r'src="\./studio\.js\?v=[0-9a-f]{10}"', html)
    assert re.search(r'src="/engine/index\.js\?v=[0-9a-f]{10}"', html)


def test_cache_busting_stamps(client, tree):
    html = client.get("/", base_url=LANDING).get_data(as_text=True)
    css = tree / "apps" / "web" / "assets" / "site.css"
    token = asset_token("/assets/site.css", css)
    assert f'href="/assets/site.css?v={token}"' in html
    assert re.search(r'href="/favicon\.svg\?v=[0-9a-f]{10}"', html)
    # external, data:, missing files and URLs that already carry a query are left alone
    assert 'href="https://plausible.madfam.io"' in html
    assert 'src="data:image/png;base64,AAAA"' in html
    assert 'src="/assets/missing.png"' in html
    assert 'src="/assets/app.js?v=keep"' in html
    # the token follows (mtime, size): a "deploy" changes it
    st = css.stat()
    css.write_text("body{margin:1px}\n", encoding="utf-8")
    os.utime(css, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    html2 = client.get("/", base_url=LANDING).get_data(as_text=True)
    assert f'href="/assets/site.css?v={token}"' not in html2
    assert f'href="/assets/site.css?v={asset_token("/assets/site.css", css)}"' in html2


def test_html_etag_and_304(client):
    first = client.get("/", base_url=LANDING)
    etag = first.headers["ETag"]
    again = client.get("/", base_url=LANDING, headers={"If-None-Match": etag})
    assert again.status_code == 304


@pytest.mark.parametrize("path,ctype", [
    ("/engine/index.js", "text/javascript; charset=utf-8"),
    ("/engine/physics/xpbd.js", "text/javascript; charset=utf-8"),
    ("/assets/app.js", "text/javascript; charset=utf-8"),
    ("/assets/site.css", "text/css; charset=utf-8"),
    ("/studio/studio.js", "text/javascript; charset=utf-8"),
    ("/favicon.svg", "image/svg+xml; charset=utf-8"),
])
def test_static_files_and_types(client, path, ctype):
    resp = client.get(path, base_url=APP)
    assert resp.status_code == 200, path
    assert resp.headers["Content-Type"] == ctype
    assert resp.headers.get("ETag")
    assert "no-cache" in resp.headers["Cache-Control"]
    assert client.get(path, base_url=APP,
                      headers={"If-None-Match": resp.headers["ETag"]}).status_code == 304


@pytest.mark.parametrize("path", [
    "/engine/../../../../etc/passwd",
    "/engine/%2e%2e/%2e%2e/%2e%2e/secret.txt",
    "/assets/../../../secret.txt",
    "/assets/..%2f..%2f..%2fsecret.txt",
    "/studio/../index.html",
    "/engine//etc/passwd",
    "/assets/.hidden.txt",
    "/.hidden.txt",
    "/notes.py",
    "/secret.txt",
    "/engine/index.js%00.png",
    "/schemas/../llms.txt",
    "/schemas/..%2fllms.txt",
    "/engine/physics",
    "/index.html",
])
def test_traversal_and_unsafe_paths_are_404(client, path):
    resp = client.get(path, base_url=LANDING, follow_redirects=True)  # // is merged, then 404
    assert resp.status_code == 404, path
    assert b"not served" not in resp.data and b"SECRET" not in resp.data


def test_safe_file_rejects_symlink_escape(tree):
    outside = tree / "secret.txt"
    link = tree / "packages" / "engine" / "src" / "escape.js"
    link.symlink_to(outside)
    assert safe_file(tree / "packages" / "engine" / "src", "escape.js") is None
    assert safe_file(tree / "packages" / "engine" / "src", "index.js") is not None


def test_robots_per_host(client):
    landing = client.get("/robots.txt", base_url=LANDING)
    assert landing.headers["Content-Type"] == "text/plain; charset=utf-8"
    text = landing.get_data(as_text=True)
    assert "User-agent: *\nAllow: /" in text
    for bot in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"):
        assert bot in AI_CRAWLERS and f"User-agent: {bot}\nAllow: /" in text
    assert "Sitemap: https://pliego.madfam.io/sitemap.xml" in text
    assert "Disallow" not in text
    for base in (APP, API, "http://localhost:8000"):
        assert client.get("/robots.txt", base_url=base).get_data(as_text=True) == \
            "User-agent: *\nDisallow: /\n"


def test_sitemap_landing_only(client):
    resp = client.get("/sitemap.xml", base_url=LANDING)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"].startswith("application/xml")
    body = resp.get_data(as_text=True)
    assert "<loc>https://pliego.madfam.io/</loc>" in body
    assert "pliego-app" not in body and "localhost" not in body
    assert client.get("/sitemap.xml", base_url=APP).status_code == 404
    assert client.get("/sitemap.xml", base_url=API).status_code == 404


@pytest.mark.parametrize("path,needle", [("/llms.txt", b"# Pliego"),
                                         ("/llms-full.txt", b"# Pliego (full)")])
def test_llms_files(client, path, needle):
    for base in (LANDING, APP, API):
        resp = client.get(path, base_url=base)
        assert resp.status_code == 200
        assert resp.headers["Content-Type"] == "text/plain; charset=utf-8"
        assert resp.data.startswith(needle)


def test_llms_missing_is_404_not_empty(make_app, tree):
    (tree / "llms.txt").unlink()
    assert make_app().test_client().get("/llms.txt").status_code == 404


def test_schema_served(client):
    resp = client.get("/schemas/sheet-document.schema.json", base_url=API)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/schema+json"
    assert client.get("/schemas/nothing.schema.json").status_code == 404
    assert client.get("/schemas/sheet-document.json").status_code == 404


def test_missing_web_tree_is_404_not_500(make_app, tree):
    (tree / "apps" / "web" / "index.html").unlink()
    assert make_app().test_client().get("/", base_url=LANDING).status_code == 404
