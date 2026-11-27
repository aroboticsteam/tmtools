"""Replay player page route and `/ws/replay` end to end (issue #41).

Sync tests on purpose: Starlette's TestClient runs the app in its own loop and
must not be nested inside an async test."""
from __future__ import annotations

import asyncio
import json
import time

import pytest
import redis as redis_sync
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.testclient import TestClient

from backend.core.settings import settings
from backend.main import app
from backend.modules.capture import replay

def _infra() -> bool:
    async def _check() -> bool:
        engine = create_async_engine(settings.POSTGRES_DSN)
        try:
            async with engine.connect() as conn:
                await conn.exec_driver_sql("SELECT 1")
            redis_sync.Redis.from_url(settings.REDIS_URL).ping()
            return True
        except Exception:
            return False
        finally:
            await engine.dispose()

    return asyncio.run(_check())


needs_infra = pytest.mark.skipif(not _infra(), reason="Real Postgres/Redis not reachable")


@needs_infra
def test_ws_replay_state_on_connect_and_command_forwarding():
    r = redis_sync.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    eid = f"t{int(time.time() * 1000)}"
    r.set(f"tmtools:replay:{eid}:state", json.dumps({"playing": True, "paused": True, "url": "http://x/a.mp4", "label": "L", "rate": 0.5, "loop": False}))
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/replay/{eid}") as ws:
                first = ws.receive_json()
                assert first["type"] == "play" and first["url"] == "http://x/a.mp4" and first["paused"] is True
                r.publish(
                    replay.EVENTS_CHANNEL,
                    json.dumps({"entity_id": eid, "entity_tags": [], "type": "replay_command", "timestamp": time.time(), "payload": {"type": "rate", "value": 0.25}}),
                )
                assert ws.receive_json() == {"type": "rate", "value": 0.25}
            with pytest.raises(Exception):
                with client.websocket_connect("/ws/replay/bad id!"):
                    pass
    finally:
        r.delete(f"tmtools:replay:{eid}:state")
        r.close()


@needs_infra
def test_ws_replay_status_frames_become_replay_status_events():
    r = redis_sync.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    eid = f"s{int(time.time() * 1000)}"
    pubsub = r.pubsub()
    pubsub.subscribe(replay.EVENTS_CHANNEL)
    pubsub.get_message(timeout=1)
    seen: list[dict] = []
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/replay/{eid}") as ws:
                ws.send_text("ping")  # keepalive: ignored
                ws.send_text(json.dumps({"type": "status", "position": 2.5, "duration": 9, "rate": 0.5, "paused": False, "ended": False}))
                deadline = time.time() + 3
                while time.time() < deadline and not any(m["payload"].get("position") == 2.5 for m in seen):
                    msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
                    if msg:
                        data = json.loads(msg["data"])
                        if data.get("entity_id") == eid:
                            seen.append(data)
        assert any(m["type"] == "replay_status" and m["payload"].get("position") == 2.5 and m["payload"]["player"] is True for m in seen)
    finally:
        pubsub.close()
        r.close()
