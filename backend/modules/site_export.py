"""Static export of the public competitor site (`/site`) as a zip.

At the end of a competition staff download one archive that can be published as is
(Cloudflare Pages: drag the unzipped folder, or `wrangler pages deploy`). It holds
`index.html` plus the built site code in `assets/` (the same SPA the server serves, told by a
flag in `index.html` to read static JSON instead of the API), a `data/` snapshot of every public endpoint (overview, rankings, event
agenda, results, every team) and the images those payloads point to.

The snapshot is produced by calling the real public endpoints in-process, so the
export always shows exactly what visitors saw. Things that only work on the
venue network or against the live server are removed rather than shipped broken:
links to match videos served by this app, and any presigned S3 URL that cannot be
fetched.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from backend.modules.media import s3

logger = logging.getLogger(__name__)

#: The built SPA baked into the image (see `backend/main.py`). Absent in a bare backend checkout.
_FRONTEND_DIST = Path(__file__).parent.parent / "static" / "frontend"
#: Marks the SPA as the static copy (frontend/src/public/siteUrl.ts); `<base>` keeps the relative
#: `data/`, `images/` and `files/` URLs working from deep links like `/site/x`.
_STATIC_FLAG = '<base href="/"><script>window.__SITE_STATIC__=true</script>'
_IMAGE_PATH = re.compile(r"^/api/v1/public/site/image/([0-9a-f]{32}\.(?:png|jpg|gif|webp))$")
_EXT_BY_TYPE = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
_MAX_ASSET_BYTES = 25 * 1024 * 1024
_ASSET_CONCURRENCY = 8

README = """\
Static copy of the competitor site
===================================

Generated {generated} by TMTools. Everything here is plain files, no server needed.

Publish on Cloudflare Pages
  1. Unzip this archive.
  2. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Upload assets,
     drop the unzipped folder, deploy.
     (or: npx wrangler pages deploy <folder> --project-name <name>)

Contents
  index.html   the site (same app the live server shows, in static mode)
  assets/      the site's code, styles and fonts
  data/        snapshot of every public page's data (JSON)
  images/      uploaded site images (hero, map, sponsors)
  files/       team logos and photos
  _headers     cache rules for Cloudflare Pages

Removed on purpose: links to match videos hosted on the event server, because
they only work on the venue network.
"""

HEADERS = """\
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=300
/images/*
  Cache-Control: public, max-age=86400
/files/*
  Cache-Control: public, max-age=86400
/*
  X-Content-Type-Options: nosniff
"""


def _patch_index(html: str) -> str:
    """Flag the SPA's index.html as the static copy (it then reads `data/<path>.json`)."""
    if "<head>" not in html:
        raise RuntimeError("The built index.html has no <head>; update backend/modules/site_export.py")
    return html.replace("<head>", "<head>" + _STATIC_FLAG, 1)


def _spa_files() -> dict[str, bytes]:
    """`index.html`, the hashed `assets/*` and the favicon of the built SPA."""
    index = _FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise RuntimeError("The frontend build is not baked into this image, so the site cannot be exported")
    files = {"index.html": _patch_index(index.read_text(encoding="utf-8")).encode()}
    for path in sorted((_FRONTEND_DIST / "assets").glob("**/*")) if (_FRONTEND_DIST / "assets").is_dir() else []:
        if path.is_file():
            files[path.relative_to(_FRONTEND_DIST).as_posix()] = path.read_bytes()
    favicon = _FRONTEND_DIST / "favicon.svg"
    if favicon.is_file():
        files["favicon.svg"] = favicon.read_bytes()
    return files


def _is_presigned(value: str) -> bool:
    return value.startswith(("http://", "https://")) and "X-Amz-Signature=" in value


