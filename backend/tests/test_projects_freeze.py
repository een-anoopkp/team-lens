"""Tests for the project freeze job.

Two layers:
1. `extract_project_labels` — pure-function tests, no DB.
2. `run_freeze_job` integration — uses the same SQLite fixture as test_snapshots,
   extended with project_snapshots + epics + scope_change_events tables.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.epics import Epic
from app.models.issue_sprints import IssueSprint
from app.models.issues import Issue
from app.models.project_snapshots import ProjectSnapshot
from app.models.sprints import Sprint
from app.sync.projects import extract_project_labels, run_freeze_job


# ---------- pure label extraction -------------------------------------------

def test_extract_project_labels_strips_prefix() -> None:
    raw = {"fields": {"labels": ["proj_rerank-rollout", "other-label", "proj_multilingual"]}}
    assert sorted(extract_project_labels(raw)) == ["multilingual", "rerank-rollout"]


def test_extract_project_labels_handles_no_labels() -> None:
    assert extract_project_labels({}) == []
    assert extract_project_labels({"fields": {}}) == []
    assert extract_project_labels({"fields": {"labels": []}}) == []
    assert extract_project_labels(None) == []


def test_extract_project_labels_ignores_empty_suffix() -> None:
    raw = {"fields": {"labels": ["proj_", "proj_x"]}}
    assert extract_project_labels(raw) == ["x"]


# ---------- run_freeze_job integration --------------------------------------

@pytest.fixture
async def session_factory(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(_create_subset)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    yield factory
    await engine.dispose()


def _create_subset(sync_conn) -> None:
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
        "initiatives",
        md,
        Column("issue_key", String, primary_key=True),
        Column("summary", String, nullable=False),
        Column("status", String, nullable=False),
        Column("status_category", String, nullable=False),
        Column("owner_account_id", String),
        Column("raw_payload", JSON, nullable=False),
        Column("synced_at", DateTime(timezone=True)),
    )

    Table(
        "epics",
        md,
        Column("issue_key", String, primary_key=True),
        Column("summary", String, nullable=False),
        Column("status", String, nullable=False),
        Column("status_category", String, nullable=False),
        Column("initiative_key", String),
        Column("owner_account_id", String),
        Column("due_date", DateTime),
        Column("raw_payload", JSON, nullable=False),
        Column("synced_at", DateTime(timezone=True)),
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
        Column("epic_key", String, ForeignKey("epics.issue_key")),
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
        "scope_change_events",
        md,
        Column("id", BigInteger, primary_key=True, autoincrement=True),
        Column("issue_key", String, nullable=False),
        Column("sprint_name", String, nullable=False),
        Column("change_type", String, nullable=False),
        Column("old_value", String),
        Column("new_value", String),
        Column("sp_delta", Numeric(6, 2)),
        Column("detected_at", DateTime(timezone=True)),
    )

    Table(
        "project_snapshots",
        md,
        Column("project_name", String, primary_key=True),
        Column("completed_at", DateTime(timezone=True), nullable=False),
        Column("epic_count", Integer, nullable=False),
        # Use JSON for arrays so SQLite can store them
        Column("epic_keys", JSON, nullable=False),
        Column("total_sp", Numeric(8, 2), nullable=False),
        Column("sprints_active", Integer, nullable=False),
        Column("first_sprint_name", String),
        Column("last_sprint_name", String),
        Column("avg_velocity_sp", Numeric(8, 2)),
        Column("avg_sprint_length_d", Numeric(5, 2)),
        Column("scope_churn_pct", Numeric(5, 2)),
        Column("sp_added_total", Numeric(8, 2)),
        Column("sp_removed_total", Numeric(8, 2)),
        Column("contributors", JSON),
        Column("initiative_keys", JSON),
        Column("raw_metrics", JSON, nullable=False),
        Column("snapshot_at", DateTime(timezone=True)),
    )

    md.create_all(sync_conn)


async def _seed_project(
    factory,
    *,
    project_name: str,
    epic_keys: list[str],
    epic_status_categories: list[str],
) -> None:
    """Seed an epic per (key, status_category) plus one Done child issue per epic with SP=5."""
    async with factory() as session:
        sprint_start = datetime.now(tz=UTC) - timedelta(days=20)
        session.add(
            Sprint(
                sprint_id=1,
                name="Search 2026-01",
                state="closed",
                start_date=sprint_start,
                end_date=sprint_start + timedelta(days=14),
                board_id=135,
                raw_payload={},
            )
        )
        for epic_key, status_cat in zip(epic_keys, epic_status_categories, strict=True):
            session.add(
                Epic(
                    issue_key=epic_key,
                    summary=f"epic {epic_key}",
                    status="In Progress" if status_cat != "done" else "Done",
                    status_category=status_cat,
                    raw_payload={"fields": {"labels": [f"proj_{project_name}"]}},
                )
            )
            await session.flush()
            child_key = f"{epic_key}-CHILD"
            session.add(
                Issue(
                    issue_key=child_key,
                    issue_type="Story",
                    summary="child",
                    status="Closed",
                    status_category="done",
                    assignee_id="alice",
                    epic_key=epic_key,
                    story_points=Decimal("5"),
                    resolution_date=datetime.now(tz=UTC) - timedelta(days=3),
                    updated_at=datetime.now(tz=UTC),
                    raw_payload={},
                )
            )
            await session.flush()
            session.add(IssueSprint(issue_key=child_key, sprint_id=1))
        await session.commit()


@pytest.mark.asyncio
async def test_freeze_job_skips_active_project(session_factory) -> None:
    await _seed_project(
        session_factory,
        project_name="rerank",
        epic_keys=["EEPD-100", "EEPD-101"],
        epic_status_categories=["done", "indeterminate"],  # one open
    )
    written = await run_freeze_job(session_factory)
    assert written == 0
    async with session_factory() as session:
        snapshots = (await session.execute(select(ProjectSnapshot))).scalars().all()
    assert snapshots == []


@pytest.mark.asyncio
async def test_freeze_job_snapshots_completed_project(session_factory) -> None:
    await _seed_project(
        session_factory,
        project_name="rerank",
        epic_keys=["EEPD-100", "EEPD-101"],
        epic_status_categories=["done", "done"],
    )
    written = await run_freeze_job(session_factory)
    assert written == 1

    async with session_factory() as session:
        snap = (
            await session.execute(
                select(ProjectSnapshot).where(ProjectSnapshot.project_name == "rerank")
            )
        ).scalar_one()

    assert snap.epic_count == 2
    assert sorted(snap.epic_keys) == ["EEPD-100", "EEPD-101"]
    assert snap.total_sp == Decimal("10")  # 2 epics × 1 child × 5 SP
    assert snap.sprints_active == 1
    assert snap.first_sprint_name == "Search 2026-01"
    assert snap.contributors == ["alice"]


@pytest.mark.asyncio
async def test_freeze_job_is_idempotent_when_unchanged(session_factory) -> None:
    await _seed_project(
        session_factory,
        project_name="rerank",
        epic_keys=["EEPD-100"],
        epic_status_categories=["done"],
    )
    assert await run_freeze_job(session_factory) == 1
    # Second run with no changes — nothing written
    assert await run_freeze_job(session_factory) == 0


@pytest.mark.asyncio
async def test_freeze_job_re_snapshots_when_epics_change(session_factory) -> None:
    await _seed_project(
        session_factory,
        project_name="rerank",
        epic_keys=["EEPD-100"],
        epic_status_categories=["done"],
    )
    assert await run_freeze_job(session_factory) == 1

    # Add another Done epic to the project
    async with session_factory() as session:
        session.add(
            Epic(
                issue_key="EEPD-200",
                summary="new epic",
                status="Done",
                status_category="done",
                raw_payload={"fields": {"labels": ["proj_rerank"]}},
            )
        )
        await session.commit()

    written = await run_freeze_job(session_factory)
    assert written == 1  # snapshot row updated, not skipped

    async with session_factory() as session:
        snap = (
            await session.execute(
                select(ProjectSnapshot).where(ProjectSnapshot.project_name == "rerank")
            )
        ).scalar_one()
    assert sorted(snap.epic_keys) == ["EEPD-100", "EEPD-200"]
    assert snap.epic_count == 2
