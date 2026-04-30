"""Anomaly rules — pure SQL, run after every sync.

Each function returns a list of "firings" (dicts) for its rule. The
runner persists those as an `insight_runs` row with `status='ok'` and
`payload={"firings": [...]}`. An empty list is still a successful run
with zero firings — useful for the "fired N of last 4 syncs" trend.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.metrics.epic_risk import classify_epic_risks
from app.metrics.velocity import velocity_for_sprint_window
from app.models import InsightRule, InsightRun, Sprint


# ---------- velocity-drop ---------------------------------------------------


async def velocity_drop(
    session: AsyncSession,
    *,
    threshold: float = 0.7,
    min_history_sprints: int = 3,
    region: str = "IN",
) -> list[dict[str, Any]]:
    """Person whose latest *closed* sprint velocity < threshold × their
    prior closed-sprint average. We deliberately ignore the active
    sprint — mid-flight velocity always looks low and that's not a
    real anomaly."""
    rows = await velocity_for_sprint_window(
        session, sprint_window=12, person_account_id=None, region=region
    )
    # Filter to closed-only sprints. Need to look up state — pull all
    # sprint ids referenced.
    sprint_ids = {r.sprint_id for r in rows}
    sprint_states = {
        sid: state
        for sid, state in (
            await session.execute(
                select(Sprint.sprint_id, Sprint.state).where(
                    Sprint.sprint_id.in_(sprint_ids)
                )
            )
        ).all()
    }
    closed_rows = [
        r for r in rows if sprint_states.get(r.sprint_id) == "closed"
    ]

    by_person: dict[str, list] = {}
    for r in closed_rows:
        by_person.setdefault(r.person_account_id, []).append(r)

    firings: list[dict[str, Any]] = []
    for pid, person_rows in by_person.items():
        sorted_rows = sorted(person_rows, key=lambda x: x.sprint_id)
        if len(sorted_rows) < min_history_sprints + 1:
            continue
        latest = sorted_rows[-1]
        history = sorted_rows[-7:-1]  # up to 6 prior closed sprints
        valid_history = [
            float(h.velocity)
            for h in history
            if h.velocity is not None and h.velocity > 0
        ]
        if len(valid_history) < min_history_sprints:
            continue
        avg = sum(valid_history) / len(valid_history)
        latest_v = float(latest.velocity) if latest.velocity is not None else 0.0
        if avg <= 0 or latest_v >= avg * threshold:
            continue
        delta_pct = round((latest_v - avg) / avg * 100, 1)
        firings.append(
            {
                "person_account_id": pid,
                "person_display_name": latest.person_display_name,
                "sprint_id": latest.sprint_id,
                "sprint_name": latest.sprint_name,
                "latest_velocity": round(latest_v, 2),
                "avg_velocity": round(avg, 2),
                "delta_pct": delta_pct,
                "history_n": len(valid_history),
            }
        )
    firings.sort(key=lambda f: f["delta_pct"])
    return firings


# ---------- stale-carry-over ------------------------------------------------


async def stale_carry_over(
    session: AsyncSession, *, min_depth: int = 2
) -> list[dict[str, Any]]:
    """Tickets whose carry-over depth (consecutive sprints without a resolution)
    is at least `min_depth`."""
    sql = """
    WITH issue_sprint_seq AS (
      SELECT
        i.issue_key,
        i.summary,
        i.assignee_id,
        s.sprint_id,
        s.name AS sprint_name,
        s.start_date,
        ROW_NUMBER() OVER (
          PARTITION BY i.issue_key
          ORDER BY s.start_date DESC
        ) AS rn
      FROM issues i
      JOIN issue_sprints isp ON isp.issue_key = i.issue_key
      JOIN sprints s ON s.sprint_id = isp.sprint_id
      WHERE i.removed_at IS NULL
        AND i.status_category != 'done'
        AND i.issue_type != 'Sub-task'
        AND s.start_date IS NOT NULL
    )
    SELECT
      issue_key,
      summary,
      assignee_id,
      COUNT(*)::int AS depth,
      MAX(sprint_name) FILTER (WHERE rn = 1) AS latest_sprint
    FROM issue_sprint_seq
    GROUP BY issue_key, summary, assignee_id
    HAVING COUNT(*) >= :min_depth
    ORDER BY depth DESC, issue_key
    """
    result = await session.execute(text(sql), {"min_depth": min_depth})
    return [
        {
            "issue_key": r.issue_key,
            "summary": r.summary,
            "assignee_id": r.assignee_id,
            "depth": int(r.depth),
            "latest_sprint": r.latest_sprint,
        }
        for r in result
    ]


# ---------- aged-blocker ----------------------------------------------------


async def aged_blocker(
    session: AsyncSession, *, max_age_days: int = 14
) -> list[dict[str, Any]]:
    """Open sub-tasks older than `max_age_days` days."""
    sql = """
    SELECT
      i.issue_key,
      i.parent_key,
      i.summary,
      i.status,
      i.assignee_id,
      EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 86400 AS age_days
    FROM issues i
    WHERE i.removed_at IS NULL
      AND i.issue_type = 'Sub-task'
      AND i.status_category != 'done'
      AND i.updated_at <= NOW() - (INTERVAL '1 day' * :days)
    ORDER BY i.updated_at ASC
    """
    result = await session.execute(text(sql), {"days": max_age_days})
    return [
        {
            "issue_key": r.issue_key,
            "parent_key": r.parent_key,
            "summary": r.summary,
            "status": r.status,
            "assignee_id": r.assignee_id,
            "age_days": int(r.age_days),
        }
        for r in result
    ]


# ---------- epic-risk-regression --------------------------------------------


async def epic_risk_regression(
    session: AsyncSession,
    *,
    team_field: str | None = None,
    team_id: str | None = None,
) -> list[dict[str, Any]]:
    """Epics whose risk band flipped on_track → at_risk vs the previous run.

    Compares against the previous insight_runs row for this rule. On
    first run we have nothing to compare so we return [].
    """
    # Pull current classification.
    current = await classify_epic_risks(
        session, team_field=team_field, team_id=team_id
    )
    current_at_risk = {e.issue_key for e in current if e.risk_band == "at_risk"}

    # Previous successful run's payload.
    prev = (
        await session.execute(
            select(InsightRun.payload)
            .where(
                InsightRun.rule_id == "epic-risk-regression",
                InsightRun.status == "ok",
            )
            .order_by(desc(InsightRun.started_at))
            .limit(1)
        )
    ).scalar_one_or_none()

    if not prev or "previous_at_risk" not in (prev or {}):
        # Bootstrap: store current at-risk set, no firings yet.
        return []

    previously_at_risk = set((prev or {}).get("previous_at_risk", []))
    # Also need previously_classified (to know which epics were on_track).
    previously_on_track = set((prev or {}).get("previous_on_track", []))

    # Newly at_risk = at_risk now AND not at_risk before AND was on_track before.
    flipped = []
    for e in current:
        if e.risk_band != "at_risk":
            continue
        if e.issue_key in previously_at_risk:
            continue
        if e.issue_key not in previously_on_track:
            # Was something else (watch, done, or unknown) — not a regression.
            continue
        flipped.append(
            {
                "issue_key": e.issue_key,
                "summary": e.summary,
                "owner_display_name": e.owner_display_name,
                "due_date": e.due_date.isoformat() if e.due_date else None,
                "risk_reasons": e.risk_reasons,
            }
        )

    # Stash the snapshots in the new payload too — caller writes them back.
    return [
        {
            **f,
            "_snapshot_current_at_risk": list(current_at_risk),
            "_snapshot_current_on_track": [
                e.issue_key for e in current if e.risk_band == "on_track"
            ],
        }
        for f in flipped
    ] or [
        {
            "_meta_only": True,
            "_snapshot_current_at_risk": list(current_at_risk),
            "_snapshot_current_on_track": [
                e.issue_key for e in current if e.risk_band == "on_track"
            ],
        }
    ]


# ---------- project-etd-slippage --------------------------------------------


async def project_etd_slippage(
    session: AsyncSession, *, threshold_days: int = 14
) -> list[dict[str, Any]]:
    """Active projects whose ETD shifted > threshold_days vs ~7 days ago.

    Implementation: compare current `list_projects()` ETD-by-velocity per
    active project against the previous insight_runs payload (one run a
    week is enough; we just compare to the last successful run that's at
    least 5 days old).
    """
    from app.metrics.projects import list_projects

    current = await list_projects(session)
    current_active = {
        p.project_name: p.etd_by_velocity for p in current if p.classification == "active"
    }

    cutoff = datetime.now(tz=UTC) - timedelta(days=5)
    prev = (
        await session.execute(
            select(InsightRun.payload, InsightRun.started_at)
            .where(
                InsightRun.rule_id == "project-etd-slippage",
                InsightRun.status == "ok",
                InsightRun.started_at <= cutoff,
            )
            .order_by(desc(InsightRun.started_at))
            .limit(1)
        )
    ).first()

    firings: list[dict[str, Any]] = []
    if prev and prev.payload:
        prev_active = {
            p["project_name"]: p["etd_by_velocity"]
            for p in (prev.payload.get("snapshot") or [])
        }
        for name, current_etd_iso in current_active.items():
            if not current_etd_iso:
                continue
            prev_etd_iso = prev_active.get(name)
            if not prev_etd_iso:
                continue
            from datetime import date as _date

            current_etd = _date.fromisoformat(str(current_etd_iso))
            prev_etd = _date.fromisoformat(str(prev_etd_iso))
            slip_days = (current_etd - prev_etd).days
            if abs(slip_days) >= threshold_days:
                firings.append(
                    {
                        "project_name": name,
                        "previous_etd": prev_etd.isoformat(),
                        "current_etd": current_etd.isoformat(),
                        "slip_days": slip_days,
                    }
                )

    # Always record the current snapshot so the next run has a baseline.
    snapshot = [
        {
            "project_name": name,
            "etd_by_velocity": etd.isoformat() if etd else None,
        }
        for name, etd in current_active.items()
    ]
    if not firings:
        return [{"_meta_only": True, "snapshot": snapshot}]
    return [{**f, "_snapshot": snapshot} for f in firings]


# ---------- runner ---------------------------------------------------------


async def evaluate_anomaly(
    session: AsyncSession,
    rule_id: str,
    config: dict[str, Any],
    team_field: str | None = None,
    team_id: str | None = None,
    region: str = "IN",
) -> list[dict[str, Any]]:
    """Dispatch table. Each anomaly rule gets its config from
    `insight_rules.config` (which is seeded with defaults from the
    registry but is user-mutable)."""
    if rule_id == "velocity-drop":
        return await velocity_drop(
            session,
            threshold=float(config.get("threshold", 0.7)),
            min_history_sprints=int(config.get("min_history_sprints", 3)),
            region=region,
        )
    if rule_id == "stale-carry-over":
        return await stale_carry_over(
            session, min_depth=int(config.get("min_depth", 2))
        )
    if rule_id == "aged-blocker":
        return await aged_blocker(
            session, max_age_days=int(config.get("max_age_days", 14))
        )
    if rule_id == "epic-risk-regression":
        return await epic_risk_regression(
            session, team_field=team_field, team_id=team_id
        )
    if rule_id == "project-etd-slippage":
        return await project_etd_slippage(
            session, threshold_days=int(config.get("threshold_days", 14))
        )
    raise ValueError(f"unknown anomaly rule_id={rule_id}")


async def evaluate_all_anomalies(
    session: AsyncSession,
    *,
    team_field: str | None = None,
    team_id: str | None = None,
    region: str = "IN",
    trigger: str = "auto-post-sync",
) -> int:
    """Run every enabled anomaly rule and persist one insight_runs row each.
    Returns the number of rules evaluated. Failures are logged + recorded
    as `status='failed'`; they do NOT abort the loop."""
    import structlog

    logger = structlog.get_logger(__name__)

    rules = (
        await session.execute(
            select(InsightRule).where(
                InsightRule.kind == "anomaly", InsightRule.enabled.is_(True)
            )
        )
    ).scalars().all()

    evaluated = 0
    now = datetime.now(tz=UTC)
    for r in rules:
        run = InsightRun(
            rule_id=r.id,
            trigger=trigger,
            status="running",
            started_at=now,
        )
        session.add(run)
        await session.flush()
        try:
            firings = await evaluate_anomaly(
                session,
                r.id,
                r.config or {},
                team_field=team_field,
                team_id=team_id,
                region=region,
            )
            run.status = "ok"
            run.finished_at = datetime.now(tz=UTC)
            # Strip any "_meta_only" / "_snapshot*" markers into a separate
            # `meta` slot so the payload's primary "firings" list is clean
            # for downstream rendering.
            cleaned = [f for f in firings if not f.get("_meta_only")]
            meta: dict[str, Any] = {}
            for f in firings:
                for k, v in f.items():
                    if k.startswith("_snapshot") or k == "_meta_only":
                        meta[k.lstrip("_")] = v
            run.payload = {"firings": cleaned, "meta": meta}
        except Exception as e:
            logger.exception("anomaly_evaluation_failed", rule_id=r.id)
            run.status = "failed"
            run.finished_at = datetime.now(tz=UTC)
            run.error_message = str(e)[:500]
        evaluated += 1
    await session.commit()
    return evaluated
