"""LLM runner for Insights summary rules.

Pipeline:
  1. resolve_scope(rule, override) → concrete dict (e.g. {"sprint_id": 18279}).
  2. gather_inputs(rule, scope) → dict of JSON-serialisable data slices
     specific to that rule.
  3. render_prompt(rule, scope, inputs) → prompt string.
  4. call_anthropic(prompt) → body_md, tokens_in, tokens_out.
  5. caller persists insight_runs row.

The runner is invoked in three contexts (all routed through
`evaluate_llm_rule`):
  - 'auto-stale' — /insights detected the latest run is stale.
  - 'manual' — user clicked "Run all enabled" or single-rule "Run".
  - 'manual-run-for' — user clicked "Run for…" with a non-default scope.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.insights.registry import (
    PROMPTS,
    STALE_WHEN_SPRINT_CLOSES,
    Rule,
    by_id,
)
from app.models import InsightRule, InsightRun, Sprint

logger = structlog.get_logger(__name__)


class LLMNotConfigured(RuntimeError):
    pass


# ---------- 1. Scope resolution --------------------------------------------


async def resolve_scope(
    session: AsyncSession, rule: Rule, override: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Pick a concrete scope dict for this rule.

    `override` (e.g. {"sprint_id": 18279}) wins; otherwise we apply the
    rule's `config_defaults["scope"]` keyword.
    """
    if override:
        return override

    keyword = (rule.config_defaults or {}).get("scope")
    if keyword == "team_wide":
        return {}
    if keyword == "most_recent_closed_sprint":
        sprint_id = await _most_recent_closed_sprint_id(session)
        if sprint_id is None:
            raise ValueError("no closed sprints in DB yet — run a sync first")
        return {"sprint_id": sprint_id}
    return {}


