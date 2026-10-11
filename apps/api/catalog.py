"""Filesystem catalog of the commons (``projects/*/project.json``) and the paper stock cards.

Only directories that CONTAIN a ``project.json`` are cartridges (scoped glob, never ``rglob``: the
submodule trap). Parsing happens once per change, memoized behind a stat-walk signature
(name, mtime_ns, size of every manifest and script) — a stat walk, not a parse walk.

Fail closed: a manifest that does not parse or validate is logged, excluded and counted
(``invalid`` in /health and /ready). A missing or empty ``projects/`` is a catalog of 0, which
/ready reports (and refuses while ``PLIEGO_REQUIRE_COMMONS`` is on).
"""

from __future__ import annotations

import json
import logging
import threading
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from .manifest import SLUG_RE, Cartridge, ManifestError, parse_cartridge

log = logging.getLogger("pliego.api.catalog")

FACET_KEYS = ("domain", "class", "difficulty", "tag")


def strict_json_loads(text: str):
    """json.loads that rejects NaN/Infinity and duplicate keys (both are silent traps)."""

    def no_constants(name: str):
        raise ValueError(f"non-finite number {name} is not JSON")

    def no_duplicates(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError(f"duplicate key {key!r}")
            obj[key] = value
        return obj

    return json.loads(text, parse_constant=no_constants, object_pairs_hook=no_duplicates)


class _StatMemo:
    """Recompute ``build()`` only when the stat signature of ``files()`` changes."""

    def __init__(self, files: Callable[[], list[Path]], build: Callable[[list[Path]], object]):
        self._files, self._build = files, build
        self._sig: tuple | None = None
        self._value = None
        self._lock = threading.Lock()

    def get(self):
        files = self._files()
        sig = []
        for path in files:
            try:
                st = path.stat()
                sig.append((str(path), st.st_mtime_ns, st.st_size))
            except OSError:
                sig.append((str(path), None, None))
        sig_t = tuple(sig)
        with self._lock:
            if sig_t != self._sig:
                self._value = self._build(files)
                self._sig = sig_t
            return self._value


def _i18n_first_line(value) -> str:
    text = value.get("en", "") if isinstance(value, dict) else ""
    return text.split("\n", 1)[0] if isinstance(text, str) else ""


class Catalog:
    def __init__(self, projects_dir: Path, formats_for: Callable[[Cartridge], list[str]],
                 thumbnail_for: Callable[[str], str | None] | None = None):
        self.projects_dir = projects_dir
        self._formats_for = formats_for
        self._thumbnail_for = thumbnail_for or (lambda _slug: None)
        self._memo = _StatMemo(self._watched, self._load)

    def _manifests(self) -> list[Path]:
        if not self.projects_dir.is_dir():
            return []
        return sorted(p for p in self.projects_dir.glob("*/project.json") if p.is_file())

    def _watched(self) -> list[Path]:
        files = []
        for manifest in self._manifests():
            files.append(manifest)
            files.extend(sorted(manifest.parent.glob("*.py")))
        return files

    def _load(self, _files: list[Path]) -> dict:
        cartridges: dict[str, Cartridge] = {}
        invalid: dict[str, str] = {}
        for manifest in self._manifests():
            slug = manifest.parent.name
            try:
                doc = strict_json_loads(manifest.read_text(encoding="utf-8"))
                cartridges[slug] = parse_cartridge(manifest.parent, doc)
            except (OSError, UnicodeDecodeError, ValueError, ManifestError) as exc:
                invalid[slug] = str(exc)
                log.error("catalog: excluding %s: %s", slug, exc)
        log.info("catalog: cartridges=%d invalid=%d dir=%s", len(cartridges), len(invalid),
                 self.projects_dir)
        return {"cartridges": cartridges, "invalid": invalid}

    # ── queries ──────────────────────────────────────────────────────────────
    def state(self) -> dict:
        return self._memo.get()

    def counts(self) -> tuple[int, int]:
        st = self.state()
        return len(st["cartridges"]), len(st["invalid"])

    def get(self, slug: str) -> Cartridge | None:
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            return None
        return self.state()["cartridges"].get(slug)

    def record(self, cart: Cartridge) -> dict:
        project = cart.manifest["project"]
        hyper = cart.manifest.get("hyperobject") or {}
        return {
            "slug": cart.slug,
            "name": project["name"],
            "summary": _i18n_first_line(project.get("description")),
            # same-origin preview URL when the built thumbnail exists (apps/api/thumbnails.py)
            "thumbnail": self._thumbnail_for(cart.slug),
            "difficulty": project.get("difficulty"),
            "tags": list(project.get("tags", [])),
            "domain": hyper.get("domain"),
            "class": hyper.get("class"),
            "modes": [m.id for m in cart.modes],
            "parameters": len(cart.parameters),
            "export_formats": self._formats_for(cart),
            "interfaces": [i.get("id") for i in hyper.get("interfaces", [])
                           if isinstance(i, dict)],
        }

    def search(self, q: str = "", **filters: str) -> dict:
        records = [self.record(c) for _, c in sorted(self.state()["cartridges"].items())]
        needle = q.strip().lower()

        def matches(rec: dict) -> bool:
            cart = self.state()["cartridges"][rec["slug"]]
            if needle:
                desc = cart.manifest["project"].get("description")
                desc_text = [str(v) for v in desc.values()] if isinstance(desc, dict) else []
                hay = " ".join([rec["slug"], *map(str, rec["name"].values()), *rec["tags"],
                                *desc_text]).lower()
                if needle not in hay:
                    return False
            for key, value in filters.items():
                if not value:
                    continue
                if key == "tag":
                    if value not in rec["tags"]:
                        return False
                elif rec.get(key) != value:
                    return False
            return True

        items = [r for r in records if matches(r)]
        return {"total": len(items), "items": items, "facets": self.facets(items)}

    @staticmethod
    def facets(items: list[dict]) -> dict:
        out: dict[str, dict] = {}
        for key in FACET_KEYS:
            counter: Counter = Counter()
            for rec in items:
                values = rec["tags"] if key == "tag" else [rec.get(key)]
                counter.update(v for v in values if v)
            out[key] = dict(sorted(counter.items()))
        return out


class StockLibrary:
    """``materials/<slug>/stock.json`` cards as committed (``derived`` kept, never re-derived)."""

    def __init__(self, materials_dir: Path):
        self.materials_dir = materials_dir
        self._memo = _StatMemo(self._files, self._load)

    def _files(self) -> list[Path]:
        if not self.materials_dir.is_dir():
            return []
        return sorted(p for p in self.materials_dir.glob("*/stock.json") if p.is_file())

    def _load(self, files: list[Path]) -> dict:
        cards: dict[str, dict] = {}
        invalid: dict[str, str] = {}
        for path in files:
            slug = path.parent.name
            try:
                card = strict_json_loads(path.read_text(encoding="utf-8"))
                if not SLUG_RE.match(slug):
                    raise ValueError("directory is not a kebab-case slug")
                if not isinstance(card, dict) or not isinstance(card.get("stock"), dict) \
                        or card["stock"].get("slug") != slug:
                    raise ValueError("stock.slug does not match the directory")
                if not isinstance(card.get("derived"), dict):
                    raise ValueError("missing derived block")
                cards[slug] = card
            except (OSError, UnicodeDecodeError, ValueError) as exc:
                invalid[slug] = str(exc)
                log.error("stocks: excluding %s: %s", slug, exc)
        return {"cards": cards, "invalid": invalid}

    def state(self) -> dict:
        return self._memo.get()

    def get(self, slug: str) -> dict | None:
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            return None
        return self.state()["cards"].get(slug)
