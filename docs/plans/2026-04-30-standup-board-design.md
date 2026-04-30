# Standup Board + per-ticket notes — design

**Date:** 2026-04-30
**Status:** approved (brainstorming session 6a18a8c4)
**Scope:** new sub-tab on `/sprint-health` showing the active sprint as a five-column Kanban, each ticket clickable to open a notes popover for local-only standup follow-ups.

## Why

The standup goes through every ticket on the active board. Follow-ups ("ask X about Y", "verify the deploy") get lost in head-memory or buried in long Jira comment threads. We want a local, fast, per-ticket to-do list that survives across sprints and is searchable later.

## Out of scope

- Cross-ticket aggregate to-do view (future feature).
- Drag-and-drop status changes (read-only board; status changes happen in Jira and arrive on next sync).
- Posting notes back to Jira as comments (notes are intentionally local-only).

## Decisions locked during brainstorm

| # | Question | Choice |
|---|---|---|
| 1 | Notes scope | **Per-ticket** (follow the ticket across sprints). Completed items auto-collapse. |
| 2 | Ticket detail UI | **Popover modal** (centered, ~480px). Lightweight, fast to open/close. |
| 3 | Board scope | **Active sprint only.** Closed sprints not shown. |
| 4 | Column model | **Five fixed columns** with status mapping. Unknown statuses → To Do. |
| 5 | Persistence | **Postgres** (`ticket_notes` table). Same DB as everything else. |
| 6 | Page placement | **Sub-tab of `/sprint-health`.** Not a new top-level route. |

## Architecture

### Sub-tab structure

`/sprint-health` becomes a parent layout with two index/child routes:

```tsx
<Route path="/sprint-health" element={<SprintHealthLayout />}>
  <Route index element={<SprintHealthPage />} />        {/* analytics */}
  <Route path="board" element={<StandupBoard />} />     {/* new */}
</Route>
```

`SprintHealthLayout` renders shared chrome: sprint picker, tab strip (Health / Standup Board, active state from `useMatch`), refresh badge, then `<Outlet />`. Selected sprint id is held in `?sprintId=N` so both tabs share it and a refresh preserves state.

### Column model

A single dict in `frontend/src/features/sprint-health/columns.ts`:

```ts
const COLUMN_MAP: Record<string, ColumnId> = {
  "To Do": "todo", "Open": "todo", "Reopened": "todo", "Backlog": "todo", "Ready": "todo",
  "In Progress": "in_progress", "In Development": "in_progress",
  "In Review": "in_review", "Code Review": "in_review",
  "In Validation": "in_validation", "QA": "in_validation", "Validation": "in_validation",
  "Done": "done", "Closed": "done", "Resolved": "done",
};
// Anything not in the map → "todo".
```

Five columns, predictable layout, one place to extend when the team adds a new status.

### Data model

```sql
CREATE TABLE ticket_notes (
  id          SERIAL PRIMARY KEY,
  issue_key   VARCHAR NOT NULL REFERENCES issues(issue_key) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX ticket_notes_issue_idx ON ticket_notes (issue_key);
CREATE INDEX ticket_notes_open_idx  ON ticket_notes (issue_key) WHERE done = false;
```

One row per to-do item. `body` is plain text, single-line in the typical case. ON DELETE CASCADE so removing a ticket from `issues` (full-scan-detected delete) takes its notes with it.

**Auto-collapse rule:** the list endpoint returns `{open, done_recent}` where `done_recent` is the last 5 closed items in the trailing 14 days. Older done items are reachable via a paginated endpoint but not shown by default.

## Backend

### New files

- `backend/app/models/ticket_notes.py` — SQLAlchemy `TicketNote` model.
- `backend/app/api/routes_ticket_notes.py` — endpoints below.
- `backend/alembic/versions/<rev>_ticket_notes.py` — migration.

### Endpoints

All under `/api/v1`:

| Verb | Path | Body | Returns |
|---|---|---|---|
| GET | `/issues/{key}/notes` | — | `{open: TicketNote[], done_recent: TicketNote[]}` |
| POST | `/issues/{key}/notes` | `{body: str}` | `TicketNote` (201) |
| PATCH | `/notes/{id}` | `{body?: str, done?: bool}` | `TicketNote` |
| DELETE | `/notes/{id}` | — | 204 |
| GET | `/issues/notes-counts?sprint_id=N` | — | `{[issue_key]: count_open}` |

The batched **counts endpoint** powers the `📝 N` badges on the board so we don't make N round trips. One SQL: count open notes grouped by issue_key, filtered to the sprint's issue keys.

PATCH `done=true` also sets `done_at = now()`. PATCH `done=false` clears `done_at`.

## Frontend

### New files (all under `frontend/src/features/sprint-health/`)

- `SprintHealthLayout.tsx` — parent with sprint picker + tab strip + outlet.
- `StandupBoard.tsx` — board page.
- `TicketCard.tsx` — single card.
- `NotesPopover.tsx` — modal popover.
- `columns.ts` — status mapping.

`SprintHealthPage.tsx` (existing) becomes the index child of the layout — minimal change, just removing its own header chrome.

### Hooks added to `frontend/src/api/index.ts`

```ts
useTicketNotes(issueKey)         // GET /issues/{key}/notes
useNotesCounts(sprintId)         // GET /issues/notes-counts?sprint_id=N
useCreateNote()                  // POST
useUpdateNote()                  // PATCH (debounced caller-side)
useDeleteNote()                  // DELETE
```

All mutations invalidate both `["notes", issueKey]` and `["notes-counts", sprintId]` so badges update immediately.

### Card behaviour

Click anywhere on the card except the Jira-link chip opens the popover. Card body shows: issue key, truncated summary, assignee initials, SP pill, `📝 N` badge when `N > 0`.

### Popover behaviour

- Centered modal, ~480px wide.
- Header: issue key (Jira link) + status pill + close (X).
- Body: vertical list of open notes — each row is a checkbox, editable text, × delete. New "+ Add" input at the top with autofocus on open.
- Inline edits autosave via debounced PATCH (~500ms after last keystroke). Checkbox toggle is immediate.
- Footer: "Show N done from last 14d" toggle. Done items render with strikethrough + `✓ 2d ago`.
- `Esc` or backdrop click closes. Clicking outside an editing note flushes the pending PATCH first.

### Empty states

- Empty column: muted "No tickets".
- Empty notes: "No follow-ups yet — type below to add one".

## Build sequence

1. Migration + model + routes.
2. Hooks + types.
3. `SprintHealthLayout` + route restructure (existing analytics still works).
4. `StandupBoard` + `TicketCard` + `columns.ts` (board renders, no notes yet).
5. `NotesPopover` (badges populate, click opens modal, autosave works).
6. Smoke test: open the board, add 2-3 notes on different tickets, refresh, verify they're back, close one, refresh, verify it's collapsed.

## Risk + open questions

- **Sprint without an active sprint** — `/api/v1/sprints/active` returns 404 today. Board should show an empty state pointing at `/sprint-health` (which already handles closed-sprint variant).
- **Sub-task display** — sub-tasks usually clutter the board view. We'll filter them out by default; revisit if missed.
- **Reopened tickets** mapped to "To Do" might surprise the user. The mapping dict is one line to change; we'll watch behaviour.
