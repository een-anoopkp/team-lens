"""Phase 3 metrics endpoints — pure SQL on synced data."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.metrics.blockers import blockers_for_sprint
from app.metrics.burnup import burnup_for_sprint
from app.metrics.carry_over import carry_over_for_sprint
from app.metrics.epic_risk import classify_epic_risks, epic_throughput
from app.metrics.velocity import velocity_for_sprint_window

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


# ---- Velocity ----------------------------------------------------------------

class VelocityRow(BaseModel):
    sprint_id: int
    sprint_name: str
    person_account_id: str
    person_display_name: str | None
    committed_sp: Decimal
    completed_sp: Decimal
    available_days: int
    velocity: Decimal | None
    accuracy: Decimal | None


@router.get("/velocity", response_model=list[VelocityRow])
async def velocity(
    sprint_window: int = Query(6, ge=1, le=24),
    person: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[VelocityRow]:
    settings = get_settings()
    rows = await velocity_for_sprint_window(
        session,
        sprint_window=sprint_window,
        person_account_id=person,
        region=settings.team_region,
    )
    return [
        VelocityRow(
            sprint_id=r.sprint_id,
            sprint_name=r.sprint_name,
            person_account_id=r.person_account_id,
            person_display_name=r.person_display_name,
            committed_sp=r.committed_sp,
            completed_sp=r.completed_sp,
            available_days=r.available_days,
            velocity=r.velocity,
            accuracy=r.accuracy,
        )
        for r in rows
    ]


# ---- Carry-over --------------------------------------------------------------

class CarryOverRow(BaseModel):
    issue_key: str
    summary: str
    assignee_id: str | None
    assignee_display_name: str | None
    depth: int
    story_points: Decimal | None


@router.get("/carry-over", response_model=list[CarryOverRow])
async def carry_over(
    sprint_id: int = Query(..., description="sprint to compute carry-over for"),
    session: AsyncSession = Depends(get_session),
) -> list[CarryOverRow]:
    rows = await carry_over_for_sprint(session, sprint_id=sprint_id)
    return [
        CarryOverRow(
            issue_key=r.issue_key,
            summary=r.summary,
            assignee_id=r.assignee_id,
            assignee_display_name=r.assignee_display_name,
            depth=r.depth,
            story_points=r.story_points,
        )
        for r in rows
    ]


# ---- Blockers ----------------------------------------------------------------

class BlockerRow(BaseModel):
    issue_key: str
    parent_key: str | None
    summary: str
    status: str
    assignee_display_name: str | None
    age_days: int
    band: str  # green | yellow | red


@router.get("/blockers", response_model=list[BlockerRow])
async def blockers(
    sprint_id: int = Query(..., description="sprint to scan for blockers"),
    session: AsyncSession = Depends(get_session),
) -> list[BlockerRow]:
    rows = await blockers_for_sprint(session, sprint_id=sprint_id)
    return [
        BlockerRow(
            issue_key=r.issue_key,
            parent_key=r.parent_key,
            summary=r.summary,
            status=r.status,
            assignee_display_name=r.assignee_display_name,
            age_days=r.age_days,
            band=r.band,
        )
        for r in rows
    ]


# ---- Burnup ------------------------------------------------------------------

class BurnupPoint(BaseModel):
    day: date
    cumulative_done_sp: Decimal
    cumulative_committed_sp: Decimal


class BurnupResponse(BaseModel):
    sprint_id: int
    sprint_name: str
    target_sp: Decimal
    points: list[BurnupPoint]


@router.get("/burnup", response_model=BurnupResponse)
async def burnup(
    sprint_id: int = Query(..., description="sprint to compute burnup for"),
    session: AsyncSession = Depends(get_session),
) -> BurnupResponse:
    payload = await burnup_for_sprint(session, sprint_id=sprint_id)
    return BurnupResponse(
        sprint_id=payload.get("sprint_id", sprint_id),
        sprint_name=payload.get("sprint_name", ""),
        target_sp=Decimal(payload.get("target_sp", 0)),
        points=[
            BurnupPoint(
                day=p.day, cumulative_done_sp=p.cumulative_done_sp, cumulative_committed_sp=p.cumulative_committed_sp
            )
            for p in payload.get("points", [])
        ],
    )


# ---- Scope changes already exists at /api/v1/scope-changes (Phase 1.9).
# Re-export under /metrics/scope-changes for the spec's URL contract.

class ScopeChangeRow(BaseModel):
    id: int
    issue_key: str
    sprint_name: str
    change_type: str
    old_value: str | None
    new_value: str | None
    sp_delta: Decimal | None
    detected_at: datetime


# ---- Epic Risk ---------------------------------------------------------------

class EpicRiskRow(BaseModel):
    issue_key: str
    summary: str
    status: str
    status_category: str
    initiative_key: str | None
    owner_account_id: str | None
    owner_display_name: str | None
    due_date: date | None
    days_overdue: int | None
    issue_count: int
    sp_total: Decimal
    sp_done: Decimal
    days_since_activity: int | None
    risk_band: str
    risk_reasons: list[str]


class EpicRiskSummary(BaseModel):
    at_risk: int
    watch: int
    on_track: int
    done: int


class EpicRiskResponse(BaseModel):
    summary: EpicRiskSummary
    epics: list[EpicRiskRow]


@router.get("/epic-risk", response_model=EpicRiskResponse)
async def epic_risk(
    session: AsyncSession = Depends(get_session),
) -> EpicRiskResponse:
    settings = get_settings()
    rows = await classify_epic_risks(
        session,
        team_field=settings.jira_team_field,
        team_id=settings.jira_team_value or None,
    )
    summary = EpicRiskSummary(at_risk=0, watch=0, on_track=0, done=0)
    payload: list[EpicRiskRow] = []
    for r in rows:
        # Tally
        if r.risk_band == "at_risk":
            summary.at_risk += 1
        elif r.risk_band == "watch":
            summary.watch += 1
        elif r.risk_band == "on_track":
            summary.on_track += 1
        else:
            summary.done += 1
        payload.append(
            EpicRiskRow(
                issue_key=r.issue_key,
                summary=r.summary,
                status=r.status,
                status_category=r.status_category,
                initiative_key=r.initiative_key,
                owner_account_id=r.owner_account_id,
                owner_display_name=r.owner_display_name,
                due_date=r.due_date,
                days_overdue=r.days_overdue,
                issue_count=r.issue_count,
                sp_total=r.sp_total,
                sp_done=r.sp_done,
                days_since_activity=r.days_since_activity,
                risk_band=r.risk_band,
                risk_reasons=r.risk_reasons,
            )
        )
    return EpicRiskResponse(summary=summary, epics=payload)


class ThroughputRow(BaseModel):
    sprint_id: int
    sprint_name: str
    closed_epics: int


@router.get("/epic-throughput", response_model=list[ThroughputRow])
async def epic_throughput_endpoint(
    sprint_window: int = Query(6, ge=1, le=24),
    session: AsyncSession = Depends(get_session),
) -> list[ThroughputRow]:
    settings = get_settings()
    rows = await epic_throughput(
        session,
        sprint_window=sprint_window,
        team_field=settings.jira_team_field,
        team_id=settings.jira_team_value or None,
    )
    return [
        ThroughputRow(
            sprint_id=r.sprint_id,
            sprint_name=r.sprint_name,
            closed_epics=r.closed_epics,
        )
        for r in rows
    ]


# ---- Scope changes ------------------------------------------------------------

@router.get("/scope-changes", response_model=list[ScopeChangeRow])
async def scope_changes(
    sprint_name: str | None = None,
    sprint_id: int | None = None,
    issue_key: str | None = None,
    change_type: str | None = None,
    since: datetime | None = None,
    limit: int = Query(200, ge=1, le=2000),
    session: AsyncSession = Depends(get_session),
) -> list[ScopeChangeRow]:
    """Same backing table as /api/v1/scope-changes; spec exposes this URL too."""
    from sqlalchemy import select

    from app.models import ScopeChangeEvent, Sprint

    stmt = select(ScopeChangeEvent)
    if sprint_id is not None:
        # Look up the sprint name for filtering
        sname = (
            await session.execute(
                select(Sprint.name).where(Sprint.sprint_id == sprint_id)
            )
        ).scalar_one_or_none()
        if sname:
            stmt = stmt.where(ScopeChangeEvent.sprint_name == sname)
    if sprint_name is not None:
        stmt = stmt.where(ScopeChangeEvent.sprint_name == sprint_name)
    if issue_key is not None:
        stmt = stmt.where(ScopeChangeEvent.issue_key == issue_key)
    if change_type is not None:
        stmt = stmt.where(ScopeChangeEvent.change_type == change_type)
    if since is not None:
        stmt = stmt.where(ScopeChangeEvent.detected_at >= since)
    stmt = stmt.order_by(ScopeChangeEvent.detected_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        ScopeChangeRow(
            id=r.id,
            issue_key=r.issue_key,
            sprint_name=r.sprint_name,
            change_type=r.change_type,
            old_value=r.old_value,
            new_value=r.new_value,
            sp_delta=r.sp_delta,
            detected_at=r.detected_at,
        )
        for r in rows
    ]
