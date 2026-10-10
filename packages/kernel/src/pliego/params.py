"""Cartridge parameter helpers, reachable at the top level as ``pliego.param`` / ``pliego.clamp``.

They live in their own module (not ``pliego.cartridge``) so the package can import them eagerly
without pre-loading the ``python -m pliego.cartridge`` CLI module (runpy would warn), and so
sandboxed cartridges — which see only the public attributes of ``pliego`` — can call them::

    size = pliego.clamp(pliego.param(lambda: size, 150.0), 60.0, 300.0)  # noqa: F821
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def param(get: Callable[[], Any], default: Any) -> Any:
    """The PARAM accessor: ``get()`` (a lambda reading the injected global), or `default` when
    the global is absent (the script runs standalone)."""
    try:
        return get()
    except NameError:
        return default


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp a numeric parameter into [lo, hi] (cartridges clamp in-script)."""
    if lo > hi:
        raise ValueError(f"clamp: lo {lo} > hi {hi}")
    return max(float(lo), min(float(hi), float(value)))
