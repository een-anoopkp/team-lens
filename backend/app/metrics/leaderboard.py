"""Leaderboard — per-person Jira contributions in a chosen window.

Three scope dimensions:
  - sprint  : strict-completed (resolution_date ∈ [sprint.start, sprint.complete])
  - quarter : resolution_date ∈ [quarter.start, quarter.end]
  - project : every issue under any `proj_<name>` epic, status_category=done
              (no date filter — project's full history)

In every scope we count Sub-tasks too — they reflect real work done — but
sum SP only from non-Sub-tasks since Sub-tasks have no SP on this tenant.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Epic, Issue, IssueSprint, Person, Sprint
from app.sync.projects import extract_project_labels


Scope = Literal["sprint", "quarter", "project"]


@dataclass(slots=True)
class LeaderRow:
    person_account_id: str
    person_display_name: str | None
    tickets_closed: int
    sp_delivered: Decimal
    avg_sp_per_ticket: Decimal | None  # None when tickets_closed = 0


@dataclass(slots=True)
class LeaderboardResult:
    scope: Scope
    scope_label: str  # "Search 2026-08", "2026-Q2", "evs1"
    window_start: date | None
    window_end: date | None
    total_tickets: int
    total_sp: Decimal
    rows: list[LeaderRow]


# ---------- Quarter helpers --------------------------------------------------


def quarter_bounds(year: int, q: int) -> tuple[date, date]:
    """Return (start_date, last_day_inclusive) for Q1..Q4 of `year`."""
    if q < 1 or q > 4:
        raise ValueError("quarter must be 1..4")
    starts = {1: (1, 1), 2: (4, 1), 3: (7, 1), 4: (10, 1)}
    ends = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}
    sm, sd = starts[q]
    em, ed = ends[q]
    return date(year, sm, sd), date(year, em, ed)


def parse_quarter(label: str) -> tuple[int, int]:
    """`'2026-Q2'` → `(2026, 2)`. Raises ValueError on bad input."""
    label = label.strip().upper()
    if "-Q" not in label:
        raise ValueError("expected YYYY-QN")
    y, q = label.split("-Q", 1)
    return int(y), int(q)


# ---------- Aggregation core -------------------------------------------------


def _aggregate(issues: list[Issue]) -> list[LeaderRow]:
    """Group already-filtered done issues by assignee."""
    by_pid: dict[str, dict] = defaultdict(
        lambda: {"tickets": 0, "sp": Decimal("0")}
    )
    for i in issues:
        if not i.assignee_id:
            continue
        b = by_pid[i.assignee_id]
        b["tickets"] += 1
        if i.issue_type != "Sub-task" and i.story_points is not None:
            b["sp"] += Decimal(str(i.story_points))

    rows: list[LeaderRow] = []
    for pid, agg in by_pid.items():
        tickets = int(agg["tickets"])
        sp = agg["sp"]
        avg = (sp / Decimal(tickets)).quantize(Decimal("0.1")) if tickets else None
        rows.append(
            LeaderRow(
                person_account_id=pid,
                person_display_name=None,  # filled in later
                tickets_closed=tickets,
                sp_delivered=sp,
                avg_sp_per_ticket=avg,
            )
        )
    return rows


async def _attach_names(
    session: AsyncSession, rows: list[LeaderRow]
) -> list[LeaderRow]:
    if not rows:
        return rows
    ids = [r.person_account_id for r in rows]
    name_by_id = {
        r.account_id: r.display_name
        for r in (
            await session.execute(
                select(Person).where(Person.account_id.in_(ids))
            )
        ).scalars().all()
    }
    for r in rows:
        r.person_display_name = name_by_id.get(r.person_account_id)
    return rows


def _sort_and_total(
    rows: list[LeaderRow],
) -> tuple[list[LeaderRow], int, Decimal]:
    rows.sort(
        key=lambda r: (-r.sp_delivered, -r.tickets_closed, r.person_display_name or "")
    )
    return rows, sum(r.tickets_closed for r in rows), sum(
        (r.sp_delivered for r in rows), Decimal("0")
    )


# ---------- Scope: sprint ----------------------------------------------------


async def leaderboard_for_sprint(
    session: AsyncSession, sprint_id: int
) -> LeaderboardResult:
    sprint = (
        await session.execute(select(Sprint).where(Sprint.sprint_id == sprint_id))
    ).scalar_one_or_none()
    if sprint is None:
        raise ValueError(f"sprint_id={sprint_id} not found")

    window_close = sprint.complete_date or sprint.end_date

    issues = (
        await session.execute(
            select(Issue)
            .join(IssueSprint, IssueSprint.issue_key == Issue.issue_key)
            .where(
                IssueSprint.sprint_id == sprint_id,
                Issue.removed_at.is_(None),
                Issue.status_category == "done",
                Issue.resolution_date.is_not(None),
                Issue.resolution_date >= sprint.start_date,
                Issue.resolution_date <= window_close,
            )
        )
    ).scalars().all()

    rows = await _attach_names(session, _aggregate(list(issues)))
    rows, total_tickets, total_sp = _sort_and_total(rows)
    return LeaderboardResult(
        scope="sprint",
        scope_label=sprint.name,
        window_start=sprint.start_date.date() if sprint.start_date else None,
        window_end=window_close.date() if window_close else None,
        total_tickets=total_tickets,
        total_sp=total_sp,
        rows=rows,
    )


# ---------- Scope: quarter ---------------------------------------------------


async def leaderboard_for_quarter(
    session: AsyncSession, year: int, q: int
) -> LeaderboardResult:
    start, end = quarter_bounds(year, q)
    end_inclusive_dt = datetime.combine(end, datetime.max.time())
    issues = (
        await session.execute(
            select(Issue).where(
                Issue.removed_at.is_(None),
                Issue.status_category == "done",
                Issue.resolution_date.is_not(None),
                Issue.resolution_date >= start,
                Issue.resolution_date <= end_inclusive_dt,
            )
        )
    ).scalars().all()

    rows = await _attach_names(session, _aggregate(list(issues)))
    rows, total_tickets, total_sp = _sort_and_total(rows)
    return LeaderboardResult(
        scope="quarter",
        scope_label=f"{year}-Q{q}",
        window_start=start,
        window_end=end,
        total_tickets=total_tickets,
        total_sp=total_sp,
        rows=rows,
    )


# ---------- Scope: project ---------------------------------------------------


async def leaderboard_for_project(
    session: AsyncSession, project_name: str
) -> LeaderboardResult:
    epics = (
        await session.execute(select(Epic).where(Epic.raw_payload.is_not(None)))
    ).scalars().all()
    epic_keys = [
        e.issue_key
        for e in epics
        if project_name in extract_project_labels(e.raw_payload)
    ]
    if not epic_keys:
        raise ValueError(f"no epics labelled proj_{project_name}")

    issues = (
        await session.execute(
            select(Issue).where(
                Issue.epic_key.in_(epic_keys),
                Issue.removed_at.is_(None),
                Issue.status_category == "done",
            )
        )
    ).scalars().all()

    rows = await _attach_names(session, _aggregate(list(issues)))
    rows, total_tickets, total_sp = _sort_and_total(rows)
    return LeaderboardResult(
        scope="project",
        scope_label=project_name,
        window_start=None,
        window_end=None,
        total_tickets=total_tickets,
        total_sp=total_sp,
        rows=rows,
    )


# ---------- Available quarters helper ---------------------------------------


async def available_quarters(session: AsyncSession) -> list[str]:
    """Return distinct YYYY-QN labels covering the resolution-date span."""
    rows = (
        await session.execute(
            select(Issue.resolution_date).where(
                Issue.resolution_date.is_not(None),
                Issue.removed_at.is_(None),
                Issue.status_category == "done",
            )
        )
    ).all()
    seen: set[tuple[int, int]] = set()
    for (rd,) in rows:
        if rd is None:
            continue
        q = (rd.month - 1) // 3 + 1
        seen.add((rd.year, q))
    return [f"{y}-Q{q}" for (y, q) in sorted(seen, reverse=True)]
