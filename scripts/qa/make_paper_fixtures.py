"""Native paper campaign fixtures, generated with the trusted Pliego kernel.

PYTHONPATH=packages/kernel/src .venv/bin/python scripts/qa/make_paper_fixtures.py [--check]
No downloaded artwork or catalogue/customer content is used.
"""
from __future__ import annotations

import argparse
import base64
from pathlib import Path

from pliego.book import codex

ROOT = Path(__file__).resolve().parents[2]


def page(number: int) -> str:
    color = "#253e39" if number in (1, 8) else "#f7f2e7"
    ink = "#f7f2e7" if number in (1, 8) else "#253e39"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="90" height="128" viewBox="0 0 90 128">'
           f'<rect width="90" height="128" fill="{color}"/>'
           f'<path d="M12 22H78M12 105H78" stroke="{ink}" stroke-width="0.4"/>'
           f'<text x="45" y="44" text-anchor="middle" fill="{ink}" font-size="6">PLIEGO</text>'
           f'<text x="45" y="81" text-anchor="middle" fill="{ink}" font-size="29">{number}</text>'
           f'<text x="45" y="115" text-anchor="middle" fill="{ink}" font-size="3">90 × 128 mm</text></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def fixtures() -> dict[Path, bytes]:
    plain = codex(leaves=4, width=90, height=128).build()
    printed = codex(leaves=4, width=90, height=128)
    for i, sheet in enumerate(printed.sheets):
        sheet.art(front=page(2 * i + 1), back=page(2 * i + 2))
    decorated = printed.build()
    for doc in (plain, decorated):
        errors = doc.verify()
        if errors:
            raise ValueError(f"Native paper fixture failed verification: {errors}")
    return {
        ROOT / "packages/engine/test/fixtures/kernel/codex-four-leaf.fold": plain.to_bytes(),
        ROOT / "apps/web/studio/books/eight-page.fold": decorated.to_bytes(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    drift = 0
    for path, content in fixtures().items():
        if args.check:
            if not path.exists() or path.read_bytes() != content:
                drift += 1
                print(f"drift: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    print(f"paper-fixtures: native=2 verified=2 drift={drift}")
    if drift:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
