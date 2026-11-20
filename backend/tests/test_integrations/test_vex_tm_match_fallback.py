"""Match-tuple fallback: when the schedule has no entry for the match TM assigned to a field, the enriched
`fieldMatchAssigned` payload still carries `matchNum`/`round` from the tuple TM sent, so Match Control shows
"Match 0 · PRACTICE" instead of "Match ? · ". The shape below is a redacted live event
(`vex_tm.main` debug log): `{"fieldID":1,"type":"fieldMatchAssigned","match":{"division":1,"session":1,
"round":"PRACTICE","match":0,"instance":1}}`."""
from __future__ import annotations

from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest

from backend.modules.integrations.vex_tm.integration import VexTmIntegration, _match_tuple_key

_CONFIG = {
    "base_url": "http://tm.example.com:8080",
    "client_id": "cid",
    "client_secret": "csecret",
    "api_key": "k",
    "field_set_id": 1,
    "poll_interval_seconds": 300,
    "tags": ["fs1"],
}


@pytest.fixture
async def redis_client():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


async def _enrich(redis_client, match, *, index=None, fetch_raises=True):
    integration = VexTmIntegration("vex_tm.test", dict(_CONFIG), redis_client, None)
    integration._match_index = index or {}
    integration._fetch_and_index_division = AsyncMock(side_effect=ConnectionError("no schedule") if fetch_raises else None)
    return await integration._enrich_field_match_assigned({"fieldID": 1, "type": "fieldMatchAssigned", "match": match})


async def test_practice_match_zero_is_kept(redis_client):
    out = await _enrich(redis_client, {"division": 1, "session": 1, "round": "PRACTICE", "match": 0, "instance": 1})
    assert out["matchNum"] == 0
    assert out["round"] == "PRACTICE"
    assert "redTeams" not in out and "blueTeams" not in out  # never invented


@pytest.mark.parametrize(
    "round_,expected",
    [("practice", "PRACTICE"), ("QUAL", "QUAL"), ("QF", "QF"), ("SF", "SF"), ("F", "F"), ("final", "FINAL"), (1, "PRACTICE"), ("2", "QUAL")],
)
async def test_each_round_type(redis_client, round_, expected):
    out = await _enrich(redis_client, {"division": 1, "session": 0, "round": round_, "match": 7, "instance": 1})
    assert out["matchNum"] == 7
    assert out["round"] == expected


async def test_tuple_without_division_still_falls_back(redis_client):
    out = await _enrich(redis_client, {"round": "PRACTICE", "match": 0})
    assert out["matchNum"] == 0 and out["round"] == "PRACTICE"


async def test_schedule_hit_wins_over_tuple(redis_client):
    tup = {"division": 1, "session": 0, "round": "QUAL", "match": 2, "instance": 1}
    entry = {"divisionId": 1, "matchNum": 2, "round": "Qualification", "redTeams": ["1A"], "blueTeams": ["2B"]}
    out = await _enrich(redis_client, tup, index={_match_tuple_key(tup): entry})
    assert out["round"] == "Qualification"
    assert out["redTeams"] == ["1A"] and out["blueTeams"] == ["2B"]


async def test_schedule_loaded_but_entry_missing(redis_client):
    other = {"divisionId": 1, "matchNum": 9, "round": "QUAL", "redTeams": ["1A"], "blueTeams": []}
    out = await _enrich(
        redis_client,
        {"division": 1, "session": 0, "round": "QUAL", "match": 2, "instance": 1},
        index={("x",): other},
        fetch_raises=False,
    )
    assert out["matchNum"] == 2 and out["round"] == "QUAL"
    assert "redTeams" not in out


@pytest.mark.parametrize(
    "match",
    [None, {}, "junk", [], {"round": None, "match": None}, {"round": {"a": 1}, "match": "x"}, {"round": True, "match": []}],
)
async def test_malformed_tuple_never_raises(redis_client, match):
    out = await _enrich(redis_client, match)
    assert out["fieldID"] == 1
    assert "redTeams" not in out
