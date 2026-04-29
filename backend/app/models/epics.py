"""Epics — issue type 10000; parent points to an Initiative when set."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Epic(Base):
    __tablename__ = "epics"

    issue_key: Mapped[str] = mapped_column(String, primary_key=True)
    summary: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    status_category: Mapped[str] = mapped_column(String, nullable=False)
    initiative_key: Mapped[str | None] = mapped_column(
        String, ForeignKey("initiatives.issue_key")
    )
    owner_account_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("people.account_id")
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("epics_initiative_idx", "initiative_key"),
        Index("epics_due_date_idx", "due_date"),
    )
