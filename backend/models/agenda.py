"""ORM model for the event agenda shown on the public site and announced to rooms."""
from __future__ import annotations

import uuid

from sqlalchemy import Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.db import Base


class AgendaItem(Base):
    __tablename__ = "agenda_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    scope: Mapped[str] = mapped_column(String(10), nullable=False)  # "day" | "finals"
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)  # "HH:MM"
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, server_default="0")
    #: Minutes before `start_time` to announce this item to the rooms. NULL =
    #: use the notifications default; 0 = never announce this item.
    announce_lead_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
