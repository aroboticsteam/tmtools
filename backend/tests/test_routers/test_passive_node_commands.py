"""A passive node (not the leader) serving integration / timer / automation routes through the
Redis command bus, end to end: HTTP route -> command stream -> a "leader" consumer with fake
integration instances, timer manager and automation engine -> reply -> HTTP response.

Needs the real Postgres (like the other router tests) and uses fakeredis for the stream."""
from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.core import command_bus as cb
from backend.core.command_bus import CommandBus
from backend.core.db import engine as app_engine
from backend.core.dependencies import ALL_PERMISSIONS, CurrentPrincipal, get_current_principal
from backend.core.redis import get_redis
from backend.core.settings import settings
from backend.main import app
from backend.models.automation import Automation
from backend.models.integration import IntegrationInstance
from backend.models.timer import TimerInstance
from backend.modules.leader_commands import STATE_KEY_PREFIX, StateMirror, register_handlers

pytestmark = pytest.mark.asyncio


# ── fakes standing in for the leader's live objects ─────────────────────────


class FakeInstance:
    def __init__(self, entity_id: str) -> None:
        self.entity_id = entity_id
        self.calls: list[tuple[str, dict]] = []
        self.tokens: dict | None = None
        self.state = {"connected": True, "scene": "Main"}

    async def call_service(self, service, data):
        self.calls.append((service, data))
        if data.get("scene_name") == "explode":
            raise ValueError("scene exploded")
        if data.get("scene_name") == "missing-field":
            raise KeyError("scene_name")
        if service == "browse_library":
            return {"playlists": ["a", "b"]}
        return {"ok": True, "service": service, "data": data}

    async def get_state(self):
        return self.state

    async def set_oauth_tokens(self, *, access_token, refresh_token, expires_in):
        self.tokens = {"access_token": access_token, "refresh_token": refresh_token, "expires_in": expires_in}


class FakeLoader:
    def __init__(self) -> None:
        self.instances: dict[str, FakeInstance] = {}

    def get_instance(self, entity_id):
        return self.instances.get(entity_id)

    def get_all_instances(self):
        return list(self.instances.values())

    def get_instance_status(self, entity_id):
        return "CONNECTED"


class FakeTimerManager:
    def __init__(self) -> None:
        self.log: list[tuple[str, str]] = []
        self.fail_with: Exception | None = None

    async def _do(self, action, entity_id):
        if self.fail_with:
            raise self.fail_with
        self.log.append((action, entity_id))

    async def start_countdown(self, entity_id):
        await self._do("start", entity_id)

    async def stop_timer(self, entity_id):
        await self._do("stop", entity_id)

    async def reset_timer(self, entity_id):
        await self._do("reset", entity_id)

    def get_state(self, entity_id):
        return {"entity_id": entity_id, "state": "RUNNING" if self.log and self.log[-1][0] == "start" else "IDLE"}


class FakeEngine:
    def __init__(self) -> None:
        self.triggered: list[uuid.UUID] = []
        self.fail_with: Exception | None = None

    async def trigger(self, automation_id, context=None):
        if self.fail_with:
            raise self.fail_with
        self.triggered.append(automation_id)
        return {"automation_id": str(automation_id), "status": "success", "actions_executed": 1, "action_results": []}


class StubLeader:
    def __init__(self, leading: bool) -> None:
        self._leading = leading

    def is_leader(self) -> bool:
        return self._leading


# ── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
async def _reset_app_engine_pool():
    await app_engine.dispose()
    yield
    await app_engine.dispose()


@pytest.fixture
async def db_factory():
    engine = create_async_engine(settings.POSTGRES_DSN)
    try:
        async with engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1")
    except Exception:
        await engine.dispose()
        pytest.skip("Real Postgres not reachable; skipping passive-node router tests")
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def redis():
    client = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    yield client
    await client.aclose()


