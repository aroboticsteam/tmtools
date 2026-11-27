"""Token-gated JSON behind the SPA's teleprompter pages (`/prompter`, `/prompter/{entity_id}`).

The pages themselves are React routes; the page-level courtesy checks the old HTML routes made
(so a stale link fails loudly instead of showing a dead page) live here as API calls. Real
authorisation still happens at `WS /ws/prompter/{entity_id}`.
"""
from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.dependencies import get_db
from backend.core.security import generate_prompter_token, validate_prompter_token
from backend.models.settings import SystemSetting
from backend.models.timer import TimerInstance
from backend.routers.timers import get_timer_or_404

router = APIRouter(prefix="/api/v1/public", tags=["public-prompter"])

#: `system_settings.key` gating the teleprompter index.
_PROMPTER_INDEX_SETTINGS_KEY = "prompter_index_token"


class PrompterLinkOut(BaseModel):
    entity_id: str
    display_name: str


class PrompterIndexEntry(PrompterLinkOut):
    link: str


@router.get("/prompter/{entity_id}", response_model=PrompterLinkOut)
async def check_prompter_link(
    entity_id: str, session: Annotated[AsyncSession, Depends(get_db)], token: str = ""
) -> PrompterLinkOut:
    """404 for an unknown timer, 403 for a missing/stale per-instance HMAC token (constant-time)."""
    row = await get_timer_or_404(session, entity_id)
    if not validate_prompter_token(row.entity_id, row.token_nonce, token):
        raise HTTPException(status_code=403, detail="Invalid or expired teleprompter token")
    return PrompterLinkOut(entity_id=row.entity_id, display_name=row.display_name)


@router.get("/prompter-index", response_model=list[PrompterIndexEntry])
async def prompter_index(
    session: Annotated[AsyncSession, Depends(get_db)], token: str = ""
) -> list[PrompterIndexEntry]:
    """Every active timer with its own tokenised teleprompter link.

    Gated by the single shared `?token=` stored in the `prompter_index_token` setting (403 when it
    is missing, unset or wrong; compared in constant time). Possessing it grants nothing beyond what
    the returned per-instance links already encode.
    """
    setting = await session.get(SystemSetting, _PROMPTER_INDEX_SETTINGS_KEY)
    expected = setting.value.get("token") if setting is not None and isinstance(setting.value, dict) else None
    if not expected or not token or not secrets.compare_digest(expected, token):
        raise HTTPException(status_code=403, detail="Invalid or missing prompter index token")
    result = await session.execute(
        select(TimerInstance).where(TimerInstance.enabled.is_(True)).order_by(TimerInstance.display_name)
    )
    return [
        PrompterIndexEntry(
            entity_id=i.entity_id,
            display_name=i.display_name,
            link=f"/prompter/{i.entity_id}?token={generate_prompter_token(i.entity_id, i.token_nonce)}",
        )
        for i in result.scalars().all()
    ]
