"""Append-only audit of scope changes (sp / assignee / status / added_mid_sprint)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ScopeChangeEvent(Base):
    __tablename__ = "scope_change_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    issue_key: Mapped[str] = mapped_column(String, nullable=False)
    sprint_name: Mapped[str] = mapped_column(String, nullable=False)
    change_type: Mapped[str] = mapped_column(String, nullable=False)
    old_value: Mapped[str | None] = mapped_column(String)
    new_value: Mapped[str | None] = mapped_column(String)
    sp_delta: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("scope_events_sprint_idx", "sprint_name"),
        Index("scope_events_type_idx", "change_type", "detected_at"),
    )
