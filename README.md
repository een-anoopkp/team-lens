# team-lens

Private dashboards for the Search team (290) — visibility into sprint health, epic risk, project ETD, and team hygiene. Lead-facing; not published.

## What's here

- **`backend/`** — FastAPI + SQLAlchemy + Postgres. Syncs Jira every few hours, exposes `/api/v1/*` endpoints. See [`backend/README.md`](backend/README.md).
- **`frontend/`** — React + Vite + TanStack Query SPA. Renders the dashboards. See [`frontend/README.md`](frontend/README.md).
- **`docs/local-app/`** — authoritative design + ops docs. Start at [`docs/local-app/README.md`](docs/local-app/README.md).
- **`infra/`** — local-dev compose stack (Postgres) and seed data (`infra/holidays/<region>.yaml`).
- **`scripts/`** — operational scripts (e.g. `seed_holidays.py`, `e2e_smoke.sh`).

## Stack

```
Jira REST API → backend sync engine (APScheduler) → Postgres → FastAPI → React SPA
```

Single user. Single tenant. All data stays on the lead's machine.

## Pages

| Route | Purpose |
|---|---|
| `/sprint-health` | Per-person SP progress, blockers, carry-over, velocity trend |
| `/epic-risk` | Quarterly epic risk classification + throughput |
| `/hygiene` | Epics without initiative, tasks without epic, by-due-date |
| `/projects` | Label-derived project rollups + ETD |
| `/projects/:name` | Project drill-in (epics, sprints, ETD, contributors) |
| `/projects/monitoring` | Active vs. closed-snapshot comparison |
| `/leaves` | Team leaves + holidays |
| `/settings` | Read-only config view + Jira re-test |
| `/debug` | Raw entity browser |

## Quickstart

```bash
make setup        # uv sync, npm install, alembic upgrade, docker compose
make dev          # backend on :8000, frontend on :8081
```

Open <http://localhost:8081>; if Jira creds aren't configured the UI routes you to `/setup`.

## History — pre-v1 dashboards (Apps Script + CSV pipeline)

The team previously ran two CSV-driven dashboards from Google Apps Script. Both lived under `apps-script/` and `web/` in this repo — deleted in Phase 6 after the local app reached parity. The deletion commit is tagged `pre-phase-6-deletion` if you ever need the old code:

```bash
git checkout pre-phase-6-deletion -- apps-script web
```

The original design docs are still in `docs/epic-risk-design.md` and `docs/sprint-health-design.md` for historical context; the new app's design is in `docs/local-app/`.
