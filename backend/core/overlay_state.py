"""Last state shown on each overlay, kept in Redis so a reloaded OBS browser source is not blank.

`/ws/overlay/<id>` used to send nothing on connect: after a page reload or a reconnect the overlay stayed
empty until the next event, so a spotlighted team vanished and the match grid disappeared. The WebSocket
fan-out (`backend/routers/ws.py`) now saves each overlay message it builds and replays the saved ones when
an overlay connects.

Key `qecomp:overlay:state:<entity_id>`: a hash with one field per kind, `match` (the last `upcoming_match`
message) and `team` (the last `show_team` message, whose payload team may be null = spotlight cleared), each
the exact JSON message that was broadcast. It expires `TTL_SECONDS` after the last write.

Every node saves what it fans out, so writes carry the event's own timestamp and a save only replaces a
stored message that is not newer (a late node can never roll the state back). Nothing here raises: a Redis
problem must never break the event fan-out or the socket.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

KEY_PREFIX = "qecomp:overlay:state:"
KINDS = ("match", "team")
TTL_SECONDS = 24 * 60 * 60


def key(entity_id: str) -> str:
    return KEY_PREFIX + entity_id


async def save(redis: Any, entity_id: str, kind: str, message: dict[str, Any]) -> None:
    """Stores `message` as the overlay's `kind` state unless a newer one is already there."""
    if kind not in KINDS:
        return
    try:
        raw = await redis.hget(key(entity_id), kind)
        if raw:
            try:
                if float(json.loads(raw).get("timestamp", 0)) > float(message.get("timestamp", 0)):
                    return
            except (TypeError, ValueError, AttributeError):
                pass  # a corrupt stored value is simply replaced
        pipe = redis.pipeline()
        pipe.hset(key(entity_id), kind, json.dumps(message))
        pipe.expire(key(entity_id), TTL_SECONDS)
        await pipe.execute()
    except Exception:  # noqa: BLE001 - best effort by design
        logger.exception("overlay_state: failed to save %s state for %s", kind, entity_id)


async def load(redis: Any, entity_id: str) -> dict[str, dict[str, Any]]:
    """`{kind: message}` for what is stored (empty when nothing is, or on error)."""
    out: dict[str, dict[str, Any]] = {}
    try:
        stored = await redis.hgetall(key(entity_id)) or {}
    except Exception:  # noqa: BLE001
        logger.exception("overlay_state: failed to load state for %s", entity_id)
        return out
    for kind in KINDS:
        raw = stored.get(kind)
        if raw is None:
            continue
        try:
            message = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(message, dict):
            out[kind] = message
    return out


async def clear(redis: Any, entity_id: str) -> None:
    try:
        await redis.delete(key(entity_id))
    except Exception:  # noqa: BLE001
        logger.exception("overlay_state: failed to clear state for %s", entity_id)
