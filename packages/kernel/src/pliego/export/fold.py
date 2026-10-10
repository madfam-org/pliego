"""``.fold`` writer: a sheet document is already a FOLD 1.2 file (``pliego:`` fields are legal
FOLD custom fields), so this is a thin wrapper over the document's own canonical serialisation.
"""

from __future__ import annotations

import json
from typing import Any

from ..document import canonical_json


def to_fold(doc: Any) -> str:
    """Return the FOLD text of a document.

    Objects with ``to_json()`` (``pliego.Document``) serialise themselves (canonical, byte-stable);
    a dict is written with the same canonical serialisation (``pliego.canonical_json``: sorted
    keys, compact, UTF-8); JSON text passes through.
    """
    if hasattr(doc, "to_json") and not isinstance(doc, (dict, str, bytes)):
        text = doc.to_json()
        return text if isinstance(text, str) else canonical_json(text).decode("utf-8")
    if isinstance(doc, bytes):
        doc = doc.decode("utf-8")
    if isinstance(doc, str):
        json.loads(doc)  # fail closed on invalid JSON
        return doc
    if not isinstance(doc, dict) or doc.get("file_spec") is None:
        raise ValueError("not a FOLD document (file_spec missing)")
    return canonical_json(doc).decode("utf-8")
