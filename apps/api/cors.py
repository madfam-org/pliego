"""CORS: an explicit allowlist, never a wildcard.

``PLIEGO_CORS_ORIGINS`` is a comma-separated list of bare origins (``https://host[:port]``). A
wildcard (or the ``null`` origin) raises at start-up; an empty list raises unless ``PLIEGO_DEV=1``,
in which case only the local development origins are allowed. A malformed entry raises too: a typo
must fail the boot, not silently narrow or widen the policy.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from flask import Flask, Response, request

DEV_ORIGINS = ("http://localhost:8000", "http://127.0.0.1:8000")


class CorsConfigError(RuntimeError):
    pass


def parse_origins(raw: str, *, dev: bool) -> tuple[str, ...]:
    entries = [o.strip() for o in (raw or "").split(",") if o.strip()]
    for origin in entries:
        if "*" in origin:
            raise CorsConfigError("CORS wildcard is banned; list origins explicitly")
        if origin.lower() == "null":
            raise CorsConfigError("the 'null' origin is banned")
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.path \
                or parts.query or parts.fragment or "@" in parts.netloc:
            raise CorsConfigError(f"malformed CORS origin {origin!r} (want scheme://host[:port])")
    if not entries:
        if dev:
            return DEV_ORIGINS
        raise CorsConfigError("PLIEGO_CORS_ORIGINS is required (set PLIEGO_DEV=1 for local work)")
    return tuple(o.rstrip("/").lower() for o in entries)


def install(app: Flask, origins: tuple[str, ...]) -> None:
    allowed = frozenset(origins)

    @app.after_request
    def _cors(resp: Response) -> Response:
        resp.vary.add("Origin")
        origin = (request.headers.get("Origin") or "").lower()
        if origin and origin in allowed:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Access-Control-Expose-Headers"] = (
                "Content-Disposition, Retry-After, X-Pliego-Verify"
            )
            resp.headers["Access-Control-Max-Age"] = "600"
        return resp
