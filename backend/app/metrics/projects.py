"""Phase 5 — Projects metrics.

Pure SQL on already-synced data. Three public functions that back the
three /api/v1/projects endpoints:

- `list_projects`    — active rollups + completed snapshots (one combined list)
- `get_project`      — single-project drill-in (epics, sprints, ETD, churn)
- `compare_projects` — active rollups + p25/median/p75 across closed snapshots

ETD math (active projects only):
  - by velocity:   remaining_sp / avg_velocity_sp_per_sprint × avg_sprint_length
  - by sprint-asg: end_date of the latest sprint containing an open project issue
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from statistics import median
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Epic,
    Issue,
    IssueSprint,
    Person,
    ProjectSnapshot,
    ScopeChangeEvent,
    Sprint,
)
from app.sync.projects import extract_project_labels


# ---------- DTOs --------------------------------------------------------------


@dataclass(slots=True)
class ProjectListItem:
    project_name: str
    classification: Literal["active", "completed"]
    epic_count: int
    total_sp: Decimal
    done_sp: Decimal
    pct_done: Decimal
    sprints_active: int
    avg_velocity_sp: Decimal | None
    avg_sprint_length_d: Decimal | None
    etd_by_velocity: date | None
    etd_by_sprint_assignment: date | None
    completed_at: datetime | None  # populated only for completed snapshots


@dataclass(slots=True)
class EpicRollup:
    issue_key: str
    summary: str
    status: str
    status_category: str
    issue_count: int
    sp_total: Decimal
    sp_done: Decimal


@dataclass(slots=True)
class SprintTouched:
    sprint_id: int
    name: str
    state: str
    start_date: date | None
    end_date: date | None


@dataclass(slots=True)
class ProjectDetail:
    project_name: str
    classification: Literal["active", "completed"]
    epic_count: int
    total_sp: Decimal
    done_sp: Decimal
    pct_done: Decimal
    sprints_active: int
    avg_velocity_sp: Decimal | None
    avg_sprint_length_d: Decimal | None
    etd_by_velocity: date | None
    etd_by_velocity_basis: str  # human-readable explanation
    etd_by_sprint_assignment: date | None
    etd_by_sprint_assignment_basis: str
    sp_added_total: Decimal
    sp_removed_total: Decimal
    scope_churn_pct: Decimal | None
    contributors: list[str]
    initiative_keys: list[str]
    epics: list[EpicRollup]
    sprints: list[SprintTouched]
    completed_at: datetime | None


@dataclass(slots=True)
class ComparisonStats:
    p25: Decimal | None
    median: Decimal | None
    p75: Decimal | None
    n: int


@dataclass(slots=True)
class ProjectComparison:
    active: list[ProjectListItem]
    completed_count: int
    velocity: ComparisonStats
    churn_pct: ComparisonStats
    sprints_active: ComparisonStats
    sprint_length_d: ComparisonStats
    enough_history: bool  # True when completed_count >= 5


# ---------- Internal: group epics by project ---------------------------------


async def _group_active_project_epics(
    session: AsyncSession,
) -> dict[str, list[Epic]]:
    """Walk all epics, return active projects only (not yet fully done)."""
    epics = (await session.execute(select(Epic))).scalars().all()
    by_project: dict[str, list[Epic]] = defaultdict(list)
    for e in epics:
        for proj in extract_project_labels(e.raw_payload):
            by_project[proj].append(e)
    # Active = at least one epic not done
    return {
        name: project_epics
        for name, project_epics in by_project.items()
        if any(ep.status_category != "done" for ep in project_epics)
    }


# ---------- Internal: compute active-project rollup --------------------------


@dataclass(slots=True)
class _ActiveRollup:
    epic_count: int
    epic_keys: list[str]
    total_sp: Decimal
    done_sp: Decimal
    sprints_active: int
    avg_velocity_sp: Decimal | None
    avg_sprint_length_d: Decimal | None
    sp_added_total: Decimal
    sp_removed_total: Decimal
    scope_churn_pct: Decimal | None
    contributors: list[str]
    initiative_keys: list[str]
    epic_rollups: list[EpicRollup] = field(default_factory=list)
    sprints: list[SprintTouched] = field(default_factory=list)
    latest_open_sprint_end: date | None = None  # for ETD-by-sprint-assignment


async def _compute_active_rollup(
    session: AsyncSession, epics: list[Epic]
) -> _ActiveRollup:
    epic_keys = sorted(e.issue_key for e in epics)

    children = (
        await session.execute(
            select(Issue).where(
                Issue.epic_key.in_(epic_keys), Issue.removed_at.is_(None)
            )
        )
    ).scalars().all()
    issue_keys = [i.issue_key for i in children]
    non_sub = [i for i in children if i.issue_type != "Sub-task"]

    total_sp = sum(
        (Decimal(str(i.story_points)) for i in non_sub if i.story_points is not None),
        Decimal("0"),
    )
    done_sp = sum(
        (
            Decimal(str(i.story_points))
            for i in non_sub
            if i.story_points is not None and i.status_category == "done"
        ),
        Decimal("0"),
    )

    # Sprints touched by any project issue
    sprint_rows: list[Sprint] = []
    if issue_keys:
        sprint_rows = list(
            (
                await session.execute(
                    select(Sprint)
                    .join(IssueSprint, IssueSprint.sprint_id == Sprint.sprint_id)
                    .where(IssueSprint.issue_key.in_(issue_keys))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
    sorted_sprints = sorted(
        [sp for sp in sprint_rows if sp.start_date is not None],
        key=lambda s: s.start_date,  # type: ignore[arg-type, return-value]
    )
    sprints_active = len({s.sprint_id for s in sprint_rows})

    sprint_lengths_d = [
        (s.end_date - s.start_date).days
        for s in sorted_sprints
        if s.start_date is not None and s.end_date is not None
    ]
    avg_length = (
        Decimal(sum(sprint_lengths_d)) / Decimal(len(sprint_lengths_d))
        if sprint_lengths_d
        else None
    )

    delivered_sp_by_sprint = done_sp  # whole-project delivered SP
    avg_velocity = (
        (delivered_sp_by_sprint / Decimal(sprints_active))
        if sprints_active
        else None
    )

    # Scope churn from scope_change_events on the project's child issues
    events = []
    if issue_keys:
        events = (
            await session.execute(
                select(ScopeChangeEvent).where(
                    ScopeChangeEvent.issue_key.in_(issue_keys)
                )
            )
        ).scalars().all()
    sp_added = sum(
        (Decimal(str(ev.sp_delta)) for ev in events if ev.sp_delta and ev.sp_delta > 0),
        Decimal("0"),
    )
    sp_removed = sum(
        (-Decimal(str(ev.sp_delta)) for ev in events if ev.sp_delta and ev.sp_delta < 0),
        Decimal("0"),
    )
    churn_pct = (
        ((sp_added + sp_removed) / total_sp * Decimal("100")).quantize(Decimal("0.1"))
        if total_sp > 0
        else None
    )

    # Contributors: account_ids of anyone who has a non-subtask in this project
    contributor_ids = sorted(
        {i.assignee_id for i in non_sub if i.assignee_id}
    )
    # Resolve display names
    contributor_names: list[str] = []
    if contributor_ids:
        rows = (
            await session.execute(
                select(Person.display_name).where(Person.account_id.in_(contributor_ids))
            )
        ).all()
        contributor_names = sorted([r[0] for r in rows if r[0]])

    initiative_keys = sorted({e.initiative_key for e in epics if e.initiative_key})

    # Per-epic rollup (for drill-in)
    epic_rollups: list[EpicRollup] = []
    for e in epics:
        my_kids = [c for c in non_sub if c.epic_key == e.issue_key]
        epic_rollups.append(
            EpicRollup(
                issue_key=e.issue_key,
                summary=e.summary,
                status=e.status,
                status_category=e.status_category,
                issue_count=len(my_kids),
                sp_total=sum(
                    (Decimal(str(k.story_points)) for k in my_kids if k.story_points),
                    Decimal("0"),
                ),
                sp_done=sum(
                    (
                        Decimal(str(k.story_points))
                        for k in my_kids
                        if k.story_points and k.status_category == "done"
                    ),
                    Decimal("0"),
                ),
            )
        )
    epic_rollups.sort(key=lambda r: r.issue_key)

    sprints_dto = [
        SprintTouched(
            sprint_id=s.sprint_id,
            name=s.name,
            state=s.state,
            start_date=s.start_date.date() if s.start_date else None,
            end_date=s.end_date.date() if s.end_date else None,
        )
        for s in sorted_sprints
    ]

    # ETD-by-sprint-assignment helper: latest end_date of a sprint that
    # contains an OPEN issue from this project. Sprint dates are datetimes;
    # we expose them as calendar dates.
    open_issue_keys = {i.issue_key for i in non_sub if i.status_category != "done"}
    latest_open_end: date | None = None
    if open_issue_keys and sprint_rows:
        rows = (
            await session.execute(
                select(Sprint.end_date)
                .join(IssueSprint, IssueSprint.sprint_id == Sprint.sprint_id)
                .where(IssueSprint.issue_key.in_(open_issue_keys))
                .where(Sprint.end_date.is_not(None))
            )
        ).all()
        ends = [r[0] for r in rows if r[0] is not None]
        if ends:
            latest_open_end = max(ends).date()

    return _ActiveRollup(
        epic_count=len(epics),
        epic_keys=epic_keys,
        total_sp=total_sp,
        done_sp=done_sp,
        sprints_active=sprints_active,
        avg_velocity_sp=avg_velocity,
        avg_sprint_length_d=avg_length,
        sp_added_total=sp_added,
        sp_removed_total=sp_removed,
        scope_churn_pct=churn_pct,
        contributors=contributor_names,
        initiative_keys=initiative_keys,
        epic_rollups=epic_rollups,
        sprints=sprints_dto,
        latest_open_sprint_end=latest_open_end,
    )


def _etd_by_velocity(
    *,
    total_sp: Decimal,
    done_sp: Decimal,
    avg_velocity_sp: Decimal | None,
    avg_sprint_length_d: Decimal | None,
) -> tuple[date | None, str]:
    """Calendar date when project would finish at current velocity."""
    remaining = total_sp - done_sp
    if remaining <= 0:
        return None, "all SP delivered"
    if not avg_velocity_sp or avg_velocity_sp <= 0:
        return None, "no velocity history yet"
    if not avg_sprint_length_d or avg_sprint_length_d <= 0:
        return None, "no sprint-length history"
    sprints_left = remaining / avg_velocity_sp
    days = float(sprints_left * avg_sprint_length_d)
    eta = date.today() + timedelta(days=int(round(days)))
    basis = (
        f"{remaining} SP remaining at {avg_velocity_sp:.1f} SP/sprint × "
        f"{avg_sprint_length_d:.0f} days/sprint"
    )
    return eta, basis


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    if whole <= 0:
        return Decimal("0")
    return (part / whole * Decimal("100")).quantize(Decimal("0.1"))


# ---------- Public: list_projects --------------------------------------------


async def list_projects(session: AsyncSession) -> list[ProjectListItem]:
    """Active projects (live) + completed snapshots, in one list."""
    out: list[ProjectListItem] = []

    # ---- Active ----
    active_groups = await _group_active_project_epics(session)
    for name, epics in active_groups.items():
        roll = await _compute_active_rollup(session, epics)
        etd_v, _ = _etd_by_velocity(
            total_sp=roll.total_sp,
            done_sp=roll.done_sp,
            avg_velocity_sp=roll.avg_velocity_sp,
            avg_sprint_length_d=roll.avg_sprint_length_d,
        )
        out.append(
            ProjectListItem(
                project_name=name,
                classification="active",
                epic_count=roll.epic_count,
                total_sp=roll.total_sp,
                done_sp=roll.done_sp,
                pct_done=_pct(roll.done_sp, roll.total_sp),
                sprints_active=roll.sprints_active,
                avg_velocity_sp=roll.avg_velocity_sp,
                avg_sprint_length_d=roll.avg_sprint_length_d,
                etd_by_velocity=etd_v,
                etd_by_sprint_assignment=roll.latest_open_sprint_end,
                completed_at=None,
            )
        )

    # ---- Completed (from snapshots) ----
    snaps = (
        await session.execute(select(ProjectSnapshot))
    ).scalars().all()
    for s in snaps:
        out.append(
            ProjectListItem(
                project_name=s.project_name,
                classification="completed",
                epic_count=s.epic_count,
                total_sp=s.total_sp,
                done_sp=s.total_sp,
                pct_done=Decimal("100.0"),
                sprints_active=s.sprints_active,
                avg_velocity_sp=s.avg_velocity_sp,
                avg_sprint_length_d=s.avg_sprint_length_d,
                etd_by_velocity=None,
                etd_by_sprint_assignment=None,
                completed_at=s.completed_at,
            )
        )

    # Active first, then completed. Within each, by name.
    out.sort(key=lambda p: (0 if p.classification == "active" else 1, p.project_name))
    return out


# ---------- Public: get_project ----------------------------------------------


async def get_project(
    session: AsyncSession, project_name: str
) -> ProjectDetail | None:
    """Drill-in for one project. Returns None when no labelled epics found."""
    # Active epics first
    active_groups = await _group_active_project_epics(session)
    if project_name in active_groups:
        epics = active_groups[project_name]
        roll = await _compute_active_rollup(session, epics)
        etd_v, etd_v_basis = _etd_by_velocity(
            total_sp=roll.total_sp,
            done_sp=roll.done_sp,
            avg_velocity_sp=roll.avg_velocity_sp,
            avg_sprint_length_d=roll.avg_sprint_length_d,
        )
        if roll.latest_open_sprint_end:
            sa_basis = (
                f"latest sprint with open work ends {roll.latest_open_sprint_end}"
            )
        else:
            sa_basis = "no open issues are assigned to a sprint with an end date"
        return ProjectDetail(
            project_name=project_name,
            classification="active",
            epic_count=roll.epic_count,
            total_sp=roll.total_sp,
            done_sp=roll.done_sp,
            pct_done=_pct(roll.done_sp, roll.total_sp),
            sprints_active=roll.sprints_active,
            avg_velocity_sp=roll.avg_velocity_sp,
            avg_sprint_length_d=roll.avg_sprint_length_d,
            etd_by_velocity=etd_v,
            etd_by_velocity_basis=etd_v_basis,
            etd_by_sprint_assignment=roll.latest_open_sprint_end,
            etd_by_sprint_assignment_basis=sa_basis,
            sp_added_total=roll.sp_added_total,
            sp_removed_total=roll.sp_removed_total,
            scope_churn_pct=roll.scope_churn_pct,
            contributors=roll.contributors,
            initiative_keys=roll.initiative_keys,
            epics=roll.epic_rollups,
            sprints=roll.sprints,
            completed_at=None,
        )

    # Completed projects: read from snapshot + rebuild epic + sprint rollups
    snap = (
        await session.execute(
            select(ProjectSnapshot).where(
                ProjectSnapshot.project_name == project_name
            )
        )
    ).scalar_one_or_none()
    if snap is None:
        return None

    epic_objs = (
        await session.execute(select(Epic).where(Epic.issue_key.in_(snap.epic_keys)))
    ).scalars().all()
    # For epic rollups (children may have been purged later but we still want a view)
    children = (
        await session.execute(
            select(Issue).where(
                Issue.epic_key.in_(snap.epic_keys), Issue.removed_at.is_(None)
            )
        )
    ).scalars().all()
    non_sub = [i for i in children if i.issue_type != "Sub-task"]

    epic_rollups: list[EpicRollup] = []
    for e in epic_objs:
        my_kids = [c for c in non_sub if c.epic_key == e.issue_key]
        epic_rollups.append(
            EpicRollup(
                issue_key=e.issue_key,
                summary=e.summary,
                status=e.status,
                status_category=e.status_category,
                issue_count=len(my_kids),
                sp_total=sum(
                    (Decimal(str(k.story_points)) for k in my_kids if k.story_points),
                    Decimal("0"),
                ),
                sp_done=sum(
                    (
                        Decimal(str(k.story_points))
                        for k in my_kids
                        if k.story_points and k.status_category == "done"
                    ),
                    Decimal("0"),
                ),
            )
        )
    epic_rollups.sort(key=lambda r: r.issue_key)

    issue_keys = [i.issue_key for i in children]
    sprints_dto: list[SprintTouched] = []
    if issue_keys:
        sprint_rows = (
            await session.execute(
                select(Sprint)
                .join(IssueSprint, IssueSprint.sprint_id == Sprint.sprint_id)
                .where(IssueSprint.issue_key.in_(issue_keys))
                .distinct()
            )
        ).scalars().all()
        sprints_dto = [
            SprintTouched(
                sprint_id=s.sprint_id,
                name=s.name,
                state=s.state,
                start_date=s.start_date.date() if s.start_date else None,
                end_date=s.end_date.date() if s.end_date else None,
            )
            for s in sorted(
                [s for s in sprint_rows if s.start_date is not None],
                key=lambda s: s.start_date,  # type: ignore[arg-type, return-value]
            )
        ]

    # Resolve contributor display names from snapshot's account_ids
    contributors_names: list[str] = []
    if snap.contributors:
        rows = (
            await session.execute(
                select(Person.display_name).where(
                    Person.account_id.in_(snap.contributors)
                )
            )
        ).all()
        contributors_names = sorted([r[0] for r in rows if r[0]])

    return ProjectDetail(
        project_name=snap.project_name,
        classification="completed",
        epic_count=snap.epic_count,
        total_sp=snap.total_sp,
        done_sp=snap.total_sp,
        pct_done=Decimal("100.0"),
        sprints_active=snap.sprints_active,
        avg_velocity_sp=snap.avg_velocity_sp,
        avg_sprint_length_d=snap.avg_sprint_length_d,
        etd_by_velocity=None,
        etd_by_velocity_basis="completed",
        etd_by_sprint_assignment=None,
        etd_by_sprint_assignment_basis="completed",
        sp_added_total=snap.sp_added_total or Decimal("0"),
        sp_removed_total=snap.sp_removed_total or Decimal("0"),
        scope_churn_pct=snap.scope_churn_pct,
        contributors=contributors_names,
        initiative_keys=list(snap.initiative_keys or []),
        epics=epic_rollups,
        sprints=sprints_dto,
        completed_at=snap.completed_at,
    )


# ---------- Public: compare_projects -----------------------------------------


def _percentile(values: list[Decimal], q: float) -> Decimal | None:
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    frac = Decimal(str(k - lo))
    return s[lo] + (s[hi] - s[lo]) * frac


def _stats(values: list[Decimal]) -> ComparisonStats:
    valid = [v for v in values if v is not None]
    if not valid:
        return ComparisonStats(p25=None, median=None, p75=None, n=0)
    return ComparisonStats(
        p25=_percentile(valid, 0.25),
        median=Decimal(str(median(valid))),
        p75=_percentile(valid, 0.75),
        n=len(valid),
    )


async def compare_projects(session: AsyncSession) -> ProjectComparison:
    """Active rollups + p25/median/p75 across closed snapshots."""
    active = await list_projects(session)
    active_only = [p for p in active if p.classification == "active"]

    snaps = (await session.execute(select(ProjectSnapshot))).scalars().all()
    velocities = [s.avg_velocity_sp for s in snaps if s.avg_velocity_sp is not None]
    churns = [s.scope_churn_pct for s in snaps if s.scope_churn_pct is not None]
    sprints_actives = [Decimal(s.sprints_active) for s in snaps]
    sprint_lens = [
        s.avg_sprint_length_d for s in snaps if s.avg_sprint_length_d is not None
    ]

    return ProjectComparison(
        active=active_only,
        completed_count=len(snaps),
        velocity=_stats(velocities),
        churn_pct=_stats(churns),
        sprints_active=_stats(sprints_actives),
        sprint_length_d=_stats(sprint_lens),
        enough_history=len(snaps) >= 5,
    )
