"""Tests for routers/teams.py (plan §14, against real Postgres per the task's
verification requirement — `httpx.AsyncClient` + `ASGITransport` against the
real FastAPI app, matching the pattern in tests/test_core/test_health.py)."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import create_async_engine

from backend.core.db import engine as app_engine
from backend.core.settings import settings
from backend.main import app
from backend.models.team import TeamProfile

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _reset_app_engine_pool():
    """`backend.core.db.engine` is a module-level singleton bound to
    whichever event loop was running when its connection pool first opened a
    connection. Since pytest-asyncio gives each test function its own event
    loop by default, reusing a pooled connection from a previous test's loop
    raises `RuntimeError: ... attached to a different loop`. Disposing the
    pool before each test forces fresh connections to be opened lazily
    against the *current* test's loop.
    """
    await app_engine.dispose()
    yield
    await app_engine.dispose()


@pytest.fixture
async def db_engine():
    engine = create_async_engine(settings.POSTGRES_DSN)
    try:
        async with engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1")
    except Exception:
        pytest.skip("Real Postgres not reachable; skipping teams router tests")
    yield engine
    await engine.dispose()


@pytest.fixture
async def client():
    from backend.core.dependencies import ALL_PERMISSIONS, CurrentPrincipal, get_current_principal

    # This file tests CRUD/business logic, not RBAC itself (that's covered
    # by `tests/test_core/test_rbac.py`) — bypass auth with an
    # all-permissions principal so requests here don't need a real
    # session/API key.
    async def _override_get_current_principal():
        return CurrentPrincipal(subject="test-admin", permissions={ALL_PERMISSIONS})

    app.dependency_overrides[get_current_principal] = _override_get_current_principal
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_current_principal, None)


@pytest.fixture
async def seeded_team(db_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    factory = async_sessionmaker(bind=db_engine, expire_on_commit=False)
    number = f"T{uuid.uuid4().hex[:6]}"
    async with factory() as session:
        session.add(
            TeamProfile(
                team_number=number,
                pit_location="Bay 1",
                bio="A team",
                video_processing_status="NONE",
            )
        )
        await session.commit()

    yield number

    async with factory() as session:
        await session.execute(delete(TeamProfile).where(TeamProfile.team_number == number))
        await session.commit()


async def test_get_team_404_when_missing(client):
    resp = await client.get(f"/api/v1/teams/does-not-exist-{uuid.uuid4().hex}")
    assert resp.status_code == 404


async def test_list_teams_includes_seeded_team(client, seeded_team):
    resp = await client.get("/api/v1/teams")
    assert resp.status_code == 200
    numbers = [t["team_number"] for t in resp.json()]
    assert seeded_team in numbers


async def test_get_team_returns_profile(client, seeded_team):
    resp = await client.get(f"/api/v1/teams/{seeded_team}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_number"] == seeded_team
    assert body["pit_location"] == "Bay 1"


async def test_update_team_edits_pit_location_and_notes(client, seeded_team):
    resp = await client.put(
        f"/api/v1/teams/{seeded_team}",
        json={"pit_location": "Bay 42", "extra_notes": "Bring extra batteries"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["pit_location"] == "Bay 42"
    assert body["extra_notes"] == "Bring extra batteries"

    # Persisted.
    resp2 = await client.get(f"/api/v1/teams/{seeded_team}")
    assert resp2.json()["pit_location"] == "Bay 42"


async def test_update_team_404_when_missing(client):
    resp = await client.put(
        f"/api/v1/teams/does-not-exist-{uuid.uuid4().hex}",
        json={"pit_location": "X"},
    )
    assert resp.status_code == 404


async def test_update_team_rejects_oversized_pit_location(client, seeded_team):
    """Regression test (code-review finding): TeamProfileUpdate.pit_location
    must reject values longer than the `String(100)` DB column so an
    oversized value gets a clean 422, not an unhandled DataError at commit."""
    resp = await client.put(
        f"/api/v1/teams/{seeded_team}",
        json={"pit_location": "x" * 101},
    )
    assert resp.status_code == 422


async def test_update_team_rejects_unknown_fields(client, seeded_team):
    resp = await client.put(
        f"/api/v1/teams/{seeded_team}",
        json={"video_360_s3_key": "should-not-be-editable-via-this-endpoint"},
    )
    assert resp.status_code == 422


async def test_update_inspection_status_and_checklist(client, seeded_team):
    resp = await client.put(f"/api/v1/teams/{seeded_team}", json={"inspection_status": "PASSED"})
    assert resp.status_code == 200
    assert resp.json()["inspection_status"] == "PASSED"
    listing = await client.get("/api/v1/teams/checklist")
    assert listing.status_code == 200
    row = next(r for r in listing.json() if r["team_number"] == seeded_team)
    assert row["inspection"] == "PASSED"
    assert (row["done"], row["total"], row["complete"]) == (1, 3, False)
    assert (row["bot_photo"], row["team_photo"]) == (False, False)


async def test_inspection_status_rejects_unknown_value(client, seeded_team):
    resp = await client.put(f"/api/v1/teams/{seeded_team}", json={"inspection_status": "MAYBE"})
    assert resp.status_code == 422
    assert (await client.get(f"/api/v1/teams/{seeded_team}")).json()["inspection_status"] == "NOT_STARTED"


async def test_checklist_reflects_done_photos(client, seeded_team, db_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from backend.models.team_clip import TeamClip

    factory = async_sessionmaker(bind=db_engine, expire_on_commit=False)
    async with factory() as session:
        session.add(TeamClip(team_number=seeded_team, kind="bot_photo", status="DONE"))
        session.add(TeamClip(team_number=seeded_team, kind="team_photo", status="PROCESSING"))
        await session.commit()
    try:
        row = next(r for r in (await client.get("/api/v1/teams/checklist")).json() if r["team_number"] == seeded_team)
        assert (row["bot_photo"], row["team_photo"], row["done"]) == (True, False, 1)
    finally:
        async with factory() as session:
            await session.execute(delete(TeamClip).where(TeamClip.team_number == seeded_team))
            await session.commit()


async def test_checklist_route_is_not_shadowed_by_team_number(client):
    # "/checklist" must hit the list route, not get_team(number="checklist")
    resp = await client.get("/api/v1/teams/checklist")
    assert resp.status_code == 200 and isinstance(resp.json(), list)
