"""Issue sync — search loop, parent walk, and per-batch upsert.

Public entry point: `sync_issues`. Walks the team-filtered JQL
(incremental or full), fetches missing parent epics/initiatives, then
flushes each 200-issue batch through the upsert pipeline:

    people → initiatives → epics → issues → embedded sprints → issue_sprints

Issue-family upserts skip Initiative/Epic types (which own their own
tables); the `issues` table holds Story / Task / Bug / Sub-task only.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.jira.client import JiraClient
from app.models import Epic, Initiative, Issue, IssueSprint
from app.sync import people, sprints, transform
from app.sync.context import SyncContext
from app.sync.stats import SyncStats

logger = structlog.get_logger(__name__)

_BATCH = 200
_PARENT_FETCH_CHUNK = 50


async def sync_issues(
    ctx: SyncContext,
    jira: JiraClient,
    scan_type: str,
    last_iso: str | None,
    stats: SyncStats,
) -> None:
    team_field = ctx.settings.jira_team_field
    team_value = ctx.settings.jira_team_value
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
    buf: list[dict] = []
    async for issue in await jira.search_issues(
        jql, fields=ctx.fields.core_fields(), page_size=100
    ):
        buf.append(issue)
        stats.issues_seen += 1
        stats.touched_issue_keys.add(issue["key"])
        if len(buf) >= _BATCH:
            await _flush_batch(ctx, jira, buf, stats)
            buf = []
    if buf:
        await _flush_batch(ctx, jira, buf, stats)


async def _flush_batch(
    ctx: SyncContext, jira: JiraClient, batch: list[dict], stats: SyncStats
) -> None:
    # 1. Collect all referenced parents we don't yet have
    parent_keys_needed: set[str] = set()
    for issue in batch:
        parent = (issue.get("fields") or {}).get("parent") or {}
        if parent.get("key"):
            parent_keys_needed.add(parent["key"])

    # Filter to those NOT already in DB (initiatives + epics)
    async with ctx.session_factory() as session:
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
        for i in range(0, len(keys_list), _PARENT_FETCH_CHUNK):
            chunk = keys_list[i : i + _PARENT_FETCH_CHUNK]
            jql = "key in (" + ",".join(chunk) + ")"
            async for p in await jira.search_issues(
                jql, fields=ctx.fields.core_fields(), page_size=_PARENT_FETCH_CHUNK
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
        async with ctx.session_factory() as session:
            existing = await session.scalars(
                select(Initiative.issue_key).where(
                    Initiative.issue_key.in_(initiative_keys_needed)
                )
            )
            already_have = set(existing.all())
        initiative_keys_needed -= already_have
        keys_list = list(initiative_keys_needed)
        for i in range(0, len(keys_list), _PARENT_FETCH_CHUNK):
            chunk = keys_list[i : i + _PARENT_FETCH_CHUNK]
            jql = "key in (" + ",".join(chunk) + ")"
            async for p in await jira.search_issues(
                jql, fields=ctx.fields.core_fields(), page_size=_PARENT_FETCH_CHUNK
            ):
                parent_issues.append(p)

    # 4. Upsert all issues (people first to satisfy FKs)
    all_issues = batch + parent_issues
    await people.upsert_people_for(ctx, all_issues)
    await _upsert_initiatives(ctx, parent_issues)
    await _upsert_epics(ctx, parent_issues + batch)
    await _upsert_issues(ctx, batch, stats)
    await _sync_embedded_sprints(ctx, all_issues)
    await _replace_issue_sprints(ctx, batch)


async def _upsert_initiatives(ctx: SyncContext, issues: Iterable[dict]) -> None:
    seen: dict[str, dict] = {}
    for i in issues:
        if ((i.get("fields") or {}).get("issuetype") or {}).get("name") == "Initiative":
            row = transform.initiative_from_jira(i)
            seen[row["issue_key"]] = row  # dedupe by PK
    rows = list(seen.values())
    if not rows:
        return
    async with ctx.session_factory() as session:
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


async def _upsert_epics(ctx: SyncContext, issues: Iterable[dict]) -> None:
    seen: dict[str, dict] = {}
    for i in issues:
        if ((i.get("fields") or {}).get("issuetype") or {}).get("name") == "Epic":
            row = transform.epic_from_jira(i)
            seen[row["issue_key"]] = row  # dedupe by PK
    rows = list(seen.values())
    if not rows:
        return
    async with ctx.session_factory() as session:
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


async def _upsert_issues(
    ctx: SyncContext, batch: list[dict], stats: SyncStats
) -> None:
    # Dedupe by issue_key, and SKIP issuetypes that own their own tables
    # (Initiative → initiatives, Epic → epics). The `issues` table is
    # only Story / Task / Bug / Sub-task per schema design.
    seen: dict[str, dict] = {}
    for i in batch:
        itype = ((i.get("fields") or {}).get("issuetype") or {}).get("name", "")
        if itype in ("Initiative", "Epic"):
            continue
        row = transform.issue_from_jira(i, ctx.fields)
        seen[row["issue_key"]] = row
    rows = list(seen.values())
    if not rows:
        return
    now = datetime.now(tz=UTC)
    async with ctx.session_factory() as session:
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


async def _sync_embedded_sprints(ctx: SyncContext, issues: Iterable[dict]) -> None:
    seen: dict[int, dict] = {}
    prefix = ctx.settings.jira_sprint_name_prefix
    for issue in issues:
        for sp in transform.sprints_from_issue(
            issue, ctx.fields, sprint_name_prefix=prefix
        ):
            seen[sp["sprint_id"]] = sp
    if not seen:
        return
    await sprints.upsert_sprints(ctx, list(seen.values()))


async def _replace_issue_sprints(ctx: SyncContext, batch: list[dict]) -> None:
    prefix = ctx.settings.jira_sprint_name_prefix
    # Dedupe (issue_key, sprint_id) pairs — same pair from a duplicated issue
    # in the batch would otherwise violate the PK on insert.
    unique_pairs: set[tuple[str, int]] = set()
    keys_touched: set[str] = set()
    for issue in batch:
        keys_touched.add(issue["key"])
        for ik, sid in transform.issue_sprint_pairs(
            issue, ctx.fields, sprint_name_prefix=prefix
        ):
            unique_pairs.add((ik, sid))

    if not keys_touched:
        return
    async with ctx.session_factory() as session:
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
