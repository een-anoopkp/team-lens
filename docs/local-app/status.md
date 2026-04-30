# Local App — Build Status

**Last updated:** 2026-04-30
**Current phase:** Phase 6 — Decommission legacy (done)
**Current step:** all phases shipped. Project is in steady-state — feature work driven by usage, not by plan.

This file tracks live progress. Update as steps complete; commit alongside the work. Other files in this folder are specs that change rarely.

---

## Pre-Phase-1 (planning + setup)

- [x] 0.1 Execute the documentation split — `docs/local-app/` populated.
- [x] 0.2 Initiative custom field spike — **resolved 2026-04-30 via Atlassian MCP**: no Initiative custom field; Initiatives are issue type 10527 linked via standard `parent`. See [00-context-and-decisions.md §0.2](./00-context-and-decisions.md).
- [x] 0.3 Ground-truth baseline — **resolved 2026-04-30 via Atlassian MCP**. Sprint 18279 ("Search 2026-08", board 135): 140 issues, 307 in-sprint SP, 157 strict-completed SP, 47 carry-overs. Full per-person breakdown in [09-verification.md](./09-verification.md).

## Phase 1 — Data Foundation

- [x] 1.1 Repo scaffolding (backend + frontend + infra + Makefile) — commit `2f776bf`
- [x] 1.2 First-run setup UX — commit `d06f002`
- [x] 1.3 Full schema (Alembic baseline migration) — commit `dbb2525`
- [x] 1.4 Jira client port + tests — commit `d52d8ab`
- [x] 1.5 Sync engine (full + incremental + weekly full-scan + comments) — commit `c82ea5f`
- [x] 1.6 Snapshot diff at sync time — commit `f238bae`
- [x] 1.7 Project freeze job at sync time — commit `28686ac`
- [x] 1.8 Leave + holiday data + endpoints — commit `58bcd01`
- [x] 1.9 Raw read API for verification — commit `3cc9bb8`
- [x] 1.10 Frontend shell + `/debug` page — commit `a063319`

