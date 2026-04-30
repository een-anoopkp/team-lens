"""Blockers panel: open Sub-tasks in the active sprint, aged by `updated_at`.

Bands (locked from 00-context-and-decisions.md):
- yellow: 3-7 days since last update
- red: >7 days since last update
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class Blocker:
    issue_key: str
    summary: str
    status: str
    assignee_display_name: str | None
    age_days: int
    band: str  # 'green' | 'yellow' | 'red'


async def blockers_for_sprint(
    session: AsyncSession, *, sprint_id: int, now: datetime | None = None
) -> list[Blocker]:
    """Open sub-tasks currently in the given sprint, sorted by age desc."""
    sql = """
    SELECT
      i.issue_key,
      i.summary,
      i.status,
      i.updated_at,
      i.assignee_id,
      p.display_name
    FROM issues i
    JOIN issue_sprints isp ON isp.issue_key = i.issue_key
    LEFT JOIN people p ON p.account_id = i.assignee_id
    WHERE isp.sprint_id = :sprint_id
      AND i.removed_at IS NULL
      AND i.issue_type = 'Sub-task'
      AND i.status_category <> 'done'
    ORDER BY i.updated_at ASC
    """
    rows = (await session.execute(text(sql), {"sprint_id": sprint_id})).all()
    n = now or datetime.now(tz=rows[0].updated_at.tzinfo) if rows else datetime.utcnow()
    out: list[Blocker] = []
    for r in rows:
        age = (n - r.updated_at).days
        if age < 3:
            band = "green"
        elif age <= 7:
            band = "yellow"
        else:
            band = "red"
        out.append(
            Blocker(
                issue_key=r.issue_key,
                summary=r.summary,
                status=r.status,
                assignee_display_name=r.display_name,
                age_days=age,
                band=band,
            )
        )
    return out
