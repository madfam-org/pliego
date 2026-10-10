#!/usr/bin/env python3
"""The committed OpenAPI document must describe exactly the routes the Flask app serves.

Imports `apps.api.app:app` (a Flask application), lists its URL rules, and compares
(method, path) pairs with `apps/api/openapi.json` (or `openapi.yaml` when PyYAML is installed).
Flask `<int:id>` converters are normalised to OpenAPI `{id}`. HEAD and OPTIONS, the `static`
endpoint, and routes outside `--prefix` (default `/api/v1`) are ignored.

Exits 2 with a `skip:` line when `apps/api/app.py` does not exist yet (the CI step treats that as
a printed skip), 1 on drift, 0 when both sides agree. Zero routes compared is a failure.
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
from pathlib import Path

IGNORED_METHODS = {"HEAD", "OPTIONS"}
CONVERTER = re.compile(r"<(?:[a-zA-Z_]+(?:\([^)]*\))?:)?([a-zA-Z_][a-zA-Z0-9_]*)>")


def flask_routes(app, prefix: str) -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for rule in app.url_map.iter_rules():
        if rule.endpoint == "static" or not str(rule.rule).startswith(prefix):
            continue
        path = CONVERTER.sub(r"{\1}", str(rule.rule))
        for method in rule.methods or ():
            if method not in IGNORED_METHODS:
                routes.add((method.upper(), path))
    return routes


def spec_routes(spec: dict, prefix: str) -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    base = ""
    servers = spec.get("servers") or []
    if servers and isinstance(servers[0], dict):
        url = str(servers[0].get("url", ""))
        base = url if url.startswith("/") else ""
    for path, item in (spec.get("paths") or {}).items():
        full = (base.rstrip("/") + path) if base else path
        if not full.startswith(prefix) or not isinstance(item, dict):
            continue
        for method in item:
            if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                routes.add((method.upper(), full))
    return routes


def load_spec(api_dir: Path) -> dict | None:
    js, ym = api_dir / "openapi.json", api_dir / "openapi.yaml"
    if js.is_file():
        return json.loads(js.read_text(encoding="utf-8"))
    if ym.is_file():
        import yaml  # only needed for a YAML spec

        return yaml.safe_load(ym.read_text(encoding="utf-8"))
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--prefix", default="/api/v1")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    api_dir = root / "apps" / "api"
    if not (api_dir / "app.py").is_file():
        print("skip: apps/api/app.py does not exist yet; no routes to compare")
        return 2
    spec = load_spec(api_dir)
    if spec is None:
        print("openapi: FAIL apps/api has an app but no openapi.json / openapi.yaml")
        return 1
    sys.path.insert(0, str(root))
    app = importlib.import_module("apps.api.app").app
    served, documented = flask_routes(app, args.prefix), spec_routes(spec, args.prefix)
    missing = sorted(served - documented)
    stale = sorted(documented - served)
    print(f"openapi: served={len(served)} documented={len(documented)} undocumented={len(missing)} stale={len(stale)}")
    for method, path in missing:
        print(f"  FAIL served but undocumented: {method} {path}")
    for method, path in stale:
        print(f"  FAIL documented but not served: {method} {path}")
    if not served:
        print("openapi: FAIL 0 routes under the prefix — refusing to pass on an empty read")
        return 1
    print("openapi: " + ("FAIL" if missing or stale else "OK"))
    return 1 if missing or stale else 0


if __name__ == "__main__":
    sys.exit(main())
