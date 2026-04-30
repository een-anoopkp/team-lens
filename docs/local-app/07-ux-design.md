# 07 — UX Design

> **Status: outline only.** This document gets populated during Phase 2 (the UX design phase). Once Phase 2 is complete, this file is the authoritative source for all visual / interaction decisions, and `frontend/mockup/index.html` is its interactive companion.

## Sections to fill in during Phase 2

### Design tokens (resolved 2026-04-30)

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
