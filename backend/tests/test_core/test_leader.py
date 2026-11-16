"""Tests for backend.modules.leader.LeaderElection against a REAL Redis
instance (the compose Redis, not fakeredis) — genuine lock semantics and
timing matter for HA failover correctness.

Requires REDIS_URL to point at a real reachable Redis (see conftest.py /
compose.yml — `docker compose up -d redis`).
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
import redis.asyncio as redis

from backend.core.settings import settings
from backend.modules.leader import LeaderElection

pytestmark = pytest.mark.asyncio


def _unique_lock_key() -> str:
    return f"tmtools:test:leader:lock:{uuid.uuid4().hex}"


@pytest.fixture
async def redis_client():
    client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await client.ping()
    except Exception:
        pytest.skip("Real Redis not reachable at REDIS_URL; skipping leader election tests")
    yield client
    await client.aclose()


async def test_single_node_acquires_lock(redis_client):
    lock_key = _unique_lock_key()
    election = LeaderElection(
        redis_client, pod_ip="10.0.0.1", port=8000, lock_key=lock_key,
        lock_ttl=5, renew_interval=1,
    )

    promoted = asyncio.Event()

    async def on_promoted():
        promoted.set()

    election.on_promoted = on_promoted

    await election.start()
    try:
        await asyncio.wait_for(promoted.wait(), timeout=5)
        assert election.is_leader() is True
        assert election.get_leader_address() == "10.0.0.1:8000"

        value = await redis_client.get(lock_key)
        assert value == "10.0.0.1:8000"
    finally:
        await election.stop()

    # Lock released on stop().
    assert await redis_client.get(lock_key) is None


async def test_lock_renewed_periodically(redis_client):
    lock_key = _unique_lock_key()
    election = LeaderElection(
        redis_client, pod_ip="10.0.0.2", port=8000, lock_key=lock_key,
        lock_ttl=3, renew_interval=1,
    )
    await election.start()
    try:
        await asyncio.sleep(0.5)
        assert election.is_leader() is True

        # Wait longer than the initial TTL — if renewal works, the key
        # should still exist (and still be held by us).
        await asyncio.sleep(4)
        assert election.is_leader() is True
        ttl = await redis_client.ttl(lock_key)
        assert ttl > 0
    finally:
        await election.stop()


async def test_two_node_failover(redis_client):
    """Two LeaderElection instances contend for the same lock. Exactly one
    becomes leader. When the leader's renewal task is stopped (simulating a
    crash) and its lock is allowed to expire, the standby promotes within the
    TTL window.
    """
    lock_key = _unique_lock_key()
    ttl = 3
    renew_interval = 1

    node_a = LeaderElection(
        redis_client, pod_ip="10.0.0.10", port=8000, lock_key=lock_key,
        lock_ttl=ttl, renew_interval=renew_interval,
    )
    node_b = LeaderElection(
        redis_client, pod_ip="10.0.0.11", port=8000, lock_key=lock_key,
        lock_ttl=ttl, renew_interval=renew_interval,
    )

    a_promoted = asyncio.Event()
    b_promoted = asyncio.Event()
    node_a.on_promoted = a_promoted.set
    node_b.on_promoted = b_promoted.set

    await node_a.start()
    await node_b.start()
    try:
        await asyncio.sleep(2)

        leaders = [n for n in (node_a, node_b) if n.is_leader()]
        assert len(leaders) == 1
        leader, standby = (node_a, node_b) if node_a.is_leader() else (node_b, node_a)

        # Simulate the leader's process dying: cancel its renewal task
        # directly (without going through stop(), which would release the
        # lock cleanly — a real crash wouldn't) and let the lock expire.
        if leader._task is not None:
            leader._task.cancel()
            try:
                await leader._task
            except (asyncio.CancelledError, Exception):
                pass
        leader._is_leader = False

        # Wait for the lock TTL to lapse and the standby to notice and win.
        await asyncio.wait_for(b_promoted.wait() if standby is node_b else a_promoted.wait(), timeout=ttl + renew_interval + 10)

        assert standby.is_leader() is True
    finally:
        for n in (node_a, node_b):
            try:
                await n.stop()
            except Exception:
                pass


async def test_a_non_eligible_node_never_contends_and_does_not_disturb_the_leader(redis_client):
    lock_key = _unique_lock_key()
    worker = LeaderElection(
        redis_client, pod_ip="10.0.0.9", port=8000, lock_key=lock_key, lock_ttl=3, renew_interval=1, eligible=False
    )
    promoted = []

    async def on_promoted():
        promoted.append(1)

    worker.on_promoted = on_promoted
    await worker.start()
    await asyncio.sleep(1.5)
    # Nobody leads yet and the worker still did not take the free lock.
    assert not worker.is_leader() and await redis_client.get(lock_key) is None and promoted == []

    leader = LeaderElection(
        redis_client, pod_ip="10.0.0.1", port=8000, lock_key=lock_key, lock_ttl=3, renew_interval=1
    )
    led = asyncio.Event()

    async def leader_promoted():
        led.set()

    leader.on_promoted = leader_promoted
    await leader.start()
    try:
        await asyncio.wait_for(led.wait(), timeout=5)
        # The worker can see who leads (this is how commands find the leader) but never competes.
        assert await worker.get_leader_address_async() == "10.0.0.1:8000"
        await worker.stop()  # must not release the lock it does not hold
        assert await redis_client.get(lock_key) == "10.0.0.1:8000"
    finally:
        await leader.stop()


async def test_a_non_eligible_node_does_not_take_over_when_the_leader_dies(redis_client):
    lock_key = _unique_lock_key()
    leader = LeaderElection(
        redis_client, pod_ip="10.0.0.1", port=8000, lock_key=lock_key, lock_ttl=2, renew_interval=1
    )
    led = asyncio.Event()

    async def on_promoted():
        led.set()

    leader.on_promoted = on_promoted
    worker = LeaderElection(
        redis_client, pod_ip="10.0.0.9", port=8000, lock_key=lock_key, lock_ttl=2, renew_interval=1, eligible=False
    )
    await leader.start()
    await worker.start()
    await asyncio.wait_for(led.wait(), timeout=5)
    await leader.stop()  # leader goes away, lock released
    await asyncio.sleep(3.5)  # well past the lock TTL
    assert not worker.is_leader() and await redis_client.get(lock_key) is None
    await worker.stop()


def _eligible_nodes(redis_client, lock_key, count, **kw):
    return [
        LeaderElection(
            redis_client, pod_ip=f"10.0.1.{i}", port=8000, lock_key=lock_key, lock_ttl=3, renew_interval=1,
            acquire_jitter=0.3, **kw,
        )
        for i in range(1, count + 1)
    ]


async def test_followers_never_contend_while_a_healthy_leader_holds_the_lock(redis_client):
    lock_key = _unique_lock_key()
    nodes = _eligible_nodes(redis_client, lock_key, 4)
    promotions = []
    for n in nodes:
        async def on_promoted(n=n):
            promotions.append(n._lock_value)

        n.on_promoted = on_promoted

    # Count every SET NX any node sends, so we can tell who tried to take the lock and when.
    attempts = []
    real_set = redis_client.set

    async def counting_set(name, value, *a, **k):
        if name == lock_key and k.get("nx"):
            attempts.append(value)
        return await real_set(name, value, *a, **k)

    redis_client.set = counting_set
    try:
        for n in nodes:
            await n.start()
        await asyncio.sleep(1.5)
        assert len(promotions) == 1
        leader_value = promotions[0]
        attempts_when_settled = len(attempts)
        await asyncio.sleep(7)  # several renewals and lock TTLs
        assert promotions == [leader_value], "a healthy leader must never be displaced"
        assert await redis_client.get(lock_key) == leader_value
        assert len(attempts) == attempts_when_settled, "followers must not even try while a leader holds the lock"
    finally:
        redis_client.set = real_set
        for n in nodes:
            await n.stop()


async def test_when_the_leader_fails_exactly_one_follower_takes_over_and_it_sticks(redis_client):
    lock_key = _unique_lock_key()
    nodes = _eligible_nodes(redis_client, lock_key, 4)
    promotions = []
    for n in nodes:
        async def on_promoted(n=n):
            promotions.append(n)

        n.on_promoted = on_promoted
    for n in nodes:
        await n.start()
    try:
        await asyncio.sleep(1.5)
        first = promotions[0]
        # Simulate a crash: the leader just stops renewing and never releases (kill -9).
        first._task.cancel()
        await asyncio.gather(first._task, return_exceptions=True)
        first._task = None
        await asyncio.sleep(6)  # lock TTL (3 s) + jitter + a poll
        assert len(promotions) == 2 and promotions[1] is not first
        second_value = promotions[1]._lock_value
        assert await redis_client.get(lock_key) == second_value
        await asyncio.sleep(5)  # and it stays put: no flapping back to the crashed node or to others
        assert len(promotions) == 2 and await redis_client.get(lock_key) == second_value
    finally:
        for n in nodes:
            await n.stop()


async def test_a_restarted_former_leader_does_not_take_the_role_back(redis_client):
    lock_key = _unique_lock_key()
    a, b = _eligible_nodes(redis_client, lock_key, 2)
    led = {"a": asyncio.Event(), "b": asyncio.Event()}

    async def pa():
        led["a"].set()

    async def pb():
        led["b"].set()

    a.on_promoted, b.on_promoted = pa, pb
    await a.start()
    await asyncio.wait_for(led["a"].wait(), 5)
    await a.stop()  # graceful shutdown releases the lock
    await b.start()
    await asyncio.wait_for(led["b"].wait(), 5)  # b leads now
    led["a"].clear()
    a2 = _eligible_nodes(redis_client, lock_key, 1)[0]  # "a" comes back after a restart
    a2.on_promoted = pa
    await a2.start()
    try:
        await asyncio.sleep(6)
        assert not led["a"].is_set() and not a2.is_leader()
        assert await redis_client.get(lock_key) == b._lock_value
    finally:
        await a2.stop()
        await b.stop()
