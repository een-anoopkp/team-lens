"""Projects endpoints.

- `/`              — Phase 5 list (active rollups + completed snapshots).
- `/raw`           — Phase 1 debug view (label-derived list, no math).
- `/comparison`    — Phase 5 comparison (active vs. closed snapshots).
- `/{name}`        — Phase 5 drill-in. (Defined LAST so static paths win.)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.metrics.projects import (
    compare_projects,
    get_project,
    list_projects,
)
from app.models import Epic, ProjectSnapshot
from app.sync.projects import extract_project_labels

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


# ---- Shared row models -----------------------------------------------------


class ProjectListRow(BaseModel):
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
    completed_at: datetime | None


class EpicRollupRow(BaseModel):
    issue_key: str
    summary: str
    status: str
    status_category: str
    issue_count: int
    sp_total: Decimal
    sp_done: Decimal


class SprintTouchedRow(BaseModel):
    sprint_id: int
    name: str
    state: str
    start_date: date | None
    end_date: date | None


class ProjectDetailResponse(BaseModel):
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
    etd_by_velocity_basis: str
    etd_by_sprint_assignment: date | None
    etd_by_sprint_assignment_basis: str
    sp_added_total: Decimal
    sp_removed_total: Decimal
    scope_churn_pct: Decimal | None
    contributors: list[str]
    initiative_keys: list[str]
    epics: list[EpicRollupRow]
    sprints: list[SprintTouchedRow]
    completed_at: datetime | None


class ComparisonStatsRow(BaseModel):
    p25: Decimal | None
    median: Decimal | None
    p75: Decimal | None
    n: int


class ProjectComparisonResponse(BaseModel):
    active: list[ProjectListRow]
    completed_count: int
    velocity: ComparisonStatsRow
    churn_pct: ComparisonStatsRow
    sprints_active: ComparisonStatsRow
    sprint_length_d: ComparisonStatsRow
    enough_history: bool


class ProjectRaw(BaseModel):
    project_name: str
    epic_count: int
    epic_keys: list[str]
    epic_status_categories: dict[str, int]
    classification: Literal["active", "completed"]


# ---- Phase 5 list ----------------------------------------------------------


@router.get("", response_model=list[ProjectListRow])
async def list_projects_endpoint(
    session: AsyncSession = Depends(get_session),
) -> list[ProjectListRow]:
    rows = await list_projects(session)
    return [_to_list_row(r) for r in rows]


# ---- Phase 1 raw debug list ------------------------------------------------


@router.get("/raw", response_model=list[ProjectRaw])
async def list_projects_raw(
    session: AsyncSession = Depends(get_session),
) -> list[ProjectRaw]:
    epics = (await session.execute(select(Epic))).scalars().all()
    by_project: dict[str, list[Epic]] = defaultdict(list)
    for epic in epics:
        for proj in extract_project_labels(epic.raw_payload):
            by_project[proj].append(epic)

    snap_names = {
        s.project_name
        for s in (
            await session.execute(select(ProjectSnapshot.project_name))
        ).scalars().all()
    }

    out: list[ProjectRaw] = []
    for project_name, project_epics in sorted(by_project.items()):
        cat_counts: dict[str, int] = defaultdict(int)
        for e in project_epics:
            cat_counts[e.status_category] += 1
        all_done = all(e.status_category == "done" for e in project_epics)
        classification = (
            "completed" if (all_done or project_name in snap_names) else "active"
        )
        out.append(
            ProjectRaw(
                project_name=project_name,
                epic_count=len(project_epics),
                epic_keys=sorted(e.issue_key for e in project_epics),
                epic_status_categories=dict(cat_counts),
                classification=classification,
            )
        )
    return out


# ---- Phase 5 comparison ----------------------------------------------------


@router.get("/comparison", response_model=ProjectComparisonResponse)
async def project_comparison_endpoint(
    session: AsyncSession = Depends(get_session),
) -> ProjectComparisonResponse:
    cmp_ = await compare_projects(session)
    return ProjectComparisonResponse(
        active=[_to_list_row(r) for r in cmp_.active],
        completed_count=cmp_.completed_count,
        velocity=_to_stats_row(cmp_.velocity),
        churn_pct=_to_stats_row(cmp_.churn_pct),
        sprints_active=_to_stats_row(cmp_.sprints_active),
        sprint_length_d=_to_stats_row(cmp_.sprint_length_d),
        enough_history=cmp_.enough_history,
    )


# ---- Phase 5 drill-in (defined LAST so /raw and /comparison win) -----------


@router.get("/{project_name}", response_model=ProjectDetailResponse)
async def project_detail_endpoint(
    project_name: str,
    session: AsyncSession = Depends(get_session),
) -> ProjectDetailResponse:
    detail = await get_project(session, project_name)
    if detail is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": f"no project named '{project_name}'",
            },
        )
    return ProjectDetailResponse(
        project_name=detail.project_name,
        classification=detail.classification,
        epic_count=detail.epic_count,
        total_sp=detail.total_sp,
        done_sp=detail.done_sp,
        pct_done=detail.pct_done,
        sprints_active=detail.sprints_active,
        avg_velocity_sp=detail.avg_velocity_sp,
        avg_sprint_length_d=detail.avg_sprint_length_d,
        etd_by_velocity=detail.etd_by_velocity,
        etd_by_velocity_basis=detail.etd_by_velocity_basis,
        etd_by_sprint_assignment=detail.etd_by_sprint_assignment,
        etd_by_sprint_assignment_basis=detail.etd_by_sprint_assignment_basis,
        sp_added_total=detail.sp_added_total,
        sp_removed_total=detail.sp_removed_total,
        scope_churn_pct=detail.scope_churn_pct,
        contributors=detail.contributors,
        initiative_keys=detail.initiative_keys,
        epics=[
            EpicRollupRow(
                issue_key=e.issue_key,
                summary=e.summary,
                status=e.status,
                status_category=e.status_category,
                issue_count=e.issue_count,
                sp_total=e.sp_total,
                sp_done=e.sp_done,
            )
            for e in detail.epics
        ],
        sprints=[
            SprintTouchedRow(
                sprint_id=s.sprint_id,
                name=s.name,
                state=s.state,
                start_date=s.start_date,
                end_date=s.end_date,
            )
            for s in detail.sprints
        ],
        completed_at=detail.completed_at,
    )


# ---- helpers ---------------------------------------------------------------


def _to_list_row(r) -> ProjectListRow:
    return ProjectListRow(
        project_name=r.project_name,
        classification=r.classification,
        epic_count=r.epic_count,
        total_sp=r.total_sp,
        done_sp=r.done_sp,
        pct_done=r.pct_done,
        sprints_active=r.sprints_active,
        avg_velocity_sp=r.avg_velocity_sp,
        avg_sprint_length_d=r.avg_sprint_length_d,
        etd_by_velocity=r.etd_by_velocity,
        etd_by_sprint_assignment=r.etd_by_sprint_assignment,
        completed_at=r.completed_at,
    )


def _to_stats_row(s) -> ComparisonStatsRow:
    return ComparisonStatsRow(p25=s.p25, median=s.median, p75=s.p75, n=s.n)
