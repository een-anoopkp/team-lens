# 01 — Architecture

## System diagram

```
┌──────────────────┐   HTTP   ┌──────────────────┐   HTTPS  ┌────────┐
│ React + Vite + TS│ ───────► │ FastAPI (8000)   │ ───────► │ Jira   │
│ TanStack Query   │ ◄─────── │ APScheduler      │ ◄─────── │ REST   │
│ Chart.js         │          │ SQLAlchemy 2.x   │          │ /agile │
└──────────────────┘          └────────┬─────────┘          └────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ Postgres 16      │ ← docker-compose
                              │ (in container)   │
                              └──────────────────┘
```

- Postgres in Docker (`infra/docker-compose.yml`); backend runs natively (`uv run uvicorn ...`) for fast reload.
- Frontend served by Vite dev server, proxies `/api` → `localhost:8000`.
- Single user, single laptop. v2 may add Docker for backend + auth proxy when team-deployed.

## Repo layout

```
team-lens/
├── apps-script/          # FROZEN; no new work; deleted in Phase 6
├── web/                  # FROZEN legacy CSV-driven HTML; deleted in Phase 6
├── docs/
│   ├── sprint-health-design.md           # POC-era spec; reference only
│   ├── epic-risk-design.md               # POC-era spec; reference only
│   └── local-app/                        # ← THIS FOLDER
├── backend/
│   ├── pyproject.toml             # uv-managed
│   ├── .env.example
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py                # FastAPI app, lifespan, scheduler
│   │   ├── config.py              # pydantic-settings
│   │   ├── db.py                  # async engine, session
│   │   ├── models/                # SQLAlchemy ORM (one file per table)
│   │   ├── schemas/               # Pydantic response models
│   │   ├── jira/
│   │   │   ├── client.py          # port of JiraClient.gs
│   │   │   └── fields.py          # custom-field discovery + cache
│   │   ├── sync/
│   │   │   ├── runner.py          # orchestrates a sync run
│   │   │   ├── transform.py       # Jira JSON → ORM rows
│   │   │   ├── snapshots.py       # ticket_state diff
│   │   │   ├── projects.py        # project freeze job
│   │   │   └── scheduler.py       # APScheduler wiring
│   │   ├── api/
│   │   │   ├── routes_setup.py
│   │   │   ├── routes_sprints.py
│   │   │   ├── routes_issues.py
│   │   │   ├── routes_epics.py
│   │   │   ├── routes_metrics.py
│   │   │   ├── routes_hygiene.py
│   │   │   ├── routes_projects.py
│   │   │   ├── routes_leaves.py
│   │   │   └── routes_sync.py
│   │   └── metrics/               # pure functions: velocity, hygiene, etc.
│   ├── scripts/
│   │   └── capture_jira_fixtures.py
│   └── tests/                     # pytest + asgi-lifespan
├── frontend/
│   ├── package.json               # vite + react + ts + tanstack-query
│   ├── vite.config.ts             # proxy /api → :8000
│   ├── mockup/                    # Phase 2 deliverable
│   │   ├── index.html
│   │   └── styles.css
│   └── src/
│       ├── app/                   # AppShell, router, queryClient
│       ├── api/                   # generated TS client + hooks per resource
│       ├── components/            # ProgressBar, KpiCard, SparklineTile, ...
│       ├── features/              # sprint-health/, epic-risk/, hygiene/, settings/
│       ├── hooks/                 # useLocalStorage, useWhitelist, useFilter, useLeaves
│       └── styles/tokens.css      # final tokens from Phase 2 mockup
├── infra/
│   ├── docker-compose.yml         # postgres 16 only
│   ├── holidays/IN.yaml           # public holiday seed
│   └── backups/                   # pg_dump snapshots (gitignored)
└── Makefile                       # setup, dev, sync, test, gen-types, backup
```

TS types are generated from FastAPI's OpenAPI schema via `openapi-typescript` (run by `make gen-types`). No hand-maintained shared-types.

## Critical files (POC reference)

The Apps Script code is **conceptual reference, not a port spec**. Read it for ideas; don't replicate logic line-for-line.

**Useful for understanding Jira-side patterns (auth, pagination, retry, field shapes):**
- `apps-script/sprint-health/JiraClient.gs` — directly informs `backend/app/jira/client.py`
- `apps-script/sprint-health/Aggregator.gs:240-284` — sprint board auto-discovery pattern

**Useful for understanding what metrics exist and roughly what they mean:**
- `apps-script/sprint-health/Aggregator.gs:380-440` — snapshot-diff approach (we redesigned the semantics; see [03-sync-engine.md](./03-sync-engine.md))
- `apps-script/sprint-health/Aggregator.gs:466-742` — velocity, accuracy, carry-over, blockers, scope changes
- `apps-script/epic-risk/Aggregator.gs` — epic-risk metrics

**Visual reference for which panels exist (not for layout — Phase 2 redesigns):**
- `web/sprint-health/app.js`, `web/sprint-health/styles.css`
- `web/epic-risk/app.js`

**Earlier design docs (the locked semantics from POC era; some will be revisited):**
- `docs/sprint-health-design.md`
- `docs/epic-risk-design.md`

**Not migrating any data from the Sheet.** Start clean.
