# Local App — Build Status

**Last updated:** 2026-04-30
**Current phase:** Pre-Phase-1 → Phase 1 ready to begin
**Current step:** 1.1 (repo scaffolding) — pre-Phase-1 complete

This file tracks live progress. Update as steps complete; commit alongside the work. Other files in this folder are specs that change rarely.

---

## Pre-Phase-1 (planning + setup)

- [x] 0.1 Execute the documentation split — `docs/local-app/` populated.
- [x] 0.2 Initiative custom field spike — **resolved 2026-04-30 via Atlassian MCP**: no Initiative custom field; Initiatives are issue type 10527 linked via standard `parent`. See [00-context-and-decisions.md §0.2](./00-context-and-decisions.md).
- [x] 0.3 Ground-truth baseline — **resolved 2026-04-30 via Atlassian MCP**. Sprint 18279 ("Search 2026-08", board 135): 140 issues, 307 in-sprint SP, 157 strict-completed SP, 47 carry-overs. Full per-person breakdown in [09-verification.md](./09-verification.md).

## Phase 1 — Data Foundation

- [ ] 1.1 Repo scaffolding (backend + frontend + infra + Makefile)
- [ ] 1.2 First-run setup UX
- [ ] 1.3 Full schema (Alembic baseline migration)
- [ ] 1.4 Jira client port + tests
- [ ] 1.5 Sync engine (full + incremental + weekly full-scan + comments)
- [ ] 1.6 Snapshot diff at sync time
- [ ] 1.7 Project freeze job at sync time
- [ ] 1.8 Leave + holiday data + endpoints
- [ ] 1.9 Raw read API for verification
- [ ] 1.10 Frontend shell + `/debug` page

**Phase 1 acceptance:** see [09-verification.md §Phase 1](./09-verification.md#phase-1-data-foundation).

## Phase 2 — UX Design

- [ ] 2.1 Design tokens
- [ ] 2.2 Component catalog
- [ ] 2.3 Page wireframes (every route)
- [ ] 2.4 Interaction patterns
- [ ] 2.5 States gallery

## Phase 3 — Sprint Health

- [ ] 3.1 Metrics endpoints (velocity, scope-changes, carry-over, blockers, sprint rollup)
- [ ] 3.2 Sprint Health React page
- [ ] 3.3 Ground-truth verification
- [ ] 3.4 Retire Apps Script `sprint-health` daily trigger

## Phase 4 — Epic Risk + Hygiene

- [ ] 4.1 Epic Risk metrics endpoints
- [ ] 4.2 Epic Risk React page
- [ ] 4.3 Hygiene endpoints
- [ ] 4.4 Hygiene React page
- [ ] 4.5 Cross-page polish
- [ ] 4.6 Retire Apps Script `epic-risk` daily trigger; mark `apps-script/` + `web/` deprecated

## Phase 5 — Projects + Monitoring

- [ ] 5.1 Projects backend (`/projects`, `/projects/{name}`, `/projects/comparison`)
- [ ] 5.2 Projects list page
- [ ] 5.3 Project drill-in
- [ ] 5.4 Monitoring/comparison page

## Phase 6 — Decommission legacy

(Starts only after a 2-week soak period of real use post-Phase-5.)

- [ ] Soak period elapsed; no fallback to legacy
- [ ] 6.1 Final verification checklist (see [09-verification.md](./09-verification.md))
- [ ] 6.2 Delete `apps-script/`
- [ ] 6.3 Delete `web/`
- [ ] 6.4 Update root README to point at `docs/local-app/README.md`
- [ ] 6.5 Tag pre-deletion commit

---

## Notes / Blockers

> _Append dated entries as relevant._

- 2026-04-30: Documentation split executed; plan file at `~/.claude/plans/the-project-that-we-enchanted-bee.md` deleted (specs in `docs/local-app/` are the source of truth).
- 2026-04-30: Initiative spike resolved via Atlassian MCP — no custom field; use standard `parent` field on Epics (issuetype id 10527 = Initiative).
- 2026-04-30: Custom-field IDs locked from MCP spike — Story Points = `customfield_10901`, Sprint = `customfield_10007` (modern object format only), Team = `customfield_10500`. Epic Link / Initiative Link not used (everything via standard `parent`).
- 2026-04-30: Ground-truth baseline captured for sprint 18279. Strict-completed = 157 SP across 47 people-tickets; 2 tickets resolved before sprint start correctly excluded.
