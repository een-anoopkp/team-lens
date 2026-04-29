# Per-Person Sprint Dashboard — Design

**Date:** 2026-04-22
**Owner:** Anoop K. Prabhu (Search team, 290)
**Status:** Design locked, ready for implementation

## Purpose

A private coaching dashboard for the team lead. Surfaces per-person progress within the active sprint and normalized velocity trends across recent sprints. Used daily for live intervention and at mid/end-of-sprint checkpoints for reflective review. Inputs 1:1s and sprint-planning adjustments.

Not shared with the team or upward for now. A future variant — team-facing, softened framing, or upward-reporting aggregate — can be derived from the same Sheet by adding a second export and a second web page. Deferred.

## Scope

- 10-member Search team, per-person rows.
- Active sprint + 6-sprint trailing trend.
- Per-person leave captured in a pre-existing Google Sheet (one row per person per leave day or leave range).
- Observed failure modes to surface: blocker aging (esp. PR review and cross-team dependencies), uneven load, carry-over creep, mid-sprint SP inflation on existing tickets, invisible work.
- Explicitly out: per-person velocity ranking / leaderboard framing. Velocity is normalized by available working days and used for trend, not for comparison across people.

## Sprint-health signals (the only ones that earn a column)

1. **Load balance** — SP committed vs. available working days, per person, this sprint.
2. **Blocker aging** — open sub-tasks sorted by days-since-last-transition; sub-tasks encode "waiting on X" via assignee.
3. **Scope inflation** — tickets whose Story Points value changed after sprint start.
4. **Carry-over depth** — tickets that have rolled across 2+ sprints and their owners.
5. **Normalized velocity** — `SP completed ÷ available working days` per person, trended across last 6 sprints. Leave-adjusted so sprints with OOO don't distort the signal.
6. **Commitment accuracy** (secondary) — `SP completed ÷ SP committed` per person, per sprint. Planning-quality signal, not throughput.
7. **Epic contribution** — SP done per person × quarter epic, bridges to the Epic Risk dashboard.

Hygiene guard rail: **unassigned or zero-SP tickets in sprint** — makes every other signal unreliable, so flagged explicitly.

## Foundation — root JQL filters

### Filter 1 — `Search-Sprint-Current`

```
cf[10500] = "02623aed-f05b-4acd-8187-7932552722de-28"
AND sprint in openSprints()
```

Open sprint for the Search team. Same `cf[10500]` team-field pattern as the Epic Risk dashboard. `openSprints()` is supported (unlike `startOfQuarter()`), so no quarterly edit tax.

### Filter 2 — `Search-Sprint-Subtasks-Open`

```
filter = <Filter 1 numeric ID>
AND issuetype = Sub-task
AND status != Done
ORDER BY updated ASC
```

Example with a real ID: `filter = 23075 AND issuetype = Sub-task AND status != Done ORDER BY updated ASC`.

This works because on this tenant, sub-tasks inherit `cf[10500]` from their parent — so reusing Filter 1's result set and then narrowing to sub-tasks returns the expected set. The design originally specified `parent in (filter = "Search-Sprint-Current")`, but Jira Cloud's native JQL does **not** accept `filter = X` as a sub-query value inside `parent in (...)` (parser error: `expecting ) or , but got =`). The top-level `filter = ID AND issuetype = Sub-task` composition is the supported form.

If sub-tasks on your tenant do not inherit the team field, fall back to a project-scoped form: `project in (EEPD, …) AND issuetype = Sub-task AND sprint in openSprints() AND status != Done`.

### Filter 3 — `Search-Sprint-Last6`

```
cf[10500] = "02623aed-f05b-4acd-8187-7932552722de-28"
AND sprint in closedSprints()
AND sprint in ( <last 6 sprint IDs, maintained in Config> )
```

For trend panels. Sprint IDs are written into the `Config` tab and refreshed when a sprint closes; Apps Script picks them up automatically.

## Architecture — two surfaces

**Jira dashboard** = daily live surface. The top zone: what needs attention today.

**Google Sheet + local web page** = checkpoint surface. Trend, carry-over, velocity, scope churn, leave-adjusted computations.

Apps Script on a daily trigger is the single data-flow path. The web page reads locally exported CSVs — no publish-to-web, no separate backend. Mirrors the Epic Risk dashboard stack exactly; see `epic-risk-design.md` → "Shared conventions".

