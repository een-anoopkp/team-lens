"""Sync runner — orchestrates a full or incremental Jira → Postgres pull.

Pipeline (per docs/local-app/03-sync-engine.md):
  1. Insert sync_runs row (status=running)
  2. Discover custom-field IDs (best-effort)
  3. Sync sprints (all `Search 20*` ones, both active and closed)
  4. Search issues (full or incremental JQL)
  5. Pull missing parent epics + initiatives
  6. Upsert people / initiatives / epics / issues
  7. Replace issue_sprints rows for touched issues
  8. Pull comments for touched issues (concurrent, semaphore-bounded)
  9. (full only) Mark removed issues / comments via last_seen_at
 10. Snapshot diff hook (step 1.6 — placeholder no-op here)
 11. Project freeze hook (step 1.7 — placeholder no-op here)
 12. Update sync_runs row (status=success + counts)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.jira.client import JiraClient
from app.jira.fields import FieldRegistry
from app.models import Issue, SyncRun
from app.sync import comments, issues, sprints
from app.sync.context import SyncContext
from app.sync.stats import SyncStats

logger = structlog.get_logger(__name__)


class SyncRunner:
    """Serialises sync runs via an asyncio.Lock; safe for both manual + scheduled trigger."""

    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession],
        fields: FieldRegistry,
    ):
        self._ctx = SyncContext(
            settings=settings, session_factory=session_factory, fields=fields
        )
        # Per-attribute aliases retained while extraction is in progress;
        # removed once every worker reads through self._ctx (final cleanup step).
        self._settings = settings
        self._session_factory = session_factory
        self._fields = fields
        self._lock = asyncio.Lock()

    @property
    def is_running(self) -> bool:
        return self._lock.locked()

    async def run(self, *, scan_type: str, trigger: str) -> int:
        """Execute one sync run. Returns the sync_runs.id."""
        if scan_type not in ("incremental", "full"):
            raise ValueError(f"Unknown scan_type: {scan_type}")

        async with self._lock:
            run_id, run_started_at = await self._start_run(scan_type, trigger)
            stats = SyncStats()
            try:
                stats = await self._execute(scan_type, run_id, run_started_at)
                await self._finish_run(run_id, "success", stats)
                logger.info(
                    "sync_run_complete",
                    run_id=run_id,
                    scan_type=scan_type,
                    issues_seen=stats.issues_seen,
                )
            except Exception as e:
                logger.exception("sync_run_failed", run_id=run_id)
                stats.error_message = str(e)[:500]
                await self._finish_run(run_id, "failed", stats)
                raise
            return run_id

    # ---- pipeline -----------------------------------------------------------

    async def _execute(
        self, scan_type: str, run_id: int, run_started_at: datetime
    ) -> SyncStats:
        stats = SyncStats()

        async with JiraClient(
            self._settings.jira_base_url,
            self._settings.jira_email,
            self._settings.jira_api_token,
        ) as jira:
            # 2. Field discovery (best-effort)
            await self._fields.refresh(jira)

            # 3. Sprints
            await sprints.sync_board_sprints(self._ctx, jira)

            # 4. Issues + parents
            last_iso = await self._last_successful_sync_iso()
            effective_scan = scan_type
            if scan_type == "incremental" and last_iso is None:
                logger.info("incremental_fallback_to_full", reason="no prior success")
                effective_scan = "full"

            await issues.sync_issues(self._ctx, jira, effective_scan, last_iso, stats)

            # 8. Comments for touched issues
            if stats.touched_issue_keys:
                await comments.sync_comments_for(self._ctx, jira, stats.touched_issue_keys)

            # 9. Removal detection (full only)
            if effective_scan == "full":
                stats.issues_removed = await self._mark_removed(run_started_at)

            # 10. Snapshot diff hook (1.6)
            try:
                from app.sync import snapshots  # local import — module added in 1.6
                await snapshots.update_snapshots(  # type: ignore[attr-defined]
                    self._session_factory,
                    touched_issue_keys=stats.touched_issue_keys,
                    is_full_backfill=(effective_scan == "full" and last_iso is None),
                    stats=stats,
                )
            except (ImportError, AttributeError):
                logger.debug("snapshots_module_not_yet_implemented")

            # 11. Project freeze hook (1.7)
            try:
                from app.sync import projects  # local import — module added in 1.7
                await projects.run_freeze_job(self._session_factory)  # type: ignore[attr-defined]
            except (ImportError, AttributeError):
                logger.debug("projects_module_not_yet_implemented")

            # 12. Insight anomaly evaluation (v3) — never aborts the sync.
            try:
                from app.insights.anomalies import evaluate_all_anomalies
                async with self._session_factory() as session:
                    n = await evaluate_all_anomalies(
                        session,
                        team_field=self._settings.jira_team_field,
                        team_id=self._settings.jira_team_value or None,
                        region=self._settings.team_region,
                    )
                logger.info("insight_anomalies_evaluated", count=n)
            except Exception:
                logger.exception("insight_anomalies_failed")

        return stats

    # ---- removal detection --------------------------------------------------

    async def _mark_removed(self, run_started_at: datetime) -> int:
        async with self._session_factory() as session:
            result = await session.execute(
                update(Issue)
                .where(Issue.last_seen_at < run_started_at, Issue.removed_at.is_(None))
                .values(removed_at=datetime.now(tz=UTC))
            )
            await session.commit()
            return int(result.rowcount or 0)

    # ---- run lifecycle ------------------------------------------------------

    async def _start_run(self, scan_type: str, trigger: str) -> tuple[int, datetime]:
        async with self._session_factory() as session:
            now = datetime.now(tz=UTC)
            run = SyncRun(
                started_at=now,
                status="running",
                scan_type=scan_type,
                trigger=trigger,
            )
            session.add(run)
            await session.flush()
            run_id = run.id
            await session.commit()
        return run_id, now

    async def _finish_run(self, run_id: int, status_value: str, stats: SyncStats) -> None:
        async with self._session_factory() as session:
            await session.execute(
                update(SyncRun)
                .where(SyncRun.id == run_id)
                .values(
                    finished_at=datetime.now(tz=UTC),
                    status=status_value,
                    issues_seen=stats.issues_seen,
                    issues_inserted=stats.issues_inserted,
                    issues_updated=stats.issues_updated,
                    issues_removed=stats.issues_removed,
                    sp_changes=stats.sp_changes,
                    assignee_changes=stats.assignee_changes,
                    status_changes=stats.status_changes,
                    error_message=stats.error_message,
                )
            )
            await session.commit()

    async def _last_successful_sync_iso(self) -> str | None:
        async with self._session_factory() as session:
            result = await session.execute(
                select(SyncRun.finished_at)
                .where(SyncRun.status == "success")
                .order_by(SyncRun.finished_at.desc())
                .limit(1)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            # Jira accepts JQL "updated >= '<iso>'" — use the same format.
            return row.strftime("%Y-%m-%d %H:%M")