class Leaderside:
    """What the leader node holds: fake live objects plus a consuming command bus."""

    def __init__(self, redis) -> None:
        self.loader = FakeLoader()
        self.timers = FakeTimerManager()
        self.engine = FakeEngine()
        self.state = SimpleNamespace(loader=self.loader, timer_manager=self.timers, automation_engine=self.engine)
        self.bus = CommandBus(redis, consumer_name="leader")
        register_handlers(self.bus, SimpleNamespace(state=self.state))


@pytest.fixture
async def leaderside(redis):
    side = Leaderside(redis)
    await side.bus.start()
    yield side
    await side.bus.stop()


class FastBus:
    """The passive node's sender with short waits so a missing leader fails quickly in tests."""

    def __init__(self, redis, ttl=3.0) -> None:
        self._bus = CommandBus(redis, consumer_name="passive")
        self._ttl = ttl

    async def send(self, kind, payload, *, target="", ttl=None, timeout=None):
        return await self._bus.send(kind, payload, target=target, ttl=self._ttl, timeout=self._ttl)


@pytest.fixture
def principal():
    return {"p": CurrentPrincipal(subject="test-admin", permissions={ALL_PERMISSIONS})}


@pytest.fixture
async def client(redis, db_factory, principal):
    async def _redis():
        yield redis

    async def _principal():
        return principal["p"]

    app.dependency_overrides[get_redis] = _redis
    app.dependency_overrides[get_current_principal] = _principal
    previous = {k: getattr(app.state, k, None) for k in ("leader", "command_bus", "timer_manager", "automation_engine")}
    app.state.leader = StubLeader(leading=False)
    app.state.command_bus = FastBus(redis)
    app.state.timer_manager = None
    app.state.automation_engine = None
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        for k, v in previous.items():
            setattr(app.state, k, v)
        app.dependency_overrides.pop(get_redis, None)
        app.dependency_overrides.pop(get_current_principal, None)


@pytest.fixture
async def created(db_factory):
    """Entity ids / aliases made by a test, removed afterwards."""
    made = {"integrations": [], "timers": [], "automations": []}
    yield made
    async with db_factory() as session:
        if made["integrations"]:
            await session.execute(delete(IntegrationInstance).where(IntegrationInstance.entity_id.in_(made["integrations"])))
        if made["timers"]:
            await session.execute(delete(TimerInstance).where(TimerInstance.entity_id.in_(made["timers"])))
        if made["automations"]:
            await session.execute(delete(Automation).where(Automation.alias.in_(made["automations"])))
        await session.commit()


def _eid(domain: str) -> str:
    return f"{domain}.pt_{uuid.uuid4().hex[:8]}"


async def _make_obs(client, created) -> str:
    entity_id = _eid("obs")
    created["integrations"].append(entity_id)
    r = await client.post(
        "/api/v1/integrations",
        json={"entity_id": entity_id, "domain": "obs", "display_name": "OBS", "config": {"host": "127.0.0.1", "port": 4455, "password": "x"}, "tags": []},
    )
    assert r.status_code == 201, r.text
    return entity_id


async def _make_spotify(client, created) -> str:
    entity_id = _eid("spotify")
    created["integrations"].append(entity_id)
    r = await client.post(
        "/api/v1/integrations",
        json={"entity_id": entity_id, "domain": "spotify", "display_name": "Spotify", "config": {"client_id": "c", "client_secret": "s", "device_name": "d"}, "tags": []},
    )
    assert r.status_code == 201, r.text
    return entity_id


async def _make_timer(client, created) -> str:
    entity_id = _eid("timer")
    created["timers"].append(entity_id)
    r = await client.post(
        "/api/v1/timers",
        json={"entity_id": entity_id, "display_name": "T", "field_set_id": 1, "field_id": 1, "tags": [], "duration_s": 60},
    )
    assert r.status_code == 201, r.text
    return entity_id


