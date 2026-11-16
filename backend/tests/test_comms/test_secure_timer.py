"""Station security, the station timer screen (a real timer instance), presence and agenda ordering/import (issue #27)."""
from __future__ import annotations

import time

import pytest

from backend.modules.comms import access, presence
from backend.modules.comms import station_timer
from backend.models.timer import TimerInstance
from backend.tests.test_comms.test_routers import ctx, events, make_station, session_factory  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio


# ── pure helpers ─────────────────────────────────────────────────────


async def test_pin_hash_and_token_round_trip():
    stored = access.hash_pin("1234")
    assert access.verify_pin("1234", stored) and not access.verify_pin("1235", stored)
    assert access.hash_pin("1234") != stored  # salted
    assert not access.verify_pin("1234", None) and not access.verify_pin("1234", "garbage")

    now = 1_000_000.0
    token = access.issue_token("emcee-1", 3, now=now)
    assert access.verify_token(token, "emcee-1", 3, now=now + 60)
    assert not access.verify_token(token, "emcee-2", 3, now=now + 60)  # other station
    assert not access.verify_token(token, "emcee-1", 4, now=now + 60)  # key/pin changed
    assert not access.verify_token(token, "emcee-1", 3, now=now + access.TOKEN_TTL_SECONDS + 5)  # expired
    assert not access.verify_token(token[:-2] + "00", "emcee-1", 3, now=now)  # tampered
    assert not access.verify_token(None, "emcee-1", 3) and not access.verify_token("no-dot", "emcee-1", 3)


async def test_display_state_follows_the_stored_timer_hash():
    ds = station_timer.display_state
    idle = ds({}, entity_id="t", label="Finals", default_duration=300, now=1000.0)
    assert idle == {"entity_id": "t", "label": "Finals", "phase": "idle", "running": False, "duration_s": 300, "elapsed": 0, "remaining": 0}

    running = {"phase": "countdown", "running": "1", "start_ts": "1000.0", "duration_s": "120", "frozen_elapsed": "0"}
    mid = ds(running, entity_id="t", now=1045.0)
    assert (mid["running"], mid["elapsed"], mid["remaining"], mid["duration_s"]) == (True, 45, 75, 120)
    assert ds(running, entity_id="t", now=5000.0)["remaining"] == 0  # never negative

    match = ds({**running, "phase": "match_running"}, entity_id="t", now=1100.0)
    assert (match["phase"], match["elapsed"], match["remaining"]) == ("match_running", 100, 0)

    stopped = ds({"phase": "idle", "running": "0", "start_ts": "0.0", "duration_s": "120", "frozen_elapsed": "37"}, entity_id="t", now=9999.0)
    assert (stopped["running"], stopped["elapsed"]) == (False, 37)
    assert ds({"phase": "countdown", "running": "1", "start_ts": "junk", "duration_s": "x"}, entity_id="t", default_duration=60, now=1.0)["duration_s"] == 60


async def test_presence_counts_connections_and_remembers_last_seen():
    import fakeredis
    from fakeredis import aioredis as fake_aioredis

    redis = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    try:
        assert await presence.read_presence(redis, ["a"]) == {"a": (False, None)}
        await presence.mark_connected(redis, "a")
        await presence.mark_connected(redis, "a")  # two iPads / tabs
        connected, seen = (await presence.read_presence(redis, ["a"]))["a"]
        assert connected and abs(seen - time.time()) < 5
        await presence.mark_disconnected(redis, "a")
        assert (await presence.read_presence(redis, ["a"]))["a"][0] is True
        await presence.mark_disconnected(redis, "a")
        connected, seen = (await presence.read_presence(redis, ["a"]))["a"]
        assert connected is False and seen is not None
        assert await presence.read_presence(redis, []) == {}
    finally:
        await redis.aclose()


# ── secured links ────────────────────────────────────────────────────


