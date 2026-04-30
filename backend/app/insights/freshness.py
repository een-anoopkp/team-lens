"""Freshness checks for LLM rules — used by /insights to decide whether
a cached output is good enough to render or should trigger a re-run."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.insights.registry import STALE_WHEN_SPRINT_CLOSES, Rule
from app.models import InsightRun, Sprint


async def latest_ok_run(
    session: AsyncSession, rule_id: str
) -> InsightRun | None:
    return (
        await session.execute(
            select(InsightRun)
            .where(InsightRun.rule_id == rule_id, InsightRun.status == "ok")
            .order_by(desc(InsightRun.started_at))
            .limit(1)
        )
    ).scalar_one_or_none()


async def is_stale(
    session: AsyncSession, rule: Rule, latest: InsightRun | None
) -> bool:
    """Decide whether a re-run should be triggered for this rule.

    Returns True when:
      - no successful run exists yet, OR
      - the rule's stale_seconds window has elapsed (sentinel
        STALE_WHEN_SPRINT_CLOSES means: stale if the most-recent-closed
        sprint is newer than the run's recorded scope.sprint_id), OR
      - rule.prompt_version > the run's prompt_version (prompt changed
        since the cached output was generated).
    """
    if latest is None:
        return True
    if rule.prompt_version is not None and latest.prompt_version is not None:
        if rule.prompt_version > latest.prompt_version:
            return True
    if rule.stale_seconds is None:
        return False

    if rule.stale_seconds == STALE_WHEN_SPRINT_CLOSES:
        # Sprint-event-triggered: stale if a newer closed sprint exists
        # than the one this run was scoped to.
        recorded_sprint_id = (latest.scope or {}).get("sprint_id")
        latest_closed = (
            await session.execute(
                select(Sprint.sprint_id)
                .where(Sprint.state == "closed")
                .order_by(desc(Sprint.start_date))
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest_closed is None:
            return False
        return recorded_sprint_id != latest_closed

    # Plain seconds-based window.
    age = datetime.now(tz=UTC) - latest.started_at
    return age > timedelta(seconds=rule.stale_seconds)
