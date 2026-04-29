"""Audit log of sync executions — uncapped per design decision."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, nullable=False)
    scan_type: Mapped[str] = mapped_column(String, nullable=False)
    trigger: Mapped[str] = mapped_column(String, nullable=False)
    issues_seen: Mapped[int] = mapped_column(Integer, default=0)
    issues_inserted: Mapped[int] = mapped_column(Integer, default=0)
    issues_updated: Mapped[int] = mapped_column(Integer, default=0)
    issues_removed: Mapped[int] = mapped_column(Integer, default=0)
    sp_changes: Mapped[int] = mapped_column(Integer, default=0)
    assignee_changes: Mapped[int] = mapped_column(Integer, default=0)
    status_changes: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("sync_runs_started_idx", "started_at"),
        Index(
            "sync_runs_success_idx",
            "finished_at",
            postgresql_where="status = 'success'",
        ),
    )