async def test_rotate_link_secures_station_and_revokes_old_links(ctx):
    await make_station(ctx, "emcee-1")
    assert (await ctx.get("/api/v1/public/stations/emcee-1")).status_code == 200  # legacy open link
    assert (await ctx.get("/api/v1/comms/stations/emcee-1/link")).status_code == 404

    first = (await ctx.post("/api/v1/comms/stations/emcee-1/rotate-link")).json()
    assert first["path"] == f"/station/emcee-1?k={first['access_key']}"
    resp = await ctx.get("/api/v1/public/stations/emcee-1")
    assert resp.status_code == 401 and resp.json()["detail"] == "key"
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={"X-Station-Key": "wrong"})).status_code == 401
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={"X-Station-Key": first["access_key"]})).status_code == 200
    assert (await ctx.get(f"/api/v1/public/stations/emcee-1/agenda?k={first['access_key']}")).status_code == 200
    assert (await ctx.get("/api/v1/comms/stations/emcee-1/link")).json()["access_key"] == first["access_key"]

    second = (await ctx.post("/api/v1/comms/stations/emcee-1/rotate-link")).json()
    assert second["access_key"] != first["access_key"]
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={"X-Station-Key": first["access_key"]})).status_code == 401
    listed = {s["slug"]: s for s in (await ctx.get("/api/v1/comms/stations")).json()}
    assert listed["emcee-1"]["secured"] is True and listed["emcee-1"]["has_pin"] is False
    assert "access_key" not in listed["emcee-1"]  # the key is only shown on the manage-only link endpoints

    assert (await ctx.delete("/api/v1/comms/stations/emcee-1/link")).status_code == 204
    assert (await ctx.get("/api/v1/public/stations/emcee-1")).status_code == 200


async def test_secured_station_blocks_inbound_messages_and_next_match(ctx):
    await make_station(ctx, "emcee-1")
    key = (await ctx.post("/api/v1/comms/stations/emcee-1/rotate-link")).json()["access_key"]
    assert (await ctx.post("/api/v1/public/stations/emcee-1/messages", json={"text": "hi"})).status_code == 401
    assert (await ctx.get("/api/v1/public/stations/emcee-1/next-match")).status_code == 401
    ok = await ctx.post("/api/v1/public/stations/emcee-1/messages", json={"text": "hi"}, headers={"X-Station-Key": key})
    assert ok.status_code == 204
    assert (await ctx.get("/api/v1/public/stations/nope")).status_code == 404


