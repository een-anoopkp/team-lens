"""Comment sync — concurrent fetch + bulk upsert.

Comments are pulled per touched issue, capped by a semaphore to keep the
concurrent Jira request count bounded. Authors are funneled through
`people.upsert_people_rows` so the comments.author_id FK always
resolves, even when the author is not an issue assignee/reporter.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.jira.client import JiraClient, JiraClientError
from app.models import Comment
from app.sync import people, transform
from app.sync.context import SyncContext

logger = structlog.get_logger(__name__)

_COMMENT_FETCH_CONCURRENCY = 8

# asyncpg has a hard cap of 32767 bind parameters per query. With
# ~10 cols per comment, a single batch maxes around ~3000 rows.
# Chunk to stay well below the cap; 1000 rows ≈ 10000 params.
_CHUNK = 1000


async def sync_comments_for(
    ctx: SyncContext, jira: JiraClient, issue_keys: set[str]
) -> None:
    sem = asyncio.Semaphore(_COMMENT_FETCH_CONCURRENCY)

    async def fetch_one(key: str) -> tuple[str, list[dict]]:
        async with sem:
            items: list[dict] = []
            try:
                async for c in await jira.list_issue_comments(key):
                    items.append(c)
            except JiraClientError as e:
                logger.warning("comment_fetch_failed", issue=key, err=str(e))
            return key, items

    results = await asyncio.gather(*(fetch_one(k) for k in issue_keys))

    seen_comments: dict[str, dict] = {}
    seen_authors: dict[str, dict] = {}
    for key, items in results:
        for c in items:
            row = transform.comment_from_jira(c, key)
            seen_comments[row["comment_id"]] = row  # dedupe by PK
            author = c.get("author") or {}
            p = transform.person_from_user(author)
            if p:
                seen_authors[p["account_id"]] = p
    rows = list(seen_comments.values())

    # Comment authors may not be team-issue assignees/reporters; upsert
    # directly via the ORM-row entry-point so the FK on comments.author_id
    # always finds a row.
    if seen_authors:
        await people.upsert_people_rows(ctx, list(seen_authors.values()))

    if not rows:
        return
    now = datetime.now(tz=UTC)
    async with ctx.session_factory() as session:
        for i in range(0, len(rows), _CHUNK):
            chunk = [{**r, "last_seen_at": now} for r in rows[i : i + _CHUNK]]
            stmt = pg_insert(Comment).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Comment.comment_id],
                set_={
                    "issue_key": stmt.excluded.issue_key,
                    "author_id": stmt.excluded.author_id,
                    "body_text": stmt.excluded.body_text,
                    "body_adf": stmt.excluded.body_adf,
                    "created_at": stmt.excluded.created_at,
                    "updated_at": stmt.excluded.updated_at,
                    "last_seen_at": stmt.excluded.last_seen_at,
                    "removed_at": None,
                },
            )
            await session.execute(stmt)
        await session.commit()
