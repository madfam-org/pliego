"""Response security headers, applied to every response (HTML, JavaScript, JSON, files).

A real Content-Security-Policy from day one (Fashion Cabinet shipped none despite "CSP-safe"
comments): everything is same-origin, no inline script or style, no plugins, no framing. The one
optional widening is the Plausible origin (``PLIEGO_PLAUSIBLE_ORIGIN``, the only analytics MADFAM
allows), and only on the landing host, only when configured.

Non-landing hosts (the studio and the API) also carry ``X-Robots-Tag: noindex, nofollow``: AI and
search crawlers are welcome on the landing host and blocked on the working hosts (ruling R40).
"""

from __future__ import annotations

from urllib.parse import urlsplit

from flask import Flask, Response

from .config import Settings
from .hosts import HostRouter

BASE_CSP: tuple[tuple[str, str], ...] = (
    ("default-src", "'self'"),
    ("script-src", "'self'"),
    ("style-src", "'self'"),
    ("img-src", "'self' data: blob:"),
    ("connect-src", "'self'"),
    ("worker-src", "'self'"),
    ("frame-ancestors", "'none'"),
    ("base-uri", "'self'"),
    ("form-action", "'self'"),
    ("object-src", "'none'"),
)

STATIC_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), "
        "microphone=(), payment=(), usb=(), interest-cohort=()"
    ),
    # madfam.io is HSTS-preloaded (ruled); browsers ignore the header over plain http.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
}


def build_csp(extra_origin: str = "") -> str:
    parts = []
    for directive, value in BASE_CSP:
        if extra_origin and directive in ("script-src", "connect-src"):
            value = f"{value} {extra_origin}"
        parts.append(f"{directive} {value}")
    return "; ".join(parts)


def _validated_origin(raw: str) -> str:
    if not raw:
        return ""
    parts = urlsplit(raw)
    if parts.scheme != "https" or not parts.netloc or parts.path not in ("", "/") \
            or parts.query or parts.fragment or "*" in raw:
        raise RuntimeError(f"PLIEGO_PLAUSIBLE_ORIGIN must be a bare https origin, got {raw!r}")
    return f"https://{parts.netloc}"


def install(app: Flask, settings: Settings, hosts: HostRouter) -> None:
    strict_csp = build_csp()
    plausible = _validated_origin(settings.plausible_origin)
    landing_csp = build_csp(plausible) if plausible else strict_csp

    @app.after_request
    def _security_headers(resp: Response) -> Response:
        kind = hosts.kind()
        resp.headers["Content-Security-Policy"] = landing_csp if kind == "landing" else strict_csp
        for name, value in STATIC_HEADERS.items():
            resp.headers[name] = value
        if kind != "landing":
            resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        # Deploy-safe caching: every response revalidates (ETags keep that a cheap 304); a route
        # that set its own policy keeps it.
        resp.headers.setdefault("Cache-Control", "no-cache")
        return resp

