"""Catalog of all 9 Insights rules.

The list here is the source of truth. `seed_rules()` reconciles
`insight_rules` rows on startup — new rules are inserted; existing rows
are left alone (preserving user's enable/disable choices and any config
overrides).

LLM rules' full prompt + inputs are documented in
`docs/local-app/insights-llm-rules.md` and kept in sync with this
module's `prompt_template` literals.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InsightRule

logger = structlog.get_logger(__name__)

RuleKind = Literal["anomaly", "llm"]


@dataclass(frozen=True, slots=True)
class Rule:
    id: str
    kind: RuleKind
    title: str
    description: str
    # Anomaly rules: thresholds keyed in config_defaults (e.g. {"days": 14}).
    # LLM rules: scope-resolution hints (e.g. {"scope": "most_recent_closed_sprint"}).
    config_defaults: dict
    # LLM-only: pinned prompt version. Bumped when the prompt changes.
    prompt_version: int | None = None
    # LLM-only: stale-after duration (seconds) used by /insights auto-refresh.
    # `None` for anomalies. Sprint-scoped rules use the sentinel
    # `STALE_WHEN_SPRINT_CLOSES` (a sentinel int) — the runner resolves it.
    stale_seconds: int | None = None
    # LLM-only: keys describing which input endpoints/views feed the prompt.
    inputs: tuple[str, ...] = ()


# Sentinel: "stale when the sprint that owns the cached output closes / a
# newer sprint becomes the most-recent-closed". The runner treats this as
# an event trigger, not a clock window.
STALE_WHEN_SPRINT_CLOSES = -1

# Convenience: 7 days in seconds.
_SEVEN_DAYS = 7 * 24 * 3600


# ---------- Anomaly rules ----------------------------------------------------


_ANOMALIES: tuple[Rule, ...] = (
    Rule(
        id="velocity-drop",
        kind="anomaly",
        title="Velocity drop",
        description=(
            "Person whose 1-sprint velocity dropped below 70% of their "
            "6-sprint average. Only flags people with ≥3 sprints of history."
        ),
        config_defaults={"threshold": 0.7, "min_history_sprints": 3},
    ),
    Rule(
        id="stale-carry-over",
        kind="anomaly",
        title="Stale carry-over",
        description=(
            "Same ticket carried into more than 2 sprints in a row."
        ),
        config_defaults={"min_depth": 2},
    ),
    Rule(
        id="aged-blocker",
        kind="anomaly",
        title="Aged blocker",
        description="Sub-task blocker open more than 14 days.",
        config_defaults={"max_age_days": 14},
    ),
    Rule(
        id="epic-risk-regression",
        kind="anomaly",
        title="Epic risk regression",
        description=(
            "Epic that flipped from on_track to at_risk in the latest sync."
        ),
        config_defaults={},
    ),
    Rule(
        id="project-etd-slippage",
        kind="anomaly",
        title="Project ETD slippage",
        description=(
            "Project's ETD-by-velocity shifted more than 14 days vs the "
            "previous week's snapshot."
        ),
        config_defaults={"threshold_days": 14},
    ),
)


# ---------- LLM rules --------------------------------------------------------

# Prompts here MUST stay in sync with docs/local-app/insights-llm-rules.md.
# When you change one, bump the `prompt_version` so historical insight_runs
# rows can be compared cleanly.

_PROMPT_WEEKLY_BRIEFING = """\
You're advising the Search team's tech lead on what to pay attention to
this week. Read the JSON below and produce a concise (~10 bullet)
briefing organised under these headings: Trending up, Trending down,
Stuck. Each bullet must cite specific people, tickets, or epics — no
generic management speak. Surface 1:1 conversation prompts where
warranted (e.g., "consider asking <Person> about <Epic> — velocity
dropped 40% AND they own the epic").

Data:
{inputs}
"""

_PROMPT_RETRO_AGENDA = """\
You're preparing a sprint retrospective for the Search team. Generate
an agenda with these sections:

1. Wins — what went well, with concrete numbers (specific people,
   tickets, completed SP)
2. Misses — what we committed but didn't deliver, and why where the
   data suggests a cause
3. Scope churn — meaningful adds/removes mid-sprint that changed the
   shape of the work
4. Blockers — anything aged that the team should discuss
5. Talking points — 3–5 questions the team should answer in the meeting

Be specific. Cite ticket keys. Don't editorialise — let the data speak.

Sprint: {sprint_name}
Data:
{inputs}
"""

_PROMPT_STAKEHOLDER_UPDATE = """\
Write a 3-paragraph status update for an engineering manager who's
not in the team's daily standups. Structure:

1. What we shipped this sprint — concrete deliverables, SP, anything
   notable.
2. What blocked us / what we missed — without making excuses; cite
   data when you point at causes.
3. What's next — top 1–2 things landing next sprint, plus any risks
   the manager should be aware of.

Keep the tone factual, not promotional. No emoji. No exclamation
marks. ~150 words total.

Sprint: {sprint_name}
Data:
{inputs}
"""

_PROMPT_PROJECT_SUMMARY = """\
Summarise this sprint by project. For each project active in the
sprint, write a short section:

## <project_name>
- What was delivered (with concrete SP, ticket keys, contributors)
- What carried over and why if the data hints at it
- One-line risk callout if anything looks shaky

After the project sections, add a "## Miscellaneous" section with the
same shape, covering tickets in the sprint that don't carry a
proj_* label.

End with a one-paragraph bottom line ("## Bottom line") summarising
the sprint shape across projects.

Plain Markdown. ~50 words per project. Cite ticket keys in backticks.

Sprint: {sprint_name}
Data:
{inputs}
"""


_LLMS: tuple[Rule, ...] = (
    Rule(
        id="weekly-briefing",
        kind="llm",
        title="Weekly briefing",
        description="Lead's Monday self-briefing — trending up / down / stuck.",
        config_defaults={"scope": "team_wide"},
        prompt_version=1,
        stale_seconds=_SEVEN_DAYS,
        inputs=("sprint-rollup-recent", "velocity-deltas", "epic-risk-open", "stale-carry-over-top"),
    ),
    Rule(
        id="retro-agenda",
        kind="llm",
        title="Retro agenda",
        description="Sprint-scoped retro prep — wins / misses / churn / blockers / talking points.",
        config_defaults={"scope": "most_recent_closed_sprint"},
        prompt_version=1,
        stale_seconds=STALE_WHEN_SPRINT_CLOSES,
        inputs=("sprint-rollup", "scope-changes-for-sprint", "blockers-aged", "carry-over"),
    ),
    Rule(
        id="stakeholder-update",
        kind="llm",
        title="Stakeholder update",
        description="3-paragraph manager-facing status. Sprint-scoped.",
        config_defaults={"scope": "most_recent_closed_sprint"},
        prompt_version=1,
        stale_seconds=STALE_WHEN_SPRINT_CLOSES,
        inputs=("sprint-rollup", "epic-risk-counts", "project-etd-slippage"),
    ),
    Rule(
        id="project-summary",
        kind="llm",
        title="Sprint by project",
        description=(
            "Per-project rollup for a sprint plus a Miscellaneous bucket "
            "for tickets without a proj_* label."
        ),
        config_defaults={"scope": "most_recent_closed_sprint"},
        prompt_version=1,
        stale_seconds=STALE_WHEN_SPRINT_CLOSES,
        inputs=("sprint-rollup", "sprint-by-project-breakdown", "sprint-miscellaneous"),
    ),
)


# Mapping rule id → prompt template, kept here so the registry stays the
# single source of truth without bloating the dataclass.
PROMPTS: dict[str, str] = {
    "weekly-briefing": _PROMPT_WEEKLY_BRIEFING,
    "retro-agenda": _PROMPT_RETRO_AGENDA,
    "stakeholder-update": _PROMPT_STAKEHOLDER_UPDATE,
    "project-summary": _PROMPT_PROJECT_SUMMARY,
}


RULES: tuple[Rule, ...] = _ANOMALIES + _LLMS


def by_id(rule_id: str) -> Rule | None:
    for r in RULES:
        if r.id == rule_id:
            return r
    return None


# ---------- Seeding ----------------------------------------------------------


async def seed_rules(session: AsyncSession) -> int:
    """Insert any registry entries missing from `insight_rules`. Existing
    rows are left alone — toggle state and config overrides are preserved.

    Returns the count of new rows inserted (0 on subsequent runs).
    """
    existing = {
        rid for (rid,) in (
            await session.execute(select(InsightRule.id))
        ).all()
    }
    inserted = 0
    for rule in RULES:
        if rule.id in existing:
            continue
        # Disable stakeholder-update by default — user explicitly chose
        # it as off in the brainstorm. Other rules default to enabled.
        default_enabled = rule.id != "stakeholder-update"
        await session.execute(
            pg_insert(InsightRule)
            .values(
                id=rule.id,
                kind=rule.kind,
                enabled=default_enabled,
                config=rule.config_defaults,
            )
            .on_conflict_do_nothing(index_elements=[InsightRule.id])
        )
        inserted += 1
    if inserted:
        await session.commit()
        logger.info("insight_rules_seeded", count=inserted)
    return inserted
