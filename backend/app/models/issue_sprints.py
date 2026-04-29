"""Many-to-many issue ↔ sprint association table."""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IssueSprint(Base):
    __tablename__ = "issue_sprints"

    issue_key: Mapped[str] = mapped_column(
        String,
        ForeignKey("issues.issue_key", ondelete="CASCADE"),
        primary_key=True,
    )
    sprint_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sprints.sprint_id"), primary_key=True
    )

    __table_args__ = (Index("issue_sprints_sprint_idx", "sprint_id"),)
