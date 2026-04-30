"""Tests for snapshot diff logic (Cases A / B / C + change-type events).

Uses an in-memory SQLite-backed session because snapshots logic is pure SQL
on synced rows. Falls back to a real Postgres if SQLite breaks on JSONB or
ARRAY columns — but for the snapshot tables themselves (no JSONB), SQLite
is fine.

These tests build minimal data via direct ORM inserts (no Jira), then call
`update_snapshots()` and assert the resulting snapshot + event rows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.models.issue_sprints import IssueSprint
from app.models.issues import Issue
from app.models.scope_change_events import ScopeChangeEvent
from app.models.sprints import Sprint
from app.models.ticket_state_snapshots import TicketStateSnapshot
from app.sync.stats import SyncStats
from app.sync.snapshots import update_snapshots


@pytest.fixture
async def session_factory(tmp_path):
    """Spin up a tmp SQLite DB with just the tables snapshots logic needs."""
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    # Create tables for the subset we need; cross-FK to issues + sprints.
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: _create_subset(sync_conn)
        )
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    yield factory
    await engine.dispose()


def _create_subset(sync_conn) -> None:
    # Simpler: create specifically the tables involved (issues, sprints,
    # issue_sprints, ticket_state_snapshots, scope_change_events).
    # JSONB column on issues + sprints is mapped to JSON for SQLite; we'll
    # set raw_payload to '{}' so it's serialisable.
    from sqlalchemy import (
        BigInteger,
        Boolean,
        Column,
        DateTime,
        ForeignKey,
        Integer,
        MetaData,
        Numeric,
        String,
        Table,
        Text,
    )
    from sqlalchemy.types import JSON

    md = MetaData()

    Table(
        "people",
        md,
        Column("account_id", String, primary_key=True),
        Column("display_name", String, nullable=False),
        Column("email", String),
        Column("active", Boolean, nullable=False, default=True),
        Column("first_seen_at", DateTime(timezone=True)),
        Column("last_seen_at", DateTime(timezone=True)),
    )

    Table(
        "sprints",
        md,
        Column("sprint_id", BigInteger, primary_key=True),
        Column("name", String, nullable=False),
        Column("state", String, nullable=False),
        Column("start_date", DateTime(timezone=True)),
        Column("end_date", DateTime(timezone=True)),
        Column("complete_date", DateTime(timezone=True)),
        Column("board_id", BigInteger),
        Column("raw_payload", JSON, nullable=False),
        Column("synced_at", DateTime(timezone=True)),
    )

    Table(
        "issues",
        md,
        Column("issue_key", String, primary_key=True),
        Column("issue_type", String, nullable=False),
        Column("summary", String, nullable=False),
        Column("status", String, nullable=False),
        Column("status_category", String, nullable=False),
        Column("assignee_id", String),
        Column("reporter_id", String),
        Column("parent_key", String),
        Column("epic_key", String),
        Column("story_points", Numeric(6, 2)),
        Column("resolution_date", DateTime(timezone=True)),
        Column("due_date", DateTime),
        Column("updated_at", DateTime(timezone=True), nullable=False),
        Column("raw_payload", JSON, nullable=False),
        Column("last_seen_at", DateTime(timezone=True)),
        Column("removed_at", DateTime(timezone=True)),
        Column("synced_at", DateTime(timezone=True)),
    )

    Table(
        "issue_sprints",
        md,
        Column("issue_key", String, ForeignKey("issues.issue_key"), primary_key=True),
        Column("sprint_id", BigInteger, ForeignKey("sprints.sprint_id"), primary_key=True),
    )

    Table(
        "ticket_state_snapshots",
        md,
        Column("issue_key", String, primary_key=True),
        Column("sprint_name", String, primary_key=True),
        Column("first_sp", Numeric(6, 2)),
        Column("last_sp", Numeric(6, 2)),
        Column("last_assignee", String),
        Column("last_status", String),
        Column(
            "was_added_mid_sprint", Boolean, nullable=False, default=False
        ),
        Column("first_seen_at", DateTime(timezone=True), nullable=False),
        Column("last_seen_at", DateTime(timezone=True), nullable=False),
    )

    Table(
        "scope_change_events",
        md,
        # Integer (not BigInteger) so SQLite treats it as ROWID alias and
        # autoincrements; production schema is BIGSERIAL via Alembic.
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("issue_key", String, nullable=False),
        Column("sprint_name", String, nullable=False),
        Column("change_type", String, nullable=False),
        Column("old_value", String),
        Column("new_value", String),
        Column("sp_delta", Numeric(6, 2)),
        Column("detected_at", DateTime(timezone=True)),
    )

    md.create_all(sync_conn)


# ---------- Test helpers -----------------------------------------------------

async def _seed(
    factory: async_sessionmaker,
    *,
    sprint_id: int = 1,
    sprint_name: str = "Search 2026-08",
    sprint_start: datetime,
    issue_key: str = "EEPD-1",
    sp: Decimal | None = Decimal("5"),
    assignee: str | None = "alice",
    status_cat: str = "indeterminate",
) -> None:
    async with factory() as session:
        session.add(
            Sprint(
                sprint_id=sprint_id,
                name=sprint_name,
                state="closed",
                start_date=sprint_start,
                end_date=sprint_start + timedelta(days=14),
                board_id=135,
                raw_payload={},
            )
        )
        session.add(
            Issue(
                issue_key=issue_key,
                issue_type="Story",
                summary="Test",
                status="In Progress",
                status_category=status_cat,
                assignee_id=assignee,
                story_points=sp,
                updated_at=datetime.now(tz=UTC),
                raw_payload={},
            )
        )
        await session.flush()
        session.add(IssueSprint(issue_key=issue_key, sprint_id=sprint_id))
        await session.commit()


async def _count_events(factory) -> list[ScopeChangeEvent]:
    async with factory() as session:
        rows = (
            await session.execute(
                select(ScopeChangeEvent).order_by(ScopeChangeEvent.id)
            )
        ).scalars().all()
        return list(rows)


async def _get_snapshot(factory, key, sprint_name):
    async with factory() as session:
        row = (
            await session.execute(
                select(TicketStateSnapshot).where(
                    TicketStateSnapshot.issue_key == key,
                    TicketStateSnapshot.sprint_name == sprint_name,
                )
            )
        ).scalar_one_or_none()
        return row


# ---------- Case A: silent baseline on full-backfill -------------------------

@pytest.mark.asyncio
async def test_case_a_first_sighting_full_backfill_is_silent(session_factory) -> None:
    sprint_start = datetime.now(tz=UTC) - timedelta(days=5)
    await _seed(session_factory, sprint_start=sprint_start)
    stats = SyncStats(touched_issue_keys={"EEPD-1"})

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=True,
        stats=stats,
    )

    snap = await _get_snapshot(session_factory, "EEPD-1", "Search 2026-08")
    assert snap is not None
    assert snap.first_sp == Decimal("5")
    assert snap.last_sp == Decimal("5")
    assert snap.was_added_mid_sprint is False
    events = await _count_events(session_factory)
    assert events == []  # silent — no events on first sighting under backfill


# ---------- Case B: silent baseline pre-sprint-start ------------------------

@pytest.mark.asyncio
async def test_case_b_first_sighting_pre_start_is_silent(session_factory) -> None:
    sprint_start = datetime.now(tz=UTC) + timedelta(days=2)  # future
    await _seed(session_factory, sprint_start=sprint_start)
    stats = SyncStats(touched_issue_keys={"EEPD-1"})

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,  # incremental
        stats=stats,
    )

    snap = await _get_snapshot(session_factory, "EEPD-1", "Search 2026-08")
    assert snap is not None
    assert snap.was_added_mid_sprint is False
    events = await _count_events(session_factory)
    assert events == []


# ---------- Case C: mid-sprint addition emits added_mid_sprint event --------

@pytest.mark.asyncio
async def test_case_c_mid_sprint_addition_records_event(session_factory) -> None:
    sprint_start = datetime.now(tz=UTC) - timedelta(days=3)  # already started
    await _seed(session_factory, sprint_start=sprint_start, sp=Decimal("5"))
    stats = SyncStats(touched_issue_keys={"EEPD-1"})

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    snap = await _get_snapshot(session_factory, "EEPD-1", "Search 2026-08")
    assert snap is not None
    assert snap.first_sp == Decimal("0")  # counterfactual
    assert snap.last_sp == Decimal("5")
    assert snap.was_added_mid_sprint is True

    events = await _count_events(session_factory)
    assert len(events) == 1
    e = events[0]
    assert e.change_type == "added_mid_sprint"
    assert e.sp_delta == Decimal("5")
    assert e.old_value is None
    assert e.new_value == "5.00"  # Numeric(6,2) round-trip


# ---------- Existing snapshot: SP / assignee / status changes ---------------

async def _seed_with_existing_snapshot(
    factory,
    *,
    sp: Decimal | None,
    assignee: str | None,
    status_cat: str,
    snap_sp: Decimal | None,
    snap_assignee: str | None,
    snap_status: str,
) -> None:
    sprint_start = datetime.now(tz=UTC) - timedelta(days=5)
    await _seed(
        factory,
        sprint_start=sprint_start,
        sp=sp,
        assignee=assignee,
        status_cat=status_cat,
    )
    async with factory() as session:
        session.add(
            TicketStateSnapshot(
                issue_key="EEPD-1",
                sprint_name="Search 2026-08",
                first_sp=Decimal("3"),
                last_sp=snap_sp,
                last_assignee=snap_assignee,
                last_status=snap_status,
                was_added_mid_sprint=False,
                first_seen_at=datetime.now(tz=UTC) - timedelta(days=4),
                last_seen_at=datetime.now(tz=UTC) - timedelta(days=1),
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_existing_sp_change_emits_event(session_factory) -> None:
    await _seed_with_existing_snapshot(
        session_factory,
        sp=Decimal("8"),
        assignee="alice",
        status_cat="indeterminate",
        snap_sp=Decimal("5"),
        snap_assignee="alice",
        snap_status="indeterminate",
    )
    stats = SyncStats()

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    events = await _count_events(session_factory)
    assert len(events) == 1
    e = events[0]
    assert e.change_type == "sp"
    assert e.sp_delta == Decimal("3")
    # Numeric(6,2) round-trip stringifies Decimal("5") as "5.00" on both
    # Postgres and SQLite. Assert against the canonical 2dp form.
    assert e.old_value == "5.00"
    assert e.new_value == "8.00"
    assert stats.sp_changes == 1

    snap = await _get_snapshot(session_factory, "EEPD-1", "Search 2026-08")
    assert snap.last_sp == Decimal("8")


@pytest.mark.asyncio
async def test_existing_assignee_change_emits_event(session_factory) -> None:
    await _seed_with_existing_snapshot(
        session_factory,
        sp=Decimal("5"),
        assignee="bob",
        status_cat="indeterminate",
        snap_sp=Decimal("5"),
        snap_assignee="alice",
        snap_status="indeterminate",
    )
    stats = SyncStats()

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    events = await _count_events(session_factory)
    assert [e.change_type for e in events] == ["assignee"]
    assert events[0].old_value == "alice"
    assert events[0].new_value == "bob"
    assert stats.assignee_changes == 1


@pytest.mark.asyncio
async def test_existing_status_change_emits_event(session_factory) -> None:
    await _seed_with_existing_snapshot(
        session_factory,
        sp=Decimal("5"),
        assignee="alice",
        status_cat="done",
        snap_sp=Decimal("5"),
        snap_assignee="alice",
        snap_status="indeterminate",
    )
    stats = SyncStats()

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    events = await _count_events(session_factory)
    assert [e.change_type for e in events] == ["status"]
    assert events[0].old_value == "indeterminate"
    assert events[0].new_value == "done"
    assert stats.status_changes == 1


@pytest.mark.asyncio
async def test_no_change_only_bumps_last_seen(session_factory) -> None:
    await _seed_with_existing_snapshot(
        session_factory,
        sp=Decimal("5"),
        assignee="alice",
        status_cat="indeterminate",
        snap_sp=Decimal("5"),
        snap_assignee="alice",
        snap_status="indeterminate",
    )
    stats = SyncStats()

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    events = await _count_events(session_factory)
    assert events == []


@pytest.mark.asyncio
async def test_multiple_changes_emit_multiple_events(session_factory) -> None:
    """SP, assignee, and status all changed simultaneously → 3 events."""
    await _seed_with_existing_snapshot(
        session_factory,
        sp=Decimal("8"),
        assignee="bob",
        status_cat="done",
        snap_sp=Decimal("5"),
        snap_assignee="alice",
        snap_status="indeterminate",
    )
    stats = SyncStats()

    await update_snapshots(
        session_factory,
        touched_issue_keys={"EEPD-1"},
        is_full_backfill=False,
        stats=stats,
    )

    events = await _count_events(session_factory)
    types = sorted(e.change_type for e in events)
    assert types == ["assignee", "sp", "status"]
    assert stats.sp_changes == 1
    assert stats.assignee_changes == 1
    assert stats.status_changes == 1
