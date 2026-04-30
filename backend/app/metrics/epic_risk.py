"""Epic Risk classification + throughput.

Classifies every team epic into one of five risk bands:

- **at_risk**      — dated, open, AND past due / no owner / inactive >14d.
- **watch**        — dated, open, slowing velocity OR due soon and behind.
- **on_track**     — dated, open, no immediate concerns.
- **future_scope** — open but has NO due date. Future / unscheduled
  work — no planning anchor to evaluate against.
- **done**         — status_category = 'done'.

QA-bookkeeping epics labelled `proj_qa` are excluded from the page
entirely — they're tracking artifacts, not delivery work.

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

RiskBand = Literal["at_risk", "watch", "on_track", "future_scope", "done"]

# Labels that mean "this epic isn't real delivery work for the page".
# Epics carrying any of these get filtered out of the classifier output.
_EXCLUDE_LABELS: tuple[str, ...] = ("proj_qa",)


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
    has_project: bool  # any `proj_*` label on the epic


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
    done_since: date | None = None,
) -> list[EpicRisk]:
    """Pull every epic + its rollup + recent-activity timestamp, then classify.

    When `team_field` and `team_id` are both provided, restrict to epics whose
    raw_payload has that team set on the configured custom field. This drops
    parent epics that we only stored as hierarchy context for issues we own
    (e.g. an epic on another team where one Search-team child happens to be
    parented under it).

    `done_since` (default: Jan 1 of the current year) clamps the `done`
    bucket — epics whose `resolutiondate` falls before this cutoff are
    dropped entirely. Long-tail epics from previous years aren't actionable
    and just inflate the Done count.
    """
    today = datetime.now(tz=timezone.utc).date()
    if done_since is None:
        done_since = date(today.year, 1, 1)
    where_parts: list[str] = []
    params: dict[str, object] = {}
    if team_field and team_id:
        # team_field is config (e.g. "customfield_10500"); safe to inline.
        where_parts.append(
            f"e.raw_payload->'fields'->'{team_field}'->>'id' = :team_id"
        )
        params["team_id"] = team_id
    # Drop epics carrying any excluded label (e.g. proj_qa).
    if _EXCLUDE_LABELS:
        where_parts.append(
            "NOT EXISTS ("
            "SELECT 1 FROM jsonb_array_elements_text("
            "  e.raw_payload->'fields'->'labels'"
            ") l WHERE l = ANY(:exclude_labels))"
        )
        params["exclude_labels"] = list(_EXCLUDE_LABELS)
    team_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

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
      MAX(i.updated_at) FILTER (WHERE i.removed_at IS NULL) AS most_recent_child_update,
      COALESCE(
        (SELECT bool_or(l LIKE 'proj\\_%' ESCAPE '\\')
         FROM jsonb_array_elements_text(e.raw_payload->'fields'->'labels') l),
        false
      ) AS has_project,
      CASE
        WHEN e.raw_payload->'fields'->>'resolutiondate' IS NOT NULL
          THEN CAST(e.raw_payload->'fields'->>'resolutiondate' AS timestamptz)::date
        ELSE NULL
      END AS resolution_date
    FROM epics e
    LEFT JOIN people p ON p.account_id = e.owner_account_id
    LEFT JOIN issues i ON i.epic_key = e.issue_key
    {team_clause}
    GROUP BY e.issue_key, e.summary, e.status, e.status_category,
             e.initiative_key, e.owner_account_id, p.display_name, e.due_date,
             e.raw_payload
    """
    rows = (await session.execute(text(sql), params)).all()

    out: list[EpicRisk] = []
    for r in rows:
        # Skip done epics resolved before the cutoff. They're long-tail
        # historical work — not actionable, and just inflates the Done
        # count visible on /epic-risk.
        if r.status_category == "done":
            res = r.resolution_date
            if res is None or res < done_since:
                continue

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
        elif r.due_date is None:
            # No planning anchor → future scope, regardless of other signals.
            # We don't try to grade "is it on track?" without a target date.
            band = "future_scope"
        else:
            # at_risk triggers — only relevant for dated epics.
            if days_overdue is not None and days_overdue > 0:
                reasons.append(f"past due {days_overdue}d")
            if r.owner_account_id is None:
                reasons.append("no owner")
            if (
                days_since_activity is not None
                and days_since_activity > 14
            ):
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
                has_project=bool(r.has_project),
            )
        )

    # Sort: at_risk first (by days_overdue desc), then watch, then on_track, then done.
    band_order = {
        "at_risk": 0,
        "watch": 1,
        "on_track": 2,
        "future_scope": 3,
        "done": 4,
    }
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
    join_conds: list[str] = ["true"]
    params: dict[str, object] = {"n": sprint_window}
    if team_field and team_id:
        join_conds = [
            f"e.raw_payload->'fields'->'{team_field}'->>'id' = :team_id"
        ]
        params["team_id"] = team_id
    if _EXCLUDE_LABELS:
        join_conds.append(
            "NOT EXISTS ("
            "SELECT 1 FROM jsonb_array_elements_text("
            "  e.raw_payload->'fields'->'labels'"
            ") l WHERE l = ANY(:exclude_labels))"
        )
        params["exclude_labels"] = list(_EXCLUDE_LABELS)
    team_join_clause = "LEFT JOIN epics e ON " + " AND ".join(join_conds)

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
