# 04 — API Contract & First-Run Setup

## First-run setup UX

Friction point if not addressed: the user lands on a freshly-cloned repo and has to figure out where to put the Jira token before anything works. Plan:

1. `make setup` runs once: copies `backend/.env.example → backend/.env`, installs deps via `uv sync` and `npm install`, runs `alembic upgrade head` against the dockerised Postgres.
2. The `.env` ships with sensible defaults for everything **except** `JIRA_EMAIL` and `JIRA_API_TOKEN`. Those two start blank.
3. `make dev` launches Postgres (compose) + backend (uvicorn) + frontend (vite). If `.env` is missing the two secrets, backend exposes only `/api/v1/setup/*` and `/api/v1/health`; all data routes return 503 with `{error: "setup_required"}`.
4. Frontend on first load checks `/api/v1/health`. If `jira: "unconfigured"`, it routes to `/setup` regardless of URL. The setup page is a single form (email + token + "Test connection" button) that POSTs to `/api/v1/setup/jira`. Server validates by hitting `/rest/api/3/myself`, then writes the values to `backend/.env` (using a small atomic-rewrite helper) and triggers a graceful in-process reload of the Jira client config — no process restart required.
5. After successful setup, frontend redirects to `/sprint-health` and kicks off the first sync via `POST /api/v1/sync/run?scan_type=full`. Because first sync is 5–15 min, the page shows a full-screen progress card (issues_seen / estimated_total, ETA) until done — every panel is gated until the first successful sync. Subsequent visits show stale data immediately while incremental sync runs in the background.

**Storage:** `.env` is gitignored. No tokens hit the database. No tokens hit logs (httpx logging configured to redact `Authorization`).

## Settings page surface (v1)

- **Jira credentials** — masked display + "Re-test connection" / "Update token" flow via `/api/v1/setup/jira`.
- **Sync schedule** — `SYNC_CRON` (incremental) and `FULL_SCAN_CRON` (weekly full-scan), edited live; APScheduler reschedules without restart.
- **Team filter** — `cf[10500]` team UUID, sprint name prefix (`Search `).
- **Board ID** — override for auto-discovered board ID (auto-discovery is the default; override only when wrong).
- **Holiday management** — list/add/edit/delete public holidays per region. Seed via `infra/holidays/IN.yaml` on install; UI for one-off company holidays.
- **Leave management** — see below; this is more than a config screen.

## Leave management — first-class capability, not just config

The user wants this for two purposes: **(a)** feeding velocity / available-days calc (mechanical), **(b)** keeping a tab on team availability (operational — "who's away next week? are two people overlapping?"). Phase 2 (UX design) decides whether this lives under `/settings`, gets a dedicated `/team` or `/leaves` route, or surfaces in two places (a quick widget in the top-bar + a full page elsewhere). The data model and endpoints are the same regardless.

### Endpoints

- `GET /api/v1/leaves?from=&to=&person=` — list leaves in a date window or per person; sortable, filterable.
- `GET /api/v1/leaves/upcoming?weeks=6` — convenience view: next-6-weeks per-person overview, overlaps annotated.
- `POST /api/v1/leaves` `{person_account_id, start_date, end_date, reason?}` — create.
- `PATCH /api/v1/leaves/{id}` — edit.
- `DELETE /api/v1/leaves/{id}` — remove.

### UI requirements (for Phase 2 to wire up)

- A list view sorted by `start_date` with overlap indicators (e.g., "2 people away in week of May 12").
- Add/edit/delete inline.
- A per-person calendar-style view (probably just a horizontal timeline / Gantt strip) for the last/next 90 days.
- Filter by team subset (uses the same whitelist mechanism as sprint health).

## API surface (v1)

All under `/api/v1/`. JSON. No auth (single-user localhost).

| Method | Path | Notes |
|---|---|---|
| GET  | `/health` | `{db, jira, last_sync_at, configured}` |
| POST | `/setup/jira` | body `{email, api_token}`; validates + writes `.env`; returns 200/400 |
| GET  | `/sprints?state=active\|closed\|all` | sprint rows |
| GET  | `/sprints/{id}` | sprint + per-person rollup |
| GET  | `/issues?sprint_id=&assignee=&status_category=&issue_type=&epic_key=&q=&limit=&cursor=` | paginated |
| GET  | `/issues/{key}` | issue + ticket_state history + comments |
| GET  | `/epics?initiative_key=&status_category=&due_before=&order_by=` | epics + rollup |
| GET  | `/epics/{key}` | epic + child issues |
| GET  | `/initiatives` | initiatives + epic counts |
| GET  | `/people?active=true` | people in scope |
| GET  | `/leaves?from=&to=&person=` | leaves within window |
| GET  | `/leaves/upcoming?weeks=6` | next-6-weeks overview with overlap annotations |
| POST | `/leaves` | body `{person_account_id, start_date, end_date, reason?}` |
| PATCH| `/leaves/{id}` | edit |
| DELETE | `/leaves/{id}` | remove |
| GET  | `/holidays?region=IN` | list holidays |
| POST | `/holidays` | body `{holiday_date, region, name}` |
| DELETE | `/holidays/{date}/{region}` | remove |
| GET  | `/metrics/velocity?sprint_window=6&person=` | per-person × sprint normalised velocity + accuracy |
| GET  | `/metrics/scope-changes?sprint_id=&since=&change_type=` | scope_change_events rows |
| GET  | `/metrics/carry-over` | carry-over panel data |
| GET  | `/metrics/blockers` | aging sub-tasks |
| GET  | `/hygiene/epics-no-initiative` | epics with NULL `initiative_key`, ordered by due_date asc |
| GET  | `/hygiene/tasks-no-epic` | issues with NULL `epic_key` (excluding sub-tasks), ordered by `updated_at` desc |
| GET  | `/hygiene/by-due-date?team=true&include_closed=false` | tickets sorted ascending by due_date; past-due flagged |
| GET  | `/projects` | (Phase 5) list projects with active/completed rollup |
| GET  | `/projects/{name}` | (Phase 5) drill-in: epics, issues, burn-up |
| GET  | `/projects/comparison` | (Phase 5) active rollups vs. snapshot percentiles |
| POST | `/sync/run?scan_type=incremental\|full` | 202 + `{sync_run_id}` |
| GET  | `/sync/status?limit=10` | recent sync_runs |

Every endpoint is a single indexed SQL query. Target p95 < 50 ms. Eager-load via `selectinload` to avoid N+1.

## Error-shape convention

```json
{
  "error": "setup_required" | "jira_unauthorized" | "sync_in_progress" | "not_found" | "validation_error",
  "message": "human-readable description",
  "details": { ... }                            // optional, structured per error type
}
```

HTTP status follows REST convention: 400 for validation, 401 for Jira-auth, 404 for not-found, 409 for conflict (e.g. sync already running), 503 for setup-required.
