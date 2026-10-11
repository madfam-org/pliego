"""The prerendered tier's storage: renders made at image build time, read-only at run time.

Layout under one directory (``build/prerender``; ``/app/build/prerender`` in the image):

- ``keys/<key>.json`` — one entry per runtime cache key (``render_cache.RenderCache.key``, the very
  function a request uses, so an identical request finds it): the verify line, the runner's report,
  the render seconds and the ``parts`` (``[name, sha256, bytes]``: ``document`` and
  ``export:<format>``);
- ``blobs/<sha256>`` — the part bytes, content-addressed: the document of one render is stored once
  and shared by the entries that carry it (the document alone, each cut file, the bundle set);
- ``index.json`` — what the build produced and what it could not (``prerender.py``).

A read verifies everything it returns: the entry names its own key, every blob has the length and
sha256 the entry claims. Anything else (missing, truncated, corrupt, foreign) is ``None`` with a
reason, and the caller falls through to the normal render path. Nothing here ever writes at run time.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path

from .render import RenderResult

_KEY = re.compile(r"^[0-9a-f]{64}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")


class PrerenderStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def available(self) -> bool:
        return (self.directory / "keys").is_dir()

    def count(self) -> int:
        """Entries in the store (read-only at run time, so counted once)."""
        if getattr(self, "_count", None) is None:
            keys = self.directory / "keys"
            self._count = sum(1 for _ in keys.glob("*.json")) if keys.is_dir() else 0
        return self._count

    # ── read (run time) ──────────────────────────────────────────────────────
    def get(self, key: str) -> tuple[RenderResult | None, str]:
        """(result, "") on a verified hit; (None, "missing") or (None, "invalid: <why>")."""
        if not _KEY.match(key):
            return None, "missing"
        path = self.directory / "keys" / f"{key}.json"
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return None, "missing"
        except OSError as exc:
            return None, f"invalid: {exc.strerror or exc}"
        try:
            head = json.loads(raw.decode("utf-8"))
            if not isinstance(head, dict) or head.get("key") != key:
                return None, "invalid: the entry names another key"
            document, exports = None, {}
            for name, digest, length in head["parts"]:
                if not isinstance(digest, str) or not _SHA.match(digest):
                    return None, "invalid: malformed digest"
                data = (self.directory / "blobs" / digest).read_bytes()
                if len(data) != length or hashlib.sha256(data).hexdigest() != digest:
                    return None, f"invalid: blob {digest[:12]} does not match its digest"
                if name == "document":
                    document = data
                elif isinstance(name, str) and name.startswith("export:"):
                    exports[name[len("export:"):]] = data
                else:
                    return None, f"invalid: unknown part {name!r}"
            if document is None:
                return None, "invalid: no document"
            return RenderResult(document, exports, str(head["verify"]), dict(head["report"]),
                                float(head["seconds"])), ""
        except FileNotFoundError:
            return None, "invalid: a blob is missing"
        except (OSError, ValueError, KeyError, TypeError, UnicodeDecodeError) as exc:
            return None, f"invalid: {type(exc).__name__}"

    # ── write (image build only) ─────────────────────────────────────────────
    def put(self, key: str, result: RenderResult, formats: tuple[str, ...]) -> int:
        """Store ``result`` restricted to ``formats`` under ``key``; returns the new blob bytes."""
        if not _KEY.match(key):
            raise ValueError(f"not a cache key: {key!r}")
        parts = [("document", result.document)] + [(f"export:{f}", result.exports[f])
                                                   for f in formats]
        written = 0
        listed = []
        for name, data in parts:
            digest = hashlib.sha256(data).hexdigest()
            blob = self.directory / "blobs" / digest
            if not blob.exists():
                _write(blob, data)
                written += len(data)
            listed.append([name, digest, len(data)])
        report = dict(result.report, formats=list(formats))
        head = {"key": key, "verify": result.verify, "report": report,
                "seconds": round(result.seconds, 3), "parts": listed}
        _write(self.directory / "keys" / f"{key}.json",
               json.dumps(head, sort_keys=True, separators=(",", ":"), default=str).encode())
        return written


def _write(path: Path, data: bytes) -> None:
    """Write then rename (public build artefacts, process umask; the Dockerfile chmods a+rX)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
