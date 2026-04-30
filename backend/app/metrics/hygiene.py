"""Hygiene endpoints — three lists for the /hygiene page.

1. epics-no-initiative: Epics with NULL initiative_key, ordered by due_date asc.
2. tasks-no-epic: non-Sub-task issues with NULL epic_key, ordered by updated desc.
3. by-due-date: tickets sorted ascending by due_date, with past-due / due-soon
   pills based on bands (past = red, ≤7d yellow, 8-30d green, >30d grey).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Epic, Issue, Person


def _parse_iso(s: str | None) -> datetime | None:
    """Jira's `created` is e.g. '2025-08-21T11:23:00.000+0530'."""
    if not s:
        return None
    try:
        # Python <3.11 doesn't accept '+0530' (no colon); normalise.
        if len(s) > 5 and (s[-5] in "+-") and s[-3] != ":":
            s = s[:-2] + ":" + s[-2:]
        return datetime.fromisoformat(s)
    except ValueError:
        return None


@dataclass(slots=True)
class EpicNoInitiative:
    issue_key: str
    summary: str
    status: str
    due_date: date | None
    sp_open: Decimal
    days_since_activity: int | None


@dataclass(slots=True)
class EpicsNoInitiativeResult:
    """List of actionable epics + count of non-done epics with no due date.

    `epics` is the list to render; `no_due_date_count` is informational —
    epics without a due date are future/un-scheduled work that we don't track
    in the cleanup table but want a visible count of.
    """

    epics: list[EpicNoInitiative]
    no_due_date_count: int


@dataclass(slots=True)
class TaskNoEpic:
    issue_key: str
    summary: str
    issue_type: str
    status: str
    assignee_display_name: str | None
    created_at: datetime | None
    updated_at: datetime


@dataclass(slots=True)
class TicketByDue:
    issue_key: str
    summary: str
    assignee_display_name: str | None
    due_date: date
    days_to_due: int
    band: str  # red / yellow / green / grey
    status: str
    status_category: str


async def epics_without_initiative(
    session: AsyncSession,
    *,
    active_only: bool = True,
    activity_since_year: int | None = None,
) -> EpicsNoInitiativeResult:
    """Epics with no Initiative parent.

    With `active_only=True` (default) the result is restricted to actionable
    cleanup items: epics that are NOT already done AND have a `due_date` on
    or after Jan 1 of `activity_since_year` (defaults to the current year).

    Epics with `due_date IS NULL` are unscheduled future work — we don't
    list them, but we return the count via `no_due_date_count` so callers
    can surface it.

    Pass `active_only=False` for the full historical list (debug / retro);
    in that mode `no_due_date_count` is 0 (the rows are in `epics`).
    """
    from datetime import date as _date
    from sqlalchemy import func as _func

    if active_only:
        cutoff_year = activity_since_year or _date.today().year
        cutoff = _date(cutoff_year, 1, 1)
        rows = (
            await session.execute(
                select(Epic).where(
                    Epic.initiative_key.is_(None),
                    Epic.status_category != "done",
                    Epic.due_date.is_not(None),
                    Epic.due_date >= cutoff,
                )
            )
        ).scalars().all()
        no_due_date_count = (
            await session.execute(
                select(_func.count())
                .select_from(Epic)
                .where(
                    Epic.initiative_key.is_(None),
                    Epic.status_category != "done",
                    Epic.due_date.is_(None),
                )
            )
        ).scalar_one()
    else:
        rows = (
            await session.execute(
                select(Epic).where(Epic.initiative_key.is_(None))
            )
        ).scalars().all()
        no_due_date_count = 0

    out: list[EpicNoInitiative] = []
    for e in rows:
        # Sum open SP from children
        from sqlalchemy import func
        sub = await session.execute(
            select(
                func.coalesce(
                    func.sum(Issue.story_points).filter(
                        Issue.status_category != "done"
                    ),
                    0,
                ),
                func.max(Issue.updated_at),
            ).where(Issue.epic_key == e.issue_key, Issue.removed_at.is_(None))
        )
        sp_open, last_updated = sub.one()
        days_since = None
        if last_updated is not None:
            days_since = max(
                0, (datetime.now(tz=timezone.utc) - last_updated).days
            )
        out.append(
            EpicNoInitiative(
                issue_key=e.issue_key,
                summary=e.summary,
                status=e.status,
                due_date=e.due_date,
                sp_open=Decimal(sp_open or 0),
                days_since_activity=days_since,
            )
        )
    # Sort by due_date asc, nulls last
    out.sort(key=lambda r: (r.due_date is None, r.due_date or date.max))
    return EpicsNoInitiativeResult(epics=out, no_due_date_count=no_due_date_count)


async def tasks_without_epic(
    session: AsyncSession, *, limit: int = 200
) -> list[TaskNoEpic]:
    rows = (
        await session.execute(
            select(Issue, Person.display_name)
            .outerjoin(Person, Person.account_id == Issue.assignee_id)
            .where(
                and_(
                    Issue.epic_key.is_(None),
                    Issue.issue_type != "Sub-task",
                    Issue.issue_type != "Initiative",
                    Issue.issue_type != "Epic",
                    Issue.removed_at.is_(None),
                    # Exclude already-done; hygiene is only about open work
                    Issue.status_category != "done",
                )
            )
            .order_by(Issue.updated_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        TaskNoEpic(
            issue_key=i.issue_key,
            summary=i.summary,
            issue_type=i.issue_type,
            status=i.status,
            assignee_display_name=name,
            created_at=_parse_iso(
                ((i.raw_payload or {}).get("fields") or {}).get("created")
            ),
            updated_at=i.updated_at,
        )
        for i, name in rows
    ]


async def by_due_date(
    session: AsyncSession,
    *,
    include_closed: bool = False,
    limit: int = 200,
) -> list[TicketByDue]:
    today = datetime.now(tz=timezone.utc).date()
    stmt = (
        select(Issue, Person.display_name)
        .outerjoin(Person, Person.account_id == Issue.assignee_id)
        .where(
            and_(
                Issue.due_date.is_not(None),
                Issue.removed_at.is_(None),
                Issue.issue_type != "Sub-task",
            )
        )
        .order_by(asc(Issue.due_date))
        .limit(limit)
    )
    if not include_closed:
        stmt = stmt.where(Issue.status_category != "done")

    rows = (await session.execute(stmt)).all()
    out: list[TicketByDue] = []
    for i, name in rows:
        days = (i.due_date - today).days
        if days < 0:
            band = "red"
        elif days <= 7:
            band = "yellow"
        elif days <= 30:
            band = "green"
        else:
            band = "grey"
        out.append(
            TicketByDue(
                issue_key=i.issue_key,
                summary=i.summary,
                assignee_display_name=name,
                due_date=i.due_date,
                days_to_due=days,
                band=band,
                status=i.status,
                status_category=i.status_category,
            )
        )
    return out
