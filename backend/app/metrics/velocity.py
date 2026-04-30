"""Per-(person, sprint) velocity + accuracy + commitment.

Definitions (locked in 00-context-and-decisions.md):

- **Committed SP**: sum of `ticket_state_snapshots.first_sp` for every issue
  in the sprint, attributed to the assignee at completion (or last-known
  assignee if not yet done). Excludes Sub-tasks.
- **Completed SP** (strict): SUM(issues.story_points) WHERE
  status_category = 'done' AND resolution_date BETWEEN sprint.start_date
  AND COALESCE(complete_date, end_date), assigned to person, excluding
  Sub-tasks.
- **Available days**: working_days(sprint, region) − person's leaves
  overlapping sprint.
- **Velocity**: completed_sp / available_days. Floor at 0.
- **Commitment accuracy**: completed_sp / committed_sp. Surfaced as a
  percentage; null when committed = 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.metrics.working_days import working_days


@dataclass(slots=True)
class PersonSprintVelocity:
    sprint_id: int
    sprint_name: str
    person_account_id: str
    person_display_name: str | None
    committed_sp: Decimal
    completed_sp: Decimal
    available_days: int
    velocity: Decimal | None
    accuracy: Decimal | None  # 0..1


async def velocity_for_sprint_window(
    session: AsyncSession,
    *,
    sprint_window: int = 6,
    person_account_id: str | None = None,
    region: str = "IN",
) -> list[PersonSprintVelocity]:
    """Velocity per (person, sprint) for the last `sprint_window` closed sprints
    (most-recent-first), plus the active sprint if there is one."""
    # 1. Pick the sprints in scope: most recent active + last N closed.
    sprints_sql = """
    (
      SELECT sprint_id, name, start_date, end_date, complete_date, state
      FROM sprints WHERE state = 'active'
    )
    UNION ALL
    (
      SELECT sprint_id, name, start_date, end_date, complete_date, state
      FROM sprints
      WHERE state = 'closed' AND start_date IS NOT NULL
      ORDER BY start_date DESC
      LIMIT :n
    )
    ORDER BY start_date DESC NULLS LAST
    """
    sprint_rows = (
        await session.execute(text(sprints_sql), {"n": sprint_window})
    ).all()

    out: list[PersonSprintVelocity] = []
    for sp in sprint_rows:
        if sp.start_date is None:
            continue

        # 2. Per-person aggregates for this sprint.
        end_for_done = sp.complete_date or sp.end_date
        sql = """
        SELECT
          i.assignee_id AS account_id,
          p.display_name,
          COALESCE(SUM(t.first_sp) FILTER (WHERE t.first_sp IS NOT NULL), 0)::numeric AS committed_sp,
          COALESCE(SUM(i.story_points) FILTER (
            WHERE i.status_category = 'done'
              AND i.resolution_date IS NOT NULL
              AND i.resolution_date::date >= :start
              AND i.resolution_date::date <= :end
          ), 0)::numeric AS completed_sp
        FROM issues i
        JOIN issue_sprints isp ON isp.issue_key = i.issue_key
        LEFT JOIN ticket_state_snapshots t
          ON t.issue_key = i.issue_key AND t.sprint_name = :sprint_name
        LEFT JOIN people p ON p.account_id = i.assignee_id
        WHERE isp.sprint_id = :sprint_id
          AND i.removed_at IS NULL
          AND i.issue_type <> 'Sub-task'
          AND i.assignee_id IS NOT NULL
        """
        if person_account_id is not None:
            sql += " AND i.assignee_id = :person"
        sql += " GROUP BY i.assignee_id, p.display_name"

        params: dict = {
            "sprint_id": sp.sprint_id,
            "sprint_name": sp.name,
            "start": sp.start_date,
            "end": end_for_done,
        }
        if person_account_id is not None:
            params["person"] = person_account_id

        rows = (await session.execute(text(sql), params)).all()
        for r in rows:
            avail = await working_days(
                session,
                start=sp.start_date.date() if hasattr(sp.start_date, "date") else sp.start_date,
                end=(end_for_done.date() if hasattr(end_for_done, "date") else end_for_done),
                region=region,
                person_account_id=r.account_id,
            )
            committed = Decimal(r.committed_sp or 0)
            completed = Decimal(r.completed_sp or 0)
            velocity = completed / Decimal(avail) if avail > 0 else None
            accuracy = (
                completed / committed if committed > 0 else None
            )
            out.append(
                PersonSprintVelocity(
                    sprint_id=sp.sprint_id,
                    sprint_name=sp.name,
                    person_account_id=r.account_id,
                    person_display_name=r.display_name,
                    committed_sp=committed,
                    completed_sp=completed,
                    available_days=avail,
                    velocity=velocity,
                    accuracy=accuracy,
                )
            )
    return out
