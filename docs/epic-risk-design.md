# Epic Risk Dashboard — Design

**Date:** 2026-04-22
**Owner:** Anoop K. Prabhu (Search team, 290)
**Status:** Design locked, ready for implementation

## Purpose

A manager-facing risk-spotting dashboard for the Search team's quarterly epics. The primary reader is the team lead, deciding where to intervene mid-quarter. Team visibility is a secondary benefit.

Not a status-reporting tool. Scope is open and evolving, so "% complete" metrics are misleading and excluded by design.

## Scope

- 10–15 Search team epics per quarter (Q2 2026 currently has 21 matching the filter; includes some bugfix-umbrella epics that stay in scope).
- Each epic targets completion within one quarter. Carry-forward epics with updated due dates are included.
- ~2 epics per person, ~5–7 person team.

## Risk signals (the only ones that earn a column)

1. **Throughput drop** — the team used to close SP/sprint on this epic at rate X; now closing much less.
2. **Scope explosion** — tickets/SP being added to the epic faster than they close.
3. **No movement** — in-progress tickets staling.
4. **Hidden work** (implicit guard rail) — unestimated tickets make the three signals above unreliable, so we flag high-unestimated epics.

Plus one positive-framing metric for team morale: **cumulative SP delivered** across the quarter.

## Foundation — root JQL filters

### Filter 1 — `Search-Q-Epics`

```
cf[10500] = "02623aed-f05b-4acd-8187-7932552722de-28"
AND issuetype = Epic
AND (
  (startDate >= "2026-04-01" AND startDate <= "2026-06-30")
  OR
  (duedate   >= "2026-04-01" AND duedate   <= "2026-06-30")
)
```

`cf[10500]` is the legacy custom team field on this tenant; friendly names like `Team = "Search (290)"` do not resolve. `startOfQuarter()` / `endOfQuarter()` are not supported in Jira Cloud JQL here, so dates are hardcoded and edited once per quarter (4x/year tax).

### Filter 2 — `Search-Q-Epic-Tickets`

```
parent in (filter = "Search-Q-Epics")
```

Child tickets often lack the Team field, so filtering via parent epic is the reliable path. Every gadget references a saved filter — never raw JQL — so refactors propagate.

## Architecture — two surfaces

**Jira dashboard** = team-visible surface. Simple aggregates native Jira gadgets can render.

**Google Sheet + local web page** = manager working surface. All derived metrics, flags, and historical trends.

Apps Script on a daily trigger is the single data-flow path. The web page reads locally exported CSVs — no publish-to-web, no separate backend. Same stack convention as the per-person sprint dashboard; see "Shared conventions" below.

```
Jira REST API
     │
     ▼
Apps Script (daily 7am trigger)
     │
     ▼
Google Sheet (Config · Epics · EpicSprintHistory · Tickets · RunLog)
     │                │
     ▼                ▼
Sheet UI         Sheet menu: Export CSVs
(manager work)   (browser downloads)
                      │
                      ▼
                 ~/dashboards/epic-risk/*.csv
                      │
                      ▼
                 Local HTML page
                 (glanceable view)
```

## Jira dashboard — contents

Team-visible, simple aggregates only. No flags here (Jira cannot compute them cleanly).

- **Top strip (full width):**
  - Cumulative SP delivered this quarter — scorecard + sparkline.
  - SP delivered per sprint, stacked by epic — bar chart.
- **Main zone:**
  - `Two Dimensional Filter Statistics` — Epic × Status, values = count.
  - `Two Dimensional Filter Statistics` — Epic × Status, values = sum Story Points.
  - `Filter Results` listing all Quarter Epics with due date column.

## Google Sheet — structure

| Tab | Purpose | Refresh |
|-----|---------|---------|
| `Config` | Quarter start/end, team ID, flag thresholds, Jira base URL | Manual |
| `Epics` | One row per quarter epic, all flag columns, primary manager view | Script |
| `EpicSprintHistory` | Per-epic × per-sprint SP closed, last 6 sprints | Script |
| `Tickets` | Raw rows — every ticket under every quarter epic, for ad-hoc pivots | Script |
| `RunLog` | Timestamp + error trace per run | Script |

### `Epics` tab — columns

| Column | Contents |
|--------|----------|
| Epic key (hyperlinked) | `EEPD-XXXXX` |
| Summary | Epic title |
| Due date | From epic field |
| Tickets — Done / In Progress / To Do | Counts |
| Story Points — Done / In Progress / To Do | SP sums |
| SP closed — last sprint | Throughput number |
| SP closed — avg last 3 sprints | Throughput baseline |
| 🚩 Throughput drop | Emoji, see thresholds |
| 🚩 Scope explosion | Emoji, see thresholds |
| 🚩 No movement | Emoji, see thresholds |
| 🚩 Unestimated | Emoji, see thresholds |

### Flag thresholds

| Flag | 🟢 Green | 🟡 Yellow | 🔴 Red |
|------|----------|-----------|---------|
| Throughput drop (last sprint vs avg of prior 3 on this epic) | ≥ 80% | 50–79% | < 50% |
| Scope explosion (14-day net growth: SP added ÷ SP closed) | < 50% | 50–100% | > 100% |
| No movement (oldest In Progress ticket age) | < 7 days | 7–14 days | > 14 days |
| Unestimated (% open tickets with no SP) | < 10% | 10–30% | > 30% |

