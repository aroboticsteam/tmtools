"""Catalogue of the permission strings the API checks, plus API key presets.

The UI reads this (`GET /api/v1/permissions`) so the key and role pickers
list every permission with a description and never drift from the backend.
A test fails if a permission the routers check is missing here.
"""
from __future__ import annotations

from typing import TypedDict


class PermissionInfo(TypedDict):
    name: str
    group: str
    description: str


class KeyPreset(TypedDict):
    id: str
    label: str
    description: str
    permissions: list[str]


def _p(group: str, items: dict[str, str]) -> list[PermissionInfo]:
    return [{"name": name, "group": group, "description": text} for name, text in items.items()]


PERMISSIONS: list[PermissionInfo] = [
    *_p("Integrations", {
        "integrations:read": "View integrations and their state",
        "integrations:edit": "Create, edit and delete integrations",
        "vfx:control": "Call lighting integrations (ZerOS, OSC, WLED, Art-Net)",
        "video:control": "Call video integrations (OBS, ATEM, PTZ cameras)",
        "audio:control": "Call audio integrations (Spotify)",
        "tm:control": "Call Tournament Manager services",
        "capture:control": "Start, stop and mark recordings; send replays to program",
    }),
    *_p("Automations", {
        "automations:read": "View automations, scripts and folders",
        "automations:edit": "Create, edit and delete automations",
        "automations:trigger": "Run automations by hand",
        "buttons:read": "View button pages",
        "buttons:press": "Press buttons",
        "buttons:manage": "Create and edit button pages",
    }),
    *_p("Event", {
        "timers:read": "View timers",
        "timers:edit": "Create and control timers",
        "teams:read": "View teams, pits and rooms' teams",
        "teams:edit": "Edit teams, pits and team media",
        "rooms:read": "View rooms and livestream links",
        "rooms:manage": "Create and edit rooms",
        "overlays:read": "View overlays",
        "overlays:edit": "Control overlays",
        "analysis:view": "Open the Analysis desk",
    }),
    *_p("Comms and notifications", {
        "comms:read": "View the event agenda",
        "comms:manage": "Edit the event agenda",
        "notifications:receive": "Receive notifications",
        "notifications:broadcast": "Broadcast notifications",
        "notifications:manage": "Manage notification settings",
    }),
    *_p("Prompter", {
        "prompter:view": "View the prompter",
        "prompter:control": "Start and control the prompter",
        "prompter:edit": "Edit prompter scripts",
    }),
    *_p("Media", {
        "video:upload": "Upload team videos",
        "capture:upload": "Capture agent: upload recordings and connect to /ws/agent",
    }),
    *_p("Settings", {
        "settings:read": "View settings",
        "settings:edit": "Change settings, API keys and roles",
    }),
]

#: One-click starting points when creating an API key.
KEY_PRESETS: list[KeyPreset] = [
    {
        "id": "capture-agent",
        "label": "Capture agent",
        "description": "Exactly what the recording agent needs (upload and connect).",
        "permissions": ["capture:upload"],
    },
    {
        "id": "analysis-desk",
        "label": "Analysis desk",
        "description": "Replay and scene control for emcees and analysts.",
        "permissions": [
            "analysis:view", "capture:control", "video:control",
            "integrations:read", "teams:read", "vfx:control",
        ],
    },
    {
        "id": "event-admin",
        "label": "Rooms and broadcasts",
        "description": "Manage rooms, broadcast notifications and run capture.",
        "permissions": ["rooms:read", "rooms:manage", "notifications:broadcast", "capture:control"],
    },
    {
        "id": "prompter",
        "label": "Prompter operator",
        "description": "View and run the prompter.",
        "permissions": ["prompter:view", "prompter:control"],
    },
    {
        "id": "read-only",
        "label": "Read-only client",
        "description": "Look at everything, change nothing.",
        "permissions": [
            "integrations:read", "automations:read", "timers:read", "teams:read",
            "rooms:read", "overlays:read", "settings:read",
        ],
    },
]

PERMISSION_NAMES: frozenset[str] = frozenset(p["name"] for p in PERMISSIONS)
