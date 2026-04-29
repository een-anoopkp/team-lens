"""Public holidays — used for working-day computation per region."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Holiday(Base):
    __tablename__ = "holidays"

    holiday_date: Mapped[date] = mapped_column(Date, primary_key=True)
    region: Mapped[str] = mapped_column(String, primary_key=True, default="IN")
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("holidays_date_idx", "holiday_date"),)
