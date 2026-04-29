/**
 * team-lens: Sprint Health — local page.
 *
 * Reads velocity.csv, carry_over.csv, scope_changes.csv, and meta.csv from the
 * same folder (placed there by Apps Script → Export CSVs), and renders:
 *   1. Sprint dropdown + staleness badge (from meta.csv).
 *   2. Active view: team KPIs (leave-adjusted velocity), burnup stub,
 *      per-person snapshot, commitment-accuracy sparklines.
 *   3. Closed view: team KPIs (leave-adjusted velocity), per-person final.
 *   4. 6-sprint trend (always visible), carry-over table, scope-churn table.
 *
 * Team leaves are stored per-sprint in localStorage. They are a browser-local
 * overlay on the Sheet's velocity numbers — the Sheet itself doesn't know
 * about leaves (by design). Velocity in all charts is recomputed client-side
 * from raw sp_done and leave-adjusted available-days.
 *
 * Weekends are already excluded — working-days default to 10 (Mon–Fri × 2
 * weeks). The leaves modal collects weekday counts only.
 *
 * Chart.js loaded via CDN in index.html; no build step.
 */

const WORKING_DAYS = 10;
const LEAVES_KEY = 'sprintHealth.leaves.v1';
const WHITELIST_KEY = 'sprintHealth.whitelist.v1';
const FILTER_KEY = 'sprintHealth.filter.v1';
const JIRA_BASE = 'https://eagleeyenetworks.atlassian.net';
// Filter 1 (Search-Sprint-Current) numeric ID — pins every hygiene JQL to
// "team + open sprint". Change this only if the saved filter is re-created.
const JIRA_FILTER_CURRENT = 23075;

let state = null;  // set after loadAll()

// Sort preferences for the per-person snapshot. One entry per view. Defaults
// match the prior hard-coded behaviour: active sprints alphabetical, closed
// sprints by completion % descending (most-done first).
const sortState = {
  active: { key: 'person', dir: 'asc' },
  closed: { key: 'pct',    dir: 'desc' }
};

(async function main() {
  try {
    const [velocity, carryOver, scopeChanges, blockers, burnup, meta] = await Promise.all([
      loadCsv('./velocity.csv'),
      loadCsv('./carry_over.csv'),
      loadCsv('./scope_changes.csv'),
      loadCsvOptional('./blockers.csv'),
      loadCsvOptional('./sprint_progress_active.csv'),
      loadCsv('./meta.csv')
    ]);
    state = buildState(velocity, carryOver, scopeChanges, blockers, burnup, meta);
    populateDropdown();
    wireModal();
    wireWhitelistModal();
    wireFilterModal();
    wireSortHeaders();
    renderStaleness(meta);
    render();
  } catch (err) {
    console.error(err);
    const el = document.getElementById('error');
    el.hidden = false;
    el.innerHTML =
      '<strong>Failed to load CSVs.</strong> ' + escapeHtml(err.message) +
      '<br>Run <code>Sprint Health → Export CSVs</code> and drop ' +
      '<code>velocity.csv</code>, <code>carry_over.csv</code>, ' +
      '<code>scope_changes.csv</code>, <code>meta.csv</code> into this folder.';
  }
})();

/* ---------- state ---------- */

/**
 * Shape the raw CSV rows into structures the render functions consume.
 * sprints: ordered (by insertion order in velocity.csv, with active sprint
 *   surfaced last), each with {name, isActive, rows: [{person,committed,done,...}]}.
 * allPeople: union of person names across all sprints.
 */
function buildState(velocity, carryOver, scopeChanges, blockers, burnup, meta) {
  const activeSprint = (meta[0] && meta[0].active_sprint) || '';
  const sprintOrderSeen = [];
  const sprintSet = new Set();
  const bySprint = new Map();

  for (const row of velocity) {
    const s = row.sprint;
    if (!s || !row.person) continue;
    if (!sprintSet.has(s)) {
      sprintSet.add(s);
      sprintOrderSeen.push(s);
      bySprint.set(s, []);
    }
    bySprint.get(s).push({
      person: row.person,
      committed: num(row.sp_committed),
      done: num(row.sp_completed),
      workingDays: num(row.working_days) || WORKING_DAYS,
      sheetAvailable: num(row.available_days) || WORKING_DAYS,
      // `velocity` from the Sheet is done ÷ available_days as computed by the
      // Apps Script. It's unused here — we recompute from done + modal leaves.
      sheetVelocity: num(row.velocity),
      sheetAccuracy: row.commitment_accuracy === '' ? null : num(row.commitment_accuracy),
      spByStatus: parseStatusBreakdown(row.sp_by_status)
    });
  }

  // Present sprints oldest → newest from velocity.csv order, with active last.
  const ordered = sprintOrderSeen.slice();
  if (activeSprint && sprintSet.has(activeSprint)) {
    const idx = ordered.indexOf(activeSprint);
    if (idx >= 0 && idx !== ordered.length - 1) {
      ordered.splice(idx, 1);
      ordered.push(activeSprint);
    }
  }

  const sprints = ordered.map(name => ({
    name,
    isActive: name === activeSprint,
    rows: bySprint.get(name) || []
  }));

  const peopleSet = new Set();
  for (const s of sprints) for (const r of s.rows) peopleSet.add(r.person);
  const allPeople = Array.from(peopleSet).sort();

  return { sprints, allPeople, activeSprint, carryOver, scopeChanges, blockers, burnup, meta };
}

