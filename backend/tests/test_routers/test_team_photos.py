"""Tests for routers/team_photos.py: photo upload -> real ffmpeg keying -> (mocked)
S3, status reporting, the public overlay feed, and permissions."""
from __future__ import annotations

import shutil
import subprocess
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.core.db import engine as app_engine
from backend.core.exceptions import ProcessingError
from backend.core.settings import settings
from backend.models.team import TeamProfile
from backend.models.team_clip import TeamClip

pytestmark = pytest.mark.asyncio

FFMPEG = shutil.which("ffmpeg") is not None


@pytest.fixture(autouse=True)
async def _reset_pool():
    await app_engine.dispose()
    yield
    await app_engine.dispose()


@pytest.fixture
async def factory():
    engine = create_async_engine(settings.POSTGRES_DSN)
    try:
        async with engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1 FROM team_clips LIMIT 1")
    except Exception:
        await engine.dispose()
        pytest.skip("Real Postgres (migrated) not reachable; skipping clip tests")
    yield async_sessionmaker(bind=engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def team(factory):
    number = f"C{uuid.uuid4().hex[:6]}"
    yield number
    async with factory() as session:
        await session.execute(delete(TeamClip).where(TeamClip.team_number == number))
        await session.execute(delete(TeamProfile).where(TeamProfile.team_number == number))
        await session.commit()


@pytest.fixture
def s3_mock(monkeypatch):
    from backend.routers import team_photos

    upload = AsyncMock()
    monkeypatch.setattr(team_photos.s3, "upload_multipart", upload)
    monkeypatch.setattr(team_photos.s3, "generate_presigned_url", AsyncMock(side_effect=lambda key: f"https://s3.test/{key}"))
    return upload


def _client(permissions):
    from backend.core.dependencies import CurrentPrincipal, get_current_principal
    from backend.main import app

    async def _principal():
        return CurrentPrincipal(subject="tester", permissions=set(permissions))

    app.dependency_overrides[get_current_principal] = _principal
    return app, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def admin():
    from backend.core.dependencies import get_current_principal

    app, client = _client({"*"})
    async with client:
        yield client
    app.dependency_overrides.pop(get_current_principal, None)


def _rgba(png: bytes) -> tuple[int, int, bytes]:
    """Decode a PNG to raw RGBA with ffmpeg (no Pillow in this repo)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", "-"],
        input=png, capture_output=True, check=True,
    ).stdout.decode().strip().split(",")
    assert probe[2] == "rgba"
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
        input=png, capture_output=True, check=True,
    ).stdout
    return int(probe[0]), int(probe[1]), raw


def _make_photo(path, ext="jpg"):
    """400x300 green (key colour) frame with a red 200x150 'robot' in the middle."""
    out = path / f"photo.{ext}"
    if FFMPEG:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x00B140:s=400x300,drawbox=x=100:y=75:w=200:h=150:color=red:t=fill",
             "-frames:v", "1", str(out)],
            check=True, capture_output=True,
        )
    return out


@pytest.fixture(scope="module")
def green_photo(tmp_path_factory):
    return _make_photo(tmp_path_factory.mktemp("photos"))


async def test_photos_status_empty_then_unknown_kind(admin, team):
    resp = await admin.get(f"/api/v1/teams/{team}/photos")
    assert resp.status_code == 200
    photos = resp.json()["photos"]
    assert photos["bot_photo"]["status"] == "NONE" and photos["team_photo"]["status"] == "NONE"
    resp = await admin.post(f"/api/v1/teams/{team}/photos/robot", files={"file": ("a.jpg", b"x", "image/jpeg")})
    assert resp.status_code == 404


async def test_rejects_bad_extension(admin, team, s3_mock):
    for name in ("a.exe", "a.mp4", "a.gif", "noext"):
        resp = await admin.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": (name, b"x", "application/octet-stream")})
        assert resp.status_code == 400, name
    s3_mock.assert_not_awaited()


async def test_rejects_renamed_non_image(admin, team, s3_mock):
    resp = await admin.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.png", b"MZ not a png at all", "image/png")})
    assert resp.status_code == 400
    s3_mock.assert_not_awaited()


async def test_rejects_oversize(admin, team, s3_mock, monkeypatch):
    from backend.routers import team_photos

    monkeypatch.setattr(team_photos, "MAX_PHOTO_BYTES", 1024)
    resp = await admin.post(
        f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.jpg", b"\xff\xd8\xff" + b"0" * 4096, "image/jpeg")}
    )
    assert resp.status_code == 413
    s3_mock.assert_not_awaited()


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
async def test_upload_processes_both_kinds_to_transparent_png(admin, team, s3_mock, green_photo, factory):
    data = green_photo.read_bytes()
    captured: dict[str, bytes] = {}

    async def _capture(path, key):
        with open(path, "rb") as fh:
            captured[key] = fh.read()

    s3_mock.side_effect = _capture
    for kind in ("bot_photo", "team_photo"):
        resp = await admin.post(f"/api/v1/teams/{team}/photos/{kind}", files={"file": ("shot.jpg", data, "image/jpeg")})
        assert resp.status_code == 202
        assert resp.json()["kind"] == kind

    photos = (await admin.get(f"/api/v1/teams/{team}/photos")).json()["photos"]
    assert photos["bot_photo"]["status"] == "DONE" and photos["team_photo"]["status"] == "DONE"
    assert photos["bot_photo"]["processed_s3_key"] == f"teams/{team}/photos/bot_photo/processed.png"
    assert photos["team_photo"]["processed_s3_key"] == f"teams/{team}/photos/team_photo/processed.png"
    assert f"teams/{team}/photos/bot_photo/raw.jpg" in captured

    w, h, raw = _rgba(captured[f"teams/{team}/photos/bot_photo/processed.png"])
    assert (w, h) == (400, 300)
    px = lambda x, y: raw[(y * w + x) * 4 : (y * w + x) * 4 + 4]
    assert px(5, 5)[3] == 0          # key-colour background is transparent
    assert px(200, 150)[3] == 255    # subject stays opaque
    assert px(200, 150)[0] > 200     # ... and keeps its colour


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
async def test_png_and_webp_accepted_and_resolution_capped(admin, team, s3_mock, tmp_path):
    big = tmp_path / "big.png"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x00B140:s=4000x1000", "-frames:v", "1", str(big)],
        check=True, capture_output=True,
    )
    captured: dict[str, bytes] = {}

    async def _capture(path, key):
        with open(path, "rb") as fh:
            captured[key] = fh.read()

    s3_mock.side_effect = _capture
    resp = await admin.post(f"/api/v1/teams/{team}/photos/team_photo", files={"file": ("big.png", big.read_bytes(), "image/png")})
    assert resp.status_code == 202
    w, h, _ = _rgba(captured[f"teams/{team}/photos/team_photo/processed.png"])
    assert (w, h) == (2000, 500)


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
async def test_webp_accepted(admin, team, s3_mock, tmp_path):
    try:
        webp = _make_photo(tmp_path, "webp")
    except subprocess.CalledProcessError:
        pytest.skip("this ffmpeg build cannot encode webp")
    resp = await admin.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.webp", webp.read_bytes(), "image/webp")})
    assert resp.status_code == 202


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
async def test_processing_failure_is_reported(admin, team, s3_mock):
    # Valid JPEG magic, garbage body: passes the sniff, fails in ffmpeg.
    resp = await admin.post(
        f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.jpg", b"\xff\xd8\xff garbage", "image/jpeg")}
    )
    assert resp.status_code == 202
    photo = (await admin.get(f"/api/v1/teams/{team}/photos")).json()["photos"]["bot_photo"]
    assert photo["status"] == "FAILED" and photo["error"]


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")
async def test_reupload_replaces_failed_state(admin, team, s3_mock, green_photo):
    await admin.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.jpg", b"\xff\xd8\xffjunk", "image/jpeg")})
    await admin.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.jpg", green_photo.read_bytes(), "image/jpeg")})
    photo = (await admin.get(f"/api/v1/teams/{team}/photos")).json()["photos"]["bot_photo"]
    assert photo["status"] == "DONE" and photo["error"] is None


async def test_batch_photo_urls(admin, team, factory, s3_mock):
    async with factory() as session:
        session.add(TeamProfile(team_number=team))
        session.add(TeamClip(team_number=team, kind="bot_photo", status="DONE", processed_s3_key=f"teams/{team}/photos/bot_photo/processed.png"))
        # An old video row must be ignored.
        session.add(TeamClip(team_number=team, kind="team", status="DONE", processed_s3_key="old.webm"))
        await session.commit()
    body = (await admin.get(f"/api/v1/teams/batch/photos?teams={team}")).json()
    assert body["photos"][team] == {"bot_photo": f"https://s3.test/teams/{team}/photos/bot_photo/processed.png", "team_photo": None}
    assert (await admin.get("/api/v1/teams/batch/photos?teams=" + ",".join(f"T{i}" for i in range(13)))).status_code == 422


async def test_public_overlay_feed(admin, team, factory, s3_mock):
    async with factory() as session:
        session.add(
            TeamProfile(
                team_number=team,
                robot_name="Bolt",
                cached_stats={
                    "team_name": "Gearsquad",
                    "organisation": "Example School",
                    "location": "London, United Kingdom",
                    "ranking": {"rank": 3},
                    "skills_rank": 2,
                },
            )
        )
        session.add(TeamClip(team_number=team, kind="team_photo", status="DONE", processed_s3_key=f"teams/{team}/photos/team_photo/processed.png"))
        await session.commit()
    # Public: no auth principal needed beyond the (overridden) default.
    resp = await admin.get(f"/api/v1/public/overlay/teams?teams={team},NOPE")
    assert resp.status_code == 200
    info = resp.json()["teams"][team]
    assert info["team_name"] == "Gearsquad" and info["organisation"] == "Example School"
    assert info["country"] == "United Kingdom" and info["qual_rank"] == 3 and info["skills_rank"] == 2
    assert info["team_url"] == f"https://s3.test/teams/{team}/photos/team_photo/processed.png"
    assert info["bot_url"] is None
    assert resp.json()["teams"]["NOPE"]["team_name"] is None


async def test_public_overlay_ignores_legacy_video(admin, team, factory, s3_mock):
    async with factory() as session:
        session.add(
            TeamProfile(team_number=team, video_360_s3_key=f"teams/{team}/video/processed.webm", video_processing_status="DONE")
        )
        session.add(TeamClip(team_number=team, kind="bot", status="DONE", processed_s3_key="old.webm"))
        await session.commit()
    info = (await admin.get(f"/api/v1/public/overlay/teams?teams={team}")).json()["teams"][team]
    assert info["bot_url"] is None and info["team_url"] is None


async def test_public_overlay_limits_and_presign_failures(admin, team, factory, monkeypatch, s3_mock):
    assert (await admin.get("/api/v1/public/overlay/teams?teams=" + ",".join(f"T{i}" for i in range(13)))).status_code == 422
    async with factory() as session:
        session.add(TeamClip(team_number=team, kind="bot_photo", status="DONE", processed_s3_key="k"))
        session.add(TeamProfile(team_number=team))
        await session.commit()
    from backend.routers import team_photos

    monkeypatch.setattr(team_photos.s3, "generate_presigned_url", AsyncMock(side_effect=ProcessingError("boom")))
    info = (await admin.get(f"/api/v1/public/overlay/teams?teams={team}")).json()["teams"][team]
    assert info["bot_url"] is None


async def test_upload_requires_video_upload_permission(team, s3_mock):
    from backend.core.dependencies import get_current_principal

    app, client = _client({"teams:read"})
    try:
        async with client:
            resp = await client.post(f"/api/v1/teams/{team}/photos/bot_photo", files={"file": ("a.jpg", b"x", "image/jpeg")})
            assert resp.status_code == 403
            assert (await client.get(f"/api/v1/teams/{team}/photos")).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_principal, None)


async def test_public_overlay_robot_name_flag_follows_setting(admin, team, factory, s3_mock):
    from backend.models.settings import SystemSetting

    async with factory() as session:
        session.add(TeamProfile(team_number=team, robot_name="Sparky"))
        await session.commit()
    try:
        body = (await admin.get(f"/api/v1/public/overlay/teams?teams={team}")).json()
        assert body["show_robot_name"] is False and body["teams"][team]["robot_name"] == "Sparky"

        async with factory() as session:
            row = await session.get(SystemSetting, "overlay")
            if row is None:
                session.add(SystemSetting(key="overlay", value={"show_robot_name": True}))
            else:
                row.value = {"show_robot_name": True}
            await session.commit()
        assert (await admin.get(f"/api/v1/public/overlay/teams?teams={team}")).json()["show_robot_name"] is True
    finally:
        async with factory() as session:
            row = await session.get(SystemSetting, "overlay")
            if row is not None:
                await session.delete(row)
                await session.commit()
