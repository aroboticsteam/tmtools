"""Short-lived response cache for the public website API (`/api/v1/public/site/*`).

Every visitor of the public site sees the same data, but each request used to rebuild it
from every team profile and the cached schedule (about 20 ms of CPU on a Raspberry Pi), so a
few hundred phones saturated the single worker. This ASGI middleware keeps each successful
GET response for `settings.PUBLIC_CACHE_TTL_SECONDS` and shares one computation between
concurrent requests for the same URL ("single flight"), so the cost no longer grows with the
number of viewers. Data is at most that many seconds stale. A TTL of 0 turns it off.

In-process by design: the app runs one worker per container (leader election), so there is
nothing to keep consistent between processes, and a cache miss on another replica is only
extra work, never wrong data. Only 200 responses are stored (a 404 for an unknown team is
recomputed), the number of entries and the size of a body are bounded, and the signed-image
redirect route is left alone.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.core.settings import settings

PREFIX = "/api/v1/public/site/"
#: Redirects to presigned object-store URLs with their own Cache-Control; never cached here.
SKIP_PREFIXES = ("/api/v1/public/site/image/",)
MAX_ENTRIES = 512
MAX_BODY_BYTES = 2 * 1024 * 1024


@dataclass
class _Entry:
    status: int
    headers: list[tuple[bytes, bytes]]
    body: bytes
    expires: float


class PublicCacheMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._entries: dict[str, _Entry] = {}
        self._inflight: dict[str, asyncio.Future[_Entry | None]] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        ttl = float(settings.PUBLIC_CACHE_TTL_SECONDS)
        path = scope.get("path", "")
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
        try:
            result = await self._compute(scope, receive)
            if result.status == 200 and len(result.body) <= MAX_BODY_BYTES:
                self._store(key, result, ttl)
        except BaseException:
            result = None
            raise
        finally:
            self._inflight.pop(key, None)
            future.set_result(result)
        await self._send(result, send, ttl if result.status == 200 else 0, "MISS")

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
