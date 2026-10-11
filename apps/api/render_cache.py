"""Render cache: exact, artifact-keyed reuse of sandbox renders (yantra4d's render_cache, stdlib only).

The kernel is byte-deterministic, so a render is a pure function of what goes into it, and a hit can
be served as the exact bytes a miss would produce. The key is the sha256 of the canonical JSON of:

- ``slug``, ``mode`` and ``formats`` (a document render and each export are separate entries);
- ``params`` — the EFFECTIVE parameters exactly as the runner receives them. Numbers are NOT
  normalised: the document records ``pliego:meta.params`` as sent, so ``150`` and ``150.0`` are two
  different documents and two different entries;
- ``commons`` — the commons pin when it is knowable (``PLIEGO_COMMONS_SHA``, else the submodule's
  HEAD in a checkout; the image ships no ``.git``) — and ``source``, the sha256 of the cartridge's
  ``project.json`` and ``*.py`` files, so the key is exact even where the pin is not known;
- ``kernel`` — ``pliego.__version__`` plus a digest of the kernel package, the runner and sandbox
  code and the stock cards: a kernel edit without a version bump must not reuse old bytes.

First, read-only: the PRERENDERED tier (``prerender_store.py``), renders of every cartridge, mode
and preset made at image build time under these same keys (``prerender.py``). A missing entry is a
plain fall-through; a corrupt one also counts ``pliego_render_cache_prerendered_invalid_total``.

Then two tiers, both optional and both bounded by BYTES:

- memory: a per-worker LRU (``PLIEGO_RENDER_CACHE_MB``, default 16);
- disk: a directory under ``/tmp`` (the only writable path in the image) shared by the pod's workers
  (``PLIEGO_RENDER_CACHE_DISK_MB``, default 32; ``PLIEGO_RENDER_CACHE_DIR``). Writes are atomic
  (temporary file + ``os.replace``), so a worker never reads a half-written entry; every entry
  carries the length and sha256 of each part, and one that does not verify (truncated, corrupt, a
  different key) is ignored and removed. Eviction removes the least recently used files (a hit
  refreshes the file's mtime) until the directory is under its bound. The tier trusts its directory:
  ``/tmp`` is the pod's private ``emptyDir``, and cartridges run with no file access.

Counters (per worker, metrics.py): ``pliego_render_cache_hits_total{tier}``,
``pliego_render_cache_misses_total`` and ``pliego_render_cache_evictions_total{tier}``. Failures are
never cached. A hit does not take the worker's render slot (api_v1.py).
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path

from .config import Settings
from .manifest import Cartridge, Mode
from .metrics import Metrics
from .prerender_store import PrerenderStore
from .render import RUNNER, RenderResult

KEY_VERSION = 1
MAGIC = b"PLIEGO-RENDER-CACHE 1\n"
ENTRY_SUFFIX = ".entry"
TMP_PREFIX = ".tmp-"
STALE_TMP_S = 600.0
_SHA = re.compile(r"^[0-9a-f]{7,40}$")
_KEY = re.compile(r"^[0-9a-f]{64}$")


def canonical_json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _digest_files(paths) -> str:
    h = hashlib.sha256()
    for label, path in paths:
        h.update(f"{label}\0".encode())
        h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def source_digest(cart: Cartridge) -> str:
    """sha256 over the files a render reads from the cartridge: project.json and its scripts."""
    files = [cart.directory / "project.json", *sorted(cart.directory.glob("*.py"))]
    return _digest_files((p.name, p) for p in files if p.is_file())


def commons_pin(projects_dir: Path) -> str | None:
    """The commons commit, when knowable: ``PLIEGO_COMMONS_SHA``, else the checkout's HEAD."""
    env = os.environ.get("PLIEGO_COMMONS_SHA", "").strip().lower()
    if _SHA.match(env):
        return env
    dot_git = projects_dir / ".git"
    try:
        if dot_git.is_file():
            ref = dot_git.read_text(encoding="utf-8").strip()
            if not ref.startswith("gitdir:"):
                return None
            git_dir = (projects_dir / ref.split(":", 1)[1].strip()).resolve()
        elif dot_git.is_dir():
            git_dir = dot_git
        else:
            return None
        head = (git_dir / "HEAD").read_text(encoding="utf-8").strip().lower()
    except OSError:
        return None
    return head if re.fullmatch(r"[0-9a-f]{40}", head) else None


