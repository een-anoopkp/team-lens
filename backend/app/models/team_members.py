"""Team membership whitelist.

A row here means: this person is currently on Search team. The user
maintains the list explicitly via the Settings page — sync does not
auto-add or remove. Pages that should be team-scoped (Leaderboard,
Leave dropdown) filter by membership in this table; pages that show
historical work (Sprint Health, project drill-ins) ignore it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TeamMember(Base):
    __tablename__ = "team_members"

    account_id: Mapped[str] = mapped_column(
        String, ForeignKey("people.account_id"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # When false, the person stays in team-scoped views (Leaderboard rows,
    # Leave dropdown) but is excluded from sprint-capacity computations:
    # not in /sprint-health per-person rollup, not in person-days. Used
    # for leads / embedded QA / anyone who doesn't carry a ticket workload.
    counts_for_capacity: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
