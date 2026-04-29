# 00 — Context & Decisions

## Context

Today the repo runs two dashboards (Sprint Health, Epic Risk) on a chain of: **Apps Script → Google Sheet → CSV export → static HTML**. Every new feature requires edits in four places (Apps Script, Sheet schema, CSV export step, HTML page) and the user is tired of the ritual. Jira's own UI is also slow for the small subset of features actually used.

**The pivot:** stand up a local **FastAPI + Postgres** backend that owns all Jira data for the user's team, with a **React + TanStack Query** frontend talking only to that backend. Periodic + on-demand sync from Jira. Read-only v1; write-back, leaderboards, and AI insights are explicitly v2+.

## Decisions locked

- **Backend:** Python + FastAPI + Postgres (room to add pandas/Claude later).
- **v1 scope:** read-side coverage of both dashboards + hygiene. No comments display, no leaderboard, no AI in v1.
- **Migration:** freeze `apps-script/` today — no new feature work there. Existing daily trigger keeps running passively as a fallback during build-out; retired phase-by-phase as the new system gets functional.
- **The Apps Script + Google Sheet implementation is a POC reference, NOT a port target.** Many things in the legacy implementation are wrong or dated. The new system is free to redesign metrics, table shapes, and UI affordances if there's a better way. Apps Script files are useful for understanding *what concepts exist* (velocity, carry-over, scope churn) and *how Jira's quirks were handled* (pagination, field discovery, retry) — not for copying logic line-for-line. **No data migration from the Sheet.** Start clean.

## Display conventions (locked)

- **Due-date bands** for `/hygiene/by-due-date`, project ETD, and any due-date column elsewhere: past due = red, due in ≤7 days = yellow, due in 8–30 days = green, >30 days = grey.
- **Sync staleness bands** for the global badge: ≤24h = green, 24–72h = yellow, >72h = red.
- **Velocity-drop bands** (carried from Apps Script): current vs. person's prior-3-sprint average — green ≥80%, yellow 50–79%, red <50%.
- **Commitment-accuracy bands**: green ≥85%, yellow 60–84%, red <60%.
- **Blocker-age bands**: yellow 3–7 days, red >7 days.

## Constants the new system inherits from the old

