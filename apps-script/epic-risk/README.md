# apps-script/epic-risk · DEPRECATED 2026-04-30

> **🚫 Retired.** Phase 4 of the local-app rewrite ([docs/local-app/](../../docs/local-app/)) replaces this dashboard. The daily trigger has been removed; this folder is preserved for reference only and will be deleted in Phase 6 (after the 2-week soak period).
>
> **Successor:** `frontend/src/features/epic-risk/EpicRiskPage.tsx`, served by `make backend && make frontend` at `http://localhost:8081/epic-risk`. Backed by `GET /api/v1/metrics/epic-risk` + `/api/v1/metrics/epic-throughput`.

---

Google Apps Script source for the Epic Risk dashboard, managed via `clasp`.

## Google resources

- **Sheet:** `12QQ5X-RZjTE2hOtVG1VVGIFz75Wlhl898wJVG-AU6cA`
  <https://drive.google.com/open?id=12QQ5X-RZjTE2hOtVG1VVGIFz75Wlhl898wJVG-AU6cA>
- **Script:** `1rS1PbQjEVSm9YRprUPkfVyZJNJ73qN2qgNZJurzFpK7ioEZ57H12zylD`
  <https://script.google.com/d/1rS1PbQjEVSm9YRprUPkfVyZJNJ73qN2qgNZJurzFpK7ioEZ57H12zylD/edit>

Owned by `kptikku@gmail.com`. `.clasp.json` is gitignored; run `clasp clone 1rS1PbQjEVSm9YRprUPkfVyZJNJ73qN2qgNZJurzFpK7ioEZ57H12zylD --rootDir .` from this directory on a new machine to re-bind.

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
- `Main.gs` — `onOpen` menu installer + stubs for `refreshFromJira` and `exportCsvs`. Filled out in follow-up work per `docs/epic-risk-design.md` → "Apps Script — behaviour per run".
