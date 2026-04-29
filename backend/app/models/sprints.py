"""Sprints synced from /rest/agile/1.0/board/{id}/sprint."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Sprint(Base):
    __tablename__ = "sprints"

    sprint_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    state: Mapped[str] = mapped_column(String, nullable=False, index=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    complete_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    board_id: Mapped[int | None] = mapped_column(BigInteger)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
