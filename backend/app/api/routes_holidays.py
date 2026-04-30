"""Holidays read API — populated out-of-band by `scripts/seed_holidays.py`.

Holidays are intentionally not editable via HTTP: the team's source of
truth is `infra/holidays/<region>.yaml`. Edit that file and re-run
`uv run python -m scripts.seed_holidays` to update — keeps a single
source instead of letting UI edits and YAML drift apart.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Holiday

router = APIRouter(prefix="/api/v1/holidays", tags=["holidays"])


class HolidayOut(BaseModel):
    holiday_date: date
    region: str = Field(default="IN", min_length=1, max_length=8)
    name: str = Field(min_length=1, max_length=200)
    created_at: datetime


@router.get("", response_model=list[HolidayOut])
async def list_holidays(
    region: str | None = Query(None),
    year: int | None = Query(None, ge=2000, le=2100),
    session: AsyncSession = Depends(get_session),
) -> list[HolidayOut]:
    stmt = select(Holiday)
    if region:
        stmt = stmt.where(Holiday.region == region)
    if year is not None:
        stmt = stmt.where(
            Holiday.holiday_date >= date(year, 1, 1),
            Holiday.holiday_date < date(year + 1, 1, 1),
        )
    stmt = stmt.order_by(Holiday.holiday_date.asc())
    rows = (await session.execute(stmt)).scalars().all()
    return [
        HolidayOut(
            holiday_date=r.holiday_date,
            region=r.region,
            name=r.name,
            created_at=r.created_at,
        )
        for r in rows
    ]


