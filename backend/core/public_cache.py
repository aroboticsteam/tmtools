"""Short-lived response cache for the public website API (`/api/v1/public/site/*`).

Every visitor of the public site sees the same data, but each request used to rebuild it
from every team profile and the cached schedule (about 20 ms of CPU on a Raspberry Pi), so a
few hundred phones saturated the single worker. This ASGI middleware keeps each successful
GET response for `settings.PUBLIC_CACHE_TTL_SECONDS` and shares one computation between
concurrent requests for the same URL ("single flight"), so the cost no longer grows with the
number of viewers. Data is at most that many seconds stale. A TTL of 0 turns it off.

Two layers. The first is in-process (a dictionary lookup, no I/O). Under it sits Redis
(`tmtools:pubcache:*`, the same TTL), shared by every app container: when the stack is scaled
to several containers, one of them computes a response and the others reuse it, and the cache
survives an app restart. Redis is best effort: a failure or a slow answer (250 ms cap) just
means the response is computed locally, so the cache can never make a request fail. The app
runs one worker per container (leader election), so the in-process layer has nothing to keep
consistent. Only 200 responses are stored (a 404 for an unknown team is recomputed), the number
of in-process entries and the size of a body are bounded, and the signed-image redirect route
is left alone.
"""
from __future__ import annotations

from backend.core.brand import REDIS_PREFIX

import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.core import redis as redis_module
from backend.core.settings import settings

logger = logging.getLogger(__name__)

PREFIX = "/api/v1/public/site/"
#: Redirects to presigned object-store URLs with their own Cache-Control; never cached here.
SKIP_PREFIXES = ("/api/v1/public/site/image/",)
MAX_ENTRIES = 512
MAX_BODY_BYTES = 2 * 1024 * 1024
REDIS_PREFIX = REDIS_PREFIX + "pubcache:"
_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
REDIS_TIMEOUT_SECONDS = 0.25


@dataclass
class _Entry:
    status: int
    headers: list[tuple[bytes, bytes]]
    body: bytes
    expires: float


