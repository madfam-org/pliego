# Read-proof summary and verify-issue shape adapted from Fashion Cabinet fc/pattern.py (AGPL-3.0).
"""`Document` — the in-memory sheet document (FOLD 1.2 + ``pliego:``; spec v1).

A `Document` wraps the JSON object itself, so ``from_json(to_json(d)) == d`` by construction.
Serialisation is canonical (GOC-1 §3.1: sorted keys, compact separators, UTF-8, no NaN) and
therefore byte-stable; numbers are already on the emit grid when the kernel writes them.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

KERNEL_VERSION = "0.1.0"
KERNEL_ID = f"pliego-kernel {KERNEL_VERSION}"
PER_VERTEX = ("vertices_coords", "pliego:vertices_sheet")
PER_EDGE = ("edges_vertices", "edges_assignment", "edges_foldAngle", "pliego:edges_sheet",
            "pliego:edges_treatment", "pliego:edges_restAngle", "edges_length")
PER_FACE = ("faces_vertices", "pliego:faces_sheet", "faces_edges")


def canonical_json(obj: Any) -> bytes:
    """GOC-1 §3.1 canonical JSON, UTF-8 encoded."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


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
        """``sha256:`` of the canonical serialisation with ``pliego:meta.digest`` set to null."""
        data = copy.deepcopy(self.data)
        meta = data.get("pliego:meta")
        if isinstance(meta, dict):
            meta["digest"] = None
        return "sha256:" + hashlib.sha256(canonical_json(data)).hexdigest()

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

    def verify(self, min_face_area_mm2: float = 1.0) -> list[dict]:
        """All semantic rules of spec §8 → issue dicts ``{level, kind, detail, …}``; [] = OK."""
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
