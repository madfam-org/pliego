"""The JSON API: /health, /ready and /api/v1 (catalog, objects, documents, exports, stocks).

Strict from day one (the yantra4d/Fashion Cabinet lesson: malformed render payloads rendered
defaults under HTTP 200): unknown body keys, unknown query keys, unknown modes and out-of-contract
parameters are 400s with a precise message — nothing is silently defaulted except the cartridge's
own declared parameter defaults. Described in apps/api/openapi.yaml (checked against the URL map).
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass

from flask import Blueprint, Response, abort, g, request

from . import generator
from .catalog import Catalog, StockLibrary
from .manifest import Cartridge, Mode, PayloadError, resolve_request
from .metrics import Metrics
from .ratelimit import RateLimiter, client_key
from .render import TRANSPORT, Renderer, RenderError, RenderResult
from .render_cache import RenderCache
from .render_limits import RETRY_AFTER_S, RenderBusy, RenderSlot
from .thumbnails import ThumbnailStore

DOCUMENT_KEYS = frozenset({"slug", "mode", "params"})
EXPORT_KEYS = DOCUMENT_KEYS | {"format", "bundle_formats"}
RENDER_HEADERS = ("X-Pliego-Verify", "X-Pliego-Cache", *generator.GENERATOR_HEADERS)
# What the OpenAPI document must say beyond its routes (scripts/qa/verify_openapi.py checks it):
# the format enum the API transports, and the headers every successful render response carries.
OPENAPI_CONTRACT = {
    "enums": {"Format": tuple(TRANSPORT)},
    "response_headers": {
        ("POST", "/api/v1/documents"): RENDER_HEADERS,
        ("POST", "/api/v1/exports"): (*RENDER_HEADERS, "Content-Disposition", "Repr-Digest"),
    },
}
CATALOG_QUERY_KEYS = frozenset({"q", "domain", "class", "difficulty", "tag"})
_SAFE_FILENAME = re.compile(r"[^a-z0-9._-]+")


@dataclass(frozen=True)
class Rendered:
    cart: Cartridge
    mode: Mode
    requested: dict
    effective: dict
    result: RenderResult
    cache_state: str


class RateLimited(Exception):
    def __init__(self, retry_after: float):
        super().__init__("rate limited")
        self.retry_after = max(1, math.ceil(retry_after))


def json_response(payload, status: int = 200, headers: dict | None = None) -> Response:
    """JSON with ``": "`` separators: the status probes assert the literal ``"status": "ok"``."""
    body = json.dumps(payload, ensure_ascii=False, indent=None) + "\n"
    resp = Response(body, status=status, content_type="application/json")
    for key, value in (headers or {}).items():
        resp.headers[key] = value
    return resp


def error(status: int, detail: str, **extra) -> Response:
    payload = {"error": detail, "status": status, **extra}
    headers = {}
    if "retry_after" in extra:
        headers["Retry-After"] = str(extra["retry_after"])
    return json_response(payload, status, headers)


def kernel_status() -> tuple[bool, str | None, str]:
    """(healthy, version, reason). Healthy = ``import pliego`` works and exposes the core API."""
    try:
        import pliego
    except Exception as exc:  # noqa: BLE001 — any import failure means "not ready"
        return False, None, f"kernel import failed: {type(exc).__name__}: {exc}"
    version = getattr(pliego, "__version__", None)
    missing = [n for n in ("Document", "Sheet", "Assembly") if not hasattr(pliego, n)]
    if missing:
        return False, version, f"kernel lacks {missing}"
    return True, version, ""


def create_blueprint(catalog: Catalog, stocks: StockLibrary, renderer: Renderer,
                     metrics: Metrics, limiter: RateLimiter, slot: RenderSlot,
                     thumbnails: ThumbnailStore, cache: RenderCache, *, version: str, require_commons: bool, trusted_header: str) -> Blueprint:
    bp = Blueprint("api_v1", __name__)

    @bp.get("/health")
    def health():
        count, invalid = catalog.counts()
        _ok, kernel_version, _reason = kernel_status()
        stock_state = stocks.state()
        return json_response({
            "status": "ok",
            "service": "pliego",
            "version": version,
            "commons": count,
            "commons_invalid": invalid,
            "kernel": kernel_version,
            "stocks": len(stock_state["cards"]),
            "stocks_invalid": len(stock_state["invalid"]),
            "thumbnails": thumbnails.count(),
        })

    @bp.get("/ready")
    def ready():
        reasons = []
        try:
            count, invalid = catalog.counts()
        except Exception as exc:  # noqa: BLE001
            count, invalid = 0, 0
            reasons.append(f"catalog failed: {type(exc).__name__}: {exc}")
        if count == 0 and require_commons:
            reasons.append("the commons is empty (projects/ holds 0 valid cartridges)")
        kernel_ok, kernel_version, reason = kernel_status()
        if not kernel_ok:
            reasons.append(reason)
        payload = {"status": "ok" if not reasons else "unavailable", "commons": count,
                   "commons_invalid": invalid, "kernel": kernel_version,
                   "formats": list(renderer.capability()) if kernel_ok else []}
        if reasons:
            payload["reasons"] = reasons
            return json_response(payload, 503)
        return json_response(payload)

    @bp.get("/api/v1/catalog")
    def catalog_search():
        unknown = sorted(set(request.args) - CATALOG_QUERY_KEYS)
        if unknown:
            return error(400, f"unknown query parameter(s) {unknown}",
                         allowed=sorted(CATALOG_QUERY_KEYS))
        if any(len(v) > 200 for v in request.args.values()):
            return error(400, "query values are limited to 200 characters")
        filters = {k: request.args.get(k, "") for k in ("domain", "class", "difficulty", "tag")}
        return json_response(catalog.search(q=request.args.get("q", ""), **filters))

    @bp.get("/api/v1/objects/<slug>")
    def object_detail(slug: str):
        cart = catalog.get(slug)
        if cart is None:
            return error(404, f"unknown object {slug!r}")
        return json_response({
            "slug": cart.slug,
            "manifest": cart.manifest,
            "modes": [m.id for m in cart.modes],
            "export_formats": renderer.published_formats(cart),
        })

    def _render(body: dict, allowed_keys: frozenset, formats: tuple[str, ...]):
        unknown = sorted(set(body) - allowed_keys)
        if unknown:
            raise PayloadError(f"unknown key(s) {unknown} (allowed: {sorted(allowed_keys)})")
        if "slug" not in body or not isinstance(body["slug"], str):
            raise PayloadError("'slug' (string) is required")
        if "params" not in body:
            raise PayloadError("'params' (object) is required; send {} for the defaults")
        cart = catalog.get(body["slug"])
        if cart is None:
            abort(404, description=f"unknown object {body['slug']!r}")
        mode, effective = resolve_request(cart, body.get("mode"), body["params"])
        if formats:
            published = renderer.published_formats(cart)
            for fmt in formats:
                if fmt not in published:
                    raise PayloadError(f"{cart.slug!r} does not publish format {fmt!r} "
                                       f"(publishes: {published or 'none'})")
        allowed, retry = limiter.hit(client_key(request, trusted_header))
        if not allowed:
            metrics.inc("pliego_rate_limited_total")
            raise RateLimited(retry)
        kind = "export" if formats else "document"
        key = cache.key(cart, mode, effective, formats) if cache.enabled else None
        if key is not None:
            cached, tier = cache.get(key)
            if cached is not None:  # exact bytes of a previous render: no slot, no subprocess
                return Rendered(cart, mode, body["params"], effective, cached, f"hit-{tier}")
        try:
            with slot.acquire():
                result = renderer.run(cart, mode, effective, formats)
        except RenderBusy:
            metrics.inc("pliego_renders_total", kind=kind, outcome="busy")
            raise
        except RenderError as exc:
            metrics.inc("pliego_renders_total", kind=kind, outcome=f"http_{exc.status}")
            raise
        metrics.inc("pliego_renders_total", kind=kind, outcome="ok")
        metrics.inc("pliego_render_seconds_total", result.seconds, kind=kind)
        if key is not None:
            cache.put(key, result)
        return Rendered(cart, mode, body["params"], effective, result,
                        "miss" if key is not None else "off")

    def _provenance(r: Rendered) -> generator.Provenance:
        return generator.provenance(r.cart, r.mode, r.requested, r.effective,
                                    commons=cache.commons(), kernel=f"pliego-kernel {cache.kernel()}")

    def _common_headers(resp: Response, r: Rendered, doc: dict) -> Response:
        resp.headers["X-Pliego-Verify"] = r.result.verify
        resp.headers["X-Pliego-Cache"] = r.cache_state
        for key, value in generator.headers(doc).items():
            resp.headers[key] = value
        return resp

    def _guarded(handler):
        try:
            return handler()
        except PayloadError as exc:
            return error(400, str(exc))
        except RateLimited as exc:
            return error(429, "rate limit exceeded", retry_after=exc.retry_after)
        except RenderBusy:
            return error(503, "this worker is already rendering; retry shortly",
                         retry_after=RETRY_AFTER_S)
        except RenderError as exc:
            return error(exc.status, str(exc), **exc.report)

    @bp.post("/api/v1/documents")
    def documents():
        def handler():
            r = _render(g.json_body, DOCUMENT_KEYS, ())
            doc = generator.document(_provenance(r), [("fold", r.result.document)])
            return _common_headers(Response(r.result.document, content_type="application/json"),
                                   r, doc)

        return _guarded(handler)

    @bp.post("/api/v1/exports")
    def exports():
        def handler():
            body = g.json_body
            fmt = body.get("format")
            if not isinstance(fmt, str) or (fmt not in TRANSPORT and fmt != generator.BUNDLE):
                raise PayloadError(f"'format' must be one of {sorted(TRANSPORT)} or "
                                   f"{generator.BUNDLE!r}")
            if fmt == generator.BUNDLE:
                return _bundle(body)
            if "bundle_formats" in body:
                raise PayloadError("'bundle_formats' applies only to format 'bundle'")
            r = _render(body, EXPORT_KEYS, (fmt,))
            payload = r.result.exports[fmt]
            doc = generator.document(_provenance(r), [(fmt, payload)])
            resp = Response(payload, content_type=TRANSPORT[fmt][0])
            name = _SAFE_FILENAME.sub("-", generator.file_name(r.cart, r.mode, fmt))
            resp.headers["Content-Disposition"] = f'attachment; filename="{name}"'
            return _common_headers(resp, r, doc)

        return _guarded(handler)

    def _bundle(body: dict) -> Response:
        cart = catalog.get(body.get("slug")) if isinstance(body.get("slug"), str) else None
        if cart is None:  # the full checks (and their messages) are _render's; this only picks formats
            r = _render(body, EXPORT_KEYS, ())
            cart = r.cart
        try:
            formats = generator.bundle_formats(body.get("bundle_formats"),
                                               renderer.published_formats(cart))
        except ValueError as exc:
            raise PayloadError(str(exc)) from None
        r = _render(body, EXPORT_KEYS, formats)
        data, doc, name = generator.bundle(_provenance(r), r.result.document, r.result.exports,
                                           formats)
        resp = Response(data, content_type=generator.BUNDLE_MEDIA_TYPE)
        resp.headers["Content-Disposition"] = f'attachment; filename="{_SAFE_FILENAME.sub("-", name)}"'
        resp.headers["Repr-Digest"] = generator.repr_digest(data)
        return _common_headers(resp, r, doc)

    @bp.get("/api/v1/stocks")
    def stock_list():
        if request.args:
            return error(400, f"unknown query parameter(s) {sorted(request.args)}")
        st = stocks.state()
        items = [st["cards"][k] for k in sorted(st["cards"])]
        return json_response({"total": len(items), "items": items})

    @bp.get("/api/v1/stocks/<slug>")
    def stock_detail(slug: str):
        card = stocks.get(slug)
        if card is None:
            return error(404, f"unknown stock {slug!r}")
        return json_response(card)

    return bp
