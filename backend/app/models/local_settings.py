"""Local-only settings — never synced to/from Jira."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LocalSetting(Base):
    __tablename__ = "local_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(
        JSONB, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
