"""Sprint listing + detail."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
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
