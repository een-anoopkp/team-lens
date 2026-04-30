"""Sprint sync — board pull and upsert.

`sync_board_sprints` is invoked once per run from `SyncRunner._execute`.
`upsert_sprints` is also reused by issue sync to absorb sprints embedded
in issue payloads (the customfield_10020 array).
"""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.jira.client import JiraClient, JiraClientError
from app.models import Sprint
from app.sync import transform
from app.sync.context import SyncContext

logger = structlog.get_logger(__name__)


async def sync_board_sprints(ctx: SyncContext, jira: JiraClient) -> None:
    prefix = ctx.settings.jira_sprint_name_prefix
    board_id = ctx.settings.jira_board_id
    all_sprints: list[dict] = []

    for state in ("active", "closed", "future"):
        try:
            async for sp in await jira.list_board_sprints(board_id, state=state):
                all_sprints.append(sp)
        except JiraClientError as e:
            logger.warning("sprint_state_fetch_failed", state=state, err=str(e))

    rows = [
        transform.sprint_from_jira(sp)
        for sp in all_sprints
        if (sp.get("name") or "").startswith(prefix)
    ]
    if not rows:
        return
    await upsert_sprints(ctx, rows)


async def upsert_sprints(ctx: SyncContext, rows: list[dict]) -> None:
    async with ctx.session_factory() as session:
        stmt = pg_insert(Sprint).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Sprint.sprint_id],
            set_={
                "name": stmt.excluded.name,
                "state": stmt.excluded.state,
                "start_date": stmt.excluded.start_date,
                "end_date": stmt.excluded.end_date,
                "complete_date": stmt.excluded.complete_date,
                "board_id": stmt.excluded.board_id,
                "raw_payload": stmt.excluded.raw_payload,
                "synced_at": datetime.now(tz=UTC),
            },
        )
        await session.execute(stmt)
        await session.commit()
