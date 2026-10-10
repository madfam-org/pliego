"""One render per worker: a non-blocking semaphore around the sandbox subprocess.

A worker that is already running a cartridge answers ``503 Service Unavailable`` with
``Retry-After: 1`` instead of queueing a second subprocess behind it (the pod's CPU budget is small
and a render can take up to the runner timeout). Per worker process: gunicorn's threads share it.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

RETRY_AFTER_S = 1


class RenderBusy(Exception):
    """This worker is already rendering."""


class RenderSlot:
    def __init__(self, slots: int = 1) -> None:
        self._sem = threading.BoundedSemaphore(slots)

    @contextmanager
    def acquire(self) -> Iterator[None]:
        if not self._sem.acquire(blocking=False):
            raise RenderBusy()
        try:
            yield
        finally:
            self._sem.release()
