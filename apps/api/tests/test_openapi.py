"""apps/api/openapi.json describes exactly the routes the app serves under /api/v1 plus /health and
/ready (the verify_openapi pattern; scripts/qa/verify_openapi.py checks /api/v1 in CI).

JSON rather than YAML: the CI job has no YAML parser and the scaffold's gate reads openapi.json
first (a YAML draft of this file already lost two descriptions to flow-mapping commas)."""

from __future__ import annotations

import json
import re
from pathlib import Path

OPENAPI = Path(__file__).resolve().parents[1] / "openapi.json"
METHODS = {"get", "post", "put", "patch", "delete"}


def documented_operations() -> set[tuple[str, str]]:
    spec = json.loads(OPENAPI.read_text(encoding="utf-8"))
    return {(path, method.upper()) for path, item in spec["paths"].items()
            for method in item if method in METHODS}


def served_operations(app) -> set[tuple[str, str]]:
    ops = set()
    for rule in app.url_map.iter_rules():
        if not (rule.rule.startswith("/api/v1/") or rule.rule in ("/health", "/ready")):
            continue
        path = re.sub(r"<(?:[^:<>]+:)?([^<>]+)>", r"{\1}", rule.rule)
        for method in rule.methods - {"HEAD", "OPTIONS"}:
            ops.add((path, method))
    return ops


def test_openapi_matches_url_map(app):
    documented = documented_operations()
    served = served_operations(app)
    print(f"openapi: documented={len(documented)} served={len(served)}")
    assert documented, "scanned zero operations in openapi.json"
    assert served - documented == set(), f"served but undocumented: {served - documented}"
    assert documented - served == set(), f"documented but not served: {documented - served}"


def test_openapi_has_no_null_artifacts():
    def walk(node, where="$"):
        if isinstance(node, dict):
            for key, value in node.items():
                assert value is not None, f"null at {where}.{key}"
                walk(value, f"{where}.{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{where}[{i}]")

    spec = json.loads(OPENAPI.read_text(encoding="utf-8"))
    assert spec["openapi"].startswith("3.1")
    walk(spec)
