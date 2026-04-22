# team-lens

Private dashboards for the Search team (290) — visibility into quarterly epic risk and per-person sprint health. Lead-facing; not published.

## What's here

- **`docs/`** — authoritative design docs for both dashboards.
  - [`epic-risk-design.md`](docs/epic-risk-design.md) — quarterly epic risk-spotting dashboard.
  - [`sprint-health-design.md`](docs/sprint-health-design.md) — per-person sprint progress + normalized velocity.
- **`apps-script/<dashboard>/`** — Google Apps Script source managed via [clasp](https://github.com/google/clasp). One Apps Script project per dashboard, bound to its Google Sheet.
- **`web/<dashboard>/`** — local static page: `index.html` + `app.js` + `styles.css`. Reads exported CSVs placed in the same folder. Served via `python -m http.server <port>`.
- **`shared/`** — JS utilities shared by both web pages (CSV parsing, staleness badge).

## Stack

Both dashboards follow the same pattern — see `docs/epic-risk-design.md` → "Shared conventions" for the locked-in details. Summary:

```
Jira REST API → Apps Script (daily trigger) → Google Sheet → browser-downloaded CSVs → local HTML + Chart.js
```

No publish-to-web. No backend. All data stays on the lead's machine.

## Ports

| Dashboard | Web folder | Port |
|-----------|------------|------|
| Epic Risk | `web/epic-risk/` | 8080 |
| Sprint Health | `web/sprint-health/` | 8081 |

## Workflow

1. Apps Script runs daily at 07:00 local, refreshes its Google Sheet.
2. Open the Sheet, click the custom menu → `Export CSVs`. Files download to your browser's downloads folder.
3. Move the downloaded CSVs into the dashboard's `web/<dashboard>/` folder.
4. Refresh the local page. Staleness badge reads the new `meta.csv` timestamp.

## Setup

Per-dashboard setup instructions live in each dashboard's folder (`apps-script/<dashboard>/README.md`, `web/<dashboard>/README.md`). Not filled in yet — see design docs for target behaviour.
