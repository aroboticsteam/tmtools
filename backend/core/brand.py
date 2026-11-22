"""Single source of truth for product branding used by backend code.

A future rebrand changes these values (plus the data-level names listed in
``source-of-truth.md``), not scattered literals.
"""
from __future__ import annotations

#: Public product name shown in titles, page headings and notifications.
PRODUCT_NAME = "TMTools"
#: Lower-case slug used for Redis keys/channels, cookies, temp dirs and salts.
SLUG = "tmtools"
#: Prefix of every Redis key / pub-sub channel / stream the app owns.
REDIS_PREFIX = f"{SLUG}:"
#: Prefix of API keys (``<prefix>`` + 43-char token).
API_KEY_PREFIX = "tmt_"
#: Name of the signed session cookie.
SESSION_COOKIE_NAME = f"{SLUG}_session"
