"""Fixed-window rate limit for the render endpoints, keyed on the TRUSTED client address.

Key selection (the fix for Fashion Cabinet's spoofable limiter):

1. the trusted client-IP header — ``CF-Connecting-IP`` by default (``PLIEGO_TRUSTED_IP_HEADER``) —
   when present and a valid IP address;
2. otherwise the socket peer (``REMOTE_ADDR``).

``X-Forwarded-For`` is never read: its first hop is whatever the client wrote. The trusted header is
trustworthy only because the pod's sole ingress is the Cloudflare tunnel, which overwrites it (the
network policy admits nothing else); set the variable to an empty string where that is not true.

Trust model: the counters live in memory, per gunicorn worker, per replica. With W workers and R
replicas a client can reach at most ``limit × W × R`` renders per window. That bound is deliberate
(no shared store until abuse is observed) and is paired with the one-render-per-worker semaphore
(render_limits.py), which bounds concurrency regardless of the key.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from collections.abc import Callable

from flask import Request


class RateLimiter:
    """At most ``limit`` hits per ``window_s`` seconds per key, in fixed windows."""

    def __init__(self, limit: int, window_s: float,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._windows: dict[str, tuple[int, int]] = {}  # key -> (window index, count)
        self._lock = threading.Lock()

    def hit(self, key: str) -> tuple[bool, float]:
        """Record a hit. Returns (allowed, retry_after_seconds)."""
        now = self._clock()
        index = int(now // self.window_s)
        with self._lock:
            if len(self._windows) > 50_000:  # bound memory: drop stale windows
                self._windows = {k: v for k, v in self._windows.items() if v[0] == index}
            win, count = self._windows.get(key, (index, 0))
            if win != index:
                win, count = index, 0
            if count >= self.limit:
                return False, max(0.0, (index + 1) * self.window_s - now)
            self._windows[key] = (win, count + 1)
            return True, 0.0


def client_key(req: Request, trusted_header: str) -> str:
    if trusted_header:
        raw = (req.headers.get(trusted_header) or "").strip()
        if raw:
            try:
                return str(ipaddress.ip_address(raw))
            except ValueError:
                pass  # a malformed header is ignored, never trusted
    return req.remote_addr or "unknown"
