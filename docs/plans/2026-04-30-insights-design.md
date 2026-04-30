# Insights (v3) — Design

**Status:** approved 2026-04-30 via brainstorm session.
**Scope:** the `/insights` page + the `/insights/rules` page. Closes the
last v3 placeholder in the nav.

---

## What Insights does

Two surfaces:

- **`/insights`** — the **read** surface. Shows current anomalies (auto-run
  after every sync) and the latest LLM-generated summaries (auto-refreshed
  when stale). No buttons, no scope pickers, no scrubber. The page is
  something you read; the system gave you the freshest version it could.

- **`/insights/rules`** — the **config + production** surface. Toggle each
  rule on/off, run all enabled at once, run an LLM rule for a non-default
  scope ("Run for…"), see the run history, manage the Anthropic API key.

Two capabilities behind those surfaces:

1. **Anomaly detection** — five SQL-only rules that fire after every sync.
   Cheap (no LLM). History is retained for 90 days so trends like "fired
   3 of last 4 syncs" can be computed.
2. **LLM summarisation** — four Claude-powered rules that auto-refresh when
   their cached output is stale. Each rule runs against a smart default
   scope; non-default runs go through "Run for…" on the Rules page.

---

## The nine rules

### Anomaly rules (SQL · auto after sync)

| id                    | Threshold                              | Notes                                                      |
| --------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `velocity-drop`       | person `< 0.7 ×` 6-sprint avg          | Only flags people with ≥3 sprints of history.              |
| `stale-carry-over`    | depth ≥ 2 sprints                      | Same ticket carried into >2 sprints in a row.              |
| `aged-blocker`        | sub-task open > 14 d                   | Same definition as Sprint Health blockers panel.           |
| `epic-risk-regression`| `on_track` → `at_risk` in latest sync  | Looks at the previous sync's classification snapshot.      |
| `project-etd-slippage`| project ETD shifted > 14 d vs last week| Reads from `project_snapshots` weekly checkpoints.          |

### LLM rules (Claude · auto-refresh stale)

Full prompts + inputs + token budgets live in
[`insights-llm-rules.md`](../local-app/insights-llm-rules.md). Summary:

| id                   | Default scope               | Stale after        | Token budget        |
| -------------------- | --------------------------- | ------------------ | ------------------- |
| `weekly-briefing`    | (none — whole team)         | 7 d                | 1.5K out / 3K in    |
| `retro-agenda`       | most-recent closed sprint   | when sprint closes | 2K out / 4K in      |
| `stakeholder-update` | most-recent closed sprint   | when sprint closes | 0.6K out / 2.5K in  |
| `project-summary`    | most-recent closed sprint   | when sprint closes | 2K out / 5K in      |

`project-summary` is **sprint-scoped**, not project-scoped — its output
is multi-section Markdown with one `## <project>` block per project
active in the sprint, plus a `## Miscellaneous` block for sprint
tickets whose epics carry no `proj_*` label, plus a `## Bottom line`
synthesis paragraph.

---

## Architecture

### New tables (Alembic migration `20260430_0003_insights`)

```sql
-- Rule registry. Hardcoded in code; this table just persists toggle state.
CREATE TABLE insight_rules (
  id            text PRIMARY KEY,            -- 'velocity-drop', 'weekly-briefing', ...
  kind          text NOT NULL,               -- 'anomaly' | 'llm'
  enabled       boolean NOT NULL DEFAULT true,
  config        jsonb NOT NULL DEFAULT '{}', -- thresholds for anomalies; default scope overrides for LLM
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per evaluation. Anomalies write a row per sync; LLM rules write
-- a row per Run-for invocation.
CREATE TABLE insight_runs (
  id              bigserial PRIMARY KEY,
  rule_id         text NOT NULL REFERENCES insight_rules(id),
  trigger         text NOT NULL,             -- 'auto-post-sync' | 'auto-stale' | 'manual' | 'manual-run-for'
  scope           jsonb,                     -- {'sprint_id': 18279} or {'project': 'poi1'} or null
  status          text NOT NULL,             -- 'ok' | 'failed' | 'running'
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  -- Anomaly output: list of firings as JSON (issue_keys, magnitudes, etc.)
  -- LLM output: rendered Markdown body in `body_md`, and prompt_version for traceability
  payload         jsonb,                     -- structured anomaly findings (anomalies only)
  body_md         text,                      -- Markdown narrative (LLM only)
  prompt_version  integer,                   -- version of the prompt used (LLM only)
  tokens_in       integer,                   -- (LLM only)
  tokens_out      integer,                   -- (LLM only)
  error_message   text
);
CREATE INDEX insight_runs_rule_started_idx ON insight_runs(rule_id, started_at DESC);
CREATE INDEX insight_runs_status_idx ON insight_runs(status);
```

