"""APScheduler wiring for incremental + weekly full-scan sync jobs.

Also schedules the daily insight_runs retention sweep at 04:00 IST.
"""

from __future__ import annotations

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import Settings
from app.db import get_session_factory
from app.sync.runner import SyncRunner

logger = structlog.get_logger(__name__)


def _parse_cron(expr: str) -> CronTrigger:
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f"Cron must have 5 fields: {expr!r}")
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        timezone="Asia/Kolkata",
    )


def build_scheduler(settings: Settings, runner: SyncRunner) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

    async def fire_incremental() -> None:
        try:
            await runner.run(scan_type="incremental", trigger="scheduled")
        except Exception:
            logger.exception("scheduled_incremental_failed")

    async def fire_full() -> None:
        try:
            await runner.run(scan_type="full", trigger="scheduled")
        except Exception:
            logger.exception("scheduled_full_failed")

    scheduler.add_job(
        fire_incremental,
        trigger=_parse_cron(settings.sync_cron),
        id="sync_incremental",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        fire_full,
        trigger=_parse_cron(settings.full_scan_cron),
        id="sync_full",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    async def fire_insight_retention() -> None:
        try:
            from app.insights.retention import purge_expired

            async with get_session_factory()() as session:
                await purge_expired(session)
        except Exception:
            logger.exception("insight_retention_failed")

    scheduler.add_job(
        fire_insight_retention,
        trigger=_parse_cron("0 4 * * *"),  # daily 04:00 IST
        id="insight_retention",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    logger.info(
        "scheduler_configured",
        sync_cron=settings.sync_cron,
        full_scan_cron=settings.full_scan_cron,
        insight_retention_cron="0 4 * * *",
    )
    return scheduler
