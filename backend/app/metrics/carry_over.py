"""Carry-over: tickets in the current sprint that were ALSO in earlier sprints
without being completed there.

Per the locked semantics: a carry-over ticket is one whose
`ticket_state_snapshots` shows it living in a prior sprint without ever
being closed in that sprint, and which is now in the current/active sprint.
The "depth" is how many sprints back the ticket has been bouncing through.

For the simple panel on Sprint Health we report:
- Issue key + summary
- Current assignee
- Depth (count of distinct prior sprints the issue carried through)
- SP (current)
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class CarryOver:
    issue_key: str
    summary: str
    assignee_display_name: str | None
    assignee_id: str | None
    depth: int
    story_points: Decimal | None


async def carry_over_for_sprint(
    session: AsyncSession, *, sprint_id: int
) -> list[CarryOver]:
    """Tickets currently in the given sprint that were previously in another
    sprint without completing."""
    sql = """
    WITH this_sprint AS (
      SELECT s.sprint_id, s.name, s.start_date
      FROM sprints s
      WHERE s.sprint_id = :sprint_id
    ),
    candidate_keys AS (
      SELECT i.issue_key
      FROM issues i
      JOIN issue_sprints isp ON isp.issue_key = i.issue_key
      JOIN this_sprint t ON t.sprint_id = isp.sprint_id
      WHERE i.removed_at IS NULL
        AND i.issue_type <> 'Sub-task'
    )
    SELECT
      i.issue_key,
      i.summary,
      i.story_points,
      i.assignee_id,
      p.display_name,
      COUNT(DISTINCT t2.sprint_name)::int AS depth
    FROM candidate_keys ck
    JOIN issues i ON i.issue_key = ck.issue_key
    LEFT JOIN people p ON p.account_id = i.assignee_id
    JOIN ticket_state_snapshots t2 ON t2.issue_key = i.issue_key
    JOIN sprints s2 ON s2.name = t2.sprint_name
    JOIN this_sprint t ON true
    WHERE s2.start_date < t.start_date
    GROUP BY i.issue_key, i.summary, i.story_points, i.assignee_id, p.display_name
    HAVING COUNT(DISTINCT t2.sprint_name) >= 1
    ORDER BY depth DESC, i.issue_key
    """
    rows = (await session.execute(text(sql), {"sprint_id": sprint_id})).all()
    return [
        CarryOver(
            issue_key=r.issue_key,
            summary=r.summary,
            assignee_id=r.assignee_id,
            assignee_display_name=r.display_name,
            depth=r.depth,
            story_points=r.story_points,
        )
        for r in rows
    ]
