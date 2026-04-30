"""Holidays CRUD — used by the working-day computation."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Holiday

router = APIRouter(prefix="/api/v1/holidays", tags=["holidays"])


class HolidayPayload(BaseModel):
    holiday_date: date
    region: str = Field(default="IN", min_length=1, max_length=8)
    name: str = Field(min_length=1, max_length=200)


class HolidayOut(HolidayPayload):
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


@router.post("", response_model=HolidayOut, status_code=status.HTTP_201_CREATED)
async def upsert_holiday(
    payload: HolidayPayload, session: AsyncSession = Depends(get_session)
) -> HolidayOut:
    """Insert or update (idempotent on (holiday_date, region))."""
    stmt = pg_insert(Holiday).values(
        holiday_date=payload.holiday_date,
        region=payload.region,
        name=payload.name,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[Holiday.holiday_date, Holiday.region],
        set_={"name": stmt.excluded.name},
    )
    await session.execute(stmt)
    await session.commit()

    row = (
        await session.execute(
            select(Holiday).where(
                Holiday.holiday_date == payload.holiday_date,
                Holiday.region == payload.region,
            )
        )
    ).scalar_one()
    return HolidayOut(
        holiday_date=row.holiday_date,
        region=row.region,
        name=row.name,
        created_at=row.created_at,
    )


@router.delete("/{region}/{holiday_date}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holiday(
    region: str, holiday_date: date, session: AsyncSession = Depends(get_session)
) -> None:
    result = await session.execute(
        delete(Holiday).where(
            Holiday.holiday_date == holiday_date, Holiday.region == region
        )
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404, detail={"error": "not_found", "message": "holiday not found"}
        )
    await session.commit()
