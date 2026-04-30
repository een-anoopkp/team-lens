"""ORM models for the Insights feature (v3)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class InsightRule(Base):
    """Persisted toggle + config for a rule. Rule *definitions* live in
    `app.insights.registry`; this table only holds mutable state."""

    __tablename__ = "insight_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # 'anomaly' | 'llm'
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class InsightRun(Base):
    """One evaluation. Anomalies write a row per sync per rule; LLM rules
    write a row per generation. Retained 90 days then deleted."""

    __tablename__ = "insight_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule_id: Mapped[str] = mapped_column(
        String, ForeignKey("insight_rules.id"), nullable=False
    )
    trigger: Mapped[str] = mapped_column(String, nullable=False)
    # 'auto-post-sync' | 'auto-stale' | 'manual' | 'manual-run-for'
    scope: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    # 'ok' | 'failed' | 'running'
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    body_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "insight_runs_rule_started_idx",
            "rule_id",
            "started_at",
        ),
        Index("insight_runs_status_idx", "status"),
    )