/* ---------- whitelist + filter ----------
 *
 * Whitelist: who's on the team. Non-whitelisted people are excluded from
 * team-level aggregates AND from individual displays. Default (no entry
 * in localStorage) is "everyone counts" — backward compatible.
 *
 * Filter: a further narrowing within the whitelist. Only affects the
 * individual displays — team KPIs ignore the filter. Lets you narrow to
 * one person during a 1:1 without breaking the team view.
 */

function loadListStorage_(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}
function saveListStorage_(key, list) {
  if (!list || !list.length) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(list));
}

function loadWhitelist() { return loadListStorage_(WHITELIST_KEY); }
function saveWhitelist(list) { saveListStorage_(WHITELIST_KEY, list); }
function loadFilter() { return loadListStorage_(FILTER_KEY); }
function saveFilter(list) { saveListStorage_(FILTER_KEY, list); }

/** In the team? True if whitelist is empty (default) or contains the person. */
function inTeam(person) {
  const wl = loadWhitelist();
  if (!wl || wl.length === 0) return true;
  return wl.indexOf(person) !== -1;
}

/** Shown in individual displays? Must be whitelisted AND pass the filter. */
function showIndividual(person) {
  if (!inTeam(person)) return false;
  const f = loadFilter();
  if (!f || f.length === 0) return true;
  return f.indexOf(person) !== -1;
}

/* ---------- leaves ---------- */

function loadLeaves() {
  try { return JSON.parse(localStorage.getItem(LEAVES_KEY) || '{}'); }
  catch { return {}; }
}
function saveLeaves(obj) {
  localStorage.setItem(LEAVES_KEY, JSON.stringify(obj));
}
function leavesForSprint(sprintName) {
  const all = loadLeaves();
  return all[sprintName] || { publicHolidays: 0, perPerson: {} };
}
function availableDays(sprintName, person) {
  const L = leavesForSprint(sprintName);
  const pub = Number(L.publicHolidays) || 0;
  const own = Number(L.perPerson[person]) || 0;
  return Math.max(WORKING_DAYS - pub - own, 1);
}

/* ---------- sprint dropdown ---------- */

const sel = document.getElementById('sprintSelect');
function populateDropdown() {
  // Show newest sprint first in the dropdown (reverse of stored order).
  const reversed = state.sprints.slice().reverse();
  sel.innerHTML = reversed.map(s =>
    `<option value="${escapeAttr(s.name)}">${escapeHtml(s.name)}${s.isActive ? '  (active)' : ''}</option>`
  ).join('');
  sel.addEventListener('change', render);
}

function selectedSprint() {
  return state.sprints.find(s => s.name === sel.value) || state.sprints[state.sprints.length - 1];
}

/* ---------- render dispatch ---------- */

function render() {
  const sprint = selectedSprint();
  if (!sprint) return;

  document.getElementById('view-active').classList.toggle('hidden', !sprint.isActive);
  document.getElementById('view-closed').classList.toggle('hidden', sprint.isActive);
  document.getElementById('scope-panel').style.display = sprint.isActive ? '' : 'none';

  document.getElementById('active-name').textContent = sprint.name;
  document.getElementById('closed-name').textContent = sprint.name;
  document.getElementById('scope-sprint-label').textContent = sprint.name;
  // Sprint banner subtitle: we don't have sprint start/end dates in the CSVs
  // yet, so show generic capacity text rather than fake dates.
  const subText = '· ' + sprint.rows.length + ' people · ' +
    WORKING_DAYS + ' working days (weekdays only)';
  document.getElementById('active-banner-sub').textContent = subText;
  document.getElementById('closed-banner-sub').textContent = subText;

  const sortedRows = sortForView(sprint.rows, sprint.isActive, sprint.name);
  // For individual displays: apply whitelist + filter.
  // For team KPIs: apply whitelist only (filter doesn't affect team totals).
  const shown = sortedRows.filter(r => showIndividual(r.person));
  const teamSet = sortedRows.filter(r => inTeam(r.person));

  if (sprint.isActive) {
    renderPersonRows(document.getElementById('active-person-rows'), shown, sprint.name);
    renderActiveTeamKpis(teamSet, sprint.name);
    renderScopeChurn(state.scopeChanges, sprint.name);
  } else {
    renderPersonRows(document.getElementById('closed-person-rows'), shown, sprint.name);
    renderClosedTeamKpis(teamSet, sprint.name);
  }
  renderAccuracyTiles();
  renderCarryOver(state.carryOver);
  renderBlockers(state.blockers);
  paintSortIndicators();

  requestAnimationFrame(() => {
    renderTrend();
    if (sprint.isActive) renderBurnup();
  });
}

