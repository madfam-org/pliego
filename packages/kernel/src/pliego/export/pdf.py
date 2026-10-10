# Adapted from Fashion Cabinet fc/export/pdf.py (AGPL-3.0, Innovaciones MADFAM), for sheet layers.
"""Tiled print-at-home PDF export of a sheet document (pure stdlib, PDF 1.4).

Page 1 is an overview: the whole canvas scaled to fit, with the tile grid and tile ids
``R{row}C{col}`` (row 1 at the bottom, as the layout frame is y-up). Following pages are the tiles
at 1:1, clipped to the printable frame, with corner alignment crosses and a tile label — tape by
matching crosses. Print-then-cut registration marks (filled square top-left, L corners) frame the
drawing. Line styles follow the origami diagram convention: valley dashed, mountain dash-dot,
cut solid, score thin grey, perforation as explicit cut dashes, glue tabs hatched.
PDF user space is y-up like the layout frame, so no flip is needed. Text is Helvetica (latin-1).
"""

from __future__ import annotations

import math
from typing import Any

from .plan import Plan, Point, build_plan, perforation_dashes, registration_marks

MM_TO_PT = 72.0 / 25.4

PAGE_SIZES_MM = {
    "a4": (210.0, 297.0),
    "letter": (215.9, 279.4),
    "a3": (297.0, 420.0),
    "a0": (841.0, 1189.0),
}

# layer → (rgb, width pt, dash pattern in mm | None)
STYLES: dict[str, tuple[str, float, tuple[float, ...] | None]] = {
    "cut": ("0 0 0", 0.7, None),
    "mountain": ("0.75 0.22 0.17", 0.5, (6.0, 1.5, 1.0, 1.5)),
    "valley": ("0.18 0.44 0.85", 0.5, (3.0, 1.5)),
    "score": ("0.5 0.55 0.55", 0.4, None),
    "perforation": ("0 0 0", 0.6, None),
    "glue": ("0.15 0.68 0.38", 0.35, (1.0, 1.0)),
}
HATCH_MM = 2.0


def _p(v: float) -> str:
    s = f"{v:.2f}"
    return "0.00" if s == "-0.00" else s


