"""Tests for `backend/routers/public_prompter.py`: the token checks behind the SPA's
teleprompter pages (`/prompter/{entity_id}`, `/prompter`). The pages are React routes; the
page-level 403/404 courtesy checks the old HTML routes made are now JSON API calls."""
from __future__ import annotations

import uuid
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import pytest

from backend.core.security import generate_prompter_token
from backend.core.settings import settings
from backend.models.settings import SystemSetting
from backend.models.timer import TimerInstance

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def test_session_factory():
    engine = create_async_engine(settings.POSTGRES_DSN, future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def client_and_db(test_session_factory):
    from backend.core.db import get_db
    from backend.main import create_app

    app = create_app()

    async def _override_get_db():
        async with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, test_session_factory


async def _make_timer(session_factory, entity_id: str) -> TimerInstance:
    async with session_factory() as session:
        row = TimerInstance(
            entity_id=entity_id, display_name=entity_id, field_set_id=1, field_id=1
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def _cleanup(session_factory, entity_id: str) -> None:
    async with session_factory() as session:
        await session.execute(delete(TimerInstance).where(TimerInstance.entity_id == entity_id))
        await session.commit()


def _unique_entity_id() -> str:
    return f"timer.test_prompter_{uuid.uuid4().hex[:8]}"


async def test_prompter_link_requires_valid_token(client_and_db):
    client, session_factory = client_and_db
    entity_id = _unique_entity_id()
    row = await _make_timer(session_factory, entity_id)
    url = f"/api/v1/public/prompter/{entity_id}"
    try:
        assert (await client.get(url)).status_code == 403  # no token
        assert (await client.get(url, params={"token": "wrong"})).status_code == 403
        token = generate_prompter_token(row.entity_id, row.token_nonce)
        resp = await client.get(url, params={"token": token})
        assert resp.status_code == 200
        assert resp.json() == {"entity_id": entity_id, "display_name": entity_id}
    finally:
        await _cleanup(session_factory, entity_id)


async def test_prompter_link_404_for_unknown_entity(client_and_db):
    client, _ = client_and_db
    resp = await client.get("/api/v1/public/prompter/timer.does_not_exist", params={"token": "x"})
    assert resp.status_code == 404


async def test_prompter_index_is_gated_and_lists_tokenised_links(client_and_db):
    client, session_factory = client_and_db
    entity_id = _unique_entity_id()
    row = await _make_timer(session_factory, entity_id)
    async with session_factory() as session:
        existing = await session.get(SystemSetting, "prompter_index_token")
        previous = existing.value if existing else None
        if existing:
            existing.value = {"token": "index-secret"}
        else:
            session.add(SystemSetting(key="prompter_index_token", value={"token": "index-secret"}))
        await session.commit()
    try:
        assert (await client.get("/api/v1/public/prompter-index")).status_code == 403
        assert (await client.get("/api/v1/public/prompter-index", params={"token": "nope"})).status_code == 403
        rows = (await client.get("/api/v1/public/prompter-index", params={"token": "index-secret"})).json()
        mine = next(r for r in rows if r["entity_id"] == entity_id)
        assert mine["link"] == f"/prompter/{entity_id}?token={generate_prompter_token(row.entity_id, row.token_nonce)}"
    finally:
        async with session_factory() as session:
            setting = await session.get(SystemSetting, "prompter_index_token")
            if setting is not None and previous is None:
                await session.delete(setting)
            elif setting is not None:
                setting.value = previous
            await session.commit()
        await _cleanup(session_factory, entity_id)
