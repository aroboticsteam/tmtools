"""Pydantic schemas for desk <-> iPad comms (issue #8)."""
from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.models.comms import ROLES

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,49}$"
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SCREENS = ("messages", "countdown", "agenda_day", "agenda_finals", "timer", "display")

#: What an emcee may put on the audience screens (VEX TM `setAudienceDisplay` values; same list as Match Control).
AUDIENCE_DISPLAYS = (
    "BLANK", "LOGO", "SCHEDULE", "RANKINGS", "RANKINGS_SKILLS", "MATCH_PREVIEW", "IN_MATCH", "MATCH_RESULTS",
    "SEASON", "SKILLS", "SKILLS_RANKINGS", "ALLIANCE_SELECTION", "ELIMINATION_BRACKET",
)
SCOPES = ("day", "finals")


def _check_role(value: str | None) -> str | None:
    if value is not None and value not in ROLES:
        raise ValueError(f"role must be one of {', '.join(ROLES)}")
    return value


class StationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    role: str

    _role = field_validator("role")(_check_role)


class StationCreate(StationBase):
    slug: str = Field(..., pattern=SLUG_PATTERN)


class StationUpdate(StationBase):
    pass


class StationRead(StationBase):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    #: Link requires the station key (and the PIN too when `has_pin`).
    secured: bool = False
    has_pin: bool = False
    #: Presence: an open page is connected right now / when one last pinged.
    connected: bool = False
    last_seen: float | None = None


class PresetBase(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    message: str = Field(..., min_length=1, max_length=500)
    flash: bool = False
    role: str | None = None
    position: int = Field(default=0, ge=0, le=1000)

    _role = field_validator("role")(_check_role)


class PresetRead(PresetBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID


class AgendaBase(BaseModel):
    scope: str
    start_time: str
    end_time: str | None = None
    title: str = Field(..., min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=2000)
    #: Omitted = slot the item in by start time (create) / keep as is (update).
    position: int | None = Field(default=None, ge=0, le=1000)
    announce_lead_minutes: int | None = Field(default=None, ge=0, le=240)

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        if value not in SCOPES:
            raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        if value is not None and not _TIME_RE.match(value):
            raise ValueError("times must be HH:MM (24-hour)")
        return value


class AgendaRead(AgendaBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int = 0


class AgendaReorder(BaseModel):
    scope: str
    ids: list[UUID] = Field(..., min_length=1, max_length=500)

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        if value not in SCOPES:
            raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
        return value


class AgendaImport(BaseModel):
    """Bulk add: one item per line, `HH:MM[-HH:MM] Title [| details]`."""

    scope: str
    text: str = Field(..., min_length=1, max_length=20000)
    replace: bool = False
    dry_run: bool = False

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        if value not in SCOPES:
            raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
        return value


class AgendaImportError(BaseModel):
    line: int
    error: str


class AgendaImportResult(BaseModel):
    created: int
    errors: list[AgendaImportError] = Field(default_factory=list)
    items: list[AgendaBase] = Field(default_factory=list)


class SendRequest(BaseModel):
    """Send to explicit stations and/or every station of the given roles;
    both empty/omitted means every station."""

    stations: list[str] | None = Field(default=None, max_length=100)
    roles: list[str] | None = Field(default=None, max_length=3)
    text: str = Field(..., min_length=1, max_length=500)
    flash: bool = False

    @field_validator("roles")
    @classmethod
    def _roles(cls, value: list[str] | None) -> list[str] | None:
        for role in value or []:
            _check_role(role)
        return value


class ScreenRequest(BaseModel):
    stations: list[str] | None = Field(default=None, max_length=100)
    roles: list[str] | None = Field(default=None, max_length=3)
    screen: str
    #: For `screen == "timer"`: the entity_id of the timer instance (Timer-Teleprompter) to show.
    timer: str | None = Field(default=None, max_length=100)

    @field_validator("screen")
    @classmethod
    def _screen(cls, value: str) -> str:
        if value not in SCREENS:
            raise ValueError(f"screen must be one of {', '.join(SCREENS)}")
        return value

    @model_validator(mode="after")
    def _roles_valid(self) -> "ScreenRequest":
        for role in self.roles or []:
            _check_role(role)
        if self.screen == "timer" and not self.timer:
            raise ValueError("the timer screen needs a timer (the entity_id of a timer instance)")
        return self


class SendResult(BaseModel):
    stations: list[str]


class AudienceDisplayRequest(BaseModel):
    display: str

    @field_validator("display")
    @classmethod
    def _known(cls, value: str) -> str:
        if value not in AUDIENCE_DISPLAYS:
            raise ValueError(f"display must be one of {', '.join(AUDIENCE_DISPLAYS)}")
        return value


class InboundMessage(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)

    @field_validator("text")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class StationMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    station_slug: str
    text: str
    acknowledged: bool
    created_at: datetime


class PublicStation(BaseModel):
    slug: str
    name: str
    role: str
    screens: list[str]
    screen: str
    last_message: dict | None = None
    #: The timer instance this station shows on its timer screen, if one was chosen, and the server clock.
    timer: "StationTimer | None" = None
    server_time: float = 0.0


class NextMatch(BaseModel):
    available: bool = False
    label: str | None = None
    division: str | None = None
    scheduled_at: float | None = None
    red: list[dict] = []
    blue: list[dict] = []


class LinkResult(BaseModel):
    """Returned once when a station link is (re)generated; the key is only
    ever shown to `comms:manage` users."""

    access_key: str
    path: str


class PinRequest(BaseModel):
    #: Digits only, 4-8 long; null removes the PIN.
    pin: str | None = Field(default=None, min_length=4, max_length=8, pattern=r"^\d+$")


class UnlockRequest(BaseModel):
    pin: str = Field(..., min_length=1, max_length=20)


class UnlockResult(BaseModel):
    token: str
    expires_in: int


class StationTimer(BaseModel):
    """A timer instance as a station shows it (see `backend/modules/comms/station_timer.py`)."""

    entity_id: str
    label: str = ""
    phase: str = "idle"
    running: bool = False
    duration_s: int = 0
    elapsed: int = 0
    remaining: int = 0


PublicStation.model_rebuild()
