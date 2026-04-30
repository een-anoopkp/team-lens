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
import contextlib
from collections.abc import Iterable
from datetime import UTC, datetime

import structlog
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.jira.client import JiraClient, JiraClientError
from app.jira.fields import FieldRegistry
from app.models import (
    Comment,
    Epic,
    Initiative,
    Issue,
    IssueSprint,
    Person,
    SyncRun,
)
from app.sync import sprints, transform
from app.sync.context import SyncContext
from app.sync.stats import SyncStats

logger = structlog.get_logger(__name__)

_COMMENT_FETCH_CONCURRENCY = 8


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

            await self._sync_issues(jira, effective_scan, last_iso, stats)

            # 8. Comments for touched issues
            if stats.touched_issue_keys:
                await self._sync_comments_for(jira, stats.touched_issue_keys)

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

    # ---- issues -------------------------------------------------------------

    async def _sync_issues(
        self,
        jira: JiraClient,
        scan_type: str,
        last_iso: str | None,
        stats: SyncStats,
    ) -> None:
        team_field = self._settings.jira_team_field
        team_value = self._settings.jira_team_value
        if not team_value:
            raise RuntimeError("JIRA_TEAM_VALUE is empty — refusing to sync without team filter")

        cf_num = (
            team_field.replace("customfield_", "cf[") + "]"
            if team_field.startswith("customfield_")
            else team_field
        )
        # Sub-tasks on this tenant inherit cf[10500] from their parent (per
        # tenant memory note + verified in spike). The legacy Apps Script also
        # uses just the team-field equality; no `parent in (...)` subquery
        # because JQL doesn't accept sub-predicates inside `in`.
        base_jql = f'{cf_num} = "{team_value}"'

        if scan_type == "incremental" and last_iso:
            jql = f'{base_jql} AND updated >= "{last_iso}"'
        else:
            jql = base_jql

        logger.info("sync_issues_jql", jql=jql, scan_type=scan_type)

        # Buffer issues; flush in batches to keep memory bounded.
        BATCH = 200
        buf: list[dict] = []
        async for issue in await jira.search_issues(
            jql, fields=self._fields.core_fields(), page_size=100
        ):
            buf.append(issue)
            stats.issues_seen += 1
            stats.touched_issue_keys.add(issue["key"])
            if len(buf) >= BATCH:
                await self._flush_issues_batch(jira, buf, stats)
                buf = []
        if buf:
            await self._flush_issues_batch(jira, buf, stats)

    async def _flush_issues_batch(
        self, jira: JiraClient, batch: list[dict], stats: SyncStats
    ) -> None:
        # 1. Collect all referenced parents we don't yet have
        parent_keys_needed: set[str] = set()
        for issue in batch:
            parent = (issue.get("fields") or {}).get("parent") or {}
            if parent.get("key"):
                parent_keys_needed.add(parent["key"])

        # Filter to those NOT already in DB (initiatives + epics)
        async with self._session_factory() as session:
            existing_epics = await session.scalars(
                select(Epic.issue_key).where(Epic.issue_key.in_(parent_keys_needed))
            )
            existing_initiatives = await session.scalars(
                select(Initiative.issue_key).where(Initiative.issue_key.in_(parent_keys_needed))
            )
            already_have = set(existing_epics.all()) | set(existing_initiatives.all())
        missing_parents = parent_keys_needed - already_have

        # 2. Fetch missing parents (small batches via key in (...))
        parent_issues: list[dict] = []
        if missing_parents:
            keys_list = list(missing_parents)
            for i in range(0, len(keys_list), 50):
                chunk = keys_list[i : i + 50]
                jql = "key in (" + ",".join(chunk) + ")"
                async for p in await jira.search_issues(
                    jql, fields=self._fields.core_fields(), page_size=50
                ):
                    parent_issues.append(p)

        # 3. Walk parents one more level if any are Epics — pull their parent Initiatives
        initiative_keys_needed: set[str] = set()
        for p in parent_issues:
            ptype = ((p.get("fields") or {}).get("issuetype") or {}).get("name")
            if ptype == "Epic":
                grand = ((p.get("fields") or {}).get("parent") or {}).get("key")
                if grand:
                    initiative_keys_needed.add(grand)

        if initiative_keys_needed:
            async with self._session_factory() as session:
                existing = await session.scalars(
                    select(Initiative.issue_key).where(
                        Initiative.issue_key.in_(initiative_keys_needed)
                    )
                )
                already_have = set(existing.all())
            initiative_keys_needed -= already_have
            keys_list = list(initiative_keys_needed)
            for i in range(0, len(keys_list), 50):
                chunk = keys_list[i : i + 50]
                jql = "key in (" + ",".join(chunk) + ")"
                async for p in await jira.search_issues(
                    jql, fields=self._fields.core_fields(), page_size=50
                ):
                    parent_issues.append(p)

        # 4. Upsert all issues (people first to satisfy FKs)
        all_issues = batch + parent_issues
        await self._upsert_people_for(all_issues)
        await self._upsert_initiatives(parent_issues)
        await self._upsert_epics(parent_issues + batch)
        await self._upsert_issues(batch, stats)
        await self._sync_embedded_sprints(all_issues)
        await self._replace_issue_sprints(batch)

    async def _upsert_people_for(self, issues: Iterable[dict]) -> None:
        """Extract assignee/reporter/creator from each issue and upsert."""
        seen: dict[str, dict] = {}
        for issue in issues:
            for p in transform.collect_people_from_issue(issue):
                seen[p["account_id"]] = p
        await self._upsert_people_rows(list(seen.values()))

    async def _upsert_people_rows(self, rows: list[dict]) -> None:
        """Upsert pre-converted person dicts (ORM-shape: account_id, display_name, ...)."""
        if not rows:
            return
        async with self._session_factory() as session:
            stmt = pg_insert(Person).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Person.account_id],
                set_={
                    "display_name": stmt.excluded.display_name,
                    "email": stmt.excluded.email,
                    "active": stmt.excluded.active,
                    "last_seen_at": datetime.now(tz=UTC),
                },
            )
            await session.execute(stmt)
            await session.commit()

    async def _upsert_initiatives(self, issues: Iterable[dict]) -> None:
        seen: dict[str, dict] = {}
        for i in issues:
            if ((i.get("fields") or {}).get("issuetype") or {}).get("name") == "Initiative":
                row = transform.initiative_from_jira(i)
                seen[row["issue_key"]] = row  # dedupe by PK
        rows = list(seen.values())
        if not rows:
            return
        async with self._session_factory() as session:
            stmt = pg_insert(Initiative).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Initiative.issue_key],
                set_={
                    "summary": stmt.excluded.summary,
                    "status": stmt.excluded.status,
                    "status_category": stmt.excluded.status_category,
                    "owner_account_id": stmt.excluded.owner_account_id,
                    "raw_payload": stmt.excluded.raw_payload,
                    "synced_at": datetime.now(tz=UTC),
                },
            )
            await session.execute(stmt)
            await session.commit()

    async def _upsert_epics(self, issues: Iterable[dict]) -> None:
        seen: dict[str, dict] = {}
        for i in issues:
            if ((i.get("fields") or {}).get("issuetype") or {}).get("name") == "Epic":
                row = transform.epic_from_jira(i)
                seen[row["issue_key"]] = row  # dedupe by PK
        rows = list(seen.values())
        if not rows:
            return
        async with self._session_factory() as session:
            stmt = pg_insert(Epic).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Epic.issue_key],
                set_={
                    "summary": stmt.excluded.summary,
                    "status": stmt.excluded.status,
                    "status_category": stmt.excluded.status_category,
                    "initiative_key": stmt.excluded.initiative_key,
                    "owner_account_id": stmt.excluded.owner_account_id,
                    "due_date": stmt.excluded.due_date,
                    "raw_payload": stmt.excluded.raw_payload,
                    "synced_at": datetime.now(tz=UTC),
                },
            )
            await session.execute(stmt)
            await session.commit()

    async def _upsert_issues(self, batch: list[dict], stats: SyncStats) -> None:
        # Dedupe by issue_key, and SKIP issuetypes that own their own tables
        # (Initiative → initiatives, Epic → epics). The `issues` table is
        # only Story / Task / Bug / Sub-task per schema design.
        seen: dict[str, dict] = {}
        for i in batch:
            itype = ((i.get("fields") or {}).get("issuetype") or {}).get("name", "")
            if itype in ("Initiative", "Epic"):
                continue
            row = transform.issue_from_jira(i, self._fields)
            seen[row["issue_key"]] = row
        rows = list(seen.values())
        if not rows:
            return
        now = datetime.now(tz=UTC)
        async with self._session_factory() as session:
            # Determine which keys exist before upsert (so we can attribute insert vs update counts)
            keys = [r["issue_key"] for r in rows]
            existing = await session.scalars(
                select(Issue.issue_key).where(Issue.issue_key.in_(keys))
            )
            existing_set = set(existing.all())
            stats.issues_inserted += sum(1 for k in keys if k not in existing_set)
            stats.issues_updated += sum(1 for k in keys if k in existing_set)

            for r in rows:
                r["last_seen_at"] = now
                r["synced_at"] = now
                r["removed_at"] = None  # restoring a previously-removed key reactivates it

            stmt = pg_insert(Issue).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Issue.issue_key],
                set_={
                    "issue_type": stmt.excluded.issue_type,
                    "summary": stmt.excluded.summary,
                    "status": stmt.excluded.status,
                    "status_category": stmt.excluded.status_category,
                    "assignee_id": stmt.excluded.assignee_id,
                    "reporter_id": stmt.excluded.reporter_id,
                    "parent_key": stmt.excluded.parent_key,
                    "epic_key": stmt.excluded.epic_key,
                    "story_points": stmt.excluded.story_points,
                    "resolution_date": stmt.excluded.resolution_date,
                    "due_date": stmt.excluded.due_date,
                    "updated_at": stmt.excluded.updated_at,
                    "raw_payload": stmt.excluded.raw_payload,
                    "last_seen_at": stmt.excluded.last_seen_at,
                    "removed_at": None,
                    "synced_at": stmt.excluded.synced_at,
                },
            )
            await session.execute(stmt)
            await session.commit()

    async def _sync_embedded_sprints(self, issues: Iterable[dict]) -> None:
        seen: dict[int, dict] = {}
        prefix = self._settings.jira_sprint_name_prefix
        for issue in issues:
            for sp in transform.sprints_from_issue(
                issue, self._fields, sprint_name_prefix=prefix
            ):
                seen[sp["sprint_id"]] = sp
        if not seen:
            return
        await sprints.upsert_sprints(self._ctx, list(seen.values()))

    async def _replace_issue_sprints(self, batch: list[dict]) -> None:
        prefix = self._settings.jira_sprint_name_prefix
        # Dedupe (issue_key, sprint_id) pairs — same pair from a duplicated issue
        # in the batch would otherwise violate the PK on insert.
        unique_pairs: set[tuple[str, int]] = set()
        keys_touched: set[str] = set()
        for issue in batch:
            keys_touched.add(issue["key"])
            for ik, sid in transform.issue_sprint_pairs(
                issue, self._fields, sprint_name_prefix=prefix
            ):
                unique_pairs.add((ik, sid))

        if not keys_touched:
            return
        async with self._session_factory() as session:
            await session.execute(
                delete(IssueSprint).where(IssueSprint.issue_key.in_(keys_touched))
            )
            if unique_pairs:
                await session.execute(
                    pg_insert(IssueSprint).values(
                        [{"issue_key": ik, "sprint_id": sid} for ik, sid in unique_pairs]
                    )
                )
            await session.commit()

    # ---- comments -----------------------------------------------------------

    async def _sync_comments_for(self, jira: JiraClient, issue_keys: set[str]) -> None:
        sem = asyncio.Semaphore(_COMMENT_FETCH_CONCURRENCY)

        async def fetch_one(key: str) -> tuple[str, list[dict]]:
            async with sem:
                items: list[dict] = []
                try:
                    async for c in await jira.list_issue_comments(key):
                        items.append(c)
                except JiraClientError as e:
                    logger.warning("comment_fetch_failed", issue=key, err=str(e))
                return key, items

        results = await asyncio.gather(*(fetch_one(k) for k in issue_keys))

        seen_comments: dict[str, dict] = {}
        seen_authors: dict[str, dict] = {}
        for key, items in results:
            for c in items:
                row = transform.comment_from_jira(c, key)
                seen_comments[row["comment_id"]] = row  # dedupe by PK
                author = (c.get("author") or {})
                p = transform.person_from_user(author)
                if p:
                    seen_authors[p["account_id"]] = p
        rows = list(seen_comments.values())

        # Comment authors may not be team-issue assignees/reporters; upsert
        # directly via the ORM-row entry-point so the FK on comments.author_id
        # always finds a row.
        if seen_authors:
            await self._upsert_people_rows(list(seen_authors.values()))

        if not rows:
            return
        now = datetime.now(tz=UTC)
        # asyncpg has a hard cap of 32767 bind parameters per query. With
        # ~10 cols per comment, a single batch maxes around ~3000 rows.
        # Chunk to stay well below the cap; 1000 rows ≈ 10000 params.
        CHUNK = 1000
        async with self._session_factory() as session:
            for i in range(0, len(rows), CHUNK):
                chunk = [{**r, "last_seen_at": now} for r in rows[i : i + CHUNK]]
                stmt = pg_insert(Comment).values(chunk)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[Comment.comment_id],
                    set_={
                        "issue_key": stmt.excluded.issue_key,
                        "author_id": stmt.excluded.author_id,
                        "body_text": stmt.excluded.body_text,
                        "body_adf": stmt.excluded.body_adf,
                        "created_at": stmt.excluded.created_at,
                        "updated_at": stmt.excluded.updated_at,
                        "last_seen_at": stmt.excluded.last_seen_at,
                        "removed_at": None,
                    },
                )
                await session.execute(stmt)
            await session.commit()

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


# Suppress "unused import" if snapshots/projects modules are absent during early phases.
_ = contextlib  # noqa: F841