- **Tenant:** `https://eagleeyenetworks.atlassian.net`
- **Team filter:** `cf[10500] = "02623aed-f05b-4acd-8187-7932552722de-28"` (legacy "Search team"). **Sub-task caveat:** sub-tasks frequently inherit `cf[10500]` (per the user's memory note about this tenant), but the JQL must explicitly cover the case where they do not — final query is `(cf[10500] = "<id>") OR (parent in (... team-scope keys ...))`. Verified pattern: latest commit `bff882f` "Filter child tickets to the Search team at the JQL layer".
- **Sprint name prefix:** `"Search "`
- **Auth:** Jira email + API token (Basic auth)
- **Custom fields auto-discovered at runtime via `/rest/api/3/field`:** Story Points, Sprint, Epic Link. **Initiative is NOT a custom field** — confirmed by spike (see §0.2 below). It's a regular issue type (id 10527, hierarchyLevel 2); link via standard `parent` field on Epics.
- **Sprint custom field has two payload shapes** in Jira: legacy GreenHopper-stringified array (`com.atlassian.greenhopper.service.sprint.Sprint@hash[id=...,name=...]`) vs. modern object array. Apps Script `JiraClient.gs` already handles both — port the parser verbatim.
- **Status mapping:** Jira's `statusCategory.key` is one of `new|indeterminate|done`. Store the raw key in `issues.status_category` and translate at render time (`new→todo`, `indeterminate→in_progress`, `done→done`). Keeping the raw value avoids losing fidelity to Jira's actual category.
- **"Done SP" definition (locked):** `status_category = 'done' AND resolution_date IS NOT NULL AND resolution_date BETWEEN sprint.start_date AND sprint.complete_date` (or `end_date` if `complete_date` is null). Both conditions matter — a ticket can be `done`-category without a `resolution_date` if reopened-and-closed across sprint boundaries.

## Resolved decisions log

(Tracked here so we don't re-litigate during build.)

- **Sprint length** — derived from `sprints.start_date`/`end_date`. No fixed-day assumption.
- **Working days per sprint** — weekday count between sprint start/end minus rows in `holidays` for the team's region.
- **Snapshot baseline timing** — counterfactual: `first_sp = 0` for mid-sprint additions, with a `change_type='added_mid_sprint'` event recording the +SP creep. `was_added_mid_sprint` flag on the snapshot row identifies the entry. Backfill mode (initial sync) is silent regardless.
- **Due-date bands** — past = red, ≤7d = yellow, 8–30d = green, >30d = grey.
- **Comparison baseline** — median/p25/p75 across all closed snapshots, no size-matching. Empty state when n<5.
- **Comments** — synced full (id, author, ADF body, plaintext) in Phase 1; display/write-back in v2/v3.
- **Apps Script as POC reference, not port target** — semantics free to redesign; no data migration from Sheet.
- **TicketState migration** — none. New system starts clean.
- **Settings page surface** — Jira creds, sync schedule, team filter, board ID, holidays, plus first-class leave management.
- **Sync scope** — all team tickets ever; first run is full backfill (5–15 min), subsequent runs incremental on `updated >=`, weekly full-scan catches removals.
- **Docker** — Postgres in Docker only; backend native via `uvicorn --reload` for fast dev. v3 deployment containerises backend if needed.

## Pre-Phase-1 tasks (must complete before any Phase 1 step starts)

| Step | What | Est. |
|---|---|---|
| 0.1 | Execute the documentation split — already done with this commit. | (done) |
| 0.2 | ✅ **DONE 2026-04-30** — Initiative spike: confirmed no "Initiative Link" custom field; Initiatives are issue type 10527 linked via standard `parent`. See §0.2 outcome below. | (done) |
| 0.3 | **Ground-truth baseline data**: pick one closed sprint (e.g. the most recent) and capture its actual numbers (committed SP, completed SP per person, carry-overs) directly from Jira UI / JQL. Save to [09-verification.md](./09-verification.md) as the reference point for Phase 3 verification. | 30 min |

### 0.2 Initiative spike — outcome (resolved 2026-04-30)

**No "Initiative Link" custom field exists on this tenant. Initiative is a regular issue type, and Epics link to their Initiative via the standard `parent` field — same shape as sub-task → parent.**

Hierarchy on `eagleeyenetworks.atlassian.net`:

```
Initiative   issuetype id=10527, hierarchyLevel=2, name="Initiative"
  └─ Epic    issuetype id=10000, hierarchyLevel=1, name="Epic"
       └─ Story / Task / Bug   (hierarchyLevel=0)
              └─ Sub-task      (subtask=true)
```

**Implications for the schema and sync:**

- Drop "Initiative Link custom-field discovery" from the Phase 1 Jira-client port. Custom-field discovery still runs for Story Points, Sprint, and Epic Link.
- Populate `initiatives.issue_key` from `epics.raw_payload.fields.parent` where `parent.fields.issuetype.name = 'Initiative'`. No customfield_* lookup needed.
- During sync, when an Epic is upserted, capture its parent issue key. If that parent isn't already in `initiatives`, fetch it (alongside other parent-epic lookups in step 5 of the sync pipeline).
- Verified against a real team Epic whose parent is `EEPD-86170` ("Point of Sale (POS) Integration - 7 Eleven", an Initiative). Sample issue lookup ran via Atlassian MCP at the time of this spike.

**One-line summary:** epic→initiative is plain `parent`; no custom field involved.

## Phase 2 inputs (decided during UX design, not now)

These are deliberately deferred to Phase 2 because the answers depend on layout decisions made there, not on architectural concerns:

- **Dark mode in v1 or v3?** Phase 2 designs both modes; Phase 4 polish wires the toggle. (Decided during 2.1 tokens step.)
- **`/leaderboard` and `/insights` placeholders in nav?** Phase 2 designs the empty states or omits them. (Decided during 2.3 wireframes.)
- **Mockup file location** — `frontend/mockup/` or `frontend/src/mockup/`. (Decided during 2.0 setup of mockup scaffold.)
- **Sprint dropdown default when no active sprint exists** — show most recent closed? Empty state? (Decided during 2.3 sprint-health wireframe.)
- **`/hygiene/by-due-date` scope** — open tickets only or include closed-late tickets for retrospective view? Probably include both with a toggle. (Decided during 2.3 hygiene wireframe.)
- **Leave management page placement** — under `/settings`, dedicated `/leaves` route, or both? (Decided during 2.3 wireframes; see [04-api-contract.md](./04-api-contract.md) for endpoints.)

## Defaults locked for low-priority items

- **OpenAPI TS generation:** `make gen-types` runs manually after backend changes; also part of `make dev` first-run. No pre-commit hook (too noisy when iterating on backend).
- **Logging level:** `LOG_LEVEL` env var, default `INFO`. Bump to `DEBUG` for troubleshooting. Per-sync verbose flag deferred to first time it's needed.
- **Holidays seed file:** `infra/holidays/IN.yaml`, calendar year coverage; user updates yearly. Schema supports multi-region for future.
