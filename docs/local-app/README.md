# Local App — Architecture & Build Plan

A self-hosted FastAPI + Postgres + React replacement for the legacy Apps Script + Google Sheet + CSV pipeline.

## Index

| File | What's in it |
|---|---|
| [00-context-and-decisions.md](./00-context-and-decisions.md) | Why we're pivoting, locked decisions, constants, display conventions, resolved-decisions log, pre-Phase-1 tasks. **Start here.** |
| [01-architecture.md](./01-architecture.md) | System diagram, repo layout, critical files (POC reference vs. port targets). |
| [02-database-schema.md](./02-database-schema.md) | All Postgres DDL: `people`, `sprints`, `issues`, `ticket_state_snapshots`, `scope_change_events`, `comments`, `holidays`, `leaves`, etc. + PK conventions. |
| [03-sync-engine.md](./03-sync-engine.md) | Sync pipeline: full backfill + incremental + weekly full-scan. Snapshot diff. Cold-start cost, timezone, removal detection. |
| [04-api-contract.md](./04-api-contract.md) | First-run setup UX, settings page, leave management, full API surface table. |
| [05-frontend.md](./05-frontend.md) | Stack, routes, state management, refresh/staleness flow, visual patterns. |
| [06-phases.md](./06-phases.md) | The 6-phase build sequence with MVP demos and review checkpoints. |
| [07-ux-design.md](./07-ux-design.md) | Phase 2 deliverable — populated during the UX design phase. |
| [08-operations.md](./08-operations.md) | Backup/restore, logging, process supervision, PM-sharing reality check. |
| [09-verification.md](./09-verification.md) | Per-phase verification, Jira mocking, ground-truth checks. |
| [10-roadmap-v3.md](./10-roadmap-v3.md) | v2/v3 roadmap: projects view, comments write-back, PR-review queue, leaderboard, AI insights. |
| [status.md](./status.md) | **Live progress tracker.** Checkbox per step, last-updated date, blockers/notes. |

## Conventions

- Numbered prefixes ensure reading order in any file browser; renumber freely if reorganising.
- `status.md` is the only file that churns frequently; the rest are specs that change rarely. PRs that update implementation status only touch `status.md` and don't churn the spec.
- Cross-references between files use relative links: `[architecture](./01-architecture.md)`.

## TL;DR

- **Goal:** stand up a local FastAPI + Postgres backend that owns all Jira data for the Search team, with a React + TanStack Query frontend talking only to that backend. Periodic + on-demand sync from Jira.
- **6 phases, ~25.5 working days + 2-week soak.**
- **Apps Script + Sheet POC is reference, not a port target.** Start clean — no data migration.
- **Phase 1 owns all backend / sync / storage.** Phases 2–5 are pure frontend + SQL aggregation. Phase 6 is decommission.
