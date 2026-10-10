"""Verify rules for what viewers read (split out of `document_verify` for the file-size gate).

Rule 17 (§5.16): a sheet's `presentation` names a root face on that sheet and a rigid end
transform. Rule 18 (§5.17): printed art (`front.art` / `back.art`) is a relative path or a
sanitised `data:image/svg+xml` / `data:image/png` URI.
"""

from __future__ import annotations

import base64
import binascii
import math
import re
import urllib.parse
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


# ── rule 18: printed art sources (§5.17) ─────────────────────────────────────

MAX_ART_BYTES = 1 << 20          # decoded payload of a data-URI image
_DATA = re.compile(r"^data:image/(svg\+xml|png)((?:;[a-zA-Z0-9_-]+=[a-zA-Z0-9_.-]+)*)(;base64)?,",
                   re.S)
_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_SVG_BANNED = (
    (re.compile(r"<\s*script", re.I), "<script>"),
    (re.compile(r"foreignobject", re.I), "foreignObject"),
    (re.compile(r"javascript\s*:", re.I), "javascript: URL"),
    (re.compile(r"<!\s*(entity|doctype)", re.I), "DOCTYPE/ENTITY declaration"),
    (re.compile(r"[\s\"'/;]on[a-z]+\s*=", re.I), "event-handler attribute"),
    (re.compile(r"@import", re.I), "@import"),
)
_REF = re.compile(r"(?:\bhref|\bsrc)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)|url\(\s*([^)]*)\)", re.I)
_PNG = b"\x89PNG\r\n\x1a\n"


def _internal_ref(value: str) -> bool:
    v = value.strip().strip("\"'").strip()
    return v.startswith("#") or v.lower().startswith(("data:image/png", "data:image/jpeg"))


def check_art(src: Any) -> str | None:
    """Why `src` is not an acceptable `front.art` / `back.art` (§5.17), or None when it is: a
    relative path inside the cartridge, or a `data:image/svg+xml` / `data:image/png` URI whose
    payload decodes, stays under MAX_ART_BYTES and — for SVG — has no script, event handler,
    foreignObject, javascript: URL, DOCTYPE/ENTITY, @import or reference outside itself."""
    if src is None:
        return None
    if not isinstance(src, str) or not src:
        return "art must be a non-empty string or null"
    m = _DATA.match(src)
    if m is None:
        if src[:5].lower() == "data:":
            return "data-URI art must be data:image/svg+xml or data:image/png"
        if _SCHEME.match(src) or src.startswith(("/", "\\")) or "\\" in src \
                or ".." in src.split("/"):
            return "art must be a relative path inside the cartridge or an image data URI"
        return None
    kind, b64, body = m.group(1), m.group(3), src[m.end():]
    if kind == "png" and not b64:
        return "data:image/png art must be base64"
    try:
        raw = (base64.b64decode(body, validate=True) if b64
               else urllib.parse.unquote_to_bytes(body))
    except (ValueError, binascii.Error):
        return "data-URI art payload does not decode"
    if len(raw) > MAX_ART_BYTES:
        return f"data-URI art is {len(raw)} bytes (limit {MAX_ART_BYTES})"
    if kind == "png":
        return None if raw.startswith(_PNG) else "data:image/png art is not a PNG"
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "data:image/svg+xml art is not UTF-8"
    if "<svg" not in text.lower():
        return "data:image/svg+xml art has no <svg> element"
    for rx, what in _SVG_BANNED:
        if rx.search(text):
            return f"SVG art contains a {what}"
    for g1, g2 in _REF.findall(text):
        if not _internal_ref(g1 or g2):
            return f"SVG art references {(g1 or g2)[:60]!r} outside itself"
    return None


def rule18_art(d: dict, out) -> None:
    for i, s in enumerate(d["pliego:sheets"]):
        if not isinstance(s, dict):
            continue
        for side in ("front", "back"):
            face = s.get(side)
            why = check_art(face.get("art")) if isinstance(face, dict) else None
            if why:
                out.err(18, "art_source", f"sheet {s.get('id')!r} {side}.art: {why}", sheet=i)
