# 07 — UX Design

> **Status: complete (Phase 2 done 2026-04-30).** This file documents all
> visual + interaction decisions; the interactive companion is at
> `frontend/mockup/index.html` (open it in a browser, no backend needed).
> Token reference at `frontend/mockup/tokens.html`.

## What lives where

| Artifact | Path |
|---|---|
| Production tokens | `frontend/src/styles/tokens.css` |
| Mockup CSS (production-shape) | `frontend/mockup/mockup.css` |
| Click-through prototype | `frontend/mockup/index.html` |
| Token swatches | `frontend/mockup/tokens.html` |

## Phase 2 inputs — resolved

These were deliberately deferred from Phase 1 design discussions; resolved during 2.1-2.5:

- **Dark mode:** designed in tokens + mockup. Toggle wiring is **deferred to Phase 4 polish** so it doesn't bloat Phase 3.
- **`/leaderboard` and `/insights`:** kept in nav with a `P5` pill + empty-state placeholders that explain "what's coming". User sees the product shape from day one without needing the backend work.
- **Mockup file location:** `frontend/mockup/` (sibling of `src/`). Keeps mockup out of the React build entirely.
- **Sprint dropdown when no active sprint:** show the most recent closed sprint, with a banner ("No active sprint right now — viewing closed Search 2026-08").
- **`/hygiene/by-due-date` scope:** open tickets only by default; toggle in the page header to "include closed-late" for retro analysis.
- **Leave management page placement:** dedicated `/leaves` route in nav. Settings page also has a read-only summary linking to `/leaves`.

## Component catalog (step 2.2)

Sourced from the legacy `web/sprint-health/`. Each component has a documented stub in `frontend/mockup/index.html#components`:

| Component | Variants | Used by |
|---|---|---|
| `KpiCard` | neutral, good, warn, bad | every page |
| `ProgressBar` (segmented) | 5 segments: done / validation / review / in-progress / todo | Sprint Health per-person |
| `SparklineTile` | accent / good / warn / bad stroke | Sprint Health accuracy trend |
| `Pill` / `StatusPill` | good / warn / bad / neutral / accent | scattered |
| `StalenessBadge` | green ≤24h / yellow 24-72h / red >72h / "Syncing…" / "Sync failed" | top bar (global) |
| `SprintBanner` | active / closed | Sprint Health header |
| `Modal` | header + body + footer; backdrop click + Esc to close; focus restoration | whitelist, filter, leaves |
| `DataTable` | sortable headers, search filter, hover rows, footer count | every list page |
| `CheckList` | 2-column checkbox grid | inside Modal |
| `RefreshButton` | idle / syncing / success-flash / error | top bar (global) |
| `EmptyState` / `LoadingState` / `ErrorState` | three universal panels | every page |
| Form inputs | text / email / password / date / search / select | setup, settings, leaves |

## Page wireframes (step 2.3)

13 routes wireframed in the mockup with realistic placeholder data:

- `/sprint-health` (active) — SprintBanner + 4 KPIs + Burnup + per-person + 6-sprint trend + carry-over/scope-churn/blockers + PR-review queue
- `/sprint-health` (closed) — final KPIs; no burnup
- `/epic-risk` — at-risk/watch/on-track/done KPIs + risk-card grid + throughput chart
- `/hygiene` — 3 sortable panels (epics-no-init, tasks-no-epic, by-due-date)
- `/projects` — active list + completed (collapsed) + project-bar
- `/projects/:name` — drill-in: 4 KPIs + project burn-up + epics + future sprints
- `/projects/monitoring` — comparison table with vs-median pills
- `/leaves` — add form + upcoming list + overlap alerts
- `/leaderboard` + `/insights` — empty-state with v3/v3 placeholders
- `/settings` — Jira creds (masked) + sync schedule + team filter + holidays
- `/setup` — first-run centered card form
- `/debug` — points at the live Phase-1.10 page

## Interaction patterns (step 2.4)

