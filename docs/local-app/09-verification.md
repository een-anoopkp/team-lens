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

## Ground-truth baseline (pre-Phase-1)

Pre-Phase-1 step 0.3: pick the most recent closed sprint and capture its actual numbers here, so Phase 3 has an unambiguous reference point.

> _To be filled in before Phase 1 starts._

```
Sprint: Search-Sprint-XX (start: YYYY-MM-DD, end: YYYY-MM-DD)
Total committed SP: ___
Total completed SP: ___
Per-person breakdown:
  - Anoop: committed __, completed __
  - Priya:  committed __, completed __
  - Karthik: committed __, completed __
  - ...
Carry-overs: __ tickets, __ SP
Scope-change events seen: __ SP added, __ SP removed
```

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
