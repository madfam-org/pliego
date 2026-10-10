"""Cartridge manifests (``projects/<slug>/project.json``): structural checks and strict parameters.

The keystone (``pliego-spec`` in hyperobjects-spec) owns the full sheet-manifest schema; this module
checks exactly what the API relies on, and fails closed: a manifest that does not pass is excluded
from the catalog (and counted), never half-served.

Parameters follow the commons convention shared with Fashion Cabinet and Yantra4D:
``{"id", "type": "slider"|"number"|"integer"|"select"|"checkbox"|"text", "default", "min", "max",
"step", "options": [{"value", "label"}], "modes": [...]}``.

Request validation is strict: unknown keys are rejected, values are type-checked against the
manifest (no bool-as-number, no NaN, in range, on step, one of the options), and an omitted mode is
accepted only when the cartridge has exactly one. Omitted parameters take the manifest's declared
default — that is the cartridge's published contract — and the effective values are what the runner
receives (and what the document's ``pliego:meta.params`` records).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PARAM_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MODE_ID_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
SCRIPT_RE = re.compile(r"^[a-z0-9_][a-z0-9_-]*\.py$")
# Names a parameter may not take: they would shadow the sandbox's injected names.
RESERVED_PARAMS = frozenset({"pliego", "math", "result", "param", "print"})
PARAM_TYPES = ("slider", "number", "integer", "select", "checkbox", "text")
TEXT_MAX = 200
STEP_TOL = 1e-6


class ManifestError(ValueError):
    pass


class PayloadError(ValueError):
    """A request payload that does not satisfy the cartridge's contract (HTTP 400)."""