def kernel_identity(settings: Settings) -> str:
    """``<pliego.__version__>+<digest>``: the kernel the runner imports, the runner and its
    sandbox, and the stock cards it snapshots into every document."""
    pkg = settings.kernel_src / "pliego"
    if not pkg.is_dir():
        spec = importlib.util.find_spec("pliego")
        locations = list(spec.submodule_search_locations or []) if spec else []
        pkg = Path(locations[0]) if locations else None
    try:
        import pliego

        version = str(getattr(pliego, "__version__", "unknown"))
    except ImportError:
        version = "unknown"
    files: list[tuple[str, Path]] = []
    if pkg is not None and pkg.is_dir():
        files += [(f"kernel/{p.relative_to(pkg).as_posix()}", p) for p in sorted(pkg.rglob("*.py"))]
    engine_dir = RUNNER.parent
    vendor = engine_dir.parents[1] / "vendor"
    files += [(f"runner/{p.name}", p) for p in sorted(engine_dir.glob("*.py"))]
    files += [(f"vendor/{p.relative_to(vendor).as_posix()}", p) for p in sorted(vendor.rglob("*.py"))]
    if settings.materials.is_dir():
        files += [(f"materials/{p.parent.name}", p)
                  for p in sorted(settings.materials.glob("*/stock.json"))]
    return f"{version}+{_digest_files(files)[:16]}"


def _size(result: RenderResult) -> int:
    return len(result.document) + sum(len(v) for v in result.exports.values()) + 512


class RenderCache:
    def __init__(self, settings: Settings, metrics: Metrics | None = None) -> None:
        self.settings = settings
        self.metrics = metrics
        self.memory_bytes = int(settings.render_cache_mb * (1 << 20))
        self.disk_bytes = int(settings.render_cache_disk_mb * (1 << 20))
        self.disk_dir = settings.render_cache_path if self.disk_bytes > 0 else None
        store = PrerenderStore(settings.prerender)
        self.prerendered = store if store.available() else None
        self._bad_prerendered: set[str] = set()
        self._lru: OrderedDict[str, tuple[RenderResult, int]] = OrderedDict()
        self._used = 0
        self._lock = threading.Lock()
        self._kernel: str | None = None
        self._commons: tuple[str | None] | None = None

    @property
    def enabled(self) -> bool:
        return self.memory_bytes > 0 or self.disk_dir is not None or self.prerendered is not None

    # ── key ──────────────────────────────────────────────────────────────────
    def kernel(self) -> str:
        if self._kernel is None:
            self._kernel = kernel_identity(self.settings)
        return self._kernel

    def commons(self) -> str | None:
        if self._commons is None:
            self._commons = (commons_pin(self.settings.projects),)
        return self._commons[0]

    def key(self, cart: Cartridge, mode: Mode, params: dict, formats: tuple[str, ...]) -> str:
        material = {"v": KEY_VERSION, "slug": cart.slug, "mode": mode.id, "params": params,
                    "formats": list(formats), "commons": self.commons(),
                    "source": source_digest(cart), "kernel": self.kernel()}
        return hashlib.sha256(canonical_json(material)).hexdigest()

    # ── lookups ──────────────────────────────────────────────────────────────
    def _count(self, name: str, **labels: str) -> None:
        if self.metrics is not None:
            self.metrics.inc(name, **labels)

    def get(self, key: str) -> tuple[RenderResult | None, str]:
        """(result, tier) — tier is ``prerendered``, ``memory``, ``disk`` or ``miss``."""
        if self.prerendered is not None and key not in self._bad_prerendered:
            warm, why = self.prerendered.get(key)
            if warm is not None:
                self._count("pliego_render_cache_hits_total", tier="prerendered")
                return warm, "prerendered"
            if why != "missing":  # corrupt or foreign: fall through, and stop re-reading it
                with self._lock:
                    if len(self._bad_prerendered) < 4096:
                        self._bad_prerendered.add(key)
                self._count("pliego_render_cache_prerendered_invalid_total")
        with self._lock:
            entry = self._lru.get(key)
            if entry is not None:
                self._lru.move_to_end(key)
        if entry is not None:
            self._count("pliego_render_cache_hits_total", tier="memory")
            return entry[0], "memory"
        result = self._disk_get(key)
        if result is not None:
            self._remember(key, result)
            self._count("pliego_render_cache_hits_total", tier="disk")
            return result, "disk"
        self._count("pliego_render_cache_misses_total")
        return None, "miss"

    def put(self, key: str, result: RenderResult) -> None:
        self._remember(key, result)
        self._disk_put(key, result)

    def _remember(self, key: str, result: RenderResult) -> None:
        size = _size(result)
        if size > self.memory_bytes:
            return
        evicted = 0
        with self._lock:
            old = self._lru.pop(key, None)
            if old is not None:
                self._used -= old[1]
            self._lru[key] = (result, size)
            self._used += size
            while self._used > self.memory_bytes and self._lru:
                _k, (_r, s) = self._lru.popitem(last=False)
                self._used -= s
                evicted += 1
        for _ in range(evicted):
            self._count("pliego_render_cache_evictions_total", tier="memory")

    def memory_used(self) -> int:
        with self._lock:
            return self._used

    # ── disk tier ────────────────────────────────────────────────────────────
    def _path(self, key: str) -> Path | None:
        if self.disk_dir is None or not _KEY.match(key):
            return None
        return self.disk_dir / f"{key}{ENTRY_SUFFIX}"

    def _disk_get(self, key: str) -> RenderResult | None:
        path = self._path(key)
        if path is None:
            return None
        try:
            data = path.read_bytes()
        except OSError:
            return None
        result = decode_entry(data, key)
        if result is None:
            path.unlink(missing_ok=True)  # corrupt or foreign: ignore it, and do not trip on it again
            return None
        try:
            os.utime(path)
        except OSError:
            pass
        return result

    def _disk_put(self, key: str, result: RenderResult) -> None:
        path = self._path(key)
        if path is None:
            return
        blob = encode_entry(key, result)
        if len(blob) > self.disk_bytes // 4:
            return  # one entry never takes more than a quarter of the tier
        try:
            self.disk_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=TMP_PREFIX, dir=self.disk_dir)
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(blob)
                os.replace(tmp, path)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
        except OSError:
            return  # a full or unwritable /tmp degrades to the memory tier, never fails a render
        self._disk_evict()

    def _disk_evict(self) -> None:
        entries = []
        now = time.time()
        try:
            listing = list(os.scandir(self.disk_dir))
        except OSError:
            return
        for item in listing:
            try:
                st = item.stat(follow_symlinks=False)
            except OSError:
                continue
            if item.name.startswith(TMP_PREFIX):
                if now - st.st_mtime > STALE_TMP_S:  # a writer that died mid-write
                    Path(item.path).unlink(missing_ok=True)
                continue
            if item.name.endswith(ENTRY_SUFFIX) and item.is_file(follow_symlinks=False):
                entries.append((st.st_mtime, item.name, st.st_size))
        total = sum(e[2] for e in entries)
        entries.sort()
        for _mtime, name, size in entries:
            if total <= self.disk_bytes:
                break
            try:
                (self.disk_dir / name).unlink()
                self._count("pliego_render_cache_evictions_total", tier="disk")
            except FileNotFoundError:
                pass  # another worker evicted it first
            except OSError:
                continue
            total -= size


