"""Local authored eight-page companion over an immutable native saddle-stitch archive.

No game guide import, geometry generator or historical/manual authority. Content is
an explicitly supplied, reviewed local record; the kernel verifies the art document.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import re
import sys
import textwrap
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/kernel/src"))
sys.path.insert(0, str(ROOT / "scripts"))
from pliego.document import Document  # noqa: E402
from qa.factory_preset_archive import check_archive  # noqa: E402


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def reference(value):
    p = urlsplit(value)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("content references must be HTTPS without credentials")


def validate_content(content):
    if content.get("schema") != "authored-archive-companion/0.1":
        raise ValueError("unsupported authored content format")
    reference(content["edition"]["reference"])
    pages = content["pages"]
    if len(pages) != 8 or [p["id"] for p in pages] != [f"page-{n}" for n in range(1, 9)]:
        raise ValueError("declare exactly eight ordered logical page IDs")
    for p in pages:
        if p["kind"] not in {"archive-facts", "authored-note", "unknown"}:
            raise ValueError("guide content has no admission path in this pilot")
        for lang in ("en", "es"):
            if not isinstance(p["title"][lang], str) or not p["title"][lang].strip():
                raise ValueError("each page needs an EN/ES title")
            paragraphs = p["paragraphs"][lang]
            if not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 4:
                raise ValueError("each page needs one to four short paragraphs")
            if any(not isinstance(s, str) or not s or len(s) > 280 for s in paragraphs):
                raise ValueError("page paragraphs must be nonempty and at most 280 characters")
        for url in p["sources"]:
            reference(url)
    # No route graph, progress predicate or walkthrough can sneak in as metadata.
    if set(content) - {"schema", "edition", "pages", "provenance", "scope"}:
        raise ValueError("unexpected content fields")


def page_svg(page, width, height, lang):
    """Authored typographic content only; no historical art or fabricated diagrams."""
    esc = html.escape
    title = textwrap.wrap(page["title"][lang], 24)
    lines = [line for paragraph in page["paragraphs"][lang]
             for line in [*textwrap.wrap(paragraph, 36), ""]]
    if len(title) > 3 or len(lines) > 23:
        raise ValueError("content exceeds the authored page measure")
    blocks = [f'<text x="9" y="{20 + n * 7}" font-size="6">{esc(line)}</text>'
              for n, line in enumerate(title)]
    y = 24 + len(title) * 7
    blocks += [f'<text x="9" y="{y + n * 4.2}" font-size="3.1">{esc(line)}</text>'
               for n, line in enumerate(lines)]
    blocks += [f'<text x="9" y="{height - 9}" font-size="3">{esc(page["id"])}</text>']
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" '
            f'viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#fbf8f2"/>'
            f'<g font-family="sans-serif" fill="#241f1a">{"".join(blocks)}</g></svg>')


def geometry(doc):
    """Only appearance and its document digest may differ from the native document."""
    d = copy.deepcopy(doc)
    for sheet in d["pliego:sheets"]:
        for side in ("front", "back"):
            sheet[side]["art"] = None
    d["pliego:meta"]["digest"] = None
    return d


def build(archive, content_path, out, handoff_path=None):
    check_archive(archive)
    entries = read(archive / "manifest.json")["entries"]
    if len(entries) != 1:
        raise ValueError("select one native booklet archive")
    entry = entries[0]
    if entry["slug"] != "saddle-stitch" or entry["resolved_parameters"].get("pages") != 8:
        raise ValueError("pilot needs an actual eight-page saddle-stitch capture")
    if entry["resolved_parameters"].get("binding") != "left":
        raise ValueError("this pilot maps left binding only")
    fold_path = archive / entry["assets"]["fold"]["path"]
    blob = fold_path.read_bytes()
    if sha(blob) != entry["assets"]["fold"]["sha256"]:
        raise ValueError("native FOLD hash differs")
    base = json.loads(blob)
    content = read(content_path)
    validate_content(content)
    if len(base["pliego:sheets"]) != 2:
        raise ValueError("eight pages must have two native physical sheets")
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError("companion output already occupied/frozen; choose a new empty directory")
    files, mappings = {}, []

    def put(name, data):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files[name] = {"sha256": sha(data), "bytes": len(data)}

    put("content.json", encoded(content))
    handoff = None
    if handoff_path:
        handoff = read(handoff_path)
        if handoff.get("schema") != "curated-experience-handoff/0.1" or handoff.get("historical_reference") != content["edition"]["reference"]:
            raise ValueError("curated handoff belongs to a different edition or format")
        if not isinstance(handoff.get("bundle_digest"), str) or not re.fullmatch(r"sha256:[a-f0-9]{64}",handoff["bundle_digest"]):
            raise ValueError("curated handoff needs an exact bundle digest")
        for key in ("gallery_url", "reveal_url"):
            reference(handoff[key])
        put("handoff.json", encoded(handoff))
    for lang in ("en", "es"):
        doc = copy.deepcopy(base)
        for k, sheet in enumerate(doc["pliego:sheets"]):
            points = [p for p, si in zip(doc["vertices_coords"], doc["pliego:vertices_sheet"], strict=True) if si == k]
            width = max(p[0] for p in points) - min(p[0] for p in points)
            height = max(p[1] for p in points) - min(p[1] for p in points)
            half = width / 2
            # The back is specified as seen from the back, mirroring physical L/R.
            pairs = {"back": [8 - 2*k, 1 + 2*k], "front": [2 + 2*k, 7 - 2*k]}
            for side, pair in pairs.items():
                panels = []
                for slot, number in enumerate(pair):
                    page = content["pages"][number - 1]
                    svg = page_svg(page, half, height, lang)
                    put(f"pages/{lang}/page-{number}.svg", svg.encode())
                    inner = svg[svg.index(">") + 1:svg.rindex("</svg>")]
                    panels.append(f'<g transform="translate({slot * half} 0)">{inner}</g>')
                    if lang == "en":
                        physical_slot = 1-slot if side == "back" else slot
                        mappings.append({"page": page["id"], "number": number, "sheet": sheet["id"],
                                         "side": side, "half": "L" if physical_slot == 0 else "R",
                                         "region_mm": [physical_slot * half, 0, half, height],
                                         "back_view_slot": slot if side == "back" else None})
                spread = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" '
                          f'viewBox="0 0 {width} {height}">{"".join(panels)}</svg>')
                sheet[side]["art"] = "data:image/svg+xml," + quote(spread, safe="")
        stamped = Document(doc).stamp()
        problems = stamped.verify()
        if problems:
            raise ValueError(f"native art document verification: {problems}")
        if geometry(base) != geometry(doc):
            raise ValueError("artwork adapter changed native geometry or construction")
        put(f"book-{lang}.fold", stamped.to_json(pretty=True).encode())
    mappings.sort(key=lambda p: p["number"])
    if [p["number"] for p in mappings] != list(range(1, 9)):
        raise ValueError("logical pages are not a bijection over the imposed sides")
    manifest = {"schema": "pliego-authored-companion/0.1", "edition": content["edition"],
                "adapter": {"repository": "https://github.com/madfam-org/pliego", "path": "scripts/companion_book.py",
                            "sha256": sha(Path(__file__).read_bytes()), "scope": "Appearance-only native document derivation; no geometry or game guide generator"},
                "native": {"key": entry["key"], "source": entry["source"], "runtime": entry["runtime"],
                           "resolved_parameters": entry["resolved_parameters"], "frame": entry["assets"]["fold"]["frame"],
                           "fold_sha256": sha(blob), "manifest_sha256": sha((archive / "manifest.json").read_bytes()),
                           "parts": entry["parts"], "construction_steps": [s["id"] for s in base["pliego:sequence"]["steps"]]},
                "page_frame": {"units": "mm", "space": "sheet-local", "axes": "u right, v up viewed from the native front",
                               "region": "[u_min,v_min,width,height]", "back_view_slot": "0 left / 1 right as viewed from the back; reverses the physical front-coordinate half"},
                "pages": mappings, "files": files, "handoff": handoff,
                "checks": {"native_document_errors": 0, "geometry_unchanged": True, "imposition_bijective": True,
                           "historical_manual": False, "guide_content_admitted": False, "game_completion": "not assessed"},
                "scope": "Authored archive companion; native construction and separate accessible reading. No original manual, walkthrough or physical-fit certification."}
    (out / "companion.json").write_bytes(encoded(manifest))
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--archive", type=Path, required=True)
    ap.add_argument("--content", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--handoff", type=Path, help="explicit curated edition/gallery/reveal links; never inferred from a game name")
    a = ap.parse_args()
    try:
        result = build(a.archive, a.content, a.out, a.handoff)
        print(json.dumps({"pages": len(result["pages"]), "parts": result["native"]["parts"], "checks": result["checks"]}))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"companion-book: failed {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
