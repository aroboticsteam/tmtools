"""Chroma-keyed team photos (replaces the earlier recorded video clips).

Staff upload two photos per team ("bot_photo" and "team_photo", taken in front
of the team's key colour); each is keyed to a transparent PNG (same ffmpeg
`colorkey` settings the videos used) and stored in S3.

`GET /api/v1/public/overlay/teams` is the unauthenticated, display-safe feed
the OBS overlay page reads (no auth on overlays, by design — see
`OverlayPage.tsx`): team info plus presigned photo URLs, nothing else.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import Annotated, Any

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.audit import log_action
from backend.core.dependencies import CurrentPrincipal, get_db, require_permission
from backend.core.exceptions import ProcessingError
from backend.models.settings import SystemSetting
from backend.models.team import TeamProfile
from backend.models.team_clip import TeamClip
from backend.modules.media import s3
from backend.modules.media.processor import process_image
from backend.routers.teams import _sanitize_processing_error
from backend.schemas.team import (
    BatchPhotoUrlsResponse,
    OverlayTeam,
    OverlayTeamsResponse,
    PhotoUploadAccepted,
    TeamPhotosRead,
    TeamPhotoStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["team-photos"])

ALLOWED_PHOTO_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PHOTO_BYTES = 15 * 1024 * 1024
MAX_OVERLAY_TEAMS = 12


def _check_kind(kind: str) -> str:
    if kind not in s3.PHOTO_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown photo kind {kind!r}; expected one of {s3.PHOTO_KINDS}")
    return kind


def _looks_like_image(head: bytes, ext: str) -> bool:
    """Magic-byte check so a renamed non-image is refused before it is stored."""
    if ext in ("jpg", "jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    return head[:4] == b"RIFF" and head[8:12] == b"WEBP"


def _status(number: str, kind: str, row: TeamClip | None) -> TeamPhotoStatus:
    if row is None:
        return TeamPhotoStatus(team_number=number, kind=kind)
    return TeamPhotoStatus(
        team_number=number, kind=kind, status=row.status, processed_s3_key=row.processed_s3_key, error=row.error
    )


# Registered before the `{number}` route so `batch` is not read as a team number.
@router.get(
    "/api/v1/teams/batch/photos",
    response_model=BatchPhotoUrlsResponse,
    dependencies=[Depends(require_permission("teams:read"))],
)
async def batch_photo_urls(teams: str, db: Annotated[AsyncSession, Depends(get_db)]) -> BatchPhotoUrlsResponse:
    """Presigned processed-photo URLs for `?teams=1234A,5678B` (max 12)."""
    numbers = list(dict.fromkeys(t.strip() for t in teams.split(",") if t.strip()))
    if len(numbers) > MAX_OVERLAY_TEAMS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_OVERLAY_TEAMS} teams per request")
    return BatchPhotoUrlsResponse(photos=await photo_urls_for(db, numbers))


@router.get(
    "/api/v1/teams/{number}/photos",
    response_model=TeamPhotosRead,
    dependencies=[Depends(require_permission("teams:read"))],
)
async def get_team_photos(number: str, db: Annotated[AsyncSession, Depends(get_db)]) -> TeamPhotosRead:
    rows = {
        r.kind: r for r in (await db.execute(select(TeamClip).where(TeamClip.team_number == number))).scalars()
    }
    return TeamPhotosRead(team_number=number, photos={k: _status(number, k, rows.get(k)) for k in s3.PHOTO_KINDS})


@router.post("/api/v1/teams/{number}/photos/{kind}", response_model=PhotoUploadAccepted, status_code=202)
async def upload_team_photo(
    number: str,
    kind: str,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("video:upload"))],
    file: UploadFile = File(...),
    key_colour: str = Form("#00B140"),
    similarity: float = Form(0.1),
    blend: float = Form(0.05),
) -> PhotoUploadAccepted:
    _check_kind(kind)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail=f"Unsupported file extension {ext!r}; expected one of {sorted(ALLOWED_PHOTO_EXTENSIONS)}"
        )

    tmp_dir = tempfile.mkdtemp(prefix=f"tmtools-photo-{number}-{kind}-")
    input_path = os.path.join(tmp_dir, f"raw.{ext}")
    written = 0
    try:
        async with aiofiles.open(input_path, "wb") as out:
            while chunk := await file.read(8 * 1024 * 1024):
                written += len(chunk)
                if written > MAX_PHOTO_BYTES:
                    raise HTTPException(status_code=413, detail="Photo is too large (15 MB maximum)")
                if written == len(chunk) and not _looks_like_image(chunk[:16], ext):
                    raise HTTPException(status_code=400, detail=f"File content is not a valid .{ext} image")
                await out.write(chunk)
    except BaseException:
        _cleanup(input_path, None, tmp_dir)
        raise

    if await db.get(TeamProfile, number) is None:
        db.add(TeamProfile(team_number=number))
    row = await db.get(TeamClip, (number, kind))
    if row is None:
        row = TeamClip(team_number=number, kind=kind)
        db.add(row)
    row.status, row.error = "PROCESSING", None
    await db.commit()
    await log_action(db, principal.subject, "upload", "team_photo", f"{number}/{kind}", changes={"filename": file.filename})

    background_tasks.add_task(_process_and_upload_photo, number, kind, input_path, ext, key_colour, similarity, blend, tmp_dir)
    return PhotoUploadAccepted(team_number=number, kind=kind)


def _cleanup(input_path: str, output_path: str | None, tmp_dir: str) -> None:
    for path in (input_path, output_path):
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except OSError:
            pass
    try:
        os.rmdir(tmp_dir)
    except OSError:
        pass


async def _set_photo_state(number: str, kind: str, **fields: Any) -> None:
    from backend.core.db import async_session_factory

    async with async_session_factory() as session:
        row = await session.get(TeamClip, (number, kind))
        if row is not None:
            for key, value in fields.items():
                setattr(row, key, value)
            await session.commit()


async def _process_and_upload_photo(
    number: str, kind: str, input_path: str, ext: str, key_colour: str, similarity: float, blend: float, tmp_dir: str
) -> None:
    output_path = os.path.join(tmp_dir, "processed.png")
    raw_key = s3.photo_raw_key(number, kind, ext)
    processed_key = s3.photo_processed_key(number, kind)
    try:
        raw_result, process_result = await asyncio.gather(
            s3.upload_multipart(input_path, raw_key),
            process_image(input_path, output_path, key_colour, similarity, blend),
            return_exceptions=True,
        )
        if not isinstance(raw_result, BaseException):
            await _set_photo_state(number, kind, raw_s3_key=raw_key)
        for result in (process_result, raw_result):
            if isinstance(result, BaseException):
                raise result
        await s3.upload_multipart(output_path, processed_key)
        await _set_photo_state(number, kind, processed_s3_key=processed_key, status="DONE", error=None)
    except Exception as exc:
        logger.exception("Photo processing failed for %s/%s", number, kind)
        await _set_photo_state(number, kind, status="FAILED", error=_sanitize_processing_error(exc))
    finally:
        _cleanup(input_path, output_path, tmp_dir)


def _clean_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None and not isinstance(value, bool) else None
    except (TypeError, ValueError):
        return None


def _overlay_team(number: str, profile: TeamProfile | None, urls: dict[str, str | None]) -> OverlayTeam:
    stats: dict[str, Any] = (profile.cached_stats if profile and isinstance(profile.cached_stats, dict) else {}) or {}
    ranking = stats.get("ranking")
    location = stats.get("location")
    country = stats.get("country") if isinstance(stats.get("country"), str) else None
    if country is None and isinstance(location, str) and "," in location:
        country = location.rsplit(",", 1)[1].strip() or None
    return OverlayTeam(
        team_number=number,
        team_name=stats.get("team_name"),
        organisation=stats.get("organisation"),
        location=location if isinstance(location, str) else None,
        country=country,
        qual_rank=_clean_int(ranking.get("rank")) if isinstance(ranking, dict) else None,
        skills_rank=_clean_int(stats.get("skills_rank")),
        robot_name=profile.robot_name if profile else None,
        bot_url=urls.get("bot_photo"),
        team_url=urls.get("team_photo"),
    )


async def photo_urls_for(db: AsyncSession, numbers: list[str]) -> dict[str, dict[str, str | None]]:
    """Presigned processed-photo URLs per team and kind ("bot_photo",
    "team_photo"); a missing photo (or failed presign) is None."""
    rows: dict[tuple[str, str], TeamClip] = {
        (c.team_number, c.kind): c
        for c in (await db.execute(select(TeamClip).where(TeamClip.team_number.in_(numbers)))).scalars()
    }
    out: dict[str, dict[str, str | None]] = {}
    for number in numbers:
        urls: dict[str, str | None] = {}
        for kind in s3.PHOTO_KINDS:
            row = rows.get((number, kind))
            key = row.processed_s3_key if row and row.status == "DONE" else None
            try:
                urls[kind] = await s3.generate_presigned_url(key) if key else None
            except ProcessingError:
                logger.exception("Failed to presign %s for team %s", kind, number)
                urls[kind] = None
        out[number] = urls
    return out


@router.get("/api/v1/public/overlay/teams", response_model=OverlayTeamsResponse)
async def public_overlay_teams(teams: str, db: Annotated[AsyncSession, Depends(get_db)]) -> OverlayTeamsResponse:
    """Display info + presigned photo URLs for `?teams=1234A,5678B` (max 12)."""
    numbers = list(dict.fromkeys(t.strip() for t in teams.split(",") if t.strip()))
    if len(numbers) > MAX_OVERLAY_TEAMS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_OVERLAY_TEAMS} teams per request")
    profiles = {
        p.team_number: p for p in (await db.execute(select(TeamProfile).where(TeamProfile.team_number.in_(numbers)))).scalars()
    }
    urls = await photo_urls_for(db, numbers)
    setting = await db.get(SystemSetting, "overlay")
    show_robot_name = bool(isinstance(setting.value, dict) and setting.value.get("show_robot_name")) if setting else False
    return OverlayTeamsResponse(
        teams={n: _overlay_team(n, profiles.get(n), urls[n]) for n in numbers}, show_robot_name=show_robot_name
    )
