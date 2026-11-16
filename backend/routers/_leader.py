"""Helpers for routes that need something only the leader has (integrations, timers, automations).

A passive node no longer HTTP-forwards the request to the leader: it checks permissions itself and
sends a command through the Redis command bus (`backend/core/command_bus.py`)."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from backend.core.command_bus import CommandError


def is_passive(request: Request) -> bool:
    """True on a running node that is not the leader (the bus can serve the request)."""
    leader = getattr(request.app.state, "leader", None)
    return leader is not None and not leader.is_leader()


async def run_on_leader(request: Request, kind: str, payload: dict[str, Any], *, target: str = "") -> Any:
    """Run a command on the leader and return its result; failures become HTTP errors with the
    leader's status (400/404/503/...), 504 if nobody answered in time."""
    bus = getattr(request.app.state, "command_bus", None)
    if bus is None:
        raise HTTPException(status_code=503, detail="Cluster command queue is not available")
    try:
        return await bus.send(kind, payload, target=target)
    except CommandError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
