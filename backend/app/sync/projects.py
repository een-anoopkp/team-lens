"""Project freeze job — runs at end of every sync.

Discovers logical "projects" from epic labels prefixed `proj_`. When every
labelled epic of a project is in `status_category = 'done'`, snapshots the
project's final stats into `project_snapshots`. Idempotent — re-runs are
no-ops unless the project's epic set or completion timestamp changes.

Re-open semantics: if a previously-completed project gets a new (open) epic,
the snapshot row stays as the historical "as-of completion-1". When the
project re-completes, the row is updated with the new epic set + stats.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import (
    Epic,
    Issue,
    IssueSprint,
    ProjectSnapshot,
    ScopeChangeEvent,
    Sprint,
)

logger = structlog.get_logger(__name__)

_PROJECT_LABEL_PREFIX = "proj_"


# ---------- Label extraction --------------------------------------------------

def extract_project_labels(raw_payload: dict[str, Any] | None) -> list[str]:
    """Return project names (the bit after `proj_`) from an epic's raw_payload labels."""
    if not raw_payload:
        return []
    fields = raw_payload.get("fields") or {}
    labels = fields.get("labels") or []
    out: list[str] = []
    for label in labels:
        if isinstance(label, str) and label.startswith(_PROJECT_LABEL_PREFIX):
            name = label[len(_PROJECT_LABEL_PREFIX) :]
            if name:
                out.append(name)
    return out


# ---------- Stats container ---------------------------------------------------

@dataclass(slots=True)
class _ProjectStats:
    project_name: str
    completed_at: datetime
    epic_count: int
    epic_keys: list[str]
    total_sp: Decimal
    sprints_active: int
    first_sprint_name: str | None
    last_sprint_name: str | None
    avg_velocity_sp: Decimal | None
    avg_sprint_length_d: Decimal | None
    scope_churn_pct: Decimal | None
    sp_added_total: Decimal
    sp_removed_total: Decimal
    contributors: list[str]
    initiative_keys: list[str]
    raw_metrics: dict[str, Any]


# ---------- Public entry point ------------------------------------------------

async def run_freeze_job(session_factory: async_sessionmaker) -> int:
    """Snapshot all newly-completed projects. Returns number of snapshots written."""
    written = 0
    async with session_factory() as session:
        epics = (
            await session.execute(
                select(Epic).where(Epic.raw_payload.is_not(None))
            )
        ).scalars().all()

        # Group epics by project name from `proj_*` labels
        by_project: dict[str, list[Epic]] = defaultdict(list)
        for epic in epics:
            for project_name in extract_project_labels(epic.raw_payload):
                by_project[project_name].append(epic)

        # Existing snapshots — for idempotency check
        existing_snapshots = {
            s.project_name: s
            for s in (
                await session.execute(select(ProjectSnapshot))
            ).scalars().all()
        }

        for project_name, project_epics in by_project.items():
            if not _is_completed(project_epics):
                continue

            new_epic_keys = sorted(e.issue_key for e in project_epics)
            existing = existing_snapshots.get(project_name)

            if existing is not None and sorted(existing.epic_keys) == new_epic_keys:
                # No change — skip
                continue

            stats = await _compute_stats(session, project_name, project_epics)
            await _upsert_snapshot(session, stats, existing is not None)
            written += 1
            logger.info(
                "project_snapshot_written",
                project=project_name,
                epic_count=stats.epic_count,
                total_sp=str(stats.total_sp),
                action="updated" if existing else "inserted",
            )

        if written:
            await session.commit()

    return written


def _is_completed(epics: list[Epic]) -> bool:
    return all(e.status_category == "done" for e in epics) and len(epics) > 0


# ---------- Stats computation -------------------------------------------------

