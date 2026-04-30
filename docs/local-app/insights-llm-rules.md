# Insights — LLM Rules Catalog

Living reference for every LLM-powered rule that runs on the `/insights` page.

When adding a new rule, copy the **Template** at the bottom into a new section
above it. When changing an existing prompt, bump the rule's `version` field —
historical `insight_runs` rows are tied to the version they were generated
under, so you can compare old vs. new outputs without losing history.

> **Anomaly rules** (SQL-only, auto-run after every sync) live in code at
> `backend/app/insights/anomalies.py`, not here. This doc is for prompt-driven
> rules that consume tokens.

---

## Conventions

- **`id`** — kebab-case slug; used as the row key in `insight_rules`.
- **`version`** — integer, bumped whenever the prompt or input shape changes.
- **`trigger`** — `on_demand` (only "Run now" button) for v3; `weekly_cron`
  reserved for if we move things to scheduled later.
- **`inputs`** — list of SQL views / endpoints whose JSON output is interpolated
  into the prompt. Keep small (target < 4K tokens of context per rule).
- **`output_shape`** — what the rendered Markdown looks like. The frontend
  knows nothing about content; it just renders Markdown.
- **`token_budget`** — rough ceiling for the response. We use `max_tokens`
  on the API call.
- **`use_when`** — one-liner describing the user moment this rule serves.

---

## Active rules

### `weekly-briefing` · v1

**Job:** Lead's Monday-morning self-briefing (Job A).
**Trigger:** `on_demand`.
**Token budget:** 1500 tokens out, ~3000 in.
**Use when:** "I just opened the laptop on Monday — what should I pay attention
to this week?"

**Inputs:**
- Last 4 sprints' rollups (committed/completed SP, per-person breakdown).
- Velocity-trend deltas (this sprint vs. 6-sprint average) per person.
- Open at-risk + watch epics with `risk_reasons`.
- Top 5 stale carry-overs (depth ≥ 2).

**Prompt:**
```
You're advising the Search team's tech lead on what to pay attention to
this week. Read the JSON below and produce a concise (~10 bullet)
briefing organised under these headings: Trending up, Trending down,
Stuck. Each bullet must cite specific people, tickets, or epics — no
generic management speak. Surface 1:1 conversation prompts where
warranted (e.g., "consider asking <Person> about <Epic> — velocity
dropped 40% AND they own the epic").

Data:
<inputs JSON>
```

**Output shape:** Markdown with 3 sections (Trending up / Trending down /
Stuck). Each section has 2–4 bullets, each bullet citing concrete data.

---

### `retro-agenda` · v1

**Job:** Retro prep (Job B).
**Trigger:** `on_demand` (user picks a sprint from a dropdown).
**Token budget:** 2000 tokens out, ~4000 in.
**Use when:** "Friday retro is in 30 minutes — give me an agenda I can pull
into Confluence."

**Inputs (sprint-scoped):**
- Sprint rollup (committed/completed SP, per-person, status breakdown).
- All scope-change events on the sprint's tickets.
- Aged blockers active during the sprint.
- Carry-overs into the next sprint.

**Prompt:**
```
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

Sprint: <sprint_name>
Data:
<inputs JSON>
```

**Output shape:** Markdown with 5 sections, ticket keys in `<code>` style
so they render as Jira chips downstream.

---

### `stakeholder-update` · v1

**Job:** Stakeholder one-liner (Job C).
**Trigger:** `on_demand`.
**Token budget:** 600 tokens out, ~2500 in.
**Use when:** "I need to send a 3-paragraph update to my manager / a
weekly Slack channel — give me the draft."

**Inputs:**
- Most recent sprint rollup.
- Active epic count by risk band.
- Project ETD slippage in the last week.

**Prompt:**
```
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

Data:
<inputs JSON>
```

**Output shape:** 3 plain Markdown paragraphs. Frontend exposes a
"Copy" button that strips formatting for paste into Slack/email.

---

### `project-summary` · v1

**Job:** Per-sprint roll-up grouped by project, plus a Miscellaneous
bucket for sprint tickets not labelled with any `proj_*`.
**Trigger:** auto-refresh stale (per Path-1 UX); default scope = the
most recently closed sprint.
**Token budget:** 2000 tokens out, ~5000 in. Single Claude call with
the whole sprint as context — Claude sees all projects together so
the output reads coherently.
**Use when:** "Where did each piece of this sprint's work go? What did
each project ship, and what work fell outside the project labels?"

**Inputs (sprint-scoped):**
- Sprint metadata (name, dates, total committed/completed SP).
- For every project (`proj_*` label) with at least one issue in the
  sprint:
  - epic keys + summaries
  - issues completed in the sprint, with SP and assignees
  - issues carried over (not done at sprint close)
  - top contributors for that project in the sprint
- **Miscellaneous bucket:** all sprint issues whose epic carries no
  `proj_*` label — same fields as above (issues completed, carried
  over, contributors).

**Prompt:**
```
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

Sprint: <sprint_name>
Data:
<inputs JSON>
```

**Output shape:** Markdown with N sections (one per project active in
sprint) + `## Miscellaneous` + `## Bottom line`. Ticket keys in
`<code>`.

**On `/insights`:** rendered as one card whose body shows the
section headings + truncated bullets; "view full →" expands the
whole document.

---

## How to add a new LLM rule

1. **Pick a `use_when` moment** — the one-liner that names the user's
   moment of need. If you can't write a clear `use_when`, the rule
   probably doesn't need to exist.
2. **Sketch the inputs** — list the existing endpoints / SQL views you'd
   pull from. Aim for < 4K tokens of context. Add a new endpoint if
   nothing fits.
3. **Draft the prompt** — start with the prompts in this catalog as
   templates. Constrain output shape explicitly ("3 paragraphs", "5 bullets").
4. **Add a row to `insight_rules`** in `backend/app/insights/registry.py`
   with `id`, `version=1`, `trigger`, `prompt_template`, `inputs`.
5. **Document it here** by copying the Template below.
6. **Wire it on `/insights/rules`** — should appear automatically once the
   row exists; no frontend code per rule.

---

## Template

```markdown
### `rule-id` · v1

**Job:** <one-liner — which user job (A/B/C) or new>.
**Trigger:** `on_demand` | `weekly_cron`.
**Token budget:** <out> tokens out, ~<in> in.
**Use when:** "<the user moment this rule serves>"

**Inputs:**
- <endpoint or SQL view 1>
- <endpoint or SQL view 2>

**Prompt:**
\```
<full prompt with <inputs JSON> placeholder>
\```

**Output shape:** <Markdown structure description>.
```
