"""Verify rules for what viewers read (split out of `document_verify` for the file-size gate).

Rule 17 (§5.16): a sheet's `presentation` names a root face on that sheet and a rigid end
transform. Rule 18 (§5.17): printed art (`front.art` / `back.art`) is a relative path or a
sanitised `data:image/svg+xml` / `data:image/png` URI.
"""

from __future__ import annotations

import math
from typing import Any


def _num(x: Any) -> bool:
    return isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x)


def rule17_presentation(d: dict, out) -> None:
    nf = len(d["faces_vertices"])
    fs = d["pliego:faces_sheet"]
    for i, s in enumerate(d["pliego:sheets"]):
        pr = s.get("presentation") if isinstance(s, dict) else None
        if pr is None:
            continue
        where = f"sheet {s.get('id')!r} presentation"
        if not isinstance(pr, dict) or set(pr) - {"root_face", "end"}:
            out.err(17, "presentation", f"{where} must be {{root_face?, end?}}", sheet=i)
            continue
        if "root_face" in pr:
            f = pr["root_face"]
            if not (isinstance(f, int) and not isinstance(f, bool) and 0 <= f < nf
                    and fs[f] == i):
                out.err(17, "presentation_root", f"{where}: root_face {f!r} is not a face of "
                        "this sheet", sheet=i)
        if "end" in pr:
            e = pr["end"]
            o = e.get("origin") if isinstance(e, dict) else None
            q = e.get("rotation") if isinstance(e, dict) else None
            ok = (isinstance(o, list) and len(o) == 3 and all(_num(c) for c in o)
                  and isinstance(q, list) and len(q) == 4 and all(_num(c) for c in q)
                  and abs(math.sqrt(sum(c * c for c in q)) - 1.0) < 1e-6)
            if not ok:
                out.err(17, "presentation_end", f"{where}: end must be {{origin: [x, y, z], "
                        "rotation: unit quaternion [x, y, z, w]}", sheet=i)
