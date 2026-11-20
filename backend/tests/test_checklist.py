"""Team checklist logic (issue #43)."""
from __future__ import annotations

from backend.models.team import TeamProfile
from backend.models.team_clip import TeamClip
from backend.modules.site.checklist import INSPECTION_STATUSES, checklist_for


def _profile(**kw) -> TeamProfile:
    base = dict(team_number="1234A", inspection_status="NOT_STARTED", video_processing_status="NONE", video_360_s3_key=None)
    base.update(kw)
    return TeamProfile(**base)


def _clip(kind: str, status: str) -> TeamClip:
    return TeamClip(team_number="1234A", kind=kind, status=status)


def test_nothing_done():
    result = checklist_for(_profile(), {})
    assert result == {
        "team_number": "1234A",
        "inspection": "NOT_STARTED",
        "bot_photo": False,
        "team_photo": False,
        "done": 0,
        "total": 3,
        "complete": False,
    }


def test_all_done_is_complete():
    result = checklist_for(_profile(inspection_status="PASSED"), {"bot_photo": _clip("bot_photo", "DONE"), "team_photo": _clip("team_photo", "DONE")})
    assert result["done"] == 3 and result["complete"] is True


def test_in_progress_inspection_does_not_count():
    assert checklist_for(_profile(inspection_status="IN_PROGRESS"), {})["done"] == 0


def test_only_done_photos_count():
    clips = {"bot_photo": _clip("bot_photo", "PROCESSING"), "team_photo": _clip("team_photo", "FAILED")}
    result = checklist_for(_profile(), clips)
    assert (result["bot_photo"], result["team_photo"]) == (False, False)


def test_legacy_videos_no_longer_count():
    legacy = _profile(video_360_s3_key="k.webm", video_processing_status="DONE")
    old_rows = {"bot": _clip("bot", "DONE"), "team": _clip("team", "DONE")}
    result = checklist_for(legacy, old_rows)
    assert (result["bot_photo"], result["team_photo"], result["done"]) == (False, False, 0)


def test_photos_count_independently():
    result = checklist_for(_profile(), {"team_photo": _clip("team_photo", "DONE")})
    assert (result["bot_photo"], result["team_photo"], result["done"]) == (False, True, 1)


def test_missing_inspection_value_defaults_to_not_started():
    assert checklist_for(_profile(inspection_status=None), {})["inspection"] == "NOT_STARTED"


def test_statuses_constant():
    assert INSPECTION_STATUSES == ("NOT_STARTED", "IN_PROGRESS", "PASSED")
