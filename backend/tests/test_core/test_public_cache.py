"""Unit tests for the public-site response cache (no database needed)."""
from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from backend.core import public_cache
from backend.core.public_cache import PublicCacheMiddleware
from backend.core.settings import settings

pytestmark = pytest.mark.asyncio


def _make_app(calls: dict[str, int], delay: float = 0.0):
    async def data(request):
        calls["n"] += 1
        if delay:
            await asyncio.sleep(delay)
        return JSONResponse({"n": calls["n"], "q": request.query_params.get("q")})

    async def missing(request):
        calls["n"] += 1
        return JSONResponse({"detail": "nope"}, status_code=404)

    async def boom(request):
        calls["n"] += 1
        raise RuntimeError("boom")

    async def image(request):
        calls["n"] += 1
        return Response(status_code=302, headers={"location": "https://s3.example/x", "cache-control": "public, max-age=3600"})

    async def other(request):
        calls["n"] += 1
        return JSONResponse({"n": calls["n"]})

    async def post(request):
        calls["n"] += 1
        return JSONResponse({"n": calls["n"]})

    app = Starlette(
        routes=[
            Route("/api/v1/public/site/overview", data),
            Route("/api/v1/public/site/teams/{number}", missing),
            Route("/api/v1/public/site/boom", boom),
            Route("/api/v1/public/site/image/{name}", image),
            Route("/api/v1/other", other),
            Route("/api/v1/public/site/write", post, methods=["POST", "GET"]),
        ]
    )
    app.add_middleware(PublicCacheMiddleware)
    return app


@pytest.fixture
def ttl(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_CACHE_TTL_SECONDS", 5.0)


def _client(app):
    return AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://t")


async def test_second_request_is_served_from_cache(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        a = await c.get("/api/v1/public/site/overview")
        b = await c.get("/api/v1/public/site/overview")
    assert calls["n"] == 1
    assert a.json() == b.json()
    assert (a.headers["x-cache"], b.headers["x-cache"]) == ("MISS", "HIT")
    assert b.headers["cache-control"] == "public, max-age=5"
    assert int(b.headers["content-length"]) == len(b.content)


async def test_entries_expire(ttl, monkeypatch):
    calls = {"n": 0}
    now = {"t": 1000.0}
    monkeypatch.setattr(public_cache.time, "monotonic", lambda: now["t"])
    async with _client(_make_app(calls)) as c:
        await c.get("/api/v1/public/site/overview")
        now["t"] += 4.9
        await c.get("/api/v1/public/site/overview")
        assert calls["n"] == 1
        now["t"] += 0.2
        r = await c.get("/api/v1/public/site/overview")
    assert calls["n"] == 2 and r.headers["x-cache"] == "MISS"


async def test_query_string_is_part_of_the_key(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        a = await c.get("/api/v1/public/site/overview?q=1")
        b = await c.get("/api/v1/public/site/overview?q=2")
        await c.get("/api/v1/public/site/overview?q=1")
    assert calls["n"] == 2 and a.json()["q"] == "1" and b.json()["q"] == "2"


async def test_concurrent_requests_share_one_computation(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls, delay=0.2)) as c:
        rs = await asyncio.gather(*[c.get("/api/v1/public/site/overview") for _ in range(25)])
    assert calls["n"] == 1
    assert {r.json()["n"] for r in rs} == {1}


async def test_only_200_is_cached(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        r1 = await c.get("/api/v1/public/site/teams/XYZ")
        r2 = await c.get("/api/v1/public/site/teams/XYZ")
    assert r1.status_code == r2.status_code == 404
    assert calls["n"] == 2
    assert "cache-control" not in r2.headers


async def test_errors_are_not_cached_and_do_not_wedge_the_key(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        assert (await c.get("/api/v1/public/site/boom")).status_code == 500
        assert (await c.get("/api/v1/public/site/boom")).status_code == 500
    assert calls["n"] == 2


async def test_disabled_when_ttl_is_zero(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_CACHE_TTL_SECONDS", 0.0)
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        r = await c.get("/api/v1/public/site/overview")
        await c.get("/api/v1/public/site/overview")
    assert calls["n"] == 2 and "x-cache" not in r.headers


async def test_other_paths_methods_and_images_bypass(ttl):
    calls = {"n": 0}
    async with _client(_make_app(calls)) as c:
        await c.get("/api/v1/other")
        await c.get("/api/v1/other")
        await c.post("/api/v1/public/site/write")
        await c.post("/api/v1/public/site/write")
        i = await c.get("/api/v1/public/site/image/logo.png", follow_redirects=False)
        await c.get("/api/v1/public/site/image/logo.png", follow_redirects=False)
    assert calls["n"] == 6
    assert i.headers["cache-control"] == "public, max-age=3600" and "x-cache" not in i.headers


async def test_entry_count_is_bounded(ttl, monkeypatch):
    monkeypatch.setattr(public_cache, "MAX_ENTRIES", 3)
    calls = {"n": 0}
    app = _make_app(calls)
    async with _client(app) as c:
        for q in range(10):
            await c.get(f"/api/v1/public/site/overview?q={q}")
    mw = app.middleware_stack
    while not isinstance(mw, PublicCacheMiddleware):
        mw = mw.app
    assert len(mw._entries) <= 3
