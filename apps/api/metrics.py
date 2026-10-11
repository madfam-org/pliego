"""Prometheus text exposition, standard library only, answered ONLY on the metrics listener.

gunicorn binds two listeners (gunicorn.conf.py): the app on 8000 and metrics on
``PLIEGO_METRICS_PORT`` (9090, internal, never routed through the tunnel). The listener a request
arrived on is ``SERVER_PORT``, which gunicorn takes from the bound socket (``getsockname()``), not
from the client's Host header, so it cannot be spoofed. On the app listener ``/metrics`` is a 404;
on the metrics listener everything except ``/metrics`` is a 404.

Counters are PER WORKER PROCESS (no shared store, no multiprocess mode): a scrape reaches one
worker, so every series carries a ``worker`` label (the pid) and must be summed across workers;
a worker restart resets its counters (use ``rate()``/``increase()``).
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict

from flask import Flask, Response, abort, request

CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
        self._help: dict[str, tuple[str, str]] = {}
        self.started = time.time()

    def describe(self, name: str, kind: str, text: str) -> None:
        self._help[name] = (kind, text)

    def inc(self, name: str, amount: float = 1.0, **labels: str) -> None:
        key = (name, tuple(sorted((k, str(v)) for k, v in labels.items())))
        with self._lock:
            self._counters[key] += amount

    def render(self) -> str:
        worker = str(os.getpid())
        lines: list[str] = []
        with self._lock:
            snapshot = dict(self._counters)
        by_name: dict[str, list] = defaultdict(list)
        for (name, labels), value in snapshot.items():
            by_name[name].append((labels, value))
        names = sorted(set(by_name) | set(self._help))
        for name in names:
            kind, text = self._help.get(name, ("counter", name))
            lines.append(f"# HELP {name} {text} (per worker process)")
            lines.append(f"# TYPE {name} {kind}")
            for labels, value in sorted(by_name.get(name, [])):
                pairs = [("worker", worker), *labels]
                body = ",".join(f'{k}="{_escape(v)}"' for k, v in pairs)
                lines.append(f"{name}{{{body}}} {value:g}")
        lines.append("# HELP pliego_worker_start_time_seconds Worker start time (unix seconds)")
        lines.append("# TYPE pliego_worker_start_time_seconds gauge")
        lines.append(f'pliego_worker_start_time_seconds{{worker="{worker}"}} {self.started:.3f}')
        return "\n".join(lines) + "\n"


def install(app: Flask, metrics: Metrics, metrics_port: int) -> None:
    port = str(metrics_port)
    metrics.describe("pliego_http_requests_total", "counter", "HTTP responses by route and status")
    metrics.describe("pliego_renders_total", "counter", "Sandbox renders by kind and outcome")
    metrics.describe("pliego_render_seconds_total", "counter", "Wall time spent in sandbox renders")
    metrics.describe("pliego_rate_limited_total", "counter", "Requests refused by the rate limit")
    metrics.describe("pliego_render_cache_hits_total", "counter",
                     "Renders answered from the render cache, by tier (prerendered, memory, disk)")
    metrics.describe("pliego_render_cache_misses_total", "counter",
                     "Render requests the cache could not answer (a sandbox render followed)")
    metrics.describe("pliego_render_cache_evictions_total", "counter",
                     "Render cache entries evicted to stay under the byte bound, by tier")
    metrics.describe("pliego_render_cache_prerendered_invalid_total", "counter",
                     "Prerendered entries that failed verification (the request rendered instead)")

    def on_metrics_listener() -> bool:
        return str(request.environ.get("SERVER_PORT", "")) == port

    @app.before_request
    def _gate_metrics_listener():
        if on_metrics_listener() and request.path != "/metrics":
            abort(404)
        return None

    @app.after_request
    def _count(resp: Response) -> Response:
        if not on_metrics_listener():
            rule = request.url_rule.rule if request.url_rule is not None else "unmatched"
            metrics.inc("pliego_http_requests_total", route=rule, method=request.method,
                        status=str(resp.status_code))
        return resp

    @app.get("/metrics")
    def prometheus_metrics():
        if not on_metrics_listener():
            abort(404)
        return Response(metrics.render(), content_type=CONTENT_TYPE)
