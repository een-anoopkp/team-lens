# 10 — v2 / v3 Roadmap

Captured for shape; not in v1. Each gets its own plan once Phase 5 has been in real use long enough to reveal what's actually missing.

## v2-A — Projects view (PM-shareable)

**Goal:** group epics into logical "projects" so a PM can ask "what's the status of project X?" and get an answer with velocity + ETD without bothering anyone.

**Status:** scheduled for Phase 5. Backend infrastructure (label discovery, freeze job, `project_snapshots` table) lands in Phase 1; Phase 5 is just the read API + frontend.

### Mechanism — Jira labels with `proj_` prefix

No new schema; no separate DB. The sync already pulls `labels` in `raw_payload`. A view derived on read:

```sql
-- Derive projects from any label starting with 'proj_' (Postgres 11+).
SELECT DISTINCT
  substr(label, 6) AS project_name,
  e.issue_key      AS epic_key
FROM epics e,
     LATERAL jsonb_array_elements_text(e.raw_payload->'fields'->'labels') AS label
WHERE starts_with(label, 'proj_');
```

**Lift labels to a column for index speed.** When v2 lands, add a generated column `epics.labels text[] GENERATED ALWAYS AS (ARRAY(SELECT jsonb_array_elements_text(raw_payload->'fields'->'labels'))) STORED` plus a GIN index on it. That keeps project rollups O(epics) instead of full scans of the JSON.

Project rollup walks `epic.proj_label → epic → issues (epic_key)` and aggregates SP, status, sprint membership.

### Endpoints (Phase 5)

- `GET /api/v1/projects` — list projects with rollup (epic count, SP open / done, velocity over last 6 sprints, ETD by extrapolation, ETD by future-sprint-assignment if tickets are pre-scheduled).
- `GET /api/v1/projects/{name}` — drill-in (epics, issues, burn-up across sprints).
- `GET /api/v1/projects/comparison` — active rollups + median/p25/p75 across all closed snapshots.

### ETD computation, two methods

1. **By velocity extrapolation:** `remaining_SP / avg_project_velocity_per_sprint × avg_sprint_length` → calendar date with a confidence band (±1 sprint). All inputs come from synced data: `sprints.start_date`/`end_date` give sprint length per sprint, averaged over the project's history; project velocity is computed from completed SP per sprint over that same window.
2. **By sprint assignment:** if remaining issues are already assigned to future sprints, ETD = `end_date` of the latest sprint containing project work. More accurate when sprint planning is done up front.

Show both side-by-side; let the user trust whichever fits their planning style.

**Caveats** displayed in UI: "assumes constant allocation"; "based on N sprints of history".

### Project lifecycle / completion handling

A project label stays on its epics forever (deletion would lose history). The UI auto-classifies projects:

- **Active:** at least one epic with `status_category != 'done'` carrying the label.
- **Completed:** all labelled epics in `status_category = 'done'`. Shown under a collapsed "Completed" section on `/projects`, with the date the last epic closed.
- **Hidden (manual override):** the `local_settings` table holds a list of project names the user has chosen to hide from the active view. Toggleable from `/projects/:name` via a "Hide from active list" action; reversible. Never modifies anything in Jira.

This gives the right behaviour for free in 90% of cases (project finishes → moves to Completed without any ceremony) and a one-click escape hatch for the rest (stale projects with abandoned tickets nobody will finish).

### Closed-project stats archive (the "monitoring table")

When a project transitions Active → Completed, a freeze job snapshots its final stats into `project_snapshots`. From that point on, active-view comparisons read from the snapshot, not by re-walking the underlying tickets every render. Underlying tickets stay in `issues` for drill-in and ad-hoc queries — storage is cheap and a Jira re-fetch isn't.

(`project_snapshots` schema in [02-database-schema.md](./02-database-schema.md).)

**Freeze job** (runs at the end of every sync, cheap when nothing changed):

1. Find projects where every labelled epic has `status_category = 'done'`.
2. For each, compute `epic_count`, `epic_keys`, `total_sp`, `sprints_active`, `first_sprint_name`, `last_sprint_name`, `avg_velocity_sp`, `avg_sprint_length_d`, `scope_churn_pct`, `sp_added_total`, `sp_removed_total`, `contributors`, `initiative_keys`, plus a `raw_metrics` JSONB blob with anything else the UI might want later.
3. Upsert into `project_snapshots`. If the row exists with the same `epic_keys` set, skip; if `epic_keys` differs (e.g. label added retroactively), recompute and update.
4. Idempotent.

