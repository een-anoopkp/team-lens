"""People upsert — shared by issue and comment paths.

`upsert_people_for` extracts assignee/reporter/creator from a batch of
issue payloads. `upsert_people_rows` is the lower-level entry point used
when the dicts are already in ORM shape (e.g. comment authors collected
during comment sync, who may not appear as issue assignees/reporters).
Both paths must run before their respective FK-bearing rows are written.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import Person
from app.sync import transform
from app.sync.context import SyncContext


async def upsert_people_for(ctx: SyncContext, issues: Iterable[dict]) -> None:
    """Extract assignee/reporter/creator from each issue and upsert."""
    seen: dict[str, dict] = {}
    for issue in issues:
        for p in transform.collect_people_from_issue(issue):
            seen[p["account_id"]] = p
    await upsert_people_rows(ctx, list(seen.values()))


async def upsert_people_rows(ctx: SyncContext, rows: list[dict]) -> None:
    """Upsert pre-converted person dicts (ORM-shape: account_id, display_name, ...)."""
    if not rows:
        return
    async with ctx.session_factory() as session:
        stmt = pg_insert(Person).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Person.account_id],
            set_={
                "display_name": stmt.excluded.display_name,
                "email": stmt.excluded.email,
                "active": stmt.excluded.active,
                "last_seen_at": datetime.now(tz=UTC),
            },
        )
        await session.execute(stmt)
        await session.commit()