# ── entry encoding ───────────────────────────────────────────────────────────
def encode_entry(key: str, result: RenderResult) -> bytes:
    parts = [("document", result.document)] + [(f"export:{f}", b)
                                               for f, b in sorted(result.exports.items())]
    header = {"key": key, "verify": result.verify, "report": result.report,
              "seconds": result.seconds,
              "parts": [[name, len(data), hashlib.sha256(data).hexdigest()] for name, data in parts]}
    head = canonical_json(header)
    return MAGIC + len(head).to_bytes(8, "big") + head + b"".join(d for _n, d in parts)


def decode_entry(data: bytes, key: str) -> RenderResult | None:
    """The entry's result, or None unless every length and digest checks and the key matches."""
    try:
        if not data.startswith(MAGIC):
            return None
        at = len(MAGIC)
        hlen = int.from_bytes(data[at:at + 8], "big")
        at += 8
        header = json.loads(data[at:at + hlen].decode("utf-8"))
        at += hlen
        if not isinstance(header, dict) or header.get("key") != key:
            return None
        document, exports = None, {}
        for name, length, digest in header["parts"]:
            chunk = data[at:at + length]
            if len(chunk) != length or hashlib.sha256(chunk).hexdigest() != digest:
                return None
            at += length
            if name == "document":
                document = chunk
            elif name.startswith("export:"):
                exports[name[len("export:"):]] = chunk
            else:
                return None
        if document is None or at != len(data):
            return None
        return RenderResult(document, exports, str(header["verify"]), dict(header["report"]),
                            float(header["seconds"]))
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        return None
