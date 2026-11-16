"""Overlay state kept in Redis (`backend/core/overlay_state.py`)."""
from __future__ import annotations

import json

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis

from backend.core import overlay_state as os_

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def redis():
    client = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    yield client
    await client.aclose()


def msg(type_, ts, **payload):
    return {"entity_id": "overlay.f1", "entity_tags": ["finals"], "type": type_, "timestamp": ts, "payload": payload}


async def test_save_then_load_round_trips_both_kinds(redis):
    await os_.save(redis, "overlay.f1", "match", msg("upcoming_match", 10.0, matchNum=4, redTeams=["1A"]))
    await os_.save(redis, "overlay.f1", "team", msg("show_team", 11.0, team="1234A"))
    state = await os_.load(redis, "overlay.f1")
    assert state["match"]["payload"]["matchNum"] == 4 and state["match"]["entity_tags"] == ["finals"]
    assert state["team"]["payload"] == {"team": "1234A"} and state["team"]["type"] == "show_team"


async def test_overlays_are_independent(redis):
    await os_.save(redis, "overlay.a", "team", msg("show_team", 1.0, team="1A"))
    assert await os_.load(redis, "overlay.b") == {}
    assert (await os_.load(redis, "overlay.a"))["team"]["payload"]["team"] == "1A"


async def test_a_newer_message_replaces_and_an_older_one_never_does(redis):
    await os_.save(redis, "o", "team", msg("show_team", 10.0, team="NEW"))
    await os_.save(redis, "o", "team", msg("show_team", 5.0, team="STALE"))  # a slow node arriving late
    assert (await os_.load(redis, "o"))["team"]["payload"]["team"] == "NEW"
    await os_.save(redis, "o", "team", msg("show_team", 12.0, team="NEWER"))
    assert (await os_.load(redis, "o"))["team"]["payload"]["team"] == "NEWER"


async def test_equal_timestamp_is_idempotent(redis):
    for _ in range(3):  # every node saves the same event
        await os_.save(redis, "o", "match", msg("upcoming_match", 7.0, matchNum=1))
    assert (await os_.load(redis, "o"))["match"]["payload"]["matchNum"] == 1


async def test_a_cleared_spotlight_is_stored_so_it_stays_cleared(redis):
    await os_.save(redis, "o", "team", msg("show_team", 1.0, team="1A"))
    await os_.save(redis, "o", "team", msg("show_team", 2.0, team=None))
    assert (await os_.load(redis, "o"))["team"]["payload"]["team"] is None


async def test_state_expires(redis):
    await os_.save(redis, "o", "match", msg("upcoming_match", 1.0))
    assert 0 < await redis.ttl(os_.key("o")) <= os_.TTL_SECONDS


async def test_unknown_kind_is_ignored_and_corrupt_values_are_skipped_or_replaced(redis):
    await os_.save(redis, "o", "bogus", msg("x", 1.0))
    assert await os_.load(redis, "o") == {}
    await redis.hset(os_.key("o"), "match", "{not json")
    await redis.hset(os_.key("o"), "team", json.dumps(["not", "a", "dict"]))
    assert await os_.load(redis, "o") == {}
    await os_.save(redis, "o", "match", msg("upcoming_match", 3.0, matchNum=2))  # replaces the corrupt value
    assert (await os_.load(redis, "o"))["match"]["payload"]["matchNum"] == 2


async def test_clear_removes_everything(redis):
    await os_.save(redis, "o", "match", msg("upcoming_match", 1.0))
    await os_.save(redis, "o", "team", msg("show_team", 1.0, team="1A"))
    await os_.clear(redis, "o")
    assert await os_.load(redis, "o") == {}


async def test_a_second_reader_sees_what_another_node_saved():
    server = fakeredis.FakeServer()
    a = fake_aioredis.FakeRedis(server=server, decode_responses=True)
    b = fake_aioredis.FakeRedis(server=server, decode_responses=True)
    await os_.save(a, "o", "team", msg("show_team", 1.0, team="1A"))
    assert (await os_.load(b, "o"))["team"]["payload"]["team"] == "1A"
    await a.aclose()
    await b.aclose()


async def test_redis_failures_never_raise():
    class Broken:
        def __getattr__(self, name):
            raise ConnectionError("down")

    await os_.save(Broken(), "o", "team", msg("show_team", 1.0, team="1A"))
    assert await os_.load(Broken(), "o") == {}
    await os_.clear(Broken(), "o")
