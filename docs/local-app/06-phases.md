# 06 — Build Sequence (Phased MVPs)

**Phasing principle:** Phase 1 owns **every backend / Jira-side concern** — all schema, all sync, all data ingestion, all sync-time post-processing. Phases 2–5 are then almost pure frontend + SQL-aggregation work, with no new Jira calls and no schema changes (except occasional index additions). This concentrates Jira fragility in one phase: if Jira changes its API later, only Phase 1 code is at risk.

Each phase ends with a runnable, reviewable MVP. After every phase: stop, demo it, decide whether to proceed, iterate, or change direction.

## Total: ~25.5 working days across 6 phases (+ 2-week soak before Phase 6)

| Phase | Focus | Est. |
|---|---|---|
| [Phase 1](#phase-1--data-foundation-all-backend-all-sync-all-storage) | Data Foundation — all backend + sync + storage | ~10.5d |
| [Phase 2](#phase-2--ux-design-collaborative-no-production-code) | UX Design — tokens, components, wireframes, states gallery | ~4d |
| [Phase 3](#phase-3--sprint-health-implementation) | Sprint Health frontend + metrics | ~3.5d |
| [Phase 4](#phase-4--epic-risk--hygiene-implementation) | Epic Risk + Hygiene frontends | ~4.5d |
| [Phase 5](#phase-5--projects--monitoring-implementation) | Projects + Monitoring | ~3d |
| [Phase 6](#phase-6--decommission-legacy-after-a-soak-period) | Decommission legacy (after 2-week soak) | ~0.5d |

---

## Phase 1 — Data Foundation (all backend; all sync; all storage)

**Goal:** every byte of data the v1+v2-A roadmap will ever need is being correctly synced and stored. By the end of this phase, the backend is "done" for the next three phases — the only further backend work will be SQL-aggregation endpoints (no new sync paths, no new schema). Frontend in this phase is **deliberately minimal**: just enough to verify the data is right.

| Step | What | Est. |
|---|---|---|
| 1.1 | Repo scaffolding: `backend/` (uv + FastAPI + SQLAlchemy 2.x async + Alembic + httpx + APScheduler + Pydantic v2), `frontend/` (Vite + React + TS + TanStack Query), `infra/docker-compose.yml` (Postgres 16), `Makefile` (`setup`, `dev`, `sync`, `test`, `gen-types`, `backup`). | 0.5d |
| 1.2 | First-run setup UX: `.env.example` ⇒ `.env` flow; `/api/v1/setup/jira` endpoint with atomic `.env` rewrite + in-process Jira client reload; minimal frontend setup page; health-gate routing (everything 503s until configured). | 1d |
| 1.3 | **Full schema, all phases.** One Alembic baseline migration covering every table from [02-database-schema.md](./02-database-schema.md). Indexes per the schema section. Done once, never revisited (modulo bugfixes). | 1d |
| 1.4 | Jira client port (`backend/app/jira/client.py`): auth, paginate, 429/503 retry honouring `Retry-After`. **Custom fields needed: Story Points (`customfield_10901`), Sprint (`customfield_10007`), Team (`customfield_10500`)** — all confirmed via spike. Discovery runs at startup as a safety net but `.env` ships with the IDs as defaults. Epic Link / Initiative Link discovery NOT needed — both hierarchy links use standard `parent`. Sprint-field shape on this tenant is modern object array (no GH-string fallback required). Unit tests with `respx` fixtures captured via `scripts/capture_jira_fixtures.py`. | 1d |
| 1.5 | Sync engine: full backfill + incremental + weekly full-scan. JQL `(cf[10500]=team OR parent in (cf[10500]=team))`. Comments fetched per-issue via `/rest/api/3/issue/{key}/comment` (batched, paginated) and upserted into `comments` table on every sync. Removal detection via full-scan `last_seen_at`/`removed_at` for both issues and comments. APScheduler wired in app lifespan with `Asia/Kolkata` timezone. Concurrency lock. | 2d |
| 1.6 | **Snapshot diff at sync time.** Apply Case A/B/C rules from [03-sync-engine.md](./03-sync-engine.md) to populate `ticket_state_snapshots` + `scope_change_events`. Wired as the final step of every sync run. | 1d |
| 1.7 | **Project freeze job at sync time.** End-of-sync hook detects newly-Completed projects (every labelled epic Done) and snapshots stats into `project_snapshots`. Idempotent. Handles re-open → re-complete. | 1d |
| 1.8 | **Leave + holiday data.** Endpoints `GET/POST/PATCH/DELETE /api/v1/leaves` and `GET/POST/DELETE /api/v1/holidays`. Seed: `infra/holidays/IN.yaml` ships ~12 standard Indian public holidays per year for 2025/2026; `make seed-holidays` imports them. **Leaves start empty** — the user enters known upcoming leaves via the UI in Phase 1's `/debug` form (then properly via the leave-management UI designed in Phase 2). No CSV migration from the legacy Sheet. | 0.5d |
| 1.9 | Raw read API for verification: `/health`, `/sprints`, `/issues` (paginated, filterable), `/epics`, `/initiatives`, `/people`, `/leaves`, `/sync/run`, `/sync/status`, `/scope-changes` (raw events list), `/projects/raw` (just label-derived list, no ETD math). No derived metrics yet. | 1d |
| 1.10 | Frontend in Phase 1: AppShell with left-nav (other routes show "Coming in Phase N" placeholder), top-bar Refresh + StalenessBadge, setup page, **debug page** (`/debug`) showing tabbed views for every entity table — paginated, sortable, searchable. Plus a leaves CRUD form on `/debug`. | 1d |

**Phase 1 MVP demo:**

1. Cold install, paste Jira creds, click Test connection → green.
2. First full sync runs (5–15 min); progress UI ticks `issues_seen`.
3. `/debug` shows tabs for issues, sprints, epics, initiatives, people, ticket_state_snapshots, scope_change_events, comments, project_snapshots, leaves, holidays, sync_runs — every tab populated correctly.
4. Edit a Story Point in Jira, click Refresh; within ~1 min, scope_change_events tab shows the delta. Add a brand-new ticket to the active sprint mid-cycle in Jira → next sync produces a `change_type='added_mid_sprint'` row.
5. `psql -c "SELECT COUNT(*) FROM issues"` ≈ JQL count from Jira UI for `cf[10500]=team`.
6. Apps Script daily triggers continue running passively (untouched). They get retired in their respective implementation phases (Phase 3 retires sprint-health; Phase 4 retires epic-risk; Phase 6 deletes the directory).

**Review questions for end of Phase 1:**

- Are all team tickets present, including sub-tasks that don't carry `cf[10500]` directly?
- Are scope-change events firing correctly (SP, assignee, status, mid-sprint adds)? Any false positives?
- Did the freeze job correctly snapshot any already-completed projects (if you label some epics with `proj_*` for testing)?
- Is the first-run UX painless?
- Schema concerns surfaced by looking at real data?

**Phase 1 exit criterion:** zero further sync code or schema changes expected in Phases 2–5. If a Phase 2 design need surfaces a missing column, it's a Phase 1 bug to fix, not a phase boundary to redraw.

**Total Phase 1: ~10 working days** (-0.5d on step 1.4 due to simplified field discovery from spike findings).

---

## Phase 2 — UX Design (collaborative; no production code)

**Goal:** lock the entire look-and-feel and per-page layouts before any production frontend code gets written. Subsequent phases become pure implementation against a frozen reference, with no design-while-coding loops. This phase is **collaborative by design** — outputs land iteratively, each one reviewed and locked before the next starts.

**Why a phase, not a side-task:** every legacy page has its own ad-hoc styling, and the new system adds 4+ pages that didn't exist before. Without a unified design pass up front, each Phase 3/4/5 page would invent its own conventions, drift, and require post-hoc reconciliation. Doing it once here makes the back half cheaper and more consistent.

**Outputs (all checked in to the repo):**

- `docs/local-app/07-ux-design.md` — design rationale, tokens, component catalog, interaction patterns, accessibility decisions.
- `frontend/mockup/index.html` — single-file interactive click-through prototype covering every route and major state. Uses static JSON or hardcoded data — no backend dependency. Anyone can `open frontend/mockup/index.html` and clickthrough.
- `frontend/mockup/styles.css` — the actual token + component CSS that the React build will consume in Phase 3 (not a throwaway).
- `frontend/src/styles/tokens.css` — final tokens extracted from the mockup, ready for React.

| Step | What | Est. |
|---|---|---|
| 2.1 | **Design tokens proposal.** Color palette (light + dark), typography scale, spacing scale, radii, shadows, status colors (good/warn/bad — same semantics as today's CSS but consolidated). Side-by-side comparison: existing `web/sprint-health/styles.css` `:root` vars → proposed token set. Review checkpoint. | 0.5d |
| 2.2 | **Component catalog** as static HTML/CSS in the mockup: `KpiCard` (4 variants), `ProgressBar` (segmented), `SparklineTile`, `Pill`/`StatusPill`, `StalenessBadge`, `SprintBanner`, `Modal` shell, `DataTable` (with sort headers, pagination, empty/loading/error states), `CheckList`, `RefreshButton` (idle/syncing/error states), `EmptyState`, `LoadingState`, `ErrorState`, form inputs (text, date range, multi-select). Each component documented with intended usage. Review checkpoint. | 1d |
| 2.3 | **Page wireframes** in the mockup, one per route, each with realistic placeholder data: `/setup`, `/sprint-health` (active variant + closed variant), `/epic-risk`, `/hygiene`, `/projects`, `/projects/:name`, `/projects/monitoring`, `/leaves` (or under `/settings`), `/leaderboard` (empty-state placeholder), `/insights` (empty-state placeholder), `/settings`, `/debug`. Iteratively reviewed page-by-page. | 1.5d |
| 2.4 | **Interaction patterns** documented + demonstrated in the mockup: refresh flow (idle → syncing → done), modal open/close (whitelist/filter/leaves), table sorting + filtering, deep-linking (e.g. `/sprint-health?sprintId=...`), keyboard navigation (j/k, /, Esc), copy-URL with caveat label. Review checkpoint. | 0.5d |
| 2.5 | **States gallery** in the mockup: empty / loading / error / partial-data / sync-failed-but-stale-data-still-shown for every page. Forces the conversation about graceful degradation now, not later. Final review. | 0.5d |

**Phase 2 MVP demo:** `open frontend/mockup/index.html` in a browser; click through every route and state; nothing is dynamic but everything is visually final. The user can sit with it for a day, take a real-data screenshot from each legacy page, and confirm the new design covers every panel. Sign-off: `docs/local-app/07-ux-design.md` committed and tagged.

**Review questions for end of Phase 2:**

- Is the visual density right? Today's `web/sprint-health/` is dense; is the new design too roomy? Too cramped?
- Are there panels in legacy that don't have a clean home in the new design?
- Dark mode: included in v1 or punted?
- Is the navigation (left rail + top bar) ergonomic, or should it be top-only?
- Are empty/error states reassuring or scary?

**Phase 2 exit criterion:** every Phase 3/4/5 page has a pixel-faithful mockup that React just has to bring to life. If a Phase 3 implementer has to make a layout judgment call, that's a Phase 2 bug — pause and update the mockup.

**Total Phase 2: ~4 working days.**

---

## Phase 3 — Sprint Health (implementation)

**Goal:** replace the legacy `web/sprint-health/` page using Phase 1's synced data and Phase 2's locked design. Pure compute + frontend implementation; no design decisions in flight.

| Step | What | Est. |
|---|---|---|
| 3.1 | Metrics endpoints (pure SQL): `/metrics/velocity`, `/metrics/scope-changes`, `/metrics/carry-over`, `/metrics/blockers`, `/sprints/{id}` per-person rollup. Use `Aggregator.gs:466-742` as **conceptual reference** (what each metric means) but redesign freely if a cleaner SQL formulation surfaces. **No Jira calls.** | 1.5d |
| 3.2 | Sprint Health React page: implement the Phase 2 mockup directly, swapping placeholder data for `useQuery` calls. Leaves modal reads/writes `/api/v1/leaves` (DB-backed, no localStorage). | 1.5d |
| 3.3 | **Ground-truth verification** (replaces "parity sign-off"): for one closed sprint, manually verify the displayed numbers against Jira UI / direct JQL queries. Log any surprising discrepancies in [09-verification.md](./09-verification.md) with explanations. Goal is "the new numbers are correct" — not "the new numbers match the Sheet." | 0.5d |
| 3.4 | Retire Apps Script `sprint-health` daily trigger (no migration needed; just turn it off). | 0.1d |

**Phase 3 MVP demo:** `/sprint-health` numbers correct against Jira ground truth for one closed sprint. Apps Script sprint-health trigger off.

**Total Phase 3: ~3.5 working days.**

---

## Phase 4 — Epic Risk + Hygiene (implementation)

**Goal:** retire the second legacy dashboard and ship the net-new Hygiene view. After this phase, all of `apps-script/` and `web/` is dead code (deletion happens in Phase 6).

| Step | What | Est. |
|---|---|---|
| 4.1 | Epic Risk metrics endpoints (pure SQL); port `apps-script/epic-risk/Aggregator.gs`. | 1d |
| 4.2 | Epic Risk React page: implement the Phase 2 mockup. | 1d |
| 4.3 | Hygiene endpoints (pure SQL): `/hygiene/epics-no-initiative`, `/hygiene/tasks-no-epic`, `/hygiene/by-due-date`. | 0.5d |
| 4.4 | Hygiene React page: implement the Phase 2 mockup. | 1d |
| 4.5 | Cross-page polish that wasn't already locked into the design system: error toasts on sync failure, keyboard nav, dark-mode toggle wiring (if Phase 2 designed it), last-sync indicator. | 0.5d |
| 4.6 | Retire Apps Script `epic-risk` daily trigger. Mark `apps-script/` + `web/` deprecated in READMEs. (Actual deletion is Phase 6.) | 0.5d |

**Phase 4 MVP demo:** `/sprint-health`, `/epic-risk`, `/hygiene` all live; both Apps Script triggers off.

**Total Phase 4: ~4.5 working days.**

---

## Phase 5 — Projects + Monitoring (implementation)

**Goal:** ship the PM-shareable projects view + comparison table. The freeze job runs from Phase 1, so `project_snapshots` is populated; this phase exposes it.

| Step | What | Est. |
|---|---|---|
| 5.1 | Projects backend (pure SQL): `/api/v1/projects`, `/api/v1/projects/{name}`, `/api/v1/projects/comparison`. ETD by velocity + ETD by sprint-assignment. | 1.5d |
| 5.2 | Projects list page: implement Phase 2 mockup. | 0.5d |
| 5.3 | Project drill-in: implement Phase 2 mockup. | 0.5d |
| 5.4 | Monitoring/comparison page: implement Phase 2 mockup. | 0.5d |

**Phase 5 MVP demo:** label epics `proj_*`, sync, see them on `/projects`, drill in for ETD, view `/projects/monitoring` for historical comparison.

**Total Phase 5: ~3 working days.**

---

## Phase 6 — Decommission legacy (after a soak period)

**Goal:** delete the dead code. Final cleanup once the new system has proven itself in real use.

**Soak period before this phase starts:** at least **2 weeks of daily use** on the new system after Phase 5 ships, with no fallbacks to the legacy pages. The soak validates "the new system is actually useful" — not "the new system matches the Sheet" (we already decided the Sheet isn't the benchmark). If anything substantive surfaces (a metric we missed, a panel that shipped wrong), fix it first — don't delete code we might want to reference.

| Step | What | Est. |
|---|---|---|
| 6.1 | Final verification: every legacy use case (every CSV-driven view, every Apps Script daily output) is now served by the new system. Tick off a written checklist in [09-verification.md](./09-verification.md). | 0.25d |
| 6.2 | Delete `apps-script/` directory entirely (`epic-risk/` and `sprint-health/`). One commit, message: "Decommission Apps Script: superseded by local backend." | 0.1d |
| 6.3 | Delete `web/` directory entirely (`epic-risk/` and `sprint-health/`). One commit, message: "Decommission CSV-driven HTML pages: superseded by frontend/." | 0.1d |
| 6.4 | Remove references from root `README.md`. Update root README to point at `docs/local-app/README.md` as the canonical entry point. | 0.1d |
| 6.5 | Tag the pre-deletion commit (`pre-decommission-2026-MM-DD`) for easy reference if anything ever needs to be archaeologically retrieved. | 0.05d |

**Phase 6 MVP demo:** `apps-script/` and `web/` no longer exist on `main`; `git log --all -- apps-script/` still shows full history; root README points at the new docs.

**Why a separate phase, not just an end-of-Phase-5 cleanup:** the soak period is the whole point. Conflating "ship Phase 5" and "delete legacy" pressures you to skip the soak. Keeping them separate gives you permission to wait.

**Total Phase 6: ~0.5 working days** (plus 2-week soak).