**Phase 1 acceptance:** see [09-verification.md §Phase 1](./09-verification.md#phase-1-data-foundation). Acceptance walk-through pending (requires `make setup && make dev` + first-time Jira sync against the live tenant).

## Phase 2 — UX Design — done 2026-04-30

- [x] 2.1 Design tokens — commit `7648860` (`tokens.css` + `tokens.html`)
- [x] 2.2 Component catalog — commit `a3350a3` (mockup index + CSS + glue JS)
- [x] 2.3 Page wireframes — commit `676fe21` (13 routes filled)
- [x] 2.4 Interaction patterns — commit `3710a26` (6 live demos)
- [x] 2.5 States gallery + UX-design doc finalised — this commit

## Phase 3 — Sprint Health — done 2026-04-30

- [x] 3.1 Metrics endpoints — commit `b42f0b9` (velocity, carry-over, blockers, burnup, sprint_rollup; working_days helper)
- [x] 3.2 Sprint Health React page — commit `240c2a7` (full Phase-2 mockup wired to live data)
- [x] 3.3 Ground-truth verification — 10/10 per-person rows match Jira; total 157 SP exact. See [09-verification.md](./09-verification.md#phase-3-sprint-health--accepted-2026-04-30).
- [x] 3.4 Retired Apps Script `sprint-health` daily trigger; README marked deprecated. (Directory deletion happens in Phase 6 after the 2-week soak.)

## Phase 4 — Epic Risk + Hygiene — done 2026-04-30

- [x] 4.1 Epic Risk metrics endpoints — commit `89b8664` (`/metrics/epic-risk`, `/metrics/epic-throughput`)
- [x] 4.2 Epic Risk React page — this commit (4 KPIs + risk-card grid + throughput chart)
- [x] 4.3 Hygiene endpoints — commit `89b8664` (`/hygiene/epics-no-initiative`, `/tasks-no-epic`, `/by-due-date`)
- [x] 4.4 Hygiene React page — this commit (3 sortable panels + include-closed toggle)
- [x] 4.5 Cross-page polish — RefreshButton invalidates everything (`e5ef028`), ThemeToggle wired, JiraLink everywhere (`3824496`)
- [x] 4.6 Retired Apps Script `epic-risk` daily trigger; README marked deprecated.

## Phase 5 — Projects + Monitoring — done 2026-04-30

- [x] 5.1 Projects backend (`/projects`, `/projects/{name}`, `/projects/comparison`) — commit `ecb3b97`
- [x] 5.2 Projects list page — commit `81a6adb`
- [x] 5.3 Project drill-in — commit `e970f0e`
- [x] 5.4 Monitoring/comparison page — commit `2ed7e91`
- [x] Polish: `InfoIcon` helper + tooltips on ambiguous columns (Velocity, Churn, Sprints, etc.) — commit `defb00c`

## Phase 6 — Decommission legacy — done 2026-04-30

User opted to skip the 2-week soak — confirmed they're no longer using
Apps Script. Tag `pre-phase-6-deletion` captures the legacy snapshot
before deletion; restore with `git checkout pre-phase-6-deletion -- apps-script web`.

- [x] 6.1 Final verification checklist — every legacy use case is now
      served by a Phase-3/4/5 page (Sprint Health velocity / carry-over /
      blockers / 6-sprint trend; Epic Risk hero stats / cards /
      throughput; Hygiene counts).
- [x] 6.2 Deleted `apps-script/` (16 tracked + 2 untracked .clasp.json files)
- [x] 6.3 Deleted `web/` (10 tracked + 9 untracked CSV exports)
- [x] 6.4 Root README rewritten to lead with the local app
- [x] 6.5 Pre-deletion commit tagged as `pre-phase-6-deletion`

---

## Notes / Blockers

> _Append dated entries as relevant._

- 2026-04-30: Documentation split executed; plan file at `~/.claude/plans/the-project-that-we-enchanted-bee.md` deleted (specs in `docs/local-app/` are the source of truth).
- 2026-04-30: Initiative spike resolved via Atlassian MCP — no custom field; use standard `parent` field on Epics (issuetype id 10527 = Initiative).
- 2026-04-30: Custom-field IDs locked from MCP spike — Story Points = `customfield_10901`, Sprint = `customfield_10007` (modern object format only), Team = `customfield_10500`. Epic Link / Initiative Link not used (everything via standard `parent`).
- 2026-04-30: Ground-truth baseline captured for sprint 18279. Strict-completed = 157 SP across 47 people-tickets; 2 tickets resolved before sprint start correctly excluded.
- 2026-04-30: Phase 1 fully committed across 10 sub-steps (commits `2f776bf` → `a063319`). Code is syntactically validated (Python ast.parse + JSON/YAML/TOML loads all clean). End-to-end run still pending — first acceptance walk-through requires `make setup` (uv sync, npm install, alembic upgrade, docker compose) followed by `make dev` and the in-app `/setup` flow.
- 2026-04-30: Phase 1 acceptance pass: 14 bugs found and fixed during live e2e (see commits `9ea4e4f` through `bcc1dc3`). 20/20 endpoint tests passing; full backfill of 4817 issues; subsequent incremental sync 7 issues in 3s. Browser walkthrough confirmed UI rendering. Deferred manual checks (F1-F5) noted in `09-verification.md` for later. Phase 1 closed.
- 2026-04-30: Phase 2 (UX Design) complete in 5 sub-steps: tokens locked (anchored on legacy palette + dark mode designed), component catalog as static HTML, 13 page wireframes with realistic placeholder data, 6 live interaction demos (refresh, modal, sort/filter, deep-link, keyboard, copy-URL), 5-state gallery (empty/loading/error/partial/sync-failed-stale). All deliverables in `frontend/mockup/` — open `frontend/mockup/index.html` to walk through.
- 2026-04-30: Phase 3 (Sprint Health) complete in 4 sub-steps. 6 metrics modules (working_days, velocity, carry_over, blockers, burnup, sprint_rollup) all pure SQL on synced data. Sprint Health React page implements the Phase-2 mockup against `useSprintRollup` / `useBurnup` / `useCarryOver` / `useBlockers` / `useVelocity` hooks. Ground truth: every per-person SP figure for sprint 18279 matches the Phase-1 baseline exactly (10/10 rows). Apps Script `sprint-health` README marked deprecated; daily trigger retired.
- 2026-04-30: Phase 5 (Projects + Monitoring) complete in 4 sub-steps. Backend module `app/metrics/projects.py` adds `list_projects`, `get_project`, and `compare_projects` — pure SQL on already-synced data. Three new endpoints under `/api/v1/projects/` plus `/raw` (kept). React pages `/projects`, `/projects/:name`, `/projects/monitoring` wired with `useProjects` / `useProject` / `useProjectComparison` hooks. Live tenant: 5 epics labelled `proj_evs1` / `proj_poi1` → 2 active projects discovered; comparison columns render "n/a" until ≥5 closed snapshots accumulate. Soak period for Phase 6 starts now.
