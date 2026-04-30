"""Closed-project stats archive — populated by the freeze job at end of each sync."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, DateTime, Index, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# ARRAY(String) and JSONB are Postgres-specific. with_variant swaps in
# generic JSON on SQLite so cross-dialect tests can bind list/dict values
# without a custom TypeDecorator. Production (Postgres) keeps ARRAY/JSONB.
_StrArray = ARRAY(String).with_variant(JSON(), "sqlite")
_JsonB = JSONB().with_variant(JSON(), "sqlite")


class ProjectSnapshot(Base):
    __tablename__ = "project_snapshots"

    project_name: Mapped[str] = mapped_column(String, primary_key=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    epic_count: Mapped[int] = mapped_column(Integer, nullable=False)
    epic_keys: Mapped[list[str]] = mapped_column(_StrArray, nullable=False)
    total_sp: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    sprints_active: Mapped[int] = mapped_column(Integer, nullable=False)
    first_sprint_name: Mapped[str | None] = mapped_column(String)
    last_sprint_name: Mapped[str | None] = mapped_column(String)
    avg_velocity_sp: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    avg_sprint_length_d: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    scope_churn_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    sp_added_total: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    sp_removed_total: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    contributors: Mapped[list[str] | None] = mapped_column(_StrArray)
    initiative_keys: Mapped[list[str] | None] = mapped_column(_StrArray)
    raw_metrics: Mapped[dict] = mapped_column(_JsonB, nullable=False)
    snapshot_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("project_snapshots_completed_idx", "completed_at"),)