/**
 * Return a new array sorted by the view's current sort preference. Rows are
 * the already-materialised per-person objects {person, committed, done, ...}.
 * `sprintName` is needed for leave-adjusted velocity comparisons.
 */
function sortForView(rows, isActive, sprintName) {
  const pref = sortState[isActive ? 'active' : 'closed'];
  const dir = pref.dir === 'asc' ? 1 : -1;
  const key = pref.key;

  const pct = r => r.committed > 0 ? r.done / r.committed : 0;
  const vel = r => {
    const a = availableDays(sprintName, r.person);
    return a > 0 ? r.done / a : 0;
  };

  const compare = {
    person:    (a, b) => a.person.localeCompare(b.person),
    committed: (a, b) => a.committed - b.committed,
    done:      (a, b) => a.done - b.done,
    pct:       (a, b) => pct(a) - pct(b),
    velocity:  (a, b) => vel(a) - vel(b)
  }[key] || ((a, b) => a.person.localeCompare(b.person));

  return rows.slice().sort((a, b) => dir * compare(a, b));
}

function wireSortHeaders() {
  document.querySelectorAll('.person-row.header.sortable').forEach(hdr => {
    const viewName = hdr.dataset.view;  // 'active' or 'closed'
    hdr.querySelectorAll('span[data-sort]').forEach(cell => {
      cell.addEventListener('click', () => {
        const key = cell.dataset.sort;
        const current = sortState[viewName];
        if (current.key === key) {
          current.dir = current.dir === 'asc' ? 'desc' : 'asc';
        } else {
          current.key = key;
          // New column: asc for string (person), desc for numeric (bigger-first).
          current.dir = key === 'person' ? 'asc' : 'desc';
        }
        render();
      });
    });
  });
}

/**
 * Paint the sort arrow on the column that's currently driving the order,
 * and clear it from the others. Called after each render so both active
 * and closed header rows show their current state.
 */
function paintSortIndicators() {
  document.querySelectorAll('.person-row.header.sortable').forEach(hdr => {
    const viewName = hdr.dataset.view;
    const pref = sortState[viewName];
    hdr.querySelectorAll('span[data-sort]').forEach(cell => {
      cell.classList.remove('sorted', 'asc', 'desc');
      if (cell.dataset.sort === pref.key) {
        cell.classList.add('sorted', pref.dir);
      }
    });
  });
}

/* ---------- staleness ---------- */

function renderStaleness(meta) {
  const el = document.getElementById('staleness');
  if (!meta.length || !meta[0].last_run_iso) {
    el.textContent = 'No runs yet';
    el.className = 'staleness red';
    return;
  }
  const ts = new Date(meta[0].last_run_iso);
  const ageH = (Date.now() - ts.getTime()) / 3.6e6;
  let band;
  if (ageH <= 24) band = 'green';
  else if (ageH <= 72) band = 'yellow';
  else band = 'red';
  const statusTag = meta[0].last_run_status === 'error' ? ' · error' : '';
  el.textContent = 'Last refresh: ' + formatRelative(ts) + statusTag;
  el.className = 'staleness ' + band;
  el.title = ts.toString();
}

/* ---------- team KPIs ---------- */

function teamVelocity(rows, sprintName) {
  return rows.reduce((sum, r) => {
    const avail = availableDays(sprintName, r.person);
    return sum + (avail > 0 ? r.done / avail : 0);
  }, 0);
}

function renderActiveTeamKpis(rows, sprintName) {
  const totalCommitted = rows.reduce((s, r) => s + r.committed, 0);
  const totalDone = rows.reduce((s, r) => s + r.done, 0);
  const totalAvail = rows.reduce((s, r) => s + availableDays(sprintName, r.person), 0);
  const nominalAvail = rows.length * WORKING_DAYS;
  const teamVel = teamVelocity(rows, sprintName);
  const pct = totalCommitted > 0 ? Math.round(totalDone / totalCommitted * 100) : 0;

  set('kpi-committed', totalCommitted);
  set('kpi-committed-sub', 'baseline across ' + rows.length + ' people');
  set('kpi-done', totalDone);
  set('kpi-done-sub', pct + '% of committed');
  set('kpi-team-vel', teamVel.toFixed(1));
  set('kpi-team-vel-sub',
    'sum of per-person velocities · capacity ' + totalAvail + '/' + nominalAvail + ' person-days');
  // Projected at end: placeholder until meta.csv carries sprint start/end.
  // We'd compute current_done + (current_done / days_elapsed) * days_remaining.
  set('kpi-projected', '—');
  set('kpi-projected-sub', 'needs sprint dates in meta.csv (Phase 2)');
  renderHygieneLine();
}

/**
 * Hygiene line: clickable counts that drill through to the Jira issue
 * search for the matching tickets. Counts come from meta.csv (written by
 * the Apps Script each refresh); the JQLs are anchored to Filter 1
 * (Search-Sprint-Current) so the "team + open sprint" scope can't drift.
 */
