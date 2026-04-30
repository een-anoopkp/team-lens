"""Sync run / status endpoints."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Literal

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import SyncRun

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


class SyncRunRequest(BaseModel):
    scan_type: Literal["incremental", "full"] = "incremental"


class SyncRunAccepted(BaseModel):
    sync_run_id: int
    scan_type: str
    status: str = "running"


class SyncRunSummary(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    scan_type: str
    trigger: str
    issues_seen: int
    issues_inserted: int
    issues_updated: int
    issues_removed: int
    sp_changes: int
    assignee_changes: int
    status_changes: int
    error_message: str | None


class ScheduledJob(BaseModel):
    id: str
    cron: str | None
    next_run_at: datetime | None


class SyncStatusResponse(BaseModel):
    is_running: bool
    last_success_at: datetime | None
    runs: list[SyncRunSummary]
    scheduled: list[ScheduledJob]


@router.post("/run", response_model=SyncRunAccepted, status_code=status.HTTP_202_ACCEPTED)
async def trigger_sync(
    payload: SyncRunRequest,
    background: BackgroundTasks,
):
    """Kick off a sync run. Returns 202 + run id; the run continues in the background."""
    from app.main import get_runner

    runner = get_runner()
    if runner is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "runner_not_ready", "message": "Sync runner not initialised"},
        )
    if runner.is_running:
        raise HTTPException(
            status_code=409,
            detail={"error": "sync_in_progress", "message": "A sync is already running"},
        )

    # Eagerly create the sync_runs row so the caller can track via /sync/status.
    # Schedule the actual work as a background task.
    run_id_holder: dict[str, int] = {}

    async def _run() -> None:
        try:
            run_id_holder["id"] = await runner.run(
                scan_type=payload.scan_type, trigger="manual"
            )
        except Exception:
            logger.exception("manual_sync_failed")

    # Don't return run_id (background task may not have started yet).
    # Front-end polls /sync/status to find the new running row.
    asyncio.create_task(_run())  # noqa: RUF006 — fire-and-forget per design

    return SyncRunAccepted(sync_run_id=-1, scan_type=payload.scan_type)


@router.get("/status", response_model=SyncStatusResponse)
async def sync_status(
    limit: int = Query(10, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    from app.config import get_settings
    from app.main import get_runner, get_scheduler

    runner = get_runner()
    scheduler = get_scheduler()
    settings = get_settings()
    rows = (
        await session.execute(
            select(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit)
        )
    ).scalars().all()
    last_success = (
        await session.execute(
            select(SyncRun.finished_at)
            .where(SyncRun.status == "success")
            .order_by(SyncRun.finished_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    cron_by_job = {
        "sync_incremental": settings.sync_cron,
        "sync_full": settings.full_scan_cron,
    }
    scheduled: list[ScheduledJob] = []
    if scheduler is not None:
        for job in scheduler.get_jobs():
            scheduled.append(
                ScheduledJob(
                    id=job.id,
                    cron=cron_by_job.get(job.id),
                    next_run_at=job.next_run_time,
                )
            )

    return SyncStatusResponse(
        is_running=bool(runner and runner.is_running),
        last_success_at=last_success,
        scheduled=scheduled,
        runs=[
            SyncRunSummary(
                id=r.id,
                started_at=r.started_at,
                finished_at=r.finished_at,
                status=r.status,
                scan_type=r.scan_type,
                trigger=r.trigger,
                issues_seen=r.issues_seen or 0,
                issues_inserted=r.issues_inserted or 0,
                issues_updated=r.issues_updated or 0,
                issues_removed=r.issues_removed or 0,
                sp_changes=r.sp_changes or 0,
                assignee_changes=r.assignee_changes or 0,
                status_changes=r.status_changes or 0,
                error_message=r.error_message,
            )
            for r in rows
        ],
    )
