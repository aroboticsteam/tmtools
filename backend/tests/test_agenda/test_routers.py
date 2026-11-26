"""Event agenda API against real Postgres + fakeredis."""
from __future__ import annotations

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.core.settings import settings
from backend.models.agenda import AgendaItem

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def session_factory():
    engine = create_async_engine(settings.POSTGRES_DSN, future=True)
    try:
        async with engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1 FROM agenda_items LIMIT 1")
    except Exception:
        await engine.dispose()
        pytest.skip("Real Postgres (migrated) not reachable; skipping agenda tests")
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)

    async def wipe():
        async with factory() as session:
            await session.execute(delete(AgendaItem))
            await session.commit()

    await wipe()
    yield factory
    await wipe()
    await engine.dispose()


@pytest.fixture
async def ctx(session_factory):
    from backend.core.db import get_db
    from backend.core.dependencies import ALL_PERMISSIONS, CurrentPrincipal, get_current_principal, get_redis
    from backend.main import create_app

    redis = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    app = create_app()
    state = {"principal": CurrentPrincipal(subject="tester", permissions={ALL_PERMISSIONS})}

    async def _db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_redis] = lambda: redis
    app.dependency_overrides[get_current_principal] = lambda: state["principal"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.state, client.redis, client.app_ = state, redis, app
        yield client
    await redis.aclose()


async def test_agenda_crud(ctx):
    a = (await ctx.post("/api/v1/comms/agenda", json={"scope": "day", "start_time": "10:30", "end_time": "13:00", "title": "Quals"})).json()
    await ctx.post("/api/v1/comms/agenda", json={"scope": "day", "start_time": "08:30", "title": "Open"})
    assert [i["title"] for i in (await ctx.get("/api/v1/comms/agenda")).json()] == ["Open", "Quals"]
    assert (await ctx.put(f"/api/v1/comms/agenda/{a['id']}", json={"scope": "finals", "start_time": "16:00", "title": "Finals"})).json()["scope"] == "finals"
    assert (await ctx.post("/api/v1/comms/agenda", json={"scope": "day", "start_time": "9am", "title": "x"})).status_code == 422
    assert (await ctx.delete(f"/api/v1/comms/agenda/{a['id']}")).status_code == 204
    assert (await ctx.delete(f"/api/v1/comms/agenda/{a['id']}")).status_code == 404


async def test_permissions(ctx):
    from backend.core.dependencies import CurrentPrincipal

    ctx.state["principal"] = CurrentPrincipal(subject="viewer", permissions={"comms:read"})
    assert (await ctx.get("/api/v1/comms/agenda")).status_code == 200
    assert (await ctx.post("/api/v1/comms/agenda", json={"scope": "day", "start_time": "09:00", "title": "x"})).status_code == 403
    ctx.state["principal"] = CurrentPrincipal(subject="nobody", permissions=set())
    assert (await ctx.get("/api/v1/comms/agenda")).status_code == 403
