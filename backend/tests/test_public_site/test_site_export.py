"""Static export of the public site (zip for Cloudflare Pages)."""
from __future__ import annotations

import io
import json
import zipfile
from unittest.mock import AsyncMock

import pytest

from backend.core.dependencies import CurrentPrincipal
from backend.modules import site_export
from backend.modules.media import s3
from backend.tests.test_public_site.test_public_site import PREFIX, raw, seed, session_factory  # noqa: F401  (fixtures)
from backend.tests.test_public_site.test_site_extras import PNG, api, set_site  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio


async def test_export_builds_a_self_contained_static_site(api, monkeypatch):
    await seed(api)
    key = "a" * 32 + ".png"
    await set_site(api, {"title": "Example Battle", "map": {"image_key": key, "rooms": []}})
    monkeypatch.setattr(s3, "get_object_bytes", AsyncMock(return_value=PNG))

    response = await api.get("/api/v1/site/export.zip")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "competition-site.zip" in response.headers["content-disposition"]

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert {"index.html", "README.txt", "_headers", "data/overview.json", "data/teams.json", "data/event.json",
            "data/leaderboards.json", "data/livestreams.json", "data/_export.json", f"images/{key}"} <= names
    # the page reads static JSON, not the API
    index = archive.read("index.html").decode()
    assert "fetch('data/' + path + '.json')" in index and "fetch('/api/v1/public/site/'" not in index
    # one JSON file per team, named like the page requests them
    teams = json.loads(archive.read("data/teams.json"))
    assert teams and all(f"data/teams/{t['team_number']}.json" in names for t in teams)
    # uploaded images are shipped and referenced relatively
    overview = json.loads(archive.read("data/overview.json"))
    assert overview["map"]["image_url"] == f"images/{key}"
    assert archive.read(f"images/{key}") == PNG
    assert b"/api/v1/" not in b"".join(archive.read(n) for n in names if n.startswith("data/") and n != "data/_export.json")


async def test_export_drops_server_only_links_and_fetches_presigned_files(api, monkeypatch):
    fetched = AsyncMock(return_value="files/abc.png")
    monkeypatch.setattr(site_export._Assets, "presigned", lambda self, url: fetched(url))
    assets = site_export._Assets(http=None)  # type: ignore[arg-type]
    cleaned = await site_export._clean(
        {
            "recording_url": "/api/v1/public/recordings/1/video",
            "watch": "https://youtu.be/x",
            "logo_url": "https://s3.test/a.png?X-Amz-Signature=zzz",
            "nested": [{"downloads": {"url": "https://s3.test/b.png?X-Amz-Signature=zzz", "name": "1A-robot.png"}}],
        },
        assets,
    )
    assert cleaned["recording_url"] is None  # only works against this server
    assert cleaned["watch"] == "https://youtu.be/x"  # external links stay
    assert cleaned["logo_url"] == "files/abc.png"
    assert cleaned["nested"][0]["downloads"] == {"url": "files/abc.png", "name": "1A-robot.png"}
    assert fetched.await_count == 2


async def test_export_needs_settings_edit(api):
    api.state["principal"] = CurrentPrincipal(subject="viewer", permissions={"settings:read"})
    assert (await api.get("/api/v1/site/export.zip")).status_code == 403