Conditional formatting on the Sheet renders the symbols from the underlying numeric column.

## Apps Script — behaviour per run

1. Read `Config` for quarter dates, team ID, thresholds.
2. JQL #1 fetches all quarter epics (Filter 1) and writes header data to `Epics`.
3. For each epic, JQL #2 fetches child tickets with fields: `status`, `storypoints`, `created`, `updated`, `assignee`, `resolutiondate`, `sprint`.
4. Aggregate in memory: counts by status, SP by status, SP closed per sprint (last 6), SP added in last 14 days, oldest In Progress age, unestimated %.
5. Compare against thresholds and emit flag state per column.
6. Write `Epics`, `EpicSprintHistory`, `Tickets` in full (replace, not append).
7. Log timestamp and any errors to `RunLog`.

**Auth:** Jira API token in Apps Script `PropertiesService` (user-level, not committed). Basic-auth header using `email:token`.

**Trigger:** daily at 07:00 local time.

**Estimated build effort:** ~4 hours for a first working version.

## Local web visualization

A single `index.html` + one JS file, Chart.js for graphs, no framework, no build step. Served via `python -m http.server 8080` from `~/dashboards/epic-risk/`. Reads local CSVs — `epics.csv`, `epic_sprint_history.csv`, `meta.csv` — via `fetch('./epics.csv')` etc. CSVs are produced by the Apps Script `Export CSVs` menu item (browser downloads); drop them into the folder after each refresh. Raw `Tickets` tab is never exported.

A staleness badge in the page header reads `meta.csv`'s `last_run_iso` column: green ≤ 24h, yellow 24–72h, red > 72h.

### Layout — four things, nothing else

1. **Hero stat** — "X SP delivered this quarter" + 6-sprint sparkline.
2. **Epic cards grid** — one small card per epic: name, due date, three flag dots. Click to expand detail.
3. **Throughput trend chart** — one line per epic, last 6 sprints, SP closed on y-axis.
4. **Scope net-growth chart** — one bar per epic, last 14 days SP added vs closed, colored by flag state.

Deliberate omissions: raw ticket tables, unestimated counts, assignee breakdowns. Those live in the Sheet. This surface exists to glance, spot red, then drill into the Sheet.

**Estimated build effort:** ~2–3 hours.

## Build sequence

1. Create saved filters `Search-Q-Epics` and `Search-Q-Epic-Tickets` in Jira UI.
2. Build the Jira dashboard with the five native gadgets above.
3. Create the Google Sheet with the five tabs and `Config` defaults.
4. Write the Apps Script; verify against one epic manually before turning on the daily trigger.
5. Add the `Epic Risk` Sheet menu with `Refresh from Jira` and `Export CSVs` items. `Export CSVs` emits `epics.csv`, `epic_sprint_history.csv`, and `meta.csv` as browser downloads.
6. Build the local HTML page against the exported CSVs; serve from `~/dashboards/epic-risk/`.

## Shared conventions (with the per-person sprint dashboard)

Both dashboards follow the same stack and the same surface conventions. Fixing these once avoids drift.

- **Sheet menu:** top-level menu named for the dashboard (`Epic Risk`, `Sprint Health`). Items: `Refresh from Jira`, `Export CSVs`.
- **Meta CSV:** `meta.csv` with at least `last_run_iso, last_run_status, rows_primary`. Page reads the same columns for the staleness badge.
- **Staleness thresholds:** green ≤ 24h, yellow 24–72h, red > 72h.
- **Folder layout:** `~/dashboards/<name>/` with `index.html`, `app.js`, exported CSVs. Served via `python -m http.server <port>`; epic-risk uses 8080, per-person uses 8081.
- **Auth:** Jira API token in Apps Script `PropertiesService`, per-user, never committed.

## Known limitations

- `startOfQuarter()` / `endOfQuarter()` unsupported — quarterly manual edit of Filter 1.
- Child tickets on other teams sharing a parent epic would still be counted. Acceptable given current team structure.
- Sprint boundaries use Jira sprint names from the Search team's board; cross-team sprints would need disambiguation.
- Bugfix umbrella epics will routinely trip scope-explosion 🟡/🔴. Signal, not noise — intentional.

## Decisions rejected along the way

- **% complete per epic** — rejected. Scope is open; denominator drifts.
- **Sprint commitment completion rate on this dashboard** — belongs on the separate per-person sprint dashboard.
- **Custom Charts for Jira / eazyBI marketplace app** — rejected in favor of Apps Script + Sheet. Free, more flexible, already supports the local web view.
- **Looker Studio as primary manager surface** — rejected. Overhead without commensurate benefit when the artifact is a flag table. Sheet remains the source of truth if added later.
- **Publish-to-web CSVs** — rejected in favor of locally exported CSVs. Keeps all data private (no anyone-with-link URLs), unifies stack with the per-person sprint dashboard, at the cost of a one-click export step per refresh.
