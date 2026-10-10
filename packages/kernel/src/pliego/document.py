# Read-proof summary and verify-issue shape adapted from Fashion Cabinet fc/pattern.py (AGPL-3.0).
"""`Document` — the in-memory sheet document (FOLD 1.2 + ``pliego:``; spec v1).

A `Document` wraps the JSON object itself, so ``from_json(to_json(d)) == d`` by construction.
`to_json` is stable (sorted keys, compact separators, UTF-8, no NaN — GOC-1 §3.1 style) and
therefore byte-stable; numbers are already on the emit grid when the kernel writes them. The
digest (spec §5.15) hashes `canonical_bytes` instead — RFC 8785 JCS, the form a JavaScript
reader reproduces exactly — so it does not depend on Python's number spelling.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

KERNEL_VERSION = "0.2.0"
KERNEL_ID = f"pliego-kernel {KERNEL_VERSION}"
PER_VERTEX = ("vertices_coords", "pliego:vertices_sheet")
PER_EDGE = ("edges_vertices", "edges_assignment", "edges_foldAngle", "pliego:edges_sheet",
            "pliego:edges_treatment", "pliego:edges_restAngle", "pliego:edges_name",
            "edges_length")
PER_FACE = ("faces_vertices", "pliego:faces_sheet", "faces_edges")


def canonical_json(obj: Any) -> bytes:
    """GOC-1 §3.1 canonical JSON, UTF-8 encoded."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


# ── canonical serialisation for pliego:meta.digest (spec §5.15) ────────────────
#
# RFC 8785 (JSON Canonicalization Scheme): what `JSON.stringify` writes for the same value with
# object keys sorted by UTF-16 code units — so the engine (JS) and the kernel (Python) hash the
# same bytes. Numbers are IEEE-754 doubles printed as ECMAScript `Number.prototype.toString`
# does (5.0 → "5", 1e-06 → "0.000001", 1e21 → "1e+21", −0 → "0"); integers beyond ±2^53 and
# NaN/±Infinity are refused, as are strings with lone surrogates.

_MAX_SAFE = 2 ** 53


