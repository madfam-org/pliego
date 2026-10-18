"""Security headers on every kind of response, and the CORS allowlist."""

from __future__ import annotations

import pytest
from conftest import API, APP, LANDING

from apps.api.config import Settings
from apps.api.cors import DEV_ORIGINS, CorsConfigError, parse_origins
from apps.api.security import build_csp

STRICT_CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; "
              "img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; "
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


def test_csp_string_is_exactly_the_ruled_policy():
    assert build_csp() == STRICT_CSP


@pytest.mark.parametrize("path,base", [
    ("/", LANDING),                      # HTML
    ("/studio/", APP),                   # HTML
    ("/assets/app.js", LANDING),         # JavaScript
    ("/engine/index.js", APP),           # JavaScript (engine)
    ("/api/v1/catalog", API),            # JSON
    ("/health", API),                    # JSON
    ("/robots.txt", LANDING),            # text
    ("/api/v1/does-not-exist", API),     # JSON error
])
def test_security_headers_everywhere(client, path, base):
    resp = client.get(path, base_url=base)
    h = resp.headers
    assert h["Content-Security-Policy"] == STRICT_CSP
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in h["Permissions-Policy"]
    assert h["Strict-Transport-Security"] == "max-age=63072000; includeSubDomains; preload"
    assert h["X-Frame-Options"] == "DENY"
    assert "no-cache" in h["Cache-Control"]


def test_robots_tag_only_on_working_hosts(client):
    assert "X-Robots-Tag" not in client.get("/", base_url=LANDING).headers
    assert client.get("/studio/", base_url=APP).headers["X-Robots-Tag"] == "noindex, nofollow"
    assert client.get("/health", base_url=API).headers["X-Robots-Tag"] == "noindex, nofollow"


def test_plausible_origin_widens_landing_only(make_app):
    app = make_app(plausible_origin="https://plausible.madfam.io")
    c = app.test_client()
    landing = c.get("/", base_url=LANDING).headers["Content-Security-Policy"]
    assert "script-src 'self' https://plausible.madfam.io" in landing
    assert "connect-src 'self' https://plausible.madfam.io" in landing
    assert c.get("/studio/", base_url=APP).headers["Content-Security-Policy"] == STRICT_CSP


@pytest.mark.parametrize("bad", ["http://plausible.madfam.io", "https://*.madfam.io",
                                 "https://plausible.madfam.io/js/script.js"])
def test_plausible_origin_must_be_bare_https(make_app, bad):
    with pytest.raises(RuntimeError):
        make_app(plausible_origin=bad)


# ── CORS ─────────────────────────────────────────────────────────────────────
def test_cors_allowed_origin_is_echoed(client):
    resp = client.get("/api/v1/catalog", base_url=API, headers={"Origin": APP})
    assert resp.headers["Access-Control-Allow-Origin"] == APP
    assert "Origin" in resp.headers["Vary"]
    assert "Access-Control-Allow-Credentials" not in resp.headers


def test_cors_unlisted_origin_gets_nothing(client):
    resp = client.get("/api/v1/catalog", base_url=API, headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_cors_preflight(client):
    resp = client.options("/api/v1/documents", base_url=API, headers={
        "Origin": LANDING, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type"})
    assert resp.status_code == 200
    assert resp.headers["Access-Control-Allow-Origin"] == LANDING
    assert "POST" in resp.headers["Access-Control-Allow-Methods"]
    denied = client.options("/api/v1/documents", base_url=API, headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "Access-Control-Allow-Origin" not in denied.headers


@pytest.mark.parametrize("raw", ["*", "https://pliego.madfam.io,*", "https://*.madfam.io"])
def test_cors_wildcard_raises(raw):
    with pytest.raises(CorsConfigError, match="wildcard"):
        parse_origins(raw, dev=True)


def test_cors_empty_raises_unless_dev():
    with pytest.raises(CorsConfigError, match="required"):
        parse_origins("", dev=False)
    assert parse_origins("", dev=True) == DEV_ORIGINS


@pytest.mark.parametrize("raw", ["null", "pliego.madfam.io", "https://pliego.madfam.io/path",
                                 "ftp://pliego.madfam.io", "https://user@pliego.madfam.io"])
def test_cors_malformed_raises(raw):
    with pytest.raises(CorsConfigError):
        parse_origins(raw, dev=True)


def test_app_refuses_to_boot_without_allowlist(make_app):
    with pytest.raises(CorsConfigError):
        make_app(cors_origins_raw="")
    with pytest.raises(CorsConfigError):
        make_app(cors_origins_raw="*", dev=True)
    assert make_app(cors_origins_raw="", dev=True) is not None


def test_settings_from_env_uses_the_scaffold_env_contract():
    s = Settings.from_env({"PLIEGO_PUBLIC_API_HOST": "API.example.test",
                           "PLIEGO_TRUSTED_PROXY_HEADER": "X-Real-Client",
                           "PLIEGO_CORS_ORIGINS": "https://a.example"})
    assert s.host_api == "api.example.test"
    assert s.trusted_ip_header == "X-Real-Client"
    assert Settings.from_env({}).trusted_ip_header == "CF-Connecting-IP"
    assert Settings.from_env({"PLIEGO_TRUSTED_PROXY_HEADER": ""}).trusted_ip_header == ""
    hosts = Settings.from_env({"PLIEGO_PUBLIC_LANDING_HOST": "localhost:8000",
                               "PLIEGO_PUBLIC_APP_HOST": "app.localhost:8000"})
    assert (hosts.host_landing, hosts.host_app, hosts.host_api) == \
        ("localhost:8000", "app.localhost:8000", "pliego-api.madfam.io")
    assert Settings.from_env({"PLIEGO_METRICS_PORT": "9191"}).metrics_port == 9191
    with pytest.raises(RuntimeError):
        Settings.from_env({"PLIEGO_RATE_LIMIT": "lots"})


def test_unhandled_error_log_line_cannot_be_forged(make_app, caplog):
    """CR/LF in the (percent-decoded) path are escaped in the log line (CodeQL py/log-injection)."""
    app = make_app()

    def boom(rest):
        raise RuntimeError("boom")

    app.add_url_rule("/api/v1/boom/<rest>", "boom", boom)
    with caplog.at_level("ERROR", logger="pliego.api"):
        resp = app.test_client().get("/api/v1/boom/x%0D%0AFORGED%20entry", base_url=API)
    assert resp.status_code == 500
    assert resp.get_json()["error"] == "internal error"
    lines = [r.getMessage() for r in caplog.records if "unhandled error" in r.getMessage()]
    assert lines and "\n" not in lines[0] and "\r" not in lines[0]
    assert "x\\r\\nFORGED entry" in lines[0]
