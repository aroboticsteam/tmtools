"""What a station iPad shows on its timer screen: a real timer instance (the Timer-Teleprompter timers).

A station is bound to one timer instance (`STATION_TIMER_KEY`, set when the desk shows that timer on
the station). The display state is read straight from the instance's Redis hash, which the leader's
`TimerManager` keeps current (`tmtools:timer:<entity_id>:state`), so any node can answer for it; live
changes reach the iPad as `timer` messages (see `ConnectionManager._forward_timer_to_stations`).
Nothing here owns timer state; the old ad-hoc station timers are gone.
"""
from __future__ import annotations

from backend.core.brand import REDIS_PREFIX
import time
from typing import Any

STATION_TIMER_KEY = REDIS_PREFIX + "station:{slug}:timer"
BINDING_TTL_SECONDS = 24 * 3600
PHASE_IDLE = "idle"
PHASE_COUNTDOWN = "countdown"


def timer_state_key(entity_id: str) -> str:
    """Must match `backend/modules/timer/manager.py::_state_key`."""
    return REDIS_PREFIX + f"timer:{entity_id}:state"


def display_state(
    raw: dict[str, Any], *, entity_id: str, label: str = "", default_duration: int = 0, now: float | None = None
) -> dict[str, Any]:
    """The same figures `TimerManager.get_state` reports (`phase`, `running`, `duration_s`, `elapsed`,
    `remaining`), derived from the stored hash, plus the instance name for the iPad's heading."""
    now = time.time() if now is None else now
    phase = raw.get("phase") or PHASE_IDLE
    running = raw.get("running") in ("1", "true", "True", True)
    try:
        start_ts = float(raw.get("start_ts") or 0.0)
        duration = int(raw.get("duration_s") or 0) or int(default_duration or 0)
        frozen = int(raw.get("frozen_elapsed") or 0)
    except (TypeError, ValueError):
        start_ts, duration, frozen = 0.0, int(default_duration or 0), 0
    elapsed = max(int(now - start_ts), 0) if running and start_ts > 0 else frozen
    remaining = max(duration - elapsed, 0) if phase == PHASE_COUNTDOWN else 0
    return {
        "entity_id": entity_id,
        "label": label,
        "phase": phase,
        "running": running,
        "duration_s": duration,
        "elapsed": elapsed,
        "remaining": remaining,
    }


async def snapshot(redis: Any, entity_id: str, *, label: str = "", default_duration: int = 0) -> dict[str, Any]:
    """Current display state of one timer instance. An instance that has never run reads as idle."""
    raw = await redis.hgetall(timer_state_key(entity_id)) or {}
    return display_state(raw, entity_id=entity_id, label=label, default_duration=default_duration)
