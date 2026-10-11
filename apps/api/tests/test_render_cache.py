"""Render cache: exact keys, byte-bounded memory and disk tiers, corrupt entries ignored, and a hit
that skips the worker's render slot."""

from __future__ import annotations

import dataclasses
import os
from pathlib import Path

import pytest
from conftest import API, needs_kernel

from apps.api import render_cache
from apps.api.config import Settings
from apps.api.manifest import Cartridge, Mode
from apps.api.metrics import Metrics
from apps.api.render import Renderer, RenderResult

DOC = "/api/v1/documents"
EXP = "/api/v1/exports"


def _cart(tmp_path: Path, script: str = "result = None\n") -> Cartridge:
    d = tmp_path / "proj" / "demo"
    d.mkdir(parents=True, exist_ok=True)
    (d / "project.json").write_text('{"project": {"slug": "demo"}}', encoding="utf-8")
    (d / "main.py").write_text(script, encoding="utf-8")
    return Cartridge("demo", d, {}, (Mode("default", d / "main.py"),), (), ())


def _result(n: int = 1000, tag: bytes = b"d") -> RenderResult:
    return RenderResult(tag * n, {"svg": b"<svg/>" * 10}, "verify: sheets=1 errors=0",
                        {"errors": 0}, 0.25)


def _cache(tmp_path: Path, mem_mb=1.0, disk_mb=1.0, metrics=None) -> render_cache.RenderCache:
    settings = Settings(root=tmp_path, projects_dir=tmp_path / "proj", render_cache_mb=mem_mb,
                        render_cache_disk_mb=disk_mb, render_cache_dir=tmp_path / "cache")
    return render_cache.RenderCache(settings, metrics)


def _counter(metrics: Metrics, name: str, **labels) -> float:
    key = (name, tuple(sorted(labels.items())))
    return metrics._counters.get(key, 0.0)


def test_repeat_is_a_memory_hit_then_a_disk_hit_in_another_worker(tmp_path):
    metrics = Metrics()
    cache = _cache(tmp_path, metrics=metrics)
    cart = _cart(tmp_path)
    key = cache.key(cart, cart.modes[0], {"size": 150}, ())
    assert cache.get(key) == (None, "miss")
    cache.put(key, _result())
    hit, tier = cache.get(key)
    assert tier == "memory" and hit == _result()
    other = _cache(tmp_path)           # a second worker: empty memory, same disk directory
    hit, tier = other.get(key)
    assert tier == "disk" and hit == _result()
    assert _counter(metrics, "pliego_render_cache_misses_total") == 1
    assert _counter(metrics, "pliego_render_cache_hits_total", tier="memory") == 1
    assert not [p for p in (tmp_path / "cache").iterdir() if p.name.startswith(".tmp-")]


def test_key_is_exact(tmp_path, monkeypatch):
    cache = _cache(tmp_path)
    cart = _cart(tmp_path)
    mode = cart.modes[0]
    base = cache.key(cart, mode, {"a": 1, "b": "x"}, ())
    assert base == cache.key(cart, mode, {"b": "x", "a": 1}, ())          # dict order is not input
    assert base != cache.key(cart, mode, {"a": 1.0, "b": "x"}, ())        # 1 and 1.0: two documents
    assert base != cache.key(cart, mode, {"a": 1, "b": "x"}, ("svg",))    # each export its own entry
    assert base != cache.key(cart, Mode("other", mode.script), {"a": 1, "b": "x"}, ())
    (cart.directory / "main.py").write_text("result = 1\n", encoding="utf-8")
    assert base != cache.key(cart, mode, {"a": 1, "b": "x"}, ())          # an edited script