async def _most_recent_closed_sprint_id(session: AsyncSession) -> int | None:
    row = (
        await session.execute(
            select(Sprint.sprint_id)
            .where(Sprint.state == "closed")
            .order_by(desc(Sprint.start_date))
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


# ---------- 2. Input gathering ---------------------------------------------


async def gather_inputs(
    session: AsyncSession, rule: Rule, scope: dict[str, Any], settings: Settings
) -> dict[str, Any]:
    """Pull the data slices each rule needs. Each branch is intentionally
    explicit so we can tune what Claude sees per rule."""
    if rule.id == "weekly-briefing":
        return await _gather_weekly_briefing(session, settings)
    if rule.id == "retro-agenda":
        return await _gather_retro_agenda(session, scope, settings)
    if rule.id == "stakeholder-update":
        return await _gather_stakeholder_update(session, scope, settings)
    if rule.id == "project-summary":
        return await _gather_project_summary(session, scope, settings)
    raise ValueError(f"no input gatherer for rule_id={rule.id}")


async def _gather_weekly_briefing(
    session: AsyncSession, settings: Settings
) -> dict[str, Any]:
    from app.metrics.epic_risk import classify_epic_risks
    from app.metrics.velocity import velocity_for_sprint_window

    velocity = await velocity_for_sprint_window(
        session, sprint_window=4, person_account_id=None, region=settings.team_region
    )
    epics = await classify_epic_risks(
        session,
        team_field=settings.jira_team_field,
        team_id=settings.jira_team_value or None,
    )
    open_epics = [
        {
            "issue_key": e.issue_key,
            "summary": e.summary,
            "owner": e.owner_display_name,
            "due_date": e.due_date.isoformat() if e.due_date else None,
            "risk_band": e.risk_band,
            "risk_reasons": e.risk_reasons,
        }
        for e in epics
        if e.risk_band in ("at_risk", "watch")
    ]
    # Top 5 stale carry-overs.
    from app.insights.anomalies import stale_carry_over

    stale = await stale_carry_over(session, min_depth=2)
    stale = sorted(stale, key=lambda x: -x["depth"])[:5]

    return {
        "velocity_last_4_sprints": [
            {
                "sprint": v.sprint_name,
                "person": v.person_display_name,
                "committed_sp": _to_jsonable(v.committed_sp),
                "completed_sp": _to_jsonable(v.completed_sp),
                "velocity": _to_jsonable(v.velocity),
            }
            for v in velocity
        ],
        "open_at_risk_or_watch_epics": open_epics,
        "top_stale_carry_overs": stale,
    }


async def _gather_retro_agenda(
    session: AsyncSession, scope: dict[str, Any], settings: Settings
) -> dict[str, Any]:
    sprint_id = int(scope["sprint_id"])
    sprint = (
        await session.execute(
            select(Sprint).where(Sprint.sprint_id == sprint_id)
        )
    ).scalar_one()

    from app.metrics.blockers import blockers_for_sprint
    from app.metrics.carry_over import carry_over_for_sprint
    from app.metrics.sprint_rollup import sprint_rollup

    rollup = await sprint_rollup(session, sprint_id=sprint_id, region=settings.team_region)
    blockers = await blockers_for_sprint(session, sprint_id=sprint_id)
    carry_over = await carry_over_for_sprint(session, sprint_id=sprint_id)

    return {
        "sprint_name": sprint.name,
        "rollup": _model_to_dict(rollup),
        "aged_blockers": [_model_to_dict(b) for b in blockers],
        "carry_over": [_model_to_dict(c) for c in carry_over],
    }


async def _gather_stakeholder_update(
    session: AsyncSession, scope: dict[str, Any], settings: Settings
) -> dict[str, Any]:
    sprint_id = int(scope["sprint_id"])
    sprint = (
        await session.execute(
            select(Sprint).where(Sprint.sprint_id == sprint_id)
        )
    ).scalar_one()

    from app.metrics.epic_risk import classify_epic_risks
    from app.metrics.sprint_rollup import sprint_rollup

    rollup = await sprint_rollup(session, sprint_id=sprint_id, region=settings.team_region)
    epics = await classify_epic_risks(
        session,
        team_field=settings.jira_team_field,
        team_id=settings.jira_team_value or None,
    )
    risk_counts: dict[str, int] = {}
    for e in epics:
        risk_counts[e.risk_band] = risk_counts.get(e.risk_band, 0) + 1

    return {
        "sprint_name": sprint.name,
        "rollup": _model_to_dict(rollup),
        "epic_risk_counts": risk_counts,
    }


async def _gather_project_summary(
    session: AsyncSession, scope: dict[str, Any], settings: Settings
) -> dict[str, Any]:
    """Sprint-scoped: per-project breakdown + miscellaneous bucket."""
    sprint_id = int(scope["sprint_id"])
    sprint = (
        await session.execute(
            select(Sprint).where(Sprint.sprint_id == sprint_id)
        )
    ).scalar_one()

    from app.models import Epic, Issue, IssueSprint
    from app.sync.projects import extract_project_labels

    # All issues in this sprint, non-removed.
    issues = (
        await session.execute(
            select(Issue)
            .join(IssueSprint, IssueSprint.issue_key == Issue.issue_key)
            .where(IssueSprint.sprint_id == sprint_id, Issue.removed_at.is_(None))
        )
    ).scalars().all()

    epic_keys = {i.epic_key for i in issues if i.epic_key}
    epics = []
    if epic_keys:
        epics = (
            await session.execute(select(Epic).where(Epic.issue_key.in_(epic_keys)))
        ).scalars().all()

    # epic_key → list[project_label]
    epic_to_projects: dict[str, list[str]] = {
        e.issue_key: extract_project_labels(e.raw_payload) for e in epics
    }

    # Bucket issues by project (or miscellaneous).
    by_project: dict[str, list] = {}
    misc: list = []
    for i in issues:
        labels = epic_to_projects.get(i.epic_key or "", [])
        if labels:
            for proj in labels:
                by_project.setdefault(proj, []).append(i)
        else:
            misc.append(i)

    def _summarise_bucket(items: list) -> dict[str, Any]:
        non_sub = [i for i in items if i.issue_type != "Sub-task"]
        sp_total = sum(
            (Decimal(str(i.story_points)) for i in non_sub if i.story_points is not None),
            Decimal("0"),
        )
        sp_done = sum(
            (
                Decimal(str(i.story_points))
                for i in non_sub
                if i.story_points is not None and i.status_category == "done"
            ),
            Decimal("0"),
        )
        contributors: dict[str, int] = {}
        for i in non_sub:
            if i.assignee_id and i.status_category == "done" and i.story_points:
                contributors[i.assignee_id] = (
                    contributors.get(i.assignee_id, 0) + int(i.story_points or 0)
                )
        return {
            "ticket_count": len(items),
            "sp_total": _to_jsonable(sp_total),
            "sp_done": _to_jsonable(sp_done),
            "tickets_done": [
                {"issue_key": i.issue_key, "summary": i.summary, "sp": _to_jsonable(i.story_points)}
                for i in non_sub
                if i.status_category == "done"
            ][:10],
            "tickets_carried": [
                {"issue_key": i.issue_key, "summary": i.summary, "sp": _to_jsonable(i.story_points)}
                for i in non_sub
                if i.status_category != "done"
            ][:10],
            "top_contributors_by_sp_done": sorted(
                contributors.items(), key=lambda x: -x[1]
            )[:3],
        }

    return {
        "sprint_name": sprint.name,
        "projects": {name: _summarise_bucket(items) for name, items in by_project.items()},
        "miscellaneous": _summarise_bucket(misc),
    }


# ---------- 3. Prompt rendering --------------------------------------------


def render_prompt(rule: Rule, scope: dict[str, Any], inputs: dict[str, Any]) -> str:
    template = PROMPTS.get(rule.id)
    if template is None:
        raise ValueError(f"no prompt template for rule_id={rule.id}")
    inputs_json = json.dumps(inputs, default=_to_jsonable, indent=2)
    sprint_name = inputs.get("sprint_name", "")
    return template.format(inputs=inputs_json, sprint_name=sprint_name)


# ---------- 4. Anthropic call ----------------------------------------------


async def call_anthropic(
    prompt: str, *, settings: Settings, max_tokens: int
) -> tuple[str, int, int]:
    """Returns (body_md, tokens_in, tokens_out). Raises on error."""
    if not settings.anthropic_api_key:
        raise LLMNotConfigured(
            "ANTHROPIC_API_KEY is not set. Add it to .env to enable LLM rules."
        )

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    body = "".join(
        block.text for block in msg.content if getattr(block, "type", "") == "text"
    )
    usage = msg.usage
    return body, int(usage.input_tokens), int(usage.output_tokens)


# ---------- 5. Top-level orchestration -------------------------------------


# Per-rule output token ceilings, mirroring the catalog.
_OUTPUT_BUDGETS = {
    "weekly-briefing": 1500,
    "retro-agenda": 2000,
    "stakeholder-update": 600,
    "project-summary": 2000,
}


async def evaluate_llm_rule(
    session: AsyncSession,
    rule_id: str,
    *,
    scope_override: dict[str, Any] | None = None,
    trigger: str = "manual",
) -> int:
    """Run one LLM rule end-to-end. Returns the insight_runs.id.

    Always writes a row — `status='ok'` on success, `status='failed'` on
    error. Caller can read `body_md` / `error_message` from the row.
    """
    rule = by_id(rule_id)
    if rule is None:
        raise ValueError(f"unknown rule_id={rule_id}")
    if rule.kind != "llm":
        raise ValueError(f"rule_id={rule_id} is not an LLM rule")

    settings = get_settings()
    started_at = datetime.now(tz=UTC)
    run = InsightRun(
        rule_id=rule_id,
        trigger=trigger,
        scope=scope_override or None,
        status="running",
        started_at=started_at,
        prompt_version=rule.prompt_version,
    )
    session.add(run)
    await session.flush()

    try:
        scope = await resolve_scope(session, rule, scope_override)
        run.scope = scope or None
        inputs = await gather_inputs(session, rule, scope, settings)
        prompt = render_prompt(rule, scope, inputs)
        body, tin, tout = await call_anthropic(
            prompt,
            settings=settings,
            max_tokens=_OUTPUT_BUDGETS.get(rule_id, 1500),
        )
        run.body_md = body
        run.tokens_in = tin
        run.tokens_out = tout
        run.status = "ok"
        run.finished_at = datetime.now(tz=UTC)
    except LLMNotConfigured as e:
        run.status = "failed"
        run.error_message = f"key-missing: {e}"
        run.finished_at = datetime.now(tz=UTC)
    except Exception as e:
        logger.exception("llm_evaluation_failed", rule_id=rule_id)
        run.status = "failed"
        run.error_message = str(e)[:1000]
        run.finished_at = datetime.now(tz=UTC)
    await session.commit()
    return run.id


async def evaluate_all_enabled_llm(
    session: AsyncSession, *, trigger: str = "manual"
) -> list[int]:
    """Run every enabled LLM rule with its default scope. Returns list of run ids."""
    rules = (
        await session.execute(
            select(InsightRule).where(
                InsightRule.kind == "llm", InsightRule.enabled.is_(True)
            )
        )
    ).scalars().all()
    run_ids: list[int] = []
    for r in rules:
        rid = await evaluate_llm_rule(session, r.id, trigger=trigger)
        run_ids.append(rid)
    return run_ids


# ---------- helpers --------------------------------------------------------


def _to_jsonable(v: Any) -> Any:
    """json.dumps `default=` callback. Handles every shape we hit in the
    metrics modules: Decimal, datetime/date, dataclass (slots or not),
    Pydantic model, raw dict / list, etc. Falls back to str() so we
    never raise — failure modes here would manifest as 'Circular
    reference detected' and we don't want to mask a real bug behind one.
    """
    import dataclasses

    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        return dataclasses.asdict(v)
    if hasattr(v, "model_dump"):
        return v.model_dump()
    if isinstance(v, (list, tuple, set)):
        return [_to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _to_jsonable(x) for k, x in v.items()}
    return str(v)


def _model_to_dict(obj: Any) -> dict[str, Any]:
    """Convert a dataclass / Pydantic / row-like into a plain dict that
    json.dumps can swallow. Built on top of `_to_jsonable` for nested
    values."""
    import dataclasses

    if obj is None:
        return {}
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if hasattr(obj, "model_dump"):
        return {k: _to_jsonable(v) for k, v in obj.model_dump().items()}
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if hasattr(obj, "__dict__"):
        return {
            k: _to_jsonable(v)
            for k, v in obj.__dict__.items()
            if not k.startswith("_")
        }
    return {"value": _to_jsonable(obj)}
