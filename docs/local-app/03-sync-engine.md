# 03 — Sync Engine

## Strategy: hybrid incremental + periodic full re-scan

Scope is **all team tickets ever** — every issue where `cf[10500] = team` or whose parent is in team scope. First run is a full backfill (5–15 minutes, thousands of issues, paginated). Subsequent scheduled runs use `updated >= "<last_successful_sync_iso>"` JQL filter to fetch only changed tickets (typically <30 seconds). A weekly full re-scan (default Sunday 03:00 IST) catches deletions and out-of-scope reassignments that incremental can't see.

**Why this design:** incremental sync alone never observes ticket removal (a ticket whose `cf[10500]` was cleared simply stops appearing in updated-feeds — you need a periodic full scan to detect absence). Hybrid gets fresh data hourly with bounded total cost.

## Pipeline

Single APScheduler job per scan-type, configurable cron. Default `0 7 * * *` IST for incremental; `0 3 * * 0` IST for weekly full scan; manual trigger via `POST /api/v1/sync/run?scan_type=incremental|full`.

1. Insert `sync_runs` row with `status='running'`, `scan_type='incremental'|'full'`, `trigger='scheduled'|'manual'`.
2. Discover custom field IDs (`/rest/api/3/field`); cache in-memory for process lifetime.
3. Fetch sprints from `/rest/agile/1.0/board/{id}/sprint?state=active` and `state=closed`, filtered by `Search ` prefix. **All** closed sprints, not just last 6 — needed for project ETD and long-tail history. Upsert `sprints`.
4. Fetch issues via JQL — base predicate is `(cf[10500] = "<team-id>" OR parent in (cf[10500] = "<team-id>"))`:
   - **Full scan:** the base predicate alone. Paginated through `/rest/api/3/search/jql` with retry on 429/503. Pattern ports from `apps-script/sprint-health/JiraClient.gs:97-119`.
   - **Incremental:** base predicate `AND updated >= "<last_successful_sync_iso>"`. The `last_successful_sync_iso` is sourced from `MAX(finished_at) FROM sync_runs WHERE status='success'`. On first run after install, fall back to full scan automatically.
5. Fetch parent epics + initiatives referenced by step 4 issues but missing from `epics`/`initiatives` tables (any may live outside team scope). Use `key in (...)` JQL batched in chunks of 100. **Initiatives are derived from `epic.parent` where `parent.issuetype.name = 'Initiative'`** (id 10527 on this tenant) — no custom-field discovery needed.
6. For each issue touched, fetch comments via `/rest/api/3/issue/{key}/comment` (paginated). Upsert into `comments` table with ADF body + plaintext rendering. Set `last_seen_at = now()`.
7. Upsert `people`, `initiatives`, `epics`, `issues`. `INSERT ... ON CONFLICT DO UPDATE` keyed on PK. Set `last_seen_at = now()` on each upsert.
8. Replace `issue_sprints` rows for each issue key touched in this run (delete-then-insert per key).
9. **Full scan only:** mark removed entities — `UPDATE issues SET removed_at = now() WHERE last_seen_at < <run_started_at> AND removed_at IS NULL`. Same for `comments`. All read endpoints filter `WHERE removed_at IS NULL` by default; expose `?include_removed=true` for audit.
10. **Snapshot diff** — see "Snapshot diff rules" below.
11. **Project freeze job** — see [10-roadmap-v3.md](./10-roadmap-v3.md) for the full freeze logic; runs at the end of every sync (cheap when nothing changes).
12. Update `sync_runs` with `status='success'`, `finished_at=now()`, counts (issues_seen, issues_inserted, issues_updated, issues_removed, sp_changes, assignee_changes, status_changes).
13. On exception: `status='failed'`, `error_message=str(e)`. Don't roll back partial upserts — `last_seen_at` per row exposes how stale anything got. Crucially, **don't update `last_successful_sync_iso`** on failure, so the next incremental run picks up everything since the last good sync.

**Concurrency:** an `asyncio.Lock` guards steps 1–12 so manual + scheduled runs serialise.

## Snapshot diff rules

For each `(issue_key, sprint_name)` pair currently in scope:

- **Case A: first sighting AND this is a full-backfill** (`sync_runs` is empty or this is the first full scan) → silent baseline. Insert with `first_sp = last_sp = current SP`, `first_seen_at = last_seen_at = now()`, `was_added_mid_sprint = false`.
- **Case B: first sighting in incremental mode AND `sprint.start_date > now()`** (sprint hasn't started yet, ticket scheduled in pre-start) → silent baseline. Same as Case A but `was_added_mid_sprint = false`.
- **Case C: first sighting in incremental mode AND `sprint.start_date ≤ now()`** (mid-sprint addition / creep) → counterfactual baseline. Insert with `first_sp = 0`, `last_sp = current SP`, `was_added_mid_sprint = true`, `first_seen_at = now()`. AND immediately append a `scope_change_events` row with `change_type='added_mid_sprint'`, `old_value=NULL`, `new_value=current_sp`, `sp_delta=+current_sp`. This records both the SP creep AND identifies the ticket as a mid-sprint addition.
- **If row exists and `current SP ≠ last_sp`** → append a `scope_change_events` row (`change_type='sp'`, `sp_delta=current-last`), then update `last_sp` + `last_seen_at`.
- **If row exists and `assignee ≠ last_assignee`** → append `scope_change_events` row (`change_type='assignee'`, `old_value`/`new_value` text columns), update `last_assignee`.
- **If row exists and `status ≠ last_status`** → same pattern with `change_type='status'`.
- **Otherwise** → just update `last_seen_at`.

**UI implication:** the Sprint Health "Scope Churn" panel can distinguish "SP edited on existing ticket" (yellow) from "ticket added mid-sprint" (red, with delta = full SP) — surfaces creep more honestly than the legacy POC.

## Cold-start cost (full backfill)

First run touches all team tickets ever — likely 1k–10k issues plus parent epics/initiatives plus their comments. Expected wall time **5–15 minutes**. The Jira retry path (port from `JiraClient.gs:97-119`: exponential backoff on 429/503 honouring `Retry-After`) makes this safe. Frontend on first sync shows a determinate progress UI: `{ issues_seen, eta_seconds }` derived from `sync_runs` row updated every batch (e.g., every 100 issues).

## Steady-state cost

Incremental syncs typically <30 seconds, often <5 seconds. Default cron stays at `0 7 * * *` IST (daily) — the user can configure hourly via `SYNC_CRON="0 * * * *"` in `.env` once they trust the system.

## Weekly full re-scan

Separate APScheduler job at `FULL_SCAN_CRON="0 3 * * 0"` (Sunday 03:00 IST). Handles ticket-removed and out-of-scope cases. Same pipeline as above with `scan_type='full'`.

## Timezone

APScheduler `AsyncIOScheduler(timezone="Asia/Kolkata")`. All `timestamptz` columns store UTC; the API returns ISO-8601 strings; the frontend renders in browser local time. India doesn't observe DST, so cron strings are stable.
