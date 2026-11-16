"""Field state snapshot for Match Control (`backend/core/field_state.py`).

Read-only and answered from Redis, so any node (including a passive one) serves it."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from redis.asyncio import Redis as AsyncRedis

from backend.core import field_state
from backend.core.dependencies import require_permission
from backend.core.redis import get_redis

router = APIRouter(
    prefix="/api/v1/fields",
    tags=["fields"],
    dependencies=[Depends(require_permission("integrations:read"))],
)


@router.get("/state")
async def get_field_state(redis: Annotated[AsyncRedis, Depends(get_redis)]) -> dict[str, Any]:
    """The latest match assigned to each field and each field's last few events, as recorded by the leader."""
    return await field_state.snapshot(redis)
