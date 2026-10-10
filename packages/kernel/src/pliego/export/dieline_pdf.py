"""Dieline profile → PDF 1.5: one 1:1 page, every layer an optional content group (named layer)
stroked in its own ``/Separation`` spot colour (CMYK alternate). Pure stdlib, byte-deterministic.
Artwork is drawn as a labelled frame (images are not embedded). Text is Helvetica (latin-1).
"""

from __future__ import annotations

import math
from typing import Any

from .dieline import ORDER, SPOTS, build

MM_TO_PT = 72.0 / 25.4
HATCH_MM = 2.0
_REGULAR = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.")


def _p(v: float) -> str:
    s = f"{v:.2f}"
    return "0.00" if s == "-0.00" else s


def _name(text: str) -> str:
    """A PDF name object (non-regular characters as #xx)."""
    return "/" + "".join(ch if ch in _REGULAR else f"#{ord(ch):02X}" for ch in text)


def _esc(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _hatch(pts: tuple, xy) -> str:
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    n = math.ceil(((x1 - x0) + (y1 - y0)) / HATCH_MM)
    lines = [f"{xy((x0 + k * HATCH_MM, y0))} m {xy((x0 + k * HATCH_MM - (y1 - y0), y1))} l"
             for k in range(1, n)]
    path = f"{xy(pts[0])} m " + " ".join(f"{xy(q)} l" for q in pts[1:]) + " h"
    return f"q {path} W n " + " ".join(lines) + " S Q\n" if lines else ""


def to_pdf(doc: Any) -> bytes:
    plan = build(doc)
    ox, oy, w, h = plan.canvas()
    k = MM_TO_PT

    def xy(p: tuple) -> str:
        return f"{_p((p[0] - ox) * k)} {_p((p[1] - oy) * k)}"

    used = [n for n in ORDER if plan.layers[n].polylines or plan.layers[n].texts]
    content = []
    for i, name in enumerate(used):
        lay = plan.layers[name]
        width = max(SPOTS[name][5], 0.1)
        content.append(f"/OC /OC{i} BDC\n/CS{i} CS 1 SCN /CS{i} cs {_p(width * k)} w [] 0 d "
                       "1 J 1 j\n")
        for pts, closed in lay.polylines:
            if name == "Glue" and closed:
                content.append(_hatch(pts, xy))
            ops = [f"{xy(pts[0])} m"] + [f"{xy(q)} l" for q in pts[1:]]
            content.append(" ".join(ops) + (" h S\n" if closed else " S\n"))
        for href, lo, (_iw, ih), _rot in lay.images:
            content.append(f"BT /F1 7 Tf 1 scn {xy((lo[0] + 2.0, lo[1] + ih / 2.0))} Td "
                           f"({_esc('artwork: ' + href)}) Tj ET\n")
        for at, text, size in lay.texts:
            content.append(f"BT /F1 {_p(size * k)} Tf 1 scn {xy(at)} Td ({_esc(text)}) Tj ET\n")
        content.append("EMC\n")
    stream = "".join(content).encode("cp1252", errors="replace")

    objects: list[bytes] = []
    n_layers = len(used)
    # 1 catalog, 2 pages, 3 font, 4 page, 5 content, then per layer: OCG, colour space
    ocg = [6 + 2 * i for i in range(n_layers)]
    cs = [7 + 2 * i for i in range(n_layers)]
    refs = " ".join(f"{o} 0 R" for o in ocg)
    objects.append(f"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [{refs}] "
                   f"/D << /Order [{refs}] /ON [{refs}] >> >> >>".encode())
    objects.append(b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                   b"/Encoding /WinAnsiEncoding >>")
    colorspaces = " ".join(f"/CS{i} {cs[i]} 0 R" for i in range(n_layers))
    props = " ".join(f"/OC{i} {ocg[i]} 0 R" for i in range(n_layers))
    objects.append((f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_p(w * k)} {_p(h * k)}] "
                    f"/Resources << /Font << /F1 3 0 R >> /ColorSpace << {colorspaces} >> "
                    f"/Properties << {props} >> >> /Contents 5 0 R >>").encode())
    objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream
                   + b"\nendstream")
    for name in used:
        spot, cmyk = SPOTS[name][0], SPOTS[name][1]
        objects.append(f"<< /Type /OCG /Name ({_esc(name)}) >>".encode())
        c1 = " ".join(_p(c) for c in cmyk)
        objects.append((f"[/Separation {_name(spot)} /DeviceCMYK << /FunctionType 2 "
                        f"/Domain [0 1] /C0 [0 0 0 0] /C1 [{c1}] /N 1 >>]").encode())
    out = bytearray(b"%PDF-1.5\n")
    offsets = []
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{off:010d} 00000 n \n".encode() for off in offsets)
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n").encode()
    return bytes(out)
