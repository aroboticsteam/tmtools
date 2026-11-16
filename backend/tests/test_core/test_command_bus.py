"""Command bus (leader commands over Redis streams): behaviour, ordering, expiry, failure modes.

Every test runs against fakeredis and, when reachable, a real Redis (db 7 of the test Redis) so
stream / consumer-group / BLPOP semantics are checked on the real thing too."""
from __future__ import annotations

import asyncio
import datetime
import json
import time

import fakeredis
import pytest
import redis.asyncio as real_redis
from fakeredis import aioredis as fake_aioredis

from backend.core import command_bus as cb
from backend.core.command_bus import CommandBus, CommandError
from backend.core.settings import settings

pytestmark = pytest.mark.asyncio


@pytest.fixture(params=["fake", "real"])
async def redis(request):
    if request.param == "fake":
        client = fake_aioredis.FakeRedis(server=fakeredis.FakeServer(), decode_responses=True)
    else:
        url = settings.REDIS_URL.rsplit("/", 1)[0] + "/7"
        client = real_redis.from_url(url, decode_responses=True)
        try:
            await client.ping()
        except Exception:
            pytest.skip("real Redis not reachable")
    await _wipe(client)
    yield client
    await _wipe(client)
    await client.aclose()


async def _wipe(client):
    keys = [k async for k in client.scan_iter(match="tmtools:cmd:*")]
    if keys:
        await client.delete(*keys)


@pytest.fixture
async def leader(redis):
    bus = CommandBus(redis, consumer_name="leader-a")
    yield bus
    await bus.stop()


def sender(redis):
    return CommandBus(redis, consumer_name="passive")


async def test_round_trip_returns_the_handlers_result(redis, leader):
    async def echo(p):
        return {"echo": p["x"], "nested": {"list": [1, 2, 3]}}

    leader.register("echo", echo)
    await leader.start()
    assert await sender(redis).send("echo", {"x": "hi"}) == {"echo": "hi", "nested": {"list": [1, 2, 3]}}


async def test_handler_returning_none_and_non_json_values(redis, leader):
    async def nothing(p):
        return None

    async def odd(p):
        return {"when": datetime.datetime(2026, 11, 21, 9, 30)}

    leader.register("nothing", nothing)
    leader.register("odd", odd)
    await leader.start()
    s = sender(redis)
    assert await s.send("nothing", {}) is None
    assert (await s.send("odd", {}))["when"].startswith("2026-11-21")


async def test_command_error_status_and_detail_reach_the_caller(redis, leader):
    async def missing(p):
        raise CommandError(404, "no such timer")

    leader.register("missing", missing)
    await leader.start()
    with pytest.raises(CommandError) as err:
        await sender(redis).send("missing", {})
    assert (err.value.status, err.value.detail) == (404, "no such timer")


async def test_unexpected_exception_is_a_500_and_the_consumer_keeps_working(redis, leader):
    async def boom(p):
        raise RuntimeError("secret internal detail")

    async def fine(p):
        return "ok"

    leader.register("boom", boom)
    leader.register("fine", fine)
    await leader.start()
    s = sender(redis)
    with pytest.raises(CommandError) as err:
        await s.send("boom", {})
    assert err.value.status == 500 and "secret" not in err.value.detail
    assert await s.send("fine", {}) == "ok"


async def test_unknown_kind_is_501(redis, leader):
    await leader.start()
    with pytest.raises(CommandError) as err:
        await sender(redis).send("nope", {})
    assert err.value.status == 501


async def test_an_expired_command_is_dropped_and_never_run(redis, leader):
    ran = []

    async def handler(p):
        ran.append(p)
        return "ran"

    leader.register("h", handler)
    await leader.start()
    with pytest.raises(CommandError) as err:
        await sender(redis).send("h", {"a": 1}, ttl=-5, timeout=3)
    assert err.value.status == 504 and "expired" in err.value.detail
    assert ran == []


