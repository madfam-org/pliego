"""Sandboxed cartridge runner for Pliego: execute ``main.py``, verify, write the requested formats.

Invoked by the API as a killable subprocess (apps/api/render.py) and by authors directly:

    python pliego_runner.py <script.py> <out_dir> [--params JSON | --params-stdin]
                            [--formats svg,dxf] [--cartridge SLUG] [--mode MODE]

Contract (docs/strategy/kernel.md §2):

- the cartridge may import only ``pliego``, ``math`` and ``__future__`` (sandbox_policy.py on top
  of the vendored ``commons_sandbox`` core); parameters arrive as bare globals;
- it assigns ``result`` — a ``pliego.Sheet``, ``pliego.Assembly`` or ``pliego.Document``;
- the runner ALWAYS prints exactly one read-proof line on stdout,
  ``verify: sheets=N vertices=V edges=E faces=F joins=J errors=E warnings=W``,
  and exits 1 on any error (a cartridge exception, a policy violation, a verify error, zero sheets,
  an export failure). Whatever the cartridge prints goes to stderr, so it cannot forge that line.

Outputs in ``out_dir``: ``document.fold`` (the canonical sheet document, byte-stable as the kernel
wrote it), ``export.<format>`` per requested format, and ``report.json`` (counts and issues).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1] / "vendor"))
sys.path.insert(0, str(_HERE))

from commons_sandbox import (  # noqa: E402
    build_sandbox_builtins,
    make_restricted_import,
    read_script,
    validate_script_path,
)
from sandbox_policy import (  # noqa: E402
    PolicyError,
    SafeModule,
    check_source,
    make_allowlist_import,
)

LABEL = "Pliego cartridges"

# ── the runner's export capability: the single source of truth ───────────────
# ``fold`` is the sheet document itself (always available). Every other format is written by the
# kernel module ``pliego.export.<format>``; a format whose module is not importable is not offered
# (``available_formats``), so the API can never advertise what the kernel cannot write.
RUNNER_FORMATS = ("fold", "svg", "dxf", "pdf", "hpgl", "glb")


class CartridgeError(Exception):
    def __init__(self, kind: str, detail: str):
        super().__init__(detail)
        self.kind, self.detail = kind, detail


def available_formats() -> tuple[str, ...]:
    """Formats this runner can emit with the installed kernel (``fold`` always)."""
    import importlib.util

    out = ["fold"]
    for fmt in RUNNER_FORMATS[1:]:
        try:
            if importlib.util.find_spec(f"pliego.export.{fmt}") is not None:
                out.append(fmt)
        except (ImportError, ValueError):
            continue
    return tuple(out)


def harden(timeout_s: float) -> None:
    """OS-level limits for this process (best effort; each skip is reported on stderr)."""
    if sys.platform.startswith("linux"):
        try:
            import ctypes

            pr_set_dumpable = 4
            if ctypes.CDLL(None, use_errno=True).prctl(pr_set_dumpable, 0, 0, 0, 0) != 0:
                raise OSError(ctypes.get_errno(), "prctl failed")
        except (OSError, AttributeError) as exc:
            print(f"runner: PR_SET_DUMPABLE unavailable: {exc}", file=sys.stderr)
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        cpu = int(timeout_s) + 5
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 5))
        resource.setrlimit(resource.RLIMIT_FSIZE, (64 << 20, 64 << 20))
        if sys.platform.startswith("linux"):
            mem = int(os.environ.get("PLIEGO_RUNNER_MAX_AS_MB", "2048")) << 20
            resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except (ImportError, ValueError, OSError) as exc:
        print(f"runner: resource limits partially unavailable: {exc}", file=sys.stderr)


def import_kernel():
    try:
        import pliego
    except ImportError as exc:
        raise CartridgeError("kernel-missing",
                             f"the pliego kernel is not importable: {exc}") from exc
    return pliego


def load_stocks(pliego, assembly, materials: str) -> dict:
    """Stock snapshots for every sheet, from the committed ``materials/<slug>/stock.json``."""
    import pliego.stock as stock_mod

    stocks: dict = {}
    for sheet in assembly.sheets:
        slug = getattr(sheet, "stock", None)
        if not isinstance(slug, str):
            raise CartridgeError("stock", f"sheet {getattr(sheet, 'id', '?')!r} has no stock id")
        if slug not in stocks:
            try:
                stocks[slug] = stock_mod.load_snapshot(slug, materials or None)
            except Exception as exc:  # noqa: BLE001 — StockError, a missing materials dir …
                raise CartridgeError("stock", f"stock {slug!r}: {exc}") from None
    return stocks


def to_document(pliego, result, meta: dict, materials: str = ""):
    """Turn the cartridge's ``result`` into a stamped ``pliego.Document`` carrying ``meta``.

    A Sheet becomes a one-sheet Assembly; an Assembly is built with the committed stock snapshots;
    a Document gets the runner's cartridge/mode/params written into ``pliego:meta`` and re-stamped
    (the runner, not the script, is the authority on provenance)."""
    document_cls, sheet_cls, assembly_cls = pliego.Document, pliego.Sheet, pliego.Assembly
    if result is None:
        raise CartridgeError("no-result", "the cartridge did not assign `result`")
    if not isinstance(result, (sheet_cls, assembly_cls, document_cls)):
        raise CartridgeError("bad-result", "`result` must be a pliego.Sheet, pliego.Assembly or "
                             f"pliego.Document, got {type(result).__name__}")
    if isinstance(result, document_cls):
        doc = result.copy()
        current = doc.data.get("pliego:meta")
        doc.data["pliego:meta"] = {**(current if isinstance(current, dict) else {}), **meta}
        return doc.stamp()
    if isinstance(result, sheet_cls):
        result = assembly_cls([result])
    return result.build(stocks=load_stocks(pliego, result, materials), **meta)


def doc_counts(doc_json: dict) -> dict:
    return {
        "sheets": len(doc_json.get("pliego:sheets") or []),
        "vertices": len(doc_json.get("vertices_coords") or []),
        "edges": len(doc_json.get("edges_vertices") or []),
        "faces": len(doc_json.get("faces_vertices") or []),
        "joins": len(doc_json.get("pliego:joins") or []),
    }


def verify_line(counts: dict, errors: int, warnings: int) -> str:
    c = counts
    return (f"verify: sheets={c['sheets']} vertices={c['vertices']} edges={c['edges']} "
            f"faces={c['faces']} joins={c['joins']} errors={errors} warnings={warnings}")


def export_bytes(pliego, doc, fmt: str, doc_text: str) -> bytes:
    if fmt == "fold":
        return doc_text.encode("utf-8")
    import importlib

    module = importlib.import_module(f"pliego.export.{fmt}")
    func = getattr(module, f"to_{fmt}", None)
    if not callable(func):
        raise CartridgeError("kernel-api", f"pliego.export.{fmt} exposes no to_{fmt}(document)")
    out = func(doc)
    return out.encode("utf-8") if isinstance(out, str) else bytes(out)


def execute(script_path: str, params: dict, meta: dict, materials: str = ""):
    """Run the cartridge in the sandbox and return the kernel Document."""
    pliego = import_kernel()
    try:
        real = validate_script_path(script_path, {".py"})
        source = read_script(real)
        check_source(source, real)
    except (ValueError, OSError) as exc:  # PolicyError is a ValueError
        kind = "policy" if isinstance(exc, PolicyError) else "script"
        raise CartridgeError(kind, str(exc)) from exc
    builtins_ = build_sandbox_builtins(LABEL)
    builtins_["__import__"] = make_allowlist_import(make_restricted_import(LABEL))
    env = {"__builtins__": builtins_, "__name__": "__main__",
           "pliego": SafeModule(pliego), "math": SafeModule(math)}
    for key, value in params.items():
        if not key.isidentifier() or key.startswith("_") or key in env or key == "result":
            raise CartridgeError("params", f"parameter name {key!r} is not allowed")
        env[key] = value
    try:
        code = compile(source, real, "exec", dont_inherit=True)
        with contextlib.redirect_stdout(sys.stderr):
            exec(code, env)  # noqa: S102 — sandboxed: policy-checked, restricted builtins
    except CartridgeError:
        raise
    except BaseException as exc:  # noqa: BLE001 — report every cartridge failure, fail closed
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise CartridgeError("cartridge", f"cartridge tried to exit: {exc!r}") from None
        raise CartridgeError("cartridge", f"{type(exc).__name__}: {exc}") from None
    try:
        return pliego, to_document(pliego, env.get("result"), meta, materials)
    except CartridgeError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise CartridgeError("document", f"{type(exc).__name__}: {exc}") from None


def run(script: str, out_dir: Path, params: dict, formats: list[str], meta: dict,
        materials: str = "") -> int:
    counts = {"sheets": 0, "vertices": 0, "edges": 0, "faces": 0, "joins": 0}
    issues: list[dict] = []
    doc = doc_text = pliego = None
    unknown = [f for f in formats if f not in RUNNER_FORMATS]
    if unknown:
        issues.append({"level": "error", "kind": "format", "detail": f"unsupported {unknown}"})
    else:
        try:
            pliego, doc = execute(script, params, meta, materials)
            raw_issues = list(doc.verify())
            issues.extend(i if isinstance(i, dict) else {"level": "error", "kind": "verify",
                                                          "detail": str(i)} for i in raw_issues)
            doc_text = doc.to_json()
            if isinstance(doc_text, bytes):
                doc_text = doc_text.decode("utf-8")
            counts = doc_counts(json.loads(doc_text))
        except CartridgeError as exc:
            issues.append({"level": "error", "kind": exc.kind, "detail": exc.detail})
        except Exception as exc:  # noqa: BLE001 — a kernel failure is still a reported failure
            issues.append({"level": "error", "kind": "kernel",
                           "detail": f"{type(exc).__name__}: {exc}"})
    if doc_text is not None and counts["sheets"] == 0:
        issues.append({"level": "error", "kind": "empty", "detail": "the document has 0 sheets"})

    written: list[str] = []
    if not any(i.get("level") == "error" for i in issues):
        try:
            (out_dir / "document.fold").write_text(doc_text, encoding="utf-8")
            for fmt in formats:
                (out_dir / f"export.{fmt}").write_bytes(export_bytes(pliego, doc, fmt, doc_text))
                written.append(fmt)
        except CartridgeError as exc:
            issues.append({"level": "error", "kind": exc.kind, "detail": exc.detail})
        except Exception as exc:  # noqa: BLE001
            issues.append({"level": "error", "kind": "export",
                           "detail": f"{type(exc).__name__}: {exc}"})

    errors = sum(1 for i in issues if i.get("level") == "error")
    warnings = len(issues) - errors
    line = verify_line(counts, errors, warnings)
    print(line, flush=True)
    for issue in issues:
        print(f"  [{issue.get('level')}] {issue.get('kind')}: {issue.get('detail')}",
              file=sys.stderr)
    report = {"verify": line, "counts": counts, "errors": errors, "warnings": warnings,
              "issues": issues, "formats": written}
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, default=str),
                                         encoding="utf-8")
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("script")
    ap.add_argument("out_dir")
    ap.add_argument("--params", default="{}")
    ap.add_argument("--params-stdin", action="store_true")
    ap.add_argument("--formats", default="")
    ap.add_argument("--cartridge", default="")
    ap.add_argument("--mode", default="default")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--kernel-path", default="", help="a source checkout's packages/kernel/src")
    ap.add_argument("--materials", default="", help="the materials/ directory (stock cards)")
    args = ap.parse_args(argv)
    harden(args.timeout)
    if args.kernel_path:
        if not Path(args.kernel_path).is_dir():
            print(f"runner: --kernel-path {args.kernel_path} is not a directory", file=sys.stderr)
            return 2
        sys.path.insert(0, str(Path(args.kernel_path).resolve()))
    out_dir = Path(args.out_dir)
    if not out_dir.is_dir():
        print(f"runner: out_dir {out_dir} is not a directory", file=sys.stderr)
        return 2
    try:
        params = json.loads(sys.stdin.read() if args.params_stdin else args.params)
    except json.JSONDecodeError as exc:
        print(f"runner: params are not JSON: {exc}", file=sys.stderr)
        params = None
    if not isinstance(params, dict):
        print(verify_line({"sheets": 0, "vertices": 0, "edges": 0, "faces": 0, "joins": 0}, 1, 0))
        return 1
    formats = [f for f in args.formats.split(",") if f]
    meta = {"cartridge": args.cartridge or Path(args.script).resolve().parent.name,
            "mode": args.mode, "params": params}
    if args.materials:
        os.environ["PLIEGO_MATERIALS"] = args.materials
    return run(args.script, out_dir, params, formats, meta, args.materials)


if __name__ == "__main__":
    sys.exit(main())
