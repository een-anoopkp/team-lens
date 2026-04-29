# 09 — Verification

## Per-phase verification checklist

### Phase 1 (Data Foundation)

- [ ] `curl localhost:8000/api/v1/health` → `{db: "ok", jira: "ok", configured: true}`.
- [ ] `POST /api/v1/setup/jira` with valid creds → 200; `.env` updated; subsequent `/health` shows `jira: "ok"`.
- [ ] `POST /api/v1/setup/jira` with bad token → 401; `.env` unchanged.
- [ ] First full sync completes; `psql -c "SELECT COUNT(*) FROM issues"` ≈ JQL count from Jira UI for `cf[10500]=team`.
- [ ] All entity tables populated: `issues`, `sprints`, `epics`, `initiatives`, `people`, `comments`, `ticket_state_snapshots`, `scope_change_events`, `project_snapshots` (if any closed projects), `holidays` (seeded).
- [ ] Run incremental sync twice with one manual Story Point edit between runs. Second run's response includes `sp_changes >= 1` and `issues_seen` is small (only updated tickets). `psql -c "SELECT * FROM scope_change_events ORDER BY id DESC LIMIT 1"` shows the edit.
- [ ] Add a brand-new ticket to the active sprint mid-cycle in Jira → next sync produces a `change_type='added_mid_sprint'` row.
- [ ] Delete a ticket's `cf[10500]` in Jira → run full scan → ticket has `removed_at IS NOT NULL`.
- [ ] Backend killed mid-sync → on restart, orphaned `running` row is marked `failed` with explanatory message.

### Phase 3 (Sprint Health)

**Ground-truth verification, NOT parity with the legacy CSV.** For one closed sprint:

- [ ] Pick a closed sprint and capture its actual numbers (committed SP, completed SP per person, carry-overs) directly from Jira UI / JQL.
- [ ] Compare against `GET /api/v1/sprints/{id}` and `GET /api/v1/metrics/velocity?sprint_window=6`.
- [ ] Numbers must match within rounding. Document any discrepancies with explanations in this file under the "Discrepancy log" section below — anything beyond rounding noise blocks Phase 3 acceptance.
- [ ] Open `/sprint-health` for that sprint; visually verify burnup, per-person rows, sparklines, carry-over, scope churn, blockers panels populate correctly.
- [ ] Click Refresh; staleness badge updates from yellow/red to green within ~10 s.

### Phase 4 (Epic Risk + Hygiene)

- [ ] `/epic-risk` numbers correct against ground-truth Jira queries for current quarter.
- [ ] `/hygiene/epics-no-initiative` returns at least the known set of epics that lack initiatives (cross-checked manually in Jira).
- [ ] `/hygiene/tasks-no-epic` returns expected count.
- [ ] `/hygiene/by-due-date` colors past-due in red, ≤7d in yellow, 8–30d in green, >30d in grey.
- [ ] Apps Script `epic-risk` daily trigger turned off.

### Phase 5 (Projects + Monitoring)

- [ ] Label two epics in Jira (`proj_test-a`, `proj_test-b`); next sync surfaces them on `/projects`.
- [ ] Drill into one project; ETD by velocity and ETD by sprint-assignment both displayed.
- [ ] Mark all epics under one project as Done; next sync triggers freeze job; project appears in Completed section + `project_snapshots` row exists.
- [ ] Re-open a Done epic in a Completed project; auto-classifier flips it back to Active; snapshot row stays.
- [ ] `/projects/monitoring` shows comparison if ≥5 closed snapshots; otherwise shows "not enough history yet" empty state.

### Phase 6 (Decommission) — final checklist

- [ ] Every legacy use case (every CSV-driven view, every Apps Script daily output) is now served by the new system. Tick off here:
  - [ ] Sprint Health velocity per person
  - [ ] Sprint Health carry-over
  - [ ] Sprint Health scope churn
  - [ ] Sprint Health blockers
  - [ ] Sprint Health hygiene-inline counts
  - [ ] Sprint Health 6-sprint trend
  - [ ] Epic Risk hero stat + sparkline
  - [ ] Epic Risk epic cards
  - [ ] Epic Risk throughput chart
  - [ ] (Any other panel / view we forgot)
- [ ] 2-week soak period elapsed with no fallback to legacy.
- [ ] No outstanding bugs that would justify keeping legacy code accessible.

## Test infrastructure

- **Backend:** `pytest` + `httpx` ASGI client + `respx` for Jira mocking.
- **Frontend:** Vitest + Testing Library.
- **End-to-end:** one Playwright check (Refresh button → all panels populated) at end of Phase 3 and Phase 4.

## Jira mocking strategy

`respx` (httpx-native mocking) wraps the Jira client in tests. Fixtures live in `backend/tests/fixtures/jira/` as static JSON captures of real responses (one per endpoint).

Capture script: `scripts/capture_jira_fixtures.py` runs against the real tenant once, scrubs `accountId` → predictable test IDs, and writes the fixture set. Re-run when Jira API contract drifts.

