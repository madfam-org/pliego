"""``hardware_ref`` from a sheet cartridge to a Yantra4D solid, checked name-level (spec §5.42).

A cartridge may name a printed part it needs — a magnetic clasp, a brad, a stand — by
``hardware_ref`` (``{platform: "yantra4d", project_slug, mode?, linked, params_map?}``, the shape
Fashion Cabinet's notion uses; the keystone's ``docs/BRIDGE_HANDSHAKE.md``). Pliego never models
the solid. It checks the reference **name-level**, the bridge handshake's rule 1, against a
vendored, version-pinned slice of Yantra4D's published ``docs/commons-catalog.json``
(``pliego/data/yantra4d-hardware.snapshot.json``, refreshed by
``scripts/qa/refresh_hardware_snapshot.py`` with the upstream commit recorded):

- the slug exists in the snapshot (an unknown slug is an error, never a skip);
- ``mode``, when given, is one of the part's modes;
- every ``params_map`` key is a parameter of the part, and every value parses as an expression
  (literals, arithmetic and ``round``/``ceil``/``floor``/``int``/``min``/``max``/``abs``) that
  reads only this cartridge's own parameters. Expressions are parsed, never evaluated.

The physical half of the handshake (render the part at the mapped values, check it fits) needs
the solid kernel and stays in Yantra4D's and the keystone's tooling; it is out of scope here.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

SNAPSHOT_FILE = Path(__file__).resolve().parent / "data" / "yantra4d-hardware.snapshot.json"
CATALOG_SCHEMA = "commons_catalog_v1"
SAFE_MAP_FUNCS = frozenset({"round", "ceil", "floor", "int", "min", "max", "abs"})
_ALLOWED_NODES = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
                  ast.Call, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
                  ast.USub, ast.UAdd)
_CACHE: dict[str, dict] = {}


def catalog(path: Path | str | None = None) -> dict[str, dict]:
    """The vendored Yantra4D slice: slug → {parameter_ids, mode_ids, …}."""
    p = Path(path) if path is not None else SNAPSHOT_FILE
    key = str(p)
    if key not in _CACHE:
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("catalog_schema_version") != CATALOG_SCHEMA or not isinstance(
                data.get("cartridges"), dict):
            raise ValueError(f"{p}: not a {CATALOG_SCHEMA} hardware snapshot")
        _CACHE[key] = data["cartridges"]
    return _CACHE[key]


def _expr_names(expr: str) -> set[str]:
    tree = ast.parse(str(expr), mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise SyntaxError(f"{type(node).__name__} is not allowed")
        if isinstance(node, ast.Call):
            if not (isinstance(node.func, ast.Name) and node.func.id in SAFE_MAP_FUNCS) or \
                    node.keywords:
                raise SyntaxError("only round/ceil/floor/int/min/max/abs may be called")
        if isinstance(node, ast.Constant) and (isinstance(node.value, bool)
                                               or not isinstance(node.value, int | float)):
            raise SyntaxError("only numeric literals are allowed")
    called = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and id(n) not in called}
    return names


def ref_problems(ref: Any, param_ids: set[str] | None = None,
                 parts: dict[str, dict] | None = None, where: str = "hardware_ref") -> list[str]:
    """Name-level problems of one ``hardware_ref`` (empty list = it resolves)."""
    if not isinstance(ref, dict):
        return [f"{where}: must be an object"]
    if ref.get("platform") != "yantra4d":
        return [f"{where}: platform {ref.get('platform')!r} (expected 'yantra4d')"]
    slug = ref.get("project_slug")
    if not slug:
        return [f"{where}: project_slug is empty"] if ref.get("linked", True) else []
    parts = catalog() if parts is None else parts
    part = parts.get(slug)
    if part is None:
        return [f"{where}: project_slug {slug!r} is not in the vendored yantra4d snapshot "
                f"(known: {', '.join(sorted(parts)) or 'none'}); refresh it with "
                "scripts/qa/refresh_hardware_snapshot.py"]
    problems = []
    modes = part.get("mode_ids") or []
    if ref.get("mode") is not None and ref["mode"] not in modes:
        problems.append(f"{where}: mode {ref['mode']!r} is not a mode of yantra4d {slug!r} "
                        f"(has: {', '.join(modes) or 'none'})")
    target = set(part.get("parameter_ids") or [])
    pmap = ref.get("params_map") or {}
    if not isinstance(pmap, dict):
        return problems + [f"{where}.params_map must be an object"]
    for key, value in sorted(pmap.items()):
        if key not in target:
            problems.append(f"{where}.params_map key {key!r} is not a parameter of yantra4d "
                            f"{slug!r} (has: {', '.join(sorted(target))})")
        try:
            names = _expr_names(value)
        except SyntaxError as exc:
            problems.append(f"{where}.params_map[{key!r}] = {value!r} is not a safe expression: "
                            f"{exc.msg if hasattr(exc, 'msg') and exc.msg else exc}")
            continue
        if param_ids is not None:
            for name in sorted(names - param_ids):
                problems.append(f"{where}.params_map[{key!r}] reads {name!r}, which is not a "
                                "parameter of this cartridge")
    return problems


def manifest_problems(manifest: dict, parts: dict[str, dict] | None = None) -> tuple[int, list[str]]:
    """(references checked, problems) for a cartridge manifest's top-level ``hardware_ref``."""
    ref = manifest.get("hardware_ref") if isinstance(manifest, dict) else None
    if ref is None:
        return 0, []
    params = {p["id"] for p in manifest.get("parameters") or []
              if isinstance(p, dict) and isinstance(p.get("id"), str)}
    return 1, ref_problems(ref, params, parts)


def document_refs(d: dict) -> list[tuple[str, dict]]:
    """(where, hardware_ref) of every join that carries one."""
    return [(f"join {j.get('id')!r} hardware_ref", j["hardware_ref"])
            for j in d.get("pliego:joins") or []
            if isinstance(j, dict) and isinstance(j.get("hardware_ref"), dict)]
