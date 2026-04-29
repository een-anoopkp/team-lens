"""Issues — Story / Task / Bug / Sub-task; parent_key is self-FK or epic_key."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Issue(Base):
    __tablename__ = "issues"

    issue_key: Mapped[str] = mapped_column(String, primary_key=True)
    issue_type: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    status_category: Mapped[str] = mapped_column(String, nullable=False)
    assignee_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("people.account_id")
    )
    reporter_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("people.account_id")
    )
    parent_key: Mapped[str | None] = mapped_column(String)
    epic_key: Mapped[str | None] = mapped_column(String, ForeignKey("epics.issue_key"))
    story_points: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    resolution_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("issues_assignee_idx", "assignee_id", postgresql_where="removed_at IS NULL"),
        Index("issues_epic_idx", "epic_key", postgresql_where="removed_at IS NULL"),
        Index("issues_parent_idx", "parent_key", postgresql_where="removed_at IS NULL"),
        Index("issues_status_cat_idx", "status_category", postgresql_where="removed_at IS NULL"),
        Index("issues_type_idx", "issue_type", postgresql_where="removed_at IS NULL"),
        Index("issues_resolved_idx", "resolution_date", postgresql_where="removed_at IS NULL"),
        Index("issues_updated_idx", "updated_at"),
    )