@dataclass(frozen=True)
class Mode:
    id: str
    script: Path
    label: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Cartridge:
    slug: str
    directory: Path
    manifest: dict
    modes: tuple[Mode, ...]
    parameters: tuple[dict, ...]
    export_formats: tuple[str, ...]

    def mode(self, mode_id: str) -> Mode | None:
        return next((m for m in self.modes if m.id == mode_id), None)


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _same(a, b) -> bool:
    """Equality without bool/number confusion (``True`` is not ``1``; ``2`` is ``2.0``)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_number(a) and _is_number(b):
        return a == b
    return type(a) is type(b) and a == b


def _check_value(spec: dict, value, *, where: str) -> None:
    """Raise PayloadError unless ``value`` satisfies the parameter ``spec``."""
    pid, ptype = spec["id"], spec["type"]
    if ptype in ("slider", "number", "integer"):
        if not _is_number(value):
            raise PayloadError(f"{where}: parameter {pid!r} must be a finite number")
        if ptype == "integer" and not (isinstance(value, int) or float(value).is_integer()):
            raise PayloadError(f"{where}: parameter {pid!r} must be an integer")
        lo, hi = spec.get("min"), spec.get("max")
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            raise PayloadError(f"{where}: parameter {pid!r}={value} is outside [{lo}, {hi}]")
        step = spec.get("step")
        if step:
            base = lo if lo is not None else 0
            k = (value - base) / step
            if abs(k - round(k)) > STEP_TOL * max(1.0, abs(k)):
                raise PayloadError(f"{where}: parameter {pid!r}={value} is not on step {step} "
                                   f"from {base}")
    elif ptype == "select":
        allowed = [o["value"] for o in spec["options"]]
        if not any(_same(value, a) for a in allowed):
            raise PayloadError(f"{where}: parameter {pid!r} must be one of {allowed}")
    elif ptype == "checkbox":
        if not isinstance(value, bool):
            raise PayloadError(f"{where}: parameter {pid!r} must be true or false")
    elif ptype == "text":
        limit = spec.get("max_length", TEXT_MAX)
        if not isinstance(value, str) or len(value) > limit or "\x00" in value:
            raise PayloadError(f"{where}: parameter {pid!r} must be a string of at most "
                               f"{limit} characters")


def _parse_parameter(raw, mode_ids: set[str]) -> dict:
    if not isinstance(raw, dict):
        raise ManifestError("parameter entries must be objects")
    pid = raw.get("id")
    if not isinstance(pid, str) or not PARAM_ID_RE.match(pid) or pid in RESERVED_PARAMS:
        raise ManifestError(f"invalid parameter id {pid!r}")
    ptype = raw.get("type")
    if ptype not in PARAM_TYPES:
        raise ManifestError(f"parameter {pid!r}: type must be one of {PARAM_TYPES}")
    if "default" not in raw:
        raise ManifestError(f"parameter {pid!r}: a default is required")
    for key in ("min", "max", "step"):
        if key in raw and raw[key] is not None and not _is_number(raw[key]):
            raise ManifestError(f"parameter {pid!r}: {key} must be a number")
    if raw.get("step") is not None and raw["step"] <= 0:
        raise ManifestError(f"parameter {pid!r}: step must be positive")
    if ptype == "select":
        options = raw.get("options")
        if not isinstance(options, list) or not options or not all(
                isinstance(o, dict) and "value" in o for o in options):
            raise ManifestError(f"parameter {pid!r}: select needs a non-empty options list")
    restricted = raw.get("modes")
    if restricted is not None and (not isinstance(restricted, list)
                                   or not set(restricted) <= mode_ids):
        raise ManifestError(f"parameter {pid!r}: modes must list declared mode ids")
    try:
        _check_value(raw, raw["default"], where="manifest default")
    except PayloadError as exc:
        raise ManifestError(str(exc)) from exc
    return raw


def parse_cartridge(directory: Path, doc) -> Cartridge:
    """Validate a parsed project.json for the cartridge directory, or raise ManifestError."""
    slug = directory.name
    if not SLUG_RE.match(slug):
        raise ManifestError(f"directory {slug!r} is not a kebab-case slug")
    if not isinstance(doc, dict):
        raise ManifestError("project.json must be an object")
    project = doc.get("project")
    if not isinstance(project, dict):
        raise ManifestError("missing 'project' object")
    if project.get("slug") != slug:
        raise ManifestError(f"project.slug {project.get('slug')!r} does not match directory")
    name = project.get("name")
    if not (isinstance(name, dict) and isinstance(name.get("en"), str) and name["en"].strip()):
        raise ManifestError("project.name must be an i18n object with 'en'")
    tags = project.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ManifestError("project.tags must be a list of strings")

    raw_modes = doc.get("modes")
    if raw_modes is None:
        raw_modes = [{"id": "default", "script_file": "main.py"}]
    if not isinstance(raw_modes, list) or not raw_modes:
        raise ManifestError("modes must be a non-empty list")
    modes: list[Mode] = []
    for raw in raw_modes:
        if not isinstance(raw, dict):
            raise ManifestError("mode entries must be objects")
        mid, script = raw.get("id"), raw.get("script_file", "main.py")
        if not isinstance(mid, str) or not MODE_ID_RE.match(mid):
            raise ManifestError(f"invalid mode id {mid!r}")
        if any(m.id == mid for m in modes):
            raise ManifestError(f"duplicate mode id {mid!r}")
        if not isinstance(script, str) or not SCRIPT_RE.match(script):
            raise ManifestError(f"mode {mid!r}: script_file must be a plain .py file name")
        path = directory / script
        if not path.is_file() or path.is_symlink():
            raise ManifestError(f"mode {mid!r}: {script} is missing")
        modes.append(Mode(mid, path, raw.get("label") or {}))

    raw_params = doc.get("parameters", [])
    if not isinstance(raw_params, list):
        raise ManifestError("parameters must be a list")
    mode_ids = {m.id for m in modes}
    params = tuple(_parse_parameter(p, mode_ids) for p in raw_params)
    ids = [p["id"] for p in params]
    if len(ids) != len(set(ids)):
        raise ManifestError("duplicate parameter ids")

    formats = doc.get("export_formats", [])
    if not isinstance(formats, list) or not all(isinstance(f, str) for f in formats):
        raise ManifestError("export_formats must be a list of strings")
    hyper = doc.get("hyperobject", {})
    if not isinstance(hyper, dict):
        raise ManifestError("hyperobject must be an object")
    return Cartridge(slug, directory, doc, tuple(modes), params, tuple(formats))


def resolve_request(cart: Cartridge, mode_id, params) -> tuple[Mode, dict]:
    """Validate a request's mode and params against the cartridge; return (mode, effective)."""
    if mode_id is None:
        if len(cart.modes) != 1:
            raise PayloadError(f"'mode' is required: {cart.slug!r} has modes "
                               f"{[m.id for m in cart.modes]}")
        mode = cart.modes[0]
    else:
        if not isinstance(mode_id, str):
            raise PayloadError("'mode' must be a string")
        mode = cart.mode(mode_id)
        if mode is None:
            raise PayloadError(f"unknown mode {mode_id!r} (modes: {[m.id for m in cart.modes]})")
    if not isinstance(params, dict):
        raise PayloadError("'params' must be an object")
    specs = {p["id"]: p for p in cart.parameters}
    unknown = sorted(set(params) - set(specs))
    if unknown:
        raise PayloadError(f"unknown parameter(s) {unknown} for {cart.slug!r}")
    effective: dict = {}
    for pid, spec in specs.items():
        allowed_modes = spec.get("modes")
        applies = allowed_modes is None or mode.id in allowed_modes
        if pid in params:
            if not applies:
                raise PayloadError(f"parameter {pid!r} does not apply to mode {mode.id!r}")
            _check_value(spec, params[pid], where="params")
            effective[pid] = params[pid]
        elif applies:
            effective[pid] = spec["default"]
    return mode, effective
