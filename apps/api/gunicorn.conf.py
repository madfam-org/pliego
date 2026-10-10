"""gunicorn settings for the Pliego container (read-only root filesystem, uid 1001).

    gunicorn -c apps/api/gunicorn.conf.py apps.api.app:app

Two listeners: the app on 8000 and Prometheus metrics on PLIEGO_METRICS_PORT (9090, internal; the
Service pliego-metrics exposes it to the scraper only). The app answers /metrics on the metrics
listener only and nothing else there (apps/api/metrics.py).
"""

import os

_metrics_port = int(os.environ.get("PLIEGO_METRICS_PORT", "9090"))
_app_port = int(os.environ.get("PLIEGO_PORT", "8000"))

bind = [f"0.0.0.0:{_app_port}", f"0.0.0.0:{_metrics_port}"]
workers = int(os.environ.get("PLIEGO_WORKERS", "2"))
threads = int(os.environ.get("PLIEGO_THREADS", "4"))
worker_class = "gthread"
# A render is bounded by the runner's own 30 s timeout; the worker timeout sits above it.
timeout = 60
graceful_timeout = 30
keepalive = 5
worker_tmp_dir = "/tmp"
accesslog = "-"
errorlog = "-"
# No runtime management socket in the container (it would also need a writable $HOME).
control_socket_disable = True
# Request smuggling hardening: refuse ambiguous framing, cap header sizes.
limit_request_line = 8190
limit_request_fields = 100
limit_request_field_size = 8190


def _non_dumpable():
    """PR_SET_DUMPABLE=0 on Linux: a sandboxed cartridge (same uid) cannot read this process's
    /proc/<pid>/environ or ptrace it. Best effort; logged when unavailable."""
    import sys

    if not sys.platform.startswith("linux"):
        return
    try:
        import ctypes

        ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)
    except (OSError, AttributeError) as exc:  # pragma: no cover - platform dependent
        print(f"gunicorn: PR_SET_DUMPABLE unavailable: {exc}", file=sys.stderr)


def on_starting(server):
    _non_dumpable()


def post_fork(server, worker):
    _non_dumpable()
