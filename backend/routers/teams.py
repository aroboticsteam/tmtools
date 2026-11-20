"""Teams API (plan §11 Teams section).

Per §C.2, routers are thin. Photo upload/keying lives in
`routers/team_photos.py`; this module owns the `TeamProfile` CRUD, the logo
upload and the checklist. (The legacy single "360 video" upload, status and
batch endpoints were removed when videos became photos.)
"""
from __future__ import annotations

import logging
import os
from typing import Annotated

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.audit import log_action
from backend.core.dependencies import CurrentPrincipal, get_db, require_permission
from backend.core.exceptions import ProcessingError
from backend.models.team import TeamProfile
from backend.models.team_clip import TeamClip
from backend.modules.site.checklist import checklist_for
from backend.modules.media import images as site_images
from backend.modules.media import s3
from backend.schemas.team import (
    TeamChecklistItem,
    TeamProfileRead,
    TeamProfileUpdate,
)

logger = logging.getLogger(__name__)

_MAX_PROCESSING_ERROR_LEN = 300


def _sanitize_processing_error(exc: BaseException) -> str:
    """Reduces an exception to a short, single-line, caller-safe message.

    The full exception (e.g. `botocore.errorfactory.NoSuchBucket`) is always
    logged server-side with `logger.exception(...)`; only this condensed
    form is ever persisted to `video_processing_error` / returned from
    `/video/status`, so multi-line tracebacks and local filesystem paths
    (e.g. the `tempfile.mkdtemp()` dir used during processing) never reach
    the API response.
    """
    message = str(exc).strip() or type(exc).__name__
    message = message.splitlines()[0].strip()
    if len(message) > _MAX_PROCESSING_ERROR_LEN:
        message = message[: _MAX_PROCESSING_ERROR_LEN - 3] + "..."
    return message

router = APIRouter(prefix="/api/v1/teams", tags=["teams"])

@router.get("", response_model=list[TeamProfileRead], dependencies=[Depends(require_permission("teams:read"))])
async def list_teams(db: Annotated[AsyncSession, Depends(get_db)]) -> list[TeamProfile]:
    result = await db.execute(select(TeamProfile).order_by(TeamProfile.team_number))
    return list(result.scalars())


@router.get(
    "/checklist",
    response_model=list[TeamChecklistItem],
    dependencies=[Depends(require_permission("teams:read"))],
)
async def team_checklist(db: Annotated[AsyncSession, Depends(get_db)]) -> list[dict]:
    """Every team's checklist (inspection, bot photo, team photo), issue #43."""
    profiles = list((await db.execute(select(TeamProfile).order_by(TeamProfile.team_number))).scalars())
    clips: dict[str, dict[str, TeamClip]] = {}
    for clip in (await db.execute(select(TeamClip))).scalars():
        clips.setdefault(clip.team_number, {})[clip.kind] = clip
    return [checklist_for(p, clips.get(p.team_number, {})) for p in profiles]


@router.get(
    "/{number}",
    response_model=TeamProfileRead,
    dependencies=[Depends(require_permission("teams:read"))],
)
async def get_team(number: str, db: Annotated[AsyncSession, Depends(get_db)]) -> TeamProfile:
    team = await db.get(TeamProfile, number)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {number!r} not found")
    return team


@router.put(
    "/{number}",
    response_model=TeamProfileRead,
)
async def update_team(
    number: str,
    body: TeamProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("teams:edit"))],
) -> TeamProfile:
    team = await db.get(TeamProfile, number)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {number!r} not found")

    changed_fields: dict[str, object] = {}
    if body.pit_location is not None:
        team.pit_location = body.pit_location
        changed_fields["pit_location"] = body.pit_location
    if body.extra_notes is not None:
        team.extra_notes = body.extra_notes
        changed_fields["extra_notes"] = body.extra_notes
    if body.website_url is not None:
        team.website_url = body.website_url or None
        changed_fields["website_url"] = team.website_url
    if body.inspection_status is not None:
        team.inspection_status = body.inspection_status
        changed_fields["inspection_status"] = body.inspection_status

    await db.commit()
    await db.refresh(team)
    await log_action(db, principal.subject, "update", "team", number, changes=changed_fields)
    return team


@router.post("/{number}/logo", response_model=TeamProfileRead)
async def upload_team_logo(
    number: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("teams:edit"))],
    file: UploadFile = File(...),
) -> TeamProfile:
    """Public-page logo (PNG/JPEG/GIF/WebP, max 4 MB, content-checked)."""
    team = await db.get(TeamProfile, number)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {number!r} not found")
    data, ext = await site_images.read_validated_image(file)
    key = s3.team_logo_key(number, ext)
    try:
        await site_images.store_image(data, key)
    except ProcessingError as exc:
        raise HTTPException(status_code=502, detail=_sanitize_processing_error(exc)) from exc
    if team.logo_s3_key and team.logo_s3_key != key:
        try:
            await s3.delete_object(team.logo_s3_key)
        except Exception:
            logger.warning("Could not delete previous logo %s", team.logo_s3_key, exc_info=True)
    team.logo_s3_key = key
    await db.commit()
    await db.refresh(team)
    await log_action(db, principal.subject, "upload", "team_logo", number, changes={"key": key})
    return team


@router.delete("/{number}/logo", response_model=TeamProfileRead)
async def delete_team_logo(
    number: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("teams:edit"))],
) -> TeamProfile:
    team = await db.get(TeamProfile, number)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {number!r} not found")
    if team.logo_s3_key:
        try:
            await s3.delete_object(team.logo_s3_key)
        except Exception:
            logger.warning("Could not delete logo %s", team.logo_s3_key, exc_info=True)
        team.logo_s3_key = None
        await db.commit()
        await db.refresh(team)
        await log_action(db, principal.subject, "delete", "team_logo", number)
    return team
