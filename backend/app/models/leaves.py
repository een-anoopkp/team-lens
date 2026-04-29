"""Team leaves — feeds velocity calc AND serves as standalone team-availability tracker."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Leave(Base):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    person_account_id: Mapped[str] = mapped_column(
        String, ForeignKey("people.account_id"), nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="leaves_end_after_start"),
        Index("leaves_person_idx", "person_account_id"),
        Index("leaves_dates_idx", "start_date", "end_date"),
    )
