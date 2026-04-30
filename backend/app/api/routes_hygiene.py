"""Hygiene endpoints — three lists for the /hygiene page."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.metrics.hygiene import by_due_date, epics_without_initiative, tasks_without_epic

router = APIRouter(prefix="/api/v1/hygiene", tags=["hygiene"])


class EpicNoInitiativeRow(BaseModel):
    issue_key: str
    summary: str
    status: str
    due_date: date | None
    sp_open: Decimal
    days_since_activity: int | None


@router.get("/epics-no-initiative", response_model=list[EpicNoInitiativeRow])
async def epics_no_initiative_endpoint(
    active_only: bool = Query(
        True,
        description=(
            "Default: only epics not done AND with a child issue in a sprint "
            "that started this year. Set false to see the full historical list."
        ),
    ),
    since_year: int | None = Query(
        None,
        ge=2010,
        le=2100,
        description="Year-of-activity cutoff (default: current year).",
    ),
    session: AsyncSession = Depends(get_session),
) -> list[EpicNoInitiativeRow]:
    rows = await epics_without_initiative(
        session, active_only=active_only, activity_since_year=since_year
    )
    return [
        EpicNoInitiativeRow(
            issue_key=r.issue_key,
            summary=r.summary,
            status=r.status,
            due_date=r.due_date,
            sp_open=r.sp_open,
            days_since_activity=r.days_since_activity,
        )
        for r in rows
    ]


class TaskNoEpicRow(BaseModel):
    issue_key: str
    summary: str
    issue_type: str
    status: str
    assignee_display_name: str | None
    updated_at: datetime


@router.get("/tasks-no-epic", response_model=list[TaskNoEpicRow])
async def tasks_no_epic_endpoint(
    limit: int = Query(200, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
) -> list[TaskNoEpicRow]:
    rows = await tasks_without_epic(session, limit=limit)
    return [
        TaskNoEpicRow(
            issue_key=r.issue_key,
            summary=r.summary,
            issue_type=r.issue_type,
            status=r.status,
            assignee_display_name=r.assignee_display_name,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


class TicketByDueRow(BaseModel):
    issue_key: str
    summary: str
    assignee_display_name: str | None
    due_date: date
    days_to_due: int
    band: str
    status: str
    status_category: str


@router.get("/by-due-date", response_model=list[TicketByDueRow])
async def by_due_date_endpoint(
    include_closed: bool = Query(False, description="include closed-late tickets for retro view"),
    limit: int = Query(200, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
) -> list[TicketByDueRow]:
    rows = await by_due_date(session, include_closed=include_closed, limit=limit)
    return [
        TicketByDueRow(
            issue_key=r.issue_key,
            summary=r.summary,
            assignee_display_name=r.assignee_display_name,
            due_date=r.due_date,
            days_to_due=r.days_to_due,
            band=r.band,
            status=r.status,
            status_category=r.status_category,
        )
        for r in rows
    ]
