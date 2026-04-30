"""People listing — accountIds + display names + activity."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes_team_members import get_team_member_ids
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
    team_only: bool = Query(
        False,
        description=(
            "When true, restrict to current Search-team members "
            "(reads from the user-managed whitelist at /team-members)."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> list[PersonOut]:
    stmt = select(Person)
    if active is not None:
        stmt = stmt.where(Person.active == active)
    if team_only:
        ids = await get_team_member_ids(session)
        if not ids:
            return []
        stmt = stmt.where(Person.account_id.in_(ids))
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