def _esc(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


class _Pen:
    """Maps layout mm to page points: (p − canvas origin + shift) × scale."""

    def __init__(self, plan: Plan, shift_x: float, shift_y: float, scale: float) -> None:
        self.cx, self.cy, _w, _h = plan.canvas()
        self.sx, self.sy, self.k = shift_x, shift_y, scale

    def xy(self, p: Point) -> str:
        x = (p[0] - self.cx + self.sx) * self.k
        return f"{_p(x)} {_p((p[1] - self.cy + self.sy) * self.k)}"

    def path(self, pts: tuple[Point, ...] | list[Point], closed: bool) -> str:
        ops = [f"{self.xy(pts[0])} m"] + [f"{self.xy(q)} l" for q in pts[1:]]
        if closed:
            ops.append("h")
        return " ".join(ops)

    def style(self, layer: str) -> str:
        rgb, width, dash = STYLES[layer]
        pattern = " ".join(_p(d * self.k) for d in dash) if dash else ""
        return f"{rgb} RG {_p(width)} w [{pattern}] 0 d\n"


def _hatch(pen: _Pen, pts: tuple[Point, ...]) -> str:
    """45° hatch lines over the polygon bbox, clipped to the polygon."""
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    n = math.ceil(((x1 - x0) + (y1 - y0)) / HATCH_MM)
    lines = []
    for k in range(1, n):
        c = x0 + k * HATCH_MM          # line x − (y − y0) = c − ... drawn from bottom to top
        lines.append(f"{pen.xy((c, y0))} m {pen.xy((c - (y1 - y0), y1))} l")
    return (f"q {pen.path(pts, True)} W n " + " ".join(lines) + " S Q\n") if lines else ""


def _draw(plan: Plan, pen: _Pen, with_text: bool) -> str:
    s: list[str] = []
    if plan.glue:
        s.append(pen.style("glue"))
        for g in plan.glue:
            s.append(_hatch(pen, g.points))
            s.append(pen.path(g.points, True) + " S\n")
    for layer in ("score", "mountain", "valley"):
        strokes = plan.layer(layer)
        if strokes:
            s.append(pen.style(layer))
            s.extend(pen.path(st.points, st.closed) + " S\n" for st in strokes)
    perfs = plan.layer("perforation")
    if perfs:
        s.append(pen.style("perforation"))
        for st in perfs:
            for a, b in perforation_dashes(st.points, st.closed, plan.perf_factor[st.sheet]):
                s.append(f"{pen.xy(a)} m {pen.xy(b)} l S\n")
    cuts = plan.layer("cut")
    if cuts:
        s.append(pen.style("cut"))
        s.extend(pen.path(st.points, st.closed) + " S\n" for st in cuts)
    squares, corners = registration_marks(plan)
    s.append("0 0 0 RG 0 0 0 rg 0.9 w [] 0 d\n")
    s.extend(pen.path(sq, True) + " f\n" for sq in squares)
    s.extend(pen.path(cr, False) + " S\n" for cr in corners)
    if with_text:
        for lb in plan.labels:
            s.append(f"BT /F1 8 Tf 0 0 0 rg {pen.xy(lb.at)} Td ({_esc(lb.text)}) Tj ET\n")
    return "".join(s)


def _tile_stream(plan: Plan, i: int, j: int, tile_w: float, tile_h: float, page_w: float,
                 page_h: float, margin: float, label: str) -> str:
    k = MM_TO_PT
    s = [f"BT /F1 9 Tf 0 0 0 rg {_p(margin * k)} {_p((page_h - margin + 3.0) * k)} Td "
         f"({_esc(label)}) Tj ET\n"]
    s.append("0.55 0.55 0.55 RG 0.35 w [] 0 d\n")
    arm = 5.0 * k
    for cx in (margin, page_w - margin):
        for cy in (margin, page_h - margin):
            x, y = cx * k, cy * k
            s.append(f"{_p(x - arm)} {_p(y)} m {_p(x + arm)} {_p(y)} l S\n")
            s.append(f"{_p(x)} {_p(y - arm)} m {_p(x)} {_p(y + arm)} l S\n")
    s.append(f"q {_p(margin * k)} {_p(margin * k)} {_p(tile_w * k)} {_p(tile_h * k)} re W n\n")
    pen = _Pen(plan, margin - i * tile_w, margin - j * tile_h, k)
    s.append(_draw(plan, pen, with_text=True))
    s.append("Q\n")
    return "".join(s)


def _overview_stream(plan: Plan, page_w: float, page_h: float, margin: float, tiles_x: int,
                     tiles_y: int, tile_w: float, tile_h: float) -> str:
    _cx, _cy, cw, ch = plan.canvas()
    kf = min((page_w - 2 * margin) / cw, (page_h - 2 * margin - 8.0) / ch, 1.0)
    pen = _Pen(plan, margin / kf, margin / kf, kf * MM_TO_PT)
    title = f"{plan.title} - overview ({tiles_x * tiles_y} tiles)"
    s = [f"BT /F1 11 Tf 0 0 0 rg {_p(margin * MM_TO_PT)} {_p((page_h - margin + 3.0) * MM_TO_PT)}"
         f" Td ({_esc(title)}) Tj ET\n"]
    s.append(_draw(plan, pen, with_text=False))
    s.append("0.35 0.45 0.60 RG 0.4 w [4 3] 0 d\n")
    scale = kf * MM_TO_PT
    for i in range(tiles_x):
        for j in range(tiles_y):
            x, y = (i * tile_w * kf + margin) * MM_TO_PT, (j * tile_h * kf + margin) * MM_TO_PT
            s.append(f"{_p(x)} {_p(y)} {_p(tile_w * scale)} {_p(tile_h * scale)} re S\n")
            s.append(f"BT /F1 7 Tf 0.35 0.45 0.60 rg {_p(x + 4)} {_p(y + 4)} Td "
                     f"(R{j + 1}C{i + 1}) Tj ET\n")
    return "".join(s)


def to_pdf(doc: Any, page: str = "a4", margin_mm: float = 10.0,
           profile: str | None = None) -> bytes:
    """Render a sheet document to a tiled multi-page PDF (bytes): overview + 1:1 tiles. With
    the dieline profile (packaging documents, or ``profile="dieline"``) it is one 1:1 page of
    named layers in spot colours instead (``export.dieline_pdf``)."""
    from .dieline import resolve_profile

    if resolve_profile(doc, profile) == "dieline":
        from .dieline_pdf import to_pdf as dieline_pdf

        return dieline_pdf(doc)
    page_key = page.lower()
    if page_key not in PAGE_SIZES_MM:
        raise ValueError(f"unknown page size '{page}' ({' | '.join(PAGE_SIZES_MM)})")
    page_w, page_h = PAGE_SIZES_MM[page_key]
    margin = max(5.0, min(margin_mm, 25.0))
    tile_w, tile_h = page_w - 2 * margin, page_h - 2 * margin
    plan = build_plan(doc)
    _cx, _cy, cw, ch = plan.canvas()
    tiles_x = max(1, math.ceil(cw / tile_w - 1e-9))
    tiles_y = max(1, math.ceil(ch / tile_h - 1e-9))

    streams = [_overview_stream(plan, page_w, page_h, margin, tiles_x, tiles_y, tile_w, tile_h)]
    for j in range(tiles_y):
        for i in range(tiles_x):
            label = (f"{plan.title}  R{j + 1}C{i + 1} of R{tiles_y}C{tiles_x}  "
                     f"(1:1, {page_key.upper()})")
            streams.append(_tile_stream(plan, i, j, tile_w, tile_h, page_w, page_h, margin,
                                        label))

    # 1 catalog, 2 pages tree, 3 font, then per page: page object + content stream.
    objects: list[bytes] = []
    kids = " ".join(f"{4 + 2 * k} 0 R" for k in range(len(streams)))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(streams)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                   b"/Encoding /WinAnsiEncoding >>")
    media = f"[0 0 {_p(page_w * MM_TO_PT)} {_p(page_h * MM_TO_PT)}]"
    for k, stream in enumerate(streams):
        objects.append((f"<< /Type /Page /Parent 2 0 R /MediaBox {media} "
                        f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * k} 0 R >>"
                        ).encode())
        data = stream.encode("cp1252", errors="replace")
        objects.append(b"<< /Length " + str(len(data)).encode() + b" >>\nstream\n" + data
                       + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
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
