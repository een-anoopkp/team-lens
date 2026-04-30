"""Sprint listing + detail + rollup."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.metrics.sprint_rollup import sprint_rollup
from app.models import Sprint

router = APIRouter(prefix="/api/v1/sprints", tags=["sprints"])


class SprintOut(BaseModel):
    sprint_id: int
    name: str
    state: str
    start_date: datetime | None
    end_date: datetime | None
    complete_date: datetime | None
    board_id: int | None


def _to_out(s: Sprint) -> SprintOut:
    return SprintOut(
        sprint_id=s.sprint_id,
        name=s.name,
        state=s.state,
        start_date=s.start_date,
        end_date=s.end_date,
        complete_date=s.complete_date,
        board_id=s.board_id,
    )


# ---- Listing -----------------------------------------------------------------

@router.get("", response_model=list[SprintOut])
async def list_sprints(
    state: Literal["active", "closed", "future", "all"] = "all",
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[SprintOut]:
    stmt = select(Sprint)
    if state != "all":
        stmt = stmt.where(Sprint.state == state)
    stmt = stmt.order_by(Sprint.start_date.desc().nullslast()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [_to_out(r) for r in rows]


# ---- Active sprint shortcut --------------------------------------------------

@router.get("/active", response_model=SprintOut)
async def get_active_sprint(
    session: AsyncSession = Depends(get_session),
) -> SprintOut:
    """The current active sprint, or 404 if none."""
    row = (
        await session.execute(
            select(Sprint).where(Sprint.state == "active").order_by(Sprint.start_date.desc())
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(
            404, detail={"error": "no_active_sprint", "message": "No active sprint right now"}
        )
    return _to_out(row)


# ---- Rollup (per-person + KPIs + hygiene inline) ----------------------------

class StatusBreakdownOut(BaseModel):
    todo_sp: Decimal
    in_progress_sp: Decimal
    review_sp: Decimal
    validation_sp: Decimal
    done_sp: Decimal


class PersonRollupOut(BaseModel):
    person_account_id: str
    person_display_name: str | None
    committed_sp: Decimal
    completed_sp: Decimal
    available_days: int
    velocity: Decimal | None
    accuracy: Decimal | None
    status_breakdown: StatusBreakdownOut


class HygieneInlineOut(BaseModel):
    unassigned: int
    missing_sp: int
    missing_epic: int


class SprintRollupOut(BaseModel):
    sprint_id: int
    sprint_name: str
    state: str
    committed_sp: Decimal
    completed_sp: Decimal
    velocity_sp_per_day: Decimal | None
    projected_sp: Decimal | None
    days_total: int
    days_elapsed: int
    days_remaining: int
    hygiene: HygieneInlineOut
    per_person: list[PersonRollupOut]


@router.get("/{sprint_id}/rollup", response_model=SprintRollupOut)
async def get_sprint_rollup(
    sprint_id: int, session: AsyncSession = Depends(get_session)
) -> SprintRollupOut:
    settings = get_settings()
    rollup = await sprint_rollup(session, sprint_id=sprint_id, region=settings.team_region)
    if rollup is None:
        raise HTTPException(
            404, detail={"error": "not_found", "message": "sprint not found"}
        )
    return SprintRollupOut(
        sprint_id=rollup.sprint_id,
        sprint_name=rollup.sprint_name,
        state=rollup.state,
        committed_sp=rollup.committed_sp,
        completed_sp=rollup.completed_sp,
        velocity_sp_per_day=rollup.velocity_sp_per_day,
        projected_sp=rollup.projected_sp,
        days_total=rollup.days_total,
        days_elapsed=rollup.days_elapsed,
        days_remaining=rollup.days_remaining,
        hygiene=HygieneInlineOut(
            unassigned=rollup.hygiene.unassigned,
            missing_sp=rollup.hygiene.missing_sp,
            missing_epic=rollup.hygiene.missing_epic,
        ),
        per_person=[
            PersonRollupOut(
                person_account_id=p.person_account_id,
                person_display_name=p.person_display_name,
                committed_sp=p.committed_sp,
                completed_sp=p.completed_sp,
                available_days=p.available_days,
                velocity=p.velocity,
                accuracy=p.accuracy,
                status_breakdown=StatusBreakdownOut(
                    todo_sp=p.status_breakdown.todo_sp,
                    in_progress_sp=p.status_breakdown.in_progress_sp,
                    review_sp=p.status_breakdown.review_sp,
                    validation_sp=p.status_breakdown.validation_sp,
                    done_sp=p.status_breakdown.done_sp,
                ),
            )
            for p in rollup.per_person
        ],
    )


# ---- Single sprint detail ---------------------------------------------------

@router.get("/{sprint_id}", response_model=SprintOut)
async def get_sprint(
    sprint_id: int, session: AsyncSession = Depends(get_session)
) -> SprintOut:
    row = (
        await session.execute(select(Sprint).where(Sprint.sprint_id == sprint_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, detail={"error": "not_found", "message": "sprint not found"})
    return _to_out(row)