Six interactions with live demos in `frontend/mockup/index.html#interactions`:

1. **Refresh flow** — top-bar button cycles idle → syncing → success-flash → idle. Production: `POST /api/v1/sync/run` + 2s polling on `/sync/status` until done, then `queryClient.invalidateQueries()`.
2. **Modal open/close** — backdrop click + Esc; focus trap on open; focus restoration on close.
3. **Sortable + filterable DataTable** — click header to toggle asc/desc; search filter with row count; Esc clears.
4. **Deep-linking** — URL hash (mockup) / search params (production). Bookmarkable + back button.
5. **Keyboard navigation** — Tab/Shift+Tab universal; Enter/Space activate; j/k row movement (Phase 4); / focus filter (Phase 4); Esc close/clear; r refresh (Phase 4).
6. **Copy URL with caveat** — clipboard write + honest "only works on this machine" feedback.

## States gallery (step 2.5)

Five states designed for every page. Decisions baked in:

- **Empty** always offers the action that creates data ("Run first sync" button).
- **Loading** keeps stale data visible; skeleton shimmer animation on placeholders.
- **Error** is specific — quotes the failed endpoint + suggests a fix.
- **Partial data** renders what succeeded; failed bits get inline error chips.
- **Sync-failed-but-stale-data** shows last-good data normally; staleness badge flips red + banner with fix-link.
- Three consecutive sync failures → staleness badge flips to "Sync broken" with a "view error" link.

## Accessibility decisions baked in

- All `*:focus-visible` gets a 2px `--color-accent` outline. Keyboard users see focus rings; mouse users don't.
- All status conveyance uses BOTH color AND text (the staleness pill says "Synced 4m ago", not just a coloured dot). No color-only signals.
- Body text on bg: `#1a1a1a` on `#f7f8fa` = 13.2:1 (AAA). Accent on white: 4.55:1 (AA).
- Modals are `role="dialog"` `aria-modal="true"` with `aria-labelledby` pointing at the title.

---

## Reference: design tokens (step 2.1)

**Source of truth:** `frontend/src/styles/tokens.css`. Visual reference (open in any browser, no backend needed): `frontend/mockup/tokens.html`.

#### Anchor decision

Anchor on the legacy `web/sprint-health/styles.css` `:root` block. The user has been looking at those colors for months in the Sprint Health POC; switching the palette in the rewrite would create disorienting visual diff with no functional benefit. Phase 2.1 *adds* layers (typography scale, spacing scale, radii, shadows, dark mode, neutral chip, on-accent text) without replacing the existing canonical values.

#### Color naming convention

```
--color-{role}             # canonical brand/surface colour
--color-{role}-bg          # light tint background (status pills, chips)
--color-{role}-fg          # foreground readable on the matching -bg
```

The `-fg` companion exists because the canonical status colors are tuned for icons + thin borders, not for text on the matching `-bg` tint. e.g. `--color-warn = #f9ab00` (vivid amber) is too light to read on `#fef7e0`; `--color-warn-fg = #8a5a00` (deep amber) is the legible-text variant. Pattern verified against the legacy `.staleness.yellow` rule which already used `#8a5a00` for its foreground.

#### Side-by-side: legacy → new

