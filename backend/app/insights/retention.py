"""Daily cleanup of insight_runs rows older than the retention window."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InsightRun

logger = structlog.get_logger(__name__)

RETENTION_DAYS = 90


async def purge_expired(session: AsyncSession, *, days: int = RETENTION_DAYS) -> int:
    """Delete insight_runs rows older than `days`. Returns rows deleted."""
    cutoff = datetime.now(tz=UTC) - timedelta(days=days)
    result = await session.execute(
        delete(InsightRun).where(InsightRun.started_at < cutoff)
    )
    await session.commit()
    purged = result.rowcount or 0
    if purged:
        logger.info("insight_runs_purged", count=purged, cutoff=cutoff.isoformat())
    return purged
