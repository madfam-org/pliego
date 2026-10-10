"""Tell the three public hosts apart (one container serves all of them).

``landing`` (pliego.madfam.io), ``app`` (pliego-app.madfam.io, the studio), ``api``
(pliego-api.madfam.io) or ``other`` (anything else: localhost, a probe by pod IP). A configured
host with a port (``localhost:8000`` in .env.example) must match exactly; a configured host
without a port matches the request host with any port.
"""

from __future__ import annotations

from flask import request

from .config import Settings


def _split(host: str) -> tuple[str, str]:
    host = host.strip().lower()
    if host.startswith("["):  # IPv6 literal
        end = host.find("]")
        return host[: end + 1], host[end + 2:] if end + 1 < len(host) else ""
    name, _, port = host.partition(":")
    return name, port


class HostRouter:
    def __init__(self, settings: Settings) -> None:
        self._table = (
            ("landing", settings.host_landing),
            ("app", settings.host_app),
            ("api", settings.host_api),
        )

    def classify(self, host: str) -> str:
        req_name, req_port = _split(host)
        for kind, configured in self._table:
            name, port = _split(configured)
            if name == req_name and (not port or port == req_port):
                return kind
        return "other"

    def kind(self) -> str:
        return self.classify(request.host or "")
