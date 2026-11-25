"""The permission catalogue covers every permission the backend checks."""
from __future__ import annotations

import re
from pathlib import Path

from backend.core.permissions import KEY_PRESETS, PERMISSION_NAMES, PERMISSIONS

BACKEND = Path(__file__).resolve().parents[2]
CHECK = re.compile(r"""(?:require_permission|has_permission)\(\s*["']([a-z_]+:[a-z_]+)["']""")


def test_every_checked_permission_is_in_the_catalogue():
    used: set[str] = set()
    for path in BACKEND.rglob("*.py"):
        if "tests" in path.parts:
            continue
        used |= set(CHECK.findall(path.read_text()))
    assert used, "found no permission checks - the regex is stale"
    assert used - PERMISSION_NAMES == set()


def test_domain_permissions_are_in_the_catalogue():
    from backend.routers.integrations import _DOMAIN_PERMISSIONS

    assert set(_DOMAIN_PERMISSIONS.values()) <= PERMISSION_NAMES


def test_catalogue_has_unique_names_and_presets_use_known_permissions():
    names = [p["name"] for p in PERMISSIONS]
    assert len(names) == len(set(names))
    for preset in KEY_PRESETS:
        assert set(preset["permissions"]) <= PERMISSION_NAMES, preset["id"]
    assert next(p for p in KEY_PRESETS if p["id"] == "capture-agent")["permissions"] == ["capture:upload"]
