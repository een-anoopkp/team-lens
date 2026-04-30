"""People listing — accountIds + display names + activity."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Person

router = APIRouter(prefix="/api/v1/people", tags=["people"])


class PersonOut(BaseModel):
    account_id: str
    display_name: str
    email: str | None
    active: bool
    first_seen_at: datetime
    last_seen_at: datetime


@router.get("", response_model=list[PersonOut])
async def list_people(
    active: bool | None = Query(None, description="filter by active flag"),
    session: AsyncSession = Depends(get_session),
) -> list[PersonOut]:
    stmt = select(Person)
    if active is not None:
        stmt = stmt.where(Person.active == active)
    stmt = stmt.order_by(Person.display_name.asc())
    rows = (await session.execute(stmt)).scalars().all()
    return [
        PersonOut(
            account_id=r.account_id,
            display_name=r.display_name,
            email=r.email,
            active=r.active,
            first_seen_at=r.first_seen_at,
            last_seen_at=r.last_seen_at,
        )
        for r in rows
    ]
