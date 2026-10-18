"""Rules 40–41: laminate stocks (spec §5.40–§5.41) and hardware references (§5.42)."""

from __future__ import annotations

import math
from typing import Any

from . import hardware
from .laminate import LAMINATE_BASIS


def _mat3(m: Any) -> bool:
    return (isinstance(m, list) and len(m) == 3 and all(
        isinstance(r, list) and len(r) == 3 and all(
            isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x)
            for x in r) for r in m))


def rule40_laminates(d: dict, out: Any) -> None:
    """A laminate snapshot is complete and self-consistent; only a laminate says it is one."""
    for slug, snap in (d.get("pliego:stocks") or {}).items():
        if not isinstance(snap, dict):
            continue
        lam = snap.get("laminate")
        is_basis = snap.get("derived_basis") == LAMINATE_BASIS
        if lam is None:
            if is_basis:
                out.err(40, "laminate", f"stock {slug!r} says {LAMINATE_BASIS!r} but carries no "
                        "laminate block", stock=slug)
            continue
        if not is_basis:
            out.err(40, "laminate", f"stock {slug!r} carries a laminate block but its "
                    f"derived_basis is {snap.get('derived_basis')!r}", stock=slug)
        layers = lam.get("layers") if isinstance(lam, dict) else None
        if not isinstance(layers, list) or not layers:
            out.err(40, "laminate", f"stock {slug!r}: laminate.layers must be non-empty",
                    stock=slug)
            continue
        for k, layer in enumerate(layers):
            kinds = [x for x in ("stock", "material_ref") if isinstance(layer, dict) and x in layer]
            if len(kinds) != 1:
                out.err(40, "laminate", f"stock {slug!r} layer {k}: exactly one of stock, "
                        "material_ref", stock=slug)
        try:
            total = sum(float(x["thickness_mm"]) for x in layers)
        except (KeyError, TypeError, ValueError):
            out.err(40, "laminate", f"stock {slug!r}: every layer needs thickness_mm", stock=slug)
            continue
        thickness = (snap.get("derived") or {}).get("thickness")
        for name, value in (("derived.thickness", thickness), ("caliper_mm",
                                                               snap.get("caliper_mm"))):
            if not isinstance(value, int | float) or not math.isclose(total, value,
                                                                       rel_tol=1e-5):
                out.err(40, "laminate", f"stock {slug!r}: layers add up to {total:g} mm, "
                        f"{name} is {value!r}", stock=slug)
        if not all(_mat3(lam.get(k)) for k in ("A", "B", "D")):
            out.err(40, "laminate", f"stock {slug!r}: A, B and D must be 3 × 3 numbers",
                    stock=slug)
            continue
        nonzero = any(x != 0 for row in lam["B"] for x in row)
        if lam.get("coupled") is not nonzero:
            out.err(40, "laminate", f"stock {slug!r}: coupled={lam.get('coupled')!r} disagrees "
                    "with B", stock=slug)
        gov = lam.get("governing_layer")
        if not isinstance(gov, int) or not 0 <= gov < len(layers) or "stock" not in (
                layers[gov] if isinstance(layers[gov], dict) else {}):
            out.err(40, "laminate", f"stock {slug!r}: governing_layer must index a Pliego stock "
                    "layer", stock=slug)


def rule41_hardware(d: dict, out: Any) -> None:
    """Every join hardware_ref resolves name-level in the vendored yantra4d snapshot."""
    refs = hardware.document_refs(d)
    if not refs:
        return
    parts = hardware.catalog()
    for where, ref in refs:
        for problem in hardware.ref_problems(ref, None, parts, where):
            out.err(41, "hardware_ref", problem)
