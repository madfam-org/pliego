"""Every render is a GOC-1 generator instance: response headers, ``variables.json`` and the bundle.

``services/engine/generator_output.py`` holds the contract's algorithms; this module applies them to
an API render (Fashion Cabinet's ``apps/api/render.py`` shape):

- every ``/documents`` and ``/exports`` response carries ``X-Generator-Instance-Id``,
  ``X-Generator-Variables-Sha256`` and ``X-Generator-Complete``;
- ``X-Generator-Dropped-Params`` / ``X-Generator-Clamped-Params`` report parameters a platform
  dropped or clamped. Pliego's API never does either — an unknown, invalid or out-of-range value
  is a 400 (manifest.resolve_request) — so they are absent by contract; the seam exists so the
  headers mean the same thing on every platform;
- ``format: "bundle"`` on ``/exports`` answers a deterministic zip: the sheet document, the cut
  files and ``variables.json``, whose ``geometry`` stamps the sha256 and size of every member. The
  zip itself is digest-stamped twice: its file name carries the instance id, and ``Repr-Digest``
  (RFC 9530) the sha256 of the zip bytes.
"""

from __future__ import annotations

import base64
import hashlib
import io
import sys
import zipfile
from dataclasses import dataclass
from urllib.parse import quote

from .manifest import Cartridge, Mode
from .render import RUNNER, TRANSPORT

sys.path.insert(0, str(RUNNER.parent))
import generator_output as goc  # noqa: E402

GENERATOR_HEADERS = (
    "X-Generator-Instance-Id", "X-Generator-Variables-Sha256", "X-Generator-Complete",
    "X-Generator-Dropped-Params", "X-Generator-Clamped-Params",
)
BUNDLE = "bundle"
BUNDLE_MEDIA_TYPE = "application/zip"
# The bundle's default members besides the document: the cut and plot files.
CUT_FORMATS = ("svg", "dxf", "pdf", "hpgl")
_ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class Provenance:
    """What the API knows about a render before the files exist."""

    cart: Cartridge
    mode: Mode
    variables: list
    legacy: dict
    tree_sha: str
    commons: str | None
    kernel: str | None


def provenance(cart: Cartridge, mode: Mode, requested: dict, effective: dict, *,
               commons: str | None, kernel: str | None) -> Provenance:
    variables, legacy = goc.variables_for(cart.parameters, requested, effective)
    return Provenance(cart, mode, variables, legacy, goc.tree_sha256(cart.directory), commons,
                      kernel)


def file_name(cart: Cartridge, mode: Mode, fmt: str) -> str:
    return f"{cart.slug}-{mode.id}.{TRANSPORT[fmt][1]}"


def _role(fmt: str) -> str:
    return {"fold": "primary", "glb": "viewer"}.get(fmt, "auxiliary")


def document(prov: Provenance, files: list[tuple[str, bytes]]) -> dict:
    """The GOC-1 document for ``files`` (``(format, bytes)``, in order)."""
    geometry = [goc.geometry_entry(file_name(prov.cart, prov.mode, fmt), TRANSPORT[fmt][0], data,
                                   "primary" if len(files) == 1 else _role(fmt))
                for fmt, data in files]
    script = prov.mode.script
    project = prov.cart.manifest.get("project") or {}
    return goc.build_document(
        cartridge=prov.cart.slug, mode=prov.mode.id, variables=prov.variables,
        tree_sha=prov.tree_sha, geometry=geometry, legacy=prov.legacy,
        cartridge_version=project.get("version"), commons=prov.commons, kernel=prov.kernel,
        entry=script.name, entry_sha256=goc.sha256_hex(script.read_bytes()))


def _header_list(items) -> str:
    text = ",".join(quote(str(item), safe="=_-.") for item in items)
    return text if len(text) <= 1024 else text[:1020] + ",..."


def headers(doc: dict, dropped: dict | None = None, clamped=()) -> dict[str, str]:
    out = {
        "X-Generator-Instance-Id": doc["instance_id"],
        "X-Generator-Variables-Sha256": doc["variables_sha256"],
        "X-Generator-Complete": "true" if doc["complete"] else "false",
    }
    if dropped:
        out["X-Generator-Dropped-Params"] = _header_list(
            f"{key}={reason}" for key, reason in sorted(dropped.items()))
    if clamped:
        out["X-Generator-Clamped-Params"] = _header_list(sorted(clamped))
    return out


def bundle_formats(requested, published: list[str]) -> tuple[str, ...]:
    """The bundle's file formats besides the document; raises ValueError with the reason."""
    if requested is None:
        chosen = tuple(f for f in published if f in CUT_FORMATS)
        if not chosen:
            raise ValueError(f"no cut format to bundle (publishes: {published or 'none'})")
        return chosen
    if not isinstance(requested, list) or not requested or \
            not all(isinstance(f, str) for f in requested):
        raise ValueError("'bundle_formats' must be a non-empty array of format names")
    out: list[str] = []
    for fmt in requested:
        if fmt == "fold":
            continue  # the document is always in the bundle
        if fmt not in published:
            raise ValueError(f"cannot bundle format {fmt!r} (publishes: {published or 'none'})")
        if fmt not in out:
            out.append(fmt)
    if not out:
        raise ValueError("'bundle_formats' names no file besides the document")
    return tuple(out)


def bundle(prov: Provenance, document_bytes: bytes, exports: dict[str, bytes],
           formats: tuple[str, ...]) -> tuple[bytes, dict, str]:
    """(zip bytes, GOC-1 document, file name). Members: the document, ``formats`` in order, then
    ``variables.json``; fixed timestamps and permissions, so the same render zips to the same
    bytes."""
    files = [("fold", document_bytes)] + [(f, exports[f]) for f in formats]
    doc = document(prov, files)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        members = [(file_name(prov.cart, prov.mode, f), data) for f, data in files]
        members.append(("variables.json", goc.serialize_document(doc)))
        for name, data in members:
            info = zipfile.ZipInfo(name, date_time=_ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    name = f"{prov.cart.slug}-{prov.mode.id}-{doc['instance_id'][:12]}.zip"
    return buf.getvalue(), doc, name


def repr_digest(data: bytes) -> str:
    """RFC 9530 ``Repr-Digest`` value: ``sha-256=:<base64>:``."""
    return f"sha-256=:{base64.b64encode(hashlib.sha256(data).digest()).decode('ascii')}:"
