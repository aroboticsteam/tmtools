"""Redis-stream command bus: how any app container asks the current leader to do something.

Integrations, timers and the automation engine only exist on the leader. Instead of HTTP-
forwarding a request to the leader's `ip:port` (which needs the leader's address, fails during
a leader switch, and breaks when several containers share an address), a passive node puts a
command on a Redis stream and waits briefly for the leader's reply:

    passive node                     Redis                          leader
    send(kind, payload) ──XADD──▶ qecomp:cmd:stream ──XREADGROUP──▶ handler(payload)
         ◀──BLPOP── qecomp:cmd:reply:<id> ◀──LPUSH──────────────── {status, result|detail}

Guarantees, chosen for live show control ("start the timer" must never fire late or twice):

* **Expiry.** Every command carries `expires_at`. The leader drops one that is already expired
  when it reads it (and replies 504), so a command sent during a failover is run by the new
  leader if it arrives within the window and is never run late.
* **At most once.** The leader acknowledges a message before running it. A crash mid-command
  loses it (the caller times out and retries) instead of replaying it on the next leader.
* **Order per target.** Commands for the same `target` (an entity id) run one after another in
  stream order; different targets run in parallel.
* **No leader, no hang.** `send()` waits at most `timeout` seconds and then raises
  `CommandError(504)`.

Permissions are checked by the node that received the HTTP request, before `send()`; the stream
is internal to the stack's Redis. Handlers raise `CommandError(status, detail)` for expected
failures (they become that HTTP status for the caller) and any other exception becomes a 500.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

STREAM = "qecomp:cmd:stream"
GROUP = "leader"
REPLY_PREFIX = "qecomp:cmd:reply:"
STREAM_MAXLEN = 1000
DEFAULT_TTL_SECONDS = 10.0
REPLY_TTL_SECONDS = 30

Handler = Callable[[dict[str, Any]], Awaitable[Any]]


class CommandError(Exception):
    """An HTTP-style failure of a command: `status` and a human-readable `detail`."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


