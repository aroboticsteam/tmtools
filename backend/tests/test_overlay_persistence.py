"""A reloaded / reconnecting overlay gets back what it was showing (`backend/core/overlay_state.py`).

Unit tests drive `ConnectionManager` and the `/ws/overlay` handler with fake sockets and fakeredis; the last
test goes through the real app (real Redis/Postgres, skipped when they are not reachable)."""
from __future__ import annotations

import json
import time
import uuid
from types import SimpleNamespace

import fakeredis
import pytest
import redis as redis_sync
from fakeredis import aioredis as fake_aioredis
from fastapi import WebSocketDisconnect
from starlette.testclient import TestClient

from backend.core import overlay_state
from backend.core.settings import settings
from backend.main import app
from backend.routers import ws as ws_module

class FakeWs:
    def __init__(self):
        self.sent: list[dict] = []

    async def accept(self):
        pass

    async def send_json(self, message):
        self.sent.append(message)

    async def receive_text(self):
        raise WebSocketDisconnect()  # the "page" closes right after the initial replay


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, timers, overlays):
        self._results = [timers, overlays]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _stmt):
        return _Rows(self._results.pop(0))


@pytest.fixture
async def redis(monkeypatch):
    client = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    monkeypatch.setattr(ws_module.manager, "_redis", client)
    yield client
    await client.aclose()


@pytest.fixture
def overlays(monkeypatch):
    """Two overlays bound to different field sets; a TM instance that belongs to field set 7."""
    rows = [
        SimpleNamespace(entity_id="overlay.main", field_set_id=7, tags=["finals"]),
        SimpleNamespace(entity_id="overlay.other", field_set_id=8, tags=[]),
    ]
    monkeypatch.setattr(ws_module, "async_session_factory", lambda: _Session([], rows))
    monkeypatch.setattr(ws_module.manager, "_resolve_field_set_id", lambda _tm: 7)
    monkeypatch.setattr(ws_module.manager, "_resolve_high_potential", lambda _p: False)


def assigned(match_num: int, ts: float) -> dict:
    return {
        "entity_id": "vex_tm.main", "type": "fieldMatchAssigned", "timestamp": ts,
        "payload": {"fieldID": 1, "matchNum": match_num, "round": "QUAL", "redTeams": ["1234A", "5555C"], "blueTeams": ["6666D", "7777E"]},
    }


def spotlight(team, ts: float, entity_id: str = "overlay.main") -> dict:
    return {"entity_id": entity_id, "type": "overlay_show_team", "timestamp": ts, "payload": {"team": team}}


async def reconnect(entity_id: str) -> list[dict]:
    ws = FakeWs()
    await ws_module.ws_overlay(ws, entity_id)
    return ws.sent


@pytest.mark.asyncio
async def test_spotlight_survives_a_reload(redis, overlays):
    await ws_module.manager._dispatch(spotlight("1234A", 100.0))
    sent = await reconnect("overlay.main")
    assert [m["type"] for m in sent] == ["show_team"] and sent[0]["payload"] == {"team": "1234A"}
    assert (await reconnect("overlay.main"))[0]["payload"] == {"team": "1234A"}  # and again: it is state, not a one-shot


@pytest.mark.asyncio
async def test_match_grid_survives_a_reload_only_for_bound_overlays(redis, overlays):
    await ws_module.manager._dispatch(assigned(42, 200.0))
    sent = await reconnect("overlay.main")
    assert [m["type"] for m in sent] == ["upcoming_match"]
    assert sent[0]["payload"]["matchNum"] == 42 and sent[0]["payload"]["redTeams"] == ["1234A", "5555C"]
    assert sent[0]["entity_tags"] == ["finals"] and sent[0]["timestamp"] == 200.0  # the event's own timestamp
    assert await reconnect("overlay.other") == []  # a different field set


@pytest.mark.asyncio
async def test_match_is_replayed_before_the_spotlight(redis, overlays):
    await ws_module.manager._dispatch(spotlight("1234A", 300.0))
    await ws_module.manager._dispatch(assigned(7, 250.0))
    assert [m["type"] for m in await reconnect("overlay.main")] == ["upcoming_match", "show_team"]


@pytest.mark.asyncio
async def test_a_cleared_spotlight_stays_cleared_after_reload(redis, overlays):
    await ws_module.manager._dispatch(spotlight("1234A", 1.0))
    await ws_module.manager._dispatch(spotlight(None, 2.0))
    sent = await reconnect("overlay.main")
    assert sent[0]["type"] == "show_team" and sent[0]["payload"] == {"team": None}


