"""Spec §5.18–§5.20, rules 19–21 (wave 3 lane E): keyed mechanisms, step-activated joins and
untying, checked the way the engine's `loadDocument` checks them (fail closed)."""

from __future__ import annotations

import math
from typing import Any

KEYED = ("hinge", "rotate", "leaf", "translate", "slide")
RIDE = ("hinge", "rotate", "translate")
GATED = ("glue", "pivot", "string", "pin")


def _num(x: Any) -> bool:
    return isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x)


def _step_index(steps: list, ref: Any) -> int:
    if isinstance(ref, int) and not isinstance(ref, bool):
        return ref if 0 <= ref < len(steps) else -2
    if isinstance(ref, str):
        return next((k for k, st in enumerate(steps)
                     if isinstance(st, dict) and st.get("id") == ref), -2)
    return -2


def rules19_21(d: dict, out) -> None:
    mechs = [m for m in d.get("pliego:mechanisms") or [] if isinstance(m, dict)]
    by_id = {m.get("id"): m for m in mechs}
    for m in mechs:
        where, t = f"mechanism {m.get('id')!r}", m.get("type")
        keys = m.get("keys")
        if keys is not None:
            if t not in KEYED:
                out.err(19, "keys_type", f"{where}: type {t!r} cannot carry keys")
            elif not (isinstance(keys, list) and len(keys) >= 2 and all(
                    isinstance(k, list) and len(k) == 2 and _num(k[0]) and _num(k[1])
                    for k in keys)):
                out.err(19, "keys_table", f"{where}: keys must list ≥ 2 [control value, output] "
                        "pairs")
            else:
                if any(keys[i][0] <= keys[i - 1][0] for i in range(1, len(keys))):
                    out.err(19, "keys_order", f"{where}: key control values must increase strictly")
                travel = m.get("travel")
                if t in ("translate", "slide") and _num(travel):
                    lo = 0.0 if t == "slide" else -travel
                    if any(not lo - 1e-9 <= y <= travel + 1e-9 for _, y in keys):
                        out.err(19, "keys_travel", f"{where}: a key output lies outside "
                                f"[{lo:g}, {travel:g}] mm")
        if "period" in m:
            p = m["period"]
            if keys is None:
                out.err(19, "period", f"{where}: period needs keys")
            elif not (_num(p) and p > 0):
                out.err(19, "period", f"{where}: period must be > 0")
            elif isinstance(keys, list) and len(keys) >= 2 and all(
                    isinstance(k, list) and len(k) == 2 and _num(k[0]) for k in keys) \
                    and keys[-1][0] - keys[0][0] > p + 1e-9:
                out.err(19, "period", f"{where}: keys span more than one period")
        if "ride" in m:
            r = by_id.get(m["ride"])
            if t not in RIDE:
                out.err(19, "ride", f"{where}: type {t!r} cannot ride another mechanism")
            elif r is None or r.get("type") not in RIDE:
                out.err(19, "ride", f"{where}: ride {m['ride']!r} is not a hinge, rotate or "
                        "translate mechanism")
            else:
                seen, q = {m.get("id")}, r
                while q is not None:
                    if q.get("id") in seen:
                        out.err(19, "ride_cycle", f"{where}: rides form a cycle")
                        break
                    seen.add(q.get("id"))
                    q = by_id.get(q["ride"]) if "ride" in q else None

    seq = d.get("pliego:sequence") or {}
    steps = ([s for s in seq.get("steps") or [] if isinstance(s, dict)]
             if isinstance(seq, dict) else [])
    joins = {j.get("id"): j for j in d.get("pliego:joins") or [] if isinstance(j, dict)}
    for j in joins.values():
        if "active_from" not in j:
            continue
        where = f"join {j.get('id')!r}"
        if j.get("type") not in GATED:
            out.err(20, "active_from_type", f"{where}: type {j.get('type')!r} cannot carry "
                    "active_from")
        elif not steps:
            out.err(20, "active_from_program", f"{where}: active_from needs a fold program")
        elif _step_index(steps, j["active_from"]) < 0:
            out.err(20, "active_from_step", f"{where}: active_from {j['active_from']!r} is not "
                    "a step id or index of the program")
    released: dict[str, int] = {}
    for r, st in enumerate(steps):
        if "release_joins" not in st:
            continue
        where = f"step {st.get('id')!r}"
        ids = st["release_joins"]
        if not isinstance(ids, list):
            out.err(21, "release_joins", f"{where}: release_joins must be a list of join ids")
            continue
        for jid in ids:
            j = joins.get(jid)
            if j is None:
                out.err(21, "release_joins", f"{where}: release_joins names {jid!r}, which is "
                        "not a join")
            elif j.get("type") not in GATED:
                out.err(21, "release_joins", f"{where}: join {jid!r} is a {j.get('type')!r}, "
                        "which cannot be released")
            elif jid in released:
                out.err(21, "release_joins", f"{where}: join {jid!r} is already released at "
                        f"step {released[jid]}")
            else:
                released[jid] = r
                k = _step_index(steps, j["active_from"]) if "active_from" in j else -1
                if k >= 0 and r <= k:
                    out.err(21, "release_joins", f"{where}: join {jid!r} is released at or "
                            f"before the step that activates it ({k})")
