import pytest
from pydantic import ValidationError

from backend.schemas.agenda import AgendaBase


@pytest.mark.parametrize("start", ["8:30", "24:00", "09:60", "abc", ""])
def test_agenda_rejects_bad_times(start):
    with pytest.raises(ValidationError):
        AgendaBase(scope="day", start_time=start, title="x")


def test_agenda_accepts_valid_and_rejects_bad_scope():
    assert AgendaBase(scope="finals", start_time="16:00", end_time="18:00", title="Finals").end_time == "18:00"
    with pytest.raises(ValidationError):
        AgendaBase(scope="week", start_time="09:00", title="x")
    with pytest.raises(ValidationError):
        AgendaBase(scope="day", start_time="09:00", end_time="25:00", title="x")
