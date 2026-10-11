"""GOC-1 generator output (``variables.json``) for Pliego renders.

A generator instance is the file(s) a render produced plus ONE document that says exactly which
cartridge and mode produced them, with which inputs, on which engine, and the digest of every file.
The contract (GOC-1) and its JSON Schema (``generator-output.schema.json``, which enumerates kind
``sheet``, engine ``pliego`` and commons ``sheet-hyperobjects``) are owned by hyperobjects-spec;
this module is Pliego's producer and keeps no copy of the schema. It follows Fashion Cabinet's
``apps/api/services/engine/generator_output.py``; the algorithms must agree with the keystone's
``hyperobjects_schemas.generator_output`` byte for byte (apps/api/tests/test_generator_output.py
pins the keystone's golden vectors):

* canonical JSON (§3.1, v1.0.1) — every finite integral float with |x| < 2^53 becomes an int, then
  ``json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)``, UTF-8;
* ``variables_sha256`` (§3.2) — sha256 of the canonical JSON of ``[[id, value], ...]`` sorted by id
  (bytewise); provenance (``type``, ``source``, ``unit``) is excluded;
* ``tree_sha256`` (§3.3, ``hyperobjects-tree-v1``) — the digest of the cartridge directory;
* ``instance_id`` (§3.4) — sha256 of the canonical JSON of ``{cartridge, mode, part,
  tree_sha256, variables_sha256}``; ``kernel`` and ``platform_build`` are deliberately not inputs.

Pure standard library and deterministic (no ``created_at``).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath

FORMAT = "hyperobjects.generator-output"
FORMAT_VERSION = "1.0.1"
KIND = "sheet"
PLATFORM = "pliego"
ENGINE = "pliego"
COMMONS_REPO = "sheet-hyperobjects"
TREE_ALGORITHM = "hyperobjects-tree-v1"
UNITS = "mm"

# GOC-1 §4.4: physical keys never enter `variables` (they go to `legacy_physical_inputs`).
DENIED_IDS = frozenset({
    "target_material", "material_profile", "print_material", "filament_type", "infill",
    "infill_density", "infill_pattern", "layer_height", "first_layer_height",
    "nozzle_diameter", "nozzle_temperature", "nozzle_temp", "bed_temperature", "bed_temp",
    "print_speed", "wall_loops", "perimeters", "jerk", "acceleration", "fan_speed",
    "slicer_profile", "printer_profile",
})
DENIED_PREFIXES = ("mat_shrinkage_", "mat_clear_", "thermo_", "slicer_", "printer_", "filament_")

_TREE_SKIP_SEGMENTS = frozenset({".git", "__pycache__", "node_modules"})
_TREE_SKIP_SUFFIXES = frozenset({
    ".md", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf",
})
_INT_SAFE_LIMIT = 2**53


# ── §3 algorithms ────────────────────────────────────────────────────────────
def normalize_numbers(obj):
    """§3.1: integral floats (|x| < 2^53) become ints, recursively; booleans are left alone."""
    if isinstance(obj, float):
        if math.isfinite(obj) and obj.is_integer() and abs(obj) < _INT_SAFE_LIMIT:
            return int(obj)
        return obj
    if isinstance(obj, dict):
        return {k: normalize_numbers(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [normalize_numbers(v) for v in obj]
    return obj


def canonical_json(obj) -> bytes:
    return json.dumps(normalize_numbers(obj), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def variables_sha256(variables: list[dict]) -> str:
    pairs = sorted(([v["id"], v["value"]] for v in variables), key=lambda p: p[0].encode("utf-8"))
    return sha256_hex(canonical_json(pairs))


def instance_id(cartridge: str, mode: str, part: str | None, tree_sha: str,
                variables_sha: str) -> str:
    return sha256_hex(canonical_json({
        "cartridge": cartridge, "mode": mode, "part": part,
        "tree_sha256": tree_sha, "variables_sha256": variables_sha,
    }))


def tree_sha256(cartridge_dir: str | os.PathLike) -> str:
    """§3.3 ``hyperobjects-tree-v1``: every regular file under the cartridge (file symlinks
    followed, directory symlinks never), except ``.git``/``__pycache__``/``node_modules``
    segments, the root ``docs/`` and the non-geometry suffixes; one ``"<sha256>  <path>\\n"`` line
    per file, sorted bytewise by path, hashed."""
    root = Path(cartridge_dir)
    entries: list[tuple[bytes, str]] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = PurePosixPath(Path(dirpath).relative_to(root).as_posix())
        dirnames[:] = [d for d in dirnames if d not in _TREE_SKIP_SEGMENTS]
        if rel_dir.parts[:1] == ("docs",):
            dirnames[:] = []
            continue
        for name in filenames:
            rel = PurePosixPath(name) if rel_dir == PurePosixPath(".") else rel_dir / name
            if any(seg in _TREE_SKIP_SEGMENTS for seg in rel.parts):
                continue
            if rel.suffix.lower() in _TREE_SKIP_SUFFIXES:
                continue
            path = Path(dirpath) / name
            if not path.is_file():
                continue
            entries.append((rel.as_posix().encode("utf-8"), sha256_hex(path.read_bytes())))
    entries.sort(key=lambda e: e[0])
    lines = "".join(f"{digest}  {rel.decode('utf-8')}\n" for rel, digest in entries)
    return sha256_hex(lines.encode("utf-8"))


def is_physical(param_id: str) -> bool:
    return param_id in DENIED_IDS or param_id.startswith(DENIED_PREFIXES)


# ── the document ─────────────────────────────────────────────────────────────
def value_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


def declared_type(spec: dict) -> str:
    kind = spec.get("type")
    if kind in ("slider", "number", "integer"):
        return "number"
    if kind == "checkbox":
        return "boolean"
    if kind == "select":
        values = [o.get("value") for o in spec.get("options", []) if isinstance(o, dict)]
        if values and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            return "number"
    return "string"


def variables_for(parameters, requested: dict, effective: dict) -> tuple[list[dict], dict]:
    """(``variables``, ``legacy_physical_inputs``) for one render.

    Every declared parameter is recorded (§4.1, no mode scoping): ``request`` when the caller sent
    it, ``manifest_default`` when the API injected the manifest default, and ``source_default``
    (value ``null``) when the runner did not receive it at all (a parameter scoped to other modes),
    which makes ``complete`` false — honest, because the cartridge's own literal was in force."""
    variables: list[dict] = []
    legacy: dict = {}
    for spec in parameters:
        pid = spec["id"]
        if pid in effective:
            value, source = effective[pid], "request" if pid in requested else "manifest_default"
        else:
            value, source = None, "source_default"
        if is_physical(pid):
            if value is not None:
                legacy[pid] = value
            continue
        entry = {"id": pid, "value": value,
                 "type": value_type(value) if value is not None else declared_type(spec),
                 "source": source}
        if isinstance(spec.get("unit"), str) and spec["unit"]:
            entry["unit"] = spec["unit"]
        variables.append(entry)
    variables.sort(key=lambda v: v["id"].encode("utf-8"))
    return variables, legacy