```
Jira REST API                    Leave Sheet (existing)
     │                                  │
     ▼                                  ▼
Apps Script (daily 7am trigger) ◀───────┘
     │
     ▼
Google Sheet (Config · Leave · Tickets · Sprints · VelocityComputed · CarryOver · ScopeChanges · RunLog)
     │                │
     ▼                ▼
Sheet UI         Sheet menu: Export CSVs
(coaching prep)  (browser downloads)
                      │
                      ▼
                 ~/dashboards/sprint-health/*.csv
                      │
                      ▼
                 Local HTML page
                 (checkpoint view)
```

## Jira dashboard — contents

Daily, live. Four panels. No flags here (Jira cannot compute them cleanly); flags live in the Sheet.

- **Panel 1 — Per-person sprint load.** `Two Dimensional Filter Statistics`, rows = `assignee`, columns = `status`, values = `sum of Story Points`. Filter: `Search-Sprint-Current`. Reveals who's empty, who's stuck in review, who's overloaded.
- **Panel 2 — Aging sub-tasks by assignee.** `Filter Results`, filter: `Search-Sprint-Subtasks-Open`, sort: `updated ASC`. Columns: key, summary, assignee, status, updated. Sub-tasks free-form titled but assigned to the blocking member — age + assignee is the signal.
- **Panel 3 — Tickets in sprint.** `Filter Results` listing everything in `Search-Sprint-Current`, sorted by `assignee`. Baseline reference to cross-check against load panel.
- **Panel 4 — Hygiene.** Two small `Filter Results` count-only gadgets: (a) in-sprint tickets with `assignee is EMPTY`; (b) in-sprint tickets with `"Story Points" is EMPTY`. Both should stay at zero.

Scope-change detection is not in the Jira dashboard — Jira gadgets cannot read the changelog for SP field edits cleanly. That panel lives in the Sheet/web page.

## Google Sheet — structure

| Tab | Purpose | Refresh |
|-----|---------|---------|
| `Config` | Team ID, last-6 sprint IDs, flag thresholds, Jira base URL, leave-sheet ID | Manual |
| `Leave` | Per-person per-day (or range) OOO log. Columns: `person`, `start_date`, `end_date`, `note` | Manual (existing sheet) |
| `Tickets` | Raw rows — every ticket in current sprint + last 6 sprints | Script |
| `TicketState` | Per-ticket persisted snapshot `(ticket_key, sprint_name, last_sp, last_assignee, last_status, first_seen_iso, last_seen_iso)`. Upserted each run — never replaced. Drives snapshot-diff detection of mid-sprint SP changes. | Script (upsert) |
| `Sprints` | Per-sprint × per-person rollup: SP committed, SP completed, working days, leave days, available days | Script |
| `VelocityComputed` | Primary coaching view — one row per person × sprint with normalized velocity and commitment accuracy | Script |
| `CarryOver` | Tickets rolled across 2+ sprints, with owner and depth | Script |
| `ScopeChanges` | Tickets whose SP changed between successive refreshes, with delta and owner. Appends across runs. | Script (append) |
| `RunLog` | Timestamp + error trace per run | Script |

### `VelocityComputed` tab — columns

| Column | Contents |
|--------|----------|
| Person | Display name, matches Jira assignee exactly |
| Sprint | Sprint name |
| SP committed | Sum of SP on tickets assigned to person at sprint start |
| SP completed | Sum of SP on tickets the person closed during the sprint |
| Working days | Sprint length in working days (default 10) |
| Leave days | Days in `Leave` tab intersecting this sprint for this person |
| Available days | Working days − leave days |
| Velocity | SP completed ÷ available days |
| Commitment accuracy | SP completed ÷ SP committed |
| 🚩 Velocity drop | Emoji, see thresholds |
| 🚩 Accuracy drop | Emoji, see thresholds |

### Flag thresholds