async def _make_automation(client, created) -> str:
    alias = f"pt-{uuid.uuid4().hex[:8]}"
    created["automations"].append(alias)
    r = await client.post(
        "/api/v1/automations",
        json={"alias": alias, "enabled": False, "trigger_yaml": "- platform: state\n  event_type: matchStarted\n", "action_yaml": '- delay: "00:00:01"\n'},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── integration service calls ───────────────────────────────────────────────


async def test_service_call_on_a_passive_node_runs_on_the_leader(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    inst = leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Results graphic"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "service": "switch_scene", "data": {"scene_name": "Results graphic"}}
    assert inst.calls == [("switch_scene", {"scene_name": "Results graphic"})]


async def test_the_leader_node_itself_never_uses_the_bus(client, redis, created, monkeypatch):
    entity_id = await _make_obs(client, created)
    inst = FakeInstance(entity_id)
    monkeypatch.setattr("backend.routers.integrations.loader.get_instance", lambda eid: inst if eid == entity_id else None)

    class Boom:
        async def send(self, *a, **k):
            raise AssertionError("the bus must not be used when the instance is local")

    app.state.command_bus = Boom()
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Main"})
    assert r.status_code == 200 and inst.calls == [("switch_scene", {"scene_name": "Main"})]


async def test_permission_is_checked_on_the_passive_node_before_anything_is_queued(client, redis, leaderside, created, principal):
    entity_id = await _make_obs(client, created)
    inst = leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    principal["p"] = CurrentPrincipal(subject="viewer", permissions={"integrations:read"})
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Main"})
    assert r.status_code == 403
    assert inst.calls == []
    assert await redis.xlen(cb.STREAM) == 0


async def test_invalid_service_data_is_rejected_before_the_bus(client, redis, leaderside, created):
    entity_id = await _make_obs(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={})
    assert r.status_code == 400
    assert await redis.xlen(cb.STREAM) == 0


async def test_leader_side_value_and_key_errors_become_400(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "explode"})
    assert (r.status_code, r.json()["detail"]) == (400, "scene exploded")
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "missing-field"})
    assert r.status_code == 400 and "Missing or invalid field" in r.json()["detail"]


async def test_instance_not_running_on_the_leader_is_503(client, leaderside, created):
    entity_id = await _make_obs(client, created)  # leader's loader has no instance
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Main"})
    assert r.status_code == 503 and "not currently running" in r.json()["detail"]


async def test_no_leader_answering_is_a_504_not_a_hang(client, created):
    entity_id = await _make_obs(client, created)  # no consumer started
    r = await asyncio.wait_for(
        client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Main"}), 8
    )
    assert r.status_code == 504


async def test_a_node_that_is_not_part_of_a_cluster_keeps_the_old_503(client, created):
    app.state.leader = None  # no leader election wired (e.g. unit-test app)
    entity_id = await _make_obs(client, created)
    r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": "Main"})
    assert r.status_code == 503


async def test_unknown_integration_is_404_before_the_bus(client, redis, leaderside):
    r = await client.post("/api/v1/integrations/obs.nope/service/switch_scene", json={"scene_name": "x"})
    assert r.status_code == 404
    assert await redis.xlen(cb.STREAM) == 0