def geometry_entry(path: str, media_type: str, data: bytes, role: str) -> dict:
    return {"path": path, "media_type": media_type, "sha256": sha256_hex(data),
            "bytes": len(data), "units": UNITS, "role": role}


def build_document(*, cartridge: str, mode: str, variables: list[dict], tree_sha: str,
                   geometry: list[dict], legacy: dict | None = None,
                   cartridge_version: str | None = None, commons: str | None = None,
                   kernel: str | None = None, entry: str | None = None,
                   entry_sha256: str | None = None) -> dict:
    var_sha = variables_sha256(variables)
    generator: dict = {
        "platform": PLATFORM,
        "cartridge": cartridge,
        "commons": {"repo": COMMONS_REPO},
        "mode": mode,
        "part": None,
        "engine": ENGINE,
        "source": {"tree_sha256": tree_sha, "tree_algorithm": TREE_ALGORITHM},
    }
    if commons:
        generator["commons"]["sha"] = commons
    if cartridge_version:
        generator["cartridge_version"] = str(cartridge_version)[:64]
    if kernel:
        generator["kernel"] = kernel[:200]
    if entry:
        generator["source"]["entry"] = entry
    if entry_sha256:
        generator["source"]["entry_sha256"] = entry_sha256
    doc: dict = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "kind": KIND,
        "generator": generator,
        "variables": variables,
        "variables_sha256": var_sha,
        "complete": all(v["source"] != "source_default" for v in variables),
        "geometry": geometry,
        "instance_id": instance_id(cartridge, mode, None, tree_sha, var_sha),
    }
    if legacy:
        doc["legacy_physical_inputs"] = dict(legacy)
    return doc


def serialize_document(doc: dict) -> bytes:
    """The ``variables.json`` bytes: sorted keys, two-space indent, UTF-8, trailing newline."""
    return (json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
            + "\n").encode("utf-8")
