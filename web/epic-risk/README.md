# web/epic-risk

Local HTML page for the Epic Risk dashboard. Reads three CSVs from this folder and renders a staleness badge, hero stat + 6-sprint sparkline, epic cards grid with flag dots, and a per-epic throughput trend chart.

## One-time setup

Copy or symlink this folder to `~/dashboards/epic-risk/` (the path the design docs assume):

```bash
mkdir -p ~/dashboards
ln -s "$PWD" ~/dashboards/epic-risk
```

(Or just run the server from here; the path is convention only.)

## Running

```bash
cd ~/dashboards/epic-risk   # or this folder
python3 -m http.server 8080
```

Open <http://localhost:8080>.

## Refresh workflow

1. In the Google Sheet, run `Epic Risk → Refresh from Jira` (or let the 07:00 trigger do it).
2. Run `Epic Risk → Export CSVs`. A dialog opens with one-click download links for `epics.csv`, `epic_sprint_history.csv`, `meta.csv`.
3. Move the three downloaded files from your browser's Downloads folder into this directory (overwriting any previous copy).
4. Reload the page. The staleness badge will update from `meta.csv`'s `last_run_iso` timestamp.

## Expected files

| File | Source | Required |
|---|---|---|
| `epics.csv` | `Epics` tab | yes |
| `epic_sprint_history.csv` | `EpicSprintHistory` tab | yes |
| `meta.csv` | newest `RunLog` row | yes |
| `index.html`, `app.js`, `styles.css` | this repo | yes |

All CSVs are gitignored (`web/*/*.csv`). The code is committed; the data never is.

## Staleness thresholds

`meta.csv`'s `last_run_iso` drives the badge at the top-right:

- 🟢 Green — last refresh ≤ 24h ago
- 🟡 Yellow — 24–72h ago
- 🔴 Red — > 72h ago, or run status was `error`, or no runs yet

## Dependencies

Chart.js 4.4 via CDN (`cdn.jsdelivr.net`). No build step, no Node, no npm. If you need to run offline, download `chart.umd.min.js` locally and update the `<script>` tag in `index.html`.