class PublicCacheMiddleware:
    def __init__(self, app: ASGIApp, redis: Any = None) -> None:
        self.app = app
        self._redis_override = redis
        self._entries: dict[str, _Entry] = {}
        self._inflight: dict[str, asyncio.Future[_Entry | None]] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        ttl = float(settings.PUBLIC_CACHE_TTL_SECONDS)
        path = scope.get("path", "")
        if scope["type"] == "http" and scope.get("method") in _WRITE_METHODS and ttl > 0:
            await self._passthrough_then_invalidate(scope, receive, send)
            return
        if (
            scope["type"] != "http"
            or scope.get("method") != "GET"
            or ttl <= 0
            or not path.startswith(PREFIX)
            or path.startswith(SKIP_PREFIXES)
        ):
            await self.app(scope, receive, send)
            return

        key = f"{path}?{scope.get('query_string', b'').decode('latin-1')}"
        entry = self._entries.get(key)
        if entry is not None and entry.expires > time.monotonic():
            await self._send(entry, send, ttl, "HIT")
            return

        pending = self._inflight.get(key)
        if pending is not None:
            shared = await asyncio.shield(pending)
            if shared is not None:
                await self._send(shared, send, ttl, "HIT")
                return
            # The request we waited on failed: do our own, uncached.
            await self.app(scope, receive, send)
            return

        future: asyncio.Future[_Entry | None] = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        result: _Entry | None = None
        state = "MISS"
        try:
            result = await self._redis_get(key)
            if result is not None:
                state = "HIT-REDIS"
                self._store(key, result, result.expires)
            else:
                result = await self._compute(scope, receive)
                if result.status == 200 and len(result.body) <= MAX_BODY_BYTES:
                    self._store(key, result, ttl)
                    await self._redis_set(key, result, ttl)
        except BaseException:
            result = None
            raise
        finally:
            self._inflight.pop(key, None)
            future.set_result(result)
        await self._send(result, send, ttl if result.status == 200 else 0, state)

    async def _passthrough_then_invalidate(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Read-your-writes: after any successful write request, forget every cached response so
        an admin who just edited something sees it on the next read (other containers' in-process
        copies still expire within the TTL)."""
        status = 0

        async def watch(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, watch)
        finally:
            if 200 <= status < 400:
                await self.invalidate()

    async def invalidate(self) -> None:
        self._entries.clear()
        try:
            async with asyncio.timeout(REDIS_TIMEOUT_SECONDS * 4):
                redis = self._redis()
                keys = [k async for k in redis.scan_iter(match=REDIS_PREFIX + "*", count=200)]
                if keys:
                    await redis.delete(*keys)
        except Exception:  # noqa: BLE001 - best effort by design
            logger.debug("public cache: redis invalidation failed", exc_info=True)

    async def _compute(self, scope: Scope, receive: Receive) -> _Entry:
        status = 500
        headers: list[tuple[bytes, bytes]] = []
        chunks: list[bytes] = []

        async def capture(message: Message) -> None:
            nonlocal status, headers
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers") or [])
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))

        await self.app(scope, receive, capture)
        return _Entry(status, headers, b"".join(chunks), 0.0)

    def _redis(self) -> Any:
        return self._redis_override if self._redis_override is not None else redis_module.redis_client

    async def _redis_get(self, key: str) -> _Entry | None:
        """The shared copy, with `expires` holding its *remaining* lifetime in seconds
        (so the in-process copy never outlives the Redis one)."""
        try:
            async with asyncio.timeout(REDIS_TIMEOUT_SECONDS):
                redis = self._redis()
                raw = await redis.get(REDIS_PREFIX + key)
                if raw is None:
                    return None
                pttl = await redis.pttl(REDIS_PREFIX + key)
            data = json.loads(raw)
            remaining = (pttl / 1000.0) if pttl and pttl > 0 else 0.0
            if remaining <= 0:
                return None
            return _Entry(
                int(data["s"]),
                [(k.encode("latin-1"), v.encode("latin-1")) for k, v in data["h"]],
                base64.b64decode(data["b"]),
                remaining,
            )
        except Exception:  # noqa: BLE001 - best effort by design
            logger.debug("public cache: redis read failed", exc_info=True)
            return None

    async def _redis_set(self, key: str, entry: _Entry, ttl: float) -> None:
        try:
            payload = json.dumps(
                {
                    "s": entry.status,
                    "h": [[k.decode("latin-1"), v.decode("latin-1")] for k, v in entry.headers],
                    "b": base64.b64encode(entry.body).decode("ascii"),
                }
            )
            async with asyncio.timeout(REDIS_TIMEOUT_SECONDS):
                await self._redis().set(REDIS_PREFIX + key, payload, px=max(1, int(ttl * 1000)))
        except Exception:  # noqa: BLE001 - best effort by design
            logger.debug("public cache: redis write failed", exc_info=True)

    def _store(self, key: str, entry: _Entry, ttl: float) -> None:
        now = time.monotonic()
        entry.expires = now + ttl
        if len(self._entries) >= MAX_ENTRIES and key not in self._entries:
            for k in [k for k, e in self._entries.items() if e.expires <= now]:
                del self._entries[k]
            if len(self._entries) >= MAX_ENTRIES:
                del self._entries[min(self._entries, key=lambda k: self._entries[k].expires)]
        self._entries[key] = entry

    @staticmethod
    async def _send(entry: _Entry, send: Send, ttl: float, state: str) -> None:
        drop = {b"content-length", b"x-cache"} | ({b"cache-control"} if ttl > 0 else set())
        headers = [(k, v) for k, v in entry.headers if k.lower() not in drop]
        headers.append((b"content-length", str(len(entry.body)).encode()))
        if ttl > 0:
            headers.append((b"cache-control", f"public, max-age={max(1, int(ttl))}".encode()))
        headers.append((b"x-cache", state.encode()))
        await send({"type": "http.response.start", "status": entry.status, "headers": headers})
        await send({"type": "http.response.body", "body": entry.body})
