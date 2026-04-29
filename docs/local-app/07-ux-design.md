# 07 — UX Design

> **Status: outline only.** This document gets populated during Phase 2 (the UX design phase). Once Phase 2 is complete, this file is the authoritative source for all visual / interaction decisions, and `frontend/mockup/index.html` is its interactive companion.

## Sections to fill in during Phase 2

### Design tokens (from step 2.1)

- **Colors:**
  - Light theme palette
  - Dark theme palette (if shipped in v1; deferred otherwise)
  - Status colors: good / warn / bad — for sync-staleness, velocity bands, due-date bands, blocker-age
  - Accent / link
- **Typography:**
  - Font family stack (system fonts; tabular-numeric for tables)
  - Type scale (e.g. 12 / 14 / 16 / 20 / 28 / 36)
  - Weights
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48
- **Radii:** small / medium / large + pill
- **Shadows:** elevation tiers
- **Side-by-side migration table:** existing `web/sprint-health/styles.css` `:root` vars → new tokens.

### Component catalog (from step 2.2)

For each component: HTML/CSS in the mockup, intended usage notes, and all visual states.

- `KpiCard` (4 variants: neutral, good, warn, bad)
- `ProgressBar` (segmented stack: done / validation / review / in-progress / todo)
- `SparklineTile` (line + "latest X% · avg Y%" footer)
- `Pill` / `StatusPill` (status, depth, age, change-type)
- `StalenessBadge` (green / yellow / red bands)
- `SprintBanner` (active / closed)
- `Modal` (whitelist / filter / leaves)
- `DataTable` (sortable headers, pagination, empty/loading/error states)
- `CheckList` (2-column, used in whitelist / filter modals)
- `RefreshButton` (idle / syncing / success-flash / error)
- `EmptyState`, `LoadingState`, `ErrorState`
- Form inputs: text, date range, multi-select

### Page wireframes (from step 2.3)

One per route, with realistic placeholder data:

- `/setup` — first-run credential entry
- `/sprint-health` — active sprint variant
- `/sprint-health` — closed sprint variant
- `/epic-risk`
- `/hygiene` (3 panels: epics-no-initiative, tasks-no-epic, by-due-date)
- `/projects` — Active + Completed sections
- `/projects/:name` — drill-in
- `/projects/monitoring` — comparison table
- `/leaves` (or under `/settings` — Phase 2 decides)
- `/leaderboard` — empty-state placeholder
- `/insights` — empty-state placeholder
- `/settings` — credentials, sync schedule, team filter, board ID, holidays, leaves
- `/debug` — Phase 1 raw-data verification view (already shipped; ensure visual consistency)

### Interaction patterns (from step 2.4)

- **Refresh flow** — button click → 202 response → poll → invalidate-all on completion
- **Modal open/close** — focus management, Escape key, backdrop click
- **Table sorting + filtering** — click header to sort; filter pills above table
- **Deep-linking** — URL state for sprint id, person filter, sort preferences
- **Keyboard navigation** — j/k row movement, `/` focuses search, Esc closes modals
- **Copy-URL** — clipboard write + caveat label ("only works on Anoop's machine")

### States gallery (from step 2.5)

For every page, every state must have a visual:

- **Empty** (no data yet, e.g., first sync hasn't run)
- **Loading** (initial fetch in flight)
- **Error** (network / 500)
- **Partial data** (some queries failed, others succeeded)
- **Sync-failed-but-stale-data-still-shown** (last sync was 3 days ago and threw, but DB still has Tuesday's data — show it with a red staleness badge)

### Accessibility decisions

- Keyboard nav coverage
- Color-blind safe palette confirmation (red/green color combos avoided as the only signal)
- Focus rings, semantic HTML, ARIA live regions for sync status

### Phase 2 inputs decided here

These were deliberately deferred from earlier discussions:

- **Dark mode in v1 or v3?**
- **`/leaderboard` and `/insights` placeholders in nav?**
- **Mockup file location** — `frontend/mockup/` or `frontend/src/mockup/`
- **Sprint dropdown default when no active sprint exists**
- **`/hygiene/by-due-date` scope** — open tickets only or include closed-late tickets for retrospective view
- **Leave management page placement** — under `/settings`, dedicated `/leaves` route, or both
