"""Initiatives — issue type 10527 on this tenant; linked from Epics via parent."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Initiative(Base):
    __tablename__ = "initiatives"

    issue_key: Mapped[str] = mapped_column(String, primary_key=True)
    summary: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    status_category: Mapped[str] = mapped_column(String, nullable=False)
    owner_account_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("people.account_id")
    )
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