function renderHygieneLine() {
  const line = document.getElementById('hygiene-line');
  if (!line) return;
  const m = (state.meta && state.meta[0]) || {};
  const hasNumbers = ('hygiene_unassigned' in m || 'hygiene_nosp' in m || 'hygiene_noepic' in m);
  if (!hasNumbers) {
    // Old meta.csv from before these columns landed — leave the static link
    // to the Jira dashboard as a fallback.
    line.innerHTML =
      'Hygiene: <span class="muted">refresh from Jira to populate counts ' +
      '(meta.csv missing hygiene columns).</span>';
    return;
  }
  const unassigned = num(m.hygiene_unassigned);
  const nosp = num(m.hygiene_nosp);
  const noepic = num(m.hygiene_noepic);

  const url = jql => JIRA_BASE + '/issues/?jql=' + encodeURIComponent(jql);
  const urlUnassigned = url('filter = ' + JIRA_FILTER_CURRENT + ' AND assignee is EMPTY');
  const urlNoSp = url('filter = ' + JIRA_FILTER_CURRENT + ' AND "Story Points" is EMPTY AND issuetype != Sub-task');
  const urlNoEpic = url('filter = ' + JIRA_FILTER_CURRENT + ' AND parent is EMPTY AND issuetype != Sub-task');

  const item = (count, url, label, ok) => {
    const cls = count === 0 ? 'ok' : 'bad';
    const icon = count === 0 ? '✓' : '⚠';
    return '<a class="' + cls + '" href="' + url + '" target="_blank" rel="noopener">' +
      icon + ' ' + count + ' ' + escapeHtml(label) + '</a>';
  };

  line.innerHTML =
    'Hygiene: ' +
    item(unassigned, urlUnassigned, 'unassigned') + ' · ' +
    item(nosp, urlNoSp, 'without Story Points') + ' · ' +
    item(noepic, urlNoEpic, 'without Epic');
}

function renderClosedTeamKpis(rows, sprintName) {
  const totalCommitted = rows.reduce((s, r) => s + r.committed, 0);
  const totalDone = rows.reduce((s, r) => s + r.done, 0);
  const totalAvail = rows.reduce((s, r) => s + availableDays(sprintName, r.person), 0);
  const nominalAvail = rows.length * WORKING_DAYS;
  const teamVel = teamVelocity(rows, sprintName);
  const pct = totalCommitted > 0 ? Math.round(totalDone / totalCommitted * 100) : 0;
  const rolled = Math.max(totalCommitted - totalDone, 0);

  set('closed-kpi-committed', totalCommitted);
  set('closed-kpi-done', totalDone);
  set('closed-kpi-done-sub', pct + '% of committed');
  set('closed-kpi-vel', teamVel.toFixed(1));
  set('closed-kpi-vel-sub',
    'sum of per-person velocities · capacity ' + totalAvail + '/' + nominalAvail + ' person-days');
  set('closed-kpi-rolled', rolled);
  // How many people carried SP forward? Derivable only from CarryOver + the
  // sprint, which the CSV doesn't link cleanly yet — leave a simple subtitle.
  set('closed-kpi-rolled-sub', 'SP committed but not done');
}

/* ---------- per-person rows ---------- */

function renderPersonRows(container, rows, sprintName) {
  container.innerHTML = rows.map(r => {
    const pct = r.committed > 0 ? Math.round(r.done / r.committed * 100) : 0;
    const avail = availableDays(sprintName, r.person);
    const vel = avail > 0 ? (r.done / avail).toFixed(1) : '0.0';
    const bar = renderProgressBar(r, pct);
    return `
      <div class="person-row">
        <span><strong>${escapeHtml(r.person)}</strong></span>
        <span class="progress">
          <span class="progress-track">${bar}</span>
          <span class="progress-pct">${pct}%</span>
        </span>
        <span class="num">${r.committed}</span>
        <span class="num">${r.done}</span>
        <span class="num">${pct}%</span>
        <span class="num" title="SP done ÷ ${avail} available days">${vel}</span>
      </div>`;
  }).join('');
}

/**
 * Render the SP-done bar. If the row has a per-status breakdown (active
 * sprint, data from the Apps Script), show a stacked segmented bar:
 * done → validation → review → in-progress. Remaining width is empty
 * (the track's background), representing To Do / unstarted work.
 *
 * Otherwise (closed sprint or old CSV without the column), fall back to
 * a single solid bar sized by completion pct.
 */
function renderProgressBar(r, pct) {
  const bk = r.spByStatus;
  if (bk && (bk.done || bk.validation || bk.review || bk.in_progress || bk.todo)) {
    // Denominator = committed SP (or total if scope was added past
    // commitment, to keep all segments within the bar).
    const total = bk.done + bk.validation + bk.review + bk.in_progress + bk.todo;
    const denom = Math.max(r.committed, total);
    const seg = (cls, sp, label) => sp > 0
      ? `<span class="progress-fill ${cls}" style="width:${(sp / denom * 100)}%" title="${label}: ${sp} SP"></span>`
      : '';
    return (
      seg('seg-done',        bk.done,        'Done') +
      seg('seg-validation',  bk.validation,  'Validation / QA') +
      seg('seg-review',      bk.review,      'In Review') +
      seg('seg-in-progress', bk.in_progress, 'In Progress')
    );
  }
  const band = pct >= 80 ? '' : pct >= 50 ? ' warn' : ' bad';
  const w = Math.max(Math.min(pct, 100), 3);
  return `<span class="progress-fill${band}" style="width:${w}%"></span>`;
}

