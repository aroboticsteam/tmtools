"""Field state kept in Redis for Match Control (`backend/core/field_state.py`) and its endpoint."""
from __future__ import annotations

import json

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis
from httpx import ASGITransport, AsyncClient

from backend.core import field_state as fs
from backend.core.dependencies import CurrentPrincipal, get_current_principal
from backend.core.redis import get_redis
from backend.main import app

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def redis():
    client = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    yield client
    await client.aclose()


def ev(type_, payload, entity_id="vex_tm.main", ts=1000.0):
    return {"type": type_, "entity_id": entity_id, "timestamp": ts, "payload": payload}


async def test_latest_assignment_per_field_is_kept(redis):
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": 1, "matchNum": 4, "redTeams": ["1A"]}, ts=1))
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": 2, "matchNum": 5}, ts=2))
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": 1, "matchNum": 6, "redTeams": ["2B"]}, ts=3))
    snap = await fs.snapshot(redis)
    assert set(snap["matches"]) == {"1", "2"}
    assert snap["matches"]["1"]["payload"]["matchNum"] == 6 and snap["matches"]["1"]["timestamp"] == 3
    assert snap["matches"]["2"]["payload"]["matchNum"] == 5


async def test_upcoming_match_is_keyed_by_entity_id(redis):
    await fs.record(redis, ev("upcoming_match", {"matchNum": 9}, entity_id="timer.field1"))
    snap = await fs.snapshot(redis)
    assert snap["matches"]["timer.field1"]["payload"]["matchNum"] == 9
    assert snap["events"] == {}  # no fieldID: no per-field event list


async def test_events_are_per_field_newest_first_and_capped(redis):
    for i in range(8):
        await fs.record(redis, ev("matchStarted" if i % 2 else "fieldActivated", {"fieldID": 3}, ts=float(i)))
    await fs.record(redis, ev("fieldActivated", {"fieldID": 4}, ts=99.0))
    snap = await fs.snapshot(redis)
    rows = snap["events"]["3"]
    assert len(rows) == fs.MAX_EVENTS and [r["timestamp"] for r in rows] == [7.0, 6.0, 5.0, 4.0, 3.0]
    assert [r["type"] for r in snap["events"]["4"]] == ["fieldActivated"]
    assert "3" not in snap["matches"]  # only assignments populate the match map


async def test_audience_display_is_recorded_so_a_reload_can_show_countdown(redis):
    await fs.record(redis, ev("audienceDisplayChanged", {"fieldID": 1, "display": "IN_MATCH"}, ts=1))
    await fs.record(redis, ev("matchStarted", {"fieldID": 1}, ts=2))
    rows = (await fs.snapshot(redis))["events"]["1"]
    assert rows[1]["display"] == "IN_MATCH"
    assert "display" not in rows[0]


async def test_unrelated_and_malformed_events_are_ignored_and_never_raise(redis):
    await fs.record(redis, ev("timer_started", {"duration_s": 60}))
    await fs.record(redis, ev("fieldMatchAssigned", {"matchNum": 1}))  # no fieldID
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": ""}))
    await fs.record(redis, {"type": "fieldMatchAssigned", "payload": "not a dict"})
    await fs.record(redis, {})
    assert await fs.snapshot(redis) == {"matches": {}, "events": {}}

    class Broken:
        def pipeline(self):
            raise ConnectionError("down")

    await fs.record(Broken(), ev("fieldMatchAssigned", {"fieldID": 1}))  # must not raise


async def test_state_expires(redis):
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": 1}))
    assert 0 < await redis.ttl(fs.STATE_KEY) <= fs.TTL_SECONDS
    assert 0 < await redis.ttl(fs.EVENTS_PREFIX + "1") <= fs.TTL_SECONDS


async def test_corrupt_entries_are_skipped(redis):
    await redis.hset(fs.STATE_KEY, "9", "{not json")
    await redis.hset(fs.STATE_KEY, "1", json.dumps({"type": "fieldMatchAssigned", "payload": {"fieldID": 1}}))
    await redis.lpush(fs.EVENTS_PREFIX + "1", "garbage")
    snap = await fs.snapshot(redis)
    assert list(snap["matches"]) == ["1"] and snap["events"] == {}


async def test_a_second_reader_sees_what_the_leader_recorded():
    server = fakeredis.FakeServer()
    leader = fake_aioredis.FakeRedis(server=server, decode_responses=True)
    passive = fake_aioredis.FakeRedis(server=server, decode_responses=True)
    await fs.record(leader, ev("fieldMatchAssigned", {"fieldID": 1, "matchNum": 12}))
    assert (await fs.snapshot(passive))["matches"]["1"]["payload"]["matchNum"] == 12
    await leader.aclose()
    await passive.aclose()


async def _client(redis, permissions):
    async def _principal():
        return CurrentPrincipal(subject="t", permissions=permissions)

    async def _redis():
        return redis

    app.dependency_overrides[get_current_principal] = _principal
    app.dependency_overrides[get_redis] = _redis
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=False)
def _cleanup():
    yield
    app.dependency_overrides.pop(get_current_principal, None)
    app.dependency_overrides.pop(get_redis, None)


async def test_endpoint_returns_the_snapshot(redis, _cleanup):
    await fs.record(redis, ev("fieldMatchAssigned", {"fieldID": 1, "matchNum": 3, "redTeams": ["1A"], "blueTeams": ["2B"]}))
    async with await _client(redis, {"integrations:read"}) as c:
        r = await c.get("/api/v1/fields/state")
    assert r.status_code == 200
    body = r.json()
    assert body["matches"]["1"]["payload"]["redTeams"] == ["1A"] and body["events"]["1"][0]["type"] == "fieldMatchAssigned"


async def test_endpoint_requires_integrations_read(redis, _cleanup):
    async with await _client(redis, {"timers:read"}) as c:
        r = await c.get("/api/v1/fields/state")
    assert r.status_code == 403


async def test_endpoint_empty_when_nothing_recorded(redis, _cleanup):
    async with await _client(redis, {"integrations:read"}) as c:
        r = await c.get("/api/v1/fields/state")
    assert r.status_code == 200 and r.json() == {"matches": {}, "events": {}}


async def test_loader_event_listener_records_field_state(redis):
    """The leader's `tmtools:events` listener (the loader) is what feeds the state; a debug-log
    ring entry and a field-state entry must both appear for the same event."""
    import asyncio

    import backend.loader as loader_module

    loader = loader_module.Loader(redis=redis, session_factory=None)
    task = asyncio.create_task(loader._events_debug_log_listener())
    try:
        await asyncio.sleep(0.2)  # let it subscribe
        message = {
            "entity_id": "vex_tm.main",
            "entity_tags": [],
            "type": "fieldMatchAssigned",
            "timestamp": 1234.5,
            "payload": {"fieldID": 7, "matchNum": 21, "redTeams": ["1A"], "blueTeams": ["2B"]},
        }
        await redis.publish(loader_module.EVENTS_CHANNEL, json.dumps(message))
        for _ in range(50):
            snap = await fs.snapshot(redis)
            if "7" in snap["matches"]:
                break
            await asyncio.sleep(0.1)
        assert snap["matches"]["7"]["payload"]["matchNum"] == 21
        assert await redis.llen(loader_module.DEBUG_LOG_KEY_TMPL.format(entity_id="vex_tm.main")) == 1
    finally:
        loader._shutdown.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
