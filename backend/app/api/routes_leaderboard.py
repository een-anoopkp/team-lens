"""Leaderboard endpoint (Jira side).

GitHub-side metrics (PRs opened, reviewed, turnaround) are still v3 — the
frontend renders those as static placeholder tiles. This module only
serves Jira contributions.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.metrics.leaderboard import (
    available_quarters,
    leaderboard_for_project,
    leaderboard_for_quarter,
    leaderboard_for_sprint,
    parse_quarter,
)

router = APIRouter(prefix="/api/v1/leaderboard", tags=["leaderboard"])


class LeaderRowOut(BaseModel):
    person_account_id: str
    person_display_name: str | None
    tickets_closed: int
    sp_delivered: Decimal
    avg_sp_per_ticket: Decimal | None


class LeaderboardOut(BaseModel):
    scope: Literal["sprint", "quarter", "project"]
    scope_label: str
    window_start: date | None
    window_end: date | None
    total_tickets: int
    total_sp: Decimal
    rows: list[LeaderRowOut]


class QuartersOut(BaseModel):
    quarters: list[str]


@router.get("/quarters", response_model=QuartersOut)
async def list_quarters(
    session: AsyncSession = Depends(get_session),
) -> QuartersOut:
    return QuartersOut(quarters=await available_quarters(session))


@router.get("", response_model=LeaderboardOut)
async def leaderboard(
    scope: Literal["sprint", "quarter", "project"],
    sprint_id: int | None = Query(None),
    quarter: str | None = Query(None, description="YYYY-QN, e.g. 2026-Q2"),
    project: str | None = Query(None, description="project name (the bit after proj_)"),
    session: AsyncSession = Depends(get_session),
) -> LeaderboardOut:
    try:
        if scope == "sprint":
            if sprint_id is None:
                raise HTTPException(
                    400,
                    {"error": "validation_error", "message": "sprint_id required for scope=sprint"},
                )
            result = await leaderboard_for_sprint(session, sprint_id)
        elif scope == "quarter":
            if not quarter:
                raise HTTPException(
                    400,
                    {"error": "validation_error", "message": "quarter required for scope=quarter"},
                )
            year, q = parse_quarter(quarter)
            result = await leaderboard_for_quarter(session, year, q)
        elif scope == "project":
            if not project:
                raise HTTPException(
                    400,
                    {"error": "validation_error", "message": "project required for scope=project"},
                )
            result = await leaderboard_for_project(session, project)
        else:  # pragma: no cover — Literal narrows this
            raise HTTPException(400, {"error": "validation_error", "message": "bad scope"})
    except ValueError as e:
        raise HTTPException(404, {"error": "not_found", "message": str(e)}) from e

    return LeaderboardOut(
        scope=result.scope,
        scope_label=result.scope_label,
        window_start=result.window_start,
        window_end=result.window_end,
        total_tickets=result.total_tickets,
        total_sp=result.total_sp,
        rows=[
            LeaderRowOut(
                person_account_id=r.person_account_id,
                person_display_name=r.person_display_name,
                tickets_closed=r.tickets_closed,
                sp_delivered=r.sp_delivered,
                avg_sp_per_ticket=r.avg_sp_per_ticket,
            )
            for r in result.rows
        ],
    )
