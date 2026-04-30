"""Epics + Initiatives listing/detail."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Epic, Initiative, Issue

router = APIRouter(prefix="/api/v1", tags=["epics"])


class EpicOut(BaseModel):
    issue_key: str
    summary: str
    status: str
    status_category: str
    initiative_key: str | None
    owner_account_id: str | None
    due_date: date | None
    issue_count: int
    sp_total: Decimal | None
    sp_done: Decimal | None


class InitiativeOut(BaseModel):
    issue_key: str
    summary: str
    status: str
    status_category: str
    owner_account_id: str | None
    epic_count: int


@router.get("/epics", response_model=list[EpicOut])
async def list_epics(
    initiative_key: str | None = None,
    status_category: Literal["new", "indeterminate", "done"] | None = None,
    due_before: date | None = None,
    order_by: Literal["due_date", "issue_key"] = "due_date",
    limit: int = Query(100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[EpicOut]:
    sp_done_sum = func.sum(
        case(
            (Issue.status_category == "done", Issue.story_points),
            else_=0,
        )
    ).label("sp_done")
    stmt = (
        select(
            Epic,
            func.count(Issue.issue_key).label("issue_count"),
            func.sum(Issue.story_points).label("sp_total"),
            sp_done_sum,
        )
        .outerjoin(
            Issue,
            (Issue.epic_key == Epic.issue_key) & (Issue.removed_at.is_(None)),
        )
        .group_by(Epic.issue_key)
    )
    if initiative_key is not None:
        stmt = stmt.where(Epic.initiative_key == initiative_key)
    if status_category is not None:
        stmt = stmt.where(Epic.status_category == status_category)
    if due_before is not None:
        stmt = stmt.where(Epic.due_date <= due_before)
    if order_by == "due_date":
        stmt = stmt.order_by(Epic.due_date.asc().nullslast())
    else:
        stmt = stmt.order_by(Epic.issue_key.asc())
    stmt = stmt.limit(limit)

    rows = (await session.execute(stmt)).all()
    out: list[EpicOut] = []
    for epic, issue_count, sp_total, sp_done in rows:
        out.append(
            EpicOut(
                issue_key=epic.issue_key,
                summary=epic.summary,
                status=epic.status,
                status_category=epic.status_category,
                initiative_key=epic.initiative_key,
                owner_account_id=epic.owner_account_id,
                due_date=epic.due_date,
                issue_count=int(issue_count or 0),
                sp_total=sp_total,
                sp_done=sp_done,
            )
        )
    return out


@router.get("/epics/{issue_key}", response_model=EpicOut)
async def get_epic(
    issue_key: str, session: AsyncSession = Depends(get_session)
) -> EpicOut:
    row = (
        await session.execute(select(Epic).where(Epic.issue_key == issue_key))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, detail={"error": "not_found", "message": "epic not found"})

    counts = (
        await session.execute(
            select(
                func.count(Issue.issue_key),
                func.sum(Issue.story_points),
                func.sum(
                    case(
                        (Issue.status_category == "done", Issue.story_points),
                        else_=0,
                    )
                ),
            ).where(Issue.epic_key == issue_key, Issue.removed_at.is_(None))
        )
    ).one()
    issue_count, sp_total, sp_done = counts

    return EpicOut(
        issue_key=row.issue_key,
        summary=row.summary,
        status=row.status,
        status_category=row.status_category,
        initiative_key=row.initiative_key,
        owner_account_id=row.owner_account_id,
        due_date=row.due_date,
        issue_count=int(issue_count or 0),
        sp_total=sp_total,
        sp_done=sp_done,
    )


@router.get("/initiatives", response_model=list[InitiativeOut])
async def list_initiatives(
    session: AsyncSession = Depends(get_session),
) -> list[InitiativeOut]:
    rows = (
        await session.execute(
            select(
                Initiative,
                func.count(Epic.issue_key).label("epic_count"),
            )
            .outerjoin(Epic, Epic.initiative_key == Initiative.issue_key)
            .group_by(Initiative.issue_key)
            .order_by(Initiative.issue_key.asc())
        )
    ).all()
    return [
        InitiativeOut(
            issue_key=i.issue_key,
            summary=i.summary,
            status=i.status,
            status_category=i.status_category,
            owner_account_id=i.owner_account_id,
            epic_count=int(epic_count or 0),
        )
        for (i, epic_count) in rows
    ]