class CommandBus:
    def __init__(self, redis: Any, *, consumer_name: str | None = None) -> None:
        self._redis = redis
        self._handlers: dict[str, Handler] = {}
        self._consumer = consumer_name or f"{os.uname().nodename}:{os.getpid()}"
        self._task: asyncio.Task[None] | None = None
        self._running: set[asyncio.Task[None]] = set()
        self._tails: dict[str, asyncio.Task[None]] = {}

    # ── sender side (every node) ─────────────────────────────────────

    async def send(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        target: str = "",
        ttl: float = DEFAULT_TTL_SECONDS,
        timeout: float | None = None,
    ) -> Any:
        """Run `kind` on the leader and return the handler's result.

        Raises `CommandError` with the handler's status, 503 when Redis is unreachable, or 504
        when no reply arrives within `timeout` (default: the command's lifetime)."""
        command_id = uuid.uuid4().hex
        reply_key = REPLY_PREFIX + command_id
        wait = ttl if timeout is None else timeout
        expires_ms = int((time.time() + ttl) * 1000)
        try:
            await self._redis.xadd(
                STREAM,
                {
                    "id": command_id,
                    "kind": kind,
                    "target": target,
                    "payload": json.dumps(payload, default=str),
                    "expires_ms": str(expires_ms),
                },
                maxlen=STREAM_MAXLEN,
                approximate=True,
            )
            reply = await self._redis.blpop(reply_key, timeout=max(1, int(wait + 0.999)))
        except Exception as exc:  # noqa: BLE001
            logger.warning("command bus: could not send %s: %s", kind, exc)
            raise CommandError(503, "Cluster command queue is unavailable") from exc
        if not reply:
            raise CommandError(504, f"The leader did not answer {kind!r} in time (is there a leader?)")
        data = json.loads(reply[1])
        if data.get("status", 200) >= 400:
            raise CommandError(int(data["status"]), str(data.get("detail", "Command failed")))
        return data.get("result")

    # ── leader side ──────────────────────────────────────────────────

    def register(self, kind: str, handler: Handler) -> None:
        self._handlers[kind] = handler

    async def start(self) -> None:
        """Begin consuming commands (called when this node becomes leader)."""
        if self._task is not None:
            return
        try:
            await self._redis.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
        except Exception as exc:  # noqa: BLE001 - BUSYGROUP means it already exists
            if "BUSYGROUP" not in str(exc):
                logger.warning("command bus: could not create consumer group: %s", exc)
        self._task = asyncio.create_task(self._consume(), name="command-bus-consumer")

    async def stop(self) -> None:
        """Stop consuming (leader demotion or shutdown); in-flight commands are cancelled."""
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        for t in list(self._running):
            t.cancel()
        await asyncio.gather(*self._running, return_exceptions=True)
        self._running.clear()
        self._tails.clear()

    async def _consume(self) -> None:
        while True:
            started = time.monotonic()
            try:
                batch = await self._redis.xreadgroup(
                    GROUP, self._consumer, {STREAM: ">"}, count=20, block=1000
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                if "NOGROUP" in str(exc):
                    try:
                        await self._redis.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    logger.warning("command bus: read failed: %s", exc)
                await asyncio.sleep(1)
                continue
            if not batch and time.monotonic() - started < 0.2:
                # A blocking read that returns empty at once (a Redis proxy or test double that does
                # not honour BLOCK) must never turn this loop into a busy spin.
                await asyncio.sleep(0.05)
            for _stream, messages in batch or []:
                for message_id, fields in messages:
                    # Acknowledge first: at most once, never replayed by a later leader.
                    try:
                        await self._redis.xack(STREAM, GROUP, message_id)
                    except Exception:  # noqa: BLE001
                        logger.warning("command bus: could not ack %s", message_id)
                    self._dispatch(fields)

    def _dispatch(self, fields: dict[str, str]) -> None:
        """Run commands for one target in order, different targets in parallel."""
        target = fields.get("target", "")
        previous = self._tails.get(target)

        async def run() -> None:
            if previous is not None:
                await asyncio.gather(previous, return_exceptions=True)
            await self._execute(fields)

        task = asyncio.create_task(run())
        self._tails[target] = task
        self._running.add(task)

        def done(t: asyncio.Task[None]) -> None:
            self._running.discard(t)
            if self._tails.get(target) is t:
                del self._tails[target]

        task.add_done_callback(done)

    async def _execute(self, fields: dict[str, str]) -> None:
        command_id = fields.get("id", "")
        kind = fields.get("kind", "")
        if int(fields.get("expires_ms", "0") or 0) < int(time.time() * 1000):
            logger.warning("command bus: dropped expired command %s (%s)", kind, command_id)
            await self._reply(command_id, 504, detail="The command expired before the leader could run it")
            return
        handler = self._handlers.get(kind)
        if handler is None:
            await self._reply(command_id, 501, detail=f"The leader does not handle {kind!r}")
            return
        try:
            result = await handler(json.loads(fields.get("payload") or "{}"))
        except CommandError as exc:
            await self._reply(command_id, exc.status, detail=exc.detail)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("command bus: handler for %s failed", kind)
            await self._reply(command_id, 500, detail="Internal error while running the command")
        else:
            await self._reply(command_id, 200, result=result)

    async def _reply(self, command_id: str, status: int, *, result: Any = None, detail: str | None = None) -> None:
        if not command_id:
            return
        body: dict[str, Any] = {"status": status}
        if detail is not None:
            body["detail"] = detail
        else:
            body["result"] = result
        key = REPLY_PREFIX + command_id
        try:
            await self._redis.lpush(key, json.dumps(body, default=str))
            await self._redis.expire(key, REPLY_TTL_SECONDS)
        except Exception:  # noqa: BLE001
            logger.warning("command bus: could not write reply for %s", command_id)