A retention job (cron, daily) deletes `insight_runs` rows older than 90
days, mirroring how `sync_runs` retention works.

### Backend module: `app/insights/`

```
app/insights/
├── __init__.py
├── registry.py         # static catalog of all 9 rules + their config defaults
├── anomalies.py        # 5 SQL rules; one function per rule, all importable
├── llm.py              # Claude client wrapper + prompt rendering + token accounting
├── runner.py           # evaluate_rule(rule_id, scope, trigger) — single entry point
└── retention.py        # daily cleanup of insight_runs older than 90 days
```

`registry.py` is the source of truth for the rule list. Each entry:

```python
@dataclass(frozen=True)
class Rule:
    id: str                      # 'velocity-drop'
    kind: Literal["anomaly", "llm"]
    title: str                   # human-readable
    description: str             # one-liner shown on /insights/rules
    config_defaults: dict        # thresholds (anomaly) or scope picker (llm)
    fn: Callable | None          # for anomaly: SQL-only callable; None for LLM
    prompt_template: str | None  # for LLM only
    prompt_version: int | None   # for LLM only
    stale_seconds: int | None    # for LLM only; controls auto-refresh on /insights load
    inputs: tuple[str, ...]      # endpoint slugs the LLM rule consumes (for the catalog)
```

`registry.RULES` is the immutable list. Adding a new rule means adding a
new entry here + a corresponding section in `insights-llm-rules.md`.
Migration `0003` seeds `insight_rules` rows for each registry entry on
first apply; ongoing changes are detected by id and reconciled at startup
(new rules → insert; missing rules → leave existing rows alone for history).

### Wiring into the existing app

- **`SyncRunner`** (`app/sync/runner.py`): after `_finalize_run()` succeeds,
  call `await app.insights.runner.evaluate_anomalies(session_factory)`. This
  iterates every enabled anomaly rule, runs its SQL, writes one
  `insight_runs` row per rule. Failures are logged but don't fail the sync.
- **`/api/v1/insights`** (new router): the read endpoint. Returns latest
  output for each enabled rule. For LLM rules, if the latest output is
  older than `stale_seconds`, kicks off a background run and returns
  `running` state. Frontend polls until the run finishes.
- **`/api/v1/insights/rules`**: GET returns rule list with current toggle +
  last-run summary; PATCH `/{id}` toggles enabled; POST `/{id}/run` runs
  one rule for a given scope.
- **`/api/v1/insights/run-all-enabled`**: POST runs every enabled LLM rule
  with default scope. Returns immediately with the list of run ids;
  frontend polls.

### Frontend

```
frontend/src/features/insights/
├── InsightsPage.tsx        # /insights — read surface
├── InsightsRulesPage.tsx   # /insights/rules — config surface
├── AnomalyCard.tsx
├── LLMSummaryCard.tsx      # 4 states: fresh | running | stale (auto-refreshes) | off
└── components/
    ├── ToggleSwitch.tsx
    └── RuleHistoryTable.tsx
```

`useInsights()` hook in `api/index.ts` polls `/api/v1/insights` every 5 s
when any rule is in `running` state, otherwise falls back to the standard
30 s refresh. Uses TanStack Query keys `['insights', 'feed']` and
`['insights', 'rules']`.

### Anthropic API key

Stored in `.env` as `ANTHROPIC_API_KEY`. Never returned by any endpoint —
the Settings view exposes only `last4` digits + "configured" boolean, same
pattern as the Jira token. `/insights/rules` shows recent spend (sum of
`tokens_in + tokens_out` × pricing constant from `app.config`) over the
last 30 days; this is informational, not enforced.

When the key is missing, `/insights` LLM cards render in a "needs config"
state pointing at `/insights/rules`. Anomaly cards work without the key.

---

## Data flow

### Anomaly path (auto, no LLM)

```
sync completes
  → SyncRunner._finalize_run() returns ok
  → evaluate_anomalies(session_factory)
    → for each enabled anomaly rule:
        → run SQL, get findings list
        → INSERT into insight_runs (status=ok, payload=findings)
  → frontend's `useInsights` cache invalidates next poll
  → /insights cards render with fresh data
```

### LLM path (auto-refresh stale on /insights visit)

```
user opens /insights
  → GET /api/v1/insights returns:
      for each enabled LLM rule, the latest insight_runs row, with a
      computed `is_stale` flag
  → for any stale rule, the endpoint also queues a background run
    (one BackgroundTask per rule)
  → frontend renders `running…` for those rules and polls every 5 s
  → background task:
      → resolve scope (default or override)
      → fetch input endpoints' JSON
      → render prompt template
      → POST to Anthropic API
      → write insight_runs row (status=ok, body_md, tokens)
  → next poll picks up the new row, card flips to `fresh`
```

### Manual "Run all enabled" (Rules page)

