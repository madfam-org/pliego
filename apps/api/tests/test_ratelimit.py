"""Rate limiting keyed on the trusted client-IP header (never X-Forwarded-For) and the
one-render-per-worker slot."""

from __future__ import annotations

import threading

import pytest
from conftest import API

from apps.api.ratelimit import RateLimiter, client_key
from apps.api.render_limits import RenderBusy, RenderSlot

BAD_BODY = {"slug": "valley-fold", "params": {"size": 1}}  # rejected before any render


def _post(client, body, headers=None, remote="10.0.0.9"):
    return client.post("/api/v1/documents", json=body, base_url=API, headers=headers or {},
                       environ_base={"REMOTE_ADDR": remote})


def _limited_app(make_app, **kw):
    return make_app(rate_limit=(2, 60.0), **kw)


def _exhaust_with_renders(app, monkeypatch, headers, remote="10.0.0.9"):
    """Make every render instant so only the limiter decides; return the status codes."""
    renderer = app.extensions["pliego"]["renderer"]

    def fake_run(cart, mode, params, formats=()):
        from apps.api.render import RenderResult
        return RenderResult(b"{}", {}, "verify: fake", {}, 0.0)

    monkeypatch.setattr(renderer, "run", fake_run)
    c = app.test_client()
    return [_post(c, {"slug": "valley-fold", "params": {}}, h, remote).status_code
            for h in headers]


def test_limiter_fixed_window_unit():
    now = [100.0]
    lim = RateLimiter(2, 10.0, clock=lambda: now[0])
    assert lim.hit("a")[0] and lim.hit("a")[0]
    allowed, retry = lim.hit("a")
    assert not allowed and 0 < retry <= 10
    assert lim.hit("b")[0]  # separate bucket
    now[0] = 111.0          # next window
    assert lim.hit("a")[0]


def test_spoofed_xff_does_not_change_bucket(make_app, monkeypatch):
    app = _limited_app(make_app)
    codes = _exhaust_with_renders(app, monkeypatch, [
        {"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "1.1.1.1"},
        {"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "2.2.2.2"},
        {"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "3.3.3.3"},
    ])
    assert codes == [200, 200, 429]


def test_trusted_header_does_change_bucket(make_app, monkeypatch):
    app = _limited_app(make_app)
    codes = _exhaust_with_renders(app, monkeypatch, [
        {"CF-Connecting-IP": "203.0.113.7"},
        {"CF-Connecting-IP": "203.0.113.7"},
        {"CF-Connecting-IP": "203.0.113.7"},
        {"CF-Connecting-IP": "198.51.100.4"},
    ])
    assert codes == [200, 200, 429, 200]


def test_xff_alone_falls_back_to_remote_addr(make_app, monkeypatch):
    app = _limited_app(make_app)
    codes = _exhaust_with_renders(app, monkeypatch, [
        {"X-Forwarded-For": "1.1.1.1"}, {"X-Forwarded-For": "2.2.2.2"},
        {"X-Forwarded-For": "3.3.3.3"},
    ])
    assert codes == [200, 200, 429]


def test_429_carries_retry_after(make_app, monkeypatch):
    app = _limited_app(make_app)
    renderer = app.extensions["pliego"]["renderer"]
    from apps.api.render import RenderResult
    monkeypatch.setattr(renderer, "run", lambda *a, **k: RenderResult(b"{}", {}, "v", {}, 0.0))
    c = app.test_client()
    for _ in range(2):
        _post(c, {"slug": "valley-fold", "params": {}})
    resp = _post(c, {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 429
    assert int(resp.headers["Retry-After"]) >= 1
    assert resp.get_json()["status"] == 429


def test_invalid_payloads_do_not_consume_the_budget(make_app):
    c = _limited_app(make_app).test_client()
    for _ in range(5):
        assert _post(c, BAD_BODY).status_code == 400


class _Req:
    def __init__(self, headers, remote):
        self.headers, self.remote_addr = headers, remote


@pytest.mark.parametrize("headers,trusted,expected", [
    ({"CF-Connecting-IP": "203.0.113.7"}, "CF-Connecting-IP", "203.0.113.7"),
    ({"CF-Connecting-IP": "2001:db8::1"}, "CF-Connecting-IP", "2001:db8::1"),
    ({"CF-Connecting-IP": "not-an-ip"}, "CF-Connecting-IP", "10.0.0.9"),
    ({"CF-Connecting-IP": "203.0.113.7"}, "", "10.0.0.9"),
    ({"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}, "CF-Connecting-IP", "10.0.0.9"),
])
def test_client_key(headers, trusted, expected):
    assert client_key(_Req(headers, "10.0.0.9"), trusted) == expected


def test_render_slot_is_one_per_worker():
    slot = RenderSlot(1)
    entered, release = threading.Event(), threading.Event()

    def hold():
        with slot.acquire():
            entered.set()
            release.wait(5)

    t = threading.Thread(target=hold)
    t.start()
    entered.wait(5)
    with pytest.raises(RenderBusy), slot.acquire():
        pass
    release.set()
    t.join()
    with slot.acquire():
        pass  # free again


def test_busy_worker_answers_503_with_retry_after(make_app, monkeypatch):
    app = make_app()
    renderer = app.extensions["pliego"]["renderer"]

    def busy(*_a, **_k):
        raise RenderBusy()

    monkeypatch.setattr(renderer, "run", busy)
    resp = _post(app.test_client(), {"slug": "valley-fold", "params": {}})
    assert resp.status_code == 503
    assert resp.headers["Retry-After"] == "1"
