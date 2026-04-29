# 05 — Frontend

## Stack

- **React + Vite + TypeScript**
- **`react-router-dom` v6** for routing
- **`@tanstack/react-query`** for server state (cache, refetch, mutations)
- **Chart.js** via `react-chartjs-2` for charts
- **CSS Modules** (no Tailwind) — preserves the existing class semantics from `web/sprint-health/styles.css`

## Shell

Persistent left nav + top bar. Routes (final list TBD in Phase 2):

```
/setup                    (gated; only path available before first-run config)
/sprint-health            (default landing)
/sprint-health/:sprintId  (deep-linkable)
/epic-risk
/hygiene
/projects                 (v2-A; Phase 5)
/projects/:name           (v2-A; Phase 5)
/projects/monitoring      (v2-A; Phase 5)
/leaves                   (or under /settings — Phase 2 decides)
/leaderboard              (v3 placeholder; empty state)
/insights                 (v3 placeholder; empty state)
/settings
/debug                    (Phase 1 raw-data verification view)
```

Top bar (global, on every page after setup):

- App title / logo
- Sprint dropdown (page-scoped — only on `/sprint-health`)
- `<RefreshButton/>` — see "Refresh flow" below
- `<StalenessBadge/>` — see "Staleness badge" below

## State management

- **Server state** via TanStack Query, keyed per resource. Hooks in `src/api/`:
  ```ts
  useSprints(), useSprint(id), useIssues(filters),
  useVelocity(sprintWindow, person?), useSyncStatus(), ...
  ```
- **UI prefs** (whitelist, filter, sort orders) in `localStorage` via a small `useLocalStorage` hook. **Leaves no longer in localStorage** — DB-backed via `/api/v1/leaves`.
- **Mutations** (refresh, leave-CRUD) use `useMutation` with optimistic updates where appropriate.

## Refresh flow

Click `<RefreshButton/>` →

1. `POST /api/v1/sync/run` returns 202 with `{sync_run_id}`.
2. `useSyncStatus()` switches its poll interval from 30 s to **2 s** while the latest run is `status='running'`.
3. On completion (`status='success'` or `status='failed'`), the hook fires `queryClient.invalidateQueries()` (no key) — refetches **everything** in one shot. All open dashboards update simultaneously.
4. Button shows spinner state during the run; transitions to "synced now" briefly on success, or red error toast on failure.

## Staleness badge

Reads `last_sync_at` from `/api/v1/sync/status`. Replaces CSV mtime entirely. Bands match the legacy:

- **≤24 h:** green ("Synced just now" / "Synced 4m ago" / "Synced 6h ago")
- **24–72 h:** yellow ("Last sync 2 days ago")
- **>72 h:** red ("Stale: 5 days since last sync")

## Visual patterns (catalogued; ported from `web/sprint-health/`, redesigned in Phase 2)

| Component | Source / use |
|---|---|
| `KpiCard` | committed / done / velocity / projected, with good/warn/bad variants |
| `ProgressBar` | segmented per-person bar (done / validation / review / in-progress / todo) |
| `SparklineTile` | accuracy sparkline + "latest X% · avg Y%" |
| `Pill` / `StatusPill` | status, depth, age, change-type indicators |
| `StalenessBadge` | global top-bar |
| `SprintBanner` | sprint info pill (active / closed) |
| `Modal` | whitelist / filter / leaves-detail |
| `DataTable` | sortable headers, pagination, empty/loading/error states |
| `CheckList` | 2-column whitelist UI |
| `RefreshButton` | idle / syncing / success / error states |
| `EmptyState`, `LoadingState`, `ErrorState` | consistent messaging across pages |
| Form inputs | text, date range, multi-select |

CSS variables (the `:root` set from `web/sprint-health/styles.css`) carry over to `frontend/src/styles/tokens.css` after the Phase 2 design pass refines them.

## TS types

Generated from backend OpenAPI via `openapi-typescript`. `make gen-types` runs manually after backend changes; also part of `make dev` first-run. No pre-commit hook (too noisy when iterating on backend).

```ts
// src/api/types.gen.ts (generated; do not edit)
export interface Sprint { ... }
export interface Issue { ... }
export interface VelocityRow { ... }
export interface SyncStatus { lastSyncAt: string | null; lastRunStatus: 'ok'|'failed'|null; ... }
```

Hooks consume these types directly:

```ts
export function useVelocity(sprintWindow = 6, person?: string) {
  return useQuery<VelocityRow[]>({
    queryKey: ['metrics', 'velocity', sprintWindow, person],
    queryFn: () => api.get(`/api/v1/metrics/velocity?sprint_window=${sprintWindow}${person ? `&person=${person}` : ''}`),
  });
}
```
