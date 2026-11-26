"""Pydantic schemas for the event agenda."""
from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SCOPES = ("day", "finals")


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
