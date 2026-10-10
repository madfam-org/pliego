#!/usr/bin/env python3
"""Doctrine gates for Pliego, checked at AST level where the doctrine is about code.

1. **No solid modeler.** No Python import of cadquery, OCP, OCC, build123d, trimesh, pythonocc
   or pymadcad, and no JS import of opencascade.js, replicad or manifold-3d, anywhere under
   ``packages/`` or ``apps/``. Solids live in Yantra4D (``hardware_ref``).
2. **AI only through Selva.** No import of a provider SDK (anthropic, google.generativeai,
   google.genai, mistralai, cohere, ollama, litellm, groq). ``openai`` is allowed only in a module
   that also reads ``SELVA_BASE_URL`` (the OpenAI-compatible Selva ``/v1`` gateway). No provider
   API host literal and no provider key env name anywhere in code, manifests or env templates.
3. **No prices.** No price-like key (``price*``, ``cost``, ``msrp``, ``currency`` ...) in any stock
   card (``materials/*/stock.json``) or commons manifest (``projects/*/project.json``).
4. **Licence.** Every commons manifest declares ``project.attribution.license`` and
   ``hyperobject.commons_license``; both agree and equal CERN-OHL-W-2.0 unless the slug has a
   carve-out row in ``docs/licenses/CARVE-OUTS.md`` with that licence. ``attribution.lineage`` is a
   list. Every stock card's ``provenance.license`` is the commons licence. No ``LICENSE`` or
   ``COPYING`` file at any depth inside a cartridge.

Read-proof: prints how many files each gate scanned. Scanning zero source files is a failure.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

COMMONS_LICENSE = "CERN-OHL-W-2.0"
CODE_ROOTS = ("packages", "apps")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache", ".ruff_cache"}

SOLID_PY = {"cadquery", "OCP", "OCC", "build123d", "trimesh", "pythonocc", "pymadcad"}
SOLID_JS = {"opencascade.js", "replicad", "manifold-3d", "occt-import-js"}
PROVIDER_PY = {"anthropic", "mistralai", "cohere", "ollama", "litellm", "groq", "google.generativeai", "google.genai"}
PROVIDER_HOSTS = (
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.mistral.ai",
    "api.cohere.ai",
    "api.groq.com",
)
PROVIDER_KEYS = re.compile(
    r"\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|MISTRAL_API_KEY|"
    r"COHERE_API_KEY|GROQ_API_KEY|DEEPINFRA_API_KEY|TOGETHER_API_KEY|FIREWORKS_API_KEY)\b"
)
JS_IMPORT = re.compile(
    r"""(?:\bimport\s+(?:[^'"]*?\sfrom\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]"""
)
PRICE_KEY = re.compile(r"(price|msrp|retail|wholesale)", re.IGNORECASE)
PRICE_EXACT = {"cost", "unit_cost", "currency", "mxn", "usd", "amount"}
TEXT_EXTS = {".py", ".js", ".mjs", ".cjs", ".ts", ".json", ".yaml", ".yml", ".toml", ".txt", ".html", ".env", ".example"}


def iter_files(root: Path, base: str, exts: set[str]) -> list[Path]:
    start = root / base
    if not start.is_dir():
        return []
    out = []
    for path in sorted(start.rglob("*")):
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        if path.is_file() and path.suffix in exts:
            out.append(path)
    return out


def py_imports(source: str) -> set[str]:
    """Every module name a Python source imports (dotted, plus each dotted prefix)."""
    names: set[str] = set()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        mods: list[str] = []
        if isinstance(node, ast.Import):
            mods = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
        elif (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", None) == "__import__"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            mods = [node.args[0].value]
        for mod in mods:
            parts = mod.split(".")
            names.update(".".join(parts[: i + 1]) for i in range(len(parts)))
    return names


def py_strings(source: str) -> list[str]:
    return [n.value for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def js_specifiers(source: str) -> set[str]:
    out = set()
    for spec in JS_IMPORT.findall(source):
        out.add(spec)
        out.add(spec.split("/")[0] if not spec.startswith("@") else "/".join(spec.split("/")[:2]))
    return out


def check_code(root: Path, errors: list[str]) -> tuple[int, int]:
    py_files = [p for base in CODE_ROOTS for p in iter_files(root, base, {".py"})]
    js_files = [p for base in CODE_ROOTS for p in iter_files(root, base, {".js", ".mjs", ".cjs", ".ts"})]
    for path in py_files:
        rel = path.relative_to(root)
        src = path.read_text(encoding="utf-8", errors="replace")
        try:
            imports = py_imports(src)
            strings = py_strings(src)
        except SyntaxError as exc:
            errors.append(f"{rel}: cannot parse ({exc.msg}, line {exc.lineno}); a gate that cannot read is a failure")
            continue
        for mod in sorted(imports & SOLID_PY):
            errors.append(f"{rel}: imports solid modeler `{mod}` (solids live in Yantra4D via hardware_ref)")
        for mod in sorted(imports & PROVIDER_PY):
            errors.append(f"{rel}: imports LLM provider SDK `{mod}` (AI only through the Selva gateway)")
        if "openai" in imports and "SELVA_BASE_URL" not in src:
            errors.append(f"{rel}: imports `openai` without reading SELVA_BASE_URL (must target the Selva gateway)")
        for s in strings:
            for host in PROVIDER_HOSTS:
                if host in s:
                    errors.append(f"{rel}: provider API host `{host}` (AI only through the Selva gateway)")
    for path in js_files:
        rel = path.relative_to(root)
        specs = js_specifiers(path.read_text(encoding="utf-8", errors="replace"))
        for spec in sorted(specs & SOLID_JS):
            errors.append(f"{rel}: imports solid modeler `{spec}` (solids live in Yantra4D via hardware_ref)")
    return len(py_files), len(js_files)


def check_text_leaks(root: Path, errors: list[str]) -> int:
    """Provider key env names and API hosts in code, manifests, deploy config and env templates."""
    targets = [p for base in CODE_ROOTS + ("infra",) for p in iter_files(root, base, TEXT_EXTS)]
    targets += [root / n for n in ("enclii.yaml", ".env.example", "Dockerfile") if (root / n).is_file()]
    for path in targets:
        rel = path.relative_to(root)
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in sorted(set(PROVIDER_KEYS.findall(text))):
            errors.append(f"{rel}: provider key name `{match}` (provider credentials live only on Selva)")
        if path.suffix != ".py":  # .py strings were checked through the AST above
            for host in PROVIDER_HOSTS:
                if host in text:
                    errors.append(f"{rel}: provider API host `{host}` (AI only through the Selva gateway)")
    return len(targets)


def price_keys(node: object, trail: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{trail}.{key}" if trail else str(key)
            if PRICE_KEY.search(str(key)) or str(key).lower() in PRICE_EXACT:
                found.append(here)
            found.extend(price_keys(value, here))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found.extend(price_keys(value, f"{trail}[{i}]"))
    return found


def load_carve_outs(root: Path) -> dict[str, str]:
    path = root / "docs" / "licenses" / "CARVE-OUTS.md"
    rows: dict[str, str] = {}
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = [c.strip().strip("`") for c in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0] and cells[0] != "slug" and not set(cells[0]) <= {"-", ":"}:
            rows[cells[0]] = cells[1]
    return rows


def load_json(path: Path, root: Path, errors: list[str]) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        errors.append(f"{path.relative_to(root)}: unreadable JSON ({exc})")
        return None


def check_manifests(root: Path, errors: list[str]) -> int:
    carve = load_carve_outs(root)
    manifests = sorted(p for p in (root / "projects").glob("*/project.json") if p.is_file())
    for path in manifests:
        rel, slug = path.relative_to(root), path.parent.name
        data = load_json(path, root, errors)
        if not isinstance(data, dict):
            continue
        for key in price_keys(data):
            errors.append(f"{rel}: price-like field `{key}` (quotes come from Cotiza; prices are never in a manifest)")
        project = data.get("project") if isinstance(data.get("project"), dict) else {}
        attribution = project.get("attribution") if isinstance(project.get("attribution"), dict) else {}
        hyper = data.get("hyperobject") if isinstance(data.get("hyperobject"), dict) else {}
        a_lic, h_lic = attribution.get("license"), hyper.get("commons_license")
        if not a_lic or not h_lic:
            errors.append(f"{rel}: needs both project.attribution.license and hyperobject.commons_license")
        elif a_lic != h_lic:
            errors.append(f"{rel}: licence fields disagree ({a_lic!r} vs {h_lic!r})")
        else:
            expected = carve.get(slug, COMMONS_LICENSE)
            if a_lic != expected:
                errors.append(f"{rel}: licence {a_lic!r} != {expected!r} and no carve-out row for `{slug}`")
        if not isinstance(attribution.get("lineage"), list):
            errors.append(f"{rel}: project.attribution.lineage must be a list (empty means original work)")
        for stray in sorted(path.parent.rglob("*")):
            if stray.is_file() and stray.name.split(".")[0].upper() in {"LICENSE", "LICENCE", "COPYING"}:
                errors.append(f"{stray.relative_to(root)}: no per-cartridge licence file (the commons LICENSE covers it)")
    return len(manifests)


def check_stock_cards(root: Path, errors: list[str]) -> int:
    cards = sorted(p for p in (root / "materials").glob("*/stock.json") if p.is_file())
    for path in cards:
        rel = path.relative_to(root)
        data = load_json(path, root, errors)
        if not isinstance(data, dict):
            continue
        for key in price_keys(data):
            errors.append(f"{rel}: price-like field `{key}` (stock cards carry physics, never prices)")
        provenance = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        if provenance.get("license") != COMMONS_LICENSE:
            errors.append(f"{rel}: provenance.license must be {COMMONS_LICENSE} (got {provenance.get('license')!r})")
    return len(cards)


def run(root: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    py_n, js_n = check_code(root, errors)
    counts = {
        "py_files": py_n,
        "js_files": js_n,
        "text_files": check_text_leaks(root, errors),
        "manifests": check_manifests(root, errors),
        "stock_cards": check_stock_cards(root, errors),
    }
    if py_n + js_n == 0:
        errors.append("scanned 0 source files under packages/ and apps/ — refusing to pass on an empty read")
    return errors, counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)
    errors, counts = run(Path(args.root).resolve())
    print("compliance: " + " ".join(f"{k}={v}" for k, v in counts.items()) + f" errors={len(errors)}")
    if counts["manifests"] == 0:
        print("  note: 0 commons manifests read (projects/ unmounted or empty); the pin guard owns that verdict")
    for err in errors:
        print(f"  FAIL {err}")
    print("compliance: " + ("FAIL" if errors else "OK"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
