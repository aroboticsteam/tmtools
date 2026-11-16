"""Shared pytest fixtures for backend tests."""
from __future__ import annotations

import os

# Ensure required settings are present before backend.core.settings is
# imported anywhere (it builds its singleton at import time).
os.environ.setdefault(
    "POSTGRES_DSN", "postgresql+asyncpg://qecomp:qecomp@localhost:5433/qecomp"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6380/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
# Existing tests mutate data between requests; the public-site cache has its own tests.
os.environ.setdefault("PUBLIC_CACHE_TTL_SECONDS", "0")
os.environ.setdefault(
    "ENCRYPTION_KEY", "kL8f1nqvQxq8n0G8T3xW6oScyLQ1sxvV1jHR9AXeV9Q="
)

import pytest


@pytest.fixture
def anyio_backend():
    return "asyncio"
