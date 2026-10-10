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


# ── command line: python -m pliego.cartridge <dir> ───────────────────────────

ALLOWED_IMPORTS = ("pliego", "math", "__future__")


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
    import builtins

    root = name.split(".")[0]
    if level != 0 or root not in ALLOWED_IMPORTS:
        raise ImportError(f"cartridges may import only {', '.join(ALLOWED_IMPORTS)}; got {name!r}")
    return builtins.__import__(name, globals, locals, fromlist, level)


def execute(script: str, params: dict[str, Any], filename: str = "main.py") -> dict:
    """Run a cartridge script with `pliego` and `math` injected and params as bare globals.

    A light import guard only (the hardened sandbox lives in apps/api). Returns the namespace.
    """
    import builtins
    import math

    import pliego

    safe_builtins = dict(vars(builtins))
    safe_builtins["__import__"] = _guarded_import
    for banned in ("open", "eval", "exec", "compile", "input", "breakpoint"):
        safe_builtins.pop(banned, None)
    ns: dict[str, Any] = {"__builtins__": safe_builtins, "__name__": "__cartridge__",
                          "pliego": pliego, "math": math}
    ns.update(params)
    exec(compile(script, filename, "exec"), ns)  # noqa: S102 - the cartridge contract
    return ns


def _runs(manifest: dict, mode: str | None, overrides: dict) -> list[tuple[str, str | None, dict]]:
    modes = [m.get("id") for m in manifest.get("modes") or [] if isinstance(m, dict)]
    modes = [m for m in modes if m] or ["default"]
    if mode is not None:
        if mode not in modes:
            raise SystemExit(f"error: mode {mode!r} not in manifest modes {modes}")
        modes = [mode]
    defaults = {p["id"]: p.get("default") for p in manifest.get("parameters") or []
                if isinstance(p, dict) and "id" in p}
    runs = []
    for m in modes:
        runs.append((m, None, {**defaults, **overrides}))
        for preset in manifest.get("presets") or []:
            if isinstance(preset, dict) and preset.get("id"):
                runs.append((m, preset["id"], {**defaults, **(preset.get("values") or {}),
                                               **overrides}))
    return runs


def _script_for(manifest: dict, mode: str) -> str:
    for m in manifest.get("modes") or []:
        if isinstance(m, dict) and m.get("id") == mode and m.get("script_file"):
            return str(m["script_file"])
    return "main.py"


def main(argv: list[str] | None = None) -> int:
    """`python -m pliego.cartridge <dir> [--params JSON] [--mode ID] [--out DIR]
    [--formats svg,pdf,…] [--stocks FILE]` — render, verify and print read-proof lines."""
    import argparse
    import json
    import sys
    from pathlib import Path

    ap = argparse.ArgumentParser(prog="python -m pliego.cartridge", description=main.__doc__)
    ap.add_argument("directory")
    ap.add_argument("--params", default="{}", help="JSON object overriding parameters")
    ap.add_argument("--mode", default=None, help="mode id (default: every mode)")
    ap.add_argument("--out", default=None, help="write <slug>.<mode>[.<preset>].fold here")
    ap.add_argument("--formats", default="", help="extra export formats (needs pliego.export)")
    ap.add_argument("--stocks", default=None, help="JSON file: stock id → snapshot (optional)")
    args = ap.parse_args(argv)
    root = Path(args.directory)
    try:
        manifest = json.loads((root / "project.json").read_text(encoding="utf-8"))
        overrides = json.loads(args.params)
        stocks = (json.loads(Path(args.stocks).read_text(encoding="utf-8"))
                  if args.stocks else None)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("verify: cartridge=? mode=? sheets=0 vertices=0 edges=0 faces=0 joins=0 errors=1 "
              "warnings=0")
        return 1
    if not isinstance(overrides, dict):
        print("error: --params must be a JSON object", file=sys.stderr)
        return 1
    project = manifest.get("project") if isinstance(manifest.get("project"), dict) else {}
    slug = project.get("slug") or manifest.get("slug") or root.resolve().name
    formats = [f for f in args.formats.split(",") if f]
    exporters = None
    if formats:
        try:
            from .export import EXPORTERS as exporters  # type: ignore[attr-defined]
        except ImportError:
            print("export: skipped (pliego.export is not available)", file=sys.stderr)
    out_dir = Path(args.out) if args.out else None
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
    failures = runs_done = 0
    for mode, preset, params in _runs(manifest, args.mode, overrides):
        label = mode if preset is None else f"{mode}:{preset}"
        try:
            script = (root / _script_for(manifest, mode)).read_text(encoding="utf-8")
            ns = execute(script, {**params, "mode": mode}, _script_for(manifest, mode))
            check = check_result(find_result(ns), stocks=stocks, cartridge=slug, mode=mode,
                                 params=params)
        except Exception as exc:  # noqa: BLE001 - report and fail closed
            check = ResultCheck(None, [{"level": "error", "kind": "cartridge_failed",
                                        "detail": f"{type(exc).__name__}: {exc}"}])
        runs_done += 1
        doc = check.document
        counts = (doc.summary(check.issues).split(" ", 1)[1] if doc is not None else
                  "sheets=0 vertices=0 edges=0 faces=0 joins=0 errors="
                  f"{max(1, len(check.issues))} warnings=0")
        print(f"verify: cartridge={slug} mode={label} {counts}")
        for issue in check.issues:
            if issue.get("level") == "error":
                print(f"  error {issue.get('kind')}: {issue.get('detail')}", file=sys.stderr)
        if not check.ok:
            failures += 1
            continue
        if out_dir is not None and doc is not None:
            stem = f"{slug}.{mode}" + ("" if preset is None else f".{preset}")
            (out_dir / f"{stem}.fold").write_text(doc.to_json(pretty=True), encoding="utf-8")
            for fmt in formats if exporters else []:
                if fmt not in exporters:
                    print(f"  error unknown format {fmt!r}", file=sys.stderr)
                    failures += 1
                    continue
                fn, ext, _ = exporters[fmt]
                data = fn(doc.to_json())
                path = out_dir / f"{stem}{ext}"
                if isinstance(data, bytes):
                    path.write_bytes(data)
                else:
                    path.write_text(data, encoding="utf-8")
    if runs_done == 0:
        print(f"verify: cartridge={slug} mode=? sheets=0 vertices=0 edges=0 faces=0 joins=0 "
              "errors=1 warnings=0")
        return 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
