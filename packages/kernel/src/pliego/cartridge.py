"""Helpers for cartridge scripts and the `result` contract check used by the runner.

The sandbox injects `pliego` and `math` as the only importable modules and parameters as bare
globals. Scripts read parameters through a local accessor so they also run standalone::

    def PARAM(get, default):
        try:
            return get()
        except NameError:
            return default

    size = PARAM(lambda: size, 150.0)  # noqa: F821

`result` must be a `pliego.Sheet`, `pliego.Assembly` or `pliego.Document`. The runner calls
`check_result()` and prints its read-proof line; any error exits 1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .assembly import Assembly
from .document import Document
from .sheet import Sheet

RESULT_NAMES = ("result", "document", "assembly", "sheet")


def param(get: Any, default: Any) -> Any:
    """The PARAM accessor (also importable as `pliego.cartridge.param`)."""
    try:
        return get()
    except NameError:
        return default


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp a numeric parameter into [lo, hi] (cartridges clamp in-script)."""
    return max(lo, min(hi, float(value)))


@dataclass
class ResultCheck:
    document: Document | None
    issues: list[dict] = field(default_factory=list)
    line: str = "verify: sheets=0 vertices=0 edges=0 faces=0 joins=0 errors=1 warnings=0"

    @property
    def ok(self) -> bool:
        return (self.document is not None and self.document.count("pliego:sheets") > 0
                and not any(i.get("level") == "error" for i in self.issues))

    @property
    def exit_code(self) -> int:
        return 0 if self.ok else 1


def find_result(namespace: dict) -> Any:
    """The cartridge's result object: `result` first, then the other conventional names,
    then the single Sheet/Assembly/Document global (fail loud when ambiguous)."""
    for name in RESULT_NAMES:
        if name in namespace and isinstance(namespace[name], Sheet | Assembly | Document):
            return namespace[name]
    found = [v for k, v in namespace.items() if not k.startswith("_")
             and isinstance(v, Sheet | Assembly | Document)]
    if len(found) == 1:
        return found[0]
    if not found:
        raise LookupError("cartridge defines no `result` (Sheet, Assembly or Document)")
    raise LookupError("cartridge defines several sheets/assemblies; assign one to `result`")


def check_result(result: Any, stocks: dict[str, dict] | None = None,
                 cartridge: str | None = None, mode: str | None = None,
                 params: dict | None = None) -> ResultCheck:
    """Build (if needed) and verify a cartridge result; returns the document, issues and the
    read-proof line. Never raises for a bad result: failures become issues (fail closed)."""
    try:
        if isinstance(result, Sheet):
            result = Assembly([result])
        if isinstance(result, Assembly):
            meta = {"cartridge": cartridge, "mode": mode, "params": params}
            doc = result.build(stocks=stocks, **{k: v for k, v in meta.items() if v is not None})
        elif isinstance(result, Document):
            doc = result
        else:
            issue = {"level": "error", "kind": "result_type",
                     "detail": f"result is {type(result).__name__}, expected Sheet, Assembly or "
                     "Document"}
            return ResultCheck(None, [issue])
    except Exception as exc:  # noqa: BLE001 - the runner reports, never crashes silently
        issue = {"level": "error", "kind": "build_failed", "detail": f"{type(exc).__name__}: {exc}"}
        return ResultCheck(None, [issue])
    issues = doc.verify()
    return ResultCheck(doc, issues, doc.summary(issues))
