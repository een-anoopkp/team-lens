"""Insights endpoints (v3).

Two surfaces:
  - /insights/feed — read surface for the /insights page.
  - /insights/rules — list + per-rule actions for /insights/rules.

Stale LLM rules trigger a background re-run on read; the feed reports
those as `state="running"` and the frontend polls.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session, get_session_factory
from app.insights.freshness import is_stale, latest_ok_run
from app.insights.llm import evaluate_all_enabled_llm, evaluate_llm_rule
from app.insights.registry import RULES, by_id
from app.models import InsightRule, InsightRun

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


# ---------- DTOs -----------------------------------------------------------


class AnomalyCard(BaseModel):
    rule_id: str
    title: str
    description: str
    enabled: bool
    last_run_at: datetime | None
    last_run_status: str | None
    firings: list[dict[str, Any]]
    firing_rate_recent: str | None  # e.g. "3 / 4 syncs"


class LLMCard(BaseModel):
    rule_id: str
    title: str
    description: str
    enabled: bool
    state: Literal["fresh", "running", "off", "failed", "key-missing", "no-output"]
    last_run_at: datetime | None
    body_md: str | None
    scope_label: str | None  # human-readable scope, e.g. "Search 2026-08"
    error_message: str | None


class InsightsFeed(BaseModel):
    anomalies: list[AnomalyCard]
    summaries: list[LLMCard]
    last_anomaly_eval_at: datetime | None
    queued_runs: list[str]  # rule_ids whose stale re-runs were just queued


class RuleRow(BaseModel):
    id: str
    kind: str
    title: str
    description: str
    enabled: bool
    config: dict[str, Any]
    last_run_at: datetime | None
    last_run_status: str | None
    last_firings_count: int | None  # anomaly only
    last_tokens: int | None  # llm only (sum in+out)
    prompt_version: int | None


class RulesList(BaseModel):
    rules: list[RuleRow]


class TogglePayload(BaseModel):
    enabled: bool


class RunForPayload(BaseModel):
    scope: dict[str, Any]


class SpendSummary(BaseModel):
    days: int
    total_runs: int
    tokens_in: int
    tokens_out: int


# ---------- Feed -----------------------------------------------------------


@router.get("/feed", response_model=InsightsFeed)
async def feed(
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> InsightsFeed:
    """The /insights read surface. Builds anomaly + LLM cards from the
    latest insight_runs rows. For stale (or never-run) LLM rules whose
    rule is enabled, queues a background re-run."""
    settings = get_settings()

    rules_by_id = {
        r.id: r
        for r in (await session.execute(select(InsightRule))).scalars().all()
    }

    anomalies: list[AnomalyCard] = []
    summaries: list[LLMCard] = []
    queued: list[str] = []
    most_recent_anom: datetime | None = None

    for rule in RULES:
        rule_state = rules_by_id.get(rule.id)
        enabled = bool(rule_state and rule_state.enabled)
        latest = await latest_ok_run(session, rule.id)

        if rule.kind == "anomaly":
            firings: list[dict[str, Any]] = []
            if latest and latest.payload:
                firings = latest.payload.get("firings", [])

            # Firing-rate trend across last 4 successful runs.
            recent = (
                await session.execute(
                    select(InsightRun)
                    .where(
                        InsightRun.rule_id == rule.id,
                        InsightRun.status == "ok",
                    )
                    .order_by(desc(InsightRun.started_at))
                    .limit(4)
                )
            ).scalars().all()
            with_firings = sum(
                1 for r in recent
                if r.payload and r.payload.get("firings")
            )
            firing_rate_recent = (
                f"{with_firings} / {len(recent)} syncs" if recent else None
            )

            if latest and (most_recent_anom is None or latest.started_at > most_recent_anom):
                most_recent_anom = latest.started_at

            anomalies.append(
                AnomalyCard(
                    rule_id=rule.id,
                    title=rule.title,
                    description=rule.description,
                    enabled=enabled,
                    last_run_at=latest.started_at if latest else None,
                    last_run_status=latest.status if latest else None,
                    firings=firings if enabled else [],
                    firing_rate_recent=firing_rate_recent,
                )
            )

        elif rule.kind == "llm":
            # Pick the LATEST run regardless of status, so we can show
            # 'failed' / 'key-missing' states; latest_ok_run only tells us
            # if there's a usable cached body.
            latest_any = (
                await session.execute(
                    select(InsightRun)
                    .where(InsightRun.rule_id == rule.id)
                    .order_by(desc(InsightRun.started_at))
                    .limit(1)
                )
            ).scalar_one_or_none()

            scope_label = _format_scope(latest.scope) if latest else None

            state: str
            if not enabled:
                state = "off"
            elif not settings.anthropic_api_key:
                state = "key-missing"
            elif latest_any and latest_any.status == "running":
                state = "running"
            elif latest_any and latest_any.status == "failed" and not latest:
                state = "failed"
            elif latest is None:
                state = "no-output"
            else:
                state = "fresh"

            # Trigger background re-run when stale + enabled + key configured.
            if (
                enabled
                and settings.anthropic_api_key
                and state not in ("running",)
                and await is_stale(session, rule, latest)
            ):
                background.add_task(_run_llm_in_background, rule.id, "auto-stale")
                queued.append(rule.id)
                if state in ("fresh", "no-output"):
                    state = "running"

            summaries.append(
                LLMCard(
                    rule_id=rule.id,
                    title=rule.title,
                    description=rule.description,
                    enabled=enabled,
                    state=state,  # type: ignore[arg-type]
                    last_run_at=latest.started_at if latest else None,
                    body_md=latest.body_md if latest else None,
                    scope_label=scope_label,
                    error_message=(
                        latest_any.error_message
                        if latest_any and latest_any.status == "failed"
                        else None
                    ),
                )
            )

    return InsightsFeed(
        anomalies=anomalies,
        summaries=summaries,
        last_anomaly_eval_at=most_recent_anom,
        queued_runs=queued,
    )


# ---------- Rules list + actions ------------------------------------------


@router.get("/rules", response_model=RulesList)
async def list_rules(
    session: AsyncSession = Depends(get_session),
) -> RulesList:
    rules_by_id = {
        r.id: r
        for r in (await session.execute(select(InsightRule))).scalars().all()
    }
    out: list[RuleRow] = []
    for rule in RULES:
        state = rules_by_id.get(rule.id)
        latest = (
            await session.execute(
                select(InsightRun)
                .where(InsightRun.rule_id == rule.id)
                .order_by(desc(InsightRun.started_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        last_firings = None
        if rule.kind == "anomaly" and latest and latest.payload:
            last_firings = len(latest.payload.get("firings", []))
        last_tokens = None
        if rule.kind == "llm" and latest:
            last_tokens = (latest.tokens_in or 0) + (latest.tokens_out or 0)
        out.append(
            RuleRow(
                id=rule.id,
                kind=rule.kind,
                title=rule.title,
                description=rule.description,
                enabled=bool(state and state.enabled),
                config=(state.config if state else dict(rule.config_defaults)),
                last_run_at=latest.started_at if latest else None,
                last_run_status=latest.status if latest else None,
                last_firings_count=last_firings,
                last_tokens=last_tokens,
                prompt_version=rule.prompt_version,
            )
        )
    return RulesList(rules=out)


@router.patch("/rules/{rule_id}", status_code=204)
async def toggle_rule(
    rule_id: str,
    payload: TogglePayload,
    session: AsyncSession = Depends(get_session),
) -> None:
    rule = by_id(rule_id)
    if rule is None:
        raise HTTPException(404, {"error": "not_found", "message": f"unknown rule_id={rule_id}"})
    state = (
        await session.execute(
            select(InsightRule).where(InsightRule.id == rule_id)
        )
    ).scalar_one_or_none()
    if state is None:
        raise HTTPException(404, {"error": "not_found", "message": "rule row missing — restart to seed"})
    state.enabled = bool(payload.enabled)
    state.updated_at = datetime.now(tz=UTC)
    await session.commit()


@router.post("/rules/{rule_id}/run", status_code=202)
async def run_one(
    rule_id: str,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    rule = by_id(rule_id)
    if rule is None or rule.kind != "llm":
        raise HTTPException(404, {"error": "not_found", "message": "no LLM rule with that id"})
    background.add_task(_run_llm_in_background, rule_id, "manual")
    return {"queued": rule_id}


@router.post("/rules/{rule_id}/run-for", status_code=202)
async def run_for(
    rule_id: str,
    payload: RunForPayload,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    rule = by_id(rule_id)
    if rule is None or rule.kind != "llm":
        raise HTTPException(404, {"error": "not_found", "message": "no LLM rule with that id"})
    background.add_task(
        _run_llm_in_background, rule_id, "manual-run-for", payload.scope
    )
    return {"queued": rule_id}


@router.post("/run-all-enabled", status_code=202)
async def run_all_enabled(
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> dict[str, list[str]]:
    rules = (
        await session.execute(
            select(InsightRule).where(
                InsightRule.kind == "llm", InsightRule.enabled.is_(True)
            )
        )
    ).scalars().all()
    queued = [r.id for r in rules]
    for rid in queued:
        background.add_task(_run_llm_in_background, rid, "manual")
    return {"queued": queued}


# ---------- Spend summary --------------------------------------------------


@router.get("/spend", response_model=SpendSummary)
async def spend_summary(
    days: int = 30,
    session: AsyncSession = Depends(get_session),
) -> SpendSummary:
    cutoff = datetime.now(tz=UTC) - timedelta(days=days)
    row = (
        await session.execute(
            select(
                func.count(InsightRun.id),
                func.coalesce(func.sum(InsightRun.tokens_in), 0),
                func.coalesce(func.sum(InsightRun.tokens_out), 0),
            ).where(
                InsightRun.started_at >= cutoff,
                InsightRun.tokens_in.is_not(None),
            )
        )
    ).one()
    return SpendSummary(
        days=days,
        total_runs=int(row[0] or 0),
        tokens_in=int(row[1] or 0),
        tokens_out=int(row[2] or 0),
    )


# ---------- Run history ----------------------------------------------------


class RunHistoryRow(BaseModel):
    id: int
    rule_id: str
    trigger: str
    status: str
    scope: dict[str, Any] | None
    started_at: datetime
    finished_at: datetime | None
    firings_count: int | None
    tokens_in: int | None
    tokens_out: int | None
    error_message: str | None


@router.get("/history", response_model=list[RunHistoryRow])
async def history(
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
) -> list[RunHistoryRow]:
    rows = (
        await session.execute(
            select(InsightRun).order_by(desc(InsightRun.started_at)).limit(limit)
        )
    ).scalars().all()
    out: list[RunHistoryRow] = []
    for r in rows:
        firings_count = None
        if r.payload and isinstance(r.payload, dict):
            firings_count = len(r.payload.get("firings", []) or [])
        out.append(
            RunHistoryRow(
                id=r.id,
                rule_id=r.rule_id,
                trigger=r.trigger,
                status=r.status,
                scope=r.scope,
                started_at=r.started_at,
                finished_at=r.finished_at,
                firings_count=firings_count,
                tokens_in=r.tokens_in,
                tokens_out=r.tokens_out,
                error_message=r.error_message,
            )
        )
    return out


# ---------- helpers --------------------------------------------------------


def _format_scope(scope: dict[str, Any] | None) -> str | None:
    if not scope:
        return None
    if "sprint_id" in scope:
        return f"sprint #{scope['sprint_id']}"
    if "project" in scope:
        return f"project {scope['project']}"
    return None


async def _run_llm_in_background(
    rule_id: str,
    trigger: str,
    scope: dict[str, Any] | None = None,
) -> None:
    """FastAPI BackgroundTasks runs this with its own session. We open one
    explicitly because the request session is closed by the time we run."""
    try:
        async with get_session_factory()() as session:
            await evaluate_llm_rule(
                session, rule_id, scope_override=scope, trigger=trigger
            )
    except Exception:
        logger.exception("background_llm_run_failed", rule_id=rule_id)
