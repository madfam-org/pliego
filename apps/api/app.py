"""Pliego web service: landing, studio, engine modules and the JSON API from one Flask app.

    gunicorn -c apps/api/gunicorn.conf.py apps.api.app:app

``create_app(settings)`` builds an app; the module attribute ``app`` is created lazily on first
access (PEP 562), so importing this module has no side effects (tests build their own apps) while
gunicorn's ``apps.api.app:app`` still gets a fully configured instance — and a misconfiguration
(a CORS wildcard, a missing allowlist) still fails the worker boot.
"""

from __future__ import annotations

import logging
import sys

from flask import Flask, g, request
from werkzeug.exceptions import HTTPException

from . import cors, security, static_routes
from . import metrics as metrics_mod
from . import thumbnails as thumbnails_mod
from .api_v1 import OPENAPI_CONTRACT, create_blueprint, error, json_response
from .catalog import Catalog, StockLibrary, strict_json_loads
from .config import MAX_CONTENT_LENGTH, Settings
from .hosts import HostRouter
from .ratelimit import RateLimiter
from .render import Renderer
from .render_cache import RenderCache
from .render_limits import RenderSlot

VERSION = "0.1.0"
log = logging.getLogger("pliego.api")

_JSON_PATHS = ("/api/", "/health", "/ready", "/metrics")
__all__ = ["OPENAPI_CONTRACT", "VERSION", "create_app"]  # the contract: scripts/qa/verify_openapi.py


def _ensure_kernel_importable(settings: Settings) -> None:
    """A source checkout imports the kernel from packages/kernel/src (the image pip-installs it)."""
    try:
        import pliego  # noqa: F401
    except ImportError:
        src = str(settings.kernel_src)
        if settings.kernel_src.is_dir() and src not in sys.path:
            sys.path.insert(0, src)


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or Settings.from_env()
    origins = cors.parse_origins(settings.cors_origins_raw, dev=settings.dev)
    _ensure_kernel_importable(settings)

    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
    app.config["PLIEGO_SETTINGS"] = settings
    app.json.sort_keys = False

    hosts = HostRouter(settings)
    metrics = metrics_mod.Metrics()
    renderer = Renderer(settings)
    previews = thumbnails_mod.ThumbnailStore(settings.thumbnails)
    catalog = Catalog(settings.projects, renderer.published_formats, previews.url)
    stocks = StockLibrary(settings.materials)
    limiter = RateLimiter(*settings.rate_limit)
    cache = RenderCache(settings, metrics)
    slot = RenderSlot(1)
    app.extensions["pliego"] = {"catalog": catalog, "stocks": stocks, "renderer": renderer,
                                "limiter": limiter, "metrics": metrics, "hosts": hosts,
                                "thumbnails": previews, "render_cache": cache, "slot": slot}

    # Order matters: the metrics-listener gate runs first; security headers apply to everything.
    metrics_mod.install(app, metrics, settings.metrics_port)
    security.install(app, settings, hosts)
    cors.install(app, origins)

    @app.before_request
    def _guard_request():
        if request.path.startswith("/api/") and "Authorization" in request.headers:
            # Janua verification is not wired yet: refuse credentials rather than silently
            # treating an authenticated caller as anonymous.
            return error(401, "authentication is not enabled on this API yet; omit Authorization")
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.mimetype != "application/json":
                return error(415, "request bodies must be application/json")
            raw = request.get_data(cache=True)  # MAX_CONTENT_LENGTH → 413 before this returns
            try:
                body = strict_json_loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                return error(400, f"request body is not valid JSON: {exc}")
            if not isinstance(body, dict):
                return error(400, "request body must be a JSON object")
            g.json_body = body
        return None

    def api_index():
        routes = sorted({(r.rule, m) for r in app.url_map.iter_rules()
                         for m in r.methods - {"HEAD", "OPTIONS"}
                         if r.rule.startswith("/api/v1/") or r.rule in ("/health", "/ready")})
        return json_response({"service": "pliego-api", "version": VERSION,
                              "openapi": "https://github.com/madfam-org/pliego/blob/main/"
                                         "apps/api/openapi.yaml",
                              "endpoints": [f"{m} {rule}" for rule, m in routes]})

    app.register_blueprint(create_blueprint(
        catalog, stocks, renderer, metrics, limiter, slot, previews, cache,
        version=VERSION, revision=settings.revision,
        require_commons=settings.require_commons, trusted_header=settings.trusted_ip_header))
    thumbnails_mod.register(app, previews)  # before the static catch-all: /projects/<slug>.svg
    static_routes.register(app, settings, hosts, api_index)

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException):
        if request.path.startswith(_JSON_PATHS) or request.method != "GET":
            return error(exc.code or 500, exc.description or exc.name)
        return exc

    @app.errorhandler(Exception)
    def _unhandled(exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.path)
        return error(500, "internal error")

    return app


def __getattr__(name: str):
    if name == "app":
        instance = create_app()
        globals()["app"] = instance
        return instance
    raise AttributeError(name)