```
user clicks Run all enabled
  → POST /api/v1/insights/run-all-enabled
  → for each enabled LLM rule, queue the same background task as above
  → response is { runs: [{rule_id, run_id}, ...] }
  → frontend shows a banner with progress; polls
```

### Manual "Run for…" (Rules page)

Opens a small modal — pick scope (sprint dropdown for retro / sprint-by-
project / stakeholder; project dropdown for any future per-project rule),
click Run. Hits `POST /api/v1/insights/{id}/run` with the override scope.
Result lands on `/insights` and replaces the default-scope output until
the default re-runs.

---

## States and edge cases

| State on `/insights` LLM card | When                                                                                      | Visual                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `fresh`                       | latest output ≤ stale_seconds old                                                         | full card with output preview                           |
| `running…`                    | a background run is in flight                                                             | yellow `running` pill, "Regenerating — ~5 s" italics    |
| `stale → running…`            | stale on page load, kicked off automatically                                               | flips through within one render                         |
| `off`                         | rule disabled in registry                                                                 | dimmed card, "Enable in Rules →" link                   |
| `failed`                      | last run errored (LLM 500, key invalid, etc.)                                             | red pill, last successful output preserved if any       |
| `key-missing`                 | `ANTHROPIC_API_KEY` unset                                                                 | dimmed, "Configure API key →" link                      |

### Failure modes

- **Anomaly SQL fails** — log + skip; don't write an insight_runs row;
  retry next sync. Card shows last successful firing.
- **LLM call fails (network, rate limit)** — write insight_runs row with
  `status=failed`, `error_message`. Frontend keeps the previous successful
  output visible and shows a small failure pill.
- **API key invalid** — same as missing; we don't try to distinguish at
  call time, just surface the API's 401 message.
- **Token budget exceeded** — Anthropic returns truncated; we keep the
  partial body. Catalog `token_budget` is a soft target.

---

## Testing

- **Anomaly rules** — unit tests with the existing pytest fixture DB.
  One test per rule covering: trigger case, no-trigger case, edge
  threshold, and "rule disabled" case.
- **LLM runner** — `respx` mocks Anthropic API. Golden-file tests for
  prompt rendering (so a prompt change shows up as a diff). Token
  accounting verified via mocked response shapes.
- **Endpoints** — pytest + httpx ASGI client. Coverage of: list rules,
  toggle, run-all-enabled, run-for-scope, get insights feed.
- **Frontend** — Vitest snapshot tests for each card state (fresh /
  running / off / failed / key-missing).
- **End-to-end** — Playwright check: open `/insights`, see anomalies +
  cached summaries; toggle a rule off on `/insights/rules`, return,
  card frozen.

---

## Phase plan (rough estimates)

1. **Schema + registry skeleton** — migration `0003`, registry.py with
   all 9 entries, `insight_rules` seeded. ~0.5 d.
2. **Anomaly engine** — 5 SQL rules + post-sync hook + retention job.
   ~1 d.
3. **LLM runner** — Anthropic client wrapper, prompt rendering, scope
   resolution, background-task plumbing. ~1 d.
4. **API endpoints** — list/feed/run/run-all-enabled. ~0.5 d.
5. **`/insights` page** — anomaly cards + LLM summary cards with all
   five states. ~1 d.
6. **`/insights/rules` page** — both tables, toggles, "Run for…" modal,
   API-key panel, run history. ~1 d.
7. **Settings integration** — surface API key status + spend on the
   existing `/settings` page. ~0.5 d.

**Total: ~5.5 d.** Stretch: a "trends" view that overlays anomaly
firings on a timeline. Out of scope for v3 launch.

---

## Open follow-ups (not blocking)

- **Timeline / trend view** — currently we say "fired 3 of last 4 syncs"
  as text. A small inline sparkline per anomaly card could land later.
- **Per-rule prompt versioning UI** — when a prompt is updated, old
  `insight_runs` rows still have `prompt_version=N`; some kind of
  side-by-side diff view could show how outputs changed.
- **Re-promote `project-summary` to standalone** — if at some point we
  want a non-sprint project narrative again (e.g. for the Projects
  drill-in page), we add a second LLM rule `project-detail` rather than
  re-scope this one. Trade-off documented.

---

## Decisions captured during brainstorm

- **Curated rule set, code-defined** (not user-authored). Single user
  for now; bumping to user-edit-prompts mode is YAGNI.
- **Hybrid scheduling** — anomalies auto-run post-sync; LLM rules
  auto-refresh stale on `/insights` visit. Single bulk "Run all
  enabled" + per-row "Run for…" on `/insights/rules`.
- **No per-card scope pickers on `/insights`.** Smart defaults; non-
  default scopes go through Rules page.
- **Anomaly history retained 90 days** so trends are computable.
- **Settings UI for the API key**, mirroring the Jira-token pattern.
