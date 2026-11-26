"""drop the comms stations, presets and station messages (the agenda stays)

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-11-26 00:00:00.000000

The iPad station pages and the desk <-> station messaging were removed; `agenda_items` is still used by
the public site and the room announcements. The `comms:send` permission no longer exists.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE permission = 'comms:send'")
    op.drop_index("ix_station_messages_station_slug", table_name="station_messages")
    op.drop_table("station_messages")
    op.drop_table("comms_presets")
    op.drop_table("stations")


def downgrade() -> None:
    op.create_table(
        "stations",
        sa.Column("slug", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("access_key", sa.String(64), nullable=True),
        sa.Column("pin_hash", sa.String(200), nullable=True),
        sa.Column("key_version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "comms_presets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("flash", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("role", sa.String(20), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "station_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("station_slug", sa.String(50), sa.ForeignKey("stations.slug", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_station_messages_station_slug", "station_messages", ["station_slug"])