async def _compute_stats(
    session: AsyncSession, project_name: str, epics: list[Epic]
) -> _ProjectStats:
    epic_keys = sorted(e.issue_key for e in epics)

    # All child issues (excluding sub-tasks for SP totals — sub-tasks have no SP)
    child_issues = (
        await session.execute(
            select(Issue).where(Issue.epic_key.in_(epic_keys))
        )
    ).scalars().all()

    issue_keys = [i.issue_key for i in child_issues]
    non_subtask = [i for i in child_issues if i.issue_type != "Sub-task"]

    # Sprints these issues lived in
    sprint_rows = (
        await session.execute(
            select(Sprint)
            .join(IssueSprint, IssueSprint.sprint_id == Sprint.sprint_id)
            .where(IssueSprint.issue_key.in_(issue_keys))
            .distinct()
        )
    ).scalars().all() if issue_keys else []

    # Scope events on the project's child issues
    events = (
        await session.execute(
            select(ScopeChangeEvent).where(
                ScopeChangeEvent.issue_key.in_(issue_keys)
            )
        )
    ).scalars().all() if issue_keys else []

    total_sp = sum(
        (Decimal(str(i.story_points)) for i in non_subtask if i.story_points is not None),
        Decimal("0"),
    )
    sprints_active = len({sp.sprint_id for sp in sprint_rows})

    sorted_sprints = sorted(
        [sp for sp in sprint_rows if sp.start_date is not None],
        key=lambda s: s.start_date,  # type: ignore[arg-type, return-value]
    )
    first_sprint = sorted_sprints[0].name if sorted_sprints else None
    last_sprint = sorted_sprints[-1].name if sorted_sprints else None

    delivered_sp = sum(
        (
            Decimal(str(i.story_points))
            for i in non_subtask
            if i.story_points is not None
            and i.status_category == "done"
            and i.resolution_date is not None
        ),
        Decimal("0"),
    )
    avg_velocity = (delivered_sp / sprints_active) if sprints_active else None

    sprint_lengths_d = [
        (sp.end_date - sp.start_date).days
        for sp in sorted_sprints
        if sp.start_date is not None and sp.end_date is not None
    ]
    avg_length = (
        Decimal(sum(sprint_lengths_d)) / Decimal(len(sprint_lengths_d))
        if sprint_lengths_d
        else None
    )

    sp_added_total = sum(
        (Decimal(str(e.sp_delta)) for e in events if e.sp_delta and e.sp_delta > 0),
        Decimal("0"),
    )
    sp_removed_total = sum(
        (-Decimal(str(e.sp_delta)) for e in events if e.sp_delta and e.sp_delta < 0),
        Decimal("0"),
    )
    churn_pct = (
        (sp_added_total + sp_removed_total) / total_sp * 100
        if total_sp > 0
        else None
    )

    contributors = sorted(
        {
            i.assignee_id
            for i in non_subtask
            if i.assignee_id and i.status_category == "done"
        }
    )
    initiative_keys = sorted({e.initiative_key for e in epics if e.initiative_key})

    completed_at = max(
        (
            i.resolution_date
            for i in non_subtask
            if i.resolution_date is not None
        ),
        default=datetime.now(tz=UTC),
    )

    raw_metrics = {
        "epic_count": len(epics),
        "child_issue_count": len(child_issues),
        "non_subtask_count": len(non_subtask),
        "delivered_sp": str(delivered_sp),
        "computed_at": datetime.now(tz=UTC).isoformat(),
    }

    return _ProjectStats(
        project_name=project_name,
        completed_at=completed_at,
        epic_count=len(epics),
        epic_keys=epic_keys,
        total_sp=total_sp,
        sprints_active=sprints_active,
        first_sprint_name=first_sprint,
        last_sprint_name=last_sprint,
        avg_velocity_sp=avg_velocity,
        avg_sprint_length_d=avg_length,
        scope_churn_pct=churn_pct,
        sp_added_total=sp_added_total,
        sp_removed_total=sp_removed_total,
        contributors=contributors,
        initiative_keys=initiative_keys,
        raw_metrics=raw_metrics,
    )


# ---------- Persist -----------------------------------------------------------

async def _upsert_snapshot(
    session: AsyncSession, stats: _ProjectStats, exists: bool
) -> None:
    payload = {
        "project_name": stats.project_name,
        "completed_at": stats.completed_at,
        "epic_count": stats.epic_count,
        "epic_keys": stats.epic_keys,
        "total_sp": stats.total_sp,
        "sprints_active": stats.sprints_active,
        "first_sprint_name": stats.first_sprint_name,
        "last_sprint_name": stats.last_sprint_name,
        "avg_velocity_sp": stats.avg_velocity_sp,
        "avg_sprint_length_d": stats.avg_sprint_length_d,
        "scope_churn_pct": stats.scope_churn_pct,
        "sp_added_total": stats.sp_added_total,
        "sp_removed_total": stats.sp_removed_total,
        "contributors": stats.contributors,
        "initiative_keys": stats.initiative_keys,
        "raw_metrics": stats.raw_metrics,
        "snapshot_at": datetime.now(tz=UTC),
    }
    if exists:
        await session.execute(
            update(ProjectSnapshot)
            .where(ProjectSnapshot.project_name == stats.project_name)
            .values(**payload)
        )
    else:
        await session.execute(insert(ProjectSnapshot), [payload])