def _es_number(x: int | float) -> str:
    if isinstance(x, int):
        if abs(x) > _MAX_SAFE:
            raise ValueError(f"canonical JSON: integer {x} is not exactly representable")
        return str(x)
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError("canonical JSON: NaN and infinities are not JSON")
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    mant, _, exp = repr(abs(x)).partition("e")   # shortest round-trip digits
    whole, _, frac = mant.partition(".")
    digits = whole + frac
    lead = len(digits) - len(digits.lstrip("0"))
    n = len(whole) + int(exp or 0) - lead        # value = 0.D × 10^n
    d = digits.strip("0")
    k = len(d)
    if k <= n <= 21:
        out = d + "0" * (n - k)
    elif 0 < n <= 21:
        out = d[:n] + "." + d[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + d
    else:
        e = n - 1
        out = (d if k == 1 else d[0] + "." + d[1:]) + ("e+" if e >= 0 else "e-") + str(abs(e))
    return sign + out


def _es_string(s: str) -> str:
    if any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        raise ValueError("canonical JSON: string has a lone surrogate")
    return json.dumps(s, ensure_ascii=False)     # same escapes as JSON.stringify


def _jcs(obj: Any, out: list[str]) -> None:
    if obj is None:
        out.append("null")
    elif obj is True:
        out.append("true")
    elif obj is False:
        out.append("false")
    elif isinstance(obj, int | float):
        out.append(_es_number(obj))
    elif isinstance(obj, str):
        out.append(_es_string(obj))
    elif isinstance(obj, list | tuple):
        out.append("[")
        for i, v in enumerate(obj):
            if i:
                out.append(",")
            _jcs(v, out)
        out.append("]")
    elif isinstance(obj, dict):
        if not all(isinstance(k, str) for k in obj):
            raise ValueError("canonical JSON: object keys must be strings")
        out.append("{")
        for i, k in enumerate(sorted(obj, key=lambda k: k.encode("utf-16-be"))):
            if i:
                out.append(",")
            out.append(_es_string(k))
            out.append(":")
            _jcs(obj[k], out)
        out.append("}")
    else:
        raise ValueError(f"canonical JSON: {type(obj).__name__} is not a JSON value")


def canonical_bytes(obj: Any) -> bytes:
    """Spec §5.15: the canonical serialisation (RFC 8785 JCS), UTF-8 — what the digest hashes."""
    out: list[str] = []
    _jcs(obj, out)
    return "".join(out).encode("utf-8")


class Document:
    """A sheet document. `data` is the FOLD/pliego JSON object (dict)."""

    def __init__(self, data: dict):
        if not isinstance(data, dict):
            raise TypeError("Document data must be a JSON object")
        self.data = data

    # ── serialisation ───────────────────────────────────────────────────────

    def to_json(self, pretty: bool = False) -> str:
        """Canonical serialisation (byte-stable). `pretty` indents but keeps sorted keys."""
        if pretty:
            return json.dumps(self.data, sort_keys=True, indent=1, ensure_ascii=False,
                              allow_nan=False) + "\n"
        return canonical_json(self.data).decode("utf-8")

    def to_bytes(self) -> bytes:
        return canonical_json(self.data)

    @classmethod
    def from_json(cls, text: str | bytes) -> Document:
        """Parse a sheet document (or a plain FOLD file — see `pliego.foldfile.load`)."""
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("a sheet document is a JSON object")
        return cls(data)

    def copy(self) -> Document:
        return Document(copy.deepcopy(self.data))

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Document) and canonical_json(self.data) == canonical_json(
            other.data)

    def __hash__(self) -> int:
        return hash(canonical_json(self.data))

    # ── digest (spec §5.7) ──────────────────────────────────────────────────

    def digest(self) -> str:
        """``sha256:`` of the canonical serialisation (spec §5.15, `canonical_bytes`) with
        ``pliego:meta.digest`` set to null."""
        data = dict(self.data)
        meta = data.get("pliego:meta")
        if isinstance(meta, dict):
            data["pliego:meta"] = {**meta, "digest": None}
        return "sha256:" + hashlib.sha256(canonical_bytes(data)).hexdigest()

    def stamp(self) -> Document:
        """Write the digest into ``pliego:meta.digest`` (in place) and return self."""
        meta = self.data.setdefault("pliego:meta", {"kernel": KERNEL_ID})
        meta["digest"] = self.digest()
        return self

    # ── accessors ───────────────────────────────────────────────────────────

    def count(self, key: str) -> int:
        value = self.data.get(key)
        return len(value) if isinstance(value, list) else 0

    @property
    def sheets(self) -> list[dict]:
        return list(self.data.get("pliego:sheets") or [])

    def sheet_index(self, sheet_id: str) -> int:
        for i, s in enumerate(self.sheets):
            if s.get("id") == sheet_id:
                return i
        raise KeyError(f"document has no sheet '{sheet_id}'")

    def frame(self, title: str) -> dict | None:
        for f in self.data.get("file_frames") or []:
            if isinstance(f, dict) and f.get("frame_title") == title:
                return f
        return None

    def sheet_vertices(self, sheet: int) -> list[int]:
        return [i for i, s in enumerate(self.data.get("pliego:vertices_sheet") or [])
                if s == sheet]

    def sheet_edges(self, sheet: int) -> list[int]:
        return [i for i, s in enumerate(self.data.get("pliego:edges_sheet") or []) if s == sheet]

    def sheet_faces(self, sheet: int) -> list[int]:
        return [i for i, s in enumerate(self.data.get("pliego:faces_sheet") or []) if s == sheet]

    # ── verification ────────────────────────────────────────────────────────

    def verify(self, min_face_area_mm2: float | None = None) -> list[dict]:
        """All semantic rules of spec §8 → issue dicts ``{level, kind, detail, …}``; [] = OK.

        The face-area floor of rule 3 is `min_face_area_mm2` when given, else
        ``pliego:meta.min_feature_mm``² when the document declares it, else 1 mm²."""
        from .document_verify import verify_document

        return verify_document(self, min_face_area_mm2=min_face_area_mm2)

    def summary(self, issues: list[dict] | None = None) -> str:
        """Read-proof line: ``verify: sheets=N vertices=V edges=E faces=F joins=J errors=E
        warnings=W`` (``sheets=0`` is itself a failure)."""
        if issues is None:
            issues = self.verify()
        errors = sum(1 for i in issues if i.get("level") == "error")
        warnings = sum(1 for i in issues if i.get("level") == "warning")
        return (f"verify: sheets={self.count('pliego:sheets')} "
                f"vertices={self.count('vertices_coords')} edges={self.count('edges_vertices')} "
                f"faces={self.count('faces_vertices')} joins={self.count('pliego:joins')} "
                f"errors={errors} warnings={warnings}")

    def report(self) -> dict:
        """Machine-readable summary: counts, per-sheet stats, issues and the read-proof line."""
        issues = self.verify()
        per_sheet = []
        for i, s in enumerate(self.sheets):
            asg = [self.data["edges_assignment"][e] for e in self.sheet_edges(i)]
            per_sheet.append({
                "id": s.get("id"), "stock": s.get("stock"),
                "vertices": len(self.sheet_vertices(i)), "edges": len(asg),
                "faces": len(self.sheet_faces(i)),
                "assignments": {k: asg.count(k) for k in "BMVFUCJ" if asg.count(k)},
            })
        return {"line": self.summary(issues), "sheets": per_sheet, "issues": issues,
                "ok": not any(i.get("level") == "error" for i in issues)
                and self.count("pliego:sheets") > 0}

    def __repr__(self) -> str:
        return (f"Document(sheets={self.count('pliego:sheets')}, "
                f"vertices={self.count('vertices_coords')}, edges={self.count('edges_vertices')},"
                f" faces={self.count('faces_vertices')})")
