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
issuetype = Sub-task
AND parent in (filter = "Search-Sprint-Current")
AND status != Done
```

Sub-tasks under the current sprint's parent tickets. Parent-via-filter is the reliable path because sub-tasks often lack the team field. Every gadget references a saved filter — never raw JQL — so refactors propagate.

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
| `Sprints` | Per-sprint × per-person rollup: SP committed, SP completed, working days, leave days, available days | Script |
| `VelocityComputed` | Primary coaching view — one row per person × sprint with normalized velocity and commitment accuracy | Script |
| `CarryOver` | Tickets rolled across 2+ sprints, with owner and depth | Script |
| `ScopeChanges` | Tickets whose SP changed after sprint start, with delta and owner | Script |
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
3. JQL fetches tickets in current sprint + each of last 6 sprints (Filter 1 and Filter 3), fields: `status`, `storypoints`, `assignee`, `resolutiondate`, `sprint`, `parent`, `changelog` (for SP history).
4. Per person × sprint: compute `SP committed` (ticket set at sprint start, inferred from sprint-assignment changelog), `SP completed` (closed-in-sprint set), `leave days` (overlap with `Leave` rows), `available days`, `velocity`, `commitment accuracy`.
5. Scope inflation: parse ticket changelog for `Story Points` field changes after sprint start; emit one row per change into `ScopeChanges`.
6. Carry-over: for each active ticket, count the number of distinct sprints it's been assigned to; flag depth ≥ 2.
7. Compare against thresholds; emit flag states.
8. Write `Tickets`, `Sprints`, `VelocityComputed`, `CarryOver`, `ScopeChanges` in full (replace, not append).
9. Log timestamp and any errors to `RunLog`.

**Auth:** Jira API token in Apps Script `PropertiesService` (user-level, not committed). Basic-auth header using `email:token`.

**Trigger:** daily at 07:00 local time.

**Estimated build effort:** ~6 hours for a first working version. Longer than the Epic Risk script because of the sprint-boundary changelog parsing; everything else is analogous.

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

## Shared conventions (with the Epic Risk dashboard)

Both dashboards follow the same stack and surface conventions. See `epic-risk-design.md` → "Shared conventions". The only material difference is the export filenames and port (`8081` here vs. `8080` there).

## Known limitations

- **Leave name matching.** `Leave` sheet `person` column must match Jira display name exactly. A validation column in `Sprints` flags mismatches so they surface on the next run rather than silently zero-out leave days.
- **Sprint-boundary committed-set inference.** Reconstructing "what was committed at sprint start" from changelog is lossy if tickets were added/removed before the sprint was formally started. Treat the committed set as best-effort; commitment accuracy is secondary to velocity anyway.
- **Sub-task blocker classification.** Sub-task titles are free-form; the dashboard can only surface "old open sub-task assigned to X". Interpreting whether X is PR-review, cross-team-dependency, or something else remains human judgment.
- **10-line velocity chart readability.** Chart.js with 10 lines gets noisy; mitigated by legend-toggle isolation and a per-person sparkline fallback. If it becomes unusable at 10+ people, upgrade to Plotly — not before.
- **Active sprint only in the live panels.** Jira does not support `closedSprints(n)` for "last 1 closed sprint"; for any just-closed-sprint retro view, open the Sheet.

## Decisions rejected along the way

- **Jira Cloud for Sheets add-on** — rejected. Works for tabular ingestion but not for the join with `Leave` nor for changelog parsing. Apps Script handles both in one path.
- **Local Flask/FastAPI shim for a one-click refresh button** — rejected. Adds a second process. Apps Script Sheet menu provides the same manual-trigger capability with zero local backend.
- **Plotly** — rejected for now. Chart.js with legend-toggle covers the 10-line case; upgrade only if the trend chart becomes unreadable in practice.
- **Publish-to-web CSVs** — rejected. Per-person data warrants privacy; anyone-with-link URLs are a poor fit. Browser-downloaded CSVs keep the data local.
- **Raw per-person velocity as a primary metric without leave normalization** — rejected. Leave during a sprint distorts the number; normalizing by available working days produces a stable per-person signal.
- **Cross-person velocity comparison / leaderboard framing** — rejected. All velocity comparisons are per-person against that person's own history. Prevents leaderboard drift if access later widens.
- **Completion rate as the primary throughput signal** — deferred to secondary. Since SP are updated honestly when scope grows, normalized velocity (per available day) is the stronger throughput signal. Completion rate retained as a commitment-accuracy signal.
- **Team-facing / upward-facing variants** — deferred. Current scope is lead-only. A future derived export from the same Sheet can serve those audiences without rebuilding the pipeline.
