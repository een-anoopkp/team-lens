"""Comments — synced full in Phase 1; display + write-back in v2."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Comment(Base):
    __tablename__ = "comments"

    comment_id: Mapped[str] = mapped_column(String, primary_key=True)
    issue_key: Mapped[str] = mapped_column(
        String,
        ForeignKey("issues.issue_key", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("people.account_id")
    )
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    body_adf: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    local_origin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("comments_issue_idx", "issue_key", postgresql_where="removed_at IS NULL"),
        Index(
            "comments_author_idx",
            "author_id",
            "created_at",
            postgresql_where="removed_at IS NULL",
        ),
        Index("comments_created_idx", "created_at"),
    )
