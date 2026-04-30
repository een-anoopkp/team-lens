"""Team-members whitelist CRUD.

User maintains the list explicitly via /settings; sync does not auto-mutate.
A small `seed-recent` helper bootstraps the list from anyone assigned to a
non-removed issue in the last N days — useful first-time, then the user
prunes anyone who isn't actually on Search team.

Routes (`/seed-recent` is defined BEFORE `/{account_id}` so the static
path wins):
  GET    /api/v1/team-members                — list (with display names)
  POST   /api/v1/team-members/seed-recent    — add active assignees
  POST   /api/v1/team-members/{account_id}   — add one (idempotent)
  DELETE /api/v1/team-members/{account_id}   — remove one
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Issue, Person, TeamMember

router = APIRouter(prefix="/api/v1/team-members", tags=["team-members"])


class TeamMemberOut(BaseModel):
    account_id: str
    display_name: str | None
    email: str | None
    counts_for_capacity: bool
    added_at: datetime


class TeamMemberPatch(BaseModel):
    counts_for_capacity: bool


class SeedResult(BaseModel):
    added: list[str]  # display names added
    kept: int  # rows already present that survived
    total: int


async def get_team_member_ids(session: AsyncSession) -> set[str]:
    """Used by metrics / list endpoints — set of whitelisted account_ids."""
    rows = (
        await session.execute(select(TeamMember.account_id))
    ).scalars().all()
    return set(rows)


async def get_capacity_member_ids(session: AsyncSession) -> set[str]:
    """Subset who count toward sprint capacity (excludes leads / embedded QA)."""
    rows = (
        await session.execute(
            select(TeamMember.account_id).where(
                TeamMember.counts_for_capacity.is_(True)
            )
        )
    ).scalars().all()
    return set(rows)


# ---- list ------------------------------------------------------------------


@router.get("", response_model=list[TeamMemberOut])
async def list_team_members(
    session: AsyncSession = Depends(get_session),
) -> list[TeamMemberOut]:
    rows = (
        await session.execute(
            select(TeamMember, Person)
            .outerjoin(Person, Person.account_id == TeamMember.account_id)
            .order_by(Person.display_name.asc().nulls_last())
        )
    ).all()
    return [
        TeamMemberOut(
            account_id=tm.account_id,
            display_name=p.display_name if p else None,
            email=p.email if p else None,
            counts_for_capacity=tm.counts_for_capacity,
            added_at=tm.added_at,
        )
        for tm, p in rows
    ]


# ---- seed-recent (must come before /{account_id}) --------------------------


@router.post("/seed-recent", response_model=SeedResult)
async def seed_recent(
    days: int = Query(60, ge=7, le=365),
    session: AsyncSession = Depends(get_session),
) -> SeedResult:
    """Seed/refresh whitelist with assignees of non-removed issues in the
    last `days` days. Idempotent — never removes existing members, only
    adds anyone newly active. Useful as a first-time bootstrap.
    """
    cutoff = datetime.now(tz=UTC) - timedelta(days=days)
    candidate_ids = {
        a
        for (a,) in (
            await session.execute(
                select(Issue.assignee_id)
                .where(
                    Issue.assignee_id.is_not(None),
                    Issue.removed_at.is_(None),
                    Issue.updated_at >= cutoff,
                )
                .distinct()
            )
        ).all()
        if a
    }
    existing = await get_team_member_ids(session)
    to_add = candidate_ids - existing
    added_names: list[str] = []
    if to_add:
        people = {
            p.account_id: p.display_name
            for p in (
                await session.execute(
                    select(Person).where(Person.account_id.in_(to_add))
                )
            ).scalars().all()
        }
        for pid in to_add:
            await session.execute(
                pg_insert(TeamMember)
                .values(account_id=pid)
                .on_conflict_do_nothing(index_elements=[TeamMember.account_id])
            )
            added_names.append(people.get(pid) or pid)
        await session.commit()
    return SeedResult(
        added=sorted(added_names),
        kept=len(existing),
        total=len(existing | to_add),
    )


# ---- add / remove ----------------------------------------------------------


@router.post(
    "/{account_id}",
    response_model=TeamMemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_team_member(
    account_id: str, session: AsyncSession = Depends(get_session)
) -> TeamMemberOut:
    person = (
        await session.execute(
            select(Person).where(Person.account_id == account_id)
        )
    ).scalar_one_or_none()
    if person is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unknown_person",
                "message": (
                    f"No person found with accountId={account_id}. Sync "
                    "first or pass the accountId of a known team member."
                ),
            },
        )
    stmt = pg_insert(TeamMember).values(account_id=account_id)
    stmt = stmt.on_conflict_do_nothing(index_elements=[TeamMember.account_id])
    await session.execute(stmt)
    await session.commit()
    row = (
        await session.execute(
            select(TeamMember).where(TeamMember.account_id == account_id)
        )
    ).scalar_one()
    return TeamMemberOut(
        account_id=row.account_id,
        display_name=person.display_name,
        email=person.email,
        counts_for_capacity=row.counts_for_capacity,
        added_at=row.added_at,
    )


@router.patch("/{account_id}", response_model=TeamMemberOut)
async def update_team_member(
    account_id: str,
    payload: TeamMemberPatch,
    session: AsyncSession = Depends(get_session),
) -> TeamMemberOut:
    """Toggle whether this member counts toward sprint capacity."""
    row = (
        await session.execute(
            select(TeamMember).where(TeamMember.account_id == account_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "not on the team"},
        )
    row.counts_for_capacity = bool(payload.counts_for_capacity)
    await session.commit()
    person = (
        await session.execute(
            select(Person).where(Person.account_id == account_id)
        )
    ).scalar_one_or_none()
    return TeamMemberOut(
        account_id=row.account_id,
        display_name=person.display_name if person else None,
        email=person.email if person else None,
        counts_for_capacity=row.counts_for_capacity,
        added_at=row.added_at,
    )


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    account_id: str, session: AsyncSession = Depends(get_session)
) -> None:
    result = await session.execute(
        delete(TeamMember).where(TeamMember.account_id == account_id)
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "not on the team"},
        )
    await session.commit()