def test_a_different_commons_pin_or_kernel_misses(tmp_path, monkeypatch):
    cache = _cache(tmp_path)
    cart = _cart(tmp_path)
    monkeypatch.setenv("PLIEGO_COMMONS_SHA", "a" * 40)
    key = cache.key(cart, cart.modes[0], {}, ())
    cache.put(key, _result())
    assert cache.get(key)[1] == "memory"

    bumped = _cache(tmp_path)
    monkeypatch.setenv("PLIEGO_COMMONS_SHA", "b" * 40)
    assert bumped.get(bumped.key(cart, cart.modes[0], {}, ()))[1] == "miss"

    new_kernel = _cache(tmp_path)
    monkeypatch.setenv("PLIEGO_COMMONS_SHA", "a" * 40)
    monkeypatch.setattr(render_cache, "kernel_identity", lambda _s: "0.3.0+feedfacefeedface")
    assert new_kernel.get(new_kernel.key(cart, cart.modes[0], {}, ()))[1] == "miss"


def test_kernel_identity_follows_the_kernel_sources(tmp_path):
    root = tmp_path / "repo"
    pkg = root / "packages" / "kernel" / "src" / "pliego"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("x = 1\n", encoding="utf-8")
    settings = Settings(root=root)
    first = render_cache.kernel_identity(settings)
    (pkg / "export.py").write_text("y = 2\n", encoding="utf-8")
    assert render_cache.kernel_identity(settings) != first


def test_memory_eviction_respects_the_byte_bound(tmp_path):
    metrics = Metrics()
    cache = _cache(tmp_path, mem_mb=0.01, disk_mb=0, metrics=metrics)   # ~10 KiB, no disk tier
    cart = _cart(tmp_path)
    keys = [cache.key(cart, cart.modes[0], {"n": i}, ()) for i in range(6)]
    for k in keys:
        cache.put(k, _result(3000))
        assert cache.memory_used() <= cache.memory_bytes
    assert cache.get(keys[0])[1] == "miss"           # the oldest went first
    assert cache.get(keys[-1])[1] == "memory"
    assert _counter(metrics, "pliego_render_cache_evictions_total", tier="memory") >= 3
    cache.put(keys[-1], _result(50_000))             # larger than the tier: not kept at all
    assert cache.memory_used() <= cache.memory_bytes


def test_disk_eviction_respects_the_byte_bound(tmp_path):
    metrics = Metrics()
    cache = _cache(tmp_path, mem_mb=0, disk_mb=0.05, metrics=metrics)    # ~51 KiB on disk
    cart = _cart(tmp_path)
    for i in range(12):
        cache.put(cache.key(cart, cart.modes[0], {"n": i}, ()), _result(8000))
        total = sum(p.stat().st_size for p in (tmp_path / "cache").glob("*.entry"))
        assert total <= cache.disk_bytes
    assert _counter(metrics, "pliego_render_cache_evictions_total", tier="disk") >= 5


@pytest.mark.parametrize("damage", ["truncate", "flip", "garbage", "other-key"])
def test_a_corrupt_disk_entry_is_ignored_and_removed(tmp_path, damage):
    cache = _cache(tmp_path, mem_mb=0)
    cart = _cart(tmp_path)
    key = cache.key(cart, cart.modes[0], {}, ())
    cache.put(key, _result())
    path = tmp_path / "cache" / f"{key}.entry"
    data = path.read_bytes()
    if damage == "truncate":
        path.write_bytes(data[:-7])
    elif damage == "flip":
        path.write_bytes(data[:-3] + bytes([data[-3] ^ 0xFF]) + data[-2:])
    elif damage == "garbage":
        path.write_bytes(b"not an entry")
    else:
        path.write_bytes(render_cache.encode_entry("f" * 64, _result()))
    assert cache.get(key) == (None, "miss")
    assert not path.exists()


def test_stale_temporary_files_are_swept(tmp_path):
    cache = _cache(tmp_path, mem_mb=0)
    cart = _cart(tmp_path)
    (tmp_path / "cache").mkdir()
    stale = tmp_path / "cache" / ".tmp-dead"
    stale.write_bytes(b"x")
    os.utime(stale, (1, 1))
    cache.put(cache.key(cart, cart.modes[0], {}, ()), _result())
    assert not stale.exists()


def test_settings_reject_a_malformed_bound():
    with pytest.raises(RuntimeError):
        Settings.from_env({"PLIEGO_RENDER_CACHE_MB": "lots"})
    with pytest.raises(RuntimeError):
        Settings.from_env({"PLIEGO_RENDER_CACHE_DISK_MB": "-1"})
    s = Settings.from_env({"PLIEGO_RENDER_CACHE_MB": "0", "PLIEGO_RENDER_CACHE_DISK_MB": "0"})
    assert not render_cache.RenderCache(s).enabled


