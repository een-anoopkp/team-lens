"""Working-days computation — weekdays minus holidays minus a person's leaves.

Decided in Phase 1 (00-context-and-decisions.md "Working days per sprint"):
weekday count between sprint.start_date and sprint.end_date, minus rows in
`holidays` falling within that range for the team's region (default 'IN'),
optionally minus weekday days in `leaves` rows for that person overlapping
the range.

Floor at 1 to avoid div-by-zero in velocity.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def working_days(
    session: AsyncSession,
    *,
    start: date,
    end: date,
    region: str = "IN",
    person_account_id: str | None = None,
    floor_at: int = 1,
) -> int:
    """Count working weekdays in [start, end] minus holidays (and optionally a
    specific person's leaves).

    `floor_at` is the minimum value returned. The default of 1 protects
    velocity's div-by-zero denominator. For display use cases (e.g. the
    leaves page showing "this leave covered 3 working days"), pass 0 so a
    weekend-only or fully-on-holiday leave shows 0 instead of being lifted
    to 1.
    """
    if start > end:
        return max(floor_at, 0)

    # NB: SQLAlchemy's named-param parser treats `:foo::date` ambiguously.
    # CAST(... AS date) sidesteps that.
    sql = """
    SELECT GREATEST(:floor, COUNT(*)::int) AS days
    FROM generate_series(CAST(:start AS date), CAST(:end AS date), interval '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
      AND CAST(d AS date) NOT IN (
        SELECT holiday_date FROM holidays WHERE region = :region
      )
    """
    if person_account_id is not None:
        sql += """
          AND NOT EXISTS (
            SELECT 1 FROM leaves l
            WHERE l.person_account_id = :person
              AND CAST(d AS date) BETWEEN l.start_date AND l.end_date
          )
        """

    params: dict = {
        "start": start,
        "end": end,
        "region": region,
        "floor": floor_at,
    }
    if person_account_id is not None:
        params["person"] = person_account_id

    result = await session.execute(text(sql), params)
    return int(result.scalar_one())
