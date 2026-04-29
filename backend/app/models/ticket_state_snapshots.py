"""Per-(issue, sprint) state baseline. Counterfactual: first_sp = 0 for mid-sprint adds."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TicketStateSnapshot(Base):
    __tablename__ = "ticket_state_snapshots"

    issue_key: Mapped[str] = mapped_column(String, primary_key=True)
    sprint_name: Mapped[str] = mapped_column(String, primary_key=True)
    first_sp: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    last_sp: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    last_assignee: Mapped[str | None] = mapped_column(String)
    last_status: Mapped[str | None] = mapped_column(String)
    was_added_mid_sprint: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