| Legacy `:root` var | New token | Value | Notes |
|---|---|---|---|
| `--bg`             | `--color-bg`              | `#f7f8fa` | unchanged |
| `--panel`          | `--color-surface`         | `#ffffff` | unchanged |
| (new)              | `--color-surface-2`       | `#fafbfc` | hover rows / banded tables |
| `--border`         | `--color-border`          | `#e1e4e8` | unchanged |
| (new)              | `--color-border-strong`   | `#c8cdd3` | dividers, focus |
| `--text`           | `--color-text`            | `#1a1a1a` | unchanged |
| `--muted`          | `--color-text-muted`      | `#5f6368` | unchanged |
| (new)              | `--color-text-subtle`     | `#909399` | tertiary captions |
| `--accent`         | `--color-accent`          | `#1a73e8` | unchanged |
| (new)              | `--color-accent-hover`    | `#1557b0` | button hover |
| (new)              | `--color-accent-bg`       | `#e8f0fe` | selected row tint |
| `--green`          | `--color-good`            | `#188038` | unchanged |
| `--green-bg`       | `--color-good-bg`         | `#e6f4ea` | unchanged |
| (legacy `.staleness.green` color) | `--color-good-fg` | `#137333` | promoted to a token |
| `--yellow`         | `--color-warn`            | `#f9ab00` | unchanged |
| `--yellow-bg`      | `--color-warn-bg`         | `#fef7e0` | unchanged |
| (legacy `.staleness.yellow` color) | `--color-warn-fg` | `#8a5a00` | promoted to a token |
| `--red`            | `--color-bad`             | `#d93025` | unchanged |
| `--red-bg`         | `--color-bad-bg`          | `#fce8e6` | unchanged |
| (legacy `.staleness.red` color) | `--color-bad-fg` | `#a50e0e` | promoted to a token |

#### Typography

System font stack + a 7-step type scale anchored on the legacy 14px body:

```
--font-size-xs     11   labels, captions, table caps
--font-size-sm     12   subtitles, secondary table cells
--font-size-base   14   default body, primary table cells     ← legacy default
--font-size-md     16   panel emphasis, section heads
--font-size-lg     20   h2, KPI numbers                       ← legacy h1
--font-size-xl     28   h1, hero KPIs
--font-size-2xl    36   oversize numbers (rare)
```

Weights: 400 / 500 / 600 — no 700+ since the system font stack covers that range cleanly without bold-ish heaviness.

`--font-mono` for inline code, accountIds, JQL snippets. Browser-default mono stack.

#### Spacing scale

Base-4 with one extra step at 48 for top-level page padding:
```
--space-1  4    --space-5  24
--space-2  8    --space-6  32
--space-3  12   --space-7  48
--space-4  16
```

#### Radii

```
--radius-xs     2     thin chips
--radius-sm     4     buttons, inputs                ← legacy default
--radius-md     6     panels                         ← seen on legacy main panels
--radius-lg     10    cards, modals
--radius-pill   9999  status pills, segmented bars
```

#### Shadows

Three elevation tiers; light tints because the surface/bg contrast is already low:

```
--shadow-sm   0 1px 2px  rgba(0,0,0,0.04)   resting cards
--shadow-md   0 2px 8px  rgba(0,0,0,0.06)   modals, dropdowns
--shadow-lg   0 8px 24px rgba(0,0,0,0.08)   active modals, popovers
```

Dark mode shadows scale up to compensate for the dark background (alpha 0.4 / 0.5 / 0.6).

#### Dark mode

Designed but not exposed by a UI toggle yet (per Phase 2 inputs — toggle wiring is deferred to Phase 4 polish). Switch manually with `<html data-theme="dark">` to preview. Notable design decisions:
- `--color-good/-warn/-bad` shift to lighter saturated variants (`#4ade80`, `#facc15`, `#f87171`) so they read against the dark surface.
- The corresponding `-bg` tints become deep, low-saturation darks (`#0d2818`, `#2c2103`, `#2d0f0f`).
- The on-bg `-fg` foregrounds collapse back to the canonical color (no need for the darken trick — the dark `-bg` provides contrast directly).

#### Accessibility decisions baked in here

- All `*:focus-visible` gets a 2px `--color-accent` outline at 2px offset. Keyboard users see focus rings; mouse users don't.
- All status conveyance uses BOTH color AND a textual indicator (the staleness pill says "Synced 4m ago", not just a coloured dot). No color-only signal.
- Accent on light: `#1a73e8` on `#ffffff` = 4.55:1 (AA passes for body text).
- Body text on bg: `#1a1a1a` on `#f7f8fa` = 13.2:1 (AAA).

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