# ── through the API ──────────────────────────────────────────────────────────
def _post(client, path, body):
    return client.post(path, json=body, base_url=API)


def test_api_repeat_render_is_a_hit_with_identical_bytes(make_app, monkeypatch):
    needs_kernel()
    calls = []
    real_run = Renderer.run

    def counting(self, *args, **kwargs):
        calls.append(args[2])
        return real_run(self, *args, **kwargs)

    monkeypatch.setattr(Renderer, "run", counting)
    app = make_app()
    client = app.test_client()
    body = {"slug": "valley-fold", "params": {"size": 120}}
    first = _post(client, DOC, body)
    second = _post(client, DOC, body)
    assert first.status_code == second.status_code == 200
    assert first.headers["X-Pliego-Cache"] == "miss"
    assert second.headers["X-Pliego-Cache"] == "hit-memory"
    assert first.data == second.data
    assert first.headers["X-Pliego-Verify"] == second.headers["X-Pliego-Verify"]
    assert len(calls) == 1
    svg1 = _post(client, EXP, {**body, "format": "svg"})
    svg2 = _post(client, EXP, {**body, "format": "svg"})
    assert (svg1.headers["X-Pliego-Cache"], svg2.headers["X-Pliego-Cache"]) == ("miss", "hit-memory")
    assert svg1.data == svg2.data and len(calls) == 2
    # a fresh worker over the same /tmp directory answers from disk
    second_worker = make_app().test_client()
    resp = _post(second_worker, DOC, body)
    assert resp.headers["X-Pliego-Cache"] == "hit-disk" and resp.data == first.data
    assert len(calls) == 2


def test_api_hit_skips_the_render_slot(make_app):
    needs_kernel()
    app = make_app()
    client = app.test_client()
    body = {"slug": "valley-fold", "params": {}}
    assert _post(client, DOC, body).status_code == 200
    bp_slot = app.extensions["pliego"]["slot"]
    with bp_slot.acquire():                           # the worker is busy rendering something else
        hit = _post(client, DOC, body)
        busy = _post(client, DOC, {"slug": "valley-fold", "params": {"size": 99}})
    assert hit.status_code == 200 and hit.headers["X-Pliego-Cache"] == "hit-memory"
    assert busy.status_code == 503


def test_api_failures_are_not_cached(make_app, tree):
    needs_kernel()
    (tree / "projects" / "valley-fold" / "main.py").write_text("raise ValueError('torn')\n",
                                                               encoding="utf-8")
    client = make_app().test_client()
    for _ in range(2):
        resp = _post(client, DOC, {"slug": "valley-fold", "params": {}})
        assert resp.status_code == 422
    assert not list((tree / "render-cache").glob("*.entry"))


def test_cache_off(make_app, tree):
    needs_kernel()
    app = make_app(render_cache_mb=0, render_cache_disk_mb=0)
    resp = _post(app.test_client(), DOC, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 200 and resp.headers["X-Pliego-Cache"] == "off"


def test_cache_counters_on_the_metrics_listener(make_app):
    needs_kernel()
    app = make_app()
    client = app.test_client()
    for _ in range(2):
        _post(client, DOC, {"slug": "valley-fold", "params": {}})
    text = client.get("/metrics", environ_overrides={"SERVER_PORT": "9090"}).get_data(as_text=True)
    assert 'pliego_render_cache_hits_total{worker="' in text and 'tier="memory"} 1' in text
    assert "pliego_render_cache_misses_total{" in text
    assert "# TYPE pliego_render_cache_evictions_total counter" in text


def test_kernel_identity_of_the_real_kernel_has_a_version(tmp_path):
    needs_kernel()
    from conftest import REPO

    ident = render_cache.kernel_identity(dataclasses.replace(Settings(), root=REPO))
    version, digest = ident.split("+")
    assert version not in ("", "unknown") and len(digest) == 16