async def test_pin_flow_unlock_lockout_and_invalidation(ctx):
    await make_station(ctx, "emcee-1")
    assert (await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": "12ab"})).status_code == 422
    assert (await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": "123"})).status_code == 422
    resp = await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": "4821"})
    assert resp.status_code == 200 and resp.json()["secured"] and resp.json()["has_pin"]
    key = (await ctx.get("/api/v1/comms/stations/emcee-1/link")).json()["access_key"]
    h = {"X-Station-Key": key}

    needs_pin = await ctx.get("/api/v1/public/stations/emcee-1", headers=h)
    assert needs_pin.status_code == 401 and needs_pin.json()["detail"] == "pin"
    assert (await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "4821"})).json()["detail"] == "key"
    assert (await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "0000"}, headers=h)).status_code == 401

    token = (await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "4821"}, headers=h)).json()["token"]
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={**h, "X-Station-Token": token})).status_code == 200
    assert (await ctx.get(f"/api/v1/public/stations/emcee-1/agenda?k={key}&t={token}")).status_code == 200
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={"X-Station-Token": token})).json()["detail"] == "key"

    await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": "9999"})  # changing the PIN revokes tokens
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers={**h, "X-Station-Token": token})).json()["detail"] == "pin"

    for _ in range(10):
        assert (await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "1111"}, headers=h)).status_code == 401
    locked = await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "9999"}, headers=h)
    assert locked.status_code == 429  # even the right PIN waits out the lockout

    assert (await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": None})).json()["has_pin"] is False
    assert (await ctx.get("/api/v1/public/stations/emcee-1", headers=h)).status_code == 200


async def test_unlock_without_pin_and_link_management_needs_manage(ctx):
    await make_station(ctx, "emcee-1")
    assert (await ctx.post("/api/v1/public/stations/emcee-1/unlock", json={"pin": "1234"})).status_code == 409

    from backend.core.dependencies import CurrentPrincipal

    ctx.state["principal"] = CurrentPrincipal(subject="viewer", permissions={"comms:read", "comms:send"})
    assert (await ctx.post("/api/v1/comms/stations/emcee-1/rotate-link")).status_code == 403
    assert (await ctx.put("/api/v1/comms/stations/emcee-1/pin", json={"pin": "1234"})).status_code == 403
    assert (await ctx.delete("/api/v1/comms/stations/emcee-1/link")).status_code == 403
    assert (await ctx.get("/api/v1/comms/stations/emcee-1/link")).status_code == 403


async def test_station_websocket_enforces_the_key(session_factory):  # noqa: F811
    import asyncio

    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from backend.main import create_app
    from backend.models.comms import Station

    async with session_factory() as s:
        s.add(Station(slug="ws-secure", name="WS", role="camera", access_key="sekret", key_version=1))
        await s.commit()

    def drive() -> None:
        with TestClient(create_app()) as client:
            for url in ("/ws/station/ws-secure", "/ws/station/ws-secure?k=nope"):
                with pytest.raises(WebSocketDisconnect):
                    with client.websocket_connect(url):
                        pass
            with client.websocket_connect("/ws/station/ws-secure?k=sekret") as ws:
                ws.send_text("ping")

    await asyncio.to_thread(drive)


# ── presence on the desk list ────────────────────────────────────────


async def test_station_list_reports_presence(ctx):
    await make_station(ctx, "emcee-1")
    before = (await ctx.get("/api/v1/comms/stations")).json()[0]
    assert before["connected"] is False and before["last_seen"] is None
    await presence.mark_connected(ctx.redis, "emcee-1")
    after = (await ctx.get("/api/v1/comms/stations")).json()[0]
    assert after["connected"] is True and abs(after["last_seen"] - time.time()) < 5


# ── the timer screen (a Timer-Teleprompter instance) ─────────────────


async def make_timer(session_factory, entity_id="timer.st-test", name="Finals break", duration=300):
    async with session_factory() as session:
        session.add(TimerInstance(entity_id=entity_id, display_name=name, field_set_id=1, field_id=1, duration_s=duration, tags=[]))
        await session.commit()
    return entity_id


async def drop_timers(session_factory):
    from sqlalchemy import delete

    async with session_factory() as session:
        await session.execute(delete(TimerInstance).where(TimerInstance.entity_id.like("timer.st-test%")))
        await session.commit()


async def test_showing_a_timer_binds_it_to_the_stations_and_they_follow_it(ctx, session_factory):
    await make_station(ctx, "emcee-1")
    await make_station(ctx, "cam-1", role="camera")
    tid = await make_timer(session_factory)
    try:
        sent = await events(ctx, lambda: ctx.post("/api/v1/comms/screen", json={"screen": "timer", "timer": tid, "stations": ["emcee-1"]}))
        timer_events = [e for e in sent if e["type"] == "station_timer"]
        assert len(timer_events) == 1 and timer_events[0]["payload"]["stations"] == ["emcee-1"]
        shown = timer_events[0]["payload"]["timer"]
        assert shown["entity_id"] == tid and shown["label"] == "Finals break" and shown["phase"] == "idle" and shown["duration_s"] == 300
        assert any(e["type"] == "station_screen" and e["payload"] == {"stations": ["emcee-1"], "screen": "timer"} for e in sent)

        public = (await ctx.get("/api/v1/public/stations/emcee-1")).json()
        assert public["screen"] == "timer" and public["timer"]["entity_id"] == tid and public["timer"]["label"] == "Finals break"
        assert "timer" in public["screens"] and abs(public["server_time"] - time.time()) < 5
        other = (await ctx.get("/api/v1/public/stations/cam-1")).json()
        assert other["timer"] is None and other["screen"] == "messages"  # not shown there

        # The instance runs on the leader; the station reads its state from Redis.
        await ctx.redis.hset(
            station_timer.timer_state_key(tid),
            mapping={"phase": "countdown", "running": "1", "start_ts": time.time() - 100, "duration_s": 300, "frozen_elapsed": 0},
        )
        live = (await ctx.get("/api/v1/public/stations/emcee-1")).json()["timer"]
        assert live["running"] is True and live["phase"] == "countdown" and 195 <= live["remaining"] <= 200
    finally:
        await drop_timers(session_factory)


async def test_the_timer_screen_needs_a_real_timer(ctx, session_factory):
    await make_station(ctx, "emcee-1")
    assert (await ctx.post("/api/v1/comms/screen", json={"screen": "timer", "stations": ["emcee-1"]})).status_code == 422
    unknown = await ctx.post("/api/v1/comms/screen", json={"screen": "timer", "timer": "timer.nope", "stations": ["emcee-1"]})
    assert unknown.status_code == 422 and "Unknown timer" in unknown.json()["detail"]
    assert (await ctx.get("/api/v1/public/stations/emcee-1")).json()["screen"] == "messages"
    # The old ad-hoc timer API is gone.
    assert (await ctx.post("/api/v1/comms/timer", json={"action": "start", "duration_seconds": 60})).status_code in (404, 405)


async def test_a_station_whose_timer_was_deleted_falls_back_to_messages(ctx, session_factory):
    await make_station(ctx, "emcee-1")
    tid = await make_timer(session_factory, "timer.st-test-gone")
    await ctx.post("/api/v1/comms/screen", json={"screen": "timer", "timer": tid})
    await drop_timers(session_factory)
    public = (await ctx.get("/api/v1/public/stations/emcee-1")).json()
    assert public["timer"] is None and public["screen"] == "messages"


async def test_showing_a_timer_needs_send_permission(ctx, session_factory):
    from backend.core.dependencies import CurrentPrincipal

    await make_station(ctx, "emcee-1")
    tid = await make_timer(session_factory)
    try:
        ctx.state["principal"] = CurrentPrincipal(subject="viewer", permissions={"comms:read"})
        assert (await ctx.post("/api/v1/comms/screen", json={"screen": "timer", "timer": tid})).status_code == 403
    finally:
        await drop_timers(session_factory)


async def test_timer_events_reach_only_the_stations_showing_that_timer():
    from backend.routers.ws import ConnectionManager

    class FakeWs:
        def __init__(self):
            self.sent = []

        async def accept(self):
            pass

        async def send_json(self, message):
            self.sent.append(message)

    class FakeManager:
        def get_state(self, entity_id):
            return {"entity_id": entity_id, "phase": "countdown", "running": True, "duration_s": 120, "elapsed": 5, "remaining": 115, "tags": ["x"]}

    class FakeRedis:
        bindings = {"station:a": "timer.f1", "station:b": "timer.f2"}

        async def get(self, key):
            slug = key.split(":")[2]
            return self.bindings.get(f"station:{slug}")

    manager = ConnectionManager(redis=FakeRedis())
    manager.get_timer_manager = lambda: FakeManager()
    a, b, c = FakeWs(), FakeWs(), FakeWs()
    await manager.connect("station:a", a)
    await manager.connect("station:b", b)
    await manager.connect("station:c", c)  # never shown a timer

    await manager._dispatch({"entity_id": "timer.f1", "type": "timer_started", "timestamp": 1.0, "payload": {}})
    got = [m for m in a.sent if m.get("type") == "timer"]
    assert len(got) == 1 and got[0]["timer"] == {"entity_id": "timer.f1", "phase": "countdown", "running": True, "duration_s": 120, "elapsed": 5, "remaining": 115}
    assert "server_time" in got[0]
    assert not [m for m in b.sent if m.get("type") == "timer"] and not [m for m in c.sent if m.get("type") == "timer"]


# ── agenda ordering and import ───────────────────────────────────────


async def agenda(ctx, scope="day"):
    return [(i["start_time"], i["title"]) for i in (await ctx.get("/api/v1/comms/agenda")).json() if i["scope"] == scope]


async def add_item(ctx, start, title, **extra):
    resp = await ctx.post("/api/v1/comms/agenda", json={"scope": "day", "start_time": start, "title": title, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_agenda_items_slot_in_by_time_then_can_be_reordered(ctx):
    a = await add_item(ctx, "09:00", "Doors")
    c = await add_item(ctx, "12:00", "Lunch")
    b = await add_item(ctx, "10:30", "Opening")  # lands between the others
    assert await agenda(ctx) == [("09:00", "Doors"), ("10:30", "Opening"), ("12:00", "Lunch")]
    assert [i["position"] for i in (await ctx.get("/api/v1/comms/agenda")).json()] == [0, 1, 2]

    resp = await ctx.put("/api/v1/comms/agenda/order", json={"scope": "day", "ids": [c["id"], a["id"]]})
    assert resp.status_code == 204
    assert await agenda(ctx) == [("12:00", "Lunch"), ("09:00", "Doors"), ("10:30", "Opening")]

    bad = await ctx.put("/api/v1/comms/agenda/order", json={"scope": "day", "ids": ["00000000-0000-0000-0000-000000000000"]})
    assert bad.status_code == 422
    assert (await ctx.put("/api/v1/comms/agenda/order", json={"scope": "day", "ids": [a["id"], a["id"]]})).status_code == 422
    assert (await ctx.put("/api/v1/comms/agenda/order", json={"scope": "weekend", "ids": [a["id"]]})).status_code == 422

    # editing keeps the manual order; an explicit position moves the item
    upd = await ctx.put(f"/api/v1/comms/agenda/{b['id']}", json={"scope": "day", "start_time": "10:45", "title": "Opening ceremony"})
    assert upd.json()["position"] == 2
    moved = await ctx.put(f"/api/v1/comms/agenda/{b['id']}", json={"scope": "day", "start_time": "10:45", "title": "Opening ceremony", "position": 0})
    assert moved.status_code == 200
    assert (await agenda(ctx))[0] == ("10:45", "Opening ceremony")


async def test_station_agenda_follows_manual_order(ctx):
    await make_station(ctx, "emcee-1")
    a = await add_item(ctx, "09:00", "Doors")
    b = await add_item(ctx, "10:00", "Opening")
    await ctx.put("/api/v1/comms/agenda/order", json={"scope": "day", "ids": [b["id"], a["id"]]})
    titles = [i["title"] for i in (await ctx.get("/api/v1/public/stations/emcee-1/agenda?scope=day")).json()]
    assert titles == ["Opening", "Doors"]


async def test_agenda_import_dry_run_errors_replace(ctx):
    text = "# comment\n9:00 Doors open | Teams check in\n10:30-11:00 Opening ceremony\n\n12:00–13:00 Lunch\n"
    preview = (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": text, "dry_run": True})).json()
    assert preview["created"] == 0 and preview["errors"] == [] and [i["start_time"] for i in preview["items"]] == ["09:00", "10:30", "12:00"]
    assert await agenda(ctx) == []  # nothing written by a dry run

    done = (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": text})).json()
    assert done["created"] == 3
    items = (await ctx.get("/api/v1/comms/agenda")).json()
    assert [(i["start_time"], i["end_time"], i["title"], i["details"]) for i in items] == [
        ("09:00", None, "Doors open", "Teams check in"),
        ("10:30", "11:00", "Opening ceremony", None),
        ("12:00", "13:00", "Lunch", None),
    ]

    bad = (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": "13:00 Fine\nnot a line\n25:00 Bad hour\n"})).json()
    assert bad["created"] == 0 and [e["line"] for e in bad["errors"]] == [2, 3]
    assert len(await agenda(ctx)) == 3  # all-or-nothing

    appended = (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": "14:00 Judging"})).json()
    assert appended["created"] == 1 and (await agenda(ctx))[-1] == ("14:00", "Judging")
    replaced = (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": "08:00 Setup", "replace": True})).json()
    assert replaced["created"] == 1 and await agenda(ctx) == [("08:00", "Setup")]
    assert (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "day", "text": "   \n# only comments\n"})).json()["errors"][0]["line"] == 1
    assert (await ctx.post("/api/v1/comms/agenda/import", json={"scope": "nope", "text": "09:00 x"})).status_code == 422
