"""Burnup data — cumulative completed SP per day across a sprint window.

Returns a flat list of (date, cumulative_done_sp) pairs covering every
calendar day from sprint.start_date to whichever is earlier:
sprint.complete_date / sprint.end_date / today.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class BurnupPoint:
    day: date
    cumulative_done_sp: Decimal
    cumulative_committed_sp: Decimal


async def burnup_for_sprint(
    session: AsyncSession, *, sprint_id: int
) -> dict:
    """Return {sprint, points: [BurnupPoint], target_sp}.

    target_sp = total committed SP for the sprint (sum of
    `ticket_state_snapshots.first_sp` excluding sub-tasks).
    """
    sprint = (
        await session.execute(
            text("SELECT * FROM sprints WHERE sprint_id = :id"),
            {"id": sprint_id},
        )
    ).one_or_none()
    if sprint is None:
        return {"sprint": None, "points": [], "target_sp": 0}

    # Determine the window of days to plot.
    start = sprint.start_date.date() if sprint.start_date else None
    if start is None:
        return {"sprint": dict(sprint._mapping), "points": [], "target_sp": 0}
    today = datetime.now(tz=timezone.utc).date()
    if sprint.complete_date:
        end = sprint.complete_date.date()
    elif sprint.end_date:
        end = min(sprint.end_date.date(), today)
    else:
        end = today

    # Total committed (target) across all in-sprint tickets — excludes Sub-tasks.
    target = Decimal(
        (
            await session.execute(
                text(
                    """
                    SELECT COALESCE(SUM(t.first_sp), 0)::numeric
                    FROM ticket_state_snapshots t
                    JOIN issues i ON i.issue_key = t.issue_key
                    WHERE t.sprint_name = :sn
                      AND i.removed_at IS NULL
                      AND i.issue_type <> 'Sub-task'
                    """
                ),
                {"sn": sprint.name},
            )
        ).scalar_one()
        or 0
    )

    # Per-day cumulative done — count an issue on the day its resolution_date falls,
    # excluding sub-tasks, and only when status_category is 'done'.
    rows = (
        await session.execute(
            text(
                """
                SELECT
                  date_trunc('day', i.resolution_date)::date AS day,
                  COALESCE(SUM(i.story_points), 0)::numeric AS done_sp
                FROM issues i
                JOIN issue_sprints isp ON isp.issue_key = i.issue_key
                WHERE isp.sprint_id = :sid
                  AND i.removed_at IS NULL
                  AND i.issue_type <> 'Sub-task'
                  AND i.status_category = 'done'
                  AND i.resolution_date IS NOT NULL
                  AND i.resolution_date::date >= :start
                  AND i.resolution_date::date <= :end
                GROUP BY 1
                ORDER BY 1
                """
            ),
            {"sid": sprint_id, "start": start, "end": end},
        )
    ).all()
    by_day = {r.day: Decimal(r.done_sp) for r in rows}

    points: list[BurnupPoint] = []
    cur = start
    cum = Decimal("0")
    while cur <= end:
        cum += by_day.get(cur, Decimal("0"))
        points.append(
            BurnupPoint(day=cur, cumulative_done_sp=cum, cumulative_committed_sp=target)
        )
        cur += timedelta(days=1)

    return {"sprint_id": sprint_id, "sprint_name": sprint.name, "points": points, "target_sp": target}
