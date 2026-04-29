"""Leaves CRUD + upcoming view.

Phase 1: backend-only API. UI lands in Phase 2 (designed) / Phase 3 (wired).
The /upcoming endpoint computes overlap counts (people away in same window).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Leave, Person

router = APIRouter(prefix="/api/v1/leaves", tags=["leaves"])


class LeaveBase(BaseModel):
    person_account_id: str = Field(min_length=1)
    start_date: date
    end_date: date
    reason: str | None = None

    @model_validator(mode="after")
    def _check_dates(self) -> "LeaveBase":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class LeaveOut(LeaveBase):
    id: int
    person_display_name: str | None = None
    created_at: datetime


class LeavePatch(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    reason: str | None = None


class UpcomingPersonWindow(BaseModel):
    person_account_id: str
    person_display_name: str | None
    leaves: list[LeaveOut]
    total_days_in_window: int


class UpcomingResponse(BaseModel):
    window_start: date
    window_end: date
    people: list[UpcomingPersonWindow]
    overlap_alerts: list[dict[str, Any]]


# ---- helpers ---------------------------------------------------------------

async def _enrich_with_display_name(
    session: AsyncSession, leaves: list[Leave]
) -> list[LeaveOut]:
    if not leaves:
        return []
    ids = {l.person_account_id for l in leaves}
    rows = (
        await session.execute(select(Person).where(Person.account_id.in_(ids)))
    ).scalars().all()
    by_id = {r.account_id: r.display_name for r in rows}
    out: list[LeaveOut] = []
    for l in leaves:
        out.append(
            LeaveOut(
                id=l.id,
                person_account_id=l.person_account_id,
                person_display_name=by_id.get(l.person_account_id),
                start_date=l.start_date,
                end_date=l.end_date,
                reason=l.reason,
                created_at=l.created_at,
            )
        )
    return out


# ---- endpoints -------------------------------------------------------------

@router.get("", response_model=list[LeaveOut])
async def list_leaves(
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    person: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LeaveOut]:
    stmt = select(Leave)
    if person:
        stmt = stmt.where(Leave.person_account_id == person)
    if from_date is not None:
        stmt = stmt.where(Leave.end_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Leave.start_date <= to_date)
    stmt = stmt.order_by(Leave.start_date.asc())
    rows = (await session.execute(stmt)).scalars().all()
    return await _enrich_with_display_name(session, rows)


@router.get("/upcoming", response_model=UpcomingResponse)
async def upcoming_leaves(
    weeks: int = Query(6, ge=1, le=26),
    session: AsyncSession = Depends(get_session),
) -> UpcomingResponse:
    today = date.today()
    end = today + timedelta(weeks=weeks)
    rows = (
        await session.execute(
            select(Leave)
            .where(and_(Leave.end_date >= today, Leave.start_date <= end))
            .order_by(Leave.start_date.asc())
        )
    ).scalars().all()
    enriched = await _enrich_with_display_name(session, rows)

    # Group by person
    by_person: dict[str, list[LeaveOut]] = defaultdict(list)
    for l in enriched:
        by_person[l.person_account_id].append(l)

    people: list[UpcomingPersonWindow] = []
    for account_id, leaves in by_person.items():
        total_days = sum(
            max(
                0,
                (min(l.end_date, end) - max(l.start_date, today)).days + 1,
            )
            for l in leaves
        )
        people.append(
            UpcomingPersonWindow(
                person_account_id=account_id,
                person_display_name=leaves[0].person_display_name,
                leaves=leaves,
                total_days_in_window=total_days,
            )
        )
    people.sort(key=lambda p: -p.total_days_in_window)

    # Overlap alerts: any week with ≥2 distinct people on leave
    overlap_alerts: list[dict[str, Any]] = []
    week_counts: dict[date, set[str]] = defaultdict(set)
    cursor = today
    while cursor <= end:
        week_start = cursor - timedelta(days=cursor.weekday())  # Monday of cursor's week
        for l in enriched:
            if l.start_date <= cursor <= l.end_date:
                week_counts[week_start].add(l.person_account_id)
        cursor += timedelta(days=1)
    for ws, people_set in sorted(week_counts.items()):
        if len(people_set) >= 2:
            overlap_alerts.append(
                {
                    "week_start": ws.isoformat(),
                    "people_count": len(people_set),
                    "people": sorted(people_set),
                }
            )

    return UpcomingResponse(
        window_start=today,
        window_end=end,
        people=people,
        overlap_alerts=overlap_alerts,
    )


@router.post("", response_model=LeaveOut, status_code=status.HTTP_201_CREATED)
async def create_leave(
    payload: LeaveBase, session: AsyncSession = Depends(get_session)
) -> LeaveOut:
    # FK requires the person exists; if not, surface a clean 400.
    person = (
        await session.execute(
            select(Person).where(Person.account_id == payload.person_account_id)
        )
    ).scalar_one_or_none()
    if person is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unknown_person",
                "message": (
                    f"No person found with accountId={payload.person_account_id}. "
                    "Sync first, or pass the accountId of a synced team member."
                ),
            },
        )

    leave = Leave(
        person_account_id=payload.person_account_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        reason=payload.reason,
    )
    session.add(leave)
    await session.commit()
    await session.refresh(leave)
    return LeaveOut(
        id=leave.id,
        person_account_id=leave.person_account_id,
        person_display_name=person.display_name,
        start_date=leave.start_date,
        end_date=leave.end_date,
        reason=leave.reason,
        created_at=leave.created_at,
    )


@router.patch("/{leave_id}", response_model=LeaveOut)
async def update_leave(
    leave_id: int,
    payload: LeavePatch,
    session: AsyncSession = Depends(get_session),
) -> LeaveOut:
    leave = (
        await session.execute(select(Leave).where(Leave.id == leave_id))
    ).scalar_one_or_none()
    if leave is None:
        raise HTTPException(
            status_code=404, detail={"error": "not_found", "message": "leave id not found"}
        )

    new_start = payload.start_date if payload.start_date is not None else leave.start_date
    new_end = payload.end_date if payload.end_date is not None else leave.end_date
    if new_end < new_start:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_error", "message": "end_date < start_date"},
        )

    await session.execute(
        update(Leave)
        .where(Leave.id == leave_id)
        .values(
            start_date=new_start,
            end_date=new_end,
            reason=payload.reason if payload.reason is not None else leave.reason,
        )
    )
    await session.commit()

    leave = (
        await session.execute(select(Leave).where(Leave.id == leave_id))
    ).scalar_one()
    enriched = await _enrich_with_display_name(session, [leave])
    return enriched[0]


@router.delete("/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_leave(
    leave_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    result = await session.execute(delete(Leave).where(Leave.id == leave_id))
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404, detail={"error": "not_found", "message": "leave id not found"}
        )
    await session.commit()
