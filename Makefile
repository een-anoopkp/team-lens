# team-lens Makefile

.PHONY: setup db-up db-down dev backend frontend test gen-types backup restore seed-holidays clean

# --- One-time setup -------------------------------------------------------------

setup:
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env; \
		echo "Wrote backend/.env from template. Edit JIRA_EMAIL + JIRA_API_TOKEN."; \
	fi
	cd backend && uv sync
	cd frontend && npm install
	$(MAKE) db-up
	cd backend && uv run alembic upgrade head

# --- Database -------------------------------------------------------------------

db-up:
	docker compose -f infra/docker-compose.yml up -d postgres

db-down:
	docker compose -f infra/docker-compose.yml down

# --- Dev mode -------------------------------------------------------------------

dev: db-up
	@echo "Run these in separate terminals:"
	@echo "  make backend     # uvicorn at :8000"
	@echo "  make frontend    # vite at :8081"

backend:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev

# --- Testing --------------------------------------------------------------------

test:
	cd backend && uv run pytest

# --- Type generation ------------------------------------------------------------

gen-types:
	cd frontend && npm run gen-types

# --- Database backup / restore --------------------------------------------------

backup:
	@mkdir -p infra/backups
	@docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U teamlens teamlens > infra/backups/teamlens-$$(date +%F).sql
	@echo "Backup written to infra/backups/teamlens-$$(date +%F).sql"
	@find infra/backups -name 'teamlens-*.sql' -mtime +14 -delete

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=infra/backups/teamlens-2026-MM-DD.sql"; exit 1)
	@docker compose -f infra/docker-compose.yml exec -T postgres psql -U teamlens teamlens < $(FILE)

# --- Seeding --------------------------------------------------------------------

seed-holidays:
	cd backend && uv run python -m scripts.seed_holidays

# --- Cleaning -------------------------------------------------------------------

clean:
	rm -rf backend/.venv backend/.pytest_cache backend/.ruff_cache
	rm -rf frontend/node_modules frontend/dist
