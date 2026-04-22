# apps-script/sprint-health

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
- `Main.gs` — `onOpen` menu installer + stubs for `refreshFromJira` and `exportCsvs`. Filled out in follow-up work per `docs/sprint-health-design.md` → "Apps Script — behaviour per run".
