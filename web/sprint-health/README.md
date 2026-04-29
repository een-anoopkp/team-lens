# web/sprint-health

Local HTML page for the Sprint Health dashboard. Reads four CSVs from this folder and renders a staleness badge, a per-person normalized velocity line chart, per-person commitment-accuracy sparklines, a carry-over table, and an active-sprint scope-churn summary with drill-down.

## One-time setup

Copy or symlink this folder to `~/dashboards/sprint-health/` (the path the design docs assume):

```bash
mkdir -p ~/dashboards
ln -s "$PWD" ~/dashboards/sprint-health
```

(Or just run the server from here; the path is convention only.)

## Running

```bash
cd ~/dashboards/sprint-health   # or this folder
python3 -m http.server 8081
```

Open <http://localhost:8081>. Port 8081 is the convention — epic-risk uses 8080 so you can run both side-by-side.

## Refresh workflow

1. In the Google Sheet, run `Sprint Health → Refresh from Jira` (or let the 07:00 trigger do it).
2. Run `Sprint Health → Export CSVs`. A dialog opens with one-click download links for `velocity.csv`, `carry_over.csv`, `scope_changes.csv`, `epic_contribution.csv`, `meta.csv`.
3. Move the downloaded files from your browser's Downloads folder into this directory (overwriting any previous copy).
4. Reload the page. The staleness badge will update from `meta.csv`'s `last_run_iso` timestamp.

## Expected files

| File | Source | Used by |
|---|---|---|
| `velocity.csv` | `VelocityComputed` tab | velocity chart, accuracy tiles |
| `carry_over.csv` | `CarryOver` tab | carry-over table |
| `scope_changes.csv` | `ScopeChanges` tab | scope churn panel |
| `epic_contribution.csv` | `EpicContribution` tab | not rendered (Sheet-only per design) |
| `meta.csv` | newest `RunLog` row | staleness badge, active-sprint selector |
| `index.html`, `app.js`, `styles.css` | this repo | — |

All CSVs are gitignored (`web/*/*.csv`). Per-person data never lands in git.

## Staleness thresholds

`meta.csv`'s `last_run_iso` drives the badge at the top-right:

- 🟢 Green — last refresh ≤ 24h ago
- 🟡 Yellow — 24–72h ago
- 🔴 Red — > 72h ago, or run status was `error`, or no runs yet

## Velocity chart readability

Chart.js with 10 lines can get noisy. Click a name in the legend to isolate a single person during a 1:1 — every other line greys out. If this becomes unworkable with a larger team, the design calls for upgrading to Plotly; not before.

## Dependencies

Chart.js 4.4 via CDN (`cdn.jsdelivr.net`). No build step, no Node, no npm. If you need to run offline, download `chart.umd.min.js` locally and update the `<script>` tag in `index.html`.