/**
 * Parse the sp_by_status JSON column emitted by Aggregator.gs. Returns null
 * when the cell is empty (closed sprint or a CSV from before the column
 * existed). Missing keys default to 0.
 */
function parseStatusBreakdown(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return {
      done:        num(o.done),
      validation:  num(o.validation),
      review:      num(o.review),
      in_progress: num(o.in_progress),
      todo:        num(o.todo)
    };
  } catch {
    return null;
  }
}

/* ---------- commitment accuracy tiles ---------- */

let sparkCharts = [];

function renderAccuracyTiles() {
  const container = document.getElementById('accuracy-tile');
  if (!container) return;
  sparkCharts.forEach(c => c.destroy());
  sparkCharts = [];

  // One tile per person; sparkline is the person's commitment_accuracy from
  // the Sheet across the sprints we have data for. (Accuracy is a pure ratio
  // of done/committed — not leave-dependent — so we don't recompute.)
  // Individual display: whitelist + filter apply.
  const people = state.allPeople.filter(showIndividual);
  container.innerHTML = '';
  const sprintsOrdered = state.sprints.map(s => s.name);

  people.forEach((person, idx) => {
    const series = sprintsOrdered.map(name => {
      const sprint = state.sprints.find(s => s.name === name);
      const row = sprint && sprint.rows.find(r => r.person === person);
      return row && row.sheetAccuracy != null ? row.sheetAccuracy : null;
    });
    const vals = series.filter(v => v != null);
    if (!vals.length) return;
    const latest = [...series].reverse().find(v => v != null);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;

    const tile = document.createElement('div');
    tile.className = 'accuracy-tile';
    tile.innerHTML = `
      <div class="person">${escapeHtml(person)}</div>
      <div class="stats">latest ${fmtPct(latest)} · avg ${fmtPct(avg)}</div>
      <div class="spark"><canvas></canvas></div>`;
    container.appendChild(tile);

    const chart = new Chart(tile.querySelector('canvas').getContext('2d'), {
      type: 'line',
      data: {
        labels: sprintsOrdered,
        datasets: [{
          data: series,
          borderColor: palette(idx),
          backgroundColor: palette(idx, 0.15),
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => (c.parsed.y == null ? '—' : fmtPct(c.parsed.y)) } }
        },
        scales: { x: { display: false }, y: { display: false, suggestedMin: 0.5, suggestedMax: 1.1 } }
      }
    });
    sparkCharts.push(chart);
  });
}

/* ---------- 6-sprint trend (leave-adjusted) ---------- */

let trendChart;
let burnupChart;

function renderTrend() {
  const ctx = document.getElementById('trend-chart');
  if (!ctx) return;
  if (trendChart) trendChart.destroy();

  const sprintsOrdered = state.sprints.map(s => s.name);

  // Per (person, sprint) leave-adjusted velocity = done / available_days,
  // where available_days respects this sprint's leaves from localStorage.
  // Compute for the whole team first — needed for the team-average line.
  const teamVelocity = {};  // whitelist only
  for (const person of state.allPeople.filter(inTeam)) {
    teamVelocity[person] = sprintsOrdered.map(name => {
      const sprint = state.sprints.find(s => s.name === name);
      const row = sprint && sprint.rows.find(r => r.person === person);
      if (!row) return null;
      const avail = availableDays(name, person);
      return avail > 0 ? row.done / avail : 0;
    });
  }

  // Per-person lines: apply the filter too (team avg below uses the full
  // whitelist regardless of filter).
  const datasets = Object.keys(teamVelocity)
    .filter(p => showIndividual(p))
    .map((p, i) => ({
      label: p,
      data: teamVelocity[p],
      borderColor: palette(i),
      backgroundColor: palette(i, 0.10),
      tension: 0.25,
      pointRadius: 3,
      spanGaps: true
    }));

  // Team average across whitelisted people only — filter does not apply.
  const teamAvg = sprintsOrdered.map((_, idx) => {
    const vals = Object.values(teamVelocity)
      .map(arr => arr[idx])
      .filter(v => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
  datasets.push({
    label: 'Team average',
    data: teamAvg,
    borderColor: '#1a1a1a',
    backgroundColor: 'rgba(0,0,0,0)',
    borderDash: [6, 4],
    borderWidth: 2.5,
    tension: 0.2,
    pointRadius: 4,
    pointStyle: 'rectRot',
    spanGaps: true
  });

  trendChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels: sprintsOrdered, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: c => c.dataset.label + ': ' +
              (c.parsed.y == null ? '—' : c.parsed.y.toFixed(2) + ' SP/day')
          }
        }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'SP per available day' } },
        x: { title: { display: true, text: 'Sprint' } }
      }
    }
  });
}

/* ---------- burnup (stub until sprint_progress_active.csv lands) ---------- */