```python
# Example fixture capture
async def capture():
    async with JiraClient(...) as jira:
        fields = await jira.get('/rest/api/3/field')
        write_fixture('field/list.json', scrub(fields))
        # ... etc.
```

## Ground-truth baseline (captured 2026-04-30 from `eagleeyenetworks.atlassian.net` via Atlassian MCP)

**Sprint:** Search 2026-08 (`sprint_id = 18279`, board 135)
**Window:** 2026-04-16T14:37:51Z → 2026-04-29T09:30:00Z (planned end), completed 2026-04-29T11:13:21Z
**Length:** 13 days
**State at capture:** closed
**Issue count:** 140 total (58 Story, 48 Sub-task, 32 Bug, 2 Improvement)
**Status distribution:** 79 done / 35 indeterminate / 26 new

### Aggregate totals (excluding Sub-tasks; Sub-tasks have no SP)

| Metric | SP | Notes |
|---|---|---|
| **Total in-sprint SP** (current SP at close — proxy for committed; we have no `first_sp` history yet) | **307** | All Stories + Bugs + Improvements |
| **Completed SP — naive** (status_category=done) | 160 | Counts 2 tickets resolved 2026-04-15, before sprint start |
| **Completed SP — strict** (status=done AND resolutiondate ∈ [start, complete]) | **157** | This is the value the locked "Done SP" definition produces |
| **Carry-over** (status_category != done at close) | 147 SP across 47 tickets | Diff: 307 − 157 = 150 (close to carry+excluded; minor reconciliation rounding) |

### Per-person committed (current SP, excl. sub-tasks)

| Person | SP | Tickets |
|---|---|---|
| Chirag Lodha | 54 | 14 |
| deep.o | 48 | 16 |
| Rohan Sharma | 38 | 9 |
| Sahithy Tumma | 36 | 17 |
| Mathew Sebastian | 34 | 8 |
| Bhaskar C | 33 | 6 |
| Satcheel Reddy Chamakoora | 30 | 8 |
| Ketan Joshi | 23 | 5 |
| Dasari Rana-Prathap | 6 | 5 |
| Anoop K Prabhu | 5 | 3 |
| Nikhil Bhuvanagiri | 0 | 1 |

### Per-person completed (strict — resolutiondate within sprint window, excl. sub-tasks)

| Person | SP | Tickets |
|---|---|---|
| Chirag Lodha | 42 | 9 |
| Rohan Sharma | 21 | 4 |
| Bhaskar C | 20 | 4 |
| Sahithy Tumma | 18 | 9 |
| Satcheel Reddy Chamakoora | 17 | 4 |
| Mathew Sebastian | 16 | 5 |
| deep.o | 14 | 5 |
| Ketan Joshi | 5 | 1 |
| Dasari Rana-Prathap | 3 | 1 |
| Anoop K Prabhu | 1 | 1 |

### Tickets resolved BEFORE sprint start (excluded from "Completed" by strict definition)

These are tickets in sprint 18279 with `resolutiondate < sprint.start_date` — added to a sprint they had already finished in. The strict Done-SP definition correctly excludes them:

| Key | Assignee | SP | Resolution |
|---|---|---|---|
| EEPD-115910 | Dasari Rana-Prathap | 0 | 2026-04-15T08:35Z |
| EEPD-115694 | Dasari Rana-Prathap | 3 | 2026-04-15T08:35Z |

### Carry-over per person (not done at close)

| Person | Carry SP | Tickets |
|---|---|---|
| deep.o | 34 | 11 |
| Sahithy Tumma | 18 | 8 |
| Ketan Joshi | 18 | 4 |
| Mathew Sebastian | 18 | 3 |
| Rohan Sharma | 17 | 5 |
| Bhaskar C | 13 | 2 |
| Satcheel Reddy Chamakoora | 13 | 4 |
| Chirag Lodha | 12 | 5 |
| Anoop K Prabhu | 4 | 2 |
| Dasari Rana-Prathap | 0 | 2 |
| Nikhil Bhuvanagiri | 0 | 1 |

### Scope-change events

Cannot reconstruct from a one-shot snapshot — needs sync-history. Will populate on first weekly observation under the new system. Phase 3 verification compares forward-going scope events, not historical ones.

### Phase 3 verification target

When `/api/v1/sprints/18279` and `/api/v1/metrics/velocity?sprint_window=...` come online, the **strict per-person completed SP** numbers above are the authoritative reference. Discrepancies > 1 SP for any person block Phase 3 acceptance unless explained.

## Discrepancy log

> _Populated during Phase 3 verification. Format:_

```
2026-MM-DD — Sprint XX
  Metric: Per-person velocity for Karthik
  Ground truth (Jira): 6.4 SP/day
  New system: 6.5 SP/day
  Cause: rounding only — acceptable.

2026-MM-DD — Sprint XX
  Metric: Carry-over count
  Ground truth: 3 tickets
  New system: 4 tickets
  Cause: new system counted ticket SEARCH-1234 which was actually...
  Resolution: bug fixed in commit XXX.
```
