"""Last known state of every field, kept in Redis.

Match Control used to build its field cards only from `tmtools:events` messages the browser saw
while the page was open, so a page opened mid-match (or after a reload, or on another device)
showed nothing until the next event. The leader's event listener (`backend/loader.py`) now calls
`record()` for every event, and `GET /api/v1/fields/state` (`backend/routers/fields.py`, answered
from Redis by any node) returns `snapshot()` so the page can seed itself on load and on reconnect.

Keys:
  `tmtools:field:state`          hash: field key -> JSON `{type, entity_id, timestamp, payload}`, the
                                 latest `fieldMatchAssigned` per `payload.fieldID` and the latest
                                 `upcoming_match` per `entity_id` (the same keys the frontend's
                                 `currentMatches` uses).
  `tmtools:field:events:<id>`    list, newest first, the last `MAX_EVENTS` events of any type that
                                 carried that `payload.fieldID` (`{type, entity_id, timestamp}`).
Both expire after `TTL_SECONDS` without an update, so a finished event does not linger.
"""
from __future__ import annotations

from backend.core.brand import REDIS_PREFIX

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

STATE_KEY = REDIS_PREFIX + "field:state"
EVENTS_PREFIX = REDIS_PREFIX + "field:events:"
AUDIENCE_KEY = REDIS_PREFIX + "field:audience"  # hash: entity_id -> JSON {display, timestamp}; one per TM, not per field
MAX_EVENTS = 5
TTL_SECONDS = 24 * 60 * 60


def _field_id(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("fieldID")
    return None if value is None or value == "" else str(value)


async def record(redis: Any, event: dict[str, Any]) -> None:
    """Folds one decoded `EventBusMessage` into the field state. Never raises."""
    try:
        etype = event.get("type")
        payload = event.get("payload")
        entity_id = event.get("entity_id")
        timestamp = event.get("timestamp")
        field_id = _field_id(payload)
        if etype == "audienceDisplayChanged" and entity_id and isinstance(payload, dict) and payload.get("display"):
            # The audience display belongs to the whole TM instance, whichever field the event was pinned to.
            audience = redis.pipeline()
            audience.hset(AUDIENCE_KEY, str(entity_id), json.dumps({"display": str(payload["display"]), "timestamp": timestamp}))
            audience.expire(AUDIENCE_KEY, TTL_SECONDS)
            await audience.execute()
        state_key = None
        if etype == "fieldMatchAssigned" and field_id is not None:
            state_key = field_id
        elif etype == "upcoming_match" and entity_id:
            state_key = str(entity_id)
        if state_key is None and field_id is None:
            return
        pipe = redis.pipeline()
        if state_key is not None:
            pipe.hset(
                STATE_KEY,
                state_key,
                json.dumps({"type": etype, "entity_id": entity_id, "timestamp": timestamp, "payload": payload}),
            )
            pipe.expire(STATE_KEY, TTL_SECONDS)
        if field_id is not None:
            key = EVENTS_PREFIX + field_id
            row = {"type": etype, "entity_id": entity_id, "timestamp": timestamp}
            if etype == "audienceDisplayChanged" and isinstance(payload, dict) and payload.get("display"):
                row["display"] = str(payload["display"])  # lets a reload still tell IN_MATCH (countdown) apart
            pipe.lpush(key, json.dumps(row))
            pipe.ltrim(key, 0, MAX_EVENTS - 1)
            pipe.expire(key, TTL_SECONDS)
        await pipe.execute()
    except Exception:  # noqa: BLE001 - recording must never break the event listener
        logger.exception("field_state: failed to record event")


async def snapshot(redis: Any) -> dict[str, Any]:
    """`{"matches": {...}, "events": {fieldID: [..newest first]}, "audience": {entity_id: {display, timestamp}}}`."""
    matches: dict[str, Any] = {}
    for key, raw in (await redis.hgetall(STATE_KEY) or {}).items():
        try:
            matches[key if isinstance(key, str) else key.decode()] = json.loads(raw)
        except (TypeError, ValueError):
            continue
    events: dict[str, list[Any]] = {}
    async for key in redis.scan_iter(match=EVENTS_PREFIX + "*", count=100):
        key = key if isinstance(key, str) else key.decode()
        rows = []
        for raw in await redis.lrange(key, 0, MAX_EVENTS - 1):
            try:
                rows.append(json.loads(raw))
            except (TypeError, ValueError):
                continue
        if rows:
            events[key[len(EVENTS_PREFIX):]] = rows
    audience: dict[str, Any] = {}
    for key, raw in (await redis.hgetall(AUDIENCE_KEY) or {}).items():
        try:
            audience[key if isinstance(key, str) else key.decode()] = json.loads(raw)
        except (TypeError, ValueError):
            continue
    return {"matches": matches, "events": events, "audience": audience}