/**
 * Burnup chart for the active sprint. One line per whitelisted individual
 * (respecting the current filter), y = cumulative SP closed as of that day.
 * Plateaus in a line == no closes that day — the stalled-person signal.
 * Source: sprint_progress_active.csv (rows of date, person, cum sp), which
 * the Apps Script derives from ticket resolutiondates — no daily snapshots.
 */
function renderBurnup() {
  const canvas = document.getElementById('burnup-chart');
  const hint = document.getElementById('burnup-hint');
  if (!canvas) return;
  if (burnupChart) burnupChart.destroy();

  const rows = state.burnup || [];
  if (!rows.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hint.innerHTML =
      'No burnup data — refresh from Jira and export ' +
      '<code>sprint_progress_active.csv</code>.';
    return;
  }

  // CSV round-trip through Sheets can coerce yyyy-MM-dd into a full ISO
  // datetime ("2026-04-10T00:00:00.000Z"). Strip to the date portion only
  // for labels; all rows share the same midnight-UTC timestamp so keeping
  // it would clutter every tick uselessly.
  const toDateOnly = s => String(s || '').slice(0, 10);
  const dates = Array.from(new Set(rows.map(r => toDateOnly(r.date)))).sort();
  const byPerson = new Map();
  for (const r of rows) {
    if (!showIndividual(r.person)) continue;
    if (!byPerson.has(r.person)) byPerson.set(r.person, new Map());
    byPerson.get(r.person).set(toDateOnly(r.date), num(r.sp_done_cumulative));
  }

  const datasets = Array.from(byPerson.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([person, m], i) => ({
      label: person,
      data: dates.map(d => m.has(d) ? m.get(d) : null),
      borderColor: palette(i),
      backgroundColor: palette(i, 0.10),
      tension: 0.2,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true
    }));

  burnupChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.parsed.y == null ? '—' : c.parsed.y + ' SP') } }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Cumulative SP done' } },
        x: { title: { display: true, text: 'Day' } }
      }
    }
  });
  hint.textContent = 'Cumulative SP closed from sprint start. Click a name in the legend to isolate. Flat runs of days = nothing closed — plateaus surface who is stuck.';
}

