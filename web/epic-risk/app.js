/**
 * team-lens: Epic Risk — local page bootstrap.
 *
 * Reads epics.csv, epic_sprint_history.csv, and meta.csv from the same
 * folder (placed there by the Apps Script "Export CSVs" menu), and
 * renders a staleness badge, hero stat + sparkline, epic cards grid,
 * and the throughput trend chart. Chart.js is loaded via CDN in
 * index.html; there is no build step.
 */

(async function main() {
  try {
    const [epics, history, meta] = await Promise.all([
      loadCsv('./epics.csv'),
      loadCsv('./epic_sprint_history.csv'),
      loadCsv('./meta.csv')
    ]);
    renderStaleness(meta);
    renderHero(epics, history);
    renderEpicCards(epics);
    renderThroughput(epics, history);
  } catch (err) {
    console.error(err);
    const el = document.getElementById('error');
    el.hidden = false;
    el.innerHTML =
      '<strong>Failed to load CSVs.</strong> ' + escapeHtml(err.message) +
      '<br>Did you run <code>Epic Risk → Export CSVs</code> and drop ' +
      '<code>epics.csv</code>, <code>epic_sprint_history.csv</code>, ' +
      '<code>meta.csv</code> into this folder?';
  }
})();

/* ---------- data loading ---------- */

async function loadCsv(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return parseCsv(await res.text());
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

function formatRelative(d) {
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + ' min ago';
  const diffH = Math.round(diffMin / 60);
  if (diffH < 48) return diffH + 'h ago';
  return Math.round(diffH / 24) + 'd ago';
}

/* ---------- hero ---------- */

function renderHero(epics, history) {
  const totalSp = epics.reduce((s, e) => s + num(e.sp_done), 0);
  document.getElementById('hero-stat').textContent = totalSp;

  const sprints = aggregateSprintTotals_(history);
  const last6 = sprints.slice(-6);
  const labels = last6.map(s => s.name);
  const data = last6.map(s => s.sp);

  const ctx = document.getElementById('hero-sparkline').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#1a73e8',
        backgroundColor: 'rgba(26,115,232,0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' SP' } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#5f6368' } },
        y: { display: false, beginAtZero: true }
      }
    }
  });
}

/* ---------- epic cards ---------- */

function renderEpicCards(epics) {
  const container = document.getElementById('epic-cards');
  if (!epics.length) {
    container.innerHTML = '<div class="muted">No epics.</div>';
    return;
  }
  container.innerHTML = epics.map(e => `
    <div class="card" title="${escapeHtml(e.summary)}">
      <div class="key">${escapeHtml(e.epic_key)}</div>
      <div class="summary">${escapeHtml(e.summary)}</div>
      <div class="meta-row">
        <span>Due: ${escapeHtml(e.due_date || '—')}</span>
        <span class="flags">
          <span title="Throughput drop">${e.flag_throughput_drop || '—'}</span>
          <span title="No movement">${e.flag_no_movement || '—'}</span>
          <span title="Unestimated">${e.flag_unestimated || '—'}</span>
        </span>
      </div>
      <div class="sp">
        Done ${num(e.sp_done)} · WIP ${num(e.sp_in_progress)} · Todo ${num(e.sp_to_do)}
      </div>
    </div>
  `).join('');
}

/* ---------- throughput chart ---------- */

function renderThroughput(epics, history) {
  const sprints = aggregateSprintTotals_(history);
  const last6 = sprints.slice(-6).map(s => s.name);
  const summaries = new Map(epics.map(e => [e.epic_key, e.summary]));

  const byEpic = new Map();
  for (const row of history) {
    const idx = last6.indexOf(row.sprint_name);
    if (idx === -1) continue;
    const key = row.epic_key;
    if (!byEpic.has(key)) byEpic.set(key, new Array(last6.length).fill(0));
    byEpic.get(key)[idx] += num(row.sp_closed);
  }

  const datasets = Array.from(byEpic.entries()).map(([key, arr], i) => ({
    label: key + (summaries.get(key) ? ' — ' + truncate(summaries.get(key), 40) : ''),
    data: arr,
    borderColor: palette(i),
    backgroundColor: palette(i, 0.15),
    tension: 0.25,
    pointRadius: 3,
    pointHoverRadius: 5
  }));

  const ctx = document.getElementById('throughput-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { labels: last6, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 10, font: { size: 11 }, color: '#1a1a1a' }
        },
        tooltip: { callbacks: { label: c => c.dataset.label.split(' — ')[0] + ': ' + c.parsed.y + ' SP' } }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'SP closed' } },
        x: { title: { display: true, text: 'Sprint' } }
      }
    }
  });
}

/* ---------- sprint aggregation ---------- */

/**
 * Roll up epic_sprint_history rows into per-sprint totals, ordered by
 * sprint_end_date ascending. Sprints without an end date are dropped —
 * they can't be placed on the timeline reliably (usually legacy entries).
 */
function aggregateSprintTotals_(history) {
  const byName = new Map();  // name -> { endDate, sp }
  for (const row of history) {
    const name = row.sprint_name;
    if (!name) continue;
    const endDate = row.sprint_end_date;
    if (!endDate) continue;
    const sp = num(row.sp_closed);
    const prev = byName.get(name);
    if (prev) {
      prev.sp += sp;
      if (!prev.endDate && endDate) prev.endDate = endDate;
    } else {
      byName.set(name, { endDate, sp });
    }
  }
  return Array.from(byName.entries())
    .map(([name, info]) => ({ name, endDate: info.endDate, sp: info.sp }))
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
}

/* ---------- utils ---------- */

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
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