class _Assets:
    """Collects files for the archive and hands out stable relative paths."""

    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http
        self.files: dict[str, bytes] = {}
        self._by_source: dict[str, str | None] = {}
        self._sem = asyncio.Semaphore(_ASSET_CONCURRENCY)
        self.skipped = 0

    async def site_image(self, name: str) -> str | None:
        source = f"site:{name}"
        if source not in self._by_source:
            try:
                data = await s3.get_object_bytes(s3.site_image_key(name))
            except Exception:
                logger.warning("Export: could not read site image %s", name, exc_info=True)
                data = None
            if data is None:
                self._by_source[source] = None
                self.skipped += 1
            else:
                path = f"images/{name}"
                self.files[path] = data
                self._by_source[source] = path
        return self._by_source[source]

    async def presigned(self, url: str) -> str | None:
        if url in self._by_source:
            return self._by_source[url]
        async with self._sem:
            if url in self._by_source:
                return self._by_source[url]
            path: str | None = None
            try:
                response = await self._http.get(url)
                response.raise_for_status()
                data = response.content
                if len(data) > _MAX_ASSET_BYTES:
                    raise ValueError("asset too large")
                suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
                ext = suffix if suffix.isalnum() and len(suffix) <= 5 else _EXT_BY_TYPE.get(
                    response.headers.get("content-type", "").split(";")[0], "bin"
                )
                path = f"files/{hashlib.sha1(urlparse(url).path.encode()).hexdigest()[:16]}.{ext}"
                self.files[path] = data
            except Exception:
                logger.warning("Export: could not fetch an asset", exc_info=True)
                self.skipped += 1
            self._by_source[url] = path
            return path


async def _clean(value: Any, assets: _Assets) -> Any:
    """Rewrite one JSON value: images and presigned files become relative paths, and
    server-only links (`/api/...`) become null."""
    if isinstance(value, dict):
        return {k: await _clean(v, assets) for k, v in value.items()}
    if isinstance(value, list):
        return [await _clean(v, assets) for v in value]
    if isinstance(value, str):
        match = _IMAGE_PATH.match(value)
        if match:
            return await assets.site_image(match.group(1))
        if _is_presigned(value):
            return await assets.presigned(value)
        if value.startswith("/api/"):
            return None
    return value


def _dump(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()


async def build_site_export(app: Any) -> tempfile.SpooledTemporaryFile:
    """Zip of the public site, as a rewound temp file (spills to disk when large)."""
    generated = datetime.now(UTC)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://export.invalid") as api, httpx.AsyncClient(
        timeout=30, follow_redirects=True
    ) as http:

        async def fetch_json(path: str) -> Any:
            response = await api.get(f"/api/v1/public/site/{path}")
            response.raise_for_status()
            return response.json()

        assets = _Assets(http)
        data: dict[str, Any] = {}
        for name in ("overview", "leaderboards", "event", "teams", "livestreams"):
            data[name] = await fetch_json(name)
        team_numbers = [t["team_number"] for t in data["teams"] if isinstance(t, dict) and t.get("team_number")]
        for number in team_numbers:
            data[f"teams/{quote(number, safe='')}"] = await fetch_json(f"teams/{quote(number, safe='')}")

        cleaned = {name: await _clean(payload, assets) for name, payload in data.items()}

    spa = _spa_files()

    out = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)  # noqa: SIM115 - returned to the caller
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, blob in spa.items():
            archive.writestr(path, blob)
        archive.writestr("README.txt", README.format(generated=generated.strftime("%Y-%m-%d %H:%M UTC")))
        archive.writestr("_headers", HEADERS)
        for name, payload in cleaned.items():
            archive.writestr(f"data/{name}.json", _dump(payload))
        archive.writestr(
            "data/_export.json",
            _dump({"generated_at": generated.isoformat(), "teams": len(team_numbers), "skipped_assets": assets.skipped}),
        )
        for path, blob in assets.files.items():
            archive.writestr(path, blob)
    out.seek(0)
    logger.info("Site export built: %d teams, %d assets, %d skipped", len(team_numbers), len(assets.files), assets.skipped)
    return out