@pytest.mark.asyncio
async def test_a_late_older_event_cannot_roll_the_state_back(redis, overlays):
    await ws_module.manager._dispatch(spotlight("NEW", 10.0))
    await ws_module.manager._dispatch(spotlight("STALE", 5.0))  # another node delivering an old event late
    assert (await reconnect("overlay.main"))[0]["payload"] == {"team": "NEW"}
    await ws_module.manager._dispatch(assigned(2, 20.0))
    await ws_module.manager._dispatch(assigned(1, 15.0))
    assert [m for m in await reconnect("overlay.main") if m["type"] == "upcoming_match"][0]["payload"]["matchNum"] == 2


@pytest.mark.asyncio
async def test_each_overlay_keeps_its_own_state(redis, overlays):
    await ws_module.manager._dispatch(spotlight("1234A", 1.0, "overlay.main"))
    await ws_module.manager._dispatch(spotlight("9999Z", 2.0, "overlay.other"))
    assert (await reconnect("overlay.main"))[0]["payload"] == {"team": "1234A"}
    assert (await reconnect("overlay.other"))[0]["payload"] == {"team": "9999Z"}


@pytest.mark.asyncio
async def test_unknown_overlay_gets_nothing(redis, overlays):
    assert await reconnect("overlay.never_seen") == []


@pytest.mark.asyncio
async def test_live_events_still_reach_a_connected_overlay_and_are_saved(redis, overlays):
    live = FakeWs()
    await ws_module.manager.connect("overlay.main", live)
    await ws_module.manager._dispatch(spotlight("1234A", 5.0))
    assert [m["type"] for m in live.sent] == ["show_team"]
    assert (await overlay_state.load(redis, "overlay.main"))["team"]["payload"] == {"team": "1234A"}
    await ws_module.manager.disconnect("overlay.main", live)


@pytest.mark.asyncio
async def test_redis_failure_never_breaks_the_socket_or_the_fan_out(monkeypatch, overlays):
    class Broken:
        def __getattr__(self, name):
            raise ConnectionError("down")

    monkeypatch.setattr(ws_module.manager, "_redis", Broken())
    live = FakeWs()
    await ws_module.manager.connect("overlay.main", live)
    await ws_module.manager._dispatch(spotlight("1234A", 1.0))  # fan-out still delivers
    assert [m["type"] for m in live.sent] == ["show_team"]
    assert await reconnect("overlay.main") == []  # no stored state is readable: connects empty, no exception
    await ws_module.manager.disconnect("overlay.main", live)


@pytest.mark.asyncio
async def test_deleting_an_overlay_forgets_its_state(redis):
    await overlay_state.save(redis, "overlay.gone", "team", spotlight("1234A", 1.0, "overlay.gone"))
    await overlay_state.clear(redis, "overlay.gone")
    assert await reconnect("overlay.gone") == []


def _infra() -> bool:
    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    async def check() -> bool:
        engine = create_async_engine(settings.POSTGRES_DSN)
        try:
            async with engine.connect() as conn:
                await conn.exec_driver_sql("SELECT 1")
            return True
        except Exception:
            return False
        finally:
            await engine.dispose()

    try:
        return redis_sync.Redis.from_url(settings.REDIS_URL).ping() and asyncio.run(check())
    except Exception:
        return False


@pytest.mark.skipif(not _infra(), reason="Real Postgres/Redis not reachable")
def test_real_app_reload_restores_the_spotlight():
    from concurrent.futures import ThreadPoolExecutor

    entity_id = f"overlay.persist_{uuid.uuid4().hex[:8]}"
    r = redis_sync.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    event = {**spotlight("1234A", time.time(), entity_id), "entity_tags": []}
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/overlay/{entity_id}"):
                time.sleep(0.5)  # the fan-out subscribes to tmtools:events at startup
                r.publish("tmtools:events", json.dumps(event))
                for _ in range(50):  # the fan-out saves what it delivers
                    if r.hexists(overlay_state.key(entity_id), "team"):
                        break
                    time.sleep(0.1)
                assert r.hexists(overlay_state.key(entity_id), "team")
            # the "page reloads": a brand-new socket gets the spotlight back without any new event
            with client.websocket_connect(f"/ws/overlay/{entity_id}") as ws2, ThreadPoolExecutor(1) as pool:
                again = pool.submit(ws2.receive_json).result(timeout=5)
                assert again["type"] == "show_team" and again["payload"] == {"team": "1234A"}
    finally:
        r.delete(overlay_state.key(entity_id))
        r.close()
