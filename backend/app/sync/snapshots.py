"""Snapshot diff at sync time — Cases A / B / C from docs/local-app/03-sync-engine.md.

Invoked at the end of every sync run (after issue / comment upserts) by the
runner's hook. Walks every `(issue_key, sprint_name)` pair currently in scope
for the touched issues, compares against existing `ticket_state_snapshots`,
and emits `scope_change_events` for any change.

Decision matrix:
    First sighting + is_full_backfill                     → silent baseline (Case A)
    First sighting + sprint hasn't started yet            → silent baseline (Case B)
    First sighting + sprint already started (incremental) → counterfactual (Case C):
        first_sp = 0, was_added_mid_sprint = True,
        emit `change_type='added_mid_sprint'` event (sp_delta=+current_sp)
    Existing snapshot, SP changed                          → emit 'sp' event
    Existing snapshot, assignee changed                    → emit 'assignee' event
    Existing snapshot, status changed                      → emit 'status' event
    Otherwise                                              → just bump last_seen_at
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import and_, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    Issue,
    IssueSprint,
    ScopeChangeEvent,
    Sprint,
    TicketStateSnapshot,
)

if TYPE_CHECKING:
    from app.sync.stats import SyncStats

logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class _CurrentPair:
    issue_key: str
    sprint_id: int
    sprint_name: str
    sprint_start_date: datetime | None
    story_points: Decimal | None
    assignee_id: str | None
    status: str | None


def _normalise_decimal(value) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _equal_decimal(a, b) -> bool:
    da, db = _normalise_decimal(a), _normalise_decimal(b)
    if da is None and db is None:
        return True
    if da is None or db is None:
        return False
    return da == db


async def update_snapshots(
    session_factory: async_sessionmaker,
    *,
    touched_issue_keys: Iterable[str],
    is_full_backfill: bool,
    stats: "SyncStats",
) -> None:
    """Reconcile ticket_state_snapshots + scope_change_events for the touched set."""
    keys = list(touched_issue_keys)
    if not keys:
        return

    now = datetime.now(tz=UTC)

    async with session_factory() as session:
        # Pull every (issue, sprint) pair the touched issues are currently in,
        # joined with sprint metadata + issue's current SP/assignee/status.
        pairs_q = (
            select(
                Issue.issue_key,
                Sprint.sprint_id,
                Sprint.name.label("sprint_name"),
                Sprint.start_date.label("sprint_start_date"),
                Issue.story_points,
                Issue.assignee_id,
                Issue.status_category.label("status"),
            )
            .join(IssueSprint, IssueSprint.issue_key == Issue.issue_key)
            .join(Sprint, Sprint.sprint_id == IssueSprint.sprint_id)
            .where(Issue.issue_key.in_(keys))
        )
        rows = (await session.execute(pairs_q)).all()
        current_pairs = [
            _CurrentPair(
                issue_key=r.issue_key,
                sprint_id=r.sprint_id,
                sprint_name=r.sprint_name,
                sprint_start_date=r.sprint_start_date,
                story_points=r.story_points,
                assignee_id=r.assignee_id,
                status=r.status,
            )
            for r in rows
        ]
        if not current_pairs:
            return

        # Look up existing snapshots for the same (issue_key, sprint_name) set
        # in one query.
        snap_q = select(TicketStateSnapshot).where(
            and_(
                TicketStateSnapshot.issue_key.in_({p.issue_key for p in current_pairs}),
                TicketStateSnapshot.sprint_name.in_({p.sprint_name for p in current_pairs}),
            )
        )
        existing_rows = (await session.execute(snap_q)).scalars().all()
        existing: dict[tuple[str, str], TicketStateSnapshot] = {
            (s.issue_key, s.sprint_name): s for s in existing_rows
        }

        # Has the issue itself been seen in ANY sprint before this sync?
        # If not, treating this sync as a "first observation" is correct
        # regardless of is_full_backfill — we have no evidence the issue
        # was added mid-sprint vs. simply first seen now.
        any_prior_q = (
            select(TicketStateSnapshot.issue_key)
            .where(TicketStateSnapshot.issue_key.in_(
                {p.issue_key for p in current_pairs}
            ))
            .distinct()
        )
        issues_with_history: set[str] = {
            row[0] for row in (await session.execute(any_prior_q)).all()
        }

        new_snapshots: list[dict] = []
        new_events: list[dict] = []
        update_payloads: list[dict] = []

        for pair in current_pairs:
            key = (pair.issue_key, pair.sprint_name)
            existing_snapshot = existing.get(key)

            if existing_snapshot is None:
                # ---- First sighting ----------------------------------------
                # Case A: full backfill, OR sprint hasn't started, OR this
                # issue has never been seen by us before in any sprint.
                # The third arm protects against false "added mid-sprint"
                # tags when an issue appears for the first time after a
                # sprint has just started (e.g. the team adds tickets on
                # day 1 and the next scheduled sync runs an hour later).
                first_observation_of_issue = (
                    pair.issue_key not in issues_with_history
                )
                if (
                    is_full_backfill
                    or _is_pre_start(pair.sprint_start_date, now)
                    or first_observation_of_issue
                ):
                    # Case A or B — silent baseline
                    new_snapshots.append(
                        {
                            "issue_key": pair.issue_key,
                            "sprint_name": pair.sprint_name,
                            "first_sp": pair.story_points,
                            "last_sp": pair.story_points,
                            "last_assignee": pair.assignee_id,
                            "last_status": pair.status,
                            "was_added_mid_sprint": False,
                            "first_seen_at": now,
                            "last_seen_at": now,
                        }
                    )
                else:
                    # Case C — counterfactual baseline + added_mid_sprint event
                    sp = pair.story_points or Decimal("0")
                    new_snapshots.append(
                        {
                            "issue_key": pair.issue_key,
                            "sprint_name": pair.sprint_name,
                            "first_sp": Decimal("0"),
                            "last_sp": pair.story_points,
                            "last_assignee": pair.assignee_id,
                            "last_status": pair.status,
                            "was_added_mid_sprint": True,
                            "first_seen_at": now,
                            "last_seen_at": now,
                        }
                    )
                    new_events.append(
                        {
                            "issue_key": pair.issue_key,
                            "sprint_name": pair.sprint_name,
                            "change_type": "added_mid_sprint",
                            "old_value": None,
                            "new_value": str(pair.story_points)
                            if pair.story_points is not None
                            else "0",
                            "sp_delta": sp,
                            "detected_at": now,
                        }
                    )
                continue

            # ---- Existing snapshot — detect changes ------------------------
            need_update = False

            if not _equal_decimal(pair.story_points, existing_snapshot.last_sp):
                old_d = _normalise_decimal(existing_snapshot.last_sp) or Decimal("0")
                new_d = _normalise_decimal(pair.story_points) or Decimal("0")
                new_events.append(
                    {
                        "issue_key": pair.issue_key,
                        "sprint_name": pair.sprint_name,
                        "change_type": "sp",
                        "old_value": str(existing_snapshot.last_sp)
                        if existing_snapshot.last_sp is not None
                        else None,
                        "new_value": str(pair.story_points)
                        if pair.story_points is not None
                        else None,
                        "sp_delta": new_d - old_d,
                        "detected_at": now,
                    }
                )
                stats.sp_changes += 1
                need_update = True

            if (pair.assignee_id or None) != (existing_snapshot.last_assignee or None):
                new_events.append(
                    {
                        "issue_key": pair.issue_key,
                        "sprint_name": pair.sprint_name,
                        "change_type": "assignee",
                        "old_value": existing_snapshot.last_assignee,
                        "new_value": pair.assignee_id,
                        "sp_delta": None,
                        "detected_at": now,
                    }
                )
                stats.assignee_changes += 1
                need_update = True

            if (pair.status or None) != (existing_snapshot.last_status or None):
                new_events.append(
                    {
                        "issue_key": pair.issue_key,
                        "sprint_name": pair.sprint_name,
                        "change_type": "status",
                        "old_value": existing_snapshot.last_status,
                        "new_value": pair.status,
                        "sp_delta": None,
                        "detected_at": now,
                    }
                )
                stats.status_changes += 1
                need_update = True

            if need_update:
                update_payloads.append(
                    {
                        "issue_key": pair.issue_key,
                        "sprint_name": pair.sprint_name,
                        "last_sp": pair.story_points,
                        "last_assignee": pair.assignee_id,
                        "last_status": pair.status,
                        "last_seen_at": now,
                    }
                )
            else:
                # No change — bump last_seen_at only
                update_payloads.append(
                    {
                        "issue_key": pair.issue_key,
                        "sprint_name": pair.sprint_name,
                        "last_sp": existing_snapshot.last_sp,
                        "last_assignee": existing_snapshot.last_assignee,
                        "last_status": existing_snapshot.last_status,
                        "last_seen_at": now,
                    }
                )

        # ---- Persist ---------------------------------------------------------
        # asyncpg caps bind params at 32767. Chunk multi-row inserts to stay
        # well below — these can run into thousands of rows on a first sync.
        CHUNK = 1000
        if new_snapshots:
            for i in range(0, len(new_snapshots), CHUNK):
                await session.execute(
                    insert(TicketStateSnapshot), new_snapshots[i : i + CHUNK]
                )
        if new_events:
            for i in range(0, len(new_events), CHUNK):
                await session.execute(
                    insert(ScopeChangeEvent), new_events[i : i + CHUNK]
                )
        for payload in update_payloads:
            await session.execute(
                update(TicketStateSnapshot)
                .where(
                    TicketStateSnapshot.issue_key == payload["issue_key"],
                    TicketStateSnapshot.sprint_name == payload["sprint_name"],
                )
                .values(
                    last_sp=payload["last_sp"],
                    last_assignee=payload["last_assignee"],
                    last_status=payload["last_status"],
                    last_seen_at=payload["last_seen_at"],
                )
            )

        await session.commit()
        logger.info(
            "snapshots_updated",
            new_snapshots=len(new_snapshots),
            new_events=len(new_events),
            updates=len(update_payloads),
        )


# Tickets attached to a sprint *just before* it goes active still appear
# to our snapshot logic as "first observation, sprint already started".
# We can't disambiguate "added pre-start, synced after start" from "truly
# added mid-sprint" purely from the link timestamp — Jira gives us no
# IssueSprint creation time. As a pragmatic fix we treat any sprint that
# started within this grace window as Case-B (pre-start). For our 4×/day
# sync schedule, 24 h covers the common "bump start time, sync next" path.
_PRE_START_GRACE_HOURS = 24


def _is_pre_start(sprint_start_date: datetime | None, now: datetime) -> bool:
    """True if the sprint hasn't started yet, or only started very recently."""
    if sprint_start_date is None:
        # No start date known — be conservative: treat as Case B (silent).
        return True
    if sprint_start_date > now:
        return True
    age = now - sprint_start_date
    return age.total_seconds() < _PRE_START_GRACE_HOURS * 3600
