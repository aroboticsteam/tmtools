"""ORM model for the chroma-keyed team photos: up to two rows per team, kinds
"bot_photo" and "team_photo" (table name `team_clips` kept from the earlier video
version, so no migration; old rows with kind "bot"/"team" are simply ignored)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.db import Base


class TeamClip(Base):
    __tablename__ = "team_clips"

    team_number: Mapped[str] = mapped_column(String(20), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    raw_s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    processed_s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(20), server_default="NONE")
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
