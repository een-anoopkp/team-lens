"""Epic Risk classification + throughput.

Classifies every team epic into one of four risk bands:

- **at_risk** — past due (due_date < today, not done) OR no owner OR
  no recent activity (>14 days since updated).
- **watch** — slowing velocity (completion <50% past mid-window) OR
  has any aged blockers in the latest sprint.
- **on_track** — in progress, no immediate concerns.
- **done** — status_category = 'done'.

Throughput = # epics whose status flipped to done per sprint window.
Approximates "epics closed in sprint N" by mapping epic.resolution_date
into the sprint windows we know about.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

RiskBand = Literal["at_risk", "watch", "on_track", "done"]


@dataclass(slots=True)
class EpicRisk:
    issue_key: str
    summary: str
    status: str
    status_category: str
    initiative_key: str | None
    owner_account_id: str | None
    owner_display_name: str | None
    due_date: date | None
    days_overdue: int | None
    issue_count: int
    sp_total: Decimal
    sp_done: Decimal
    days_since_activity: int | None
    risk_band: RiskBand
    risk_reasons: list[str]


@dataclass(slots=True)
class ThroughputPoint:
    sprint_id: int
    sprint_name: str
    closed_epics: int


async def classify_epic_risks(
    session: AsyncSession,
    *,
    team_field: str | None = None,
    team_id: str | None = None,
) -> list[EpicRisk]:
    """Pull every epic + its rollup + recent-activity timestamp, then classify.

    When `team_field` and `team_id` are both provided, restrict to epics whose
    raw_payload has that team set on the configured custom field. This drops
    parent epics that we only stored as hierarchy context for issues we own
    (e.g. an epic on another team where one Search-team child happens to be
    parented under it).
    """
    today = datetime.now(tz=timezone.utc).date()
    team_clause = ""
    params: dict[str, str] = {}
    if team_field and team_id:
        # team_field is config (e.g. "customfield_10500"); safe to inline.
        team_clause = (
            f"WHERE e.raw_payload->'fields'->'{team_field}'->>'id' = :team_id"
        )
        params["team_id"] = team_id

    sql = f"""
    SELECT
      e.issue_key,
      e.summary,
      e.status,
      e.status_category,
      e.initiative_key,
      e.owner_account_id,
      p.display_name AS owner_display_name,
      e.due_date,
      COUNT(i.issue_key) FILTER (WHERE i.removed_at IS NULL) AS issue_count,
      COALESCE(SUM(i.story_points) FILTER (WHERE i.removed_at IS NULL), 0)::numeric AS sp_total,
      COALESCE(SUM(i.story_points) FILTER (
        WHERE i.removed_at IS NULL AND i.status_category = 'done'
      ), 0)::numeric AS sp_done,
      MAX(i.updated_at) FILTER (WHERE i.removed_at IS NULL) AS most_recent_child_update
    FROM epics e
    LEFT JOIN people p ON p.account_id = e.owner_account_id
    LEFT JOIN issues i ON i.epic_key = e.issue_key
    {team_clause}
    GROUP BY e.issue_key, e.summary, e.status, e.status_category,
             e.initiative_key, e.owner_account_id, p.display_name, e.due_date
    """
    rows = (await session.execute(text(sql), params)).all()

    out: list[EpicRisk] = []
    for r in rows:
        days_overdue = None
        if r.due_date and r.status_category != "done" and r.due_date < today:
            days_overdue = (today - r.due_date).days

        days_since_activity = None
        if r.most_recent_child_update is not None:
            now_utc = datetime.now(tz=timezone.utc)
            days_since_activity = max(0, (now_utc - r.most_recent_child_update).days)

        sp_total = Decimal(r.sp_total or 0)
        sp_done = Decimal(r.sp_done or 0)

        band: RiskBand
        reasons: list[str] = []

        if r.status_category == "done":
            band = "done"
        else:
            # at_risk triggers
            if days_overdue is not None and days_overdue > 0:
                reasons.append(f"past due {days_overdue}d")
            if r.owner_account_id is None:
                reasons.append("no owner")
            if days_since_activity is not None and days_since_activity > 14:
                reasons.append(f"no activity {days_since_activity}d")

            if reasons:
                band = "at_risk"
            else:
                # watch triggers
                if sp_total > 0 and sp_done < sp_total * Decimal("0.3") and (
                    days_since_activity is not None and days_since_activity > 7
                ):
                    band = "watch"
                    reasons.append("slow progress")
                elif r.due_date and (r.due_date - today).days <= 14 and sp_total > 0 and sp_done < sp_total * Decimal("0.7"):
                    band = "watch"
                    reasons.append("due soon, behind")
                else:
                    band = "on_track"

        out.append(
            EpicRisk(
                issue_key=r.issue_key,
                summary=r.summary,
                status=r.status,
                status_category=r.status_category,
                initiative_key=r.initiative_key,
                owner_account_id=r.owner_account_id,
                owner_display_name=r.owner_display_name,
                due_date=r.due_date,
                days_overdue=days_overdue,
                issue_count=int(r.issue_count or 0),
                sp_total=sp_total,
                sp_done=sp_done,
                days_since_activity=days_since_activity,
                risk_band=band,
                risk_reasons=reasons,
            )
        )

    # Sort: at_risk first (by days_overdue desc), then watch, then on_track, then done.
    band_order = {"at_risk": 0, "watch": 1, "on_track": 2, "done": 3}
    out.sort(
        key=lambda e: (
            band_order[e.risk_band],
            -(e.days_overdue or 0),
            -float(e.sp_total - e.sp_done),
        )
    )
    return out


async def epic_throughput(
    session: AsyncSession,
    *,
    sprint_window: int = 6,
    team_field: str | None = None,
    team_id: str | None = None,
) -> list[ThroughputPoint]:
    """Per-sprint count of epics that flipped to done within the sprint window.

    Same team-scoping behavior as `classify_epic_risks`: when both
    `team_field` and `team_id` are set, only count epics actually assigned
    to that team (not parent-context epics from other teams).
    """
    team_join_clause = "LEFT JOIN epics e ON true"
    params: dict[str, object] = {"n": sprint_window}
    if team_field and team_id:
        team_join_clause = (
            "LEFT JOIN epics e ON "
            f"e.raw_payload->'fields'->'{team_field}'->>'id' = :team_id"
        )
        params["team_id"] = team_id

    sql = f"""
    WITH recent_sprints AS (
      SELECT sprint_id, name, start_date, end_date, complete_date
      FROM sprints
      WHERE state IN ('active', 'closed')
        AND start_date IS NOT NULL
      ORDER BY start_date DESC
      LIMIT :n
    )
    SELECT
      s.sprint_id,
      s.name,
      COUNT(DISTINCT e.issue_key) FILTER (
        WHERE e.status_category = 'done'
          AND e.raw_payload->'fields'->>'resolutiondate' IS NOT NULL
          AND CAST(e.raw_payload->'fields'->>'resolutiondate' AS timestamptz)::date >= s.start_date::date
          AND CAST(e.raw_payload->'fields'->>'resolutiondate' AS timestamptz)::date <= COALESCE(s.complete_date, s.end_date)::date
      ) AS closed_epics
    FROM recent_sprints s
    {team_join_clause}
    GROUP BY s.sprint_id, s.name, s.start_date
    ORDER BY s.start_date ASC
    """
    rows = (await session.execute(text(sql), params)).all()
    return [
        ThroughputPoint(
            sprint_id=r.sprint_id,
            sprint_name=r.name,
            closed_epics=int(r.closed_epics or 0),
        )
        for r in rows
    ]