async def test_service_calls_for_one_integration_arrive_in_order(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    inst = leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    for scene in ("A", "B", "C", "D"):
        r = await client.post(f"/api/v1/integrations/{entity_id}/service/switch_scene", json={"scene_name": scene})
        assert r.status_code == 200
    assert [c[1]["scene_name"] for c in inst.calls] == ["A", "B", "C", "D"]


# ── state reads ─────────────────────────────────────────────────────────────


async def test_state_is_served_from_the_redis_mirror_without_asking_the_leader(client, redis, created):
    entity_id = await _make_obs(client, created)
    await redis.set(STATE_KEY_PREFIX + entity_id, json.dumps({"scene": "Mirrored"}), ex=10)
    # No leader consuming: a bus call would 504, so this proves it was answered from Redis.
    r = await client.get(f"/api/v1/integrations/{entity_id}/state")
    assert r.status_code == 200 and r.json()["state"] == {"scene": "Mirrored"}


async def test_state_falls_back_to_the_leader_when_nothing_is_mirrored(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.get(f"/api/v1/integrations/{entity_id}/state")
    assert r.status_code == 200 and r.json()["state"] == {"connected": True, "scene": "Main"}


async def test_state_with_no_mirror_and_no_leader_still_answers_with_status(client, created):
    entity_id = await _make_obs(client, created)
    r = await client.get(f"/api/v1/integrations/{entity_id}/state")
    assert r.status_code == 200 and r.json()["state"] == {}


async def test_a_corrupt_mirror_entry_is_ignored(client, redis, leaderside, created):
    entity_id = await _make_obs(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    await redis.set(STATE_KEY_PREFIX + entity_id, "{not json", ex=10)
    r = await client.get(f"/api/v1/integrations/{entity_id}/state")
    assert r.status_code == 200 and r.json()["state"]["connected"] is True


# ── oauth, connection test, spotify library ─────────────────────────────────


async def test_oauth_token_reaches_the_instance_on_the_leader(client, leaderside, created):
    entity_id = await _make_spotify(client, created)
    inst = leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.post(
        f"/api/v1/integrations/{entity_id}/oauth_token", json={"access_token": "A", "refresh_token": "R", "expires_in": 120}
    )
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert inst.tokens == {"access_token": "A", "refresh_token": "R", "expires_in": 120}


async def test_oauth_token_requires_an_access_token_before_the_bus(client, redis, leaderside, created):
    entity_id = await _make_spotify(client, created)
    r = await client.post(f"/api/v1/integrations/{entity_id}/oauth_token", json={"refresh_token": "R"})
    assert r.status_code == 400
    assert await redis.xlen(cb.STREAM) == 0


async def test_connection_test_runs_on_the_leader(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.post(f"/api/v1/integrations/{entity_id}/test")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["message"] == "CONNECTED"


async def test_connection_test_reports_not_running_when_the_leader_has_no_instance(client, leaderside, created):
    entity_id = await _make_obs(client, created)
    r = await client.post(f"/api/v1/integrations/{entity_id}/test")
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["message"] == "Not running"


async def test_spotify_library_comes_from_the_leader(client, leaderside, created):
    entity_id = await _make_spotify(client, created)
    leaderside.loader.instances[entity_id] = FakeInstance(entity_id)
    r = await client.get(f"/api/v1/integrations/{entity_id}/spotify/library")
    assert r.status_code == 200 and r.json() == {"playlists": ["a", "b"]}


# ── timers ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("action", ["start", "stop", "reset"])
async def test_timer_actions_run_on_the_leader(client, leaderside, created, action):
    entity_id = await _make_timer(client, created)
    r = await client.post(f"/api/v1/timers/{entity_id}/{action}")
    assert r.status_code == 200, r.text
    assert r.json()["entity_id"] == entity_id
    assert leaderside.timers.log == [(action, entity_id)]


async def test_timer_commands_for_one_timer_keep_their_order(client, leaderside, created):
    entity_id = await _make_timer(client, created)
    for action in ("start", "stop", "reset", "start"):
        assert (await client.post(f"/api/v1/timers/{entity_id}/{action}")).status_code == 200
    assert [a for a, _ in leaderside.timers.log] == ["start", "stop", "reset", "start"]


async def test_unknown_timer_is_404_before_the_bus(client, redis, leaderside):
    r = await client.post("/api/v1/timers/timer.ghost/start")
    assert r.status_code == 404
    assert await redis.xlen(cb.STREAM) == 0


async def test_leader_side_timer_error_is_a_404_and_a_missing_manager_a_503(client, leaderside, created):
    entity_id = await _make_timer(client, created)
    leaderside.timers.fail_with = ValueError("Unknown timer")
    r = await client.post(f"/api/v1/timers/{entity_id}/start")
    assert (r.status_code, r.json()["detail"]) == (404, "Unknown timer")
    leaderside.state.timer_manager = None
    r = await client.post(f"/api/v1/timers/{entity_id}/start")
    assert r.status_code == 503


async def test_timer_start_with_no_leader_is_a_504(client, created):
    entity_id = await _make_timer(client, created)
    r = await asyncio.wait_for(client.post(f"/api/v1/timers/{entity_id}/start"), 8)
    assert r.status_code == 504


async def test_timer_start_on_a_node_without_cluster_wiring_is_still_503(client, created):
    app.state.leader = None
    entity_id = await _make_timer(client, created)
    assert (await client.post(f"/api/v1/timers/{entity_id}/start")).status_code == 503


# ── automations ─────────────────────────────────────────────────────────────


async def test_automation_trigger_runs_on_the_leader(client, leaderside, created):
    automation_id = await _make_automation(client, created)
    r = await client.post(f"/api/v1/automations/{automation_id}/trigger")
    assert r.status_code == 200, r.text
    assert r.json()["automation_id"] == automation_id and r.json()["status"] == "success"
    assert leaderside.engine.triggered == [uuid.UUID(automation_id)]


async def test_automation_trigger_errors(client, redis, leaderside, created):
    missing = uuid.uuid4()
    r = await client.post(f"/api/v1/automations/{missing}/trigger")
    assert r.status_code == 404 and await redis.xlen(cb.STREAM) == 0
    automation_id = await _make_automation(client, created)
    leaderside.engine.fail_with = ValueError("gone")
    r = await client.post(f"/api/v1/automations/{automation_id}/trigger")
    assert (r.status_code, r.json()["detail"]) == (404, "gone")
    leaderside.state.automation_engine = None
    assert (await client.post(f"/api/v1/automations/{automation_id}/trigger")).status_code == 503


async def test_automation_trigger_with_no_leader_is_a_504(client, created):
    automation_id = await _make_automation(client, created)
    r = await asyncio.wait_for(client.post(f"/api/v1/automations/{automation_id}/trigger"), 8)
    assert r.status_code == 504


# ── the mirror and the handlers on their own ────────────────────────────────


async def test_state_mirror_writes_every_instance_with_a_ttl_and_skips_broken_ones(redis):
    loader = FakeLoader()
    good = loader.instances["obs.good"] = FakeInstance("obs.good")
    good.state = {"when": __import__("datetime").datetime(2026, 11, 21, 9, 30)}  # not JSON-native
    broken = loader.instances["obs.broken"] = FakeInstance("obs.broken")

    async def explode():
        raise RuntimeError("get_state failed")

    broken.get_state = explode
    slow = loader.instances["obs.slow"] = FakeInstance("obs.slow")

    async def never():
        await asyncio.sleep(30)

    slow.get_state = never
    mirror = StateMirror(redis, lambda: loader)
    await asyncio.wait_for(mirror.mirror_once(), 6)
    assert json.loads(await redis.get(STATE_KEY_PREFIX + "obs.good"))["when"].startswith("2026-11-21")
    assert 0 < await redis.ttl(STATE_KEY_PREFIX + "obs.good") <= 10
    assert await redis.get(STATE_KEY_PREFIX + "obs.broken") is None
    assert await redis.get(STATE_KEY_PREFIX + "obs.slow") is None


async def test_state_mirror_loop_survives_a_missing_loader_and_stops_cleanly(redis):
    holder = {"loader": None}
    mirror = StateMirror(redis, lambda: holder["loader"], interval=0.05)
    await mirror.start()
    await asyncio.sleep(0.2)
    loader = holder["loader"] = FakeLoader()
    loader.instances["obs.x"] = FakeInstance("obs.x")
    await asyncio.sleep(0.3)
    await asyncio.wait_for(mirror.stop(), 2)
    assert await redis.get(STATE_KEY_PREFIX + "obs.x") is not None


async def test_unknown_timer_action_is_rejected_by_the_handler(redis, leaderside):
    with pytest.raises(cb.CommandError) as err:
        await CommandBus(redis).send("timer.action", {"entity_id": "timer.x", "action": "explode"}, ttl=3)
    assert err.value.status == 400
