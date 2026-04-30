# apps-script/sprint-health · DEPRECATED 2026-04-30

> **🚫 Retired.** Phase 3 of the local-app rewrite ([docs/local-app/](../../docs/local-app/)) replaces this dashboard. The daily trigger has been removed; this folder is preserved for reference only and will be deleted in Phase 6 (after the 2-week soak period).
>
> **Successor:** `frontend/src/features/sprint-health/SprintHealthPage.tsx`, served by `make backend && make frontend` at `http://localhost:8081/sprint-health`. The metrics come from `GET /api/v1/sprints/{id}/rollup` and friends — see `docs/local-app/04-api-contract.md`.
>
> **Ground-truth verification (2026-04-30):** numbers match Jira to the SP for sprint 18279 (Search 2026-08). See `docs/local-app/09-verification.md` § Phase 3 for the per-person comparison table.

---

Google Apps Script source for the Sprint Health dashboard, managed via `clasp`.

## Google resources

- **Sheet:** `1jvQlzfBvVOtHJQ6kpIGr50sOtgA1gGbSzCYuNIoEvUY`
  <https://drive.google.com/open?id=1jvQlzfBvVOtHJQ6kpIGr50sOtgA1gGbSzCYuNIoEvUY>
- **Script:** `1-WeOkI5xoiOtljcEdLz9rTa_BkRzHK8os5qkLdrLBpdKYXrbKTtYycnh`
  <https://script.google.com/d/1-WeOkI5xoiOtljcEdLz9rTa_BkRzHK8os5qkLdrLBpdKYXrbKTtYycnh/edit>

Owned by `kptikku@gmail.com`. `.clasp.json` is gitignored; run `clasp clone 1-WeOkI5xoiOtljcEdLz9rTa_BkRzHK8os5qkLdrLBpdKYXrbKTtYycnh --rootDir .` from this directory on a new machine to re-bind.

The external Leave sheet is a separate Google Sheet; its ID goes into this dashboard's `Config` tab (per `docs/sprint-health-design.md` → "Google Sheet — structure"). The Apps Script will need `SpreadsheetApp.openById` permission to read it — granted on first run.

## Daily commands

From this directory:

| Command | What it does |
|---|---|
| `clasp push` | Sync local `.gs` / `.json` → Apps Script. `-f` required when `appsscript.json` changes. |
| `clasp pull` | Sync Apps Script → local. Use after edits made in the online editor. |
| `clasp open-script` | Open the Apps Script IDE in a browser. |
| `clasp open-container` | Open the bound Sheet. |
| `clasp logs` | Tail Stackdriver logs for the script. |

## Files

- `appsscript.json` — project manifest (timezone `Asia/Kolkata`, V8 runtime).
- `Main.gs` — `onOpen` menu installer and `initializeSheet`. Creates the Config, Tickets, TicketState, Sprints, VelocityComputed, CarryOver, ScopeChanges, EpicContribution, and RunLog tabs with their header rows. Idempotent.
- `JiraClient.gs` — Jira REST client with retry/backoff, paginated `searchJql` via `/rest/api/3/search/jql`, and `getCustomFieldId` for resolving Story Points / Sprint field IDs by name.
- `Aggregator.gs` — `refreshFromJira` entry point: fetches current + last-6 sprint tickets, harvests sprint metadata from the sprint field, runs snapshot-diff against the persisted `TicketState` tab to emit `ScopeChanges`, rolls up per-person × per-sprint SP committed / completed / velocity / commitment-accuracy with leave adjustment from the external Leave sheet, plus `CarryOver` and `EpicContribution`. Per `docs/sprint-health-design.md` → "Apps Script — behaviour per run".
- `Export.gs` — `exportCsvs` menu command. Opens a modal dialog with one-click downloads of `velocity.csv`, `carry_over.csv`, `scope_changes.csv`, `epic_contribution.csv`, `meta.csv`. Raw Tickets / TicketState / Sprints stay in the Sheet only.
- `Triggers.gs` — `installDailyTrigger` / `removeDailyTrigger` for the 07:00 time-based refresh.

## Initial setup

On first install, from the bound Sheet:

1. `Sprint Health → Initialize Sheet` — creates all tabs.
2. `Sprint Health → Set Jira Token` — stores your email + API token in user-scoped `PropertiesService`. Token: <https://id.atlassian.com/manage-profile/security/api-tokens>.
3. `Sprint Health → Test Jira auth` — verifies the token against `/rest/api/3/myself`.
4. In the `Config` tab, fill in `leave_sheet_id` (the external Leave sheet) and `sprint_ids_last6` (comma-separated Jira sprint IDs for the last 6 closed Search sprints, newest last). Everything else has a reasonable default.
5. `Sprint Health → Refresh from Jira` — dry run. First run seeds `TicketState` baselines silently (no `ScopeChanges` rows; see design doc "Snapshot-diff vs. changelog parsing" for why).
6. `Sprint Health → Install daily trigger` — schedules 07:00 daily refresh.
