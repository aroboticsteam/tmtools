"""`ensure_integration`: the capture integration is created when an agent first connects."""
from __future__ import annotations

import json

import fakeredis.aioredis
import pytest
from sqlalchemy.exc import IntegrityError

from backend.core.brand import REDIS_PREFIX
from backend.modules.capture import service


class _Result:
    def __init__(self, found: bool) -> None:
        self._found = found

    def first(self):
        return (1,) if self._found else None


class _Session:
    def __init__(self, store: dict) -> None:
        self.store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _stmt):
        return _Result(bool(self.store["rows"]))

    def add(self, row) -> None:
        self.store["pending"] = row

    async def commit(self) -> None:
        if self.store.get("conflict"):
            raise IntegrityError("insert", {}, Exception("duplicate"))
        self.store["rows"].append(self.store.pop("pending"))

    async def rollback(self) -> None:
        self.store.pop("pending", None)


def _factory(store: dict):
    return lambda: _Session(store)


@pytest.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


async def test_creates_named_after_agent_id_and_announces(redis):
    store: dict = {"rows": []}
    pubsub = redis.pubsub()
    await pubsub.subscribe(REDIS_PREFIX + "config_change")
    await pubsub.get_message(timeout=0.1)

    entity_id = await service.ensure_integration(redis, _factory(store), "agent-1a2b3c")

    assert entity_id == "capture.agent-1a2b3c"
    row = store["rows"][0]
    assert (row.entity_id, row.domain, row.enabled) == ("capture.agent-1a2b3c", "capture", True)
    msg = await pubsub.get_message(timeout=1)
    assert msg is not None and json.loads(msg["data"])["payload"]["action"] == "created"


async def test_does_nothing_when_a_capture_integration_exists(redis):
    store: dict = {"rows": [object()]}
    assert await service.ensure_integration(redis, _factory(store), "agent-x") is None
    assert len(store["rows"]) == 1


async def test_sanitises_the_agent_id(redis):
    store: dict = {"rows": []}
    entity_id = await service.ensure_integration(redis, _factory(store), "My Laptop/ø 1")
    assert entity_id == "capture.My-Laptop-1"
    assert await service.ensure_integration(redis, _factory({"rows": []}), None) == "capture.agent"


async def test_lost_race_is_not_an_error(redis):
    store: dict = {"rows": [], "conflict": True}
    assert await service.ensure_integration(redis, _factory(store), "agent-1") is None
