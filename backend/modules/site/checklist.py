"""Per-team checklist (issue #43): inspection, bot photo, team photo.

Pure helpers so the admin API and the public site agree on what counts as
done. A photo counts when its processed (chroma-keyed) image is `DONE`. Older
video rows (kinds "bot"/"team") and the legacy `video_360` upload no longer
count.
"""
from __future__ import annotations

from typing import Any

from backend.models.team import TeamProfile
from backend.models.team_clip import TeamClip

INSPECTION_STATUSES = ("NOT_STARTED", "IN_PROGRESS", "PASSED")
TOTAL_ITEMS = 3


def checklist_for(profile: TeamProfile, photos: dict[str, TeamClip]) -> dict[str, Any]:
    bot = photos.get("bot_photo")
    team = photos.get("team_photo")
    bot_done = bot is not None and bot.status == "DONE"
    team_done = team is not None and team.status == "DONE"
    inspection = profile.inspection_status or "NOT_STARTED"
    done = int(inspection == "PASSED") + int(bot_done) + int(team_done)
    return {
        "team_number": profile.team_number,
        "inspection": inspection,
        "bot_photo": bot_done,
        "team_photo": team_done,
        "done": done,
        "total": TOTAL_ITEMS,
        "complete": done == TOTAL_ITEMS,
    }