| Flag | 🟢 Green | 🟡 Yellow | 🔴 Red |
|------|----------|-----------|---------|
| Velocity drop (current sprint vs person's own avg over prior 3) | ≥ 80% | 50–79% | < 50% |
| Accuracy drop (SP completed ÷ SP committed) | ≥ 85% | 60–84% | < 60% |
| Carry-over depth (sprints a ticket has spanned) | 1 | 2 | ≥ 3 |
| Blocker age (oldest open sub-task, days since last transition) | < 3 | 3–7 | > 7 |
| Scope inflation (SP % added after sprint start, per ticket) | 0% | 1–50% | > 50% |

All velocity comparisons are per-person vs. that person's own history — never cross-person. This framing is deliberate and prevents the dashboard from turning into a leaderboard when future access widens.

## Apps Script — behaviour per run

1. Read `Config` for team ID, last-6 sprint IDs, thresholds, leave-sheet ID.
2. Read the `Leave` tab (either in-sheet or via `SpreadsheetApp.openById`) into memory.
3. JQL fetches tickets in current sprint + each of last 6 sprints (Filter 1 and Filter 3), fields: `status`, `storypoints`, `assignee`, `resolutiondate`, `sprint`, `parent`. **No changelog expand** — SP history comes from the snapshot-diff loop below.
4. Load `TicketState` into memory (per-ticket last-seen snapshot from the previous run).
5. Per person × sprint:
   - `SP completed`: sum of SP on tickets the person closed during the sprint.
   - `SP committed`: sum of each ticket's **baseline SP** — the SP value observed the **first** time the ticket was seen in this sprint. Stored on `TicketState.first_sp` so it survives re-runs.
   - `leave days`, `available days`, `velocity`, `commitment accuracy` as defined above.
6. Scope inflation (snapshot-diff): for each current ticket, compare current SP against `TicketState.last_sp`. If different, emit one append row into `ScopeChanges` with `(ticket_key, assignee, sprint, detected_at=now, sp_before=last_sp, sp_after=current_sp, delta, pct_of_baseline)`. First-sighting of a ticket is **not** a scope change — it seeds the baseline silently.
7. Carry-over: for each active ticket, count the number of distinct sprints it's been assigned to; flag depth ≥ 2.
8. Compare against thresholds; emit flag states.
9. Write `Tickets`, `Sprints`, `VelocityComputed`, `CarryOver` in full (replace). **Upsert** `TicketState` (update in place, never clear). **Append** to `ScopeChanges` (preserve history across runs).
10. Log timestamp and any errors to `RunLog`.

**Auth:** Jira API token in Apps Script `PropertiesService` (user-level, not committed). Basic-auth header using `email:token`.

**Trigger:** daily at 07:00 local time. Daily cadence matters for the snapshot-diff approach — longer gaps collapse multiple edits into one delta.

**Estimated build effort:** ~4 hours for a first working version (snapshot-diff in place of changelog parsing removes the main complexity from the earlier ~6h estimate).

### Snapshot-diff vs. changelog parsing — decision

The design originally proposed parsing each ticket's Jira changelog for `Story Points` field changes after sprint start. That approach has two costs: extra API calls (`?expand=changelog`, separate history pagination for edit-heavy tickets), and more complex per-ticket logic. We rejected it in favour of **snapshot-diff**: on every run we persist each ticket's current SP to `TicketState`; on the next run we diff current SP against the persisted value and emit `ScopeChanges` rows for differences.

What we gain: zero additional Jira calls (same `searchJql` that already pulls the sprint tickets), and add/remove detection falls out for free (tickets entering/leaving a sprint show up as state transitions).

What we lose: (a) **timestamp is run-bucketed**, not exact — we know a change happened between run N-1 and run N, not the second of day; (b) **no editor attribution** — Jira's changelog tells you *who* clicked save, snapshot diff only knows the current assignee. For a coaching dashboard where the actionable signal is "this work drifted mid-sprint" neither loss is load-bearing.

Baseline handling: the first time a ticket is seen in a sprint, `TicketState.first_sp` is set and the run emits no `ScopeChanges` row — that SP value becomes the committed baseline. First-sprint-after-rollout is degraded (tickets edited before rollout look like baseline); steady state is fine.

## Local web visualization

A single `index.html` + one JS file, Chart.js for graphs, no framework, no build step. Served via `python -m http.server 8081` from `~/dashboards/sprint-health/`. Reads local CSVs — `velocity.csv`, `carry_over.csv`, `scope_changes.csv`, `epic_contribution.csv`, `meta.csv` — via `fetch('./velocity.csv')` etc. CSVs are produced by the Apps Script `Export CSVs` menu item (browser downloads); drop them into the folder after each refresh. Raw `Tickets`, `Sprints`, and `Leave` tabs are never exported.

A staleness badge in the page header reads `meta.csv`'s `last_run_iso` column: green ≤ 24h, yellow 24–72h, red > 72h. Same convention as Epic Risk.

### Layout — four things, nothing else

1. **Normalized velocity trend** — line chart, one line per person, last 6 sprints, y-axis = SP per available day. Legend-toggle to isolate a single person during a 1:1. Primary artifact.
2. **Commitment accuracy tile** — small multiples, one sparkline per person, last 6 sprints. Secondary to velocity.
3. **Carry-over table** — tickets with depth ≥ 2, sorted by depth descending. Owner, depth, last status, original SP, current SP.
4. **Sprint scope churn summary** — three numbers for the active sprint: SP added mid-sprint, SP removed mid-sprint, SP inflated on existing tickets. Plus per-ticket drill-down table.

Deliberate omissions: raw ticket tables, leave-day counts, per-person daily activity. Those live in the Sheet. Epic contribution 2D table also lives only in the Sheet for now — lightweight bridge to the Epic Risk dashboard, not worth a web surface until needed.

**Estimated build effort:** ~3 hours.

## Build sequence

1. Create saved filters `Search-Sprint-Current`, `Search-Sprint-Subtasks-Open`, `Search-Sprint-Last6` in Jira UI.
2. Build the Jira dashboard with the four native panels above.
3. Create the Google Sheet with the eight tabs and `Config` defaults. Link the existing `Leave` sheet via ID in `Config`.
4. Write the Apps Script; verify against one person × one sprint manually before turning on the daily trigger. Changelog parsing for sprint-boundary committed-set inference needs explicit test cases.
5. Add the `Sprint Health` Sheet menu with `Refresh from Jira` and `Export CSVs` items. `Export CSVs` emits `velocity.csv`, `carry_over.csv`, `scope_changes.csv`, `epic_contribution.csv`, and `meta.csv` as browser downloads.
6. Build the local HTML page against the exported CSVs; serve from `~/dashboards/sprint-health/`.

## Current status (2026-04-23)

Implementation is tracked in the `team-lens` repo (<https://github.com/een-anoopkp/team-lens>). This section mirrors the Epic Risk dashboard's status section and is updated as work lands.

**Done.**

- **Saved Jira filters (4 of 5):** `Search-Sprint-Current` (id 23075), `Search-Sprint-Subtasks-Open`, `Search-Sprint-Unassigned`, `Search-Sprint-NoSP`. Filter 2 uses the top-level composition `filter = 23075 AND issuetype = Sub-task AND status != Done ORDER BY updated ASC` — Jira Cloud native JQL does not accept `filter = X` as a sub-query value inside `parent in (...)`, so the design's original `parent in (filter = ...)` form was replaced. Documented above.
- **Jira dashboard:** `Search (290) - Sprint Health` created with the four gadgets per the design — per-person sprint load (Two Dimensional Filter Statistics), aging sub-tasks (Filter Results, `updated ASC`), tickets-in-sprint (Filter Results), hygiene (two stacked Filter Results on `Search-Sprint-Unassigned` and `Search-Sprint-NoSP`, both should read 0).
- Google Sheet and bound Apps Script created via `clasp`, owned by `kptikku@gmail.com`. Sheet ID `1jvQlzf…EvUY`, script ID `1-WeOkI…YycnH`.
- `Initialize Sheet` menu seeds all tabs (`Config`, `Tickets`, `TicketState`, `Sprints`, `VelocityComputed`, `CarryOver`, `ScopeChanges`, `EpicContribution`, `RunLog`) with header rows and Config defaults. Idempotent; no `Leave` tab (that sheet is external, referenced via `Config.leave_sheet_id`).
- Jira auth: `Set Jira Token` prompts for email + API token and stores them in user-level `PropertiesService`. `Test Jira auth` verifies with `/rest/api/3/myself`. No credentials touch the Sheet. JiraClient is at parity with Epic Risk (retry/backoff, `jiraPost`, paginated `searchJql`, `getCustomFieldId`).
- `Refresh from Jira` runs end-to-end: reads Config, reads the external Leave sheet if `leave_sheet_id` is set, auto-discovers Story Points + Sprint custom-field IDs, fetches current-sprint + last-6 sprint tickets via `/rest/api/3/search/jql`, harvests sprint metadata from the ticket sprint-array (no board-API call), snapshot-diffs against `TicketState` to emit `ScopeChanges`, rolls up per-person × per-sprint SP committed / completed / velocity / commitment-accuracy with leave-weekday adjustment, carry-over, and epic contribution, replaces/appends tabs, logs a RunLog row with `active_sprint`.
- `Export CSVs` opens a modal with one-click downloads of `velocity.csv`, `carry_over.csv`, `scope_changes.csv`, `epic_contribution.csv`, `meta.csv`. Raw `Tickets` / `TicketState` / `Sprints` stay Sheet-only by design.
- `Install daily trigger` / `Remove daily trigger` register and tear down a 07:00 Asia/Kolkata time-based trigger on `refreshFromJira`.
- `web/sprint-health/` page built: `index.html`, `app.js`, `styles.css`, `README.md`. Four panels — normalized velocity line chart with legend-toggle, commitment-accuracy sparkline tiles, carry-over table, active-sprint scope-churn summary with drill-down. Staleness badge (green ≤24h, yellow 24–72h, red >72h) reads `meta.csv`.
- Leave name-mismatch surfacing: after aggregation, Leave-sheet `person` values that don't match any Jira assignee seen in the current pull are counted into `RunLog.leave_name_mismatches`.
- **Last-6 sprint auto-resolution:** `Config.sprint_ids_last6` is no longer required. When it's empty (or missing), `autoResolveLast6SprintIds_` does a 5-row pre-fetch of active-sprint tickets to discover the scrum board's `boardId`, then pages `/rest/agile/1.0/board/{boardId}/sprint?state=closed` and keeps the 6 most recent sprints whose names start with `Config.sprint_name_prefix`. Those IDs are threaded into the main `fetchTickets_` JQL. Same pattern as the existing auto-discovery for Story Points / Sprint custom field IDs — zero per-quarter maintenance.
- Changelog parsing for `ScopeChanges` was replaced with snapshot-diff against a persisted `TicketState` tab. See "Snapshot-diff vs. changelog parsing — decision" above.

**Divergences from the Build sequence.**

- Build-sequence step 1 ("Create saved filters in Jira UI") is skipped for the Apps Script path — JQL is issued inline by `fetchTickets_` against `/rest/api/3/search/jql`. Saved filters are still needed for the Jira-native dashboard (step 2) when that gets built.
- Custom field IDs for Story Points and Sprint are auto-discovered by name at run time (with a 1-hour cache) rather than hardcoded in Config. Reduces per-tenant setup friction.
- Last-6 sprint IDs (originally spec'd as a Config field) are auto-resolved at run time via the Agile API (see Done section above).

**Pending — user action.**

- **Config fill-in** — after `Initialize Sheet`, fill `Config.leave_sheet_id` (external Leave sheet ID) if you want the Apps Script to leave-adjust server-side. The web page already collects leaves in a browser-local modal and recomputes velocity client-side, so the external Leave sheet is optional for lead-only use. Everything else has a reasonable default; `sprint_ids_last6` no longer needs to be populated — see "Done → Last-6 sprint auto-resolution" above.
- **First live run** — `Refresh from Jira`. First run intentionally emits zero `ScopeChanges` rows; it seeds baselines into `TicketState`. Second run onward is the real test. Verify `RunLog`: expect `status=ok`, `rows_tickets > 0`, `leave_name_mismatches` = 0 (otherwise fix names in the Leave sheet).
- **Install daily trigger** — once the first dry run looks right.
- **Deploy web page** — export CSVs, drop into `web/sprint-health/`, serve with `python3 -m http.server 8081`.

**Pending — code work (Phase 2).**

- **Mid-sprint SP add/remove events in `ScopeChanges`.** Current implementation captures SP *edits* on known (ticket, sprint) pairs only. A ticket *joining* a started sprint is silently baselined; a ticket *leaving* a sprint isn't logged. The design's "Sprint scope churn summary" needs both. The snapshot-diff infrastructure is already in place — adding two branches to `diffAndUpsertState_` and two extra row shapes to `ScopeChanges` would close it. Estimated effort: ~1 hour.
- **`TicketState` pruning.** Grows forever. With ~10 tickets × ~7 tracked sprints this is ~70 rows — safe for years — but a tidy periodic prune of rows whose `sprint_name` is no longer in the registry is worth adding before it becomes noisy. Estimated effort: ~30 min.
- **`Sprints` tab leave-mismatch validation column.** Currently the mismatch *count* shows in `RunLog`; the design calls for a per-row flag column in `Sprints`. Estimated effort: ~30 min.

**Deferred.**

- **Editor attribution on `ScopeChanges`** — who clicked save on the SP edit, as distinct from current assignee. Requires per-ticket changelog parsing; rejected in favor of snapshot-diff. For the rare case where it matters, open the ticket's Jira history directly.
- **Historical assignee for `sp_committed`** — committed SP is currently attributed to each ticket's *current* assignee. Accurate attribution at sprint-start would need changelog parsing on the assignee field. Documented in "Known limitations".
- **Plotly upgrade** — only if 10-line velocity chart proves unreadable in practice. Chart.js with legend-toggle is expected to be sufficient.

## Shared conventions (with the Epic Risk dashboard)

Both dashboards follow the same stack and surface conventions. See `epic-risk-design.md` → "Shared conventions". The only material difference is the export filenames and port (`8081` here vs. `8080` there).

## Known limitations

- **Leave name matching.** `Leave` sheet `person` column must match Jira display name exactly. A validation column in `Sprints` flags mismatches so they surface on the next run rather than silently zero-out leave days.
- **Sprint-boundary committed-set inference.** The snapshot-diff approach defines the committed set as "tickets seen in this sprint on the first run they appeared." That's lossy if tickets were added and then removed before any refresh ran. Treat the committed set as best-effort; commitment accuracy is secondary to velocity anyway.
- **No editor attribution on `ScopeChanges`.** Snapshot-diff knows the ticket's current assignee but not who edited the SP. For the rare case where that matters, open the ticket's history in Jira directly.
- **Sub-task blocker classification.** Sub-task titles are free-form; the dashboard can only surface "old open sub-task assigned to X". Interpreting whether X is PR-review, cross-team-dependency, or something else remains human judgment.
- **10-line velocity chart readability.** Chart.js with 10 lines gets noisy; mitigated by legend-toggle isolation and a per-person sparkline fallback. If it becomes unusable at 10+ people, upgrade to Plotly — not before.
- **Active sprint only in the live panels.** Jira does not support `closedSprints(n)` for "last 1 closed sprint"; for any just-closed-sprint retro view, open the Sheet.

## Decisions rejected along the way

- **Changelog parsing for `ScopeChanges`** — rejected in favor of snapshot-diff against a persisted `TicketState` tab. See "Snapshot-diff vs. changelog parsing — decision" above.
- **Jira Cloud for Sheets add-on** — rejected. Works for tabular ingestion but not for the join with `Leave` nor for the snapshot-diff logic. Apps Script handles both in one path.
- **Local Flask/FastAPI shim for a one-click refresh button** — rejected. Adds a second process. Apps Script Sheet menu provides the same manual-trigger capability with zero local backend.
- **Plotly** — rejected for now. Chart.js with legend-toggle covers the 10-line case; upgrade only if the trend chart becomes unreadable in practice.
- **Publish-to-web CSVs** — rejected. Per-person data warrants privacy; anyone-with-link URLs are a poor fit. Browser-downloaded CSVs keep the data local.
- **Raw per-person velocity as a primary metric without leave normalization** — rejected. Leave during a sprint distorts the number; normalizing by available working days produces a stable per-person signal.
- **Cross-person velocity comparison / leaderboard framing** — rejected. All velocity comparisons are per-person against that person's own history. Prevents leaderboard drift if access later widens.
- **Completion rate as the primary throughput signal** — deferred to secondary. Since SP are updated honestly when scope grows, normalized velocity (per available day) is the stronger throughput signal. Completion rate retained as a commitment-accuracy signal.
- **Team-facing / upward-facing variants** — deferred. Current scope is lead-only. A future derived export from the same Sheet can serve those audiences without rebuilding the pipeline.
