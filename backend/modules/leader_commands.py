"""What the leader does when another container sends it a command (see `core/command_bus.py`),
and the mirror that lets passive containers answer integration state reads from Redis.

The handlers look up the leader-only objects on `app.state` at call time, so they are
registered once and keep working across promotion and demotion (a demoted node simply stops
consuming the stream).
"""
from __future__ import annotations

from backend.core.brand import REDIS_PREFIX
import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import FastAPI

from backend.core.command_bus import CommandBus, CommandError

logger = logging.getLogger(__name__)

STATE_KEY_PREFIX = REDIS_PREFIX + "integration:state:"
STATE_TTL_SECONDS = 10
STATE_MIRROR_INTERVAL_SECONDS = 2.0


def _instance(app: FastAPI, entity_id: str) -> Any:
    loader = getattr(app.state, "loader", None)
    instance = loader.get_instance(entity_id) if loader is not None else None
    if instance is None:
        raise CommandError(503, f"Integration {entity_id!r} is not currently running")
    return instance


def register_handlers(bus: CommandBus, app: FastAPI) -> None:
    async def integration_service(p: dict[str, Any]) -> Any:
        instance = _instance(app, p["entity_id"])
        try:
            return await instance.call_service(p["service"], p.get("data") or {})
        except ValueError as exc:
            raise CommandError(400, str(exc)) from exc
        except KeyError as exc:
            raise CommandError(400, f"Missing or invalid field: {exc}") from exc

    async def integration_state(p: dict[str, Any]) -> Any:
        return await _instance(app, p["entity_id"]).get_state()

    async def integration_oauth_token(p: dict[str, Any]) -> Any:
        instance = _instance(app, p["entity_id"])
        set_tokens = getattr(instance, "set_oauth_tokens", None)
        if set_tokens is None:
            raise CommandError(500, "Integration instance does not support OAuth tokens")
        await set_tokens(
            access_token=p["access_token"],
            refresh_token=p.get("refresh_token"),
            expires_in=int(p.get("expires_in", 3600)),
        )
        return {"ok": True}

    async def integration_test(p: dict[str, Any]) -> Any:
        entity_id = p["entity_id"]
        loader = getattr(app.state, "loader", None)
        instance = loader.get_instance(entity_id) if loader is not None else None
        if instance is None:
            return {"ok": False, "message": "Not running", "detail": f"Integration {entity_id!r} is not currently running"}
        try:
            await instance.get_state()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "message": "Connection check failed", "detail": str(exc)}
        status = loader.get_instance_status(entity_id)
        return {"ok": status == "CONNECTED", "message": status, "detail": None}

    async def spotify_library(p: dict[str, Any]) -> Any:
        try:
            return await _instance(app, p["entity_id"]).call_service("browse_library", {})
        except ValueError as exc:
            raise CommandError(400, str(exc)) from exc

    async def timer_action(p: dict[str, Any]) -> Any:
        manager = getattr(app.state, "timer_manager", None)
        if manager is None:
            raise CommandError(503, "TimerManager is not running on the leader")
        action = {"start": manager.start_countdown, "stop": manager.stop_timer, "reset": manager.reset_timer}.get(
            p["action"]
        )
        if action is None:
            raise CommandError(400, f"Unknown timer action {p['action']!r}")
        try:
            await action(p["entity_id"])
        except ValueError as exc:
            raise CommandError(404, str(exc)) from exc
        return manager.get_state(p["entity_id"])

    async def automation_trigger(p: dict[str, Any]) -> Any:
        engine = getattr(app.state, "automation_engine", None)
        if engine is None:
            raise CommandError(503, "AutomationEngine is not running on the leader")
        try:
            return await engine.trigger(UUID(p["automation_id"]), {})
        except ValueError as exc:
            raise CommandError(404, str(exc)) from exc

    bus.register("integration.service", integration_service)
    bus.register("integration.state", integration_state)
    bus.register("integration.oauth_token", integration_oauth_token)
    bus.register("integration.test", integration_test)
    bus.register("integration.spotify_library", spotify_library)
    bus.register("timer.action", timer_action)
    bus.register("automation.trigger", automation_trigger)


class StateMirror:
    """Leader-only: copies every running integration's `get_state()` into Redis every couple of
    seconds so a passive container can answer `GET /integrations/{id}/state` without asking the
    leader. The copy expires after `STATE_TTL_SECONDS`, so a dead leader's state goes stale
    instead of lingering."""

    def __init__(self, redis: Any, get_loader: Any, interval: float = STATE_MIRROR_INTERVAL_SECONDS) -> None:
        self._redis = redis
        self._get_loader = get_loader
        self._interval = interval
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="integration-state-mirror")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self) -> None:
        while True:
            try:
                await self.mirror_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.debug("state mirror pass failed", exc_info=True)
            await asyncio.sleep(self._interval)

    async def mirror_once(self) -> None:
        loader = self._get_loader()
        if loader is None:
            return
        for instance in loader.get_all_instances():
            try:
                state = await asyncio.wait_for(instance.get_state(), timeout=2.0)
                await self._redis.set(
                    STATE_KEY_PREFIX + instance.entity_id, json.dumps(state, default=str), ex=STATE_TTL_SECONDS
                )
            except Exception:  # noqa: BLE001 - one bad integration must not stop the others
                logger.debug("could not mirror state of %s", getattr(instance, "entity_id", "?"), exc_info=True)