async def test_no_leader_times_out_with_504(redis):
    started = time.monotonic()
    with pytest.raises(CommandError) as err:
        await sender(redis).send("anything", {}, ttl=1, timeout=1)
    assert err.value.status == 504
    assert time.monotonic() - started < 3.5


async def test_a_command_sent_before_any_leader_exists_runs_when_one_appears_in_time(redis, leader):
    async def handler(p):
        return "late but fresh"

    leader.register("h", handler)
    task = asyncio.create_task(sender(redis).send("h", {}, ttl=6))
    await asyncio.sleep(0.5)  # nobody is consuming yet (leader switch in progress)
    await leader.start()
    assert await asyncio.wait_for(task, 5) == "late but fresh"


async def test_a_command_that_waited_too_long_is_not_run_by_the_new_leader(redis, leader):
    ran = []

    async def handler(p):
        ran.append(1)

    leader.register("h", handler)
    with pytest.raises(CommandError):
        await sender(redis).send("h", {}, ttl=1, timeout=1)  # no leader: the caller gave up
    await asyncio.sleep(1.2)  # now past its expiry
    await leader.start()
    await asyncio.sleep(0.6)
    assert ran == []


async def test_a_command_is_run_at_most_once_and_acknowledged_even_if_the_handler_fails(redis, leader):
    calls = []

    async def flaky(p):
        calls.append(1)
        raise RuntimeError("fail")

    leader.register("flaky", flaky)
    await leader.start()
    with pytest.raises(CommandError):
        await sender(redis).send("flaky", {})
    await asyncio.sleep(0.3)
    assert calls == [1]
    pending = await redis.xpending(cb.STREAM, cb.GROUP)
    assert (pending["pending"] if isinstance(pending, dict) else pending[0]) == 0


async def test_commands_for_one_target_run_in_order_even_when_earlier_ones_are_slower(redis, leader):
    order = []

    async def work(p):
        await asyncio.sleep(p["sleep"])
        order.append(p["n"])
        return p["n"]

    leader.register("work", work)
    await leader.start()
    s = sender(redis)
    sends = []
    for n, sleep in enumerate([0.25, 0.15, 0.05, 0.0, 0.1]):
        sends.append(asyncio.create_task(s.send("work", {"n": n, "sleep": sleep}, target="timer.field1")))
        await asyncio.sleep(0.05)  # keep the send order deterministic
    assert [await t for t in sends] == [0, 1, 2, 3, 4]
    assert order == [0, 1, 2, 3, 4]


async def test_different_targets_run_in_parallel(redis, leader):
    async def slow(p):
        await asyncio.sleep(0.4)
        return p["t"]

    leader.register("slow", slow)
    await leader.start()
    s = sender(redis)
    started = time.monotonic()
    results = await asyncio.gather(*[s.send("slow", {"t": i}, target=f"t{i}") for i in range(5)])
    assert results == [0, 1, 2, 3, 4]
    assert time.monotonic() - started < 1.5  # five 0.4 s commands in series would take 2 s


async def test_a_failing_command_does_not_block_the_next_one_for_the_same_target(redis, leader):
    async def maybe(p):
        if p["fail"]:
            raise CommandError(400, "bad")
        return "ok"

    leader.register("maybe", maybe)
    await leader.start()
    s = sender(redis)
    bad = asyncio.create_task(s.send("maybe", {"fail": True}, target="x"))
    await asyncio.sleep(0.05)
    good = asyncio.create_task(s.send("maybe", {"fail": False}, target="x"))
    with pytest.raises(CommandError):
        await bad
    assert await good == "ok"


async def test_many_concurrent_senders_each_get_their_own_answer(redis, leader):
    async def square(p):
        await asyncio.sleep(0.01)
        return p["n"] ** 2

    leader.register("sq", square)
    await leader.start()
    s = sender(redis)
    results = await asyncio.gather(*[s.send("sq", {"n": n}, target=f"t{n % 7}") for n in range(60)])
    assert results == [n * n for n in range(60)]


