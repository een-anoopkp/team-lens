"""Per-sprint rollup: KPIs + per-person breakdown + hygiene-inline counts.

Used by:
- Sprint Health (active): hero KPIs + the per-person panel
- Sprint Health (closed): each sprint's expanded body shows this rollup
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.metrics.working_days import working_days


@dataclass(slots=True)
class StatusBreakdown:
    """Counts + SP per status_category for the per-person progress bar."""
    todo_sp: Decimal = Decimal("0")
    in_progress_sp: Decimal = Decimal("0")
    review_sp: Decimal = Decimal("0")  # status name ILIKE '%review%'
    validation_sp: Decimal = Decimal("0")  # status name ILIKE '%validat%'
    done_sp: Decimal = Decimal("0")


@dataclass(slots=True)
class PersonRollup:
    person_account_id: str
    person_display_name: str | None
    committed_sp: Decimal
    completed_sp: Decimal
    available_days: int
    velocity: Decimal | None
    accuracy: Decimal | None
    status_breakdown: StatusBreakdown


@dataclass(slots=True)
class HygieneInline:
    unassigned: int
    missing_sp: int  # SP IS NULL on Story/Task/Bug (not Sub-task)
    missing_epic: int  # epic_key IS NULL on Story/Task/Bug


@dataclass(slots=True)
class SprintRollup:
    sprint_id: int
    sprint_name: str
    state: str
    committed_sp: Decimal
    completed_sp: Decimal
    velocity_sp_per_day: Decimal | None
    projected_sp: Decimal | None
    days_total: int
    days_elapsed: int
    days_remaining: int
    hygiene: HygieneInline
    per_person: list[PersonRollup]


async def sprint_rollup(
    session: AsyncSession, *, sprint_id: int, region: str = "IN"
) -> SprintRollup | None:
    sprint = (
        await session.execute(
            text("SELECT * FROM sprints WHERE sprint_id = :id"),
            {"id": sprint_id},
        )
    ).one_or_none()
    if sprint is None:
        return None

    start = sprint.start_date.date() if sprint.start_date else None
    end_for_done = sprint.complete_date or sprint.end_date
    end_d = end_for_done.date() if end_for_done else None

    # ---- Aggregate KPIs --------------------------------------------------
    aggs = (
        await session.execute(
            text(
                """
                SELECT
                  COALESCE(SUM(t.first_sp), 0)::numeric AS committed,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'done'
                      AND i.resolution_date IS NOT NULL
                      AND i.resolution_date::date >= :start
                      AND i.resolution_date::date <= :end
                  ), 0)::numeric AS completed
                FROM issues i
                JOIN issue_sprints isp ON isp.issue_key = i.issue_key
                LEFT JOIN ticket_state_snapshots t
                  ON t.issue_key = i.issue_key AND t.sprint_name = :sn
                WHERE isp.sprint_id = :sid
                  AND i.removed_at IS NULL
                  AND i.issue_type <> 'Sub-task'
                """
            ),
            {"sid": sprint_id, "sn": sprint.name, "start": start, "end": end_d},
        )
    ).one()
    committed = Decimal(aggs.committed or 0)
    completed = Decimal(aggs.completed or 0)

    # ---- Days math ------------------------------------------------------
    days_total = days_elapsed = days_remaining = 0
    velocity = projected = None
    if start is not None and end_d is not None:
        from datetime import date as _d
        from datetime import datetime as _dt
        from datetime import timezone as _tz
        today = _dt.now(tz=_tz.utc).date()
        days_total = await working_days(session, start=start, end=end_d, region=region)
        elapsed_end = min(today, end_d) if start <= today else start
        days_elapsed = (
            await working_days(session, start=start, end=elapsed_end, region=region)
            if today >= start
            else 0
        )
        days_remaining = max(0, days_total - days_elapsed)
        if days_elapsed > 0:
            velocity = completed / Decimal(days_elapsed)
            projected = (velocity * Decimal(days_total)) if days_total > 0 else None

    # ---- Hygiene inline -------------------------------------------------
    hyg = (
        await session.execute(
            text(
                """
                SELECT
                  COUNT(*) FILTER (WHERE i.assignee_id IS NULL) AS unassigned,
                  COUNT(*) FILTER (WHERE i.story_points IS NULL) AS missing_sp,
                  COUNT(*) FILTER (WHERE i.epic_key IS NULL) AS missing_epic
                FROM issues i
                JOIN issue_sprints isp ON isp.issue_key = i.issue_key
                WHERE isp.sprint_id = :sid
                  AND i.removed_at IS NULL
                  AND i.issue_type <> 'Sub-task'
                """
            ),
            {"sid": sprint_id},
        )
    ).one()
    hygiene = HygieneInline(
        unassigned=int(hyg.unassigned or 0),
        missing_sp=int(hyg.missing_sp or 0),
        missing_epic=int(hyg.missing_epic or 0),
    )

    # ---- Per-person rollup ----------------------------------------------
    person_rows = (
        await session.execute(
            text(
                """
                SELECT
                  i.assignee_id AS account_id,
                  p.display_name,
                  COALESCE(SUM(t.first_sp), 0)::numeric AS committed,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'done'
                      AND i.resolution_date IS NOT NULL
                      AND i.resolution_date::date >= :start
                      AND i.resolution_date::date <= :end
                  ), 0)::numeric AS completed,
                  COALESCE(SUM(i.story_points) FILTER (WHERE i.status_category = 'done'), 0)::numeric AS done_sp_any,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'indeterminate'
                      AND i.status ILIKE '%%review%%'
                  ), 0)::numeric AS review_sp,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'indeterminate'
                      AND i.status ILIKE '%%valid%%'
                  ), 0)::numeric AS validation_sp,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'indeterminate'
                      AND i.status NOT ILIKE '%%review%%'
                      AND i.status NOT ILIKE '%%valid%%'
                  ), 0)::numeric AS in_progress_sp,
                  COALESCE(SUM(i.story_points) FILTER (
                    WHERE i.status_category = 'new'
                  ), 0)::numeric AS todo_sp
                FROM issues i
                JOIN issue_sprints isp ON isp.issue_key = i.issue_key
                LEFT JOIN ticket_state_snapshots t
                  ON t.issue_key = i.issue_key AND t.sprint_name = :sn
                LEFT JOIN people p ON p.account_id = i.assignee_id
                WHERE isp.sprint_id = :sid
                  AND i.removed_at IS NULL
                  AND i.issue_type <> 'Sub-task'
                  AND i.assignee_id IS NOT NULL
                GROUP BY i.assignee_id, p.display_name
                ORDER BY committed DESC
                """
            ),
            {"sid": sprint_id, "sn": sprint.name, "start": start, "end": end_d},
        )
    ).all()

    per_person: list[PersonRollup] = []
    for r in person_rows:
        avail = (
            await working_days(
                session,
                start=start,
                end=end_d,
                region=region,
                person_account_id=r.account_id,
            )
            if start and end_d
            else 1
        )
        c = Decimal(r.committed or 0)
        d = Decimal(r.completed or 0)
        per_person.append(
            PersonRollup(
                person_account_id=r.account_id,
                person_display_name=r.display_name,
                committed_sp=c,
                completed_sp=d,
                available_days=avail,
                velocity=(d / Decimal(avail)) if avail > 0 else None,
                accuracy=(d / c) if c > 0 else None,
                status_breakdown=StatusBreakdown(
                    todo_sp=Decimal(r.todo_sp or 0),
                    in_progress_sp=Decimal(r.in_progress_sp or 0),
                    review_sp=Decimal(r.review_sp or 0),
                    validation_sp=Decimal(r.validation_sp or 0),
                    done_sp=Decimal(r.done_sp_any or 0),
                ),
            )
        )

    return SprintRollup(
        sprint_id=sprint.sprint_id,
        sprint_name=sprint.name,
        state=sprint.state,
        committed_sp=committed,
        completed_sp=completed,
        velocity_sp_per_day=velocity,
        projected_sp=projected,
        days_total=days_total,
        days_elapsed=days_elapsed,
        days_remaining=days_remaining,
        hygiene=hygiene,
        per_person=per_person,
    )