function renderBlockers(rows) {
  const wrap = document.getElementById('blocker-table-wrap');
  const hint = document.getElementById('blocker-hint');
  if (!wrap) return;
  hint.textContent = 'Open sub-tasks in the active sprint, oldest-updated first. Age band: green <3d, yellow 3–7d, red >7d. Assignee is usually the blocker, not the parent ticket’s owner.';

  // For blockers, the assignee is typically the *blocker* (e.g. PR reviewer,
  // cross-team contact) rather than the ticket's owner — they often aren't
  // a Search team member. Keeping non-whitelisted blockers visible here is
  // correct; the whitelist is for who counts on the team, not who's blocking.
  rows = (rows || []).filter(r => {
    const f = loadFilter();
    if (!f || !f.length) return true;
    // If a filter is active, only show blockers whose assignee is selected.
    // Unknown (cross-team) assignees always surface — the whole point is to
    // see who's waiting on whom, including external people.
    return f.indexOf(r.assignee) !== -1 || !state.allPeople.includes(r.assignee);
  });

  if (!rows.length) {
    wrap.innerHTML = '<div class="muted">No open sub-tasks in the active sprint. Nothing is blocked.</div>';
    return;
  }
  const head = `
    <tr>
      <th>Sub-task</th><th>Parent</th><th>Assignee (blocker)</th>
      <th>Status</th><th class="num">Last touched</th><th>Age</th><th>Summary</th>
    </tr>`;
  const body = rows.map(r => {
    const band = r.age_band || 'green';
    return `
      <tr>
        <td class="key">${jiraLink(r.ticket_key)}</td>
        <td class="key">${jiraLink(r.parent_epic_key)}</td>
        <td>${escapeHtml(r.assignee)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td class="num" title="${escapeHtml(r.updated)}">${escapeHtml(r.age_days || '0')}d</td>
        <td><span class="depth-pill ${band === 'green' ? '' : band}">${band}</span></td>
        <td>${escapeHtml(truncate(r.summary, 80))}</td>
      </tr>`;
  }).join('');
  wrap.innerHTML = '<table class="data"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

/* ---------- carry-over ---------- */

function renderCarryOver(rows) {
  const wrap = document.getElementById('carryover-table-wrap');
  rows = rows.filter(r => showIndividual(r.assignee));
  if (!rows.length) {
    wrap.innerHTML = '<div class="muted">Nothing has carried across 2+ sprints. Nice.</div>';
    return;
  }
  rows.sort((a, b) => num(b.depth_sprints) - num(a.depth_sprints));
  const head = `
    <tr>
      <th>Ticket</th><th>Assignee</th><th>Depth</th><th>Status</th>
      <th class="num">Orig SP</th><th class="num">Cur SP</th><th>Summary</th>
    </tr>`;
  const body = rows.map(r => {
    const d = num(r.depth_sprints);
    const band = d >= 3 ? 'red' : 'yellow';
    return `
      <tr>
        <td class="key">${jiraLink(r.ticket_key)}</td>
        <td>${escapeHtml(r.assignee)}</td>
        <td><span class="depth-pill ${band}">${d} sprints</span></td>
        <td>${escapeHtml(r.status)}</td>
        <td class="num">${escapeHtml(r.original_sp || '—')}</td>
        <td class="num">${escapeHtml(r.current_sp || '—')}</td>
        <td>${escapeHtml(truncate(r.summary, 80))}</td>
      </tr>`;
  }).join('');
  wrap.innerHTML = '<table class="data"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

/* ---------- scope churn (active sprint filtered) ---------- */

function renderScopeChurn(rows, activeSprintName) {
  const kpiRow = document.getElementById('scope-kpi-row');
  const wrap = document.getElementById('scope-table-wrap');

  // KPI row: team-level, so whitelist applies but filter does not. The
  // drill-down table below is an individual view, so filter also applies.
  const teamOnly = rows.filter(r => r.sprint === activeSprintName && inTeam(r.assignee));
  const filtered = teamOnly.filter(r => showIndividual(r.assignee));

  let kpiInflated = 0, kpiDeflated = 0;
  for (const r of teamOnly) {
    const d = num(r.delta);
    if (d > 0) kpiInflated += d;
    else if (d < 0) kpiDeflated += Math.abs(d);
  }

  kpiRow.innerHTML = `
    <div class="kpi bad">
      <div class="label">SP inflated</div>
      <div class="value">+${kpiInflated}</div>
    </div>
    <div class="kpi good">
      <div class="label">SP deflated</div>
      <div class="value">−${kpiDeflated}</div>
    </div>
    <div class="kpi">
      <div class="label">Tickets edited</div>
      <div class="value">${teamOnly.length}</div>
    </div>`;

  if (!filtered.length) {
    wrap.innerHTML = '<div class="muted">No SP edits for the current filter in this sprint.</div>';
    return;
  }
  filtered.sort((a, b) => Math.abs(num(b.delta)) - Math.abs(num(a.delta)));
  const head = `
    <tr>
      <th>When</th><th>Ticket</th><th>Assignee</th>
      <th class="num">Before</th><th class="num">After</th>
      <th class="num">Delta</th><th class="num">% of baseline</th>
    </tr>`;
  const body = filtered.map(r => {
    const d = num(r.delta);
    const cls = d > 0 ? 'delta-pos' : (d < 0 ? 'delta-neg' : '');
    const pct = r.pct_of_baseline === '' ? '—' : fmtPct(num(r.pct_of_baseline));
    return `
      <tr>
        <td>${escapeHtml(formatShortDate(r.detected_at))}</td>
        <td class="key">${jiraLink(r.ticket_key)}</td>
        <td>${escapeHtml(r.assignee)}</td>
        <td class="num">${escapeHtml(r.sp_before || '—')}</td>
        <td class="num">${escapeHtml(r.sp_after || '—')}</td>
        <td class="num ${cls}">${d > 0 ? '+' : ''}${d}</td>
        <td class="num">${pct}</td>
      </tr>`;
  }).join('');
  wrap.innerHTML = '<table class="data"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

/* ---------- whitelist modal ---------- */

function wireWhitelistModal() {
  const modal = document.getElementById('whitelistModal');
  document.getElementById('openWhitelistBtn').addEventListener('click', openWhitelist);
  document.getElementById('cancelWhitelistBtn').addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('saveWhitelistBtn').addEventListener('click', saveWhitelistAndClose);
  document.getElementById('resetWhitelistBtn').addEventListener('click', resetWhitelist);
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  function openWhitelist() {
    const stored = loadWhitelist();
    // If nothing's saved yet, pre-check everyone (backward compat).
    const checked = stored && stored.length ? new Set(stored) : new Set(state.allPeople);
    document.getElementById('whitelist-inputs').innerHTML = state.allPeople.map(p => `
      <label>
        <input type="checkbox" class="wl-input" data-person="${escapeAttr(p)}" ${checked.has(p) ? 'checked' : ''}>
        <span>${escapeHtml(p)}</span>
      </label>`).join('');
    modal.classList.add('open');
  }

  function saveWhitelistAndClose() {
    const selected = Array.from(document.querySelectorAll('.wl-input:checked'))
      .map(inp => inp.dataset.person);
    // If every known person is checked, treat as "no whitelist active".
    if (selected.length === state.allPeople.length) {
      saveWhitelist(null);
    } else {
      saveWhitelist(selected);
    }
    // When whitelist shrinks, the filter may contain dropped names. Clean it.
    const wl = loadWhitelist();
    if (wl) {
      const f = loadFilter();
      if (f) saveFilter(f.filter(p => wl.indexOf(p) !== -1));
    }
    modal.classList.remove('open');
    render();
  }

  function resetWhitelist() {
    saveWhitelist(null);
    saveFilter(null);
    openWhitelist();
  }
}

/* ---------- filter modal ---------- */

function wireFilterModal() {
  const modal = document.getElementById('filterModal');
  document.getElementById('openFilterBtn').addEventListener('click', openFilter);
  document.getElementById('cancelFilterBtn').addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('saveFilterBtn').addEventListener('click', saveFilterAndClose);
  document.getElementById('resetFilterBtn').addEventListener('click', resetFilter);
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  function eligiblePeople() {
    return state.allPeople.filter(inTeam);
  }

  function openFilter() {
    const stored = loadFilter();
    const people = eligiblePeople();
    const checked = stored && stored.length ? new Set(stored) : new Set(people);
    document.getElementById('filter-inputs').innerHTML = people.map(p => `
      <label>
        <input type="checkbox" class="filter-input" data-person="${escapeAttr(p)}" ${checked.has(p) ? 'checked' : ''}>
        <span>${escapeHtml(p)}</span>
      </label>`).join('');
    modal.classList.add('open');
  }

  function saveFilterAndClose() {
    const people = eligiblePeople();
    const selected = Array.from(document.querySelectorAll('.filter-input:checked'))
      .map(inp => inp.dataset.person);
    // If every eligible person is checked, store as "no filter active".
    if (selected.length === people.length) {
      saveFilter(null);
    } else {
      saveFilter(selected);
    }
    modal.classList.remove('open');
    render();
  }

  function resetFilter() {
    saveFilter(null);
    openFilter();
  }
}

/* ---------- leaves modal ---------- */

function wireModal() {
  const modal = document.getElementById('leavesModal');
  document.getElementById('openLeavesBtn').addEventListener('click', openModal);
  document.getElementById('cancelLeavesBtn').addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('saveLeavesBtn').addEventListener('click', saveAndClose);
  document.getElementById('resetLeavesBtn').addEventListener('click', resetSprint);
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  function openModal() {
    const sprint = selectedSprint();
    // Leave inputs are only useful for team members (non-whitelisted people
    // don't factor into team velocity regardless of leaves), so scope the
    // list to the whitelist.
    const people = sprint.rows.map(r => r.person).filter(inTeam).sort();
    document.getElementById('modal-sprint-name').textContent = sprint.name;
    const L = leavesForSprint(sprint.name);
    document.getElementById('input-holidays').value = L.publicHolidays || 0;
    document.getElementById('leave-inputs').innerHTML = people.map(p => {
      const v = Number(L.perPerson[p]) || 0;
      return `
        <div class="field-row">
          <span>${escapeHtml(p)}</span>
          <input type="number" class="leave-input" data-person="${escapeAttr(p)}" min="0" max="14" step="1" value="${v}">
        </div>`;
    }).join('');
    modal.classList.add('open');
  }

  function saveAndClose() {
    const sprint = selectedSprint();
    const all = loadLeaves();
    const entry = { publicHolidays: 0, perPerson: {} };
    entry.publicHolidays = Math.max(Number(document.getElementById('input-holidays').value) || 0, 0);
    document.querySelectorAll('.leave-input').forEach(inp => {
      const v = Math.max(Number(inp.value) || 0, 0);
      if (v > 0) entry.perPerson[inp.dataset.person] = v;
    });
    all[sprint.name] = entry;
    saveLeaves(all);
    modal.classList.remove('open');
    render();
  }

  function resetSprint() {
    const sprint = selectedSprint();
    const all = loadLeaves();
    delete all[sprint.name];
    saveLeaves(all);
    openModal();
  }
}

/* ---------- CSV / utils ---------- */

async function loadCsv(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return parseCsv(await res.text());
}

/**
 * Like loadCsv but returns [] on 404 instead of throwing. Used for CSVs that
 * may be absent on old Apps Script deployments that predate their export
 * (e.g. blockers.csv). Other HTTP errors still surface.
 */
async function loadCsvOptional(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
    return parseCsv(await res.text());
  } catch (e) {
    console.warn('loadCsvOptional ' + path + ' failed; treating as empty:', e.message);
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const filtered = rows.filter(r => r.length && r.some(c => c !== ''));
  if (!filtered.length) return [];
  const headers = filtered[0];
  return filtered.slice(1).map(r => {
    const o = {};
    for (let i = 0; i < headers.length; i++) o[headers[i]] = r[i] != null ? r[i] : '';
    return o;
  });
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function fmtPct(v) { if (v == null || !isFinite(v)) return '—'; return Math.round(v * 100) + '%'; }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function formatRelative(d) {
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + ' min ago';
  const diffH = Math.round(diffMin / 60);
  if (diffH < 48) return diffH + 'h ago';
  return Math.round(diffH / 24) + 'd ago';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

function jiraLink(key) {
  if (!key) return '';
  return '<a href="' + JIRA_BASE + '/browse/' + encodeURIComponent(key) +
    '" target="_blank" rel="noopener">' + escapeHtml(key) + '</a>';
}

function palette(i, alpha) {
  const colors = [
    '#1a73e8', '#d93025', '#f9ab00', '#188038', '#aa00ff',
    '#00acc1', '#e65100', '#3949ab', '#5d4037', '#c2185b',
    '#558b2f', '#6a1b9a', '#00695c', '#ef6c00', '#424242'
  ];
  const c = colors[i % colors.length];
  if (alpha == null || alpha === 1) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