### `/projects/monitoring` route

A single comparison table — active projects on top, completed underneath, sortable by velocity / churn / duration. Shows for each active project: "Velocity 4.2 SP/sprint vs. completed median 6.1 — running 31% slow"; "Churn 15% vs. completed median 7% — running hot". Backed by `GET /api/v1/projects/comparison` which returns active-project rollups + median/p25/p75 across **all** closed projects in `project_snapshots` (no size-matching — keep it simple).

**Empty-state rule:** when fewer than 5 closed snapshots exist, the comparison column shows "not enough history yet — keep shipping" instead of misleading stats based on tiny n.

### Re-opening a project

If a Completed project gets a new epic (or an existing labelled epic is reopened), the auto-classifier flips it back to Active. The `project_snapshots` row stays — it's an archive of "as-of completion-1". When the project re-completes, freeze job updates the row.

### Future purge option (not v2)

If `issues` ever grows to the point where active queries slow down (unlikely under 100k rows), we can add a `purge_closed_project_tickets()` job that deletes `issues` rows whose only project label maps to a Completed snapshot, keeping `raw_payload` in the snapshot's `raw_metrics` JSON for forensic recovery. Defer until measured.

## v2-B — Comments write-back

Optimistic UI, ADF round-trip, reconciliation on next sync. `POST /api/v1/issues/{key}/comments` with `local_origin=true` flag in the `comments` table (the comments table itself ships in Phase 1 with `local_origin` already there).

- Server converts markdown → Jira ADF (use `mistletoe` or write a thin converter; ADF is JSON), POSTs to `/rest/api/3/issue/{key}/comment`, then writes the returned comment into the local `comments` table with `local_origin=true`.
- Reconciliation: the next sync fetches comments via `/rest/api/3/issue/{key}/comment` and upserts by `comment_id` — local-origin rows match on the same ID (Jira returns it on POST), so no duplicates.
- Conflict handling deferred (last-write-wins via `updated_at`).

## v3-A — PR-review queue + AI-assisted review

**Trigger pattern** (already learnable from Jira data we sync): a sub-task assigned to the current user, where the sub-task's parent is in status "In Review". The sync already captures parent → sub-task linkage and assignees. Surface this as a panel:

- **Phase 1 — Detection-only (v2):** new "PR reviews queued for me" panel on the dashboard. Lists open PR-review sub-tasks with deep links to Jira and (if discoverable) the GitHub PR URL extracted from Jira's "Development" panel via `/rest/dev-status/1.0/issue/detail`.
- **Phase 2 — Local AI review (v3):** "Run Claude review" button on each row. Spawns a local subprocess that:
  1. Pulls the PR diff from GitHub via `gh pr diff <url>`.
  2. Pipes it to `claude` CLI with a stored review prompt (focus areas the user maintains).
  3. Renders the review in a side panel; option to copy back as a Jira comment or as inline GitHub comments via `gh pr review`.
- **Phase 3 — GitHub Action (v3+):** a manually-triggered `workflow_dispatch` action mirroring Phase 2 server-side, so reviews can run when the laptop is closed. Out of scope until Phase 2 is in daily use.

**Why phase it this way:** Phase 1 alone removes most of the "did I miss a review request?" pain at near-zero engineering cost. Phase 2 only justifies its complexity if Phase 1 reveals enough volume to matter.

## v3-B — Leaderboard (multi-source)

Adds a GitHub sync pipeline + `contributions` rollup table keyed `(person, source, period)`. Sources include:

- Jira: tickets closed, SP delivered (already syncable from Phase 1 data)
- GitHub: PRs opened, PRs reviewed, review turnaround time
- Custom: peer kudos / shoutouts

Out of scope until v1 is stable. The empty-state placeholder in `/leaderboard` (Phase 2) makes the product shape visible without backend work.

## v3-C — AI insights

Weekly natural-language summary of velocity drift, scope churn outliers, carry-over patterns — generated by Claude from local DB. Nothing leaves the machine without an explicit click.

Possible prompts:

- "Summarise this team's last 4 sprints. What's trending up, what's trending down, what's stuck?"
- "List individuals whose velocity dropped more than 30% this sprint vs. their 6-sprint average. Suggest possible reasons by reading their tickets."
- "Identify carry-over tickets older than 2 sprints. Group by likely cause (blocked / scope / underestimate)."

Out of scope until Phase 5 is stable. The empty-state placeholder in `/insights` (Phase 2) makes the product shape visible without backend work.
