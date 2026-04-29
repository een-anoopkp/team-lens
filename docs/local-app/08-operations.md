# 08 — Operational Concerns

## Database backup

`ticket_state_snapshots` is irreplaceable history (we don't migrate from the Sheet, so once the new system has been running, that's the only place it exists). Add a `make backup` target that runs `pg_dump teamlens > infra/backups/teamlens-$(date +%F).sql` and keeps the last 14 days. Add a daily cron entry to the user's host crontab as part of `make setup` (with confirmation prompt — don't silently install host-level cron). On laptop wipe / reinstall, restore via `make restore FILE=...`.

```makefile
backup:
	@mkdir -p infra/backups
	@docker compose exec -T postgres pg_dump -U teamlens teamlens > infra/backups/teamlens-$(shell date +%F).sql
	@echo "Backup written to infra/backups/teamlens-$(shell date +%F).sql"
	@find infra/backups -name 'teamlens-*.sql' -mtime +14 -delete

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=infra/backups/teamlens-2026-MM-DD.sql"; exit 1)
	@docker compose exec -T postgres psql -U teamlens teamlens < $(FILE)
```

`infra/backups/` is gitignored.

## Process supervision

v1 runs `make dev` in a terminal. Acceptable while bootstrapping. If the user wants the backend running in the background long-term, add `make install-launchd` (macOS) / `make install-systemd-user` (linux) targets in Phase 4 polish — not required for v1 acceptance.

## Logging

Structured JSON logs via `structlog`; rotated at 10 MB to `backend/logs/app.log`. Sync runs log to both DB (`sync_runs` row) and file. Token redaction enforced at the httpx logger level — `Authorization` header value is replaced with `***` before any log write.

`LOG_LEVEL` env var, default `INFO`. Bump to `DEBUG` for troubleshooting. Per-sync verbose flag deferred to first time it's needed.

`backend/logs/` is gitignored.

## PM-sharing reality check

`localhost:8080/projects/<name>` only works on the user's own machine. Until a v3 deployment story exists, "shareable with PMs" means **screen-share or screenshot**. Don't oversell this in the UI — label the share button as "Copy URL (only works on this machine for now)" or hide it entirely. If a PM-facing demand emerges, the cleanest answer is a v3 deployment to an internal server with the same codebase.

## Sync failure handling

A failed sync run:

1. Writes `sync_runs` row with `status='failed'` and `error_message=str(e)`.
2. Does NOT update `last_successful_sync_iso` — the next incremental run uses the prior successful run's timestamp, so nothing is missed.
3. Does NOT roll back partial upserts — `last_seen_at` per row exposes how stale anything got.
4. Surfaces in the frontend as a red toast on `/sync/status` change + the staleness badge stays at its previous state.

The user can manually re-trigger via the Refresh button or `POST /api/v1/sync/run`. After 3 consecutive failures, the staleness badge flips to a "sync broken" state with a "view error" link to the latest `error_message`.

## Secret management

- `backend/.env` — gitignored. Holds `JIRA_EMAIL`, `JIRA_API_TOKEN`, `DATABASE_URL`, `TEAM_FIELD_ID`, `TEAM_FIELD_VALUE`, `BOARD_ID`, `SYNC_CRON`, `FULL_SCAN_CRON`, `LOG_LEVEL`.
- Tokens **never** hit the database.
- Tokens **never** hit logs (httpx logger redacts `Authorization`).
- The `/setup/jira` endpoint validates the token by calling `/rest/api/3/myself`, then writes to `.env` via an atomic-rewrite helper (write to `.env.tmp`, fsync, rename). No process restart required — the FastAPI app reloads the Jira client config in-process.

## First-run hardening checklist

These should all be exercised before declaring Phase 1 done:

- [ ] Bad token in setup form → backend returns 401 + error message; `.env` not modified.
- [ ] Network error during setup test → backend returns 503 + retryable error; `.env` not modified.
- [ ] Sync triggered before setup complete → returns 503 with `setup_required`.
- [ ] Two sync requests fired within 100 ms → second one returns 409 `sync_in_progress`.
- [ ] Backend killed mid-sync → orphaned `sync_runs` row in `running` state; on next start, mark stale `running` rows as `failed` with error_message="orphaned at startup".
- [ ] Postgres unavailable → `/health` returns `db: error`; data routes return 503.