async def test_two_consumers_never_run_the_same_command_twice(redis):
    seen = []

    def make(name):
        bus = CommandBus(redis, consumer_name=name)

        async def h(p):
            seen.append((name, p["n"]))
            return name

        bus.register("h", h)
        return bus

    a, b = make("a"), make("b")
    await a.start()
    await b.start()
    try:
        s = sender(redis)
        await asyncio.gather(*[s.send("h", {"n": n}, target=f"t{n}") for n in range(40)])
    finally:
        await a.stop()
        await b.stop()
    assert sorted(n for _, n in seen) == list(range(40))  # exactly once each, even with two consumers


async def test_leader_handover_the_new_leader_serves_commands(redis):
    async def h(p):
        return "served"

    a, b = CommandBus(redis, consumer_name="a"), CommandBus(redis, consumer_name="b")
    for bus in (a, b):
        bus.register("h", h)
    await a.start()
    assert await sender(redis).send("h", {}) == "served"
    await a.stop()
    task = asyncio.create_task(sender(redis).send("h", {}, ttl=6))  # sent while nobody leads
    await asyncio.sleep(0.4)
    await b.start()
    try:
        assert await asyncio.wait_for(task, 5) == "served"
    finally:
        await b.stop()


async def test_stop_then_start_again_works_and_start_is_idempotent(redis, leader):
    async def h(p):
        return 1

    leader.register("h", h)
    await leader.start()
    await leader.start()
    assert await sender(redis).send("h", {}) == 1
    await leader.stop()
    await leader.start()
    assert await sender(redis).send("h", {}) == 1


async def test_stop_cancels_inflight_commands_without_hanging(redis, leader):
    async def forever(p):
        await asyncio.sleep(60)

    leader.register("forever", forever)
    await leader.start()
    task = asyncio.create_task(sender(redis).send("forever", {}, ttl=3, timeout=2))
    await asyncio.sleep(0.4)
    await asyncio.wait_for(leader.stop(), 3)
    with pytest.raises(CommandError) as err:
        await task
    assert err.value.status == 504


async def test_reply_keys_are_consumed_and_orphans_expire(redis, leader):
    async def h(p):
        return "x"

    leader.register("h", h)
    await leader.start()
    await sender(redis).send("h", {})
    await asyncio.sleep(0.2)
    assert [k async for k in redis.scan_iter(match=cb.REPLY_PREFIX + "*")] == []  # BLPOP consumed it
    # A reply nobody collects (the sender timed out) must still expire: the leader writes it with a TTL.
    await leader._reply("orphan", 200, result="x")
    assert 0 < await redis.ttl(cb.REPLY_PREFIX + "orphan") <= cb.REPLY_TTL_SECONDS


async def test_large_and_unicode_payloads_survive(redis, leader):
    async def echo(p):
        return p

    leader.register("echo", echo)
    await leader.start()
    payload = {"text": "München – ⚡ " * 5000, "nums": list(range(2000))}
    assert await sender(redis).send("echo", payload) == payload


async def test_redis_failure_is_a_503_not_a_hang_or_crash():
    class Broken:
        async def xadd(self, *a, **k):
            raise ConnectionError("down")

    with pytest.raises(CommandError) as err:
        await CommandBus(Broken()).send("h", {})
    assert err.value.status == 503


async def test_consumer_recovers_when_the_stream_and_group_vanish(redis, leader):
    async def h(p):
        return "back"

    leader.register("h", h)
    await leader.start()
    assert await sender(redis).send("h", {}) == "back"
    await redis.delete(cb.STREAM)  # group disappears (e.g. Redis was flushed)
    await asyncio.sleep(1.5)
    assert await sender(redis).send("h", {}, ttl=8) == "back"


async def test_stream_is_trimmed(redis, leader, monkeypatch):
    monkeypatch.setattr(cb, "STREAM_MAXLEN", 20)

    async def h(p):
        return 1

    leader.register("h", h)
    await leader.start()
    s = sender(redis)
    for _ in range(300):
        await s.send("h", {})
    assert await redis.xlen(cb.STREAM) < 300
