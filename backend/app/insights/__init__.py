"""Insights (v3) — anomaly detection + LLM summaries.

Public API:
- `RULES` — the immutable catalog.
- `seed_rules(session)` — idempotent insert of registry entries into
  `insight_rules`. Called at startup.

See `docs/local-app/insights-llm-rules.md` for the prompt catalog and
`docs/plans/2026-04-30-insights-design.md` for the architecture.
"""

from app.insights.registry import RULES, Rule, seed_rules

__all__ = ["RULES", "Rule", "seed_rules"]
