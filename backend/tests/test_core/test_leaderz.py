"""`/leaderz`: 200 only on the node holding the leader lock (health check for leader-only routing)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import create_app

pytestmark = pytest.mark.asyncio


class _Leader:
    def __init__(self, leading):
        self._leading = leading

    def is_leader(self):
        return self._leading


async def _get(leader):
    app = create_app()
    if leader != "unset":
        app.state.leader = leader
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        return await c.get("/leaderz")


async def test_the_leader_answers_200():
    r = await _get(_Leader(True))
    assert (r.status_code, r.json()) == (200, {"leader": True})


async def test_a_follower_answers_503():
    r = await _get(_Leader(False))
    assert (r.status_code, r.json()) == (503, {"leader": False})


async def test_a_node_that_has_not_started_election_answers_503():
    r = await _get("unset")
    assert r.status_code == 503 and r.json() == {"leader": False}
