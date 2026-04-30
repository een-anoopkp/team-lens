"""Per-ticket local to-do list. Never written back to Jira.

One row per to-do item. The list lives forever for as long as the
issue exists; completed items auto-collapse in the UI but remain in
the table so historical follow-ups can be re-read later.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TicketNote(Base):
    __tablename__ = "ticket_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_key: Mapped[str] = mapped_column(
        String,
        ForeignKey("issues.issue_key", ondelete="CASCADE"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    done_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
